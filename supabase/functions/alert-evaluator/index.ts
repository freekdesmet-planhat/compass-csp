// alert-evaluator — every 30 min. Evaluates enabled alert_rules against the
// current data and upserts alerts on (rule_id, company_id, dedupe_key) so each
// firing condition raises exactly one alert (dedup). Realtime pushes the badge.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { serviceClient, json } from "../_shared/supabase.ts";

const DAY = 86_400_000;
const SLA: Record<string, number> = { scaled: 90, mid_touch: 45, enterprise: 21 };

serve(async () => {
  const supabase = serviceClient();
  const { data: rules } = await supabase.from("alert_rules").select("*").eq("enabled", true);
  const { data: companies } = await supabase.from("companies").select("*").neq("status", "churned");
  let upserted = 0;

  const raise = async (rule: any, c: any, title: string, detail: string, dedupe: string) => {
    await supabase.from("alerts").upsert({
      rule_id: rule.id, company_id: c.id, owner_id: c.owner_id, title, detail,
      severity: rule.severity, status: "open", dedupe_key: dedupe,
    }, { onConflict: "rule_id,company_id,dedupe_key", ignoreDuplicates: true });
    upserted++;
  };

  for (const rule of rules ?? []) {
    for (const c of companies ?? []) {
      if (rule.segment?.length && c.segment && !rule.segment.includes(c.segment)) continue;
      const daysToRenewal = c.renewal_date ? Math.ceil((Date.parse(c.renewal_date) - Date.now()) / DAY) : null;
      switch (rule.rule_type) {
        case "health_drop":
          if ((c.health_delta_wow ?? 0) <= -(rule.config?.points ?? 10)) await raise(rule, c, `${c.name} health dropped ${c.health_delta_wow} WoW`, "Investigate recent activity and tickets.", `drop:${c.health_updated_at?.slice(0, 10)}`);
          break;
        case "health_band_red":
          if (c.health_band === "red") await raise(rule, c, `${c.name} crossed into red`, `Health ${c.health_score}.`, "red");
          break;
        case "no_touch_sla": {
          const sla = SLA[c.segment ?? "mid_touch"];
          if (c.last_touch_at && (Date.now() - Date.parse(c.last_touch_at)) / DAY > sla) await raise(rule, c, `No touch on ${c.name} > ${sla}d`, "Beyond the segment touch SLA.", `notouch:${sla}`);
          break;
        }
        case "renewal_at_risk":
          if (daysToRenewal != null && daysToRenewal <= (rule.config?.days ?? 90) && daysToRenewal >= 0 && (c.health_score ?? 100) < (rule.config?.health ?? 60)) await raise(rule, c, `At-risk renewal: ${c.name}`, `Renews in ${daysToRenewal}d, health ${c.health_score}.`, "renrisk");
          break;
        case "nps_detractor": {
          const { data: det } = await supabase.from("nps_responses").select("id, responded_at, score").eq("company_id", c.id).lt("score", 0).gte("responded_at", new Date(Date.now() - DAY).toISOString()).limit(1);
          if (det?.length) await raise(rule, c, `NPS detractor — ${c.name}`, `Score ${det[0].score}.`, `nps:${det[0].id}`);
          break;
        }
        case "deal_stale": {
          const { data: deals } = await supabase.from("deals").select("id, updated_at").eq("company_id", c.id).eq("status", "open");
          for (const d of deals ?? []) if ((Date.now() - Date.parse(d.updated_at)) / DAY > (rule.config?.days ?? 14)) await raise(rule, c, `Open deal stalled — ${c.name}`, "No activity for 14+ days.", `dealstale:${d.id}`);
          break;
        }
        case "new_p1": {
          const { data: p1 } = await supabase.from("tickets").select("id, opened_at").eq("company_id", c.id).eq("priority", "p1").eq("status", "open").gte("opened_at", new Date(Date.now() - DAY).toISOString()).limit(1);
          if (p1?.length) await raise(rule, c, `New P1 ticket — ${c.name}`, "Critical incident opened.", `p1:${p1[0].id}`);
          break;
        }
        // playbook_overdue + connection_broken evaluated in their own contexts.
      }
    }
  }
  return json({ ok: true, upserted });
});

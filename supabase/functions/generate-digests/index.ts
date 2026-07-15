// generate-digests — hourly (Section 5.1/5.2). Fires per user at their local
// digest hour: assemble the daily morning-review deterministically, then Sonnet
// writes a ≤150-word "Top 3 priorities". Monday prepends a week recap. Friday
// also generates the manager weekly_exec summary (≤250 words).
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { serviceClient, json } from "../_shared/supabase.ts";
import { callAI, logAiRun } from "../_shared/anthropic.ts";

const DAY = 86_400_000;

serve(async () => {
  const supabase = serviceClient();
  const nowUtc = new Date();
  const today = nowUtc.toISOString().slice(0, 10);

  const { data: profiles } = await supabase.from("profiles").select("*").eq("is_active", true);
  let daily = 0, exec = 0;

  for (const prof of profiles ?? []) {
    const localHour = localHourFor(nowUtc, prof.timezone ?? "UTC");
    const localDow = localDowFor(nowUtc, prof.timezone ?? "UTC");
    if (localHour !== (prof.digest_hour ?? 7)) continue;

    // Companies visible to this user (owner or collaborator or team for managers)
    const { data: cos } = await supabase.from("companies").select("*").or(`owner_id.eq.${prof.id},collaborator_ids.cs.{${prof.id}}`);
    const companyIds = (cos ?? []).map((c) => c.id);
    if (!companyIds.length && prof.role === "csm") { /* still emit an empty digest */ }

    const [{ data: meetings }, { data: tasks }, { data: alerts }] = await Promise.all([
      supabase.from("calendar_events").select("id, company_id, title, starts_at").in("company_id", companyIds).gte("starts_at", today).lte("starts_at", new Date(Date.parse(today) + DAY).toISOString()),
      supabase.from("tasks").select("id, company_id, title, due_date").in("company_id", companyIds).is("completed_at", null),
      supabase.from("alerts").select("id, company_id, title, severity, created_at").eq("owner_id", prof.id).eq("status", "open").gte("created_at", new Date(Date.now() - DAY).toISOString()),
    ]);
    const nameOf = new Map((cos ?? []).map((c) => [c.id, c.name]));

    const movers = (cos ?? []).filter((c) => Math.abs(c.health_delta_wow ?? 0) >= 5).slice(0, 8);
    const renewalCheckpoints = (cos ?? []).filter((c) => { const d = c.renewal_date ? Math.ceil((Date.parse(c.renewal_date) - Date.now()) / DAY) : 9999; return [120, 90, 60, 30].some((t) => Math.abs(d - t) <= 1); });

    const content: Record<string, unknown> = {
      meetings: (meetings ?? []).map((m) => ({ time: m.starts_at, company: nameOf.get(m.company_id), companyId: m.company_id, health: (cos ?? []).find((c) => c.id === m.company_id)?.health_score ?? null, calendarEventId: m.id })),
      tasksDue: (tasks ?? []).slice(0, 10).map((t) => ({ id: t.id, title: t.title, company: nameOf.get(t.company_id), companyId: t.company_id, dueDate: t.due_date, overdue: !!t.due_date && Date.parse(t.due_date) < Date.now() })),
      unprocessedActionItems: [],
      alerts: (alerts ?? []).map((a) => ({ id: a.id, title: a.title, severity: a.severity, companyId: a.company_id })),
      healthMovers: movers.map((c) => ({ companyId: c.id, company: c.name, delta: c.health_delta_wow ?? 0, score: c.health_score ?? 0 })),
      renewalCheckpoints: renewalCheckpoints.map((c) => ({ companyId: c.id, company: c.name, daysOut: Math.ceil((Date.parse(c.renewal_date) - Date.now()) / DAY), arr: c.renewal_arr })),
    };
    if (localDow === 1) content.weekRecap = await buildWeekRecap(supabase, companyIds);

    const ai = await callAI({ model: "reasoning", maxTokens: 400, messages: [{ role: "user", content:
      `Assembled facts for today: ${JSON.stringify(content)}. Write a ≤150-word "Top 3 priorities today" narrative that references ONLY these facts. Be direct and specific.` }] }).catch(() => null);

    await supabase.from("digests").upsert({ user_id: prof.id, digest_type: "daily", digest_date: today, content, narrative: ai?.text ?? "" }, { onConflict: "user_id,digest_type,digest_date" });
    if (ai) await logAiRun(supabase, { kind: "daily_digest", model: ai.model, inputSummary: `digest ${prof.email}`, output: { narrative: ai.text } });
    daily++;

    // Friday 16:00 local → weekly exec summary for managers
    if (localDow === 5 && (prof.role === "manager" || prof.role === "admin") && localHour === 16) {
      await buildExecSummary(supabase, prof, today);
      exec++;
    }
  }
  return json({ ok: true, daily, exec });
});

function localHourFor(d: Date, tz: string): number { try { return Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: tz }).format(d)) % 24; } catch { return d.getUTCHours(); } }
function localDowFor(d: Date, tz: string): number { try { const wd = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: tz }).format(d); return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd); } catch { return d.getUTCDay(); } }

async function buildWeekRecap(supabase: ReturnType<typeof serviceClient>, companyIds: string[]) {
  const weekAgo = new Date(Date.now() - 7 * DAY).toISOString();
  const [{ count: meetingsHeld }, { count: emails }, { count: nps }, { count: tasksCompleted }, { count: tasksCreated }] = await Promise.all([
    supabase.from("activities").select("id", { count: "exact", head: true }).in("company_id", companyIds).eq("type", "meeting").gte("occurred_at", weekAgo),
    supabase.from("emails").select("id", { count: "exact", head: true }).in("company_id", companyIds).gte("sent_at", weekAgo),
    supabase.from("nps_responses").select("id", { count: "exact", head: true }).in("company_id", companyIds).gte("responded_at", weekAgo),
    supabase.from("tasks").select("id", { count: "exact", head: true }).in("company_id", companyIds).gte("completed_at", weekAgo),
    supabase.from("tasks").select("id", { count: "exact", head: true }).in("company_id", companyIds).gte("created_at", weekAgo),
  ]);
  return { healthMovers: 0, meetingsHeld: meetingsHeld ?? 0, emailsExchanged: emails ?? 0, npsReceived: nps ?? 0, renewalStageChanges: 0, tasksCompleted: tasksCompleted ?? 0, tasksCreated: tasksCreated ?? 0 };
}

async function buildExecSummary(supabase: ReturnType<typeof serviceClient>, manager: Record<string, any>, today: string) {
  const { data: team } = await supabase.from("profiles").select("id, full_name, segment").eq("manager_id", manager.id);
  const teamIds = (team ?? []).map((t) => t.id);
  const { data: cos } = await supabase.from("companies").select("*").in("owner_id", teamIds);
  const byBand = (b: string) => (cos ?? []).filter((c) => c.health_band === b).length;
  const atRisk = (cos ?? []).filter((c) => c.health_band === "red").slice(0, 5).map((c) => ({ name: c.name, reason: c.ai_risk_summary }));
  const content = { healthDistribution: { green: byBand("green"), amber: byBand("amber"), red: byBand("red") }, atRisk, teamSize: teamIds.length, accounts: (cos ?? []).length };
  const ai = await callAI({ model: "reasoning", maxTokens: 600, messages: [{ role: "user", content: `Weekly exec summary facts: ${JSON.stringify(content)}. Write an exec-readable ≤250-word summary referencing only these facts.` }] }).catch(() => null);
  await supabase.from("digests").upsert({ user_id: manager.id, digest_type: "weekly_exec", digest_date: today, content, narrative: ai?.text ?? "" }, { onConflict: "user_id,digest_type,digest_date" });
  if (ai) await logAiRun(supabase, { kind: "weekly_exec", model: ai.model, inputSummary: `exec ${manager.email}`, output: { narrative: ai.text } });
}

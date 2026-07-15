// sync-hubspot — org-level poll every 15 min (Section 6.2). Private-app token.
// Companies + renewal/expansion deals via search on hs_lastmodifieddate cursor;
// when a renewal deal changes, refresh companies.renewal_date/renewal_arr.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { serviceClient, json } from "../_shared/supabase.ts";
import { fetchJson } from "../_shared/http.ts";
import { getCursor, setCursor, withSyncRun } from "../_shared/sync.ts";

const BASE = "https://api.hubapi.com";
const token = () => Deno.env.get("HUBSPOT_PRIVATE_APP_TOKEN") ?? "";
const h = () => ({ Authorization: `Bearer ${token()}`, "content-type": "application/json" });

serve(async () => {
  const supabase = serviceClient();
  // Resolve (or create) the org-level HubSpot connection row for cursor storage.
  let { data: conn } = await supabase.from("integration_connections").select("id, sync_cursor").eq("provider", "hubspot").is("user_id", null).maybeSingle();
  if (!conn) conn = (await supabase.from("integration_connections").insert({ provider: "hubspot", status: "active", sync_cursor: {} }).select("id, sync_cursor").single()).data!;

  const result = await withSyncRun(supabase, "hubspot", conn.id, async () => {
    const cursor = await getCursor(supabase, conn!.id);
    const since = (cursor.lastmodified as string) ?? "0";

    // Pipelines metadata → stage id → { label, probability }
    const pipelines = await fetchJson<{ results: any[] }>(`${BASE}/crm/v3/pipelines/deals`, { headers: h() });
    const renewalPid = Deno.env.get("HUBSPOT_RENEWAL_PIPELINE_ID");
    const expansionPid = Deno.env.get("HUBSPOT_EXPANSION_PIPELINE_ID");
    const stageMap = new Map<string, { label: string; probability: number; pipeline: string }>();
    for (const p of pipelines.results ?? []) {
      const pipeName = p.id === renewalPid ? "renewal" : p.id === expansionPid ? "expansion" : "new_business";
      for (const s of p.stages ?? []) stageMap.set(s.id, { label: s.label, probability: Number(s.metadata?.probability ?? 0), pipeline: pipeName });
    }

    // Companies
    const compSearch = await fetchJson<{ results: any[] }>(`${BASE}/crm/v3/objects/companies/search`, {
      method: "POST", headers: h(),
      body: JSON.stringify({ filterGroups: [{ filters: [{ propertyName: "hs_lastmodifieddate", operator: "GT", value: since }] }], properties: ["name", "domain", "annualrevenue"], limit: 100 }),
    });
    let companiesUpserted = 0;
    for (const co of compSearch.results ?? []) {
      const props = co.properties ?? {};
      const { data: existing } = await supabase.from("companies").select("id").eq("hubspot_company_id", co.id).maybeSingle();
      const patch: Record<string, unknown> = { name: props.name, arr: props.annualrevenue ? Number(props.annualrevenue) : undefined, hubspot_company_id: co.id };
      if (existing) await supabase.from("companies").update(patch).eq("id", existing.id);
      else {
        const byDomain = props.domain ? (await supabase.from("companies").select("id").contains("domains", [props.domain]).maybeSingle()).data : null;
        if (byDomain) await supabase.from("companies").update(patch).eq("id", byDomain.id);
        else await supabase.from("companies").insert({ ...patch, domains: props.domain ? [props.domain] : [], source: "hubspot", source_id: co.id, status: "customer" });
      }
      companiesUpserted++;
    }

    // Deals (renewal + expansion pipelines)
    const dealSearch = await fetchJson<{ results: any[] }>(`${BASE}/crm/v3/objects/deals/search`, {
      method: "POST", headers: h(),
      body: JSON.stringify({ filterGroups: [{ filters: [{ propertyName: "hs_lastmodifieddate", operator: "GT", value: since }] }], properties: ["dealname", "pipeline", "dealstage", "amount", "closedate", "hubspot_owner_id", "hs_deal_stage_probability", "description", "hs_next_step"], limit: 100 }),
    });
    let dealsUpserted = 0;
    for (const d of dealSearch.results ?? []) {
      const props = d.properties ?? {};
      if (props.pipeline !== renewalPid && props.pipeline !== expansionPid) continue;
      const assoc = await fetchJson<{ results: any[] }>(`${BASE}/crm/v4/objects/deals/${d.id}/associations/companies`, { headers: h() }).catch(() => ({ results: [] }));
      const hsCompanyId = assoc.results?.[0]?.toObjectId ?? assoc.results?.[0]?.to?.id;
      const { data: company } = hsCompanyId ? await supabase.from("companies").select("id").eq("hubspot_company_id", String(hsCompanyId)).maybeSingle() : { data: null };
      if (!company) continue;
      const stage = stageMap.get(props.dealstage);
      const amount = props.amount ? Number(props.amount) : null;
      await supabase.from("deals").upsert({
        company_id: company.id, hubspot_deal_id: d.id, pipeline: stage?.pipeline ?? "new_business",
        stage: stage?.label ?? props.dealstage, stage_probability: props.hs_deal_stage_probability ? Number(props.hs_deal_stage_probability) : stage?.probability,
        name: props.dealname, amount, currency: "USD", close_date: props.closedate ? props.closedate.slice(0, 10) : null,
        next_steps: props.hs_next_step, ai_summary: props.description, last_synced_at: new Date().toISOString(),
        source: "hubspot", source_id: d.id,
      }, { onConflict: "hubspot_deal_id" });
      // Renewal deal → refresh company renewal fields
      if (stage?.pipeline === "renewal") await supabase.from("companies").update({ renewal_date: props.closedate ? props.closedate.slice(0, 10) : null, renewal_arr: amount }).eq("id", company.id);
      dealsUpserted++;
    }

    await setCursor(supabase, conn!.id, { lastmodified: String(Date.now()) });
    return { companiesUpserted, dealsUpserted };
  });
  return json(result);
});

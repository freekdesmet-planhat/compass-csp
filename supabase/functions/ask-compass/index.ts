// ask-compass — the agent chat backend (D1). Runs an Anthropic tool-use loop
// (max 8 tool calls/turn) over read-only tools. SECURITY: the caller's visible
// company ids are resolved via the visible_company_ids() security-definer RPC and
// EVERY tool hard-filters to that set — the service-role key must never let a CSM
// read outside their book. Persists to ask_compass_threads/messages; logs ai_runs.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { serviceClient, userClient, json, CORS_HEADERS } from "../_shared/supabase.ts";
import { logAiRun } from "../_shared/anthropic.ts";
import { fetchWithRetry } from "../_shared/http.ts";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MAX_TOOL_CALLS = 8;

const SYSTEM =
  "You are Compass, an assistant for Customer Success Managers. Answer ONLY from " +
  "tool results — never invent accounts, numbers, or dates. Cite records by name. " +
  "If you can't find something, say 'I couldn't find that' rather than guessing. " +
  "Keep answers tight and scannable.";

// deno-lint-ignore no-explicit-any
type Json = any;

const TOOLS = [
  { name: "search_companies", description: "Search the caller's companies by free-text query or FilterSpec (segment, healthBand, atRiskRenewal, renewalWindowDays).", input_schema: { type: "object", properties: { query: { type: "string" }, filter: { type: "object" } } } },
  { name: "get_company_360", description: "Full 360 for one company: attributes, latest health snapshot, last 20 activities, open tasks, open deals, success plan.", input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  { name: "get_contact", description: "A contact and its company.", input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  { name: "list_renewals", description: "Open renewal deals in scope, optionally filtered by days-to-close.", input_schema: { type: "object", properties: { withinDays: { type: "number" } } } },
  { name: "list_tasks", description: "Tasks in scope, optionally only open ones.", input_schema: { type: "object", properties: { openOnly: { type: "boolean" } } } },
  { name: "get_health_breakdown", description: "Latest health dimensions for one company.", input_schema: { type: "object", properties: { company_id: { type: "string" } }, required: ["company_id"] } },
  { name: "aggregate_portfolio", description: "Aggregate over the book: group_by (segment|healthBand), measure (count|sum_arr|avg_health).", input_schema: { type: "object", properties: { group_by: { type: "string" }, measure: { type: "string" } } } },
  { name: "get_usage", description: "Latest usage metric per key for one company plus a 4-week WAU trend.", input_schema: { type: "object", properties: { company_id: { type: "string" } }, required: ["company_id"] } },
  { name: "search_activities", description: "Activities for one company, optionally text-filtered.", input_schema: { type: "object", properties: { company_id: { type: "string" }, query: { type: "string" } } } },
];

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  const authHeader = req.headers.get("Authorization") ?? "";
  const asUser = userClient(authHeader);
  const { data: auth } = await asUser.auth.getUser();
  if (!auth?.user) return json({ error: "unauthorized" }, 401);

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "missing_api_key" }, 500);
  const model = Deno.env.get("AI_MODEL_REASONING") ?? "claude-sonnet-4-6";

  const { thread_id, message } = await req.json();
  if (!message) return json({ error: "message required" }, 400);

  // Resolve the caller's visible company ids (security-definer RPC).
  const { data: visRows } = await asUser.rpc("visible_company_ids");
  const visible = new Set<string>((visRows ?? []).map((r: Json) => (typeof r === "string" ? r : r.visible_company_ids ?? r.id)));

  const supabase = serviceClient(); // service role, but every query below is filtered by `visible`
  const scoped = (ids: string[]) => ids.filter((id) => visible.has(id));

  async function runTool(name: string, input: Json): Promise<Json> {
    switch (name) {
      case "search_companies": {
        let q = supabase.from("companies").select("id,name,segment,health_score,health_band,arr,renewal_date,phase").in("id", [...visible]);
        if (input.filter?.segment) q = q.eq("segment", input.filter.segment);
        if (input.filter?.healthBand) q = q.eq("health_band", input.filter.healthBand);
        const { data } = await q.limit(50);
        let rows = data ?? [];
        if (input.query) rows = rows.filter((c: Json) => c.name.toLowerCase().includes(String(input.query).toLowerCase()));
        return rows;
      }
      case "get_company_360": {
        if (!visible.has(input.id)) return { error: "not visible" };
        const [{ data: company }, { data: snap }, { data: acts }, { data: tasks }, { data: deals }, { data: plan }] = await Promise.all([
          supabase.from("companies").select("*").eq("id", input.id).maybeSingle(),
          supabase.from("health_snapshots").select("overall,band,dimensions,snapshot_date").eq("company_id", input.id).order("snapshot_date", { ascending: false }).limit(1),
          supabase.from("activities").select("type,title,snippet,occurred_at").eq("company_id", input.id).order("occurred_at", { ascending: false }).limit(20),
          supabase.from("tasks").select("title,due_date").eq("company_id", input.id).is("completed_at", null),
          supabase.from("deals").select("name,pipeline,stage,amount").eq("company_id", input.id).eq("status", "open"),
          supabase.from("success_plans").select("name,status,progress_pct").eq("company_id", input.id),
        ]);
        return { company, health: snap?.[0] ?? null, activities: acts, open_tasks: tasks, open_deals: deals, success_plan: plan?.[0] ?? null };
      }
      case "get_contact": {
        const { data: c } = await supabase.from("contacts").select("*").eq("id", input.id).maybeSingle();
        if (!c || !visible.has(c.company_id)) return { error: "not visible" };
        const { data: company } = await supabase.from("companies").select("id,name").eq("id", c.company_id).maybeSingle();
        return { contact: c, company };
      }
      case "list_renewals": {
        let q = supabase.from("deals").select("company_id,name,stage,amount,close_date").eq("pipeline", "renewal").eq("status", "open").in("company_id", [...visible]);
        const { data } = await q.limit(100);
        let rows = data ?? [];
        if (input.withinDays) { const cutoff = Date.now() + input.withinDays * 86400000; rows = rows.filter((d: Json) => d.close_date && new Date(d.close_date).getTime() <= cutoff); }
        return rows;
      }
      case "list_tasks": {
        let q = supabase.from("tasks").select("company_id,title,due_date,completed_at,priority").in("company_id", [...visible]);
        if (input.openOnly) q = q.is("completed_at", null);
        const { data } = await q.limit(100);
        return data ?? [];
      }
      case "get_health_breakdown": {
        if (!visible.has(input.company_id)) return { error: "not visible" };
        const { data } = await supabase.from("health_snapshots").select("overall,band,dimensions,snapshot_date").eq("company_id", input.company_id).order("snapshot_date", { ascending: false }).limit(1);
        return data?.[0] ?? { error: "no snapshot" };
      }
      case "aggregate_portfolio": {
        const { data } = await supabase.from("companies").select("segment,health_band,health_score,arr").in("id", [...visible]);
        const rows = data ?? [];
        const groupKey = (c: Json) => input.group_by === "healthBand" ? (c.health_band ?? "none") : (c.segment ?? "none");
        const map = new Map<string, Json[]>();
        rows.forEach((c: Json) => { const k = groupKey(c); (map.get(k) ?? map.set(k, []).get(k)!).push(c); });
        return [...map.entries()].map(([label, cs]) => ({ label, value: input.measure === "sum_arr" ? cs.reduce((a, c) => a + (c.arr ?? 0), 0) : input.measure === "avg_health" ? Math.round(cs.reduce((a, c) => a + (c.health_score ?? 0), 0) / cs.length) : cs.length }));
      }
      case "get_usage": {
        if (!visible.has(input.company_id)) return { error: "not visible" };
        const { data } = await supabase.from("usage_metrics").select("metric_key,metric_date,value").eq("company_id", input.company_id).order("metric_date", { ascending: true });
        const rows = data ?? [];
        const wau = rows.filter((u: Json) => u.metric_key === "weekly_active_users");
        const trend = wau.length >= 5 ? wau[wau.length - 1].value - wau[wau.length - 5].value : null;
        const latest: Record<string, number> = {};
        rows.forEach((u: Json) => { latest[u.metric_key] = u.value; });
        return { latest, wau_trend_4w: trend };
      }
      case "search_activities": {
        if (!visible.has(input.company_id)) return { error: "not visible" };
        let q = supabase.from("activities").select("type,title,snippet,occurred_at").eq("company_id", input.company_id).order("occurred_at", { ascending: false }).limit(40);
        const { data } = await q;
        let rows = data ?? [];
        if (input.query) rows = rows.filter((a: Json) => `${a.title} ${a.snippet}`.toLowerCase().includes(String(input.query).toLowerCase()));
        return rows.slice(0, 20);
      }
      default: return { error: "unknown tool" };
    }
    void scoped;
  }

  // Tool-use loop
  const messages: Json[] = [{ role: "user", content: message }];
  const toolTrace: { name: string }[] = [];
  let answer = "";
  for (let i = 0; i < MAX_TOOL_CALLS; i++) {
    const res = await fetchWithRetry(ANTHROPIC_URL, {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model, max_tokens: 1536, system: SYSTEM, tools: TOOLS, messages }),
    }, { retries: 3 });
    const body = await res.json();
    if (!res.ok) return json({ error: `anthropic_${res.status}` }, 502);

    answer = (body.content ?? []).filter((b: Json) => b.type === "text").map((b: Json) => b.text).join("\n").trim();
    const toolUses = (body.content ?? []).filter((b: Json) => b.type === "tool_use");
    if (body.stop_reason !== "tool_use" || toolUses.length === 0) break;

    messages.push({ role: "assistant", content: body.content });
    const results: Json[] = [];
    for (const tu of toolUses) {
      toolTrace.push({ name: tu.name });
      const out = await runTool(tu.name, tu.input ?? {});
      results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(out).slice(0, 12000) });
    }
    messages.push({ role: "user", content: results });
  }

  // Persist
  let tid = thread_id as string | undefined;
  if (!tid) {
    const { data: t } = await supabase.from("ask_compass_threads").insert({ user_id: auth.user.id, title: String(message).split(/\s+/).slice(0, 6).join(" ") }).select("id").single();
    tid = t?.id;
  }
  await supabase.from("ask_compass_messages").insert([
    { thread_id: tid, role: "user", content: message },
    { thread_id: tid, role: "assistant", content: answer, tool_calls: toolTrace },
  ]);
  await logAiRun(supabase, { kind: "ask_compass", model, inputSummary: String(message).slice(0, 200), output: { answer, tools: toolTrace }, createdBy: auth.user.id });

  return json({ thread_id: tid, answer, tool_calls: toolTrace });
});

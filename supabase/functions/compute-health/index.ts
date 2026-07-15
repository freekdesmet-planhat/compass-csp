// compute-health — nightly recompute of cached company health fields + a Sunday
// is_weekly snapshot per company (Section 4). Recompute for a single company on
// demand via {companyId}. After a weekly snapshot (and on demand) the AI writes
// the ≤120-word "why" + exactly 3 recommendations; contributions are computed in
// code (health.ts), the AI only narrates.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { serviceClient, json } from "../_shared/supabase.ts";
import { callAIJson, logAiRun } from "../_shared/anthropic.ts";
import { computeHealth, SEGMENT_NORMS, type HealthInputs, type HealthResult } from "../_shared/health.ts";

const DAY = 86_400_000;

serve(async (req) => {
  const supabase = serviceClient();
  const body = await req.json().catch(() => ({}));
  const mode: string = body.mode ?? "nightly";
  const single: string | undefined = body.companyId;

  const { data: configs } = await supabase.from("health_configs").select("*");
  const configBySegment = new Map((configs ?? []).map((c) => [c.segment, c]));

  let q = supabase.from("companies").select("*").neq("status", "churned");
  if (single) q = supabase.from("companies").select("*").eq("id", single);
  const { data: companies } = await q;

  const isWeekly = mode === "weekly";
  const today = new Date().toISOString().slice(0, 10);
  let processed = 0, snapshots = 0;

  for (const c of companies ?? []) {
    if (!c.segment) continue;
    const cfg = configBySegment.get(c.segment);
    if (!cfg) continue;

    const inputs = await gatherInputs(supabase, c);
    const result = computeHealth(inputs, cfg.weights, cfg.thresholds);

    // WoW delta vs the most recent prior weekly snapshot
    const { data: prevSnaps } = await supabase.from("health_snapshots")
      .select("overall, snapshot_date").eq("company_id", c.id).eq("is_weekly", true)
      .lt("snapshot_date", today).order("snapshot_date", { ascending: false }).limit(1);
    const prev = prevSnaps?.[0]?.overall ?? result.overall;
    const deltaWow = result.overall - prev;

    await supabase.from("companies").update({
      health_score: result.overall, health_band: result.band,
      health_delta_wow: deltaWow, health_updated_at: new Date().toISOString(),
    }).eq("id", c.id);
    processed++;

    if (isWeekly || single) {
      let explanation: string | null = null;
      let recommendations: unknown = null;
      try {
        const ai = await generateNarrative(supabase, c, result, deltaWow);
        explanation = ai.explanation;
        recommendations = ai.recommendations;
      } catch (_e) { /* narrative is best-effort */ }

      await supabase.from("health_snapshots").upsert({
        company_id: c.id, snapshot_date: today, is_weekly: true,
        overall: result.overall, band: result.band, delta_wow: deltaWow,
        dimensions: result.dimensions, explanation, recommendations, source: "app",
      }, { onConflict: "company_id,snapshot_date" });
      snapshots++;
    }
  }

  return json({ ok: true, mode, processed, snapshots });
});

async function gatherInputs(supabase: ReturnType<typeof serviceClient>, c: Record<string, any>): Promise<HealthInputs> {
  const norms = SEGMENT_NORMS[c.segment] ?? SEGMENT_NORMS.mid_touch;
  const since90 = new Date(Date.now() - 90 * DAY).toISOString();
  const since30 = new Date(Date.now() - 30 * DAY).toISOString();

  const [{ data: contacts }, { data: tickets }, { data: nps }, { data: usage }, { data: emails }, { data: meetings }] = await Promise.all([
    supabase.from("contacts").select("contact_role, relationship_strength, last_touch_at").eq("company_id", c.id),
    supabase.from("tickets").select("priority, status, opened_at, resolved_at").eq("company_id", c.id),
    supabase.from("nps_responses").select("score, responded_at").eq("company_id", c.id).order("responded_at", { ascending: false }).limit(10),
    supabase.from("usage_metrics").select("metric_key, metric_date, value").eq("company_id", c.id).order("metric_date", { ascending: false }).limit(60),
    supabase.from("emails").select("direction, sent_at").eq("company_id", c.id).gte("sent_at", since30),
    supabase.from("activities").select("id, contact_ids, occurred_at").eq("company_id", c.id).eq("type", "meeting").gte("occurred_at", since90),
  ]);

  const openTickets = (tickets ?? []).filter((t) => t.status === "open");
  const resolved = (tickets ?? []).filter((t) => t.resolved_at && t.opened_at);
  const avgRes = resolved.length ? resolved.reduce((a, t) => a + (Date.parse(t.resolved_at) - Date.parse(t.opened_at)) / DAY, 0) / resolved.length : null;
  const inbound = (emails ?? []).filter((e) => e.direction === "inbound");
  const lastInbound = inbound.sort((a, b) => Date.parse(b.sent_at) - Date.parse(a.sent_at))[0];
  const latestUsage = (key: string) => (usage ?? []).filter((u) => u.metric_key === key)[0]?.value ?? null;
  const wauSeries = (usage ?? []).filter((u) => u.metric_key === "weekly_active_users").slice(0, 4).map((u) => u.value);
  const slope = wauSeries.length >= 2 ? Math.max(-1, Math.min(1, (wauSeries[0] - wauSeries[wauSeries.length - 1]) / Math.max(wauSeries[wauSeries.length - 1], 1))) : null;
  const activeContacts = new Set<string>();
  for (const m of meetings ?? []) for (const id of m.contact_ids ?? []) activeContacts.add(id);
  const execRels = (contacts ?? []).filter((c2) => c2.contact_role === "exec_sponsor" || c2.contact_role === "decision_maker").map((c2) => c2.relationship_strength).filter((x): x is number => x != null);

  return {
    valueScore: c.value_score ?? null, valueComment: c.value_comment,
    inboundEmailRecencyDays: lastInbound ? (Date.now() - Date.parse(lastInbound.sent_at)) / DAY : null,
    emailReplyRate30d: (emails ?? []).length ? inbound.length / (emails ?? []).length : null,
    meetingsLast90d: (meetings ?? []).length, meetingNormPerQuarter: norms.meetingNormPerQuarter,
    distinctActiveContacts90d: activeContacts.size, expectedActiveContacts: norms.expectedActiveContacts,
    openP1: openTickets.filter((t) => t.priority === "p1").length, openP2: openTickets.filter((t) => t.priority === "p2").length,
    avgResolutionDays90d: avgRes, incidentCount90d: (tickets ?? []).length, hasTicketData: (tickets ?? []).length > 0,
    sentimentAssessment: c.sentiment_assessment ?? null,
    companyNps: (nps ?? []).length ? Math.round((nps ?? []).reduce((a, n) => a + n.score, 0) / (nps ?? []).length) : null,
    execContactRelationshipAvg: execRels.length ? execRels.reduce((a, b) => a + b, 0) / execRels.length : null,
    callSentimentRolling: null, execRelationshipFlag: !!c.exec_relationship_flag,
    wau: latestUsage("weekly_active_users"), seats: latestUsage("licensed_seats"),
    adoptionBreadth: latestUsage("feature_x_users") != null && latestUsage("weekly_active_users") ? Math.min(1, latestUsage("feature_x_users")! / Math.max(latestUsage("weekly_active_users")!, 1)) : null,
    usageTrendSlope: slope,
  };
}

async function generateNarrative(supabase: ReturnType<typeof serviceClient>, c: Record<string, any>, result: HealthResult, deltaWow: number) {
  const { data: acts } = await supabase.from("activities").select("title, occurred_at")
    .eq("company_id", c.id).gte("occurred_at", new Date(Date.now() - 14 * DAY).toISOString()).order("occurred_at", { ascending: false }).limit(20);

  const prompt = `Account "${c.name}" health = ${result.overall} (${result.band}), changed ${deltaWow} pts WoW.
Dimension breakdown (score/weight/contribution): ${JSON.stringify(result.dimensions)}
Recent activity titles (last 14d): ${JSON.stringify((acts ?? []).map((a) => a.title))}
Return JSON: { "explanation": string (≤120 words, cite the actual driving inputs, e.g. "Support dragged -18: two P1s open 11 days"), "recommendations": [ { "title": string, "why": string (tied to a real datapoint), "suggested_task": { "title": string, "due_in_days": number } } ] with EXACTLY 3 recommendations. Cite only the numbers provided; invent nothing.`;

  const { data, result: aiResult } = await callAIJson<{ explanation: string; recommendations: unknown[] }>({
    model: "reasoning", maxTokens: 900,
    messages: [{ role: "user", content: prompt }],
  });
  await logAiRun(supabase, { kind: "health_narrative", companyId: c.id, model: aiResult.model, inputSummary: `health ${result.overall}`, output: data });
  return { explanation: data.explanation, recommendations: (data.recommendations ?? []).slice(0, 3) };
}

// process-recording — SHARED AI pipeline for Fathom & Aircall (Section 5.4).
// Input: { source: 'fathom'|'aircall', externalId, title, url, attendeeEmails?,
//          phone?, transcript, summary, actionItems?, occurredAt?, durationSec? }
// The rep does nothing after a call except glance at the result.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { serviceClient, json } from "../_shared/supabase.ts";
import { callAIJson, logAiRun } from "../_shared/anthropic.ts";
import { matchEmails, matchPhone } from "../_shared/matching.ts";

const HUBSPOT_BASE = "https://api.hubapi.com";

serve(async (req) => {
  const supabase = serviceClient();
  const p = await req.json();

  // 1. Match company
  let companyId: string | null = null;
  let contactIds: string[] = [];
  if (p.attendeeEmails?.length) {
    const m = await matchEmails(supabase, p.attendeeEmails);
    companyId = m.companyIds[0] ?? null;
    contactIds = m.contactIds;
  }
  if (!companyId && p.phone) {
    const m = await matchPhone(supabase, p.phone);
    companyId = m.companyId;
    if (m.contactId) contactIds = [m.contactId];
  }
  if (!companyId) {
    await supabase.from("unmatched_recordings").upsert({
      provider: p.source, external_id: p.externalId, title: p.title,
      payload: p, attendee_emails: p.attendeeEmails ?? [], phone: p.phone ?? null, status: "pending",
    }, { onConflict: "provider,external_id" });
    return json({ ok: true, matched: false, queued: true });
  }

  const type = p.source === "aircall" ? "call" : "meeting";
  const occurredAt = p.occurredAt ?? new Date().toISOString();

  // 3. AI extraction pass → strict JSON
  const { data: extraction, result: aiResult } = await callAIJson<{
    risks: string[]; asks: string[]; decisions: string[]; sentiment: number;
    next_steps: string[]; renewal_signals: string[]; expansion_signals: string[];
  }>({
    model: "reasoning", maxTokens: 900,
    messages: [{ role: "user", content:
      `Transcript summary: ${p.summary ?? ""}\n\nTranscript: ${(p.transcript ?? "").slice(0, 12000)}\n\n` +
      `Return strict JSON: {"risks":[],"asks":[],"decisions":[],"sentiment":number(-1..1),"next_steps":[],"renewal_signals":[],"expansion_signals":[]}. ` +
      `Extract only what is stated; invent nothing.` }],
  });

  // 2. Timeline activity with summary + action items in meta
  const actionItems: string[] = p.actionItems ?? extraction.next_steps ?? [];
  const { data: activity } = await supabase.from("activities").insert({
    company_id: companyId, contact_ids: contactIds, type, direction: type === "call" ? "outbound" : null,
    title: p.title ?? (type === "call" ? "Call" : "Meeting"),
    snippet: p.summary ?? "", occurred_at: occurredAt,
    meta: { [p.source === "fathom" ? "fathomUrl" : "transcriptUrl"]: p.url, actionItems, risks: extraction.risks, asks: extraction.asks, decisions: extraction.decisions, sentiment: extraction.sentiment, durationSec: p.durationSec },
    source: p.source, source_id: p.externalId,
  }).select("id").single();

  // 4. One task per action item (assignee = account owner, due +3 business days)
  const { data: company } = await supabase.from("companies").select("owner_id, name, hubspot_company_id").eq("id", companyId).single();
  const due = businessDaysFromNow(3);
  for (const item of actionItems) {
    await supabase.from("tasks").insert({
      company_id: companyId, assignee_id: company?.owner_id, creator_id: company?.owner_id,
      title: item, due_date: due, origin: "ai_call", source_activity_id: activity?.id, priority: "normal",
    });
  }

  // 5. Open deal → rewrite next_steps + ai_summary + confidence + suggested_stage
  const { data: deals } = await supabase.from("deals").select("*").eq("company_id", companyId).eq("status", "open");
  const appliedChanges: Record<string, unknown> = {};
  for (const deal of deals ?? []) {
    const { data: dealAi } = await callAIJson<{ next_steps: string; ai_summary: string; confidence: number; suggested_stage: string | null; suggested_stage_reason: string | null }>({
      model: "reasoning", maxTokens: 500,
      messages: [{ role: "user", content:
        `Deal "${deal.name}" stage=${deal.stage} confidence=${deal.confidence}. Current stage list is a renewal/expansion pipeline. ` +
        `From this call — summary: ${p.summary}; extracted: ${JSON.stringify(extraction)} — return JSON: ` +
        `{"next_steps": string (≤3 imperative bullets, newline-separated), "ai_summary": string (≤80 words: state + momentum + blockers), "confidence": number(0..100), "suggested_stage": string|null (only if the transcript clearly implies a stage change — else null), "suggested_stage_reason": string|null}. Never fabricate.` }],
    });
    await supabase.from("deals").update({
      next_steps: dealAi.next_steps, ai_summary: dealAi.ai_summary, confidence: dealAi.confidence,
      suggested_stage: dealAi.suggested_stage, suggested_stage_reason: dealAi.suggested_stage_reason,
    }).eq("id", deal.id);
    appliedChanges[deal.id] = { next_steps: dealAi.next_steps, confidence: dealAi.confidence, suggested_stage: dealAi.suggested_stage };

    // HubSpot write-back (never writes stages)
    if (Deno.env.get("HUBSPOT_WRITEBACK") === "true" && deal.hubspot_deal_id) {
      await fetch(`${HUBSPOT_BASE}/crm/v3/objects/deals/${deal.hubspot_deal_id}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${Deno.env.get("HUBSPOT_PRIVATE_APP_TOKEN")}`, "content-type": "application/json" },
        body: JSON.stringify({ properties: { hs_next_step: dealAi.next_steps, description: dealAi.ai_summary } }),
      }).catch(() => {});
    }
  }

  // 6. Feed sentiment into rolling input + trigger health recompute for this company
  await supabase.functions.invoke("compute-health", { body: { companyId } }).catch(() => {});

  await logAiRun(supabase, { kind: "process_recording", companyId, model: aiResult.model, inputSummary: p.title, output: extraction, appliedChanges });
  return json({ ok: true, matched: true, companyId, tasksCreated: actionItems.length, dealsUpdated: (deals ?? []).length });
});

function businessDaysFromNow(n: number): string {
  const d = new Date();
  let added = 0;
  while (added < n) { d.setDate(d.getDate() + 1); const day = d.getDay(); if (day !== 0 && day !== 6) added++; }
  return d.toISOString().slice(0, 10);
}

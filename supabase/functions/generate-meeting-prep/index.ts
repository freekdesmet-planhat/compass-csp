// generate-meeting-prep — hourly (Section 5.3). For every calendar_events row
// starting in the next 24h matched to a company and not yet prepped (or stale),
// build a brief and an AI narrative. Marked stale elsewhere when new activity
// lands before the meeting.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { serviceClient, json } from "../_shared/supabase.ts";
import { callAI, logAiRun } from "../_shared/anthropic.ts";

const DAY = 86_400_000;

serve(async () => {
  const supabase = serviceClient();
  const now = Date.now();
  const { data: events } = await supabase.from("calendar_events").select("*")
    .not("company_id", "is", null)
    .gte("starts_at", new Date(now).toISOString())
    .lte("starts_at", new Date(now + DAY).toISOString());

  let built = 0;
  for (const ev of events ?? []) {
    const { data: existing } = await supabase.from("meeting_preps").select("id, stale").eq("calendar_event_id", ev.id).maybeSingle();
    if (existing && !existing.stale) continue;

    const [{ data: company }, { data: contacts }, { data: acts }, { data: tasks }, { data: deals }] = await Promise.all([
      supabase.from("companies").select("*").eq("id", ev.company_id).single(),
      supabase.from("contacts").select("*").in("id", ev.matched_contact_ids ?? []),
      supabase.from("activities").select("title, snippet, occurred_at, meta").eq("company_id", ev.company_id).order("occurred_at", { ascending: false }).limit(3),
      supabase.from("tasks").select("title, due_date").eq("company_id", ev.company_id).is("completed_at", null),
      supabase.from("deals").select("*").eq("company_id", ev.company_id).eq("status", "open"),
    ]);
    if (!company) continue;

    const renewalCountdown = company.renewal_date ? Math.ceil((Date.parse(company.renewal_date) - now) / DAY) : null;
    const overdue = (tasks ?? []).filter((t) => t.due_date && Date.parse(t.due_date) < now);
    const risks = (acts ?? []).flatMap((a) => a.meta?.risks ?? []);
    const asks = (acts ?? []).flatMap((a) => a.meta?.asks ?? []);

    const content = {
      accountSnapshot: { arr: company.arr, phase: company.phase, renewalCountdown, health: company.health_score, healthDelta: company.health_delta_wow, topDrag: null },
      openItems: [...overdue.map((t) => `Overdue: ${t.title}`), ...risks.map((r) => `Risk: ${r}`), ...asks.map((a) => `Ask: ${a}`)],
      recentTouchpoints: (acts ?? []).map((a) => `${a.title} — ${new Date(a.occurred_at).toLocaleDateString()}`),
      dealStatus: deals?.[0] ? `${deals[0].pipeline} — ${deals[0].stage}, ${deals[0].confidence}% confidence. Next: ${(deals[0].next_steps ?? "").split("\n")[0]}` : null,
      attendees: (contacts ?? []).map((c) => ({ name: `${c.first_name} ${c.last_name}`, role: c.contact_role, relationshipStrength: c.relationship_strength, lastContact: c.last_touch_at, note: c.is_champion ? "Internal champion" : null })),
      suggestedAgenda: [] as string[],
    };

    const objectives = (await supabase.from("success_plan_objectives").select("title, status").eq("company_id", ev.company_id)).data ?? [];
    const ai = await callAI({ model: "reasoning", maxTokens: 500, messages: [{ role: "user", content:
      `Build a meeting prep for "${company.name}". Snapshot: ${JSON.stringify(content.accountSnapshot)}. Open items: ${JSON.stringify(content.openItems)}. Deal: ${content.dealStatus}. Success plan objectives: ${JSON.stringify(objectives)}. ` +
      `Return a JSON object {"narrative": string (2-3 sentences), "agenda": string[] (3-5 bullets aligned to the objectives)}. Cite only provided data.` }] }).catch(() => null);
    let narrative = `${company.name} — ${renewalCountdown != null ? `renews in ${renewalCountdown}d` : "no renewal set"}, health ${company.health_score}.`;
    try { const parsed = JSON.parse((ai?.text ?? "{}").replace(/```json|```/g, "")); narrative = parsed.narrative ?? narrative; content.suggestedAgenda = parsed.agenda ?? []; } catch { /* keep default */ }

    await supabase.from("meeting_preps").upsert({
      company_id: ev.company_id, calendar_event_id: ev.id, content, narrative, generated_at: new Date().toISOString(), stale: false,
    }, { onConflict: "calendar_event_id" });
    if (ai) await logAiRun(supabase, { kind: "meeting_prep", companyId: ev.company_id, model: ai.model, inputSummary: ev.title, output: { narrative } });
    built++;
  }
  return json({ ok: true, built });
});

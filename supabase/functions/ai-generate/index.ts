// ai-generate — authenticated on-demand AI wrapper (Section 5.5) for the
// regenerate buttons: health narrative, meeting prep, note→snippet, email draft.
// Verifies the caller can see the company (RLS via the user client), rate-limits
// per user, temperature 0.2, cite-only-provided-data.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { serviceClient, userClient, json } from "../_shared/supabase.ts";
import { callAI, logAiRun } from "../_shared/anthropic.ts";

const RATE_PER_MIN = 20;
const hits = new Map<string, number[]>();

serve(async (req) => {
  const authHeader = req.headers.get("Authorization") ?? "";
  const asUser = userClient(authHeader);
  const { data: auth } = await asUser.auth.getUser();
  if (!auth?.user) return json({ error: "unauthorized" }, 401);

  // rate limit
  const now = Date.now();
  const recent = (hits.get(auth.user.id) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= RATE_PER_MIN) return json({ error: "rate_limited" }, 429);
  recent.push(now); hits.set(auth.user.id, recent);

  const { kind, companyId, payload } = await req.json();
  const supabase = serviceClient();

  if (companyId) {
    const { data: company } = await asUser.from("companies").select("id").eq("id", companyId).maybeSingle();
    if (!company) return json({ error: "forbidden" }, 403);
  }

  if (kind === "regenerate_health") { await supabase.functions.invoke("compute-health", { body: { companyId } }); return json({ ok: true, kind }); }
  if (kind === "regenerate_prep" && payload?.calendarEventId) {
    await supabase.from("meeting_preps").update({ stale: true }).eq("calendar_event_id", payload.calendarEventId);
    await supabase.functions.invoke("generate-meeting-prep", { body: {} });
    return json({ ok: true, kind });
  }

  const prompts: Record<string, string> = {
    summarise_note: `Summarise this note into a concise ≤40-word timeline snippet. Note:\n${payload?.text ?? ""}`,
    draft_email: `Draft a reply email given the thread and account context. Be concise and professional. Cite only provided facts.\nThread:\n${payload?.thread ?? ""}\nAccount context:\n${payload?.context ?? ""}`,
  };
  const prompt = prompts[kind];
  if (!prompt) return json({ error: "unknown_kind" }, 400);

  const ai = await callAI({ model: kind === "summarise_note" ? "fast" : "reasoning", maxTokens: 500, temperature: 0.2, messages: [{ role: "user", content: prompt }] });
  await logAiRun(supabase, { kind, companyId: companyId ?? null, model: ai.model, inputSummary: kind, output: { text: ai.text }, createdBy: auth.user.id });
  return json({ ok: true, text: ai.text });
});

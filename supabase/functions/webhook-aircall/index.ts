// webhook-aircall — receive Aircall webhooks (Section 6.6). Validate the token,
// on call.ended fetch call detail, match by phone, create a call activity, and
// (if transcription available) run the shared pipeline. Unmatched → admin queue.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { serviceClient, json } from "../_shared/supabase.ts";
import { fetchJson } from "../_shared/http.ts";
import { matchPhone } from "../_shared/matching.ts";

const AIRCALL_BASE = "https://api.aircall.io/v1";
const authHeader = () => "Basic " + btoa(`${Deno.env.get("AIRCALL_API_ID")}:${Deno.env.get("AIRCALL_API_TOKEN")}`);

serve(async (req) => {
  const supabase = serviceClient();
  const payload = await req.json().catch(() => ({}));

  // Validate token (Aircall sends a `token` field in the webhook body)
  if (Deno.env.get("AIRCALL_WEBHOOK_TOKEN") && payload.token !== Deno.env.get("AIRCALL_WEBHOOK_TOKEN")) {
    return json({ ok: false, error: "invalid token" }, 401);
  }

  const event: string = payload.event ?? "";
  if (event !== "call.ended") return json({ ok: true, ignored: event });

  const callId = payload.data?.id ?? payload.resource?.id;
  processCall(supabase, callId).catch((e) => console.error("aircall", e));
  return json({ ok: true, received: true });
});

async function processCall(supabase: ReturnType<typeof serviceClient>, callId: string) {
  const call = await fetchJson<{ call?: any }>(`${AIRCALL_BASE}/calls/${callId}`, { headers: { Authorization: authHeader() } }).then((r) => r.call ?? r).catch(() => null);
  if (!call) return;
  const rawPhone = call.raw_digits ?? call.number?.digits ?? "";
  const match = await matchPhone(supabase, rawPhone);

  if (!match.companyId) {
    await supabase.from("unmatched_recordings").upsert({
      provider: "aircall", external_id: String(callId), title: `Call ${rawPhone}`,
      payload: call, phone: rawPhone, status: "pending",
    }, { onConflict: "provider,external_id" });
    return;
  }

  // Create the call activity immediately
  await supabase.from("activities").upsert({
    company_id: match.companyId, contact_ids: match.contactId ? [match.contactId] : [],
    type: "call", direction: call.direction, title: `Aircall — ${call.direction ?? "call"}`,
    snippet: `${Math.round((call.duration ?? 0) / 60)} min call`, occurred_at: new Date((call.ended_at ?? call.started_at ?? Date.now() / 1000) * 1000).toISOString(),
    meta: { transcriptUrl: call.recording, durationSec: call.duration, phone: rawPhone },
    source: "aircall", source_id: String(callId),
  }, { onConflict: "source,source_id" });

  // If the AI add-on is enabled, transcription may take a few minutes — try it.
  const transcription = await fetchJson<{ transcription?: any }>(`${AIRCALL_BASE}/calls/${callId}/transcription`, { headers: { Authorization: authHeader() } }).then((r) => r.transcription).catch(() => null);
  if (transcription?.content) {
    await supabase.functions.invoke("process-recording", {
      body: {
        source: "aircall", externalId: String(callId), title: `Aircall — ${call.direction ?? "call"}`,
        url: call.recording, phone: rawPhone, transcript: transcription.content,
        summary: transcription.summary ?? "", durationSec: call.duration,
        occurredAt: new Date((call.ended_at ?? Date.now() / 1000) * 1000).toISOString(),
      },
    });
  }
}

// webhook-fathom — receive Fathom recording webhooks (Section 6.5). Verify the
// secret header, respond 200 fast, hand the payload to the shared pipeline.
// Also handles {mode:'backfill'} from the hourly cron safety-net poll.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { serviceClient, json } from "../_shared/supabase.ts";
import { fetchJson } from "../_shared/http.ts";

const FATHOM_BASE = "https://api.fathom.ai/external/v1";

serve(async (req) => {
  const supabase = serviceClient();
  const bodyText = await req.text();
  const payload = bodyText ? JSON.parse(bodyText) : {};

  // Backfill / safety-net poll from cron
  if (payload.mode === "backfill") {
    const cursor = (await supabase.from("integration_connections").select("sync_cursor").eq("provider", "fathom").is("user_id", null).maybeSingle()).data?.sync_cursor ?? {};
    const since = cursor.created_after ?? new Date(Date.now() - 86_400_000).toISOString();
    const meetings = await fetchJson<{ items?: any[] }>(`${FATHOM_BASE}/meetings?created_after=${encodeURIComponent(since)}&include_transcript=true&include_summary=true&include_action_items=true`, { headers: { "X-Api-Key": Deno.env.get("FATHOM_API_KEY") ?? "" } }).catch(() => ({ items: [] }));
    for (const m of meetings.items ?? []) await dispatch(supabase, m);
    await supabase.from("integration_connections").update({ sync_cursor: { created_after: new Date().toISOString() }, last_sync_at: new Date().toISOString() }).eq("provider", "fathom").is("user_id", null);
    return json({ ok: true, mode: "backfill", processed: (meetings.items ?? []).length });
  }

  // Verify webhook secret
  const secret = req.headers.get("x-fathom-secret") ?? req.headers.get("x-webhook-secret");
  if (Deno.env.get("FATHOM_WEBHOOK_SECRET") && secret !== Deno.env.get("FATHOM_WEBHOOK_SECRET")) {
    return json({ ok: false, error: "invalid secret" }, 401);
  }

  // Respond fast; process async (fire-and-forget)
  dispatch(supabase, payload).catch((e) => console.error("fathom dispatch", e));
  return json({ ok: true, received: true });
});

async function dispatch(supabase: ReturnType<typeof serviceClient>, m: any) {
  const attendees: string[] = (m.attendees ?? m.invitees ?? []).map((a: any) => a.email ?? a).filter(Boolean);
  await supabase.functions.invoke("process-recording", {
    body: {
      source: "fathom", externalId: String(m.id ?? m.recording_id), title: m.title ?? m.meeting_title,
      url: m.url ?? m.share_url, attendeeEmails: attendees,
      transcript: m.transcript?.text ?? m.transcript, summary: m.summary?.text ?? m.summary,
      actionItems: (m.action_items ?? []).map((a: any) => a.text ?? a), occurredAt: m.started_at ?? m.created_at,
    },
  });
}

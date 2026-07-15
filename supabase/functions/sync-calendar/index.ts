// sync-calendar — per-user poll every 15 min (Section 6.4). Initial window
// now-7d..now+30d, then incremental via syncToken (410 GONE → full resync).
// Past events auto-log a meeting activity unless a Fathom recording matched.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { serviceClient, json } from "../_shared/supabase.ts";
import { fetchWithRetry } from "../_shared/http.ts";
import { getGoogleAccessToken } from "../_shared/google.ts";
import { matchEmails } from "../_shared/matching.ts";
import { getCursor, setCursor, withSyncRun } from "../_shared/sync.ts";

const CAL = "https://www.googleapis.com/calendar/v3";
const DAY = 86_400_000;

serve(async () => {
  const supabase = serviceClient();
  const { data: connections } = await supabase.from("integration_connections").select("*").eq("provider", "google").eq("status", "active").not("user_id", "is", null);
  let totalEvents = 0;

  for (const conn of connections ?? []) {
    await withSyncRun(supabase, "google", conn.id, async () => {
      const accessToken = await getGoogleAccessToken(supabase, conn);
      const auth = { Authorization: `Bearer ${accessToken}` };
      const cursor = await getCursor(supabase, conn.id);
      let url = cursor.calSyncToken
        ? `${CAL}/calendars/primary/events?singleEvents=true&syncToken=${cursor.calSyncToken}`
        : `${CAL}/calendars/primary/events?singleEvents=true&orderBy=startTime&timeMin=${new Date(Date.now() - 7 * DAY).toISOString()}&timeMax=${new Date(Date.now() + 30 * DAY).toISOString()}`;

      let res = await fetchWithRetry(url, { headers: auth });
      if (res.status === 410) { await setCursor(supabase, conn.id, { ...cursor, calSyncToken: undefined }); return { events: 0, resynced: true }; }
      const data = await res.json();
      let count = 0;
      for (const ev of data.items ?? []) {
        if (ev.status === "cancelled") continue;
        const attendees = (ev.attendees ?? []).map((a: any) => a.email).filter(Boolean);
        const match = await matchEmails(supabase, attendees);
        const companyId = match.companyIds[0] ?? null;
        const startsAt = ev.start?.dateTime ?? ev.start?.date;
        const endsAt = ev.end?.dateTime ?? ev.end?.date;
        const { data: row } = await supabase.from("calendar_events").upsert({
          company_id: companyId, connection_id: conn.id, gcal_event_id: ev.id, ical_uid: ev.iCalUID,
          title: ev.summary, starts_at: startsAt, ends_at: endsAt, attendee_emails: attendees,
          organizer_email: ev.organizer?.email, meet_link: ev.hangoutLink, status: ev.status,
          matched_contact_ids: match.contactIds, source: "gcal", source_id: ev.id,
        }, { onConflict: "gcal_event_id" }).select("id, logged_activity_id, fathom_recording_id").single();

        // Past event → auto-log a meeting activity unless a Fathom recording linked it.
        if (companyId && row && endsAt && Date.parse(endsAt) < Date.now() && !row.logged_activity_id && !row.fathom_recording_id) {
          const { data: act } = await supabase.from("activities").upsert({
            company_id: companyId, contact_ids: match.contactIds, user_id: conn.user_id, type: "meeting",
            title: ev.summary ?? "Meeting", snippet: "Auto-logged from calendar", occurred_at: endsAt,
            source: "gcal", source_id: ev.id, meta: {},
          }, { onConflict: "source,source_id" }).select("id").single();
          if (act) await supabase.from("calendar_events").update({ logged_activity_id: act.id }).eq("id", row.id);
        }
        count++;
      }
      await setCursor(supabase, conn.id, { ...cursor, calSyncToken: data.nextSyncToken });
      totalEvents += count;
      return { events: count };
    });
  }
  return json({ ok: true, connections: (connections ?? []).length, events: totalEvents });
});

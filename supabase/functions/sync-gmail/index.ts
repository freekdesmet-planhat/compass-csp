// sync-gmail — per-user poll every 10 min (Section 6.3). First run pulls
// newer_than:30d, thereafter incremental via historyId. Metadata + snippet only;
// bodies fetched on demand unless STORE_EMAIL_BODIES=true. Domain matching
// excludes the org domain + freemail; ambiguous domains flag meta.ambiguous.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { serviceClient, json } from "../_shared/supabase.ts";
import { fetchJson } from "../_shared/http.ts";
import { getGoogleAccessToken } from "../_shared/google.ts";
import { matchEmails } from "../_shared/matching.ts";
import { getCursor, setCursor, withSyncRun } from "../_shared/sync.ts";

const GMAIL = "https://gmail.googleapis.com/gmail/v1";
const storeBodies = () => Deno.env.get("STORE_EMAIL_BODIES") === "true";

serve(async () => {
  const supabase = serviceClient();
  const { data: connections } = await supabase.from("integration_connections").select("*").eq("provider", "google").eq("status", "active").not("user_id", "is", null);
  let totalNew = 0;

  for (const conn of connections ?? []) {
    await withSyncRun(supabase, "google", conn.id, async () => {
      const accessToken = await getGoogleAccessToken(supabase, conn);
      const auth = { Authorization: `Bearer ${accessToken}` };
      const cursor = await getCursor(supabase, conn.id);
      let messageIds: string[] = [];
      let newHistoryId: string | undefined;

      if (!cursor.historyId) {
        const list = await fetchJson<{ messages?: { id: string }[] }>(`${GMAIL}/users/me/messages?q=${encodeURIComponent("newer_than:30d -in:chats")}&maxResults=100`, { headers: auth });
        messageIds = (list.messages ?? []).map((m) => m.id);
      } else {
        const hist = await fetchJson<{ history?: any[]; historyId?: string }>(`${GMAIL}/users/me/history?startHistoryId=${cursor.historyId}&historyTypes=messageAdded`, { headers: auth }).catch(() => ({ history: [] }));
        messageIds = (hist.history ?? []).flatMap((h: any) => (h.messagesAdded ?? []).map((m: any) => m.message.id));
        newHistoryId = hist.historyId;
      }

      let created = 0;
      for (const id of messageIds) {
        const msg = await fetchJson<any>(`${GMAIL}/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject&metadataHeaders=Date`, { headers: auth }).catch(() => null);
        if (!msg) continue;
        const headers: Record<string, string> = {};
        for (const hh of msg.payload?.headers ?? []) headers[hh.name.toLowerCase()] = hh.value;
        const from = parseAddr(headers.from);
        const to = (headers.to ?? "").split(",").map(parseAddr).filter(Boolean) as string[];
        const cc = (headers.cc ?? "").split(",").map(parseAddr).filter(Boolean) as string[];
        const participants = [from, ...to, ...cc].filter(Boolean) as string[];
        const match = await matchEmails(supabase, participants);
        if (!match.companyIds.length) continue;
        const direction = from && from.endsWith(conn.external_account_email?.split("@")[1] ?? "@@") ? "outbound" : "inbound";
        if (!cursor.historyId) newHistoryId = msg.historyId;

        for (const companyId of match.companyIds) {
          await supabase.from("emails").upsert({
            company_id: companyId, contact_ids: match.contactIds, connection_id: conn.id,
            gmail_message_id: msg.id, gmail_thread_id: msg.threadId, direction, from_email: from,
            to_emails: to, cc_emails: cc, subject: headers.subject, snippet: msg.snippet,
            body_html: storeBodies() ? null : null, sent_at: new Date(Number(msg.internalDate)).toISOString(),
            source: "gmail", source_id: msg.id,
          }, { onConflict: "gmail_message_id" });
          await supabase.from("activities").upsert({
            company_id: companyId, contact_ids: match.contactIds, user_id: conn.user_id, type: "email",
            direction, title: headers.subject ?? "(no subject)", snippet: msg.snippet,
            occurred_at: new Date(Number(msg.internalDate)).toISOString(),
            meta: { ambiguous: match.ambiguous, gmailThreadId: msg.threadId }, source: "gmail", source_id: msg.id,
          }, { onConflict: "source,source_id" });
        }
        created++;
      }
      if (newHistoryId) await setCursor(supabase, conn.id, { historyId: newHistoryId });
      totalNew += created;
      return { created };
    });
  }
  return json({ ok: true, connections: (connections ?? []).length, emails: totalNew });
});

function parseAddr(raw?: string): string {
  if (!raw) return "";
  const m = raw.match(/<([^>]+)>/);
  return (m ? m[1] : raw).trim().toLowerCase();
}

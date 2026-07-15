// send-gmail — compose & send from the platform (Section 6.3). Builds an RFC
// 2822 message, base64url-encodes it, POSTs to messages/send (threadId for
// replies), and logs the activity immediately (next poll dedupes by message id).
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { serviceClient, userClient, json } from "../_shared/supabase.ts";
import { fetchJson } from "../_shared/http.ts";
import { getGoogleAccessToken } from "../_shared/google.ts";

const GMAIL = "https://gmail.googleapis.com/gmail/v1";

serve(async (req) => {
  const authHeader = req.headers.get("Authorization") ?? "";
  const asUser = userClient(authHeader);
  const { data: auth } = await asUser.auth.getUser();
  if (!auth?.user) return json({ error: "unauthorized" }, 401);

  const supabase = serviceClient();
  const { companyId, to, cc, subject, bodyHtml, threadId } = await req.json();

  // Verify the caller can see the company (RLS via user client).
  const { data: company } = await asUser.from("companies").select("id, name").eq("id", companyId).maybeSingle();
  if (!company) return json({ error: "forbidden" }, 403);

  const { data: conn } = await supabase.from("integration_connections").select("*").eq("provider", "google").eq("user_id", auth.user.id).maybeSingle();
  if (!conn) return json({ error: "gmail_not_connected" }, 400);
  const accessToken = await getGoogleAccessToken(supabase, conn);

  const raw = buildRfc2822({ from: conn.external_account_email ?? auth.user.email!, to, cc, subject, bodyHtml });
  const encoded = base64url(raw);
  const sent = await fetchJson<{ id: string; threadId: string }>(`${GMAIL}/users/me/messages/send`, {
    method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify(threadId ? { raw: encoded, threadId } : { raw: encoded }),
  });

  // Log immediately
  await supabase.from("emails").upsert({
    company_id: companyId, connection_id: conn.id, gmail_message_id: sent.id, gmail_thread_id: sent.threadId,
    direction: "outbound", from_email: conn.external_account_email, to_emails: Array.isArray(to) ? to : [to],
    cc_emails: cc ?? [], subject, body_html: bodyHtml, sent_at: new Date().toISOString(), source: "gmail", source_id: sent.id,
  }, { onConflict: "gmail_message_id" });
  await supabase.from("activities").insert({
    company_id: companyId, user_id: auth.user.id, type: "email", direction: "outbound",
    title: subject, snippet: stripHtml(bodyHtml).slice(0, 140), occurred_at: new Date().toISOString(),
    source: "gmail", source_id: sent.id,
  });

  return json({ ok: true, messageId: sent.id });
});

function buildRfc2822({ from, to, cc, subject, bodyHtml }: { from: string; to: string | string[]; cc?: string[]; subject: string; bodyHtml: string }): string {
  const toList = Array.isArray(to) ? to.join(", ") : to;
  const lines = [`From: ${from}`, `To: ${toList}`];
  if (cc?.length) lines.push(`Cc: ${cc.join(", ")}`);
  lines.push(`Subject: ${subject}`, "MIME-Version: 1.0", 'Content-Type: text/html; charset="UTF-8"', "", bodyHtml);
  return lines.join("\r\n");
}
function base64url(s: string): string { return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function stripHtml(s: string): string { return (s ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(); }

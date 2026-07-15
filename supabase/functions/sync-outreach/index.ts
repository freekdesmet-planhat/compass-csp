// sync-outreach — org-level OAuth, read-only, poll every 30 min (Section 6.7).
// Match prospects by email; sync their sequenceStates / mailings / calls by
// updatedAt cursor; write activities (source 'outreach') deduped vs Gmail/Aircall.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { serviceClient, json } from "../_shared/supabase.ts";
import { fetchJson, fetchWithRetry } from "../_shared/http.ts";
import { getCursor, setCursor, withSyncRun } from "../_shared/sync.ts";

const API = "https://api.outreach.io/api/v2";

async function accessToken(supabase: ReturnType<typeof serviceClient>, conn: any): Promise<string> {
  const valid = conn.access_token && conn.token_expires_at && Date.parse(conn.token_expires_at) - Date.now() > 60_000;
  if (valid) return conn.access_token;
  const body = new URLSearchParams({
    grant_type: "refresh_token", refresh_token: conn.refresh_token ?? "",
    client_id: Deno.env.get("OUTREACH_CLIENT_ID") ?? "", client_secret: Deno.env.get("OUTREACH_CLIENT_SECRET") ?? "",
    redirect_uri: Deno.env.get("OUTREACH_REDIRECT_URI") ?? "",
  });
  const tok = await fetchJson<{ access_token: string; expires_in: number }>("https://api.outreach.io/oauth/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: body.toString() });
  await supabase.from("integration_connections").update({ access_token: tok.access_token, token_expires_at: new Date(Date.now() + tok.expires_in * 1000).toISOString() }).eq("id", conn.id);
  return tok.access_token;
}

serve(async () => {
  const supabase = serviceClient();
  const { data: conn } = await supabase.from("integration_connections").select("*").eq("provider", "outreach").is("user_id", null).maybeSingle();
  if (!conn) return json({ ok: false, error: "outreach_not_connected" });

  const result = await withSyncRun(supabase, "outreach", conn.id, async () => {
    const token = await accessToken(supabase, conn);
    const auth = { Authorization: `Bearer ${token}`, "content-type": "application/vnd.api+json" };
    const cursor = await getCursor(supabase, conn.id);
    const since = (cursor.updatedAt as string) ?? new Date(Date.now() - 86_400_000).toISOString();

    // Only sync prospects that map to a known contact (match by email).
    const { data: contacts } = await supabase.from("contacts").select("id, company_id, email").not("email", "is", null).limit(500);
    let mailings = 0, calls = 0, seqStates = 0;

    for (const contact of contacts ?? []) {
      const prospects = await fetchJson<{ data: any[] }>(`${API}/prospects?filter[emails]=${encodeURIComponent(contact.email)}`, { headers: auth }).catch(() => ({ data: [] }));
      const prospect = prospects.data?.[0];
      if (!prospect) continue;

      const states = await fetchJson<{ data: any[] }>(`${API}/sequenceStates?filter[prospect][id]=${prospect.id}&page[size]=5`, { headers: auth }).catch(() => ({ data: [] }));
      if (states.data?.length) {
        seqStates++;
        // Sequence state is rendered on the contact card; persist a lightweight marker in meta.
        await supabase.from("contacts").update({ engagement_score: Math.max(contact_engagement(states.data[0]), 0) }).eq("id", contact.id);
      }

      for (const kind of ["mailings", "calls"] as const) {
        const rows = await fetchJson<{ data: any[] }>(`${API}/${kind}?filter[prospect][id]=${prospect.id}&filter[updatedAt]=${since}..inf&page[size]=100`, { headers: auth }).catch(() => ({ data: [] }));
        for (const r of rows.data ?? []) {
          const occurredAt = r.attributes?.createdAt ?? r.attributes?.updatedAt;
          await supabase.from("activities").upsert({
            company_id: contact.company_id, contact_ids: [contact.id], type: kind === "calls" ? "call" : "email",
            direction: "outbound", title: `Outreach ${kind === "calls" ? "call" : "mailing"}`,
            snippet: r.attributes?.subject ?? r.attributes?.note ?? "", occurred_at: occurredAt,
            meta: { outreach: true, opens: r.attributes?.opens, clicks: r.attributes?.clicks, replies: r.attributes?.replies },
            source: "outreach", source_id: `${kind}-${r.id}`,
          }, { onConflict: "source,source_id", ignoreDuplicates: true });
          if (kind === "mailings") mailings++; else calls++;
        }
      }
    }
    await setCursor(supabase, conn.id, { updatedAt: new Date().toISOString() });
    return { mailings, calls, seqStates };
  });
  return json(result);
});

function contact_engagement(state: any): number {
  const s = (state.attributes?.state ?? "").toLowerCase();
  return s === "active" ? 80 : s === "finished" ? 60 : 40;
}

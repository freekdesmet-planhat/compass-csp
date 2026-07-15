// Google OAuth token refresh for per-user Gmail/Calendar sync.
// Access tokens are short-lived; we store the long-lived refresh_token in
// integration_connections and exchange it for an access token on demand.
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fetchWithRetry } from "./http.ts";

const TOKEN_URL = "https://oauth2.googleapis.com/token";

// Google client id/secret live in Supabase Auth provider config, but the
// refresh grant still needs them. We accept them from env as GOOGLE_CLIENT_ID /
// GOOGLE_CLIENT_SECRET (set these as edge secrets mirroring the Auth config).
// DEVIATION: prompt says client id/secret live in Auth config, not env. Supabase
// does not expose them to functions, so they must also be provided as secrets
// here for the refresh_token grant to work.
export function googleCreds(): { clientId: string; clientSecret: string } {
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID") ?? "";
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "";
  if (!clientId || !clientSecret) {
    throw new Error("Missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET edge secrets");
  }
  return { clientId, clientSecret };
}

export interface GoogleTokenResult {
  accessToken: string;
  expiresAt: string; // ISO
}

export async function refreshAccessToken(refreshToken: string): Promise<GoogleTokenResult> {
  const { clientId, clientSecret } = googleCreds();
  const res = await fetchWithRetry(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Google token refresh ${res.status}: ${JSON.stringify(body)}`);
  const expiresAt = new Date(Date.now() + (body.expires_in ?? 3600) * 1000).toISOString();
  return { accessToken: body.access_token as string, expiresAt };
}

// Return a valid access token for a connection row, refreshing + persisting when
// the cached token is missing or within 60s of expiry.
export async function getGoogleAccessToken(
  supabase: SupabaseClient,
  connection: {
    id: string;
    access_token: string | null;
    refresh_token: string | null;
    token_expires_at: string | null;
  },
): Promise<string> {
  const stillValid =
    connection.access_token &&
    connection.token_expires_at &&
    Date.parse(connection.token_expires_at) - Date.now() > 60_000;
  if (stillValid) return connection.access_token!;

  if (!connection.refresh_token) {
    throw new Error(`Connection ${connection.id} has no refresh_token`);
  }
  const { accessToken, expiresAt } = await refreshAccessToken(connection.refresh_token);
  await supabase
    .from("integration_connections")
    .update({ access_token: accessToken, token_expires_at: expiresAt })
    .eq("id", connection.id);
  return accessToken;
}

// invite-user — admin-only: invite a teammate by email (magic-link) and create
// their profile row. The browser can't create auth users (needs the service-role
// key), so this runs server-side. Caller must be an authenticated admin.
//
// Flow: verify caller is admin (their JWT) → auth.admin.inviteUserByEmail (creates
// the auth user + sends the invite email) → upsert the profiles row (this project
// has no auth→profiles trigger, so we create it here).
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { serviceClient, userClient, json, CORS_HEADERS } from "../_shared/supabase.ts";

const ROLES = ["csm", "manager", "admin"];
const SEGMENTS = ["scaled", "mid_touch", "enterprise"];
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  // ── caller must be an authenticated admin ──────────────────────────────────
  const authHeader = req.headers.get("Authorization") ?? "";
  const asUser = userClient(authHeader);
  const { data: auth } = await asUser.auth.getUser();
  if (!auth?.user) return json({ error: "unauthorized" }, 401);
  const { data: me } = await asUser.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
  if (me?.role !== "admin") return json({ error: "forbidden — admin only" }, 403);

  // ── validate input ─────────────────────────────────────────────────────────
  const body = await req.json().catch(() => ({}));
  const email = String(body?.email ?? "").trim().toLowerCase();
  const fullName = String(body?.fullName ?? "").trim();
  const role = ROLES.includes(body?.role) ? body.role : "csm";
  const segment = SEGMENTS.includes(body?.segment) ? body.segment : null;
  const managerId = body?.managerId ? String(body.managerId) : null;
  const redirectTo = typeof body?.redirectTo === "string" && body.redirectTo ? body.redirectTo : undefined;
  // User-facing failures return 200 {ok:false,error} so the browser (functions
  // .invoke treats non-2xx as an opaque error) can show the exact message.
  if (!EMAIL_RE.test(email)) return json({ ok: false, error: "A valid email is required" }, 200);

  const admin = serviceClient();

  // ── 1. invite (creates the auth user + sends the magic-link email) ─────────
  const { data: invited, error: invErr } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { full_name: fullName },
    redirectTo,
  });
  if (invErr) {
    const msg = /already|registered|exists/i.test(invErr.message) ? "A user with that email already exists" : invErr.message;
    return json({ ok: false, error: msg }, 200);
  }
  const userId = invited?.user?.id;
  if (!userId) return json({ ok: false, error: "invite returned no user id" }, 200);

  // ── 2. create the profile row (no auth→profiles trigger in this project) ────
  const { error: pErr } = await admin.from("profiles").upsert(
    { id: userId, email, full_name: fullName || null, role, segment, manager_id: managerId, is_active: true },
    { onConflict: "id" },
  );
  if (pErr) return json({ ok: false, error: `invite sent but profile create failed: ${pErr.message}` }, 200);

  return json({ ok: true, userId, email, role });
});

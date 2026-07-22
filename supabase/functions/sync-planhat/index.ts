// sync-planhat — org-level outbound sync from Planhat (Section 6.2 style).
// Authenticates to Planhat with a service-side Bearer token (PLANHAT_API_TOKEN),
// never exposed to the client. Idempotent: companies upsert on (source,source_id)
// with source='planhat', source_id=<planhat _id> — the SAME convention the
// one-time scripts/migrate-planhat.ts uses, so backfill + live sync converge.
//
// Cursor: we page companies newest-first and early-stop at the high-water mark
// stored in integration_connections.sync_cursor.since. We do NOT trust a
// server-side date filter (Planhat silently ignored one) — we verify the sort
// order and fall back to a full scan if it wasn't honored.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { serviceClient, json } from "../_shared/supabase.ts";
import { fetchWithRetry } from "../_shared/http.ts";
import { getCursor, setCursor, withSyncRun } from "../_shared/sync.ts";

// This tenant lives on Planhat's demo cluster, not the production api host.
const BASE = "https://api.planhatdemo.com";
// .trim() defends against the classic bad-paste (trailing newline/space) when
// the secret is set. The value is NEVER logged — see redact()/assertValidToken().
const token = () => (Deno.env.get("PLANHAT_API_TOKEN") ?? "").trim();
const authHeaders = () => ({ Authorization: `Bearer ${token()}`, "content-type": "application/json" });

// Strip any occurrence of the token from a message before it can reach the HTTP
// response or sync_runs.error — Deno's fetch echoes invalid header values (i.e.
// the raw Bearer token) verbatim in the exception it throws.
function redact(msg: string): string {
  const t = token();
  return t ? msg.split(t).join("[REDACTED]") : msg;
}

// Fail fast, with a value-free message, if the secret is missing or malformed.
// A token with control chars/newlines would otherwise crash fetch and leak.
function assertValidToken(): void {
  const t = token();
  if (!t) throw new Error("PLANHAT_API_TOKEN not set");
  if (/[\x00-\x1f\x7f]/.test(t)) {
    throw new Error("PLANHAT_API_TOKEN contains invalid characters (newline/control chars) — re-set the secret cleanly");
  }
}

// One page of a Planhat list endpoint. Planhat returns either a bare array or
// `{ data: [...] }`. Errors are scrubbed of the bearer token before rethrow.
async function planhatPage(path: string, params: Record<string, string>, limit: number, offset: number): Promise<any[]> {
  const u = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  u.searchParams.set("limit", String(limit));
  u.searchParams.set("offset", String(offset));
  let res: Response;
  try {
    res = await fetchWithRetry(u.toString(), { headers: authHeaders() });
  } catch (err) {
    // Scrub in case the failure message embeds the header value.
    throw new Error(redact(err instanceof Error ? err.message : String(err)));
  }
  if (!res.ok) throw new Error(redact(`Planhat ${res.status} ${res.statusText} for ${path}: ${(await res.text()).slice(0, 300)}`));
  const page = await res.json();
  return Array.isArray(page) ? page : page?.data ?? [];
}

// Planhat company objects carry `updatedAt` (verified via probe); a few fallback
// names are kept for other object types. `sort=-updatedAt` IS honored by Planhat,
// which is what makes the cursor early-stop below safe.
const SORT_FIELD = "updatedAt";
const TS_FIELDS = ["updatedAt", "lastUpdated", "lastUpdate", "updated_at"];
function readTs(co: any): string | null {
  for (const f of TS_FIELDS) if (co && co[f]) return String(co[f]);
  return null;
}

// Page a Planhat list newest-first (sort=-updatedAt) and collect records changed
// since `since`. We VERIFY the sort is honored; if Planhat ignores it we keep
// scanning every page (still returning only changed records) instead of risking
// an early-stop that silently skips updates. Shared by the companies + contacts
// passes so both behave identically.
async function fetchUpdated(
  path: string,
  since: string,
): Promise<{ changed: Map<string, any>; scanned: number; sortHonored: boolean; maxTs: string }> {
  const limit = 2000;
  let offset = 0;
  let sortHonored = true;
  let prevTs: string | null = null;
  let scanned = 0;
  let maxTs = since;
  const changed = new Map<string, any>(); // planhatId -> record (deduped)

  scan: for (;;) {
    const page = await planhatPage(path, { sort: `-${SORT_FIELD}` }, limit, offset);
    for (const rec of page) {
      scanned++;
      const ts = readTs(rec);
      if (ts && (!maxTs || ts > maxTs)) maxTs = ts;
      // With -updatedAt the timestamps should be non-increasing.
      if (sortHonored && prevTs && ts && ts > prevTs) sortHonored = false;
      if (ts) prevTs = ts;

      const isChanged = !since || !ts || ts > since;
      if (isChanged) {
        const id = String(rec._id ?? rec.id ?? "");
        if (id) changed.set(id, rec);
      } else if (sortHonored) {
        // Sorted descending and we've reached rows at/older than the cursor —
        // everything beyond is older, so stop paging.
        break scan;
      }
    }
    if (page.length < limit) break;
    offset += limit;
  }
  return { changed, scanned, sortHonored, maxTs };
}

// Persist a changed set to a table keyed on (source='planhat', source_id). Per
// chunk: ONE select to find existing ids, ONE bulk insert for new rows, and a
// per-row update only for rows that already exist (empty on a backfill). This
// keeps a full backfill within the edge runtime's wall-clock limit — the naive
// per-row select+insert did not. `buildPatch` returns the column values WITHOUT
// source/source_id, or null to skip the record (e.g. an orphan contact).
async function writeChanged(
  supabase: ReturnType<typeof serviceClient>,
  table: string,
  changed: Map<string, any>,
  buildPatch: (rec: any) => Record<string, unknown> | null,
): Promise<{ inserted: number; updated: number; skipped: number }> {
  const rows: { sid: string; patch: Record<string, unknown> }[] = [];
  let skipped = 0;
  for (const [sid, rec] of changed) {
    const patch = buildPatch(rec);
    if (!patch) { skipped++; continue; }
    rows.push({ sid, patch });
  }

  let inserted = 0;
  let updated = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const sids = chunk.map((r) => r.sid);
    const { data: existing, error: selErr } = await supabase
      .from(table).select("id, source_id").eq("source", "planhat").in("source_id", sids);
    if (selErr) throw new Error(`${table} select batch [${i}]: ${selErr.message}`);
    const idBySid = new Map<string, string>();
    for (const r of existing ?? []) idBySid.set(String(r.source_id), r.id as string);

    const toInsert = chunk.filter((r) => !idBySid.has(r.sid))
      .map((r) => ({ ...r.patch, source: "planhat", source_id: r.sid }));
    if (toInsert.length) {
      const { error } = await supabase.from(table).insert(toInsert);
      if (error) throw new Error(`${table} insert batch [${i}]: ${error.message}`);
      inserted += toInsert.length;
    }
    for (const r of chunk) {
      const id = idBySid.get(r.sid);
      if (!id) continue;
      const { error } = await supabase.from(table).update(r.patch).eq("id", id);
      if (error) throw new Error(`${table} update (planhat ${r.sid}): ${error.message}`);
      updated++;
    }
  }
  return { inserted, updated, skipped };
}

serve(async () => {
  try {
    assertValidToken();
  } catch (err) {
    // Config error — message is value-free by construction. No sync_run needed.
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
  const supabase = serviceClient();

  // Resolve (or create) the org-level Planhat connection row for cursor storage.
  let { data: conn } = await supabase
    .from("integration_connections")
    .select("id, sync_cursor")
    .eq("provider", "planhat")
    .is("user_id", null)
    .maybeSingle();
  if (!conn) {
    conn = (await supabase
      .from("integration_connections")
      .insert({ provider: "planhat", status: "active", sync_cursor: {} })
      .select("id, sync_cursor")
      .single()).data!;
  }

  const result = await withSyncRun(supabase, "planhat", conn.id, async () => {
    const cursor = await getCursor(supabase, conn!.id);
    const since = (cursor.since as string) ?? "";             // companies high-water mark
    const contactsSince = (cursor.contactsSince as string) ?? ""; // endusers high-water mark
    const usersSince = (cursor.usersSince as string) ?? "";       // users high-water mark

    // ── Companies ──────────────────────────────────────────────────────────
    const co = await fetchUpdated("/companies", since);
    const coRes = await writeChanged(supabase, "companies", co.changed, (c) => {
      const patch: Record<string, unknown> = {
        name: c.name,
        arr: c.arr != null ? Number(c.arr) : undefined,
        mrr: c.mrr != null ? Number(c.mrr) : undefined,
        domains: Array.isArray(c.domains) ? c.domains : c.domain ? [c.domain] : undefined,
      };
      // Drop undefined keys so we never overwrite existing values with null.
      for (const k of Object.keys(patch)) if (patch[k] === undefined) delete patch[k];
      return patch;
    });

    // ── Contacts (Planhat endusers) ──────────────────────────────────────────
    // Same select-then-update/insert + strict errors + updatedAt cursor. A
    // contact's company_id is NOT NULL, so an enduser whose parent company isn't
    // in Compass yet is skipped (counted) rather than written with a null FK.
    const eu = await fetchUpdated("/endusers", contactsSince);
    let companyByPlanhatId = new Map<string, string>();
    if (eu.changed.size) {
      // planhat company _id -> compass company uuid (built once, only when needed).
      const { data: comps, error: compErr } = await supabase
        .from("companies").select("id, source_id").eq("source", "planhat");
      if (compErr) throw new Error(`contacts: company map load: ${compErr.message}`);
      for (const r of comps ?? []) if (r.source_id) companyByPlanhatId.set(String(r.source_id), r.id as string);
    }
    const euRes = await writeChanged(supabase, "contacts", eu.changed, (e) => {
      const companyId = companyByPlanhatId.get(String(e.companyId ?? e.company?._id ?? e.company ?? ""));
      if (!companyId) return null; // orphan — parent company not synced
      const patch: Record<string, unknown> = {
        company_id: companyId,
        first_name: e.firstName ?? undefined,
        last_name: e.lastName ?? undefined,
        email: e.email ?? undefined,
        other_emails: Array.isArray(e.otherEmails) ? e.otherEmails : undefined,
        phone: e.phone ?? undefined,
        title: e.position ?? undefined,
        linkedin_url: e.linkedInUrl ?? e.linkedinUrl ?? undefined,
        last_active_at: e.lastActive ? new Date(e.lastActive).toISOString() : undefined,
        archived: typeof e.archived === "boolean" ? e.archived : undefined,
      };
      for (const k of Object.keys(patch)) if (patch[k] === undefined) delete patch[k];
      return patch;
    });

    // ── Users (Planhat users → profiles) ─────────────────────────────────────
    // profiles are 1:1 with auth.users and CANNOT be inserted from Planhat. We
    // match an existing profile (by planhat_user_id first for a stable link,
    // else by email) and UPDATE display fields only — never role/is_active or
    // anything that governs access. Unmatched Planhat users are skipped + counted.
    const pu = await fetchUpdated("/users", usersSince);
    let usersUpdated = 0;
    let usersSkipped = 0;
    if (pu.changed.size) {
      // profiles is a small internal table — load once, match in memory so email
      // comparison is case-insensitive (mirrors migrate-planhat.ts).
      const { data: profs, error: profErr } = await supabase
        .from("profiles").select("id, email, planhat_user_id");
      if (profErr) throw new Error(`users: load profiles: ${profErr.message}`);
      const byPid = new Map<string, string>();
      const byEmail = new Map<string, string>();
      for (const p of profs ?? []) {
        if (p.planhat_user_id) byPid.set(String(p.planhat_user_id), p.id as string);
        if (p.email) byEmail.set(String(p.email).toLowerCase(), p.id as string);
      }

      for (const [planhatId, u] of pu.changed) {
        const email = String(u.email ?? "").toLowerCase().trim();
        const profileId = byPid.get(planhatId) ?? (email ? byEmail.get(email) : undefined);
        if (!profileId) { usersSkipped++; continue; } // no matching profile — can't create one

        const patch: Record<string, unknown> = {
          full_name: u.nickName || [u.firstName, u.lastName].filter(Boolean).join(" ") || undefined,
          avatar_url: u.profilePicture ?? u.profilePic ?? u.image ?? u.avatar ?? undefined,
          planhat_user_id: planhatId, // stamp the stable link
        };
        for (const k of Object.keys(patch)) if (patch[k] === undefined) delete patch[k];

        const { error } = await supabase.from("profiles").update(patch).eq("id", profileId);
        if (error) throw new Error(`profiles update (planhat ${planhatId}): ${error.message}`);
        usersUpdated++;
      }
    }

    // Advance all high-water marks together, only after all writes succeeded.
    const nextCursor: Record<string, unknown> = { ...cursor };
    if (co.maxTs) nextCursor.since = co.maxTs;
    if (eu.maxTs) nextCursor.contactsSince = eu.maxTs;
    if (pu.maxTs) nextCursor.usersSince = pu.maxTs;
    await setCursor(supabase, conn!.id, nextCursor);

    return {
      companies: {
        scanned: co.scanned, changed: co.changed.size,
        inserted: coRes.inserted, updated: coRes.updated,
        sortHonored: co.sortHonored, incremental: Boolean(since),
      },
      contacts: {
        scanned: eu.scanned, changed: eu.changed.size,
        inserted: euRes.inserted, updated: euRes.updated, skipped: euRes.skipped,
        sortHonored: eu.sortHonored, incremental: Boolean(contactsSince),
      },
      users: {
        scanned: pu.scanned, changed: pu.changed.size,
        updated: usersUpdated, skipped: usersSkipped,
        sortHonored: pu.sortHonored, incremental: Boolean(usersSince),
      },
    };
  });

  // Belt-and-suspenders: scrub the token from any error before it leaves the
  // function (also lands in sync_runs.error via withSyncRun).
  if (result.error) result.error = redact(result.error);
  return json(result, result.ok ? 200 : 500);
});

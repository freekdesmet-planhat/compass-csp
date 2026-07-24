// sync-planhat — org-level outbound sync from Planhat (Section 6.2 style).
// Authenticates with a service-side Bearer token (PLANHAT_API_TOKEN), never
// exposed to the client. Idempotent: (source='planhat', source_id=<planhat _id>)
// select-then-update/insert, matching scripts/migrate-planhat.ts so backfill +
// live sync converge.
//
// Objects synced:
//   companies, endusers→contacts, users→profiles, opportunities→deals,
//   conversations→activities, tasks, nps→nps_responses (all incremental via an
//   updatedAt cursor with sort-verified early-stop);
//   objectives→success_plans+objectives and licenses→companies.arr/mrr +
//   usage_metrics (full-scan each run — they aggregate/group and can't be
//   incremental); dimensiondata→usage_metrics (heavy — gated behind a request
//   body flag + PLANHAT_DIMENSION_IDS, NOT part of the 30-min cron).
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { serviceClient, json } from "../_shared/supabase.ts";
import { fetchWithRetry } from "../_shared/http.ts";
import { getCursor, setCursor, withSyncRun } from "../_shared/sync.ts";

// This tenant lives on Planhat's demo cluster, not the production api host.
const BASE = "https://api.planhatdemo.com";
const token = () => (Deno.env.get("PLANHAT_API_TOKEN") ?? "").trim();
const authHeaders = () => ({ Authorization: `Bearer ${token()}`, "content-type": "application/json" });

function redact(msg: string): string {
  const t = token();
  return t ? msg.split(t).join("[REDACTED]") : msg;
}
function assertValidToken(): void {
  const t = token();
  if (!t) throw new Error("PLANHAT_API_TOKEN not set");
  if (/[\x00-\x1f\x7f]/.test(t)) {
    throw new Error("PLANHAT_API_TOKEN contains invalid characters (newline/control chars) — re-set the secret cleanly");
  }
}

// ── small field mappers (ported from scripts/migrate-planhat.ts) ──────────────
type Rec = Record<string, any>;
const num = (v: any): number | null => { if (v == null || v === "") return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const str = (v: any): string | null => { if (v == null) return null; const s = String(v).trim(); return s === "" ? null : s; };
const arr = (v: any): any[] => (Array.isArray(v) ? v : v == null ? [] : [v]);
const asId = (v: any): string | null => (v == null ? null : typeof v === "string" ? (v || null) : (v._id ?? v.id ?? null));
const cf = (o: Rec, key: string): any => o?.custom?.[key];
const snakeLower = (v: any): string | null => { const s = str(v); return s ? s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") : null; };
const dateOnly = (d: any): string => new Date(d).toISOString().slice(0, 10);
const iso = (d: any): string => new Date(d).toISOString();

const QUAL_KEYS = ["Champion", "Economic Buyer", "Decision Criteria", "Decision Process", "Identify Pain", "Metrics", "Budget", "Need", "Timeline", "Authority"];
function mapDealStatus(o: Rec): string {
  const s = str(o.status)?.toLowerCase();
  if (s === "won" || s === "closed won") return "won";
  if (s === "lost" || s === "closed lost") return "lost";
  return "open";
}
function convType(t: any): string {
  const s = str(t)?.toLowerCase();
  if (s === "email") return "email";
  if (s === "call") return "call";
  if (s === "chat" || s === "ticket") return "ticket";
  return "note";
}
function mapObjectiveStatus(v: any): string {
  const s = str(v)?.toLowerCase() ?? "";
  if (s.includes("achiev") || s.includes("complet") || s.includes("done")) return "achieved";
  if (s.includes("miss") || s.includes("fail")) return "missed";
  if (s.includes("risk")) return "at_risk";
  if (s.includes("track") || s.includes("progress") || s.includes("active")) return "on_track";
  return "not_started";
}

// Planhat "Customer Type" custom field → Compass segment enum.
function mapSegment(v: any): string | undefined {
  const s = snakeLower(v);
  if (!s) return undefined;
  if (s.includes("scal")) return "scaled";
  if (s.includes("enterprise")) return "enterprise";
  if (s.includes("mid") || s.includes("touch")) return "mid_touch";
  return undefined;
}
// Health band from a 0–100 score (mirrors default thresholds red<40, amber<70).
function bandFor(score: number): string {
  return score < 40 ? "red" : score < 70 ? "amber" : "green";
}
// Planhat sentimentScore is tenant-dependent scale → normalise to 1–10.
function normSentiment(v: any): number | null {
  const n = num(v);
  if (n == null) return null;
  let s: number;
  if (n >= -1 && n <= 1) s = (n + 1) * 5;
  else if (n >= 0 && n <= 10) s = n;
  else if (n >= -100 && n <= 100) s = (n + 100) / 20;
  else s = n;
  return Math.round(Math.max(1, Math.min(10, s)) * 10) / 10;
}
// Planhat csmScore is 1–5 → Compass value_score is 1–10.
function csmToValue(v: any): number | undefined {
  const n = num(v);
  return n == null ? undefined : Math.round(Math.max(1, Math.min(10, n * 2)) * 10) / 10;
}

// ── Planhat paging + cursor ───────────────────────────────────────────────────
// Carries the HTTP status so callers can treat a permission/absent object (403/
// 404) as "skip this object" rather than aborting the whole sync run.
class PlanhatHttpError extends Error {
  constructor(public status: number, message: string) { super(message); this.name = "PlanhatHttpError"; }
}
async function planhatPage(path: string, params: Record<string, string>, limit: number, offset: number): Promise<any[]> {
  const u = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  u.searchParams.set("limit", String(limit));
  u.searchParams.set("offset", String(offset));
  let res: Response;
  try {
    res = await fetchWithRetry(u.toString(), { headers: authHeaders() });
  } catch (err) {
    throw new Error(redact(err instanceof Error ? err.message : String(err)));
  }
  if (!res.ok) throw new PlanhatHttpError(res.status, redact(`Planhat ${res.status} ${res.statusText} for ${path}: ${(await res.text()).slice(0, 300)}`));
  const page = await res.json();
  return Array.isArray(page) ? page : page?.data ?? [];
}

const SORT_FIELD = "updatedAt";
const TS_FIELDS = ["updatedAt", "lastUpdated", "lastUpdate", "updated_at"];
function readTs(co: any): string | null {
  for (const f of TS_FIELDS) if (co && co[f]) return String(co[f]);
  return null;
}

// Page newest-first (sort=-updatedAt), collect records changed since `since`.
// Verifies the sort is honored; if not, scans every page (still returning only
// changed records) instead of an early-stop that could skip updates. since="" →
// full scan (everything is "changed").
async function fetchUpdated(path: string, since: string): Promise<{ changed: Map<string, any>; scanned: number; sortHonored: boolean; maxTs: string; unavailable: boolean }> {
  const limit = 2000;
  let offset = 0;
  let sortHonored = true;
  let prevTs: string | null = null;
  let scanned = 0;
  let maxTs = since;
  const changed = new Map<string, any>();

  scan: for (;;) {
    let page: any[];
    try {
      page = await planhatPage(path, { sort: `-${SORT_FIELD}` }, limit, offset);
    } catch (err) {
      // A forbidden (403) or absent (404) object isn't a run-level failure — the
      // token simply can't see it on this tenant. Skip it; leave the cursor put
      // (maxTs stays = since) so nothing advances past data we never read.
      if (err instanceof PlanhatHttpError && (err.status === 403 || err.status === 404)) {
        return { changed, scanned, sortHonored, maxTs, unavailable: true };
      }
      throw err;
    }
    for (const rec of page) {
      scanned++;
      const ts = readTs(rec);
      if (ts && (!maxTs || ts > maxTs)) maxTs = ts;
      if (sortHonored && prevTs && ts && ts > prevTs) sortHonored = false;
      if (ts) prevTs = ts;
      const isChanged = !since || !ts || ts > since;
      if (isChanged) {
        const id = String(rec._id ?? rec.id ?? "");
        if (id) changed.set(id, rec);
      } else if (sortHonored) {
        break scan;
      }
    }
    if (page.length < limit) break;
    offset += limit;
  }
  return { changed, scanned, sortHonored, maxTs, unavailable: false };
}

// ── Supabase helpers ──────────────────────────────────────────────────────────
type SB = ReturnType<typeof serviceClient>;

// Select every row (paginates past PostgREST's 1000-row cap).
async function selectAll(supabase: SB, table: string, columns: string, applyFilter?: (q: any) => any): Promise<any[]> {
  const out: any[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    let q = supabase.from(table).select(columns).range(from, from + pageSize - 1);
    if (applyFilter) q = applyFilter(q);
    const { data, error } = await q;
    if (error) throw new Error(`selectAll ${table}[${from}]: ${error.message}`);
    out.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }
  return out;
}
async function loadIdMap(supabase: SB, table: string, keyCol: string, planhatOnly = true): Promise<Map<string, string>> {
  const rows = await selectAll(supabase, table, `id, ${keyCol}`, planhatOnly ? (q) => q.eq("source", "planhat") : undefined);
  const m = new Map<string, string>();
  for (const r of rows) if (r[keyCol]) m.set(String(r[keyCol]), r.id as string);
  return m;
}

// Persist a changed set to a (source, source_id)-keyed table: one select + bulk
// insert for new rows + per-row update for existing. buildPatch returns column
// values WITHOUT source/source_id, or null to skip (orphan).
async function writeChanged(supabase: SB, table: string, changed: Map<string, any>, buildPatch: (rec: any) => Record<string, unknown> | null): Promise<{ inserted: number; updated: number; skipped: number }> {
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
    const { data: existing, error: selErr } = await supabase.from(table).select("id, source_id").eq("source", "planhat").in("source_id", sids);
    if (selErr) throw new Error(`${table} select batch [${i}]: ${selErr.message}`);
    const idBySid = new Map<string, string>();
    for (const r of existing ?? []) idBySid.set(String(r.source_id), r.id as string);
    const toInsert = chunk.filter((r) => !idBySid.has(r.sid)).map((r) => ({ ...r.patch, source: "planhat", source_id: r.sid }));
    if (toInsert.length) {
      const { error } = await supabase.from(table).insert(toInsert);
      if (error) throw new Error(`${table} insert batch [${i}]: ${error.message}`);
      inserted += toInsert.length;
    }
    // Per-row updates, run in bounded-concurrency batches — a full re-scan of an
    // existing object (e.g. 5862 contacts) is all updates; sequential awaits would
    // blow the edge wall-clock.
    const toUpdate = chunk.filter((r) => idBySid.has(r.sid));
    const CONC = 25;
    for (let j = 0; j < toUpdate.length; j += CONC) {
      const slice = toUpdate.slice(j, j + CONC);
      const results = await Promise.all(slice.map((r) => supabase.from(table).update(r.patch).eq("id", idBySid.get(r.sid)!)));
      for (let k = 0; k < results.length; k++) {
        if (results[k].error) throw new Error(`${table} update (planhat ${slice[k].sid}): ${results[k].error!.message}`);
      }
      updated += slice.length;
    }
  }
  return { inserted, updated, skipped };
}

// usage_metrics has a NATURAL key (company_id, metric_key, metric_date) backed by
// a plain (non-partial) UNIQUE constraint, so a PostgREST upsert with onConflict
// works cleanly here — unlike the partial (source, source_id) indexes elsewhere.
// One bulk call per chunk; no giant .in() filter (which overran the URL/HTTP-2
// stream). Dedupe the payload first (last value wins) so a batch never conflicts
// with itself.
async function upsertUsageMetrics(supabase: SB, rows: { company_id: string; metric_key: string; metric_date: string; value: number }[]): Promise<number> {
  const byKey = new Map<string, typeof rows[number]>();
  for (const r of rows) byKey.set(`${r.company_id}|${r.metric_key}|${r.metric_date}`, r);
  const items = [...byKey.values()];
  let written = 0;
  for (let i = 0; i < items.length; i += 500) {
    const chunk = items.slice(i, i + 500);
    const { error } = await supabase.from("usage_metrics").upsert(chunk, { onConflict: "company_id,metric_key,metric_date" });
    if (error) throw new Error(`usage_metrics upsert [${i}]: ${error.message}`);
    written += chunk.length;
  }
  return written;
}

async function upsertCompanyProducts(supabase: SB, rows: { company_id: string; product_id: string; status: string; arr: number | null }[]): Promise<number> {
  let written = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error } = await supabase.from("company_products").upsert(chunk, { onConflict: "company_id,product_id" });
    if (error) throw new Error(`company_products upsert [${i}]: ${error.message}`);
    written += chunk.length;
  }
  return written;
}

serve(async (req) => {
  try {
    assertValidToken();
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
  const body = await req.json().catch(() => ({}));
  const supabase = serviceClient();

  let { data: conn } = await supabase
    .from("integration_connections").select("id, sync_cursor").eq("provider", "planhat").is("user_id", null).maybeSingle();
  if (!conn) {
    conn = (await supabase.from("integration_connections").insert({ provider: "planhat", status: "active", sync_cursor: {} }).select("id, sync_cursor").single()).data!;
  }

  const result = await withSyncRun(supabase, "planhat", conn.id, async () => {
    const cursor = await getCursor(supabase, conn!.id);
    const since = (cursor.since as string) ?? "";
    const contactsSince = (cursor.contactsSince as string) ?? "";
    const usersSince = (cursor.usersSince as string) ?? "";
    const dealsSince = (cursor.dealsSince as string) ?? "";
    const activitiesSince = (cursor.activitiesSince as string) ?? "";
    const tasksSince = (cursor.tasksSince as string) ?? "";
    const npsSince = (cursor.npsSince as string) ?? "";

    // A full backfill can exceed one edge worker's compute budget (the worker is
    // hard-killed with no chance to run cleanup). Persist each object's high-water
    // mark the moment that object finishes, so progress is durable and the sync
    // self-resumes on the next invocation/cron tick — completed objects then
    // early-stop cheaply, leaving budget for the rest.
    const advance = async (key: string, maxTs: string, unavailable: boolean) => {
      if (!unavailable && maxTs) cursor[key] = maxTs;
      await setCursor(supabase, conn!.id, cursor);
    };

    // Owner/user resolution (Planhat user _id → Compass profile). Small; load once.
    const profileByPlanhatUser = await loadIdMap(supabase, "profiles", "planhat_user_id", false);
    const resolveUser = (v: any): string | null => { const id = asId(v); return id ? profileByPlanhatUser.get(String(id)) ?? null : null; };

    // ── Companies ──────────────────────────────────────────────────────────
    const co = await fetchUpdated("/companies", since);
    let companiesOwned = 0;
    const coRes = await writeChanged(supabase, "companies", co.changed, (c) => {
      const ownerId = resolveUser(c.owner ?? cf(c, "CSM"));
      if (ownerId) companiesOwned++;
      const hScore = c.h != null ? Math.round((num(c.h) ?? 0) * 10) : undefined; // Planhat h is 0–10
      const patch: Record<string, unknown> = {
        name: c.name,
        arr: num(c.arr) ?? undefined, // clean annual; arrTotal/mrTotal are inflated lifetime sums
        mrr: num(c.mr) ?? undefined, // Planhat uses `mr` (monthly), not `mrr`
        domains: Array.isArray(c.domains) ? c.domains : c.domain ? [c.domain] : undefined,
        owner_id: ownerId ?? undefined,
        status: str(c.status) ?? undefined,
        phase: str(c.phase) ?? undefined,
        segment: mapSegment(cf(c, "Customer Type")),
        tier: str(cf(c, "Customer Tier")) ?? undefined,
        region: str(cf(c, "Region")) ?? undefined,
        renewal_date: c.renewalDate ? dateOnly(c.renewalDate) : undefined,
        renewal_arr: num(c.renewalArr) ?? undefined,
        value_score: csmToValue(c.csmScore),
        sentiment_assessment: normSentiment(c.sentimentScore) ?? undefined,
        health_score: hScore,
        health_band: hScore != null ? bandFor(hScore) : undefined,
        health_delta_wow: c.hDiff != null ? Math.round((num(c.hDiff) ?? 0) * 10) : undefined,
        health_updated_at: c.hDiffDate ? iso(c.hDiffDate) : (hScore != null ? new Date().toISOString() : undefined),
        last_touch_at: c.lastTouch ? iso(c.lastTouch) : undefined,
        last_touch_type: str(c.lastTouchType) ?? undefined,
      };
      for (const k of Object.keys(patch)) if (patch[k] === undefined) delete patch[k];
      return patch;
    });
    await advance("since", co.maxTs, co.unavailable);

    // company map (after companies written, so new ones resolve)
    const companyByPlanhatId = await loadIdMap(supabase, "companies", "source_id", true);
    const resolveCompany = (v: any): string | null => { const id = asId(v); return id ? companyByPlanhatId.get(String(id)) ?? null : null; };

    // ── Contacts (endusers) ──────────────────────────────────────────────────
    const eu = await fetchUpdated("/endusers", contactsSince);
    const euRes = await writeChanged(supabase, "contacts", eu.changed, (e) => {
      const companyId = resolveCompany(e.companyId ?? e.company);
      if (!companyId) return null; // company_id is NOT NULL — skip orphans
      const patch: Record<string, unknown> = {
        company_id: companyId,
        first_name: e.firstName ?? undefined, last_name: e.lastName ?? undefined,
        email: e.email ?? undefined, other_emails: Array.isArray(e.otherEmails) ? e.otherEmails : undefined,
        phone: e.phone ?? undefined, title: e.position ?? undefined,
        linkedin_url: e.linkedInUrl ?? e.linkedinUrl ?? undefined,
        department: str(cf(e, "Department")) ?? undefined,
        seniority: str(cf(e, "Level")) ?? undefined,
        last_active_at: e.lastActive ? iso(e.lastActive) : undefined,
        last_touch_at: e.lastTouch ? iso(e.lastTouch) : undefined,
        archived: typeof e.archived === "boolean" ? e.archived : undefined,
      };
      for (const k of Object.keys(patch)) if (patch[k] === undefined) delete patch[k];
      return patch;
    });
    await advance("contactsSince", eu.maxTs, eu.unavailable);

    // ── Users → profiles: UPDATE matched (by planhat_user_id/email) and CREATE a
    //    Compass account for unmatched Planhat users so team members added in
    //    Planhat appear automatically. New accounts get role 'csm' (admin can
    //    reassign) and email_confirm=true; they sign in via password reset — no
    //    email is sent here. Creation is capped per run as a runaway guard. ────
    const pu = await fetchUpdated("/users", usersSince);
    let usersUpdated = 0, usersSkipped = 0, usersCreated = 0;
    const MAX_CREATE = 100;
    if (pu.changed.size) {
      const { data: profs, error: profErr } = await supabase.from("profiles").select("id, email, planhat_user_id");
      if (profErr) throw new Error(`users: load profiles: ${profErr.message}`);
      const byPid = new Map<string, string>(), byEmail = new Map<string, string>();
      for (const p of profs ?? []) {
        if (p.planhat_user_id) byPid.set(String(p.planhat_user_id), p.id as string);
        if (p.email) byEmail.set(String(p.email).toLowerCase(), p.id as string);
      }
      // Preload existing auth users (email → id) so we LINK an orphan auth account
      // (invited/created but never given a profile) rather than failing to
      // re-create it. Paginated; a demo roster is one page.
      const authByEmail = new Map<string, string>();
      for (let page = 1; page <= 20; page++) {
        const { data: list, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
        if (error) break;
        for (const au of list?.users ?? []) if (au.email) authByEmail.set(au.email.toLowerCase(), au.id);
        if (!list || (list.users?.length ?? 0) < 1000) break;
      }
      for (const [planhatId, u] of pu.changed) {
        const email = String(u.email ?? "").toLowerCase().trim();
        const fullName = u.nickName || [u.firstName, u.lastName].filter(Boolean).join(" ") || null;
        const avatar = u.profilePicture ?? u.profilePic ?? u.image ?? u.avatar ?? null;
        const profileId = byPid.get(planhatId) ?? (email ? byEmail.get(email) : undefined);
        if (profileId) {
          const patch: Record<string, unknown> = { full_name: fullName ?? undefined, avatar_url: avatar ?? undefined, planhat_user_id: planhatId };
          for (const k of Object.keys(patch)) if (patch[k] === undefined) delete patch[k];
          const { error } = await supabase.from("profiles").update(patch).eq("id", profileId);
          if (error) throw new Error(`profiles update (planhat ${planhatId}): ${error.message}`);
          usersUpdated++;
          continue;
        }
        // Unmatched → link an existing auth user by email, else create one.
        if (!email || usersCreated >= MAX_CREATE) { usersSkipped++; continue; }
        let authId = authByEmail.get(email);
        if (!authId) {
          const { data: created, error: cErr } = await supabase.auth.admin.createUser({ email, email_confirm: true, user_metadata: { full_name: fullName } });
          if (cErr || !created?.user?.id) { usersSkipped++; continue; }
          authId = created.user.id;
        }
        const { error: insErr } = await supabase.from("profiles").upsert(
          { id: authId, email, full_name: fullName, avatar_url: avatar, role: "csm", is_active: true, planhat_user_id: planhatId },
          { onConflict: "id" },
        );
        if (insErr) throw new Error(`profiles upsert (planhat ${planhatId}): ${insErr.message}`);
        byPid.set(planhatId, authId); byEmail.set(email, authId);
        usersCreated++;
      }
    }
    await advance("usersSince", pu.maxTs, pu.unavailable);

    // contact map (after contacts written) — for deal/activity/nps references
    const contactByPlanhatId = await loadIdMap(supabase, "contacts", "source_id", true);
    const resolveContact = (v: any): string | null => { const id = asId(v); return id ? contactByPlanhatId.get(String(id)) ?? null : null; };

    // ── Deals (opportunities) ────────────────────────────────────────────────
    const op = await fetchUpdated("/opportunities", dealsSince);
    const opRes = await writeChanged(supabase, "deals", op.changed, (o) => {
      const companyId = resolveCompany(o.companyId ?? o.company);
      if (!companyId) return null;
      const status = mapDealStatus(o);
      const amount = num(o.arr) ?? (num(o.mrr) != null ? num(o.mrr)! * 12 : null);
      const closeSrc = (status === "won" || status === "lost") && o.closeDate ? o.closeDate : (o.dealDate ?? o.closeDate);
      const qualification: Rec = {};
      for (const k of QUAL_KEYS) { const v = cf(o, k); if (v != null && v !== "") qualification[k] = v; }
      const contactIds = [asId(cf(o, "Decision Maker")), ...arr(cf(o, "Involved Contacts")).map(asId)]
        .map((id) => (id ? contactByPlanhatId.get(String(id)) ?? null : null)).filter(Boolean);
      return {
        company_id: companyId, name: str(o.title) ?? "(untitled deal)",
        pipeline: snakeLower(cf(o, "Pipeline")) ?? "new_business", stage: str(o.salesStage),
        forecast_category: snakeLower(cf(o, "Forecast Category")), amount, currency: str(o.currency) ?? "USD",
        close_date: closeSrc ? dateOnly(closeSrc) : null, owner_id: resolveUser(o.ownerId ?? o.owner),
        status, next_steps: str(cf(o, "Next Steps")), ai_summary: str(cf(o, "Summary")),
        confidence: num(cf(o, "(AI) Confidence Score")), qualification, contact_ids: [...new Set(contactIds)],
      };
    });
    await advance("dealsSince", op.maxTs, op.unavailable);

    // ── Activities (conversations) ───────────────────────────────────────────
    const cv = await fetchUpdated("/conversations", activitiesSince);
    const cvRes = await writeChanged(supabase, "activities", cv.changed, (c) => {
      const companyId = resolveCompany(c.companyId ?? c.company);
      if (!companyId) return null;
      const userId = arr(c.users).map(resolveUser).find(Boolean) ?? null;
      const contactIds = arr(c.endUsers).map(resolveContact).filter(Boolean);
      const occurred = c.date ?? c.createdAt ?? c.updatedAt;
      return {
        company_id: companyId, user_id: userId, contact_ids: [...new Set(contactIds)],
        type: convType(c.type), title: str(c.subject) ?? str(c.snip) ?? "(no subject)",
        snippet: str(c.snip) ?? str(c.subject), occurred_at: occurred ? iso(occurred) : new Date().toISOString(), meta: {},
      };
    });
    await advance("activitiesSince", cv.maxTs, cv.unavailable);

    // ── Tasks (open + completed ≤12mo) ───────────────────────────────────────
    const tk = await fetchUpdated("/tasks", tasksSince);
    const cutoff = Date.now() - 365 * 86_400_000;
    const tkRes = await writeChanged(supabase, "tasks", tk.changed, (t) => {
      const companyId = resolveCompany(t.companyId ?? t.company);
      if (!companyId) return null;
      const completedRaw = t.completedDate ?? ((t.done === true || t.completed === true) ? t.updatedAt : null);
      const completedAt = completedRaw ? new Date(completedRaw).getTime() : null;
      if (completedAt != null && completedAt < cutoff) return null;
      const due = t.dueDate ?? t.date;
      const priorityRaw = str(t.priority)?.toLowerCase();
      const priority = priorityRaw === "high" || priorityRaw === "low" ? priorityRaw : "normal";
      return {
        company_id: companyId, title: str(t.task) ?? str(t.title) ?? str(t.name) ?? "(task)",
        description: str(t.description), due_date: due ? dateOnly(due) : null,
        completed_at: completedAt != null ? new Date(completedAt).toISOString() : null,
        assignee_id: resolveUser(t.mainOwner ?? t.ownerId ?? t.owner ?? t.assignee),
        creator_id: resolveUser(t.createdBy ?? t.mainOwner ?? t.owner), priority, origin: "manual",
      };
    });
    await advance("tasksSince", tk.maxTs, tk.unavailable);

    // ── NPS ──────────────────────────────────────────────────────────────────
    // Planhat /nps fields (verified against a live record): company ref is `cId`,
    // score is `nps` (0–10), comment `npsComment`, date `npsDate`. There is no
    // enduser id — only `email` — so resolve the contact by email (lazy map, only
    // built when there are records to place).
    const np = await fetchUpdated("/nps", npsSince);
    const contactByEmail = new Map<string, string>();
    if (np.changed.size && !np.unavailable) {
      for (const c of await selectAll(supabase, "contacts", "id, email", (q) => q.eq("source", "planhat")))
        if (c.email) contactByEmail.set(String(c.email).toLowerCase(), c.id as string);
    }
    const npRes = await writeChanged(supabase, "nps_responses", np.changed, (n) => {
      const companyId = resolveCompany(n.cId ?? n.companyId ?? n.company);
      const score = num(n.nps ?? n.score);
      if (!companyId || score == null) return null;
      const email = str(n.email)?.toLowerCase();
      const respondedAt = n.npsDate ?? n.date ?? n.dateSent ?? n.createdAt;
      return {
        company_id: companyId,
        contact_id: resolveContact(n.endUserId ?? n.contactId ?? n.enduser) ?? (email ? contactByEmail.get(email) ?? null : null),
        score: Math.round(score), comment: str(n.npsComment ?? n.comment ?? n.feedback),
        responded_at: respondedAt ? iso(respondedAt) : new Date().toISOString(),
      };
    });
    await advance("npsSince", np.maxTs, np.unavailable);

    // Derive contacts.nps_latest / nps_latest_at from the synced NPS responses —
    // Planhat has no enduser-level NPS field; the score lives on the nps record
    // and the contact is matched by email.
    let npsContactsUpdated = 0;
    const npsByContact = new Map<string, { score: number; at: string }>();
    for (const [, n] of np.changed) {
      const email = str(n.email)?.toLowerCase();
      const cId = resolveContact(n.endUserId ?? n.contactId ?? n.enduser) ?? (email ? contactByEmail.get(email) ?? null : null);
      const score = num(n.nps ?? n.score);
      if (!cId || score == null) continue;
      const at = (n.npsDate ?? n.date ?? n.dateSent ?? n.createdAt) ? iso(n.npsDate ?? n.date ?? n.dateSent ?? n.createdAt) : new Date().toISOString();
      const prev = npsByContact.get(cId);
      if (!prev || at > prev.at) npsByContact.set(cId, { score: Math.round(score), at });
    }
    for (const [cId, { score, at }] of npsByContact) {
      const { error } = await supabase.from("contacts").update({ nps_latest: score, nps_latest_at: at }).eq("id", cId);
      if (error) throw new Error(`contacts nps_latest (${cId}): ${error.message}`);
      npsContactsUpdated++;
    }

    // ── Objectives → success_plans (1/company) + success_plan_objectives ─────
    // Full scan: grouping by company needs the whole set.
    const ob = await fetchUpdated("/objectives", "");
    const byCompany = new Map<string, any[]>();
    for (const [, o] of ob.changed) {
      const companyId = resolveCompany(o.companyId ?? o.company);
      if (!companyId) continue;
      (byCompany.get(companyId) ?? byCompany.set(companyId, []).get(companyId)!).push(o);
    }
    const planChanged = new Map<string, any>();
    for (const [companyId, objs] of byCompany) {
      const owner = objs.map((o) => resolveUser(o.ownerId ?? o.owner)).find(Boolean) ?? null;
      planChanged.set(`${companyId}:migrated-plan`, { companyId, owner });
    }
    const planRes = await writeChanged(supabase, "success_plans", planChanged, (p) => ({
      company_id: p.companyId, name: "Migrated success plan", owner_id: p.owner ?? null, status: "active",
    }));
    const planRows = await selectAll(supabase, "success_plans", "id, company_id, source_id", (q) => q.eq("source", "planhat"));
    const planByCompany = new Map<string, string>();
    for (const r of planRows) if (String(r.source_id).endsWith(":migrated-plan")) planByCompany.set(r.company_id, r.id as string);
    const objChanged = new Map<string, any>();
    for (const [companyId, objs] of byCompany) {
      const planId = planByCompany.get(companyId);
      if (!planId) continue;
      objs.forEach((o, i) => { const oid = asId(o._id ?? o.id); if (oid) objChanged.set(oid, { o, planId, companyId, i }); });
    }
    const objRes = await writeChanged(supabase, "success_plan_objectives", objChanged, (x) => ({
      plan_id: x.planId, company_id: x.companyId,
      title: str(x.o.name) ?? str(x.o.title) ?? "(objective)",
      business_outcome: str(x.o.description ?? cf(x.o, "Business Outcome")),
      metric: str(cf(x.o, "Metric")),
      target_date: (x.o.dueDate ?? x.o.targetDate) ? dateOnly(x.o.dueDate ?? x.o.targetDate) : null,
      status: mapObjectiveStatus(x.o.status), position: x.i, notes: str(x.o.notes),
    }));

    // ── Licenses → companies.arr/mrr (summed) + usage_metrics(license_mrr) ───
    // Full scan → usage_metrics(license_mrr) time-series ONLY. We intentionally do
    // NOT overwrite companies.arr/mrr here: Planhat's company `arr`/`mr` are the
    // clean annual/monthly values; summing licences produced tiny/inflated ARR.
    const lic = await fetchUpdated("/licenses", "");
    const usageRows: { company_id: string; metric_key: string; metric_date: string; value: number }[] = [];
    // Product ownership (company_products) is derived from licences so the
    // expansion/whitespace grid reflects what accounts actually own. The catalog
    // is the 6 seeded products; a licence's product name is matched to the catalog
    // where possible, otherwise it counts as the base "Core Licence". ARR per
    // (company, product) is summed from licence value (annual) or mrr×12.
    const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const { data: catalog } = await supabase.from("products").select("id,name");
    const products = (catalog ?? []).map((p: any) => ({ id: p.id as string, n: norm(p.name) }));
    const coreId = products.find((p) => p.n.includes("core") || p.n.includes("licence") || p.n.includes("license"))?.id ?? products[0]?.id ?? null;
    const matchProduct = (raw: unknown): string | null => {
      const ln = norm(raw);
      if (!ln) return coreId;
      const hit = products.find((p) => p.n === ln || (ln.length >= 4 && (p.n.includes(ln) || ln.includes(p.n))));
      return hit?.id ?? coreId;
    };
    const ownership = new Map<string, { company_id: string; product_id: string; status: string; arr: number }>();
    for (const [, l] of lic.changed) {
      const companyId = resolveCompany(l.companyId ?? l.company);
      if (!companyId) continue;
      const mrr = num(l.mrr) ?? 0;
      const when = l.fromDate ?? l.startDate ?? l.date ?? l.createdAt;
      usageRows.push({ company_id: companyId, metric_key: "license_mrr", metric_date: dateOnly(when ?? Date.now()), value: mrr });

      const productId = coreId ? matchProduct(l.product ?? l.productName ?? l.name) : null;
      if (productId) {
        const arr = num(l.value) ?? num(l.arr) ?? mrr * 12;
        const key = `${companyId}|${productId}`;
        const prev = ownership.get(key);
        if (prev) prev.arr += arr;
        else ownership.set(key, { company_id: companyId, product_id: productId, status: "current", arr });
      }
    }
    const licUsage = await upsertUsageMetrics(supabase, usageRows);
    const companyProducts = coreId ? await upsertCompanyProducts(supabase, [...ownership.values()]) : 0;

    // ── Dimension data → usage_metrics (GATED: manual + config, windowed) ────
    // Heavy (per company × dimension API calls); NOT for the 30-min cron. Trigger
    // with POST {"dimensions": true} and PLANHAT_DIMENSION_IDS set. Processes a
    // bounded window of companies per call, advancing cursor.dimensionOffset.
    let dimensions: Rec = { ran: false };
    if (body?.dimensions === true) {
      const dimIds = (Deno.env.get("PLANHAT_DIMENSION_IDS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      if (!dimIds.length) {
        dimensions = { ran: false, error: "PLANHAT_DIMENSION_IDS not set" };
      } else {
        const WINDOW = 40; // keep under the edge wall-clock limit
        const planhatCompanyIds = [...companyByPlanhatId.keys()].sort(); // stable order
        const startAt = Number(cursor.dimensionOffset ?? 0) % Math.max(1, planhatCompanyIds.length);
        const windowIds = planhatCompanyIds.slice(startAt, startAt + WINDOW);
        const to = Math.floor(Date.now() / 86_400_000);
        const from = to - 365;
        const dimRows: { company_id: string; metric_key: string; metric_date: string; value: number }[] = [];
        for (const pcid of windowIds) {
          const compassId = companyByPlanhatId.get(pcid)!;
          for (const dimid of dimIds) {
            let res: any;
            try {
              res = (await planhatPage("/dimensiondata", { cId: pcid, dimid, from: String(from), to: String(to) }, 5000, 0));
            } catch { continue; }
            const points: any[] = Array.isArray(res) ? res : (res?.data ?? []);
            for (const p of points) {
              const v = num(Array.isArray(p) ? p[1] : (p?.value ?? p?.v ?? p?.count ?? p?.y));
              if (v == null) continue;
              const rawDate = Array.isArray(p) ? p[0] : (p?.date ?? p?.day ?? p?.time ?? p?.x);
              const ms = typeof rawDate === "number" ? (rawDate > 1e11 ? rawDate : rawDate * 86_400_000) : Date.parse(String(rawDate));
              if (!Number.isFinite(ms)) continue;
              dimRows.push({ company_id: compassId, metric_key: dimid, metric_date: dateOnly(ms), value: v });
            }
          }
        }
        const written = await upsertUsageMetrics(supabase, dimRows);
        const nextOffset = startAt + WINDOW >= planhatCompanyIds.length ? 0 : startAt + WINDOW;
        cursor.dimensionOffset = nextOffset;
        dimensions = { ran: true, companiesProcessed: windowIds.length, from: startAt, nextOffset, metricsWritten: written };
      }
    }

    // Incremental high-water marks are persisted per-object via advance() above,
    // so a mid-run worker kill still commits completed objects. This final write
    // captures dimensionOffset (set in the dimension-data block, if it ran).
    await setCursor(supabase, conn!.id, cursor);

    const unavailableObjects = [
      co.unavailable && "companies", eu.unavailable && "endusers", pu.unavailable && "users",
      op.unavailable && "opportunities", cv.unavailable && "conversations", tk.unavailable && "tasks",
      np.unavailable && "nps", ob.unavailable && "objectives", lic.unavailable && "licenses",
    ].filter(Boolean);

    return {
      companies: { scanned: co.scanned, changed: co.changed.size, inserted: coRes.inserted, updated: coRes.updated, owned: companiesOwned, sortHonored: co.sortHonored, incremental: Boolean(since), unavailable: co.unavailable },
      contacts: { scanned: eu.scanned, changed: eu.changed.size, inserted: euRes.inserted, updated: euRes.updated, skipped: euRes.skipped, sortHonored: eu.sortHonored, incremental: Boolean(contactsSince), unavailable: eu.unavailable },
      users: { scanned: pu.scanned, changed: pu.changed.size, updated: usersUpdated, created: usersCreated, skipped: usersSkipped, sortHonored: pu.sortHonored, incremental: Boolean(usersSince), unavailable: pu.unavailable },
      deals: { scanned: op.scanned, changed: op.changed.size, inserted: opRes.inserted, updated: opRes.updated, skipped: opRes.skipped, sortHonored: op.sortHonored, incremental: Boolean(dealsSince), unavailable: op.unavailable },
      activities: { scanned: cv.scanned, changed: cv.changed.size, inserted: cvRes.inserted, updated: cvRes.updated, skipped: cvRes.skipped, sortHonored: cv.sortHonored, incremental: Boolean(activitiesSince), unavailable: cv.unavailable },
      tasks: { scanned: tk.scanned, changed: tk.changed.size, inserted: tkRes.inserted, updated: tkRes.updated, skipped: tkRes.skipped, sortHonored: tk.sortHonored, incremental: Boolean(tasksSince), unavailable: tk.unavailable },
      nps: { scanned: np.scanned, changed: np.changed.size, inserted: npRes.inserted, updated: npRes.updated, skipped: npRes.skipped, sortHonored: np.sortHonored, incremental: Boolean(npsSince), unavailable: np.unavailable },
      objectives: { scanned: ob.scanned, plans: planRes.inserted + planRes.updated, objectives: objRes.inserted + objRes.updated, fullScan: true, unavailable: ob.unavailable },
      licenses: { scanned: lic.scanned, usageMetrics: licUsage, companyProducts, fullScan: true, unavailable: lic.unavailable },
      dimensions,
      unavailableObjects,
    };
  });

  if (result.error) result.error = redact(result.error);
  return json(result, result.ok ? 200 : 500);
});

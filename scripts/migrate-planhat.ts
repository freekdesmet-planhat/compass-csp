/**
 * scripts/migrate-planhat.ts — one-time, re-runnable Planhat → Compass migration.
 *
 * Idempotent: every table upserts on (source='planhat', source_id=<planhat _id>),
 * so a second run creates zero duplicates. Implements the 12 steps of Section 6.1
 * in order, applies the EXACT field mappings, resolves references in a second pass
 * once all contacts exist, and ends with a reconciliation report.
 *
 * Base URL https://api.planhatdemo.com (this tenant is on Planhat's demo cluster),
 * header `Authorization: Bearer $PLANHAT_API_TOKEN`.
 * Everything is paginated (limit=2000&offset=N) and throttled to ~5 req/s with
 * retry/backoff on 429/5xx.
 *
 * Idempotency is enforced by the `upsert()` helper via select-then-update/insert
 * (matching sync-planhat), NOT ON CONFLICT — the (source, source_id) indexes are
 * PARTIAL. Tables with a natural key (health_snapshots, usage_metrics) pass it
 * explicitly; they have no source_id column.
 *
 * Run with env set, e.g.:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... PLANHAT_API_TOKEN=... npm run migrate:planhat
 *   # or: node --env-file=.env node_modules/.bin/tsx scripts/migrate-planhat.ts
 *
 * Optional env:
 *   MIGRATE_DIMENSION_IDS   comma-separated Planhat dimension ids for step 12 (usage_metrics)
 *
 * Conversions worth noting (also in README):
 *   - csmScore (1–5) → value_score ×2 (1–10 scale)
 *   - sentimentScore → sentiment_assessment normalised to 1–10
 *   - h (0–10) + usage.Health {Yesterday,7,14,30,60 days ago} → health_snapshots ×10 (0–100)
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// ── env ──────────────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
// .trim() guards against a trailing newline from a .env paste (a bug we hit once).
const PLANHAT_API_TOKEN = process.env.PLANHAT_API_TOKEN?.trim();
const MIGRATE_DIMENSION_IDS = (process.env.MIGRATE_DIMENSION_IDS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !PLANHAT_API_TOKEN) {
  console.error(
    '\n✖ Missing required environment variables.\n' +
      '  Required: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PLANHAT_API_TOKEN\n' +
      '  e.g.  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... PLANHAT_API_TOKEN=... npm run migrate:planhat\n' +
      '  or    node --env-file=.env node_modules/.bin/tsx scripts/migrate-planhat.ts\n'
  );
  process.exit(1);
}

const PLANHAT_BASE = 'https://api.planhatdemo.com';
const sb: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// --only=<step> targets a single backfill without a full re-migration (V1.1).
// Supported: nps | news-backfill | whitespace  (each is idempotent).
const ONLY = (process.argv.find((a) => a.startsWith('--only='))?.split('=')[1] ?? process.env.MIGRATE_ONLY ?? '').trim();

// ── small utilities ────────────────────────────────────────────────────────
const DAY_MS = 86_400_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const daysSinceEpoch = (ms: number) => Math.floor(ms / DAY_MS);
const dateOnly = (d: Date | string | number): string => new Date(d).toISOString().slice(0, 10);

/* eslint-disable @typescript-eslint/no-explicit-any */
type Rec = Record<string, any>;

const num = (v: any): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const str = (v: any): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};
const bool = (v: any): boolean => v === true || v === 'true' || v === 'Yes' || v === 'yes' || v === 1;
const arr = (v: any): any[] => (Array.isArray(v) ? v : v == null ? [] : [v]);
// planhat refs are usually _id strings, sometimes {_id}/{id} objects
const asId = (v: any): string | null => {
  if (v == null) return null;
  if (typeof v === 'string') return v || null;
  if (typeof v === 'object') return v._id ?? v.id ?? null;
  return null;
};
const cf = (o: Rec, key: string): any => o?.custom?.[key];
const snakeLower = (v: any): string | null => {
  const s = str(v);
  if (!s) return null;
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
};

const DEFAULT_THRESHOLDS = { red: 40, amber: 70 };
const bandFor = (score: number): 'red' | 'amber' | 'green' =>
  score < DEFAULT_THRESHOLDS.red ? 'red' : score < DEFAULT_THRESHOLDS.amber ? 'amber' : 'green';

// sentimentScore → 1–10 (planhat scale is tenant-dependent; normalise defensively)
function normSentiment(v: any): number | null {
  const n = num(v);
  if (n == null) return null;
  let s: number;
  if (n >= -1 && n <= 1) s = (n + 1) * 5; // -1..1
  else if (n >= 0 && n <= 10) s = n; // already 0–10 / 1–10
  else if (n >= -100 && n <= 100) s = (n + 100) / 20; // -100..100
  else s = n;
  return Math.round(Math.max(1, Math.min(10, s)) * 10) / 10;
}

// ── Planhat HTTP: throttle + retry ────────────────────────────────────────────
let lastRequestAt = 0;
const MIN_GAP_MS = 210; // ~5 req/s

async function throttle() {
  const wait = MIN_GAP_MS - (Date.now() - lastRequestAt);
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

async function fetchPlanhat(url: string): Promise<any> {
  const maxAttempts = 6;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await throttle();
    let res: Response;
    try {
      res = await fetch(url, { headers: { Authorization: `Bearer ${PLANHAT_API_TOKEN}` } });
    } catch (e) {
      if (attempt === maxAttempts) throw e;
      await sleep(Math.min(1000 * 2 ** attempt, 15_000));
      continue;
    }
    if (res.ok) return res.json();
    if (res.status === 429 || res.status >= 500) {
      const retryAfter = Number(res.headers.get('retry-after'));
      const backoff = retryAfter > 0 ? retryAfter * 1000 : Math.min(1000 * 2 ** attempt, 15_000);
      if (attempt === maxAttempts) throw new Error(`Planhat ${res.status} after ${maxAttempts} attempts: ${url}`);
      await sleep(backoff);
      continue;
    }
    // 4xx (other than 429) — non-retryable
    const body = await res.text().catch(() => '');
    throw new Error(`Planhat ${res.status} ${url}: ${body.slice(0, 300)}`);
  }
  throw new Error(`Planhat request failed: ${url}`);
}

function buildUrl(path: string, params: Rec): string {
  const u = new URL(`${PLANHAT_BASE}${path}`);
  for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, String(v));
  return u.toString();
}

// Single (non-paginated) GET
async function planhatGetRaw(path: string, params: Rec = {}): Promise<any> {
  return fetchPlanhat(buildUrl(path, params));
}

// Paginated GET (limit=2000&offset=N until a short page)
async function planhatGet(path: string, params: Rec = {}): Promise<Rec[]> {
  const limit = 2000;
  let offset = 0;
  const all: Rec[] = [];
  for (;;) {
    const page = await fetchPlanhat(buildUrl(path, { ...params, limit, offset }));
    const rows: Rec[] = Array.isArray(page) ? page : page?.data ?? [];
    all.push(...rows);
    if (rows.length < limit) break;
    offset += limit;
  }
  return all;
}

// ── Supabase upsert helper (select-then-update/insert; returns rows for mapping)
// The (source, source_id) unique indexes are PARTIAL (where source_id is not
// null), so ON CONFLICT can't target them (Postgres 42P10). We look up existing
// rows by the key columns, bulk-INSERT the new ones, and per-row UPDATE the rest
// — the same approach sync-planhat uses. Errors always throw (no silent writes).
//
// keyCols defaults to (source, source_id). Natural-key tables (health_snapshots,
// usage_metrics) pass their own key and must not include a source_id column.
async function upsert(
  table: string,
  rows: Rec[],
  keyCols: string[] = ['source', 'source_id']
): Promise<Rec[]> {
  if (!rows.length) return [];
  const isSourceKey = keyCols.length === 2 && keyCols[0] === 'source' && keyCols[1] === 'source_id';
  const keyOf = (r: Rec) => keyCols.map((k) => String(r[k])).join(' ');
  const out: Rec[] = [];

  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);

    // Resolve existing ids for the whole chunk in one query.
    let existing: Rec[] = [];
    if (isSourceKey) {
      const sids = [...new Set(chunk.map((r) => r.source_id).filter(Boolean))] as string[];
      if (sids.length) {
        const { data, error } = await sb.from(table).select('id, source, source_id').eq('source', 'planhat').in('source_id', sids);
        if (error) throw new Error(`select ${table} [${i}..${i + chunk.length}]: ${error.message}`);
        existing = data ?? [];
      }
    } else {
      // Pivot on the first (selective) key column, then match the full key in memory.
      const pivot = keyCols[0];
      const vals = [...new Set(chunk.map((r) => r[pivot]).filter((v) => v != null))];
      if (vals.length) {
        const { data, error } = await sb.from(table).select(['id', ...keyCols].join(',')).in(pivot, vals as string[]);
        if (error) throw new Error(`select ${table} [${i}..${i + chunk.length}]: ${error.message}`);
        existing = data ?? [];
      }
    }
    const idByKey = new Map<string, string>();
    for (const r of existing) idByKey.set(keyOf(r), r.id as string);

    const toInsert: Rec[] = [];
    const toUpdate: { id: string; row: Rec }[] = [];
    for (const r of chunk) {
      const id = idByKey.get(keyOf(r));
      if (id) toUpdate.push({ id, row: r });
      else toInsert.push(r);
    }

    if (toInsert.length) {
      const { data, error } = await sb.from(table).insert(toInsert).select();
      if (error) throw new Error(`insert ${table} [${i}..${i + chunk.length}]: ${error.message}`);
      if (data) out.push(...data);
    }
    for (const { id, row } of toUpdate) {
      const { data, error } = await sb.from(table).update(row).eq('id', id).select().single();
      if (error) throw new Error(`update ${table} (${keyCols.map((k) => `${k}=${row[k]}`).join(', ')}): ${error.message}`);
      if (data) out.push(data);
    }
  }
  return out;
}

// Build a planhat _id → compass uuid map from upserted rows (source_id carries planhat _id)
function idMapBySourceId(rows: Rec[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of rows) if (r.source_id) m.set(String(r.source_id), r.id);
  return m;
}

// ── reconciliation accumulators ────────────────────────────────────────────
const stats = {
  users: { planhat: 0, matched: 0 },
  companies: { planhat: 0, compass: 0 },
  contacts: { planhat: 0, compass: 0 },
  licenses: { planhat: 0, companiesUpdated: 0 },
  deals: { planhat: 0, compass: 0 },
  activities: { planhat: 0, compass: 0 },
  tasks: { planhat: 0, compass: 0 },
  nps: { planhat: 0, compass: 0 },
  objectives: { planhat: 0, plans: 0, objectives: 0 },
  churn: { planhat: 0, companiesChurned: 0 },
  healthSnapshots: 0,
  usageMetrics: 0,
};
const unmatchedOwners = new Set<string>();
const companiesWithoutDomains: string[] = [];
const driftWarnings: string[] = [];

// ── reference maps (populated as steps run) ──────────────────────────────────
let userMap = new Map<string, string>(); // planhat user _id → compass profile uuid
let companyMap = new Map<string, string>(); // planhat company _id → compass company uuid
let contactMap = new Map<string, string>(); // planhat enduser _id → compass contact uuid

function resolveUser(pid: any): string | null {
  const id = asId(pid);
  if (!id) return null;
  const mapped = userMap.get(id);
  if (!mapped) {
    unmatchedOwners.add(id);
    return null;
  }
  return mapped;
}
function resolveCompany(pid: any): string | null {
  const id = asId(pid);
  return id ? companyMap.get(id) ?? null : null;
}
function resolveContact(pid: any): string | null {
  const id = asId(pid);
  return id ? contactMap.get(id) ?? null : null;
}

// ════════════════════════════════════════════════════════════════════════════
// Step 1 — GET /users → match to existing profiles by email
// ════════════════════════════════════════════════════════════════════════════
async function step1Users() {
  console.log('① /users → match profiles by email');
  const users = await planhatGet('/users');
  stats.users.planhat = users.length;

  // existing profiles (may be empty on a fresh DB)
  const { data: profiles, error } = await sb.from('profiles').select('id,email');
  if (error) throw new Error(`read profiles: ${error.message}`);
  const emailToProfile = new Map<string, string>();
  for (const p of profiles ?? []) if (p.email) emailToProfile.set(String(p.email).toLowerCase(), p.id);

  const unmatched: string[] = [];
  userMap = new Map();
  for (const u of users) {
    const email = str(u.email)?.toLowerCase();
    const pid = asId(u._id ?? u.id);
    if (!pid) continue;
    const profileId = email ? emailToProfile.get(email) : undefined;
    if (profileId) {
      userMap.set(pid, profileId);
      stats.users.matched++;
    } else {
      unmatched.push(`${u.nickName ?? u.firstName ?? ''} <${u.email ?? 'no-email'}>`.trim());
    }
  }
  if (unmatched.length) {
    console.log(`   ⚠ ${unmatched.length} Planhat users have no matching Compass profile (owner links will be null):`);
    unmatched.slice(0, 20).forEach((u) => console.log(`     - ${u}`));
    if (unmatched.length > 20) console.log(`     … and ${unmatched.length - 20} more`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Step 2 — GET /companies → companies (+ health snapshot backfill)
// ════════════════════════════════════════════════════════════════════════════
function segmentFor(company: Rec): { tier: string | null; segment: string | null } {
  const tier = str(cf(company, 'Customer Tier'));
  let segment: string | null = null;
  if (tier === 'Enterprise') segment = 'enterprise';
  else if (tier === 'Mid-Market') segment = 'mid_touch';
  else if (tier === 'SMB') segment = 'scaled';
  const type = str(cf(company, 'Customer Type'));
  if (type === 'Scaled' || type === 'Pooled') segment = 'scaled'; // override
  return { tier, segment };
}

function lastTouchType(company: Rec): string | null {
  const byType = company.lastTouchByType;
  if (!byType || typeof byType !== 'object') return null;
  let best: string | null = null;
  let bestTime = -Infinity;
  for (const [k, v] of Object.entries(byType)) {
    const t = new Date(v as any).getTime();
    if (Number.isFinite(t) && t > bestTime) {
      bestTime = t;
      best = k;
    }
  }
  return best;
}

function mapStatus(v: any): string {
  const s = str(v)?.toLowerCase();
  if (s === 'prospect' || s === 'lead') return 'prospect';
  if (s === 'churned' || s === 'lost' || s === 'cancelled') return 'churned';
  return 'customer';
}

async function step2Companies() {
  console.log('② /companies → companies');
  const companies = await planhatGet('/companies');
  stats.companies.planhat = companies.length;

  const rows: Rec[] = [];
  const healthRows: Rec[] = [];
  const HEALTH_OFFSETS: [string, number][] = [
    ['Health Yesterday', 1],
    ['Health 7 days ago', 7],
    ['Health 14 days ago', 14],
    ['Health 30 days ago', 30],
    ['Health 60 days ago', 60],
  ];
  const nowMs = Date.now();

  for (const c of companies) {
    const cid = asId(c._id ?? c.id);
    if (!cid) continue;
    const domains = arr(c.domains).map((d) => str(d)).filter(Boolean);
    if (!domains.length) companiesWithoutDomains.push(str(c.name) ?? cid);

    const { tier, segment } = segmentFor(c);
    const csmScore = num(c.csmScore);
    const h = num(c.h);

    const row: Rec = {
      source: 'planhat',
      source_id: cid,
      name: str(c.name) ?? '(unnamed)',
      domains,
      website: str(c.web),
      country: str(c.country),
      city: str(c.city),
      phase: str(c.phase),
      status: mapStatus(c.status),
      tags: arr(c.tags).map((t) => str(t)).filter(Boolean),
      owner_id: resolveUser(c.owner ?? cf(c, 'CSM')),
      collaborator_ids: [...new Set([asId(c.coOwner), ...arr(c.collaborators).map(asId)])]
        .map((id) => (id ? userMap.get(id) ?? null : null))
        .filter(Boolean),
      segment,
      tier,
      region: str(cf(c, 'Region')),
      mrr: num(c.mrr),
      arr: num(c.arr),
      renewal_date: c.renewalDate ? dateOnly(c.renewalDate) : null,
      renewal_arr: num(c.renewalArr),
      value_score: csmScore != null ? Math.max(1, Math.min(10, csmScore * 2)) : null,
      value_comment: str(cf(c, 'CSM Score Notes')),
      sentiment_assessment: normSentiment(c.sentimentScore),
      red_flags: str(cf(c, 'Red Flags')),
      green_flags: str(cf(c, 'Green Flags')),
      next_step: str(cf(c, 'Next Step')),
      path_to_green: str(cf(c, 'Action Plan')),
      handover_notes: str(cf(c, 'Sales to CS - Handover')),
      ai_account_summary: str(cf(c, '(AI) Account Summary')),
      ai_risk_summary: str(cf(c, '(AI) Risk Summary')),
      ai_renewal_summary: str(cf(c, '(AI) Renewal Summary')),
      last_touch_at: c.lastTouch ? new Date(c.lastTouch).toISOString() : null,
      last_touch_type: lastTouchType(c),
      next_touch_at: c.nextTouch ? new Date(c.nextTouch).toISOString() : null,
    };
    // cached health from latest known health point (h), so portfolio shows day-one values
    if (h != null) {
      const score = Math.round(Math.max(0, Math.min(100, h * 10)));
      row.health_score = score;
      row.health_band = bandFor(score);
      row.health_updated_at = new Date().toISOString();
    }
    rows.push(row);

    // ── backfilled health_snapshots (sparkline history) ──
    const points: [number, number][] = []; // [offsetDays, score 0-100]
    if (h != null) points.push([0, Math.max(0, Math.min(100, h * 10))]);
    for (const [key, off] of HEALTH_OFFSETS) {
      const v = num(c.usage?.[key]);
      if (v != null) points.push([off, Math.max(0, Math.min(100, v * 10))]);
    }
    for (const [off, score] of points) {
      const rounded = Math.round(score);
      healthRows.push({
        source: 'planhat',
        // NB: health_snapshots has no source_id column; key is (company_id, snapshot_date).
        company_id: null, // set after companies upserted
        _cid: cid, // temp
        snapshot_date: dateOnly(nowMs - off * DAY_MS),
        is_weekly: false,
        overall: rounded,
        band: bandFor(rounded),
        delta_wow: null,
        dimensions: {},
      });
    }
  }

  const inserted = await upsert('companies', rows);
  companyMap = idMapBySourceId(inserted);
  stats.companies.compass = inserted.length;

  // resolve company_id on health snapshots now that we have the map
  const resolvedHealth = healthRows
    .map((r) => {
      const company_id = companyMap.get(r._cid);
      if (!company_id) return null;
      const { _cid, ...rest } = r;
      return { ...rest, company_id };
    })
    .filter(Boolean) as Rec[];
  await upsert('health_snapshots', resolvedHealth, ['company_id', 'snapshot_date']);
  stats.healthSnapshots += resolvedHealth.length;
}

// ════════════════════════════════════════════════════════════════════════════
// Step 3 — GET /endusers → contacts (+ enduser NPS)
// ════════════════════════════════════════════════════════════════════════════
const USER_TYPE_MAP: Record<string, string> = {
  'Exec Sponsor': 'exec_sponsor',
  'Decision Maker': 'decision_maker',
  'Main User': 'main_user',
  'Tech / Ops': 'tech_ops',
  'End User': 'end_user',
};

// endusers whose custom['Reporting To'] needs resolving in the second pass
const reportsToPending: { enduserId: string; reportsToPlanhatId: string }[] = [];
// enduser-derived NPS rows collected here, inserted after contacts exist
const enduserNps: Rec[] = [];

async function step3Contacts() {
  console.log('③ /endusers → contacts');
  const endusers = await planhatGet('/endusers');
  stats.contacts.planhat = endusers.length;

  const rows: Rec[] = [];
  for (const e of endusers) {
    const eid = asId(e._id ?? e.id);
    if (!eid) continue;
    const companyId = resolveCompany(e.companyId ?? e.company);
    if (!companyId) continue; // orphan contact — skip (no parent company migrated)

    rows.push({
      source: 'planhat',
      source_id: eid,
      company_id: companyId,
      first_name: str(e.firstName) ?? '',
      last_name: str(e.lastName) ?? '',
      email: str(e.email),
      other_emails: arr(e.otherEmails).map((x) => str(x)).filter(Boolean),
      phone: str(e.phone),
      title: str(e.position),
      department: str(cf(e, 'Department')),
      seniority: str(cf(e, 'Seniority')),
      linkedin_url: str(e.linkedInUrl ?? e.linkedinUrl),
      contact_role: USER_TYPE_MAP[str(cf(e, 'User Type')) ?? ''] ?? null,
      relationship_strength: num(cf(e, 'Relationship')),
      is_primary: bool(e.primary),
      is_champion: bool(e.featured),
      has_influence: bool(cf(e, 'Has Influence?')),
      is_advocate: bool(cf(e, 'Advocate?')),
      advocate_type: str(cf(e, 'Advocate Type')),
      sentiment_30d: str(cf(e, 'Sentiment Last 30 Days')),
      engagement_score: num(e.relevance) ?? num(e.beats),
      nps_latest: num(e.nps),
      nps_latest_at: e.npsDate ? new Date(e.npsDate).toISOString() : null,
      last_active_at: e.lastActive ? new Date(e.lastActive).toISOString() : null,
      archived: bool(e.archived),
    });

    const reportsTo = asId(cf(e, 'Reporting To'));
    if (reportsTo) reportsToPending.push({ enduserId: eid, reportsToPlanhatId: reportsTo });

    // enduser nps → nps_responses (deduped by its own source_id)
    const npsScore = num(e.nps);
    if (npsScore != null) {
      enduserNps.push({
        source: 'planhat',
        source_id: `${eid}:nps`,
        company_id: companyId,
        _enduserId: eid,
        score: Math.round(npsScore),
        comment: str(e.npsComment),
        responded_at: e.npsDate ? new Date(e.npsDate).toISOString() : new Date().toISOString(),
      });
    }
  }

  const inserted = await upsert('contacts', rows);
  contactMap = idMapBySourceId(inserted);
  stats.contacts.compass = inserted.length;

  // enduser-derived NPS now that contacts exist (contact_id resolvable)
  if (enduserNps.length) {
    const npsRows = enduserNps.map((r) => {
      const { _enduserId, ...rest } = r;
      return { ...rest, contact_id: contactMap.get(_enduserId) ?? null };
    });
    await upsert('nps_responses', npsRows);
    stats.nps.compass += npsRows.length;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Step 4 — GET /licenses → companies.mrr/arr + usage_metrics license_mrr
// ════════════════════════════════════════════════════════════════════════════
async function step4Licenses() {
  console.log('④ /licenses → companies.mrr/arr + usage_metrics(license_mrr)');
  const licenses = await planhatGet('/licenses');
  stats.licenses.planhat = licenses.length;

  const agg = new Map<string, { mrr: number; arr: number }>(); // compass company id → totals
  const usageRows: Rec[] = [];

  for (const l of licenses) {
    const companyId = resolveCompany(l.companyId ?? l.company);
    if (!companyId) continue;
    const mrr = num(l.mrr) ?? 0;
    const arrVal = num(l.arr) ?? (num(l.value) ?? 0);
    const cur = agg.get(companyId) ?? { mrr: 0, arr: 0 };
    cur.mrr += mrr;
    cur.arr += arrVal || mrr * 12;
    agg.set(companyId, cur);

    const when = l.fromDate ?? l.startDate ?? l.date ?? l.createdAt;
    // usage_metrics key is (company_id, metric_key, metric_date); no source_id column.
    // Multiple licences for one company on the same date collapse to one row (last wins).
    usageRows.push({
      company_id: companyId,
      metric_key: 'license_mrr',
      metric_date: dateOnly(when ?? Date.now()),
      value: mrr,
    });
  }

  // update company mrr/arr (partial update by id — never wipes other columns)
  for (const [companyId, totals] of agg) {
    const { error } = await sb
      .from('companies')
      .update({ mrr: totals.mrr, arr: Math.round(totals.arr) })
      .eq('id', companyId);
    if (error) throw new Error(`update company license totals: ${error.message}`);
    stats.licenses.companiesUpdated++;
  }
  if (usageRows.length) {
    await upsert('usage_metrics', usageRows, ['company_id', 'metric_key', 'metric_date']);
    stats.usageMetrics += usageRows.length;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Step 5 — GET /opportunities → deals
// ════════════════════════════════════════════════════════════════════════════
const QUAL_KEYS = [
  'Champion',
  'Economic Buyer',
  'Decision Criteria',
  'Decision Process',
  'Identify Pain',
  'Metrics',
  'Budget',
  'Need',
  'Timeline',
  'Authority',
];

function mapDealStatus(o: Rec): string {
  const s = str(o.status)?.toLowerCase();
  if (s === 'won' || s === 'closed won') return 'won';
  if (s === 'lost' || s === 'closed lost') return 'lost';
  return 'open';
}

async function step5Opportunities() {
  console.log('⑤ /opportunities → deals');
  const opps = await planhatGet('/opportunities');
  stats.deals.planhat = opps.length;

  const rows: Rec[] = [];
  for (const o of opps) {
    const oid = asId(o._id ?? o.id);
    const companyId = resolveCompany(o.companyId ?? o.company);
    if (!oid || !companyId) continue;

    const status = mapDealStatus(o);
    const amount = num(o.arr) ?? (num(o.mrr) != null ? num(o.mrr)! * 12 : null);
    // dealDate is the forecast close; closeDate overrides when won/lost
    const closeSrc = (status === 'won' || status === 'lost') && o.closeDate ? o.closeDate : o.dealDate ?? o.closeDate;

    const qualification: Rec = {};
    for (const k of QUAL_KEYS) {
      const v = cf(o, k);
      if (v != null && v !== '') qualification[k] = v;
    }

    const contactIds = [asId(cf(o, 'Decision Maker')), ...arr(cf(o, 'Involved Contacts')).map(asId)]
      .map((id) => (id ? contactMap.get(id) ?? null : null))
      .filter(Boolean);

    rows.push({
      source: 'planhat',
      source_id: oid,
      company_id: companyId,
      name: str(o.title) ?? '(untitled deal)',
      pipeline: snakeLower(cf(o, 'Pipeline')) ?? 'new_business',
      stage: str(o.salesStage),
      forecast_category: snakeLower(cf(o, 'Forecast Category')),
      amount,
      currency: str(o.currency) ?? 'USD',
      close_date: closeSrc ? dateOnly(closeSrc) : null,
      owner_id: resolveUser(o.ownerId ?? o.owner),
      status,
      next_steps: str(cf(o, 'Next Steps')),
      ai_summary: str(cf(o, 'Summary')),
      confidence: num(cf(o, '(AI) Confidence Score')),
      qualification,
      contact_ids: [...new Set(contactIds)],
    });
  }

  const inserted = await upsert('deals', rows);
  stats.deals.compass = inserted.length;
}

// ════════════════════════════════════════════════════════════════════════════
// Step 6 — GET /conversations → activities
// ════════════════════════════════════════════════════════════════════════════
function convType(t: any): string {
  const s = str(t)?.toLowerCase();
  if (s === 'email') return 'email';
  if (s === 'call') return 'call';
  if (s === 'chat' || s === 'ticket') return 'ticket';
  return 'note'; // note/custom/anything else
}

async function step6Conversations() {
  console.log('⑥ /conversations → activities');
  const convs = await planhatGet('/conversations');
  stats.activities.planhat = convs.length;

  const rows: Rec[] = [];
  for (const c of convs) {
    const cid = asId(c._id ?? c.id);
    const companyId = resolveCompany(c.companyId ?? c.company);
    if (!cid || !companyId) continue;

    const userId = arr(c.users).map(resolveUser).find(Boolean) ?? null;
    const contactIds = arr(c.endUsers).map(resolveContact).filter(Boolean);
    const occurred = c.date ?? c.createdAt ?? c.updatedAt;

    rows.push({
      source: 'planhat',
      source_id: cid,
      company_id: companyId,
      user_id: userId,
      contact_ids: [...new Set(contactIds)],
      type: convType(c.type),
      title: str(c.subject) ?? str(c.snip) ?? '(no subject)',
      snippet: str(c.snip) ?? str(c.subject),
      occurred_at: occurred ? new Date(occurred).toISOString() : new Date().toISOString(),
      meta: {},
    });
  }

  const inserted = await upsert('activities', rows);
  stats.activities.compass = inserted.length;
}

// ════════════════════════════════════════════════════════════════════════════
// Step 7 — GET /tasks → tasks (open + completed in last 12 months)
// ════════════════════════════════════════════════════════════════════════════
async function step7Tasks() {
  console.log('⑦ /tasks → tasks (open + completed ≤12mo)');
  const tasks = await planhatGet('/tasks');
  stats.tasks.planhat = tasks.length;
  const cutoff = Date.now() - 365 * DAY_MS;

  const rows: Rec[] = [];
  for (const t of tasks) {
    const tid = asId(t._id ?? t.id);
    const companyId = resolveCompany(t.companyId ?? t.company);
    if (!tid || !companyId) continue;

    const completedRaw = t.completedDate ?? (bool(t.done) || bool(t.completed) ? t.updatedAt : null);
    const completedAt = completedRaw ? new Date(completedRaw).getTime() : null;
    // keep open tasks, plus completed within the last 12 months
    if (completedAt != null && completedAt < cutoff) continue;

    const due = t.dueDate ?? t.date;
    const priorityRaw = str(t.priority)?.toLowerCase();
    const priority = priorityRaw === 'high' || priorityRaw === 'low' ? priorityRaw : 'normal';

    rows.push({
      source: 'planhat',
      source_id: tid,
      company_id: companyId,
      title: str(t.task) ?? str(t.title) ?? str(t.name) ?? '(task)',
      description: str(t.description),
      due_date: due ? dateOnly(due) : null,
      completed_at: completedAt != null ? new Date(completedAt).toISOString() : null,
      assignee_id: resolveUser(t.mainOwner ?? t.ownerId ?? t.owner ?? t.assignee),
      creator_id: resolveUser(t.createdBy ?? t.mainOwner ?? t.owner),
      priority,
      origin: 'manual',
    });
  }

  const inserted = await upsert('tasks', rows);
  stats.tasks.compass = inserted.length;
}

// ════════════════════════════════════════════════════════════════════════════
// Step 8 — GET /nps → nps_responses
// ════════════════════════════════════════════════════════════════════════════
async function step8Nps() {
  console.log('⑧ /nps → nps_responses');
  const nps = await planhatGet('/nps');
  stats.nps.planhat = nps.length;

  const rows: Rec[] = [];
  for (const n of nps) {
    const nid = asId(n._id ?? n.id);
    const companyId = resolveCompany(n.companyId ?? n.company);
    const score = num(n.score);
    if (!nid || !companyId || score == null) continue;
    rows.push({
      source: 'planhat',
      source_id: nid,
      company_id: companyId,
      contact_id: resolveContact(n.endUserId ?? n.contactId ?? n.enduser),
      score: Math.round(score),
      comment: str(n.comment ?? n.feedback),
      responded_at: (n.date ?? n.createdAt) ? new Date(n.date ?? n.createdAt).toISOString() : new Date().toISOString(),
    });
  }

  const inserted = await upsert('nps_responses', rows);
  stats.nps.compass += inserted.length;
}

// ════════════════════════════════════════════════════════════════════════════
// Step 9 — GET /objectives → success_plans + success_plan_objectives
// ════════════════════════════════════════════════════════════════════════════
function mapObjectiveStatus(v: any): string {
  const s = str(v)?.toLowerCase() ?? '';
  if (s.includes('achiev') || s.includes('complet') || s.includes('done')) return 'achieved';
  if (s.includes('miss') || s.includes('fail')) return 'missed';
  if (s.includes('risk')) return 'at_risk';
  if (s.includes('track') || s.includes('progress') || s.includes('active')) return 'on_track';
  return 'not_started';
}

async function step9Objectives() {
  console.log('⑨ /objectives → success_plans + objectives');
  const objectives = await planhatGet('/objectives');
  stats.objectives.planhat = objectives.length;

  // group objectives by company
  const byCompany = new Map<string, Rec[]>();
  for (const o of objectives) {
    const companyId = resolveCompany(o.companyId ?? o.company);
    if (!companyId) continue;
    if (!byCompany.has(companyId)) byCompany.set(companyId, []);
    byCompany.get(companyId)!.push(o);
  }

  // one "Migrated success plan" per company that has objectives
  const planRows: Rec[] = [];
  for (const [companyId, objs] of byCompany) {
    const owner = objs.map((o) => resolveUser(o.ownerId ?? o.owner)).find(Boolean) ?? null;
    planRows.push({
      source: 'planhat',
      source_id: `${companyId}:migrated-plan`,
      company_id: companyId,
      name: 'Migrated success plan',
      owner_id: owner,
      status: 'active',
    });
  }
  const insertedPlans = await upsert('success_plans', planRows);
  stats.objectives.plans = insertedPlans.length;
  const planByCompany = new Map<string, string>(); // compass company id → plan id
  for (const p of insertedPlans) planByCompany.set(p.company_id, p.id);

  const objRows: Rec[] = [];
  for (const [companyId, objs] of byCompany) {
    const planId = planByCompany.get(companyId);
    if (!planId) continue;
    objs.forEach((o, i) => {
      const oid = asId(o._id ?? o.id);
      if (!oid) return;
      objRows.push({
        source: 'planhat',
        source_id: oid,
        plan_id: planId,
        company_id: companyId,
        title: str(o.name) ?? str(o.title) ?? '(objective)',
        business_outcome: str(o.description ?? cf(o, 'Business Outcome')),
        metric: str(cf(o, 'Metric')),
        target_date: (o.dueDate ?? o.targetDate) ? dateOnly(o.dueDate ?? o.targetDate) : null,
        status: mapObjectiveStatus(o.status),
        position: i,
        notes: str(o.notes),
      });
    });
  }
  const insertedObjs = await upsert('success_plan_objectives', objRows);
  stats.objectives.objectives = insertedObjs.length;
}

// ════════════════════════════════════════════════════════════════════════════
// Step 10 — GET /churn → status='churned' + system activity
// ════════════════════════════════════════════════════════════════════════════
async function step10Churn() {
  console.log('⑩ /churn → churned status + system activity');
  const churns = await planhatGet('/churn');
  stats.churn.planhat = churns.length;

  const activityRows: Rec[] = [];
  const churnedCompanyIds = new Set<string>();

  for (const ch of churns) {
    const chid = asId(ch._id ?? ch.id) ?? `${asId(ch.companyId)}:churn`;
    const companyId = resolveCompany(ch.companyId ?? ch.company);
    if (!companyId) continue;
    churnedCompanyIds.add(companyId);
    const reason = str(ch.reason ?? ch.churnReason ?? ch.comment) ?? 'No reason recorded';
    const when = ch.date ?? ch.churnDate ?? ch.createdAt;
    activityRows.push({
      source: 'planhat',
      source_id: `${chid}:churn-activity`,
      company_id: companyId,
      type: 'system',
      title: 'Account churned',
      snippet: `Churn reason: ${reason}`,
      occurred_at: when ? new Date(when).toISOString() : new Date().toISOString(),
      meta: { churnReason: reason },
    });
  }

  for (const companyId of churnedCompanyIds) {
    const { error } = await sb.from('companies').update({ status: 'churned' }).eq('id', companyId);
    if (error) throw new Error(`churn status update: ${error.message}`);
    stats.churn.companiesChurned++;
  }
  if (activityRows.length) {
    const inserted = await upsert('activities', activityRows);
    stats.activities.compass += inserted.length;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Step 11 — GET /customfields → verify mapping, warn on drift
// ════════════════════════════════════════════════════════════════════════════
const EXPECTED_COMPANY_FIELDS = [
  'Customer Tier',
  'Customer Type',
  'Region',
  'CSM',
  'CSM Score Notes',
  'Red Flags',
  'Green Flags',
  'Next Step',
  'Action Plan',
  'Sales to CS - Handover',
  '(AI) Account Summary',
  '(AI) Risk Summary',
  '(AI) Renewal Summary',
];
const EXPECTED_ENDUSER_FIELDS = [
  'User Type',
  'Relationship',
  'Has Influence?',
  'Advocate?',
  'Advocate Type',
  'Department',
  'Seniority',
  'Reporting To',
  'Sentiment Last 30 Days',
];

async function step11CustomFields() {
  console.log('⑪ /customfields → verify mapping (drift check)');
  for (const [parent, expected] of [
    ['Company', EXPECTED_COMPANY_FIELDS],
    ['EndUser', EXPECTED_ENDUSER_FIELDS],
  ] as const) {
    let defs: Rec[] = [];
    try {
      const res = await planhatGetRaw('/customfields', { parent });
      defs = Array.isArray(res) ? res : res?.data ?? [];
    } catch (e) {
      driftWarnings.push(`Could not fetch custom fields for ${parent}: ${e instanceof Error ? e.message : e}`);
      continue;
    }
    const present = new Set(defs.map((d) => str(d.name)).filter(Boolean));
    const missing = expected.filter((f) => !present.has(f));
    if (missing.length) {
      for (const m of missing) driftWarnings.push(`${parent}: expected custom field "${m}" not found in tenant`);
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Step 12 — GET /dimensiondata → usage_metrics
// ════════════════════════════════════════════════════════════════════════════
function extractDimensionPoints(res: any): { date: string; value: number }[] {
  const out: { date: string; value: number }[] = [];
  const rows: any[] = Array.isArray(res) ? res : res?.data ?? [];
  for (const r of rows) {
    // nested { data: [...] } series
    if (Array.isArray(r?.data)) {
      for (const p of r.data) pushPoint(p, out);
      continue;
    }
    pushPoint(r, out);
  }
  return out;
}
function pushPoint(p: any, out: { date: string; value: number }[]) {
  if (p == null) return;
  if (Array.isArray(p) && p.length >= 2) {
    // [timestamp|days, value]
    const t = Number(p[0]);
    const v = num(p[1]);
    if (v == null) return;
    const ms = t > 1e11 ? t : t * DAY_MS; // epoch-ms vs days-since-epoch
    out.push({ date: dateOnly(ms), value: v });
    return;
  }
  const v = num(p.value ?? p.v ?? p.count ?? p.y);
  if (v == null) return;
  const rawDate = p.date ?? p.day ?? p.d ?? p.time ?? p.x;
  let iso: string;
  if (typeof rawDate === 'number') iso = dateOnly(rawDate > 1e11 ? rawDate : rawDate * DAY_MS);
  else iso = rawDate ? dateOnly(rawDate) : dateOnly(Date.now());
  out.push({ date: iso, value: v });
}

async function step12DimensionData() {
  if (!MIGRATE_DIMENSION_IDS.length) {
    console.log('⑫ /dimensiondata → skipped (MIGRATE_DIMENSION_IDS not set)');
    return;
  }
  console.log(`⑫ /dimensiondata → usage_metrics (${MIGRATE_DIMENSION_IDS.length} dimension(s))`);
  const to = daysSinceEpoch(Date.now());
  const from = to - 365; // last 12 months

  const usageRows: Rec[] = [];
  let done = 0;
  for (const [planhatCompanyId, compassCompanyId] of companyMap) {
    for (const dimid of MIGRATE_DIMENSION_IDS) {
      let res: any;
      try {
        res = await planhatGetRaw('/dimensiondata', { cId: planhatCompanyId, dimid, from, to });
      } catch (e) {
        driftWarnings.push(`dimensiondata ${dimid} for ${planhatCompanyId}: ${e instanceof Error ? e.message : e}`);
        continue;
      }
      for (const pt of extractDimensionPoints(res)) {
        // usage_metrics key is (company_id, metric_key, metric_date); no source_id column.
        usageRows.push({
          company_id: compassCompanyId,
          metric_key: dimid,
          metric_date: pt.date,
          value: pt.value,
        });
      }
    }
    done++;
    if (done % 50 === 0) console.log(`     …${done}/${companyMap.size} companies`);
    // flush periodically to bound memory
    if (usageRows.length >= 2000) {
      const batch = usageRows.splice(0, usageRows.length);
      await upsert('usage_metrics', batch, ['company_id', 'metric_key', 'metric_date']);
      stats.usageMetrics += batch.length;
    }
  }
  if (usageRows.length) {
    await upsert('usage_metrics', usageRows, ['company_id', 'metric_key', 'metric_date']);
    stats.usageMetrics += usageRows.length;
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Second pass — reports_to_contact_id (needs all contacts to exist)
// ════════════════════════════════════════════════════════════════════════════
async function secondPassReportsTo() {
  console.log('↩ second pass → contacts.reports_to_contact_id');
  const rows: Rec[] = [];
  for (const { enduserId, reportsToPlanhatId } of reportsToPending) {
    const target = contactMap.get(reportsToPlanhatId);
    if (!target) continue;
    rows.push({ source: 'planhat', source_id: enduserId, reports_to_contact_id: target });
  }
  if (rows.length) await upsert('contacts', rows); // partial upsert updates only reports_to
  console.log(`   resolved ${rows.length} reporting relationships`);
}

// ════════════════════════════════════════════════════════════════════════════
// Reconciliation report
// ════════════════════════════════════════════════════════════════════════════
function printReport() {
  const line = '─'.repeat(60);
  console.log(`\n${line}\n  RECONCILIATION REPORT\n${line}`);
  const row = (label: string, planhat: number | string, compass: number | string) =>
    console.log(`  ${label.padEnd(22)} planhat=${String(planhat).padStart(6)}   compass=${String(compass).padStart(6)}`);

  row('users → profiles', stats.users.planhat, stats.users.matched);
  row('companies', stats.companies.planhat, stats.companies.compass);
  row('contacts', stats.contacts.planhat, stats.contacts.compass);
  row('deals', stats.deals.planhat, stats.deals.compass);
  row('activities', stats.activities.planhat, stats.activities.compass);
  row('tasks', stats.tasks.planhat, stats.tasks.compass);
  row('nps', stats.nps.planhat, stats.nps.compass);
  row('objectives', stats.objectives.planhat, stats.objectives.objectives);
  console.log(
    `  ${'success plans'.padEnd(22)} created=${String(stats.objectives.plans).padStart(6)}`
  );
  row('licenses', stats.licenses.planhat, `${stats.licenses.companiesUpdated} co. updated`);
  row('churn', stats.churn.planhat, `${stats.churn.companiesChurned} churned`);
  console.log(`  ${'health_snapshots'.padEnd(22)} backfilled=${String(stats.healthSnapshots).padStart(6)}`);
  console.log(`  ${'usage_metrics'.padEnd(22)} inserted=${String(stats.usageMetrics).padStart(6)}`);

  console.log(`\n  Unmatched Planhat owners (no Compass profile): ${unmatchedOwners.size}`);
  if (unmatchedOwners.size) {
    [...unmatchedOwners].slice(0, 20).forEach((id) => console.log(`     - planhat user _id ${id}`));
    if (unmatchedOwners.size > 20) console.log(`     … and ${unmatchedOwners.size - 20} more`);
    console.log('     → assign these CSMs in Admin → Users, then re-run to link ownership.');
  }

  console.log(`\n  Companies WITHOUT domains (breaks email matching): ${companiesWithoutDomains.length}`);
  companiesWithoutDomains.slice(0, 30).forEach((n) => console.log(`     - ${n}`));
  if (companiesWithoutDomains.length > 30) console.log(`     … and ${companiesWithoutDomains.length - 30} more`);

  console.log(`\n  Custom-field drift warnings: ${driftWarnings.length}`);
  driftWarnings.slice(0, 30).forEach((w) => console.log(`     ⚠ ${w}`));
  if (driftWarnings.length > 30) console.log(`     … and ${driftWarnings.length - 30} more`);
  console.log(`${line}\n  Migration complete. Re-run any time — it is idempotent.\n${line}\n`);
}

// ════════════════════════════════════════════════════════════════════════════
// V1.1 targeted backfills (run via --only). Map Compass company by source_id.
// ════════════════════════════════════════════════════════════════════════════
async function compassCompanyIdBySourceId(): Promise<Map<string, string>> {
  const { data } = await sb.from('companies').select('id, source_id').eq('source', 'planhat');
  return new Map((data ?? []).filter((c: Rec) => c.source_id).map((c: Rec) => [String(c.source_id), c.id as string]));
}

// Latest news from Planhat custom field "(AI) Latest News" → companies.latest_news.
async function stepNewsBackfill() {
  console.log('▶ [news-backfill] pulling (AI) Latest News from Planhat custom fields…');
  const companies = await planhatGet('/companies');
  const byId = await compassCompanyIdBySourceId();
  let updated = 0;
  for (const co of companies) {
    const custom: Rec = co.custom ?? {};
    const news = custom['(AI) Latest News'] ?? custom['AI Latest News'] ?? null;
    const compassId = byId.get(String(co._id));
    if (!news || !compassId) continue;
    await sb.from('companies').update({
      latest_news: String(news),
      latest_news_at: new Date().toISOString(),
      latest_news_sources: [],
    }).eq('id', compassId);
    updated++;
  }
  console.log(`   updated latest_news on ${updated} companies`);
}

// Product statuses from Planhat custom fields of the same names → company_products.
async function stepWhitespace() {
  console.log('▶ [whitespace] backfilling company_products from Planhat product fields…');
  const VALUE_MAP: Record<string, string> = { 'Current Product': 'current', 'Active Opp': 'active_opp', 'Need To Discuss': 'need_to_discuss', 'Rejected': 'rejected' };
  const PRODUCT_NAMES = ['Core Licence', 'SEO Intelligence', 'Traffic Monitor', 'Conversion Optimiser', 'Consulting Services', 'SEO Consulting'];
  const { data: products } = await sb.from('products').select('id, name');
  const productByName = new Map((products ?? []).map((p: Rec) => [p.name as string, p.id as string]));
  const byId = await compassCompanyIdBySourceId();
  const companies = await planhatGet('/companies');
  let rows = 0;
  for (const co of companies) {
    const compassId = byId.get(String(co._id));
    if (!compassId) continue;
    const custom: Rec = co.custom ?? {};
    for (const name of PRODUCT_NAMES) {
      const raw = custom[name];
      const productId = productByName.get(name);
      if (!raw || !productId) continue;
      const status = VALUE_MAP[String(raw)] ?? 'none';
      await sb.from('company_products').upsert(
        { company_id: compassId, product_id: productId, status },
        { onConflict: 'company_id,product_id' }
      );
      rows++;
    }
  }
  console.log(`   upserted ${rows} company_products rows`);
}

// ════════════════════════════════════════════════════════════════════════════
async function main() {
  if (ONLY) {
    console.log(`▶ Planhat → Compass migration (only: ${ONLY})…\n`);
    if (ONLY === 'nps') await step8Nps();
    else if (ONLY === 'news-backfill') await stepNewsBackfill();
    else if (ONLY === 'whitespace') await stepWhitespace();
    else { console.error(`✖ Unknown --only step "${ONLY}". Use: nps | news-backfill | whitespace`); process.exit(1); }
    console.log('\n✔ Targeted backfill complete (idempotent — re-run any time).');
    return;
  }
  console.log('▶ Planhat → Compass migration starting…\n');
  await step1Users();
  await step2Companies();
  await step3Contacts();
  await step4Licenses();
  await step5Opportunities();
  await step6Conversations();
  await step7Tasks();
  await step8Nps();
  await step9Objectives();
  await step10Churn();
  await step11CustomFields();
  await step12DimensionData();
  await secondPassReportsTo();
  printReport();
}

main().catch((err) => {
  console.error('\n✖ Migration failed:', err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});

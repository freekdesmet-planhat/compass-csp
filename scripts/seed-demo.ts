/**
 * scripts/seed-demo.ts — populate a convincing demo book in Postgres (acceptance #14).
 *
 * Reuses the exact in-browser generator (src/lib/demo/generate.ts) so the DB-backed
 * app and the credential-free demo mode show the *same* book of business, then maps
 * every camelCase object to its snake_case DB columns and upserts via the service-role
 * client. Idempotent: re-runs create zero duplicates (stable primary keys derived from
 * the generator's object ids; also carries source='app', source_id=<object id>).
 *
 * Run with env set, e.g.:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run seed:demo
 *   # or: node --env-file=.env node_modules/.bin/tsx scripts/seed-demo.ts
 *
 * NOTE ON PROFILES: in production, `profiles` rows are created on first Google sign-in
 * (they 1:1 reference auth.users). This seed BYPASSES auth for demo purposes and inserts
 * profiles rows directly with deterministic UUIDs. If your schema enforces the
 * profiles.id -> auth.users(id) FK, make that FK deferrable / drop it in the demo
 * migration, or pre-create matching auth.users — see README.
 */

import { createHash } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { generateDemoData, type DemoDataset } from '../src/lib/demo/generate';

// ── env ──────────────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    '\n✖ Missing required environment variables.\n' +
      '  Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before running.\n' +
      '  e.g.  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run seed:demo\n' +
      '  or    node --env-file=.env node_modules/.bin/tsx scripts/seed-demo.ts\n'
  );
  process.exit(1);
}

const sb: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ── stable id → uuid (deterministic, so re-runs upsert the same rows) ─────────
// SHA-1 based UUID (v5-style): stable across runs for a given input string.
const uuidCache = new Map<string, string>();
function toUuid(input: string | null | undefined): string | null {
  if (input == null) return null;
  const cached = uuidCache.get(input);
  if (cached) return cached;
  const h = createHash('sha1').update(input).digest();
  const b = Buffer.from(h.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x50; // version 5
  b[8] = (b[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = b.toString('hex');
  const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  uuidCache.set(input, uuid);
  return uuid;
}
const ids = (arr: string[] | undefined | null): string[] => (arr ?? []).map((x) => toUuid(x)!).filter(Boolean);

// ── upsert helper (chunked, idempotent on primary key `id`) ───────────────────
async function insertRows(table: string, rows: Record<string, unknown>[]): Promise<number> {
  if (!rows.length) return 0;
  let n = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error } = await sb.from(table).upsert(chunk, { onConflict: 'id' });
    if (error) {
      throw new Error(`upsert ${table} [rows ${i}..${i + chunk.length}]: ${error.message}`);
    }
    n += chunk.length;
  }
  return n;
}

// ── digest content references object ids — remap them to the uuid space ───────
function mapDigestContent(content: any): any {
  const c = structuredClone(content);
  c.meetings?.forEach((m: any) => {
    if (m.companyId) m.companyId = toUuid(m.companyId);
    if (m.calendarEventId) m.calendarEventId = toUuid(m.calendarEventId);
  });
  c.tasksDue?.forEach((t: any) => {
    if (t.id) t.id = toUuid(t.id);
    if (t.companyId) t.companyId = toUuid(t.companyId);
  });
  c.unprocessedActionItems?.forEach((u: any) => {
    if (u.companyId) u.companyId = toUuid(u.companyId);
  });
  c.alerts?.forEach((a: any) => {
    if (a.id) a.id = toUuid(a.id);
    if (a.companyId) a.companyId = toUuid(a.companyId);
  });
  c.healthMovers?.forEach((h: any) => {
    if (h.companyId) h.companyId = toUuid(h.companyId);
  });
  c.renewalCheckpoints?.forEach((r: any) => {
    if (r.companyId) r.companyId = toUuid(r.companyId);
  });
  return c;
}

// ── mappers: camelCase demo object → snake_case DB row ────────────────────────
function mapProfiles(ds: DemoDataset) {
  return ds.profiles.map((p) => ({
    id: toUuid(p.id),
    email: p.email,
    full_name: p.fullName,
    avatar_url: p.avatarUrl ?? null,
    role: p.role,
    segment: p.segment,
    manager_id: toUuid(p.managerId ?? null),
    timezone: p.timezone,
    digest_hour: p.digestHour,
    is_active: p.isActive,
  }));
}

function mapCompanies(ds: DemoDataset) {
  return ds.companies.map((c) => ({
    id: toUuid(c.id),
    name: c.name,
    domains: c.domains,
    website: c.website ?? null,
    country: c.country ?? null,
    city: c.city ?? null,
    owner_id: toUuid(c.ownerId),
    collaborator_ids: ids(c.collaboratorIds),
    segment: c.segment,
    phase: c.phase ?? null,
    status: c.status,
    tier: c.tier ?? null,
    region: c.region ?? null,
    tags: c.tags ?? [],
    mrr: c.mrr ?? null,
    arr: c.arr ?? null,
    renewal_date: c.renewalDate ?? null,
    renewal_arr: c.renewalArr ?? null,
    hubspot_company_id: c.hubspotCompanyId ?? null,
    health_score: c.healthScore,
    health_band: c.healthBand,
    health_delta_wow: c.healthDeltaWow,
    health_updated_at: c.healthUpdatedAt ?? null,
    value_score: c.valueScore ?? null,
    value_comment: c.valueComment ?? null,
    sentiment_assessment: c.sentimentAssessment ?? null,
    exec_relationship_flag: c.execRelationshipFlag,
    red_flags: c.redFlags ?? null,
    green_flags: c.greenFlags ?? null,
    next_step: c.nextStep ?? null,
    path_to_green: c.pathToGreen ?? null,
    handover_notes: c.handoverNotes ?? null,
    ai_account_summary: c.aiAccountSummary ?? null,
    ai_risk_summary: c.aiRiskSummary ?? null,
    ai_renewal_summary: c.aiRenewalSummary ?? null,
    last_touch_at: c.lastTouchAt ?? null,
    last_touch_type: c.lastTouchType ?? null,
    next_touch_at: c.nextTouchAt ?? null,
    source: 'app',
    source_id: c.id,
  }));
}

function mapContacts(ds: DemoDataset) {
  return ds.contacts.map((c) => ({
    id: toUuid(c.id),
    company_id: toUuid(c.companyId),
    first_name: c.firstName,
    last_name: c.lastName,
    email: c.email ?? null,
    other_emails: c.otherEmails ?? [],
    phone: c.phone ?? null,
    title: c.title ?? null,
    department: c.department ?? null,
    seniority: c.seniority ?? null,
    linkedin_url: c.linkedinUrl ?? null,
    contact_role: c.contactRole ?? null,
    relationship_strength: c.relationshipStrength ?? null,
    is_primary: c.isPrimary,
    is_champion: c.isChampion,
    has_influence: c.hasInfluence,
    is_advocate: c.isAdvocate,
    advocate_type: c.advocateType ?? null,
    reports_to_contact_id: toUuid(c.reportsToContactId ?? null),
    nps_latest: c.npsLatest ?? null,
    nps_latest_at: c.npsLatestAt ?? null,
    sentiment_30d: c.sentiment30d ?? null,
    engagement_score: c.engagementScore ?? null,
    last_active_at: c.lastActiveAt ?? null,
    last_touch_at: c.lastTouchAt ?? null,
    archived: c.archived,
    source: 'app',
    source_id: c.id,
  }));
}

function mapActivities(ds: DemoDataset) {
  return ds.activities.map((a) => ({
    id: toUuid(a.id),
    company_id: toUuid(a.companyId),
    contact_ids: ids(a.contactIds),
    user_id: toUuid(a.userId ?? null),
    type: a.type,
    direction: a.direction ?? null,
    title: a.title,
    snippet: a.snippet ?? null,
    occurred_at: a.occurredAt,
    meta: a.meta ?? {},
    source: 'app',
    source_id: a.id,
  }));
}

function mapDeals(ds: DemoDataset) {
  return ds.deals.map((d) => ({
    id: toUuid(d.id),
    company_id: toUuid(d.companyId),
    hubspot_deal_id: d.hubspotDealId ?? null,
    pipeline: d.pipeline,
    stage: d.stage ?? null,
    stage_probability: d.stageProbability ?? null,
    forecast_category: d.forecastCategory ?? null,
    name: d.name,
    amount: d.amount ?? null,
    currency: d.currency,
    close_date: d.closeDate ?? null,
    owner_id: toUuid(d.ownerId ?? null),
    status: d.status,
    next_steps: d.nextSteps ?? null,
    ai_summary: d.aiSummary ?? null,
    confidence: d.confidence ?? null,
    qualification: d.qualification ?? {},
    suggested_stage: d.suggestedStage ?? null,
    suggested_stage_reason: d.suggestedStageReason ?? null,
    contact_ids: ids(d.contactIds),
    last_synced_at: d.lastSyncedAt ?? null,
    source: 'app',
    source_id: d.id,
  }));
}

function mapHealthSnapshots(ds: DemoDataset) {
  return ds.healthSnapshots.map((h) => ({
    id: toUuid(h.id),
    company_id: toUuid(h.companyId),
    snapshot_date: h.snapshotDate,
    is_weekly: h.isWeekly,
    overall: h.overall,
    band: h.band,
    delta_wow: h.deltaWow,
    dimensions: h.dimensions ?? {},
    explanation: h.explanation ?? null,
    recommendations: h.recommendations ?? null,
    source: h.source ?? 'app',
    source_id: h.id,
  }));
}

function mapTasks(ds: DemoDataset) {
  return ds.tasks.map((t) => ({
    id: toUuid(t.id),
    company_id: toUuid(t.companyId),
    assignee_id: toUuid(t.assigneeId ?? null),
    creator_id: toUuid(t.creatorId ?? null),
    title: t.title,
    description: t.description ?? null,
    due_date: t.dueDate ?? null,
    completed_at: t.completedAt ?? null,
    priority: t.priority,
    origin: t.origin,
    source_activity_id: toUuid(t.sourceActivityId ?? null),
    success_plan_objective_id: toUuid(t.successPlanObjectiveId ?? null),
    source: 'app',
    source_id: t.id,
  }));
}

function mapAlertRules(ds: DemoDataset) {
  return ds.alertRules.map((r) => ({
    id: toUuid(r.id),
    name: r.name,
    description: r.description ?? null,
    rule_type: r.ruleType,
    config: r.config ?? {},
    segment: r.segment,
    enabled: r.enabled,
    severity: r.severity,
  }));
}

function mapAlerts(ds: DemoDataset) {
  return ds.alerts.map((a) => ({
    id: toUuid(a.id),
    rule_id: toUuid(a.ruleId ?? null),
    company_id: toUuid(a.companyId),
    owner_id: toUuid(a.ownerId ?? null),
    title: a.title,
    detail: a.detail ?? null,
    severity: a.severity,
    status: a.status,
    snoozed_until: a.snoozedUntil ?? null,
    dedupe_key: a.dedupeKey ?? null,
    created_at: a.createdAt,
  }));
}

function mapSuccessPlans(ds: DemoDataset) {
  return ds.successPlans.map((p) => ({
    id: toUuid(p.id),
    company_id: toUuid(p.companyId),
    name: p.name,
    owner_id: toUuid(p.ownerId ?? null),
    status: p.status,
    target_date: p.targetDate ?? null,
    progress_pct: p.progressPct,
  }));
}

function mapObjectives(ds: DemoDataset) {
  return ds.objectives.map((o) => ({
    id: toUuid(o.id),
    plan_id: toUuid(o.planId),
    company_id: toUuid(o.companyId),
    title: o.title,
    business_outcome: o.businessOutcome ?? null,
    metric: o.metric ?? null,
    target_date: o.targetDate ?? null,
    status: o.status,
    position: o.position,
    notes: o.notes ?? null,
  }));
}

function mapNps(ds: DemoDataset) {
  return ds.npsResponses.map((n) => ({
    id: toUuid(n.id),
    company_id: toUuid(n.companyId),
    contact_id: toUuid(n.contactId ?? null),
    score: n.score,
    comment: n.comment ?? null,
    responded_at: n.respondedAt,
  }));
}

function mapCsat(ds: DemoDataset) {
  return ds.csatResponses.map((n) => ({
    id: toUuid(n.id),
    company_id: toUuid(n.companyId),
    contact_id: toUuid(n.contactId ?? null),
    score: n.score,
    comment: n.comment ?? null,
    responded_at: n.respondedAt,
    context: n.context ?? null,
  }));
}

function mapTickets(ds: DemoDataset) {
  return ds.tickets.map((t) => ({
    id: toUuid(t.id),
    company_id: toUuid(t.companyId),
    external_ref: t.externalRef ?? null,
    priority: t.priority,
    status: t.status,
    opened_at: t.openedAt ?? null,
    resolved_at: t.resolvedAt ?? null,
    subject: t.subject ?? null,
    source: t.source ?? 'manual',
  }));
}

function mapUsageMetrics(ds: DemoDataset) {
  return ds.usageMetrics.map((u) => ({
    id: toUuid(u.id),
    company_id: toUuid(u.companyId),
    metric_key: u.metricKey,
    metric_date: u.metricDate,
    value: u.value,
  }));
}

function mapCalendarEvents(ds: DemoDataset) {
  return ds.calendarEvents.map((e) => ({
    id: toUuid(e.id),
    company_id: toUuid(e.companyId ?? null),
    gcal_event_id: e.gcalEventId ?? null,
    title: e.title,
    starts_at: e.startsAt,
    ends_at: e.endsAt,
    attendee_emails: e.attendeeEmails ?? [],
    organizer_email: e.organizerEmail ?? null,
    meet_link: e.meetLink ?? null,
    status: e.status ?? null,
    matched_contact_ids: ids(e.matchedContactIds),
    logged_activity_id: toUuid(e.loggedActivityId ?? null),
    fathom_recording_id: toUuid(e.fathomRecordingId ?? null),
    source: 'app',
    source_id: e.id,
  }));
}

function mapMeetingPreps(ds: DemoDataset) {
  return ds.meetingPreps.map((m) => ({
    id: toUuid(m.id),
    company_id: toUuid(m.companyId),
    calendar_event_id: toUuid(m.calendarEventId),
    content: m.content ?? {},
    narrative: m.narrative ?? null,
    generated_at: m.generatedAt,
    stale: m.stale,
  }));
}

function mapEmails(ds: DemoDataset) {
  return ds.emails.map((e) => ({
    id: toUuid(e.id),
    company_id: toUuid(e.companyId),
    contact_ids: ids(e.contactIds),
    gmail_message_id: e.gmailMessageId ?? null,
    gmail_thread_id: e.gmailThreadId ?? null,
    direction: e.direction ?? null,
    from_email: e.fromEmail ?? null,
    to_emails: e.toEmails ?? [],
    cc_emails: e.ccEmails ?? [],
    subject: e.subject ?? null,
    snippet: e.snippet ?? null,
    body_html: e.bodyHtml ?? null,
    sent_at: e.sentAt,
    source: 'app',
    source_id: e.id,
  }));
}

function mapDigests(ds: DemoDataset) {
  return ds.digests.map((d) => ({
    id: toUuid(d.id),
    user_id: toUuid(d.userId),
    digest_type: d.digestType,
    digest_date: d.digestDate,
    content: mapDigestContent(d.content),
    narrative: d.narrative ?? null,
  }));
}

// ── main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('▶ Generating demo dataset (seeded, deterministic)…');
  const ds = generateDemoData();

  // Insertion order respects FKs: profiles → companies → everything company-scoped.
  // success_plans before objectives; alert_rules before alerts.
  const steps: { table: string; rows: Record<string, unknown>[] }[] = [
    { table: 'profiles', rows: mapProfiles(ds) },
    { table: 'companies', rows: mapCompanies(ds) },
    { table: 'contacts', rows: mapContacts(ds) },
    { table: 'activities', rows: mapActivities(ds) },
    { table: 'deals', rows: mapDeals(ds) },
    { table: 'health_snapshots', rows: mapHealthSnapshots(ds) },
    { table: 'tasks', rows: mapTasks(ds) },
    { table: 'alert_rules', rows: mapAlertRules(ds) },
    { table: 'alerts', rows: mapAlerts(ds) },
    { table: 'success_plans', rows: mapSuccessPlans(ds) },
    { table: 'success_plan_objectives', rows: mapObjectives(ds) },
    { table: 'nps_responses', rows: mapNps(ds) },
    { table: 'csat_responses', rows: mapCsat(ds) },
    { table: 'tickets', rows: mapTickets(ds) },
    { table: 'usage_metrics', rows: mapUsageMetrics(ds) },
    { table: 'calendar_events', rows: mapCalendarEvents(ds) },
    { table: 'meeting_preps', rows: mapMeetingPreps(ds) },
    { table: 'emails', rows: mapEmails(ds) },
    { table: 'digests', rows: mapDigests(ds) },
  ];

  const summary: Record<string, number> = {};
  for (const step of steps) {
    process.stdout.write(`  • ${step.table.padEnd(24)} `);
    const n = await insertRows(step.table, step.rows);
    summary[step.table] = n;
    console.log(`${n} rows`);
  }

  // ── summary ─────────────────────────────────────────────────────────────────
  const total = Object.values(summary).reduce((a, b) => a + b, 0);
  console.log('\n────────────────────────────────────────────');
  console.log('  Demo seed complete');
  console.log('────────────────────────────────────────────');
  const csms = ds.profiles.filter((p) => p.role === 'csm');
  console.log(
    `  Profiles: ${ds.profiles.length} (` +
      `${ds.profiles.filter((p) => p.role === 'admin').length} admin, ` +
      `${ds.profiles.filter((p) => p.role === 'manager').length} manager, ${csms.length} CSMs)`
  );
  for (const c of csms) {
    const book = ds.companies.filter((co) => co.ownerId === c.id).length;
    console.log(`    - ${c.fullName.padEnd(18)} ${String(c.segment).padEnd(11)} ${book} accounts`);
  }
  console.log(`  Total rows upserted: ${total}`);
  console.log(
    '\n  Login as any seeded user is via Google in production; for demo, the app runs\n' +
      '  in demo mode without auth. These rows make the DB-backed app fully explorable.\n'
  );
}

main().catch((err) => {
  console.error('\n✖ Seed failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});

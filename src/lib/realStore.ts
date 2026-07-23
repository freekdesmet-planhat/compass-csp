// Real-mode (live Supabase) data source for the vertical slice: companies,
// contacts, profiles. Maps snake_case DB rows to the app's camelCase types.
// RLS enforces visibility server-side, so callers use the returned rows as-is.
// The demo store (store.ts) remains the path when isDemoMode is true.
import { supabase } from './supabase';
import type {
  Company, Contact, Profile, Task, Activity, Deal, NpsResponse, UsageMetric,
  SuccessPlan, SuccessPlanObjective, Alert, HealthSnapshot, Notification, Product,
  CompanyProduct, LibraryItem, Dashboard, DashboardWidget, AskThread, AskMessage,
} from './types';

function db() {
  if (!supabase) throw new Error('Supabase client unavailable in real mode');
  return supabase;
}

// Paginate past PostgREST's default 1000-row cap (activities/tasks exceed it).
async function fetchAllRows(table: string, apply?: (q: any) => any): Promise<any[]> {
  const out: any[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    let q = db().from(table).select('*').range(from, from + pageSize - 1);
    if (apply) q = apply(q);
    const { data, error } = await q;
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
  }
  return out;
}

// ── row → app-type mappers ────────────────────────────────────────────────────
export function rowToProfile(r: any): Profile {
  return {
    id: r.id, email: r.email, fullName: r.full_name ?? '', avatarUrl: r.avatar_url ?? null,
    role: r.role, segment: r.segment ?? null, managerId: r.manager_id ?? null,
    timezone: r.timezone ?? 'UTC', digestHour: r.digest_hour ?? 7, isActive: r.is_active ?? true,
    sidebarCollapsed: r.sidebar_collapsed ?? false, lastSeenVersion: r.last_seen_version ?? null,
  };
}

export function rowToCompany(r: any): Company {
  return {
    id: r.id, name: r.name, domains: r.domains ?? [], website: r.website ?? null,
    country: r.country ?? null, city: r.city ?? null, ownerId: r.owner_id ?? null,
    collaboratorIds: r.collaborator_ids ?? [], segment: r.segment ?? null, phase: r.phase ?? null,
    status: r.status, tier: r.tier ?? null, region: r.region ?? null, tags: r.tags ?? [],
    mrr: r.mrr ?? null, arr: r.arr ?? null, renewalDate: r.renewal_date ?? null, renewalArr: r.renewal_arr ?? null,
    hubspotCompanyId: r.hubspot_company_id ?? null,
    healthScore: r.health_score ?? null, healthBand: r.health_band ?? null,
    healthDeltaWow: r.health_delta_wow ?? null, healthUpdatedAt: r.health_updated_at ?? null,
    valueScore: r.value_score ?? null, valueComment: r.value_comment ?? null,
    sentimentAssessment: r.sentiment_assessment ?? null, execRelationshipFlag: r.exec_relationship_flag ?? false,
    redFlags: r.red_flags ?? null, greenFlags: r.green_flags ?? null, nextStep: r.next_step ?? null,
    pathToGreen: r.path_to_green ?? null, handoverNotes: r.handover_notes ?? null,
    aiAccountSummary: r.ai_account_summary ?? null, aiRiskSummary: r.ai_risk_summary ?? null,
    aiRenewalSummary: r.ai_renewal_summary ?? null, lastTouchAt: r.last_touch_at ?? null,
    lastTouchType: r.last_touch_type ?? null, nextTouchAt: r.next_touch_at ?? null,
    latestNews: r.latest_news ?? null, latestNewsAt: r.latest_news_at ?? null,
    latestNewsSources: r.latest_news_sources ?? null, source: r.source ?? undefined,
  };
}

export function rowToContact(r: any): Contact {
  return {
    id: r.id, companyId: r.company_id, firstName: r.first_name ?? '', lastName: r.last_name ?? '',
    email: r.email ?? null, otherEmails: r.other_emails ?? [], phone: r.phone ?? null,
    title: r.title ?? null, department: r.department ?? null, seniority: r.seniority ?? null,
    linkedinUrl: r.linkedin_url ?? null, contactRole: r.contact_role ?? null,
    relationshipStrength: r.relationship_strength ?? null, isPrimary: r.is_primary ?? false,
    isChampion: r.is_champion ?? false, hasInfluence: r.has_influence ?? false,
    isAdvocate: r.is_advocate ?? false, advocateType: r.advocate_type ?? null,
    reportsToContactId: r.reports_to_contact_id ?? null, npsLatest: r.nps_latest ?? null,
    npsLatestAt: r.nps_latest_at ?? null, sentiment30d: r.sentiment_30d ?? null,
    engagementScore: r.engagement_score ?? null, lastActiveAt: r.last_active_at ?? null,
    lastTouchAt: r.last_touch_at ?? null, archived: r.archived ?? false,
  };
}

// ── reads (RLS scopes visibility) ─────────────────────────────────────────────
export async function fetchCompanies(): Promise<Company[]> {
  const { data, error } = await db().from('companies').select('*').order('name');
  if (error) throw error;
  return (data ?? []).map(rowToCompany);
}
export async function fetchCompany(id: string): Promise<Company | null> {
  const { data, error } = await db().from('companies').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? rowToCompany(data) : null;
}
export async function fetchContacts(companyId?: string): Promise<Contact[]> {
  let q = db().from('contacts').select('*');
  if (companyId) q = q.eq('company_id', companyId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map(rowToContact);
}
export async function fetchContact(id: string): Promise<Contact | null> {
  const { data, error } = await db().from('contacts').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? rowToContact(data) : null;
}

// ── global search (⌘K palette). RLS scopes results; sanitise the term so it
//    can't break PostgREST filter syntax. ──────────────────────────────────────
const sanitize = (q: string) => q.replace(/[,()%*\\]/g, ' ').trim();
export async function searchCompanies(q: string): Promise<Company[]> {
  const s = sanitize(q);
  let query = db().from('companies').select('*').order('name').limit(6);
  if (s) query = query.ilike('name', `%${s}%`);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map(rowToCompany);
}
export async function searchContacts(q: string): Promise<Contact[]> {
  const s = sanitize(q);
  if (!s) return [];
  const { data, error } = await db().from('contacts').select('*').or(`first_name.ilike.%${s}%,last_name.ilike.%${s}%,email.ilike.%${s}%`).limit(5);
  if (error) throw error;
  return (data ?? []).map(rowToContact);
}
export async function searchDeals(q: string): Promise<Deal[]> {
  const s = sanitize(q);
  if (!s) return [];
  const { data, error } = await db().from('deals').select('*').ilike('name', `%${s}%`).limit(4);
  if (error) throw error;
  return (data ?? []).map(rowToDeal);
}
export async function fetchProfiles(): Promise<Profile[]> {
  const { data, error } = await db().from('profiles').select('*').order('full_name');
  if (error) throw error;
  return (data ?? []).map(rowToProfile);
}

// ── writes ────────────────────────────────────────────────────────────────────
// camelCase patch -> snake_case columns (only the fields the Contacts UI edits).
const CONTACT_COLS: Record<string, string> = {
  firstName: 'first_name', lastName: 'last_name', email: 'email', phone: 'phone', title: 'title',
  department: 'department', seniority: 'seniority', linkedinUrl: 'linkedin_url', contactRole: 'contact_role',
  relationshipStrength: 'relationship_strength', isPrimary: 'is_primary', isChampion: 'is_champion',
  hasInfluence: 'has_influence', isAdvocate: 'is_advocate', advocateType: 'advocate_type',
  sentiment30d: 'sentiment_30d', archived: 'archived',
};
export async function updateContactRow(id: string, patch: Record<string, any>): Promise<Contact | null> {
  const row: Record<string, any> = {};
  for (const [k, v] of Object.entries(patch)) { const col = CONTACT_COLS[k]; if (col) row[col] = v; }
  const { data, error } = await db().from('contacts').update(row).eq('id', id).select().maybeSingle();
  if (error) throw error;
  return data ? rowToContact(data) : null;
}

export async function insertTaskRow(t: Partial<Task> & { companyId: string; title: string; creatorId: string }): Promise<void> {
  const { error } = await db().from('tasks').insert({
    company_id: t.companyId, title: t.title, description: t.description ?? null,
    assignee_id: t.assigneeId ?? t.creatorId, creator_id: t.creatorId,
    due_date: t.dueDate ?? null, priority: t.priority ?? 'normal', origin: t.origin ?? 'manual',
  });
  if (error) throw error;
}

// ── Bucket A: Planhat-synced reads (activities, deals, tasks, nps, usage,
//    success plans + objectives). RLS scopes each by can_see_company. ──────────
export function rowToActivity(r: any): Activity {
  return {
    id: r.id, companyId: r.company_id, contactIds: r.contact_ids ?? [], userId: r.user_id ?? null,
    type: r.type, direction: r.direction ?? null, title: r.title ?? '', snippet: r.snippet ?? null,
    bodyRef: r.body_ref ?? null, occurredAt: r.occurred_at, meta: r.meta ?? {},
  };
}
export function rowToDeal(r: any): Deal {
  return {
    id: r.id, companyId: r.company_id, hubspotDealId: r.hubspot_deal_id ?? null, pipeline: r.pipeline,
    stage: r.stage ?? null, stageProbability: r.stage_probability ?? null, forecastCategory: r.forecast_category ?? null,
    name: r.name ?? '', amount: r.amount ?? null, currency: r.currency ?? 'USD', closeDate: r.close_date ?? null,
    ownerId: r.owner_id ?? null, status: r.status, nextSteps: r.next_steps ?? null, aiSummary: r.ai_summary ?? null,
    confidence: r.confidence ?? null, qualification: r.qualification ?? {}, suggestedStage: r.suggested_stage ?? null,
    suggestedStageReason: r.suggested_stage_reason ?? null, contactIds: r.contact_ids ?? [], lastSyncedAt: r.last_synced_at ?? null,
  };
}
export function rowToTask(r: any): Task {
  return {
    id: r.id, companyId: r.company_id, assigneeId: r.assignee_id ?? null, creatorId: r.creator_id ?? null,
    title: r.title ?? '', description: r.description ?? null, taskType: 'todo', dueDate: r.due_date ?? null,
    completedAt: r.completed_at ?? null, priority: r.priority ?? 'normal', origin: r.origin ?? 'manual',
    playbookRunStepId: r.playbook_run_step_id ?? null, sourceActivityId: r.source_activity_id ?? null,
    successPlanObjectiveId: r.success_plan_objective_id ?? null, contactId: null,
  };
}
export function rowToNps(r: any): NpsResponse {
  return { id: r.id, companyId: r.company_id, contactId: r.contact_id ?? null, score: r.score, comment: r.comment ?? null, respondedAt: r.responded_at };
}
export function rowToUsage(r: any): UsageMetric {
  return { id: r.id, companyId: r.company_id, metricKey: r.metric_key, metricDate: r.metric_date, value: Number(r.value) };
}
export function rowToSuccessPlan(r: any): SuccessPlan {
  return { id: r.id, companyId: r.company_id, name: r.name ?? '', ownerId: r.owner_id ?? null, status: r.status ?? 'active', targetDate: r.target_date ?? null, progressPct: Number(r.progress_pct ?? 0) };
}
export function rowToObjective(r: any): SuccessPlanObjective {
  return {
    id: r.id, planId: r.plan_id, companyId: r.company_id, title: r.title ?? '', businessOutcome: r.business_outcome ?? null,
    metric: r.metric ?? null, targetDate: r.target_date ?? null, status: r.status, position: r.position ?? 0, notes: r.notes ?? null,
  };
}

export async function fetchActivities(companyId?: string): Promise<Activity[]> {
  const rows = await fetchAllRows('activities', (q) => {
    const x = q.order('occurred_at', { ascending: false });
    return companyId ? x.eq('company_id', companyId) : x;
  });
  return rows.map(rowToActivity);
}
export async function fetchDeals(companyId?: string): Promise<Deal[]> {
  const rows = await fetchAllRows('deals', (q) => (companyId ? q.eq('company_id', companyId) : q));
  return rows.map(rowToDeal);
}
export async function fetchTasks(companyId?: string): Promise<Task[]> {
  const rows = await fetchAllRows('tasks', (q) => (companyId ? q.eq('company_id', companyId) : q));
  return rows.map(rowToTask);
}
export async function fetchNps(companyId?: string): Promise<NpsResponse[]> {
  const rows = await fetchAllRows('nps_responses', (q) => (companyId ? q.eq('company_id', companyId) : q));
  return rows.map(rowToNps);
}
// Usage is a large time-series; only fetch per-company (global callers get []).
export async function fetchUsageMetrics(companyId?: string): Promise<UsageMetric[]> {
  if (!companyId) return [];
  const rows = await fetchAllRows('usage_metrics', (q) => q.eq('company_id', companyId));
  return rows.map(rowToUsage);
}
export async function fetchSuccessPlans(companyId?: string): Promise<SuccessPlan[]> {
  const rows = await fetchAllRows('success_plans', (q) => (companyId ? q.eq('company_id', companyId) : q));
  return rows.map(rowToSuccessPlan);
}
export async function fetchObjectives(companyId?: string, planId?: string): Promise<SuccessPlanObjective[]> {
  const rows = await fetchAllRows('success_plan_objectives', (q) => {
    let x = q.order('position', { ascending: true });
    if (companyId) x = x.eq('company_id', companyId);
    if (planId) x = x.eq('plan_id', planId);
    return x;
  });
  return rows.map(rowToObjective);
}

// ── Phase 2 write-path: real inserts/updates for the UI mutations. camelCase →
//    snake_case; returns the mapped row. RLS's WITH CHECK gates by company. ────
export async function insertActivityRow(a: {
  companyId: string; contactIds?: string[]; userId?: string | null; type: string;
  direction?: string | null; title: string; snippet?: string | null; occurredAt?: string; meta?: Record<string, unknown>;
}): Promise<Activity> {
  const { data, error } = await db().from('activities').insert({
    company_id: a.companyId, contact_ids: a.contactIds ?? [], user_id: a.userId ?? null,
    type: a.type, direction: a.direction ?? null, title: a.title, snippet: a.snippet ?? null,
    occurred_at: a.occurredAt ?? new Date().toISOString(), meta: a.meta ?? {},
  }).select().single();
  if (error) throw error;
  return rowToActivity(data);
}

export async function insertDealRow(d: Partial<Deal> & { companyId: string; name: string }): Promise<Deal> {
  const { data, error } = await db().from('deals').insert({
    company_id: d.companyId, name: d.name, pipeline: d.pipeline ?? 'expansion', stage: d.stage ?? null,
    stage_probability: d.stageProbability ?? null, forecast_category: d.forecastCategory ?? 'pipeline',
    amount: d.amount ?? null, currency: d.currency ?? 'USD', close_date: d.closeDate ?? null,
    owner_id: d.ownerId ?? null, status: d.status ?? 'open', next_steps: d.nextSteps ?? null,
    ai_summary: d.aiSummary ?? null, confidence: d.confidence ?? null, qualification: d.qualification ?? {},
    contact_ids: d.contactIds ?? [],
  }).select().single();
  if (error) throw error;
  return rowToDeal(data);
}

export async function insertSuccessPlanRow(p: Partial<SuccessPlan> & { companyId: string; name: string }): Promise<SuccessPlan> {
  const { data, error } = await db().from('success_plans').insert({
    company_id: p.companyId, name: p.name, owner_id: p.ownerId ?? null, status: p.status ?? 'active',
    target_date: p.targetDate ?? null, progress_pct: p.progressPct ?? 0,
  }).select().single();
  if (error) throw error;
  return rowToSuccessPlan(data);
}

export async function insertObjectiveRows(rows: (Partial<SuccessPlanObjective> & { planId: string; companyId: string; title: string; position: number })[]): Promise<void> {
  if (!rows.length) return;
  const { error } = await db().from('success_plan_objectives').insert(rows.map((o) => ({
    plan_id: o.planId, company_id: o.companyId, title: o.title, business_outcome: o.businessOutcome ?? null,
    metric: o.metric ?? null, target_date: o.targetDate ?? null, status: o.status ?? 'not_started',
    position: o.position, notes: o.notes ?? null,
  })));
  if (error) throw error;
}

const OBJECTIVE_COLS: Record<string, string> = {
  title: 'title', businessOutcome: 'business_outcome', metric: 'metric', targetDate: 'target_date',
  status: 'status', position: 'position', notes: 'notes',
};
export async function updateObjectiveRow(id: string, patch: Record<string, any>): Promise<SuccessPlanObjective | null> {
  const row: Record<string, any> = {};
  for (const [k, v] of Object.entries(patch)) { const col = OBJECTIVE_COLS[k]; if (col) row[col] = v; }
  const { data, error } = await db().from('success_plan_objectives').update(row).eq('id', id).select().maybeSingle();
  if (error) throw error;
  return data ? rowToObjective(data) : null;
}

const PLAN_COLS: Record<string, string> = {
  name: 'name', ownerId: 'owner_id', status: 'status', targetDate: 'target_date', progressPct: 'progress_pct',
};
export async function updateSuccessPlanRow(id: string, patch: Record<string, any>): Promise<SuccessPlan | null> {
  const row: Record<string, any> = {};
  for (const [k, v] of Object.entries(patch)) { const col = PLAN_COLS[k]; if (col) row[col] = v; }
  const { data, error } = await db().from('success_plans').update(row).eq('id', id).select().maybeSingle();
  if (error) throw error;
  return data ? rowToSuccessPlan(data) : null;
}

// ── Phase 3: remaining reads + writes so ZERO mutation touches the demo store
//    in real mode. Mappers, fetchers (RLS-scoped) and writes for the rest. ────
export function rowToAlert(r: any): Alert {
  return { id: r.id, ruleId: r.rule_id ?? null, companyId: r.company_id, ownerId: r.owner_id ?? null, title: r.title ?? '', detail: r.detail ?? null, severity: r.severity, status: r.status, snoozedUntil: r.snoozed_until ?? null, dedupeKey: r.dedupe_key ?? null, createdAt: r.created_at };
}
export function rowToHealthSnapshot(r: any): HealthSnapshot {
  return { id: r.id, companyId: r.company_id, snapshotDate: r.snapshot_date, isWeekly: r.is_weekly ?? false, overall: Number(r.overall ?? 0), band: r.band, deltaWow: r.delta_wow ?? null, dimensions: r.dimensions ?? {}, explanation: r.explanation ?? null, recommendations: r.recommendations ?? null, source: r.source ?? undefined };
}
export function rowToNotification(r: any): Notification {
  return { id: r.id, userId: r.user_id, kind: r.kind, title: r.title ?? '', body: r.body ?? null, link: r.link ?? null, readAt: r.read_at ?? null, createdAt: r.created_at };
}
export function rowToProduct(r: any): Product {
  return { id: r.id, name: r.name, category: r.category ?? null, position: r.position ?? 0 };
}
export function rowToCompanyProduct(r: any): CompanyProduct {
  return { id: r.id, companyId: r.company_id, productId: r.product_id, status: r.status, arr: r.arr ?? null, note: r.note ?? null, updatedBy: r.updated_by ?? null };
}
export function rowToLibraryItem(r: any): LibraryItem {
  return { id: r.id, title: r.title ?? '', description: r.description ?? null, itemType: r.item_type, url: r.url ?? null, storagePath: r.storage_path ?? null, tags: r.tags ?? [], segments: r.segments ?? [], uploadedBy: r.uploaded_by ?? null, downloadCount: r.download_count ?? 0, createdAt: r.created_at };
}
export function rowToDashboard(r: any): Dashboard {
  return { id: r.id, name: r.name ?? '', ownerId: r.owner_id ?? null, shared: r.shared ?? false, layout: r.layout ?? [] };
}
export function rowToDashboardWidget(r: any): DashboardWidget {
  return { id: r.id, dashboardId: r.dashboard_id, position: r.position ?? { x: 0, y: 0, w: 2, h: 2 }, kind: r.kind, dataset: r.dataset ?? '', groupBy: r.group_by ?? null, measure: r.measure ?? null, filter: r.filter ?? {}, title: r.title ?? '' };
}
export function rowToAskThread(r: any): AskThread {
  return { id: r.id, userId: r.user_id, title: r.title ?? '', createdAt: r.created_at };
}
export function rowToAskMessage(r: any): AskMessage {
  return { id: r.id, threadId: r.thread_id, role: r.role, content: r.content ?? '', toolCalls: r.tool_calls ?? null, createdAt: r.created_at };
}

export async function fetchHealthSnapshots(companyId?: string): Promise<HealthSnapshot[]> {
  const rows = await fetchAllRows('health_snapshots', (q) => { const x = q.order('snapshot_date', { ascending: true }); return companyId ? x.eq('company_id', companyId) : x; });
  return rows.map(rowToHealthSnapshot);
}
export async function fetchNotifications(userId: string): Promise<Notification[]> {
  const rows = await fetchAllRows('notifications', (q) => q.eq('user_id', userId).order('created_at', { ascending: false }));
  return rows.map(rowToNotification);
}
export async function fetchProducts(): Promise<Product[]> {
  const rows = await fetchAllRows('products', (q) => q.order('position', { ascending: true }));
  return rows.map(rowToProduct);
}
export async function fetchCompanyProducts(companyId?: string): Promise<CompanyProduct[]> {
  const rows = await fetchAllRows('company_products', (q) => (companyId ? q.eq('company_id', companyId) : q));
  return rows.map(rowToCompanyProduct);
}
export async function fetchLibraryItems(): Promise<LibraryItem[]> {
  const rows = await fetchAllRows('library_items', (q) => q.order('created_at', { ascending: false }));
  return rows.map(rowToLibraryItem);
}
export async function fetchDashboards(): Promise<Dashboard[]> {
  const rows = await fetchAllRows('dashboards'); // RLS scopes to owner/shared
  return rows.map(rowToDashboard);
}
export async function fetchDashboardWidgets(dashboardId?: string): Promise<DashboardWidget[]> {
  const rows = await fetchAllRows('dashboard_widgets', (q) => (dashboardId ? q.eq('dashboard_id', dashboardId) : q));
  return rows.map(rowToDashboardWidget);
}
export async function fetchAskThreads(userId: string): Promise<AskThread[]> {
  const rows = await fetchAllRows('ask_compass_threads', (q) => q.eq('user_id', userId).order('created_at', { ascending: false }));
  return rows.map(rowToAskThread);
}
export async function fetchAskMessages(threadId?: string): Promise<AskMessage[]> {
  if (!threadId) return [];
  const rows = await fetchAllRows('ask_compass_messages', (q) => q.eq('thread_id', threadId).order('created_at', { ascending: true }));
  return rows.map(rowToAskMessage);
}

const COMPANY_COLS: Record<string, string> = {
  name: 'name', domains: 'domains', website: 'website', country: 'country', city: 'city',
  ownerId: 'owner_id', collaboratorIds: 'collaborator_ids', segment: 'segment', phase: 'phase',
  status: 'status', tier: 'tier', region: 'region', tags: 'tags', mrr: 'mrr', arr: 'arr',
  renewalDate: 'renewal_date', renewalArr: 'renewal_arr',
  healthScore: 'health_score', healthBand: 'health_band', healthDeltaWow: 'health_delta_wow', healthUpdatedAt: 'health_updated_at',
  valueScore: 'value_score', valueComment: 'value_comment', sentimentAssessment: 'sentiment_assessment',
  execRelationshipFlag: 'exec_relationship_flag', redFlags: 'red_flags', greenFlags: 'green_flags',
  nextStep: 'next_step', pathToGreen: 'path_to_green', handoverNotes: 'handover_notes',
  aiAccountSummary: 'ai_account_summary', aiRiskSummary: 'ai_risk_summary', aiRenewalSummary: 'ai_renewal_summary',
  lastTouchAt: 'last_touch_at', lastTouchType: 'last_touch_type', nextTouchAt: 'next_touch_at',
};
export async function updateCompanyRow(id: string, patch: Record<string, any>): Promise<Company | null> {
  const row: Record<string, any> = {};
  for (const [k, v] of Object.entries(patch)) { const col = COMPANY_COLS[k]; if (col) row[col] = v; }
  if (!Object.keys(row).length) return fetchCompany(id);
  const { data, error } = await db().from('companies').update(row).eq('id', id).select().maybeSingle();
  if (error) throw error;
  return data ? rowToCompany(data) : null;
}

const TASK_COLS: Record<string, string> = {
  title: 'title', description: 'description', dueDate: 'due_date', completedAt: 'completed_at',
  priority: 'priority', assigneeId: 'assignee_id', origin: 'origin',
  successPlanObjectiveId: 'success_plan_objective_id', sourceActivityId: 'source_activity_id',
};
export async function updateTaskRow(id: string, patch: Record<string, any>): Promise<Task | null> {
  const row: Record<string, any> = {};
  for (const [k, v] of Object.entries(patch)) { const col = TASK_COLS[k]; if (col) row[col] = v; }
  const { data, error } = await db().from('tasks').update(row).eq('id', id).select().maybeSingle();
  if (error) throw error;
  return data ? rowToTask(data) : null;
}

const DEAL_COLS: Record<string, string> = {
  name: 'name', pipeline: 'pipeline', stage: 'stage', stageProbability: 'stage_probability',
  forecastCategory: 'forecast_category', amount: 'amount', currency: 'currency', closeDate: 'close_date',
  ownerId: 'owner_id', status: 'status', nextSteps: 'next_steps', aiSummary: 'ai_summary',
  confidence: 'confidence', qualification: 'qualification', suggestedStage: 'suggested_stage',
  suggestedStageReason: 'suggested_stage_reason', contactIds: 'contact_ids',
};
export async function updateDealRow(id: string, patch: Record<string, any>): Promise<Deal | null> {
  const row: Record<string, any> = {};
  for (const [k, v] of Object.entries(patch)) { const col = DEAL_COLS[k]; if (col) row[col] = v; }
  const { data, error } = await db().from('deals').update(row).eq('id', id).select().maybeSingle();
  if (error) throw error;
  return data ? rowToDeal(data) : null;
}

const ALERT_COLS: Record<string, string> = { status: 'status', snoozedUntil: 'snoozed_until', ownerId: 'owner_id' };
export async function updateAlertRow(id: string, patch: Record<string, any>): Promise<Alert | null> {
  const row: Record<string, any> = {};
  for (const [k, v] of Object.entries(patch)) { const col = ALERT_COLS[k]; if (col) row[col] = v; }
  const { data, error } = await db().from('alerts').update(row).eq('id', id).select().maybeSingle();
  if (error) throw error;
  return data ? rowToAlert(data) : null;
}

const PROFILE_COLS: Record<string, string> = {
  fullName: 'full_name', avatarUrl: 'avatar_url', role: 'role', segment: 'segment', managerId: 'manager_id',
  timezone: 'timezone', digestHour: 'digest_hour', isActive: 'is_active',
  sidebarCollapsed: 'sidebar_collapsed', lastSeenVersion: 'last_seen_version',
};
export async function updateProfileRow(id: string, patch: Record<string, any>): Promise<Profile | null> {
  const row: Record<string, any> = {};
  for (const [k, v] of Object.entries(patch)) { const col = PROFILE_COLS[k]; if (col) row[col] = v; }
  const { data, error } = await db().from('profiles').update(row).eq('id', id).select().maybeSingle();
  if (error) throw error;
  return data ? rowToProfile(data) : null;
}

export async function insertNpsRow(n: { companyId: string; contactId?: string | null; score: number; comment?: string | null }): Promise<NpsResponse> {
  const { data, error } = await db().from('nps_responses').insert({
    company_id: n.companyId, contact_id: n.contactId ?? null, score: n.score, comment: n.comment ?? null, responded_at: new Date().toISOString(),
  }).select().single();
  if (error) throw error;
  return rowToNps(data);
}

export async function upsertHealthSnapshotRow(s: { companyId: string; snapshotDate: string; isWeekly?: boolean; overall: number; band: string; deltaWow: number | null; dimensions: Record<string, unknown>; source?: string }): Promise<void> {
  const { error } = await db().from('health_snapshots').upsert({
    company_id: s.companyId, snapshot_date: s.snapshotDate, is_weekly: s.isWeekly ?? false,
    overall: s.overall, band: s.band, delta_wow: s.deltaWow, dimensions: s.dimensions, source: s.source ?? 'recompute',
  }, { onConflict: 'company_id,snapshot_date' });
  if (error) throw error;
}

export async function insertNotificationRow(n: { userId: string; kind: string; title: string; body?: string | null; link?: string | null }): Promise<Notification> {
  const { data, error } = await db().from('notifications').insert({
    user_id: n.userId, kind: n.kind, title: n.title, body: n.body ?? null, link: n.link ?? null,
  }).select().single();
  if (error) throw error;
  return rowToNotification(data);
}
export async function markNotificationsReadRows(userId: string, id?: string): Promise<number> {
  let q = db().from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', userId).is('read_at', null);
  if (id) q = q.eq('id', id);
  const { data, error } = await q.select('id');
  if (error) throw error;
  return (data ?? []).length;
}

export async function insertLibraryItemRow(it: { title: string; description?: string | null; itemType: string; url?: string | null; storagePath?: string | null; tags?: string[]; segments?: string[]; uploadedBy?: string | null }): Promise<LibraryItem> {
  const { data, error } = await db().from('library_items').insert({
    title: it.title, description: it.description ?? null, item_type: it.itemType, url: it.url ?? null,
    storage_path: it.storagePath ?? null, tags: it.tags ?? [], segments: it.segments ?? [], uploaded_by: it.uploadedBy ?? null,
  }).select().single();
  if (error) throw error;
  return rowToLibraryItem(data);
}
export async function incrementLibraryDownloadRow(id: string): Promise<void> {
  const { data: cur } = await db().from('library_items').select('download_count').eq('id', id).maybeSingle();
  const { error } = await db().from('library_items').update({ download_count: ((cur?.download_count as number) ?? 0) + 1 }).eq('id', id);
  if (error) throw error;
}

export async function insertDashboardRow(name: string, ownerId: string): Promise<Dashboard> {
  const { data, error } = await db().from('dashboards').insert({ name, owner_id: ownerId, shared: false, layout: [] }).select().single();
  if (error) throw error;
  return rowToDashboard(data);
}
export async function updateDashboardRow(id: string, patch: Record<string, any>): Promise<Dashboard | null> {
  const row: Record<string, any> = {};
  if ('name' in patch) row.name = patch.name;
  if ('shared' in patch) row.shared = patch.shared;
  if ('layout' in patch) row.layout = patch.layout;
  if ('ownerId' in patch) row.owner_id = patch.ownerId;
  const { data, error } = await db().from('dashboards').update(row).eq('id', id).select().maybeSingle();
  if (error) throw error;
  return data ? rowToDashboard(data) : null;
}
export async function insertDashboardWidgetRow(w: { dashboardId: string; position?: unknown; kind: string; dataset: string; groupBy?: string | null; measure?: string | null; filter?: Record<string, unknown>; title: string }): Promise<DashboardWidget> {
  const { data, error } = await db().from('dashboard_widgets').insert({
    dashboard_id: w.dashboardId, position: w.position ?? { x: 0, y: 0, w: 2, h: 2 }, kind: w.kind, dataset: w.dataset,
    group_by: w.groupBy ?? null, measure: w.measure ?? 'count', filter: w.filter ?? {}, title: w.title,
  }).select().single();
  if (error) throw error;
  return rowToDashboardWidget(data);
}
export async function deleteDashboardWidgetRow(id: string): Promise<void> {
  const { error } = await db().from('dashboard_widgets').delete().eq('id', id);
  if (error) throw error;
}

export async function insertAskThreadRow(userId: string, title: string): Promise<AskThread> {
  const { data, error } = await db().from('ask_compass_threads').insert({ user_id: userId, title }).select().single();
  if (error) throw error;
  return rowToAskThread(data);
}
export async function insertAskMessageRow(m: { threadId: string; role: string; content: string; toolCalls?: unknown }): Promise<void> {
  const { error } = await db().from('ask_compass_messages').insert({ thread_id: m.threadId, role: m.role, content: m.content, tool_calls: m.toolCalls ?? null });
  if (error) throw error;
}

export async function upsertCompanyProductRow(cp: { companyId: string; productId: string; status: string; arr?: number | null; updatedBy?: string | null }): Promise<CompanyProduct> {
  const payload: Record<string, any> = { company_id: cp.companyId, product_id: cp.productId, status: cp.status, updated_by: cp.updatedBy ?? null };
  if (cp.arr !== undefined) payload.arr = cp.arr;
  const { data, error } = await db().from('company_products').upsert(payload, { onConflict: 'company_id,product_id' }).select().single();
  if (error) throw error;
  return rowToCompanyProduct(data);
}

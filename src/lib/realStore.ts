// Real-mode (live Supabase) data source for the vertical slice: companies,
// contacts, profiles. Maps snake_case DB rows to the app's camelCase types.
// RLS enforces visibility server-side, so callers use the returned rows as-is.
// The demo store (store.ts) remains the path when isDemoMode is true.
import { supabase } from './supabase';
import type {
  Company, Contact, Profile, Task, Activity, Deal, NpsResponse, UsageMetric,
  SuccessPlan, SuccessPlanObjective,
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

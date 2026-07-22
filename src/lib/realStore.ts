// Real-mode (live Supabase) data source for the vertical slice: companies,
// contacts, profiles. Maps snake_case DB rows to the app's camelCase types.
// RLS enforces visibility server-side, so callers use the returned rows as-is.
// The demo store (store.ts) remains the path when isDemoMode is true.
import { supabase } from './supabase';
import type { Company, Contact, Profile, Task } from './types';

function db() {
  if (!supabase) throw new Error('Supabase client unavailable in real mode');
  return supabase;
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

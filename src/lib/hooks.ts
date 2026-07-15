import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { all, update, insert, newId, getDb } from './store';
import { useSession } from './session';
import { computeHealth, type HealthInputs } from './health';
import { DEFAULT_HEALTH_WEIGHTS, DEFAULT_HEALTH_THRESHOLDS } from './segments';
import type {
  Company, Contact, Activity, Deal, Task, Alert, HealthSnapshot, SuccessPlan,
  SuccessPlanObjective, NpsResponse, CsatResponse, Ticket, UsageMetric, CalendarEvent,
  MeetingPrep, Digest, EmailMessage, Note, Profile,
} from './types';

// Visibility: which owner ids the current profile can see companies for.
function visibleOwnerScope(profile: Profile, profiles: Profile[]): (companyOwnerId: string | null, collaborators: string[]) => boolean {
  const teamIds = new Set(profiles.filter((p) => p.managerId === profile.id).map((p) => p.id));
  return (ownerId, collaborators) => {
    if (profile.role === 'admin') return true;
    if (ownerId === profile.id) return true;
    if (ownerId && teamIds.has(ownerId)) return true;
    if (collaborators?.includes(profile.id)) return true;
    return false;
  };
}

export function useVisibleCompanies() {
  const { profile, allProfiles } = useSession();
  return useQuery({
    queryKey: ['companies', profile.id],
    queryFn: () => {
      const scope = visibleOwnerScope(profile, allProfiles);
      return (all('companies') as Company[]).filter((c) => scope(c.ownerId, c.collaboratorIds));
    },
  });
}

export function useCompany(id: string | undefined) {
  return useQuery({
    queryKey: ['company', id],
    enabled: !!id,
    queryFn: () => (all('companies') as Company[]).find((c) => c.id === id) ?? null,
  });
}

function scopedList<T extends { companyId: string }>(table: T[], visibleCompanyIds: Set<string>): T[] {
  return table.filter((r) => visibleCompanyIds.has(r.companyId));
}

export function useVisibleCompanyIdSet(): Set<string> {
  const { profile, allProfiles } = useSession();
  const scope = visibleOwnerScope(profile, allProfiles);
  return new Set((all('companies') as Company[]).filter((c) => scope(c.ownerId, c.collaboratorIds)).map((c) => c.id));
}

export function useContacts(companyId?: string) {
  return useQuery({
    queryKey: ['contacts', companyId],
    queryFn: () => (all('contacts') as Contact[]).filter((c) => !companyId || c.companyId === companyId),
  });
}

export function useActivities(companyId?: string) {
  return useQuery({
    queryKey: ['activities', companyId],
    queryFn: () =>
      (all('activities') as Activity[])
        .filter((a) => !companyId || a.companyId === companyId)
        .sort((a, b) => +new Date(b.occurredAt) - +new Date(a.occurredAt)),
  });
}

export function useDeals(companyId?: string) {
  return useQuery({
    queryKey: ['deals', companyId],
    queryFn: () => (all('deals') as Deal[]).filter((d) => !companyId || d.companyId === companyId),
  });
}

export function useTasks(companyId?: string) {
  return useQuery({
    queryKey: ['tasks', companyId],
    queryFn: () => (all('tasks') as Task[]).filter((t) => !companyId || t.companyId === companyId),
  });
}

export function useAlerts() {
  return useQuery({ queryKey: ['alerts'], queryFn: () => all('alerts') as Alert[] });
}

export function useAlertRules() {
  return useQuery({ queryKey: ['alertRules'], queryFn: () => getDb().alertRules });
}

export function useHealthSnapshots(companyId?: string) {
  return useQuery({
    queryKey: ['healthSnapshots', companyId],
    queryFn: () =>
      (all('healthSnapshots') as HealthSnapshot[])
        .filter((h) => !companyId || h.companyId === companyId)
        .sort((a, b) => +new Date(a.snapshotDate) - +new Date(b.snapshotDate)),
  });
}

export function useLatestSnapshot(companyId?: string) {
  const { data } = useHealthSnapshots(companyId);
  const withDims = (data ?? []).filter((s) => Object.keys(s.dimensions ?? {}).length > 0);
  return withDims[withDims.length - 1] ?? null;
}

export function useSuccessPlans(companyId?: string) {
  return useQuery({
    queryKey: ['successPlans', companyId],
    queryFn: () => (all('successPlans') as SuccessPlan[]).filter((p) => !companyId || p.companyId === companyId),
  });
}

export function useObjectives(companyId?: string, planId?: string) {
  return useQuery({
    queryKey: ['objectives', companyId, planId],
    queryFn: () =>
      (all('objectives') as SuccessPlanObjective[])
        .filter((o) => (!companyId || o.companyId === companyId) && (!planId || o.planId === planId))
        .sort((a, b) => a.position - b.position),
  });
}

export function useNps(companyId?: string) {
  return useQuery({ queryKey: ['nps', companyId], queryFn: () => (all('npsResponses') as NpsResponse[]).filter((n) => !companyId || n.companyId === companyId) });
}
export function useCsat(companyId?: string) {
  return useQuery({ queryKey: ['csat', companyId], queryFn: () => (all('csatResponses') as CsatResponse[]).filter((n) => !companyId || n.companyId === companyId) });
}
export function useTickets(companyId?: string) {
  return useQuery({ queryKey: ['tickets', companyId], queryFn: () => (all('tickets') as Ticket[]).filter((t) => !companyId || t.companyId === companyId) });
}
export function useUsageMetrics(companyId?: string) {
  return useQuery({ queryKey: ['usage', companyId], queryFn: () => (all('usageMetrics') as UsageMetric[]).filter((u) => !companyId || u.companyId === companyId) });
}
export function useCalendarEvents(companyId?: string) {
  return useQuery({ queryKey: ['calendar', companyId], queryFn: () => (all('calendarEvents') as CalendarEvent[]).filter((e) => !companyId || e.companyId === companyId) });
}
export function useMeetingPreps() {
  return useQuery({ queryKey: ['meetingPreps'], queryFn: () => all('meetingPreps') as MeetingPrep[] });
}
export function useEmails(companyId?: string) {
  return useQuery({ queryKey: ['emails', companyId], queryFn: () => (all('emails') as EmailMessage[]).filter((e) => !companyId || e.companyId === companyId).sort((a, b) => +new Date(b.sentAt) - +new Date(a.sentAt)) });
}
export function useNotes(companyId?: string) {
  return useQuery({ queryKey: ['notes', companyId], queryFn: () => (getDb().activities as Activity[]).filter((a) => a.type === 'note' && (!companyId || a.companyId === companyId)) as unknown as Note[] });
}
export function useDigest(userId: string, type: 'daily' | 'weekly_exec' = 'daily') {
  return useQuery({
    queryKey: ['digest', userId, type],
    queryFn: () => (all('digests') as Digest[]).filter((d) => d.userId === userId && d.digestType === type).sort((a, b) => +new Date(b.digestDate) - +new Date(a.digestDate))[0] ?? null,
  });
}

export function useProfiles() {
  return useQuery({ queryKey: ['profiles'], queryFn: () => getDb().profiles });
}

// ── Mutations ────────────────────────────────────────────────────────────────
export function useUpdateCompany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Company> }) => update('companies', id, patch),
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: ['companies'] });
      qc.invalidateQueries({ queryKey: ['company', v.id] });
    },
  });
}

// Recompute health for a company from its manual + derived inputs (live edit
// of value/sentiment/exec flag triggers instant recompute per Section 4).
export function useRecomputeHealth() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (companyId: string) => {
      const company = (all('companies') as Company[]).find((c) => c.id === companyId);
      if (!company || !company.segment) return null;
      const contacts = (all('contacts') as Contact[]).filter((c) => c.companyId === companyId);
      const tickets = (all('tickets') as Ticket[]).filter((t) => t.companyId === companyId && t.status === 'open');
      const nps = (all('npsResponses') as NpsResponse[]).filter((n) => n.companyId === companyId);
      const usage = (all('usageMetrics') as UsageMetric[]).filter((u) => u.companyId === companyId);
      const latestUsage = (key: string) => usage.filter((u) => u.metricKey === key).sort((a, b) => +new Date(b.metricDate) - +new Date(a.metricDate))[0]?.value ?? null;

      const inputs: HealthInputs = {
        valueScore: company.valueScore ?? null,
        valueComment: company.valueComment,
        inboundEmailRecencyDays: 5,
        emailReplyRate30d: 0.6,
        meetingsLast90d: 2,
        meetingNormPerQuarter: 2,
        distinctActiveContacts90d: Math.min(contacts.length, 3),
        expectedActiveContacts: 3,
        openP1: tickets.filter((t) => t.priority === 'p1').length,
        openP2: tickets.filter((t) => t.priority === 'p2').length,
        avgResolutionDays90d: tickets.length ? 6 : null,
        incidentCount90d: 0,
        hasTicketData: tickets.length > 0,
        sentimentAssessment: company.sentimentAssessment ?? null,
        companyNps: nps.length ? Math.round(nps.reduce((a, n) => a + n.score, 0) / nps.length) : null,
        execContactRelationshipAvg: contacts.filter((c) => c.contactRole === 'exec_sponsor' || c.contactRole === 'decision_maker').reduce((a, c, _, arr) => a + (c.relationshipStrength ?? 5) / (arr.length || 1), 0) || null,
        callSentimentRolling: null,
        execRelationshipFlag: company.execRelationshipFlag,
        wau: latestUsage('weekly_active_users'),
        seats: latestUsage('licensed_seats'),
        adoptionBreadth: 0.5,
        usageTrendSlope: 0.2,
      };
      const weights = DEFAULT_HEALTH_WEIGHTS[company.segment];
      const res = computeHealth(inputs, weights, DEFAULT_HEALTH_THRESHOLDS);
      const prev = company.healthScore ?? res.overall;
      update('companies', companyId, { healthScore: res.overall, healthBand: res.band, healthDeltaWow: res.overall - prev, healthUpdatedAt: new Date().toISOString() });
      // refresh the current weekly snapshot's dimensions
      const snaps = (all('healthSnapshots') as HealthSnapshot[]).filter((s) => s.companyId === companyId);
      const current = snaps.filter((s) => Object.keys(s.dimensions ?? {}).length > 0).sort((a, b) => +new Date(b.snapshotDate) - +new Date(a.snapshotDate))[0];
      if (current) update('healthSnapshots', current.id, { overall: res.overall, band: res.band, dimensions: res.dimensions });
      return res;
    },
    onSuccess: (_r, companyId) => {
      qc.invalidateQueries({ queryKey: ['companies'] });
      qc.invalidateQueries({ queryKey: ['company', companyId] });
      qc.invalidateQueries({ queryKey: ['healthSnapshots', companyId] });
    },
  });
}

export function useToggleTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (task: Task) => update('tasks', task.id, { completedAt: task.completedAt ? null : new Date().toISOString() }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });
}

export function useCreateTask() {
  const qc = useQueryClient();
  const { profile } = useSession();
  return useMutation({
    mutationFn: async (t: Partial<Task> & { companyId: string; title: string }) =>
      insert('tasks', {
        id: newId('ts'), companyId: t.companyId, assigneeId: t.assigneeId ?? profile.id, creatorId: profile.id,
        title: t.title, description: t.description ?? null, dueDate: t.dueDate ?? null, completedAt: null,
        priority: t.priority ?? 'normal', origin: t.origin ?? 'manual', sourceActivityId: t.sourceActivityId ?? null,
        successPlanObjectiveId: t.successPlanObjectiveId ?? null,
      } as Task),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });
}

export function useLogActivity() {
  const qc = useQueryClient();
  const { profile } = useSession();
  return useMutation({
    mutationFn: async (a: Partial<Activity> & { companyId: string; type: Activity['type']; title: string }) =>
      insert('activities', {
        id: newId('ac'), companyId: a.companyId, contactIds: a.contactIds ?? [], userId: profile.id,
        type: a.type, direction: a.direction ?? null, title: a.title, snippet: a.snippet ?? '',
        occurredAt: a.occurredAt ?? new Date().toISOString(), meta: a.meta ?? {},
      } as Activity),
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: ['activities', v.companyId] });
      qc.invalidateQueries({ queryKey: ['activities', undefined] });
    },
  });
}

export function useUpdateAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Alert> }) => update('alerts', id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alerts'] }),
  });
}

export function useUpdateDeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Deal> }) => update('deals', id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['deals'] }),
  });
}

export function useUpdateObjective() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<SuccessPlanObjective> }) => {
      const o = update('objectives', id, patch);
      // recompute plan progress from objective statuses
      if (o) {
        const objs = (all('objectives') as SuccessPlanObjective[]).filter((x) => x.planId === o.planId);
        const score = objs.reduce((a, x) => a + (x.status === 'achieved' ? 1 : x.status === 'on_track' ? 0.5 : x.status === 'at_risk' ? 0.25 : 0), 0);
        update('successPlans', o.planId, { progressPct: Math.round((score / (objs.length || 1)) * 100) });
      }
      return o;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['objectives'] });
      qc.invalidateQueries({ queryKey: ['successPlans'] });
    },
  });
}

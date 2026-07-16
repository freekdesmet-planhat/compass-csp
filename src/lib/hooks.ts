import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { all, update, insert, remove, newId, getDb } from './store';
import { useSession } from './session';
import { computeHealth, type HealthInputs } from './health';
import { DEFAULT_HEALTH_WEIGHTS, DEFAULT_HEALTH_THRESHOLDS } from './segments';
import type {
  Company, Contact, Activity, Deal, Task, Alert, HealthSnapshot, SuccessPlan,
  SuccessPlanObjective, NpsResponse, CsatResponse, Ticket, UsageMetric, CalendarEvent,
  MeetingPrep, Digest, EmailMessage, Note, Profile,
  Notification, Product, CompanyProduct, CompanyProductStatus, LibraryItem, Dashboard,
  DashboardWidget, AskThread, AskMessage, ChangelogEntry,
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
export function useCreateNps() {
  const qc = useQueryClient();
  const { profile } = useSession();
  return useMutation({
    mutationFn: async (n: { companyId: string; score: number; comment?: string; contactId?: string | null }) => {
      const row = insert('npsResponses', { id: newId('nps'), companyId: n.companyId, contactId: n.contactId ?? null, score: n.score, comment: n.comment ?? null, respondedAt: new Date().toISOString() } as NpsResponse);
      insert('activities', { id: newId('ac'), companyId: n.companyId, contactIds: n.contactId ? [n.contactId] : [], userId: profile.id, type: 'nps', title: `NPS ${n.score}`, snippet: n.comment ?? '', occurredAt: new Date().toISOString(), meta: { sentiment: n.score / 100, logged_manually: true } } as Activity);
      return row;
    },
    onSuccess: (_r, v) => { qc.invalidateQueries({ queryKey: ['nps'] }); qc.invalidateQueries({ queryKey: ['activities', v.companyId] }); },
  });
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
    mutationFn: async (t: Partial<Task> & { companyId: string; title: string }) => {
      const assigneeId = t.assigneeId ?? profile.id;
      const row = insert('tasks', {
        id: newId('ts'), companyId: t.companyId, assigneeId, creatorId: profile.id,
        title: t.title, description: t.description ?? null, taskType: t.taskType ?? 'todo',
        dueDate: t.dueDate ?? null, completedAt: null,
        priority: t.priority ?? 'normal', origin: t.origin ?? 'manual', sourceActivityId: t.sourceActivityId ?? null,
        successPlanObjectiveId: t.successPlanObjectiveId ?? null, contactId: t.contactId ?? null,
      } as Task);
      // Assigning to someone else creates a notification (B5 + D6).
      if (assigneeId !== profile.id) {
        const company = (all('companies') as Company[]).find((c) => c.id === t.companyId);
        insert('notifications', {
          id: newId('ntf'), userId: assigneeId, kind: 'task_assigned',
          title: 'New task assigned', body: `${profile.fullName} assigned you "${t.title}"${company ? ` on ${company.name}` : ''}.`,
          link: `/company/${t.companyId}?tab=tasks`, readAt: null, createdAt: new Date().toISOString(),
        } as Notification);
      }
      return row;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tasks'] }); qc.invalidateQueries({ queryKey: ['notifications'] }); },
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
  const { profile } = useSession();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<SuccessPlanObjective> }) => {
      const before = (all('objectives') as SuccessPlanObjective[]).find((x) => x.id === id);
      const o = update('objectives', id, patch);
      // recompute plan progress from objective statuses
      if (o) {
        const objs = (all('objectives') as SuccessPlanObjective[]).filter((x) => x.planId === o.planId);
        const score = objs.reduce((a, x) => a + (x.status === 'achieved' ? 1 : x.status === 'on_track' ? 0.5 : x.status === 'at_risk' ? 0.25 : 0), 0);
        update('successPlans', o.planId, { progressPct: Math.round((score / (objs.length || 1)) * 100) });
        // Timeline system activity on status change (V1 spec).
        if (patch.status && before && before.status !== patch.status) {
          insert('activities', {
            id: newId('ac'), companyId: o.companyId, contactIds: [], userId: profile.id, type: 'system',
            title: `Objective "${o.title}" → ${patch.status.replace(/_/g, ' ')}`, snippet: `Status changed by ${profile.fullName}`,
            occurredAt: new Date().toISOString(), meta: {},
          } as Activity);
        }
      }
      return o;
    },
    onSuccess: (o) => {
      qc.invalidateQueries({ queryKey: ['objectives'] });
      qc.invalidateQueries({ queryKey: ['successPlans'] });
      if (o) qc.invalidateQueries({ queryKey: ['activities', o.companyId] });
    },
  });
}

// ── V1.1 hooks ────────────────────────────────────────────────────────────────

// Success plans: create + status edit (A5)
export function useCreateSuccessPlan() {
  const qc = useQueryClient();
  const { profile } = useSession();
  return useMutation({
    mutationFn: async (p: { companyId: string; name: string; ownerId?: string; targetDate?: string | null; objectives?: string[] }) => {
      const planId = newId('sp');
      const plan = insert('successPlans', {
        id: planId, companyId: p.companyId, name: p.name, ownerId: p.ownerId ?? profile.id,
        status: 'active', targetDate: p.targetDate ?? null, progressPct: 0,
      } as SuccessPlan);
      (p.objectives ?? []).filter((t) => t.trim()).forEach((title, i) =>
        insert('objectives', {
          id: newId('ob'), planId, companyId: p.companyId, title, businessOutcome: null, metric: null,
          targetDate: p.targetDate ?? null, status: 'not_started', position: i, notes: null,
        } as SuccessPlanObjective));
      insert('activities', {
        id: newId('ac'), companyId: p.companyId, contactIds: [], userId: profile.id, type: 'system',
        title: `Success plan "${p.name}" created`, snippet: `by ${profile.fullName}`, occurredAt: new Date().toISOString(), meta: {},
      } as Activity);
      return plan;
    },
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: ['successPlans'] });
      qc.invalidateQueries({ queryKey: ['objectives'] });
      qc.invalidateQueries({ queryKey: ['activities', v.companyId] });
    },
  });
}

export function useUpdateSuccessPlan() {
  const qc = useQueryClient();
  const { profile } = useSession();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<SuccessPlan> }) => {
      const before = (all('successPlans') as SuccessPlan[]).find((p) => p.id === id);
      const p = update('successPlans', id, patch);
      if (p && patch.status && before && before.status !== patch.status) {
        insert('activities', {
          id: newId('ac'), companyId: p.companyId, contactIds: [], userId: profile.id, type: 'system',
          title: `Success plan "${p.name}" → ${patch.status}`, snippet: `Status changed by ${profile.fullName}`,
          occurredAt: new Date().toISOString(), meta: {},
        } as Activity);
      }
      return p;
    },
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ['successPlans'] });
      if (p) qc.invalidateQueries({ queryKey: ['activities', p.companyId] });
    },
  });
}

// Contacts inline edit (B4) → optional health recompute
export function useUpdateContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Contact> }) => update('contacts', id, patch),
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ['contacts'] });
      if (c) qc.invalidateQueries({ queryKey: ['contact', c.id] });
    },
  });
}

export function useContact(id: string | undefined) {
  return useQuery({
    queryKey: ['contact', id],
    enabled: !!id,
    queryFn: () => (all('contacts') as Contact[]).find((c) => c.id === id) ?? null,
  });
}

// Products & whitespace (C5)
export function useProducts() {
  return useQuery({ queryKey: ['products'], queryFn: () => all('products') as Product[] });
}
export function useCompanyProducts(companyId?: string) {
  return useQuery({
    queryKey: ['companyProducts', companyId],
    queryFn: () => (all('companyProducts') as CompanyProduct[]).filter((cp) => !companyId || cp.companyId === companyId),
  });
}
export function useUpsertCompanyProduct() {
  const qc = useQueryClient();
  const { profile } = useSession();
  return useMutation({
    mutationFn: async ({ companyId, productId, status, arr }: { companyId: string; productId: string; status: CompanyProductStatus; arr?: number | null }) => {
      const existing = (all('companyProducts') as CompanyProduct[]).find((cp) => cp.companyId === companyId && cp.productId === productId);
      if (existing) return update('companyProducts', existing.id, { status, arr: arr ?? existing.arr, updatedBy: profile.id });
      return insert('companyProducts', { id: newId('cp'), companyId, productId, status, arr: arr ?? null, note: null, updatedBy: profile.id } as CompanyProduct);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['companyProducts'] }),
  });
}
export function useCreateDeal() {
  const qc = useQueryClient();
  const { profile } = useSession();
  return useMutation({
    mutationFn: async (d: Partial<Deal> & { companyId: string; name: string }) =>
      insert('deals', {
        id: newId('dl'), companyId: d.companyId, hubspotDealId: null, pipeline: d.pipeline ?? 'expansion',
        stage: d.stage ?? 'Discovery', stageProbability: 0.3, forecastCategory: 'pipeline',
        name: d.name, amount: d.amount ?? null, currency: 'USD', closeDate: d.closeDate ?? null,
        ownerId: profile.id, status: 'open', nextSteps: null, aiSummary: null, confidence: 40,
        qualification: {}, suggestedStage: null, suggestedStageReason: null, contactIds: [], lastSyncedAt: null,
      } as Deal),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['deals'] }),
  });
}

// Notifications (D6)
export function useNotifications() {
  const { profile } = useSession();
  return useQuery({
    queryKey: ['notifications', profile.id],
    queryFn: () => (all('notifications') as Notification[]).filter((n) => n.userId === profile.id).sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)),
  });
}
export function useMarkNotificationsRead() {
  const qc = useQueryClient();
  const { profile } = useSession();
  return useMutation({
    mutationFn: async (id?: string) => {
      const rows = (all('notifications') as Notification[]).filter((n) => n.userId === profile.id && !n.readAt && (!id || n.id === id));
      rows.forEach((n) => update('notifications', n.id, { readAt: new Date().toISOString() }));
      return rows.length;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
}
export function useCreateNotification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (n: { userId: string; kind: Notification['kind']; title: string; body?: string; link?: string }) =>
      insert('notifications', { id: newId('ntf'), userId: n.userId, kind: n.kind, title: n.title, body: n.body ?? null, link: n.link ?? null, readAt: null, createdAt: new Date().toISOString() } as Notification),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
}

// Library (D4)
export function useLibraryItems() {
  return useQuery({ queryKey: ['library'], queryFn: () => all('libraryItems') as LibraryItem[] });
}
export function useLibraryMutations() {
  const qc = useQueryClient();
  const { profile } = useSession();
  const create = useMutation({
    mutationFn: async (it: Partial<LibraryItem> & { title: string; itemType: LibraryItem['itemType'] }) =>
      insert('libraryItems', { id: newId('lib'), title: it.title, description: it.description ?? null, itemType: it.itemType, url: it.url ?? null, storagePath: it.storagePath ?? null, tags: it.tags ?? [], segments: it.segments ?? [], uploadedBy: profile.id, downloadCount: 0, createdAt: new Date().toISOString() } as LibraryItem),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['library'] }),
  });
  const incrementDownload = useMutation({
    mutationFn: async (id: string) => { const it = (all('libraryItems') as LibraryItem[]).find((x) => x.id === id); return update('libraryItems', id, { downloadCount: (it?.downloadCount ?? 0) + 1 }); },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['library'] }),
  });
  return { create, incrementDownload };
}

// Dashboards (D2)
export function useDashboards() {
  const { profile, allProfiles } = useSession();
  return useQuery({
    queryKey: ['dashboards', profile.id],
    queryFn: () => {
      const teamIds = new Set(allProfiles.filter((p) => p.managerId === profile.id).map((p) => p.id));
      return (all('dashboards') as Dashboard[]).filter((d) =>
        d.ownerId === profile.id || profile.role === 'admin' || (d.shared && (d.ownerId != null && teamIds.has(d.ownerId))) || (d.shared && d.ownerId === profile.id));
    },
  });
}
export function useDashboardWidgets(dashboardId?: string) {
  return useQuery({
    queryKey: ['dashboardWidgets', dashboardId],
    queryFn: () => (all('dashboardWidgets') as DashboardWidget[]).filter((w) => !dashboardId || w.dashboardId === dashboardId),
  });
}
export function useDashboardMutations() {
  const qc = useQueryClient();
  const { profile } = useSession();
  const createDashboard = useMutation({
    mutationFn: async (name: string) => insert('dashboards', { id: newId('dash'), name, ownerId: profile.id, shared: false, layout: null } as Dashboard),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboards'] }),
  });
  const updateDashboard = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Dashboard> }) => update('dashboards', id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboards'] }),
  });
  const addWidget = useMutation({
    mutationFn: async (w: Partial<DashboardWidget> & { dashboardId: string; kind: DashboardWidget['kind']; dataset: string; title: string }) =>
      insert('dashboardWidgets', { id: newId('dw'), dashboardId: w.dashboardId, position: w.position ?? { x: 0, y: 0, w: 2, h: 2 }, kind: w.kind, dataset: w.dataset, groupBy: w.groupBy ?? null, measure: w.measure ?? 'count', filter: w.filter ?? {}, title: w.title } as DashboardWidget),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboardWidgets'] }),
  });
  const removeWidget = useMutation({
    mutationFn: async (id: string) => { remove('dashboardWidgets', id); return id; },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboardWidgets'] }),
  });
  return { createDashboard, updateDashboard, addWidget, removeWidget };
}

// Ask Compass (D1)
export function useAskThreads() {
  const { profile } = useSession();
  return useQuery({
    queryKey: ['askThreads', profile.id],
    queryFn: () => (all('askThreads') as AskThread[]).filter((t) => t.userId === profile.id).sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)),
  });
}
export function useAskMessages(threadId?: string) {
  return useQuery({
    queryKey: ['askMessages', threadId],
    queryFn: () => (all('askMessages') as AskMessage[]).filter((m) => m.threadId === threadId).sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt)),
  });
}

export function useAskSend() {
  const qc = useQueryClient();
  const { profile } = useSession();
  return useMutation({
    mutationFn: async ({ threadId, message, answer, toolCalls }: { threadId?: string; message: string; answer: string; toolCalls?: { name: string }[] }) => {
      let tid = threadId;
      if (!tid) {
        tid = newId('akt');
        insert('askThreads', { id: tid, userId: profile.id, title: message.split(' ').slice(0, 6).join(' '), createdAt: new Date().toISOString() } as AskThread);
      }
      insert('askMessages', { id: newId('akm'), threadId: tid, role: 'user', content: message, createdAt: new Date().toISOString() } as AskMessage);
      insert('askMessages', { id: newId('akm'), threadId: tid, role: 'assistant', content: answer, toolCalls: toolCalls ?? null, createdAt: new Date().toISOString() } as AskMessage);
      return tid;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['askThreads'] }); qc.invalidateQueries({ queryKey: ['askMessages'] }); },
  });
}

// Changelog (D7)
export function useChangelog() {
  return useQuery({ queryKey: ['changelog'], queryFn: () => (all('changelog') as ChangelogEntry[]).slice().sort((a, b) => a.position - b.position) });
}

// Update the current profile (sidebar collapse, last_seen_version)
export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Profile> }) => update('profiles', id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['profiles'] }),
  });
}

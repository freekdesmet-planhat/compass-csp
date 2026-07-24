import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { all, update, insert, remove, newId, getDb } from './store';
import { isDemoMode } from './supabase';
import {
  fetchCompanies, fetchCompany, fetchContacts, fetchContact, fetchProfiles,
  updateContactRow, insertTaskRow,
  fetchActivities, fetchDeals, fetchTasks, fetchNps, fetchUsageMetrics,
  fetchSuccessPlans, fetchObjectives,
  insertActivityRow, insertDealRow, insertSuccessPlanRow, insertObjectiveRows,
  updateObjectiveRow, updateSuccessPlanRow,
  fetchHealthSnapshots, fetchNotifications, fetchProducts, fetchCompanyProducts,
  fetchLibraryItems, fetchDashboards, fetchDashboardWidgets, fetchAskThreads, fetchAskMessages,
  updateCompanyRow, updateTaskRow, updateDealRow, updateAlertRow, updateProfileRow,
  insertNpsRow, upsertHealthSnapshotRow, insertNotificationRow, markNotificationsReadRows,
  insertLibraryItemRow, incrementLibraryDownloadRow, insertDashboardRow, updateDashboardRow,
  insertDashboardWidgetRow, deleteDashboardWidgetRow, insertAskThreadRow, insertAskMessageRow,
  upsertCompanyProductRow,
  fetchPlaybookTemplates, fetchPlaybookGroups, fetchPlaybookSteps,
  insertPlaybookTemplateRow, updatePlaybookTemplateRow, deletePlaybookTemplateRow,
  insertPlaybookGroupRow, updatePlaybookGroupRow, deletePlaybookGroupRow,
  insertPlaybookStepRow, updatePlaybookStepRow, deletePlaybookStepRow, reorderPlaybookStepsRows,
  fetchPlaybookRuns, fetchPlaybookRunSteps, insertPlaybookRunRow, insertPlaybookRunStepRow,
  updatePlaybookRunStepRow, archivePlaybookRunRow, insertPlaybookTaskRow, setTaskCompletedRow,
  fetchAutomations, fetchAutomationSteps, fetchAutomationRuns,
  insertAutomationRow, updateAutomationRow, deleteAutomationRow,
  insertAutomationStepRow, updateAutomationStepRow, deleteAutomationStepRow,
} from './realStore';
import { planRun, reevaluateRun } from './playbookRunner';
import { companyRuleContext } from './rules';
import type { AutomationStarter } from './automationStarters';
import { useSession } from './session';
import { computeHealth, type HealthInputs } from './health';
import { DEFAULT_HEALTH_WEIGHTS, DEFAULT_HEALTH_THRESHOLDS } from './segments';
import type {
  Company, Contact, Activity, Deal, Task, Alert, HealthSnapshot, SuccessPlan,
  SuccessPlanObjective, NpsResponse, CsatResponse, Ticket, UsageMetric, CalendarEvent,
  MeetingPrep, Digest, EmailMessage, Note, Profile,
  Notification, Product, CompanyProduct, CompanyProductStatus, LibraryItem, Dashboard,
  DashboardWidget, AskThread, AskMessage, ChangelogEntry,
  PlaybookTemplate, PlaybookGroup, PlaybookStep, PlaybookRun, PlaybookRunStep, RunStepState,
  Automation, AutomationStep, AutomationRun,
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
  const { profile, allProfiles, isImpersonating } = useSession();
  return useQuery({
    queryKey: ['companies', profile.id], // profile.id = effective id → re-runs when view-as changes
    queryFn: async () => {
      if (!isDemoMode) {
        const rows = await fetchCompanies(); // RLS: all rows for an admin, own rows otherwise
        // Admin "view as": narrow the admin's full set to the impersonated persona's scope.
        if (!isImpersonating) return rows;
        const scope = visibleOwnerScope(profile, allProfiles);
        return rows.filter((c) => scope(c.ownerId, c.collaboratorIds));
      }
      const scope = visibleOwnerScope(profile, allProfiles);
      return (all('companies') as Company[]).filter((c) => scope(c.ownerId, c.collaboratorIds));
    },
  });
}

export function useCompany(id: string | undefined) {
  return useQuery({
    queryKey: ['company', id],
    enabled: !!id,
    queryFn: async () => {
      if (!isDemoMode) return fetchCompany(id!);
      return (all('companies') as Company[]).find((c) => c.id === id) ?? null;
    },
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
    queryFn: async () => {
      if (!isDemoMode) return fetchContacts(companyId);
      return (all('contacts') as Contact[]).filter((c) => !companyId || c.companyId === companyId);
    },
  });
}

export function useActivities(companyId?: string) {
  return useQuery({
    queryKey: ['activities', companyId],
    queryFn: async () => {
      if (!isDemoMode) return fetchActivities(companyId);
      return (all('activities') as Activity[])
        .filter((a) => !companyId || a.companyId === companyId)
        .sort((a, b) => +new Date(b.occurredAt) - +new Date(a.occurredAt));
    },
  });
}

export function useDeals(companyId?: string) {
  return useQuery({
    queryKey: ['deals', companyId],
    queryFn: async () => (isDemoMode ? (all('deals') as Deal[]).filter((d) => !companyId || d.companyId === companyId) : fetchDeals(companyId)),
  });
}

export function useTasks(companyId?: string) {
  return useQuery({
    queryKey: ['tasks', companyId],
    queryFn: async () => (isDemoMode ? (all('tasks') as Task[]).filter((t) => !companyId || t.companyId === companyId) : fetchTasks(companyId)),
  });
}

// Alerts/alert-rules: not generated in real mode yet → empty (no fake data).
export function useAlerts() {
  return useQuery({ queryKey: ['alerts'], queryFn: () => (isDemoMode ? (all('alerts') as Alert[]) : ([] as Alert[])) });
}

export function useAlertRules() {
  return useQuery({ queryKey: ['alertRules'], queryFn: () => (isDemoMode ? getDb().alertRules : getDb().alertRules.slice(0, 0)) });
}

// Health snapshots aren't produced by the Planhat sync, but useRecomputeHealth
// writes them in real mode → read live so recomputed scores/trends appear.
export function useHealthSnapshots(companyId?: string) {
  return useQuery({
    queryKey: ['healthSnapshots', companyId],
    queryFn: async () =>
      isDemoMode
        ? (all('healthSnapshots') as HealthSnapshot[])
            .filter((h) => !companyId || h.companyId === companyId)
            .sort((a, b) => +new Date(a.snapshotDate) - +new Date(b.snapshotDate))
        : fetchHealthSnapshots(companyId),
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
    queryFn: async () => (isDemoMode ? (all('successPlans') as SuccessPlan[]).filter((p) => !companyId || p.companyId === companyId) : fetchSuccessPlans(companyId)),
  });
}

export function useObjectives(companyId?: string, planId?: string) {
  return useQuery({
    queryKey: ['objectives', companyId, planId],
    queryFn: async () =>
      isDemoMode
        ? (all('objectives') as SuccessPlanObjective[])
            .filter((o) => (!companyId || o.companyId === companyId) && (!planId || o.planId === planId))
            .sort((a, b) => a.position - b.position)
        : fetchObjectives(companyId, planId),
  });
}

export function useNps(companyId?: string) {
  return useQuery({ queryKey: ['nps', companyId], queryFn: async () => (isDemoMode ? (all('npsResponses') as NpsResponse[]).filter((n) => !companyId || n.companyId === companyId) : fetchNps(companyId)) });
}
export function useCreateNps() {
  const qc = useQueryClient();
  const { profile } = useSession();
  return useMutation({
    mutationFn: async (n: { companyId: string; score: number; comment?: string; contactId?: string | null }) => {
      if (!isDemoMode) {
        const row = await insertNpsRow({ companyId: n.companyId, contactId: n.contactId ?? null, score: n.score, comment: n.comment ?? null });
        await insertActivityRow({ companyId: n.companyId, contactIds: n.contactId ? [n.contactId] : [], userId: profile.id, type: 'nps', title: `NPS ${n.score}`, snippet: n.comment ?? '', occurredAt: new Date().toISOString(), meta: { sentiment: n.score / 100, logged_manually: true } });
        return row;
      }
      const row = insert('npsResponses', { id: newId('nps'), companyId: n.companyId, contactId: n.contactId ?? null, score: n.score, comment: n.comment ?? null, respondedAt: new Date().toISOString() } as NpsResponse);
      insert('activities', { id: newId('ac'), companyId: n.companyId, contactIds: n.contactId ? [n.contactId] : [], userId: profile.id, type: 'nps', title: `NPS ${n.score}`, snippet: n.comment ?? '', occurredAt: new Date().toISOString(), meta: { sentiment: n.score / 100, logged_manually: true } } as Activity);
      return row;
    },
    onSuccess: (_r, v) => { qc.invalidateQueries({ queryKey: ['nps'] }); qc.invalidateQueries({ queryKey: ['activities', v.companyId] }); },
  });
}
// CSAT / tickets / calendar / meeting-preps / emails / notes / digests come from
// integrations (support, Gmail, Gcal, Fathom) or compute jobs not wired to real
// mode yet → empty in real mode (no demo data leaks in).
export function useCsat(companyId?: string) {
  return useQuery({ queryKey: ['csat', companyId], queryFn: () => (isDemoMode ? (all('csatResponses') as CsatResponse[]).filter((n) => !companyId || n.companyId === companyId) : ([] as CsatResponse[])) });
}
export function useTickets(companyId?: string) {
  return useQuery({ queryKey: ['tickets', companyId], queryFn: () => (isDemoMode ? (all('tickets') as Ticket[]).filter((t) => !companyId || t.companyId === companyId) : ([] as Ticket[])) });
}
export function useUsageMetrics(companyId?: string) {
  return useQuery({ queryKey: ['usage', companyId], queryFn: async () => (isDemoMode ? (all('usageMetrics') as UsageMetric[]).filter((u) => !companyId || u.companyId === companyId) : fetchUsageMetrics(companyId)) });
}
export function useCalendarEvents(companyId?: string) {
  return useQuery({ queryKey: ['calendar', companyId], queryFn: () => (isDemoMode ? (all('calendarEvents') as CalendarEvent[]).filter((e) => !companyId || e.companyId === companyId) : ([] as CalendarEvent[])) });
}
export function useMeetingPreps() {
  return useQuery({ queryKey: ['meetingPreps'], queryFn: () => (isDemoMode ? (all('meetingPreps') as MeetingPrep[]) : ([] as MeetingPrep[])) });
}
export function useEmails(companyId?: string) {
  return useQuery({ queryKey: ['emails', companyId], queryFn: () => (isDemoMode ? (all('emails') as EmailMessage[]).filter((e) => !companyId || e.companyId === companyId).sort((a, b) => +new Date(b.sentAt) - +new Date(a.sentAt)) : ([] as EmailMessage[])) });
}
export function useNotes(companyId?: string) {
  return useQuery({ queryKey: ['notes', companyId], queryFn: () => (isDemoMode ? ((getDb().activities as Activity[]).filter((a) => a.type === 'note' && (!companyId || a.companyId === companyId)) as unknown as Note[]) : ([] as Note[])) });
}
export function useDigest(userId: string, type: 'daily' | 'weekly_exec' = 'daily') {
  return useQuery({
    queryKey: ['digest', userId, type],
    queryFn: () => (isDemoMode ? ((all('digests') as Digest[]).filter((d) => d.userId === userId && d.digestType === type).sort((a, b) => +new Date(b.digestDate) - +new Date(a.digestDate))[0] ?? null) : null),
  });
}

export function useProfiles() {
  return useQuery({ queryKey: ['profiles'], queryFn: async () => (isDemoMode ? getDb().profiles : fetchProfiles()) });
}

// ── Mutations ────────────────────────────────────────────────────────────────
export function useUpdateCompany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Company> }) =>
      isDemoMode ? update('companies', id, patch) : await updateCompanyRow(id, patch as Record<string, unknown>),
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
      let company: Company | null | undefined;
      let contacts: Contact[]; let tickets: Ticket[]; let nps: NpsResponse[]; let usage: UsageMetric[];
      if (!isDemoMode) {
        company = await fetchCompany(companyId);
        if (!company || !company.segment) return null;
        [contacts, nps, usage] = await Promise.all([fetchContacts(companyId), fetchNps(companyId), fetchUsageMetrics(companyId)]);
        tickets = []; // no ticketing integration in real mode yet
      } else {
        company = (all('companies') as Company[]).find((c) => c.id === companyId);
        if (!company || !company.segment) return null;
        contacts = (all('contacts') as Contact[]).filter((c) => c.companyId === companyId);
        tickets = (all('tickets') as Ticket[]).filter((t) => t.companyId === companyId && t.status === 'open');
        nps = (all('npsResponses') as NpsResponse[]).filter((n) => n.companyId === companyId);
        usage = (all('usageMetrics') as UsageMetric[]).filter((u) => u.companyId === companyId);
      }
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
      const healthPatch = { healthScore: res.overall, healthBand: res.band, healthDeltaWow: res.overall - prev, healthUpdatedAt: new Date().toISOString() };
      if (!isDemoMode) {
        await updateCompanyRow(companyId, healthPatch);
        // upsert today's snapshot (real mode has no pre-existing weekly snapshot)
        await upsertHealthSnapshotRow({ companyId, snapshotDate: new Date().toISOString().slice(0, 10), isWeekly: false, overall: res.overall, band: res.band, deltaWow: res.overall - prev, dimensions: res.dimensions, source: 'recompute' });
        return res;
      }
      update('companies', companyId, healthPatch);
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
    mutationFn: async (task: Task) => {
      const patch = { completedAt: task.completedAt ? null : new Date().toISOString() };
      return isDemoMode ? update('tasks', task.id, patch) : updateTaskRow(task.id, patch);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });
}

export function useCreateTask() {
  const qc = useQueryClient();
  const { profile } = useSession();
  return useMutation({
    mutationFn: async (t: Partial<Task> & { companyId: string; title: string }) => {
      if (!isDemoMode) {
        const assigneeId = t.assigneeId ?? profile.id;
        await insertTaskRow({ ...t, creatorId: profile.id });
        if (assigneeId !== profile.id) {
          await insertNotificationRow({ userId: assigneeId, kind: 'task_assigned', title: 'New task assigned', body: `${profile.fullName} assigned you "${t.title}".`, link: `/company/${t.companyId}?tab=tasks` });
        }
        return null;
      }
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
    mutationFn: async (a: Partial<Activity> & { companyId: string; type: Activity['type']; title: string }) => {
      if (!isDemoMode) return insertActivityRow({
        companyId: a.companyId, contactIds: a.contactIds ?? [], userId: profile.id, type: a.type,
        direction: a.direction ?? null, title: a.title, snippet: a.snippet ?? '',
        occurredAt: a.occurredAt ?? new Date().toISOString(), meta: a.meta ?? {},
      });
      return insert('activities', {
        id: newId('ac'), companyId: a.companyId, contactIds: a.contactIds ?? [], userId: profile.id,
        type: a.type, direction: a.direction ?? null, title: a.title, snippet: a.snippet ?? '',
        occurredAt: a.occurredAt ?? new Date().toISOString(), meta: a.meta ?? {},
      } as Activity);
    },
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: ['activities', v.companyId] });
      qc.invalidateQueries({ queryKey: ['activities', undefined] });
    },
  });
}

export function useUpdateAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Alert> }) =>
      isDemoMode ? update('alerts', id, patch) : await updateAlertRow(id, patch as Record<string, unknown>),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alerts'] }),
  });
}

export function useUpdateDeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Deal> }) =>
      isDemoMode ? update('deals', id, patch) : await updateDealRow(id, patch as Record<string, unknown>),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['deals'] }),
  });
}

export function useUpdateObjective() {
  const qc = useQueryClient();
  const { profile } = useSession();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<SuccessPlanObjective> }) => {
      if (!isDemoMode) {
        const o = await updateObjectiveRow(id, patch as Record<string, unknown>);
        if (o) {
          // recompute plan progress from the (now-updated) objective statuses
          const objs = await fetchObjectives(o.companyId, o.planId);
          const score = objs.reduce((a, x) => a + (x.status === 'achieved' ? 1 : x.status === 'on_track' ? 0.5 : x.status === 'at_risk' ? 0.25 : 0), 0);
          await updateSuccessPlanRow(o.planId, { progressPct: Math.round((score / (objs.length || 1)) * 100) });
          if (patch.status) {
            await insertActivityRow({
              companyId: o.companyId, contactIds: [], userId: profile.id, type: 'system',
              title: `Objective "${o.title}" → ${String(patch.status).replace(/_/g, ' ')}`, snippet: `Status changed by ${profile.fullName}`,
              occurredAt: new Date().toISOString(), meta: {},
            });
          }
        }
        return o;
      }
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
      if (!isDemoMode) {
        const plan = await insertSuccessPlanRow({ companyId: p.companyId, name: p.name, ownerId: p.ownerId ?? profile.id, status: 'active', targetDate: p.targetDate ?? null, progressPct: 0 });
        const titles = (p.objectives ?? []).filter((t) => t.trim());
        await insertObjectiveRows(titles.map((title, i) => ({ planId: plan.id, companyId: p.companyId, title, targetDate: p.targetDate ?? null, status: 'not_started', position: i })));
        await insertActivityRow({ companyId: p.companyId, contactIds: [], userId: profile.id, type: 'system', title: `Success plan "${p.name}" created`, snippet: `by ${profile.fullName}`, occurredAt: new Date().toISOString(), meta: {} });
        return plan;
      }
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
      if (!isDemoMode) {
        const p = await updateSuccessPlanRow(id, patch as Record<string, unknown>);
        if (p && patch.status) {
          await insertActivityRow({ companyId: p.companyId, contactIds: [], userId: profile.id, type: 'system', title: `Success plan "${p.name}" → ${patch.status}`, snippet: `Status changed by ${profile.fullName}`, occurredAt: new Date().toISOString(), meta: {} });
        }
        return p;
      }
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
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Contact> }) =>
      isDemoMode ? update('contacts', id, patch) : await updateContactRow(id, patch as Record<string, unknown>),
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
    queryFn: async () => {
      if (!isDemoMode) return fetchContact(id!);
      return (all('contacts') as Contact[]).find((c) => c.id === id) ?? null;
    },
  });
}

// Products & whitespace (C5)
export function useProducts() {
  return useQuery({ queryKey: ['products'], queryFn: async () => (isDemoMode ? (all('products') as Product[]) : fetchProducts()) });
}
export function useCompanyProducts(companyId?: string) {
  return useQuery({
    queryKey: ['companyProducts', companyId],
    queryFn: async () => (isDemoMode ? (all('companyProducts') as CompanyProduct[]).filter((cp) => !companyId || cp.companyId === companyId) : fetchCompanyProducts(companyId)),
  });
}
export function useUpsertCompanyProduct() {
  const qc = useQueryClient();
  const { profile } = useSession();
  return useMutation({
    mutationFn: async ({ companyId, productId, status, arr }: { companyId: string; productId: string; status: CompanyProductStatus; arr?: number | null }) => {
      if (!isDemoMode) return upsertCompanyProductRow({ companyId, productId, status, arr, updatedBy: profile.id });
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
    mutationFn: async (d: Partial<Deal> & { companyId: string; name: string }) => {
      if (!isDemoMode) return insertDealRow({
        companyId: d.companyId, name: d.name, pipeline: d.pipeline ?? 'expansion', stage: d.stage ?? 'Discovery',
        stageProbability: 0.3, forecastCategory: 'pipeline', amount: d.amount ?? null, currency: 'USD',
        closeDate: d.closeDate ?? null, ownerId: profile.id, status: 'open', confidence: 40, qualification: {}, contactIds: [],
      });
      return insert('deals', {
        id: newId('dl'), companyId: d.companyId, hubspotDealId: null, pipeline: d.pipeline ?? 'expansion',
        stage: d.stage ?? 'Discovery', stageProbability: 0.3, forecastCategory: 'pipeline',
        name: d.name, amount: d.amount ?? null, currency: 'USD', closeDate: d.closeDate ?? null,
        ownerId: profile.id, status: 'open', nextSteps: null, aiSummary: null, confidence: 40,
        qualification: {}, suggestedStage: null, suggestedStageReason: null, contactIds: [], lastSyncedAt: null,
      } as Deal);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['deals'] }),
  });
}

// Notifications (D6)
export function useNotifications() {
  const { profile } = useSession();
  return useQuery({
    queryKey: ['notifications', profile.id],
    queryFn: async () => (isDemoMode ? (all('notifications') as Notification[]).filter((n) => n.userId === profile.id).sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)) : fetchNotifications(profile.id)),
  });
}
export function useMarkNotificationsRead() {
  const qc = useQueryClient();
  const { profile } = useSession();
  return useMutation({
    mutationFn: async (id?: string) => {
      if (!isDemoMode) return markNotificationsReadRows(profile.id, id);
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
      isDemoMode
        ? insert('notifications', { id: newId('ntf'), userId: n.userId, kind: n.kind, title: n.title, body: n.body ?? null, link: n.link ?? null, readAt: null, createdAt: new Date().toISOString() } as Notification)
        : await insertNotificationRow({ userId: n.userId, kind: n.kind, title: n.title, body: n.body ?? null, link: n.link ?? null }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
}

// Library (D4)
export function useLibraryItems() {
  return useQuery({ queryKey: ['library'], queryFn: async () => (isDemoMode ? (all('libraryItems') as LibraryItem[]) : fetchLibraryItems()) });
}
export function useLibraryMutations() {
  const qc = useQueryClient();
  const { profile } = useSession();
  const create = useMutation({
    mutationFn: async (it: Partial<LibraryItem> & { title: string; itemType: LibraryItem['itemType'] }) =>
      isDemoMode
        ? insert('libraryItems', { id: newId('lib'), title: it.title, description: it.description ?? null, itemType: it.itemType, url: it.url ?? null, storagePath: it.storagePath ?? null, tags: it.tags ?? [], segments: it.segments ?? [], uploadedBy: profile.id, downloadCount: 0, createdAt: new Date().toISOString() } as LibraryItem)
        : await insertLibraryItemRow({ title: it.title, description: it.description ?? null, itemType: it.itemType, url: it.url ?? null, storagePath: it.storagePath ?? null, tags: it.tags ?? [], segments: it.segments ?? [], uploadedBy: profile.id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['library'] }),
  });
  const incrementDownload = useMutation({
    mutationFn: async (id: string) => {
      if (!isDemoMode) return incrementLibraryDownloadRow(id);
      const it = (all('libraryItems') as LibraryItem[]).find((x) => x.id === id); return update('libraryItems', id, { downloadCount: (it?.downloadCount ?? 0) + 1 });
    },
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
      if (!isDemoMode) return fetchDashboards(); // RLS scopes to owner/shared
      const teamIds = new Set(allProfiles.filter((p) => p.managerId === profile.id).map((p) => p.id));
      return (all('dashboards') as Dashboard[]).filter((d) =>
        d.ownerId === profile.id || profile.role === 'admin' || (d.shared && (d.ownerId != null && teamIds.has(d.ownerId))) || (d.shared && d.ownerId === profile.id));
    },
  });
}
export function useDashboardWidgets(dashboardId?: string) {
  return useQuery({
    queryKey: ['dashboardWidgets', dashboardId],
    queryFn: async () => (isDemoMode ? (all('dashboardWidgets') as DashboardWidget[]).filter((w) => !dashboardId || w.dashboardId === dashboardId) : fetchDashboardWidgets(dashboardId)),
  });
}
export function useDashboardMutations() {
  const qc = useQueryClient();
  const { profile } = useSession();
  const createDashboard = useMutation({
    mutationFn: async (name: string) => isDemoMode ? insert('dashboards', { id: newId('dash'), name, ownerId: profile.id, shared: false, layout: null } as Dashboard) : await insertDashboardRow(name, profile.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboards'] }),
  });
  const updateDashboard = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Dashboard> }) => isDemoMode ? update('dashboards', id, patch) : await updateDashboardRow(id, patch as Record<string, unknown>),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboards'] }),
  });
  const addWidget = useMutation({
    mutationFn: async (w: Partial<DashboardWidget> & { dashboardId: string; kind: DashboardWidget['kind']; dataset: string; title: string }) =>
      isDemoMode
        ? insert('dashboardWidgets', { id: newId('dw'), dashboardId: w.dashboardId, position: w.position ?? { x: 0, y: 0, w: 2, h: 2 }, kind: w.kind, dataset: w.dataset, groupBy: w.groupBy ?? null, measure: w.measure ?? 'count', filter: w.filter ?? {}, title: w.title } as DashboardWidget)
        : await insertDashboardWidgetRow({ dashboardId: w.dashboardId, position: w.position, kind: w.kind, dataset: w.dataset, groupBy: w.groupBy ?? null, measure: w.measure ?? 'count', filter: w.filter ?? {}, title: w.title }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboardWidgets'] }),
  });
  const removeWidget = useMutation({
    mutationFn: async (id: string) => { if (!isDemoMode) { await deleteDashboardWidgetRow(id); return id; } remove('dashboardWidgets', id); return id; },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboardWidgets'] }),
  });
  return { createDashboard, updateDashboard, addWidget, removeWidget };
}

// Ask Compass (D1)
export function useAskThreads() {
  const { profile } = useSession();
  return useQuery({
    queryKey: ['askThreads', profile.id],
    queryFn: async () => (isDemoMode ? (all('askThreads') as AskThread[]).filter((t) => t.userId === profile.id).sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)) : fetchAskThreads(profile.id)),
  });
}
export function useAskMessages(threadId?: string) {
  return useQuery({
    queryKey: ['askMessages', threadId],
    queryFn: async () => (isDemoMode ? (all('askMessages') as AskMessage[]).filter((m) => m.threadId === threadId).sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt)) : fetchAskMessages(threadId)),
  });
}

export function useAskSend() {
  const qc = useQueryClient();
  const { profile } = useSession();
  return useMutation({
    mutationFn: async ({ threadId, message, answer, toolCalls }: { threadId?: string; message: string; answer: string; toolCalls?: { name: string }[] }) => {
      if (!isDemoMode) {
        let tid = threadId;
        if (!tid) { const t = await insertAskThreadRow(profile.id, message.split(' ').slice(0, 6).join(' ')); tid = t.id; }
        await insertAskMessageRow({ threadId: tid, role: 'user', content: message });
        await insertAskMessageRow({ threadId: tid, role: 'assistant', content: answer, toolCalls: toolCalls ?? null });
        return tid;
      }
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
  return useQuery({ queryKey: ['changelog'], queryFn: () => (isDemoMode ? (all('changelog') as ChangelogEntry[]).slice().sort((a, b) => a.position - b.position) : ([] as ChangelogEntry[])) });
}

// Update the current profile (sidebar collapse, last_seen_version)
export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Profile> }) =>
      isDemoMode ? update('profiles', id, patch) : await updateProfileRow(id, patch as Record<string, unknown>),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['profiles'] }),
  });
}

// ── V2 Playbooks: templates / groups / steps (iteration2.md Part A) ─────────
export function usePlaybookTemplates() {
  return useQuery({
    queryKey: ['playbookTemplates'],
    queryFn: async () => (isDemoMode ? (all('playbookTemplates') as PlaybookTemplate[]).filter((t) => t.status !== 'archived') : fetchPlaybookTemplates()),
  });
}
export function usePlaybookGroups(templateId?: string) {
  return useQuery({
    queryKey: ['playbookGroups', templateId], enabled: !!templateId,
    queryFn: async () => (isDemoMode ? (all('playbookGroups') as PlaybookGroup[]).filter((g) => g.templateId === templateId).sort((a, b) => a.position - b.position) : fetchPlaybookGroups(templateId!)),
  });
}
export function usePlaybookSteps(templateId?: string) {
  return useQuery({
    queryKey: ['playbookSteps', templateId], enabled: !!templateId,
    queryFn: async () => (isDemoMode ? (all('playbookSteps') as PlaybookStep[]).filter((s) => s.templateId === templateId).sort((a, b) => a.position - b.position) : fetchPlaybookSteps(templateId!)),
  });
}
export function usePlaybookMutations() {
  const qc = useQueryClient();
  const inval = () => { qc.invalidateQueries({ queryKey: ['playbookTemplates'] }); qc.invalidateQueries({ queryKey: ['playbookGroups'] }); qc.invalidateQueries({ queryKey: ['playbookSteps'] }); };
  const createTemplate = useMutation({
    mutationFn: async (t: { name: string; type?: PlaybookTemplate['type']; targetModel?: PlaybookTemplate['targetModel'] }) => {
      if (!isDemoMode) return insertPlaybookTemplateRow({ name: t.name, type: t.type, targetModel: t.targetModel });
      const tpl = insert('playbookTemplates', { id: newId('pt'), name: t.name, description: null, type: t.type ?? 'project', targetModel: t.targetModel ?? 'company', status: 'draft', entryCriteria: {}, exitCriteria: {}, exitArchiveAction: 'keep_remaining', createdBy: null, segment: [] } as PlaybookTemplate);
      insert('playbookGroups', { id: newId('pg'), templateId: tpl.id, name: 'Steps', position: 0, groupCondition: {}, expireBehavior: 'keep' } as PlaybookGroup);
      return tpl;
    }, onSuccess: inval,
  });
  const updateTemplate = useMutation({ mutationFn: async ({ id, patch }: { id: string; patch: Partial<PlaybookTemplate> }) => (isDemoMode ? update('playbookTemplates', id, patch) : updatePlaybookTemplateRow(id, patch as Record<string, unknown>)), onSuccess: inval });
  const deleteTemplate = useMutation({
    mutationFn: async (id: string) => {
      if (!isDemoMode) return deletePlaybookTemplateRow(id);
      (all('playbookSteps') as PlaybookStep[]).filter((s) => s.templateId === id).forEach((s) => remove('playbookSteps', s.id));
      (all('playbookGroups') as PlaybookGroup[]).filter((g) => g.templateId === id).forEach((g) => remove('playbookGroups', g.id));
      remove('playbookTemplates', id);
    }, onSuccess: inval,
  });
  const createGroup = useMutation({ mutationFn: async (g: { templateId: string; name?: string; position: number }) => (isDemoMode ? insert('playbookGroups', { id: newId('pg'), templateId: g.templateId, name: g.name ?? 'New group', position: g.position, groupCondition: {}, expireBehavior: 'keep' } as PlaybookGroup) : insertPlaybookGroupRow(g)), onSuccess: inval });
  const updateGroup = useMutation({ mutationFn: async ({ id, patch }: { id: string; patch: { name?: string | null; position?: number; expireBehavior?: string; groupCondition?: unknown } }) => (isDemoMode ? update('playbookGroups', id, patch as Partial<PlaybookGroup>) : updatePlaybookGroupRow(id, patch)), onSuccess: inval });
  const deleteGroup = useMutation({ mutationFn: async (id: string) => { if (!isDemoMode) return deletePlaybookGroupRow(id); remove('playbookGroups', id); }, onSuccess: inval });
  const createStep = useMutation({ mutationFn: async (s: { templateId: string; groupId: string | null; position: number; stepType?: PlaybookStep['stepType'] }) => (isDemoMode ? insert('playbookSteps', { id: newId('ps'), templateId: s.templateId, groupId: s.groupId, position: s.position, stepType: s.stepType ?? 'task', title: 'New step', description: null, priority: 'normal', ownerRef: { kind: 'role', value: 'account_owner' }, conversationType: null, checklist: [], attachments: [], customerVisible: false, startAfterDays: 0, durationDays: null, workdaysOnly: true, dependsOnStepId: null, dependencyTrigger: null } as PlaybookStep) : insertPlaybookStepRow(s)), onSuccess: inval });
  const updateStep = useMutation({ mutationFn: async ({ id, patch }: { id: string; patch: Partial<PlaybookStep> }) => (isDemoMode ? update('playbookSteps', id, patch) : updatePlaybookStepRow(id, patch as Record<string, unknown>)), onSuccess: inval });
  const deleteStep = useMutation({ mutationFn: async (id: string) => { if (!isDemoMode) return deletePlaybookStepRow(id); remove('playbookSteps', id); }, onSuccess: inval });
  const reorderSteps = useMutation({ mutationFn: async (updates: { id: string; position: number; groupId: string | null }[]) => { if (!isDemoMode) return reorderPlaybookStepsRows(updates); updates.forEach((u) => update('playbookSteps', u.id, { position: u.position, groupId: u.groupId } as Partial<PlaybookStep>)); }, onSuccess: inval });
  return { createTemplate, updateTemplate, deleteTemplate, createGroup, updateGroup, deleteGroup, createStep, updateStep, deleteStep, reorderSteps };
}

// ── V2 Playbook instances: runs / run-steps + the runner (iteration2.md §7) ──
export function usePlaybookRuns(companyId?: string) {
  return useQuery({
    queryKey: ['playbookRuns', companyId], enabled: !!companyId,
    queryFn: async () => (isDemoMode ? (all('playbookRuns') as PlaybookRun[]).filter((r) => r.companyId === companyId && r.status !== 'archived') : fetchPlaybookRuns(companyId!)),
  });
}
export function usePlaybookRunSteps(runId?: string) {
  return useQuery({
    queryKey: ['playbookRunSteps', runId], enabled: !!runId,
    queryFn: async () => (isDemoMode ? (all('playbookRunSteps') as PlaybookRunStep[]).filter((s) => s.runId === runId).sort((a, b) => a.position - b.position) : fetchPlaybookRunSteps(runId!)),
  });
}
export function usePlaybookRunMutations() {
  const qc = useQueryClient();
  const { profile } = useSession();
  const inval = () => { qc.invalidateQueries({ queryKey: ['playbookRuns'] }); qc.invalidateQueries({ queryKey: ['playbookRunSteps'] }); qc.invalidateQueries({ queryKey: ['tasks'] }); };
  const assigneeFor = (ownerRef: PlaybookStep['ownerRef'], company: Company) => (ownerRef?.value === 'account_owner' ? (company.ownerId ?? profile.id) : profile.id);

  const applyPlaybook = useMutation({
    mutationFn: async ({ template, groups, steps, company }: { template: PlaybookTemplate; groups: PlaybookGroup[]; steps: PlaybookStep[]; company: Company }) => {
      const ctx = companyRuleContext(company);
      const planned = planRun(steps, groups, ctx, new Date());
      if (!isDemoMode) {
        const run = await insertPlaybookRunRow({ templateId: template.id, companyId: company.id, targetModel: template.targetModel, targetRecordId: company.id, startedBy: profile.id, entrySnapshot: ctx });
        for (const p of planned) {
          let taskId: string | null = null;
          if (p.stepType === 'task' && p.activationState === 'active') {
            const t = await insertPlaybookTaskRow({ companyId: company.id, title: p.title, dueDate: p.dueDate, priority: p.priority, assigneeId: assigneeFor(p.ownerRef, company), creatorId: profile.id });
            taskId = t.id;
          }
          await insertPlaybookRunStepRow({ runId: run.id, templateStepId: p.templateStepId, groupId: p.groupId, taskId, stepType: p.stepType, position: p.position, activationState: p.activationState, startDate: p.startDate, dueDate: p.dueDate });
        }
        return run;
      }
      const run = insert('playbookRuns', { id: newId('pr'), templateId: template.id, companyId: company.id, targetModel: template.targetModel, targetRecordId: company.id, startedBy: profile.id, status: 'active', startedAt: new Date().toISOString(), completedAt: null, entrySnapshot: ctx, archivedAt: null, archiveAction: null } as PlaybookRun);
      for (const p of planned) {
        let taskId: string | null = null;
        if (p.stepType === 'task' && p.activationState === 'active') {
          const t = insert('tasks', { id: newId('ts'), companyId: company.id, assigneeId: assigneeFor(p.ownerRef, company), creatorId: profile.id, title: p.title, description: null, taskType: 'todo', dueDate: p.dueDate, completedAt: null, priority: p.priority as Task['priority'], origin: 'playbook', sourceActivityId: null, successPlanObjectiveId: null, contactId: null } as Task);
          taskId = t.id;
        }
        insert('playbookRunSteps', { id: newId('prs'), runId: run.id, templateStepId: p.templateStepId, groupId: p.groupId, taskId, stepType: p.stepType, position: p.position, activationState: p.activationState, skipReason: null, startDate: p.startDate, dueDate: p.dueDate } as PlaybookRunStep);
      }
      return run;
    }, onSuccess: inval,
  });

  const markStep = useMutation({
    mutationFn: async ({ step, state, skipReason }: { step: PlaybookRunStep; state: RunStepState; skipReason?: string }) => {
      const done = state === 'done' || state === 'ignored';
      if (!isDemoMode) {
        await updatePlaybookRunStepRow(step.id, { activationState: state, skipReason: skipReason ?? null });
        if (step.taskId) await setTaskCompletedRow(step.taskId, done);
        return;
      }
      update('playbookRunSteps', step.id, { activationState: state, skipReason: skipReason ?? null });
      if (step.taskId) update('tasks', step.taskId, { completedAt: done ? new Date().toISOString() : null });
    }, onSuccess: inval,
  });

  const reevaluate = useMutation({
    mutationFn: async ({ runSteps, templateSteps, groups, company }: { runSteps: PlaybookRunStep[]; templateSteps: PlaybookStep[]; groups: PlaybookGroup[]; company: Company }) => {
      const ctx = companyRuleContext(company);
      const stepById = new Map(templateSteps.map((s) => [s.id, s]));
      const groupById = new Map(groups.map((g) => [g.id, g]));
      const changes = reevaluateRun(runSteps, stepById, groupById, ctx);
      for (const c of changes) {
        const rs = runSteps.find((r) => r.id === c.id)!;
        let taskId = rs.taskId ?? null;
        if (c.activationState === 'active' && rs.stepType === 'task' && !rs.taskId) {
          const tpl = rs.templateStepId ? stepById.get(rs.templateStepId) : undefined;
          if (!isDemoMode) { const t = await insertPlaybookTaskRow({ companyId: company.id, title: tpl?.title ?? 'Step', dueDate: rs.dueDate ?? null, priority: tpl?.priority ?? 'normal', assigneeId: assigneeFor(tpl?.ownerRef ?? { kind: 'role', value: 'account_owner' }, company), creatorId: profile.id }); taskId = t.id; }
          else { const t = insert('tasks', { id: newId('ts'), companyId: company.id, assigneeId: assigneeFor(tpl?.ownerRef ?? { kind: 'role', value: 'account_owner' }, company), creatorId: profile.id, title: tpl?.title ?? 'Step', description: null, taskType: 'todo', dueDate: rs.dueDate ?? null, completedAt: null, priority: (tpl?.priority ?? 'normal') as Task['priority'], origin: 'playbook', sourceActivityId: null, successPlanObjectiveId: null, contactId: null } as Task); taskId = t.id; }
        }
        if (!isDemoMode) await updatePlaybookRunStepRow(c.id, { activationState: c.activationState, taskId });
        else update('playbookRunSteps', c.id, { activationState: c.activationState, taskId });
      }
      return changes.length;
    }, onSuccess: inval,
  });

  const archiveRun = useMutation({ mutationFn: async (runId: string) => { if (!isDemoMode) return archivePlaybookRunRow(runId); update('playbookRuns', runId, { status: 'archived', archivedAt: new Date().toISOString() }); }, onSuccess: inval });

  return { applyPlaybook, markStep, reevaluate, archiveRun };
}

// ── V2 Automations (iteration2.md Part B) ───────────────────────────────────
export function useAutomations() {
  return useQuery({ queryKey: ['automations'], queryFn: async () => (isDemoMode ? (all('automations') as Automation[]) : fetchAutomations()) });
}
export function useAutomationSteps(automationId?: string) {
  return useQuery({
    queryKey: ['automationSteps', automationId], enabled: !!automationId,
    queryFn: async () => (isDemoMode ? (all('automationSteps') as AutomationStep[]).filter((s) => s.automationId === automationId).sort((a, b) => a.position - b.position) : fetchAutomationSteps(automationId!)),
  });
}
export function useAutomationRuns(automationId?: string) {
  return useQuery({
    queryKey: ['automationRuns', automationId],
    queryFn: async () => (isDemoMode ? (all('automationRuns') as AutomationRun[]).filter((r) => !automationId || r.automationId === automationId) : fetchAutomationRuns(automationId)),
  });
}
export function useAutomationMutations() {
  const qc = useQueryClient();
  const { profile } = useSession();
  const inval = () => { qc.invalidateQueries({ queryKey: ['automations'] }); qc.invalidateQueries({ queryKey: ['automationSteps'] }); };

  const createBlank = useMutation({
    mutationFn: async (name: string) => {
      if (!isDemoMode) return insertAutomationRow({ name, kind: 'templated', triggerModel: 'company', triggerFilter: { match: 'all', rules: [] } });
      return insert('automations', { id: newId('au'), name, description: null, kind: 'templated', triggerType: 'record_created_or_updated', triggerModel: 'company', triggerFilter: { match: 'all', rules: [] }, triggerConfig: {}, enabled: false, createdBy: profile.id } as Automation);
    }, onSuccess: inval,
  });
  const createFromStarter = useMutation({
    mutationFn: async (s: AutomationStarter) => {
      let auto: Automation;
      if (!isDemoMode) auto = await insertAutomationRow({ name: s.name, description: s.description, kind: 'templated', triggerType: s.triggerType, triggerModel: s.triggerModel, triggerFilter: s.triggerFilter });
      else auto = insert('automations', { id: newId('au'), name: s.name, description: s.description, kind: 'templated', triggerType: s.triggerType, triggerModel: s.triggerModel, triggerFilter: s.triggerFilter, triggerConfig: {}, enabled: false, createdBy: profile.id } as Automation);
      await Promise.all(s.actions.map((a, i) => {
        if (!isDemoMode) return insertAutomationStepRow({ automationId: auto.id, kind: a.kind, position: i, config: a.config });
        insert('automationSteps', { id: newId('as'), automationId: auto.id, position: i, parentStepId: null, branch: null, kind: a.kind, config: a.config } as AutomationStep);
        return Promise.resolve();
      }));
      return auto;
    }, onSuccess: inval,
  });
  const updateAutomation = useMutation({ mutationFn: async ({ id, patch }: { id: string; patch: Partial<Automation> }) => (isDemoMode ? update('automations', id, patch) : updateAutomationRow(id, patch as Record<string, unknown>)), onSuccess: inval });
  const deleteAutomation = useMutation({
    mutationFn: async (id: string) => {
      if (!isDemoMode) return deleteAutomationRow(id);
      (all('automationSteps') as AutomationStep[]).filter((s) => s.automationId === id).forEach((s) => remove('automationSteps', s.id));
      remove('automations', id);
    }, onSuccess: inval,
  });
  const addStep = useMutation({ mutationFn: async (s: { automationId: string; kind: AutomationStep['kind']; position: number; config?: Record<string, unknown> }) => (isDemoMode ? insert('automationSteps', { id: newId('as'), automationId: s.automationId, position: s.position, parentStepId: null, branch: null, kind: s.kind, config: s.config ?? {} } as AutomationStep) : insertAutomationStepRow(s)), onSuccess: inval });
  const updateStep = useMutation({ mutationFn: async ({ id, patch }: { id: string; patch: { kind?: string; config?: unknown; position?: number } }) => (isDemoMode ? update('automationSteps', id, patch as Partial<AutomationStep>) : updateAutomationStepRow(id, patch)), onSuccess: inval });
  const deleteStep = useMutation({ mutationFn: async (id: string) => { if (!isDemoMode) return deleteAutomationStepRow(id); remove('automationSteps', id); }, onSuccess: inval });

  return { createBlank, createFromStarter, updateAutomation, deleteAutomation, addStep, updateStep, deleteStep };
}

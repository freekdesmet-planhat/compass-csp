import { useState } from 'react';
import { useParams, useSearchParams, useNavigate, Link } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import {
  Button, Chip, HealthChip, SegmentBadge, Tabs, TabsList, TabsTrigger, TabsContent,
  Card, CardHeader, CardTitle, CardBody, Avatar, EmptyState, Select, SelectTrigger, SelectValue,
  SelectContent, SelectItem, Input, Textarea, Dialog, DialogContent, DialogTitle,
} from '@/components/ui';
import { cn } from '@/lib/utils';
import {
  useCompany, useContacts, useActivities, useDeals, useTasks, useNps, useEmails,
  useCalendarEvents, useSuccessPlans, useObjectives, useToggleTask, useCreateSuccessPlan,
  useUpdateSuccessPlan, useUpdateObjective,
} from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { useToast } from '@/components/toast';
import { fmtCurrency, fmtDate, relativeTime, daysUntil } from '@/lib/utils';
import { StickyNote, CheckSquare, Mail, CalendarPlus, ArrowLeft, Plus, Check } from 'lucide-react';
import { HealthTab } from './account/HealthTab';
import { OverviewTab } from './account/OverviewTab';
import { TimelineTab } from './account/TimelineTab';
import { ContactsTab } from './account/ContactsTab';
import { DealsTab } from './account/DealsTab';
import { UsageTab } from './account/UsageTab';
import { PlaybooksTab } from './account/PlaybooksTab';
import { Composer } from './account/Composer';
import { TaskModal, LogInteractionModal, TASK_TYPE_META } from '@/components/modals';
import { WebsiteLink } from '@/components/WebsiteLink';
import type { Contact, ObjectiveStatus } from '@/lib/types';

const TABS = ['overview', 'health', 'usage', 'timeline', 'success-plan', 'playbooks', 'deals', 'contacts', 'emails', 'meetings', 'tasks', 'notes', 'nps'] as const;

export default function AccountPage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { allProfiles } = useSession();
  const { data: company, isLoading } = useCompany(id);
  const [taskModal, setTaskModal] = useState(false);
  const [logModal, setLogModal] = useState(false);
  const tab = params.get('tab') ?? 'overview';

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!company) return <div className="p-6"><EmptyState title="Account not found" hint="It may be outside your visibility." action={<Button onClick={() => navigate('/portfolio')}>Back to Portfolio</Button>} /></div>;

  const owner = allProfiles.find((p) => p.id === company.ownerId);
  const rdays = daysUntil(company.renewalDate);

  return (
    <div>
      <PageHeader
        title={company.name}
        actions={<Button variant="ghost" size="sm" onClick={() => navigate('/portfolio')}><ArrowLeft className="h-3.5 w-3.5" /> Portfolio</Button>}
      >
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-base">
          <HealthChip score={company.healthScore} band={company.healthBand} delta={company.healthDeltaWow} />
          <Meta label="ARR" value={fmtCurrency(company.arr)} />
          <Meta label="Renewal" value={rdays != null ? `${fmtDate(company.renewalDate)} · T-${rdays}` : '—'} />
          <Meta label="Phase" value={company.phase?.replace(/_/g, ' ') ?? '—'} />
          <div className="flex items-center gap-1.5"><Avatar name={owner?.fullName} className="h-5 w-5 text-[10px]" /><span className="text-muted-foreground">{owner?.fullName}</span></div>
          <SegmentBadge segment={company.segment} />
          {company.website && <WebsiteLink url={company.website} />}
          {company.status === 'churned' && <Chip tone="red">churned</Chip>}
          <div className="ml-auto flex items-center gap-1.5">
            <QuickAction icon={StickyNote} label="Note" onClick={() => setParams({ tab: 'overview', compose: 'note' })} />
            <QuickAction icon={CheckSquare} label="Task" onClick={() => setTaskModal(true)} />
            <QuickAction icon={Mail} label="Email" onClick={() => setParams({ tab: 'overview', compose: 'email' })} />
            <QuickAction icon={CalendarPlus} label="Meeting" onClick={() => setLogModal(true)} />
          </div>
        </div>
      </PageHeader>

      <Tabs value={tab} onValueChange={(v) => setParams({ tab: v })}>
        <div className="border-b px-6"><TabsList className="border-0">
          {TABS.map((t) => <TabsTrigger key={t} value={t} className="capitalize">{t.replace('-', ' ')}</TabsTrigger>)}
        </TabsList></div>

        <div className="px-6 py-4">
          <TabsContent value="overview"><OverviewTab company={company} /></TabsContent>
          <TabsContent value="health"><HealthTab company={company} /></TabsContent>
          <TabsContent value="usage"><UsageTab company={company} /></TabsContent>
          <TabsContent value="timeline"><TimelineTab companyId={company.id} /></TabsContent>
          <TabsContent value="success-plan"><SuccessPlanTab companyId={company.id} /></TabsContent>
          <TabsContent value="playbooks"><PlaybooksTab company={company} /></TabsContent>
          <TabsContent value="deals"><DealsTab company={company} /></TabsContent>
          <TabsContent value="contacts"><ContactsTab companyId={company.id} /></TabsContent>
          <TabsContent value="emails"><EmailsTab companyId={company.id} /></TabsContent>
          <TabsContent value="meetings"><MeetingsTab companyId={company.id} /></TabsContent>
          <TabsContent value="tasks"><TasksTab companyId={company.id} /></TabsContent>
          <TabsContent value="notes"><NotesTab companyId={company.id} /></TabsContent>
          <TabsContent value="nps"><NpsTab companyId={company.id} /></TabsContent>
        </div>
      </Tabs>

      <TaskModal open={taskModal} onOpenChange={setTaskModal} companyId={company.id} />
      <LogInteractionModal open={logModal} onOpenChange={setLogModal} companyId={company.id} defaultType="in_person" />
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center gap-1"><span className="text-muted-foreground">{label}</span><span className="font-medium capitalize">{value}</span></div>;
}
function QuickAction({ icon: Icon, label, onClick }: { icon: React.ComponentType<{ className?: string }>; label: string; onClick: () => void }) {
  return <Button size="sm" variant="outline" onClick={onClick}><Icon className="h-3.5 w-3.5" /> {label}</Button>;
}

// ── Success plan tab (A5): create + editable plan/objective statuses ─────────
const OBJ_STATUSES: ObjectiveStatus[] = ['not_started', 'on_track', 'at_risk', 'achieved', 'missed'];
const objTone = (s: string): 'green' | 'accent' | 'amber' | 'red' | 'neutral' => (s === 'achieved' ? 'green' : s === 'on_track' ? 'accent' : s === 'at_risk' ? 'amber' : s === 'missed' ? 'red' : 'neutral');

function SuccessPlanTab({ companyId }: { companyId: string }) {
  const { data: plans = [] } = useSuccessPlans(companyId);
  const { data: objectives = [] } = useObjectives(companyId);
  const updatePlan = useUpdateSuccessPlan();
  const updateObjective = useUpdateObjective();
  const [createOpen, setCreateOpen] = useState(false);

  if (!plans.length) return (
    <>
      <EmptyState icon={CheckSquare} title="No success plan yet" hint="Create a plan to track objectives and business outcomes." action={<Button variant="primary" onClick={() => setCreateOpen(true)}><Plus className="h-3.5 w-3.5" /> New success plan</Button>} />
      <NewSuccessPlanModal open={createOpen} onOpenChange={setCreateOpen} companyId={companyId} />
    </>
  );
  const plan = plans[0];
  return (
    <Card>
      <CardHeader>
        <CardTitle>{plan.name}</CardTitle>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">{plan.progressPct}% · target {fmtDate(plan.targetDate)}</span>
          <Select value={plan.status} onValueChange={(v) => updatePlan.mutate({ id: plan.id, patch: { status: v } })}>
            <SelectTrigger className="h-7"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="active">active</SelectItem><SelectItem value="paused">paused</SelectItem><SelectItem value="completed">completed</SelectItem></SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}><Plus className="h-3.5 w-3.5" /> New plan</Button>
        </div>
      </CardHeader>
      <CardBody className="space-y-2">
        {objectives.map((o) => (
          <div key={o.id} className="flex items-center gap-3 rounded-md border px-3 py-2">
            <Chip tone={objTone(o.status)}>{o.status.replace(/_/g, ' ')}</Chip>
            <div className="flex-1"><div className="font-medium">{o.title}</div><div className="text-sm text-muted-foreground">{o.businessOutcome} · {o.metric}</div></div>
            <Select value={o.status} onValueChange={(v) => updateObjective.mutate({ id: o.id, patch: { status: v as ObjectiveStatus } })}>
              <SelectTrigger className="h-7 w-36"><SelectValue /></SelectTrigger>
              <SelectContent>{OBJ_STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replace(/_/g, ' ')}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        ))}
      </CardBody>
      <NewSuccessPlanModal open={createOpen} onOpenChange={setCreateOpen} companyId={companyId} />
    </Card>
  );
}

function NewSuccessPlanModal({ open, onOpenChange, companyId }: { open: boolean; onOpenChange: (o: boolean) => void; companyId: string }) {
  const { profile, allProfiles } = useSession();
  const create = useCreateSuccessPlan();
  const { toast } = useToast();
  const [name, setName] = useState('Success Plan FY26');
  const [owner, setOwner] = useState(profile.id);
  const [targetDate, setTargetDate] = useState('');
  const [objectives, setObjectives] = useState('');
  const submit = async () => {
    await create.mutateAsync({ companyId, name, ownerId: owner, targetDate: targetDate || null, objectives: objectives.split('\n') });
    toast('Success plan created');
    onOpenChange(false);
    setObjectives('');
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogTitle className="text-md font-semibold">New success plan</DialogTitle>
        <div className="mt-3 space-y-3">
          <div><div className="mb-1 text-xs font-medium text-muted-foreground">Name</div><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><div className="mb-1 text-xs font-medium text-muted-foreground">Owner</div>
              <Select value={owner} onValueChange={setOwner}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{allProfiles.filter((p) => p.isActive).map((p) => <SelectItem key={p.id} value={p.id}>{p.fullName}</SelectItem>)}</SelectContent></Select>
            </div>
            <div><div className="mb-1 text-xs font-medium text-muted-foreground">Target date</div><Input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} /></div>
          </div>
          <div><div className="mb-1 text-xs font-medium text-muted-foreground">First objectives (one per line, optional)</div><Textarea rows={3} value={objectives} onChange={(e) => setObjectives(e.target.value)} placeholder={'Achieve 80% seat activation\nLaunch executive dashboard'} /></div>
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" disabled={!name.trim()} onClick={submit}>Create plan</Button></div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EmailsTab({ companyId }: { companyId: string }) {
  const { data: emails = [] } = useEmails(companyId);
  const { data: contacts = [] } = useContacts(companyId);
  const { allProfiles } = useSession();
  const [open, setOpen] = useState<string | null>(null);
  if (!emails.length) return <EmptyState icon={Mail} title="No emails" hint="Connect Gmail in Settings to see emails here." />;

  const orgDomains = new Set(allProfiles.map((p) => p.email.split('@')[1]).filter(Boolean));
  const byEmail = new Map<string, Contact>();
  contacts.forEach((c) => { [c.email, ...(c.otherEmails ?? [])].filter(Boolean).forEach((e) => byEmail.set((e as string).toLowerCase(), c)); });

  return (
    <div className="space-y-1">
      {emails.map((e) => (
        <div key={e.id} className="rounded-md border">
          <button className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-panel" onClick={() => setOpen(open === e.id ? null : e.id)}>
            <Chip tone={e.direction === 'inbound' ? 'accent' : 'neutral'}>{e.direction}</Chip>
            <span className="flex-1 truncate font-medium">{e.subject}</span>
            <span className="text-sm text-muted-foreground">{relativeTime(e.sentAt)}</span>
          </button>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t px-3 py-1.5 text-xs">
            <ParticipantLine label="From" addrs={e.fromEmail ? [e.fromEmail] : []} byEmail={byEmail} orgDomains={orgDomains} />
            <ParticipantLine label="To" addrs={e.toEmails ?? []} byEmail={byEmail} orgDomains={orgDomains} />
            {!!(e.ccEmails ?? []).length && <ParticipantLine label="Cc" addrs={e.ccEmails} byEmail={byEmail} orgDomains={orgDomains} />}
          </div>
          {open === e.id && <div className="border-t px-3 py-2 text-base" dangerouslySetInnerHTML={{ __html: e.bodyHtml ?? `<p>${e.snippet}</p>` }} />}
        </div>
      ))}
    </div>
  );
}

function ParticipantLine({ label, addrs, byEmail, orgDomains }: { label: string; addrs: string[]; byEmail: Map<string, Contact>; orgDomains: Set<string> }) {
  const { toast } = useToast();
  if (!addrs.length) return null;
  return (
    <span className="flex items-center gap-1">
      <span className="text-muted-foreground">{label}:</span>
      {addrs.map((addr, i) => {
        const contact = byEmail.get(addr.toLowerCase());
        const internal = orgDomains.has(addr.split('@')[1]);
        if (contact) return <Link key={i} to={`/contacts/${contact.id}`}><Chip tone="accent">{contact.firstName} {contact.lastName}</Chip></Link>;
        if (internal) return <Chip key={i} tone="neutral">{addr}</Chip>;
        return (
          <span key={i} className="group inline-flex items-center gap-1">
            <span>{addr}</span>
            <button className="opacity-0 transition-opacity group-hover:opacity-100 text-[var(--accent)]" onClick={() => toast(`Would add ${addr} as a contact`, { tone: 'info' })}>+ add</button>
          </span>
        );
      })}
    </span>
  );
}

function MeetingsTab({ companyId }: { companyId: string }) {
  const { data: events = [] } = useCalendarEvents(companyId);
  const { data: activities = [] } = useActivities(companyId);
  const meetings = activities.filter((a) => a.type === 'meeting');
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>Upcoming</CardTitle></CardHeader>
        <CardBody className="space-y-1">
          {events.length ? events.map((e) => (
            <div key={e.id} className="rounded-md border px-3 py-2"><div className="font-medium">{e.title}</div><div className="text-sm text-muted-foreground">{fmtDate(e.startsAt)} · {e.attendeeEmails.length} attendees</div></div>
          )) : <EmptyState icon={CalendarPlus} title="No upcoming meetings" hint="Connect Google Calendar in Settings." />}
        </CardBody>
      </Card>
      <Card>
        <CardHeader><CardTitle>Past (with AI recaps)</CardTitle></CardHeader>
        <CardBody className="space-y-1">
          {meetings.length ? meetings.map((m) => (
            <div key={m.id} className="rounded-md border px-3 py-2">
              <div className="flex items-center justify-between"><span className="font-medium">{m.title}</span><span className="text-sm text-muted-foreground">{relativeTime(m.occurredAt)}</span></div>
              <div className="text-sm text-muted-foreground">{m.snippet}</div>
              {!!m.meta.actionItems?.length && <div className="mt-1 flex flex-wrap gap-1">{m.meta.actionItems.map((a, i) => <Chip key={i} tone="accent">{a}</Chip>)}</div>}
              {!!m.meta.risks?.length && <div className="mt-1 flex flex-wrap gap-1">{m.meta.risks.map((a, i) => <Chip key={i} tone="red">⚠ {a}</Chip>)}</div>}
            </div>
          )) : <EmptyState icon={CalendarPlus} title="No logged meetings" />}
        </CardBody>
      </Card>
    </div>
  );
}

function TasksTab({ companyId }: { companyId: string }) {
  const { data: tasks = [] } = useTasks(companyId);
  const toggle = useToggleTask();
  const [taskModal, setTaskModal] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);
  const open = tasks.filter((t) => !t.completedAt);
  const done = tasks.filter((t) => t.completedAt);

  const Row = ({ t }: { t: (typeof tasks)[number] }) => {
    const meta = TASK_TYPE_META[t.taskType] ?? TASK_TYPE_META.todo;
    const Icon = meta.icon;
    return (
      <div className="flex items-center gap-3 border-b px-3 py-2 last:border-0 hover:bg-panel/60">
        <button onClick={() => toggle.mutate(t)} className="shrink-0" aria-label={t.completedAt ? 'Mark incomplete' : 'Mark complete'}>
          <span className={cn('flex h-4 w-4 items-center justify-center rounded border', t.completedAt ? 'border-[var(--green)] bg-[var(--green)] text-white' : 'border-[#d0d5dd]')}>
            {t.completedAt && <Check className="h-3 w-3" />}
          </span>
        </button>
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className={cn('flex-1', t.completedAt ? 'text-muted-foreground line-through' : 'font-medium')}>{t.title}</span>
        <Chip>{t.origin.replace(/_/g, ' ')}</Chip>
        <Chip tone={t.priority === 'high' ? 'red' : 'neutral'}>{t.priority}</Chip>
        <span className="w-24 text-right text-sm text-muted-foreground">{fmtDate(t.dueDate)}</span>
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end"><Button size="sm" variant="primary" onClick={() => setTaskModal(true)}><Plus className="h-3.5 w-3.5" /> New task</Button></div>
      {open.length === 0 && done.length === 0 ? <EmptyState icon={CheckSquare} title="No tasks" action={<Button variant="primary" onClick={() => setTaskModal(true)}>New task</Button>} /> : (
        <div className="rounded-lg border bg-white">
          {open.map((t) => <Row key={t.id} t={t} />)}
          {open.length === 0 && <div className="px-3 py-3 text-sm text-muted-foreground">No open tasks 🎉</div>}
        </div>
      )}
      {done.length > 0 && (
        <div>
          <button onClick={() => setShowCompleted((s) => !s)} className="mb-1 text-sm text-muted-foreground hover:text-foreground">
            {showCompleted ? '▾' : '▸'} Completed ({done.length})
          </button>
          {showCompleted && <div className="rounded-lg border bg-white">{done.map((t) => <Row key={t.id} t={t} />)}</div>}
        </div>
      )}
      <TaskModal open={taskModal} onOpenChange={setTaskModal} companyId={companyId} />
    </div>
  );
}

function NotesTab({ companyId }: { companyId: string }) {
  const { data: activities = [] } = useActivities(companyId);
  const notes = activities.filter((a) => a.type === 'note');
  if (!notes.length) return <EmptyState icon={StickyNote} title="No notes" hint="Log a note from the composer." />;
  return <div className="space-y-2">{notes.map((n) => <Card key={n.id}><CardBody><div className="mb-0.5 flex items-center justify-between"><span className="font-medium">{n.title}</span><span className="text-sm text-muted-foreground">{relativeTime(n.occurredAt)}</span></div><p className="text-base">{n.snippet}</p></CardBody></Card>)}</div>;
}

function NpsTab({ companyId }: { companyId: string }) {
  const { data: nps = [] } = useNps(companyId);
  if (!nps.length) return <EmptyState icon={StickyNote} title="No NPS responses" />;
  return (
    <div className="space-y-2">
      {nps.map((n) => (
        <Card key={n.id}><CardBody className="flex items-start gap-3">
          <Chip tone={n.score >= 9 ? 'green' : n.score >= 7 ? 'amber' : 'red'}>{n.score}</Chip>
          <div className="flex-1"><p>{n.comment}</p><div className="text-sm text-muted-foreground">{fmtDate(n.respondedAt)}</div></div>
        </CardBody></Card>
      ))}
    </div>
  );
}

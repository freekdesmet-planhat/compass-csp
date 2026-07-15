import { useState } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import {
  Button, Chip, HealthChip, HealthDot, SegmentBadge, Tabs, TabsList, TabsTrigger, TabsContent,
  Card, CardHeader, CardTitle, CardBody, Avatar, EmptyState,
} from '@/components/ui';
import {
  useCompany, useContacts, useActivities, useDeals, useTasks, useNps, useEmails,
  useCalendarEvents, useSuccessPlans, useObjectives,
} from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { fmtCurrency, fmtDate, relativeTime, daysUntil } from '@/lib/utils';
import { StickyNote, CheckSquare, Mail, CalendarPlus, ArrowLeft } from 'lucide-react';
import { HealthTab } from './account/HealthTab';
import { OverviewTab } from './account/OverviewTab';
import { TimelineTab } from './account/TimelineTab';
import { ContactsTab } from './account/ContactsTab';
import { DealsTab } from './account/DealsTab';
import { Composer } from './account/Composer';
import { DataTable } from '@/components/DataTable';

const TABS = ['overview', 'health', 'timeline', 'success-plan', 'deals', 'contacts', 'emails', 'meetings', 'tasks', 'notes', 'nps'] as const;

export default function AccountPage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { profile, allProfiles } = useSession();
  const { data: company, isLoading } = useCompany(id);
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
          {company.status === 'churned' && <Chip tone="red">churned</Chip>}
          <div className="ml-auto flex items-center gap-1.5">
            <QuickAction icon={StickyNote} label="Note" onClick={() => setParams({ tab: 'overview', compose: 'note' })} />
            <QuickAction icon={CheckSquare} label="Task" onClick={() => setParams({ tab: 'overview', compose: 'task' })} />
            <QuickAction icon={Mail} label="Email" onClick={() => setParams({ tab: 'overview', compose: 'email' })} />
            <QuickAction icon={CalendarPlus} label="Meeting" onClick={() => setParams({ tab: 'meetings' })} />
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
          <TabsContent value="timeline"><TimelineTab companyId={company.id} /></TabsContent>
          <TabsContent value="success-plan"><SuccessPlanTab companyId={company.id} /></TabsContent>
          <TabsContent value="deals"><DealsTab company={company} /></TabsContent>
          <TabsContent value="contacts"><ContactsTab companyId={company.id} /></TabsContent>
          <TabsContent value="emails"><EmailsTab companyId={company.id} /></TabsContent>
          <TabsContent value="meetings"><MeetingsTab companyId={company.id} /></TabsContent>
          <TabsContent value="tasks"><TasksTab companyId={company.id} /></TabsContent>
          <TabsContent value="notes"><NotesTab companyId={company.id} /></TabsContent>
          <TabsContent value="nps"><NpsTab companyId={company.id} /></TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center gap-1"><span className="text-muted-foreground">{label}</span><span className="font-medium capitalize">{value}</span></div>;
}
function QuickAction({ icon: Icon, label, onClick }: { icon: React.ComponentType<{ className?: string }>; label: string; onClick: () => void }) {
  return <Button size="sm" variant="outline" onClick={onClick}><Icon className="h-3.5 w-3.5" /> {label}</Button>;
}

// ── Lightweight tabs kept inline ─────────────────────────────────────────────
function SuccessPlanTab({ companyId }: { companyId: string }) {
  const { data: plans = [] } = useSuccessPlans(companyId);
  const { data: objectives = [] } = useObjectives(companyId);
  if (!plans.length) return <EmptyState icon={CheckSquare} title="No success plan yet" hint="Create a plan to track objectives and business outcomes." />;
  const plan = plans[0];
  const toneFor = (s: string): 'green' | 'accent' | 'amber' | 'red' | 'neutral' => (s === 'achieved' ? 'green' : s === 'on_track' ? 'accent' : s === 'at_risk' ? 'amber' : s === 'missed' ? 'red' : 'neutral');
  return (
    <Card>
      <CardHeader><CardTitle>{plan.name}</CardTitle><span className="text-sm text-muted-foreground">{plan.progressPct}% complete · target {fmtDate(plan.targetDate)}</span></CardHeader>
      <CardBody className="space-y-2">
        {objectives.map((o) => (
          <div key={o.id} className="flex items-center gap-3 rounded-md border px-3 py-2">
            <Chip tone={toneFor(o.status)}>{o.status.replace(/_/g, ' ')}</Chip>
            <div className="flex-1"><div className="font-medium">{o.title}</div><div className="text-sm text-muted-foreground">{o.businessOutcome} · {o.metric}</div></div>
            <span className="text-sm text-muted-foreground">{fmtDate(o.targetDate)}</span>
          </div>
        ))}
      </CardBody>
    </Card>
  );
}

function EmailsTab({ companyId }: { companyId: string }) {
  const { data: emails = [] } = useEmails(companyId);
  const [open, setOpen] = useState<string | null>(null);
  if (!emails.length) return <EmptyState icon={Mail} title="No emails" hint="Connect Gmail in Settings to see emails here." />;
  return (
    <div className="space-y-1">
      {emails.map((e) => (
        <div key={e.id} className="rounded-md border">
          <button className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-panel" onClick={() => setOpen(open === e.id ? null : e.id)}>
            <Chip tone={e.direction === 'inbound' ? 'accent' : 'neutral'}>{e.direction}</Chip>
            <span className="flex-1 truncate font-medium">{e.subject}</span>
            <span className="text-sm text-muted-foreground">{relativeTime(e.sentAt)}</span>
          </button>
          {open === e.id && <div className="border-t px-3 py-2 text-base" dangerouslySetInnerHTML={{ __html: e.bodyHtml ?? `<p>${e.snippet}</p>` }} />}
        </div>
      ))}
    </div>
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
  return (
    <DataTable
      rows={tasks}
      rowKey={(t) => t.id}
      empty={<EmptyState icon={CheckSquare} title="No tasks" />}
      columns={[
        { key: 'done', header: '', width: '4%', render: (t) => <HealthDot band={t.completedAt ? 'green' : null} /> },
        { key: 'title', header: 'Task', render: (t) => <span className={t.completedAt ? 'text-muted-foreground line-through' : 'font-medium'}>{t.title}</span> },
        { key: 'origin', header: 'Origin', width: '16%', render: (t) => <Chip>{t.origin.replace(/_/g, ' ')}</Chip> },
        { key: 'priority', header: 'Priority', width: '12%', render: (t) => <Chip tone={t.priority === 'high' ? 'red' : 'neutral'}>{t.priority}</Chip> },
        { key: 'due', header: 'Due', width: '16%', align: 'right', sortValue: (t) => t.dueDate, render: (t) => fmtDate(t.dueDate) },
      ]}
    />
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

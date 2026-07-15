import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader, PageBody } from '@/components/PageHeader';
import { Card, CardHeader, CardTitle, CardBody, Button, Chip, HealthDot, Sheet, EmptyState } from '@/components/ui';
import { useSession } from '@/lib/session';
import { useDigest, useMeetingPreps, useCompany } from '@/lib/hooks';
import { fmtCurrency, fmtDate, relativeTime } from '@/lib/utils';
import {
  Calendar, CheckSquare, Bell, TrendingUp, TrendingDown, RefreshCw, FileText,
  Sparkles, CalendarClock, BarChart3,
} from 'lucide-react';
import type { MeetingPrep } from '@/lib/types';

export default function HomePage() {
  const { profile } = useSession();
  const navigate = useNavigate();
  const { data: digest } = useDigest(profile.id, 'daily');
  const { data: preps = [] } = useMeetingPreps();
  const [prepEventId, setPrepEventId] = useState<string | null>(null);

  const today = new Date('2026-07-14T09:00:00Z');
  const isMonday = today.getUTCDay() === 1;

  const c = digest?.content;

  return (
    <div>
      <PageHeader
        title="Good morning"
        subtitle={today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
        actions={
          <div className="flex items-center gap-2">
            {(profile.role === 'manager' || profile.role === 'admin') && (
              <Button variant="outline" size="sm" onClick={() => navigate('/reports')}><BarChart3 className="h-3.5 w-3.5" /> Weekly Exec Summary</Button>
            )}
            <Button variant="outline" size="sm"><RefreshCw className="h-3.5 w-3.5" /> Regenerate</Button>
          </div>
        }
      />
      <PageBody>
        {/* AI narrative */}
        <Card className="mb-4 border-[var(--accent)]/30 bg-[var(--accent-tint)]/40">
          <CardBody className="flex gap-3">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent)]" />
            <div>
              <div className="mb-1 text-sm font-semibold text-[var(--accent)]">Top 3 priorities today</div>
              <p className="text-base leading-relaxed">{digest?.narrative ?? 'No digest generated yet. Your morning review will appear here at your digest hour.'}</p>
            </div>
          </CardBody>
        </Card>

        {isMonday && c?.weekRecap && <WeekRecap recap={c.weekRecap} />}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Today's meetings */}
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Calendar className="h-4 w-4 text-muted-foreground" /> Today's meetings</CardTitle></CardHeader>
            <CardBody className="space-y-1 p-2">
              {c?.meetings?.length ? c.meetings.map((m) => (
                <div key={m.calendarEventId ?? m.company} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-panel">
                  <span className="w-14 shrink-0 text-sm text-muted-foreground tnum">{new Date(m.time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
                  <HealthDot band={m.health == null ? null : m.health < 40 ? 'red' : m.health < 70 ? 'amber' : 'green'} />
                  <button className="flex-1 truncate text-left font-medium hover:text-[var(--accent)]" onClick={() => navigate(`/company/${m.companyId}`)}>{m.company}</button>
                  {m.calendarEventId && <Button size="sm" variant="outline" onClick={() => setPrepEventId(m.calendarEventId!)}><FileText className="h-3.5 w-3.5" /> Prep</Button>}
                </div>
              )) : <EmptyRow text="No meetings scheduled today." />}
            </CardBody>
          </Card>

          {/* Tasks due */}
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><CheckSquare className="h-4 w-4 text-muted-foreground" /> Tasks due</CardTitle></CardHeader>
            <CardBody className="space-y-1 p-2">
              {c?.tasksDue?.length ? c.tasksDue.map((t) => (
                <div key={t.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-panel">
                  <span className="flex-1 truncate">{t.title}</span>
                  <button className="truncate text-sm text-muted-foreground hover:text-[var(--accent)]" onClick={() => navigate(`/company/${t.companyId}`)}>{t.company}</button>
                  {t.overdue ? <Chip tone="red">overdue</Chip> : <span className="text-sm text-muted-foreground">{fmtDate(t.dueDate)}</span>}
                </div>
              )) : <EmptyRow text="No tasks due. Nice." />}
            </CardBody>
          </Card>

          {/* New alerts */}
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Bell className="h-4 w-4 text-muted-foreground" /> New alerts</CardTitle></CardHeader>
            <CardBody className="space-y-1 p-2">
              {c?.alerts?.length ? c.alerts.map((a) => (
                <button key={a.id} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-panel" onClick={() => navigate('/alerts')}>
                  <Chip tone={a.severity === 'critical' ? 'red' : a.severity === 'warning' ? 'amber' : 'neutral'}>{a.severity}</Chip>
                  <span className="flex-1 truncate">{a.title}</span>
                </button>
              )) : <EmptyRow text="No new alerts since yesterday." />}
            </CardBody>
          </Card>

          {/* Health movers */}
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><TrendingUp className="h-4 w-4 text-muted-foreground" /> Health movers</CardTitle></CardHeader>
            <CardBody className="space-y-1 p-2">
              {c?.healthMovers?.length ? c.healthMovers.map((h) => (
                <button key={h.companyId} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-panel" onClick={() => navigate(`/company/${h.companyId}`)}>
                  <span className="flex-1 truncate font-medium">{h.company}</span>
                  <span className="text-sm text-muted-foreground tnum">{h.score}</span>
                  <span className={`inline-flex items-center gap-0.5 text-sm font-medium tnum ${h.delta >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>
                    {h.delta >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />} {Math.abs(h.delta).toFixed(0)}
                  </span>
                </button>
              )) : <EmptyRow text="No overnight movers ≥5 pts." />}
            </CardBody>
          </Card>

          {/* Renewal checkpoints */}
          <Card className="lg:col-span-2">
            <CardHeader><CardTitle className="flex items-center gap-2"><CalendarClock className="h-4 w-4 text-muted-foreground" /> Renewal checkpoints</CardTitle></CardHeader>
            <CardBody className="space-y-1 p-2">
              {c?.renewalCheckpoints?.length ? c.renewalCheckpoints.map((r) => (
                <button key={r.companyId} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-panel" onClick={() => navigate(`/company/${r.companyId}`)}>
                  <span className="flex-1 truncate font-medium">{r.company}</span>
                  <span className="text-sm text-muted-foreground">{fmtCurrency(r.arr)}</span>
                  <Chip tone={r.daysOut <= 30 ? 'red' : r.daysOut <= 90 ? 'amber' : 'accent'}>T-{r.daysOut}</Chip>
                </button>
              )) : <EmptyRow text="No renewal checkpoints today." />}
            </CardBody>
          </Card>
        </div>
      </PageBody>

      <MeetingPrepSheet eventId={prepEventId} preps={preps} onClose={() => setPrepEventId(null)} />
    </div>
  );
}

function EmptyRow({ text }: { text: string }) {
  return <div className="px-2 py-6 text-center text-sm text-muted-foreground">{text}</div>;
}

function WeekRecap({ recap }: { recap: NonNullable<import('@/lib/types').DigestContent['weekRecap']> }) {
  const items = [
    ['Health movers', recap.healthMovers],
    ['Meetings held', recap.meetingsHeld],
    ['Emails exchanged', recap.emailsExchanged],
    ['NPS received', recap.npsReceived],
    ['Renewal stage changes', recap.renewalStageChanges],
    ['Tasks done / created', `${recap.tasksCompleted} / ${recap.tasksCreated}`],
  ] as const;
  return (
    <Card className="mb-4">
      <CardHeader><CardTitle>Last week in your book</CardTitle></CardHeader>
      <CardBody className="grid grid-cols-3 gap-3 md:grid-cols-6">
        {items.map(([label, val]) => (
          <div key={label}>
            <div className="text-2xl font-semibold tnum">{val}</div>
            <div className="text-xs text-muted-foreground">{label}</div>
          </div>
        ))}
      </CardBody>
    </Card>
  );
}

export function MeetingPrepSheet({ eventId, preps, onClose }: { eventId: string | null; preps: MeetingPrep[]; onClose: () => void }) {
  const prep = preps.find((p) => p.calendarEventId === eventId);
  const { data: company } = useCompany(prep?.companyId);
  return (
    <Sheet open={!!eventId} onOpenChange={(o) => !o && onClose()}>
      {prep ? (
        <div className="flex h-full flex-col">
          <div className="border-b px-4 py-3">
            <div className="flex items-center gap-2 text-sm text-[var(--accent)]"><Sparkles className="h-3.5 w-3.5" /> Meeting prep</div>
            <div className="text-md font-semibold">{company?.name}</div>
            {prep.stale && <Chip tone="amber" className="mt-1">stale — new activity landed</Chip>}
          </div>
          <div className="flex-1 space-y-4 overflow-y-auto px-4 py-3 text-base">
            <p className="rounded-md bg-panel px-3 py-2 leading-relaxed">{prep.narrative}</p>
            <Section title="Account snapshot">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <Kv k="ARR" v={fmtCurrency(prep.content.accountSnapshot.arr)} />
                <Kv k="Phase" v={prep.content.accountSnapshot.phase ?? '—'} />
                <Kv k="Renewal" v={`T-${prep.content.accountSnapshot.renewalCountdown}`} />
                <Kv k="Health" v={`${prep.content.accountSnapshot.health} (${prep.content.accountSnapshot.healthDelta! >= 0 ? '+' : ''}${prep.content.accountSnapshot.healthDelta} WoW)`} />
                <Kv k="Top drag" v={prep.content.accountSnapshot.topDrag ?? '—'} />
              </div>
            </Section>
            <Section title="Open items">{prep.content.openItems.map((i, n) => <li key={n} className="ml-4 list-disc">{i}</li>)}</Section>
            <Section title="Recent touchpoints">{prep.content.recentTouchpoints.map((i, n) => <li key={n} className="ml-4 list-disc">{i}</li>)}</Section>
            {prep.content.dealStatus && <Section title="Deal status"><p>{prep.content.dealStatus}</p></Section>}
            <Section title="Attendees">
              {prep.content.attendees.map((a, n) => (
                <div key={n} className="rounded-md border px-2 py-1.5">
                  <div className="flex items-center justify-between"><span className="font-medium">{a.name}</span><span className="text-sm text-muted-foreground capitalize">{a.role?.replace(/_/g, ' ')}</span></div>
                  <div className="text-sm text-muted-foreground">Relationship {a.relationshipStrength}/10 · last contact {relativeTime(a.lastContact)}</div>
                  {a.note && <div className="mt-0.5 text-sm">{a.note}</div>}
                </div>
              ))}
            </Section>
            <Section title="Suggested agenda">{prep.content.suggestedAgenda.map((i, n) => <li key={n} className="ml-4 list-decimal">{i}</li>)}</Section>
          </div>
        </div>
      ) : (
        <div className="p-6"><EmptyState icon={FileText} title="No prep yet" hint="A brief is generated ≤24h before the meeting." /></div>
      )}
    </Sheet>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-sm font-semibold text-muted-foreground">{title}</div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}
function Kv({ k, v }: { k: string; v: string }) {
  return <div><span className="text-muted-foreground">{k}: </span><span className="font-medium">{v}</span></div>;
}

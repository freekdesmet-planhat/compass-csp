import { useMemo, useState } from 'react';
import { PageHeader, PageBody } from '@/components/PageHeader';
import { Card, CardHeader, CardTitle, CardBody, Chip, EmptyState, DeltaArrow } from '@/components/ui';
import { DataTable } from '@/components/DataTable';
import { useVisibleCompanies, useProfiles, useTasks, useActivities, useNps, useDeals } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { fmtCurrency, daysUntil } from '@/lib/utils';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip as RTooltip, Legend } from 'recharts';
import { BarChart3, ChevronDown } from 'lucide-react';
import type { Segment } from '@/lib/types';

const SEGMENTS: Segment[] = ['scaled', 'mid_touch', 'enterprise'];

export default function ReportsPage() {
  const { profile, allProfiles } = useSession();
  const { data: companies = [] } = useVisibleCompanies();
  const { data: profiles = [] } = useProfiles();
  const { data: tasks = [] } = useTasks();
  const { data: activities = [] } = useActivities();
  const { data: nps = [] } = useNps();
  const { data: deals = [] } = useDeals();

  if (profile.role === 'csm') return <div><PageHeader title="Reports" /><PageBody><EmptyState icon={BarChart3} title="Reports are available to managers" hint="Ask your admin for a manager role to see team roll-ups." /></PageBody></div>;

  const visibleIds = useMemo(() => new Set(companies.map((c) => c.id)), [companies]);
  const team = profiles.filter((p) => p.role === 'csm' && (profile.role === 'admin' || p.managerId === profile.id));

  // Health distribution per segment
  const distData = SEGMENTS.map((seg) => {
    const segCos = companies.filter((c) => c.segment === seg);
    return { segment: seg === 'mid_touch' ? 'Mid-touch' : seg[0].toUpperCase() + seg.slice(1), green: segCos.filter((c) => c.healthBand === 'green').length, amber: segCos.filter((c) => c.healthBand === 'amber').length, red: segCos.filter((c) => c.healthBand === 'red').length };
  });

  // At-risk ARR
  const atRisk = companies.filter((c) => c.healthBand === 'red' || (c.healthBand === 'amber' && (daysUntil(c.renewalDate) ?? 999) <= 90));
  const atRiskArr = atRisk.reduce((a, c) => a + (c.arr ?? 0), 0);

  // Renewal forecast (weighted) + vs last week (demo prior)
  const forecast = deals.filter((d) => d.pipeline === 'renewal' && visibleIds.has(d.companyId) && d.status === 'open').reduce((a, d) => a + (d.amount ?? 0) * (d.stageProbability ?? 0.5), 0);
  const priorForecast = forecast * 0.94; // demo estimate

  // Activity leaderboard per CSM
  const leaderboard = team.map((csm) => {
    const cos = new Set(companies.filter((c) => c.ownerId === csm.id).map((c) => c.id));
    const acts = activities.filter((a) => cos.has(a.companyId));
    return {
      id: csm.id, name: csm.fullName, segment: csm.segment,
      meetings: acts.filter((a) => a.type === 'meeting').length,
      emails: acts.filter((a) => a.type === 'email').length,
      tasksDone: tasks.filter((t) => cos.has(t.companyId) && t.completedAt).length,
      accounts: cos.size,
    };
  });

  return (
    <div>
      <PageHeader title="Reports" subtitle={`Team roll-up · ${team.length} CSMs · ${companies.length} accounts`} />
      <PageBody>
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="At-risk ARR" value={fmtCurrency(atRiskArr)} sub={`${atRisk.length} accounts`} />
          <Stat label="Renewal forecast" value={fmtCurrency(forecast)} node={<DeltaArrow delta={Math.round((forecast - priorForecast) / 1000)} />} sub="weighted · vs last wk" />
          <Stat label="Portfolio NPS" value={String(nps.length ? Math.round(nps.reduce((a, n) => a + n.score, 0) / nps.length) : 0)} sub={`${nps.length} responses`} />
          <Stat label="Green accounts" value={`${companies.filter((c) => c.healthBand === 'green').length}/${companies.length}`} />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Health distribution by segment</CardTitle></CardHeader>
            <CardBody>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={distData} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
                    <XAxis dataKey="segment" tick={{ fontSize: 11, fill: 'var(--text-secondary)' }} />
                    <YAxis tick={{ fontSize: 10, fill: 'var(--text-secondary)' }} allowDecimals={false} />
                    <RTooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="green" stackId="a" fill="var(--green)" />
                    <Bar dataKey="amber" stackId="a" fill="var(--amber)" />
                    <Bar dataKey="red" stackId="a" fill="var(--red)" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader><CardTitle>Activity leaderboard</CardTitle></CardHeader>
            <CardBody className="p-0">
              <DataTable
                rows={leaderboard}
                rowKey={(r) => r.id}
                dense
                defaultSort={{ key: 'meetings', dir: 'desc' }}
                columns={[
                  { key: 'name', header: 'CSM', render: (r) => <span className="font-medium">{r.name}</span> },
                  { key: 'seg', header: 'Segment', render: (r) => <span className="capitalize text-muted-foreground">{r.segment?.replace('_', ' ')}</span> },
                  { key: 'accounts', header: 'Accts', align: 'right', sortValue: (r) => r.accounts, render: (r) => r.accounts },
                  { key: 'meetings', header: 'Meetings', align: 'right', sortValue: (r) => r.meetings, render: (r) => r.meetings },
                  { key: 'emails', header: 'Emails', align: 'right', sortValue: (r) => r.emails, render: (r) => r.emails },
                  { key: 'tasksDone', header: 'Tasks ✓', align: 'right', sortValue: (r) => r.tasksDone, render: (r) => r.tasksDone },
                ]}
              />
            </CardBody>
          </Card>
        </div>

        <ExecArchive />
      </PageBody>
    </div>
  );
}

function Stat({ label, value, sub, node }: { label: string; value: string; sub?: string; node?: React.ReactNode }) {
  return (
    <Card className="px-3 py-2.5">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-0.5 flex items-center gap-2 text-2xl font-semibold tnum">{value}{node}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </Card>
  );
}

function ExecArchive() {
  const summaries = [
    { date: 'Jul 11, 2026', text: 'Portfolio health steady (+2 net green). Two enterprise renewals moved to Commit. One P1 escalation on Vertex Systems resolved.' },
    { date: 'Jul 4, 2026', text: 'At-risk ARR down 8% WoW. Scaled segment usage adoption up. Watch: mid-touch renewals clustering in Q4.' },
    { date: 'Jun 27, 2026', text: 'Three NPS promoters converted to references. Expansion pipeline grew $180k. Risk turnaround playbook launched on 2 accounts.' },
  ];
  const [open, setOpen] = useState<number | null>(0);
  return (
    <Card className="mt-4">
      <CardHeader><CardTitle>Weekly Exec Summary archive</CardTitle></CardHeader>
      <CardBody className="space-y-1 p-2">
        {summaries.map((s, i) => (
          <div key={i} className="rounded-md border">
            <button className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-panel" onClick={() => setOpen(open === i ? null : i)}>
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open === i ? 'rotate-180' : ''}`} />
              <span className="font-medium">Week of {s.date}</span>
            </button>
            {open === i && <div className="border-t px-3 py-2 text-base text-muted-foreground">{s.text}</div>}
          </div>
        ))}
      </CardBody>
    </Card>
  );
}

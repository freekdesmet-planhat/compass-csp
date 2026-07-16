import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PageHeader, PageBody } from '@/components/PageHeader';
import { DataTable, type Column } from '@/components/DataTable';
import { HealthChip, HealthDot, Chip, Avatar, Select, SelectTrigger, SelectValue, SelectContent, SelectItem, Card, Button } from '@/components/ui';
import { useVisibleCompanies, useTasks, useDeals, useNps, useUsageMetrics, useCreateTask } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { useToast } from '@/components/toast';
import { SEGMENT_PRESETS, KPI_LABELS, SEGMENT_LABELS, type Segment } from '@/lib/segments';
import { fmtCurrency, fmtDateShort, daysUntil, relativeTime, healthFactor } from '@/lib/utils';
import { paramsToFilter, filterToQuery, applyFilter, describeFilter, isEmptyFilter, type FilterSpec } from '@/lib/portfolioFilters';
import { X, CheckSquare, Play } from 'lucide-react';
import type { Company, Deal, NpsResponse, UsageMetric } from '@/lib/types';

interface KpiCtx { deals: Deal[]; nps: NpsResponse[]; usage: UsageMetric[] }

export default function PortfolioPage() {
  const { profile, allProfiles } = useSession();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { data: companies = [], isLoading } = useVisibleCompanies();
  const { data: allTasks = [] } = useTasks();
  const { data: deals = [] } = useDeals();
  const { data: nps = [] } = useNps();
  const { data: usage = [] } = useUsageMetrics();
  const ctx: KpiCtx = { deals, nps, usage };

  const isManager = profile.role === 'manager' || profile.role === 'admin';
  const filter = useMemo(() => paramsToFilter(params), [params]);

  const filtered = useMemo(() => applyFilter(companies, filter), [companies, filter]);
  const openTaskCount = (companyId: string) => allTasks.filter((t) => t.companyId === companyId && !t.completedAt).length;

  const presetSegment: Segment = profile.segment ?? (filter.segment as Segment) ?? 'mid_touch';
  const kpis = SEGMENT_PRESETS[presetSegment].kpis;
  const owners = allProfiles.filter((p) => p.role === 'csm');
  const ownerName = (id: string) => allProfiles.find((p) => p.id === id)?.fullName ?? id;

  const setKey = (key: keyof FilterSpec, value: string | undefined) => {
    const next: FilterSpec = { ...filter };
    if (value == null || value === 'all' || value === '') delete next[key];
    else (next as Record<string, unknown>)[key] = value;
    setParams(new URLSearchParams(filterToQuery(next).replace(/^\?/, '')));
  };
  const removeKey = (key: keyof FilterSpec) => {
    const next = { ...filter }; delete next[key];
    setParams(new URLSearchParams(filterToQuery(next).replace(/^\?/, '')));
  };

  const chips = describeFilter(filter, ownerName);

  const columns: Column<Company>[] = [
    {
      key: 'name', header: 'Name', width: '22%', sortValue: (c) => c.name,
      render: (c) => (
        <div className="flex items-center gap-2">
          <span className="font-medium">{c.name}</span>
          {c.status === 'churned' && <Chip tone="red">churned</Chip>}
          {c.tags?.slice(0, 1).map((t) => <Chip key={t}>{t}</Chip>)}
        </div>
      ),
    },
    { key: 'health', header: 'Health', width: '10%', sortValue: (c) => c.healthScore, render: (c) => <HealthChip score={c.healthScore} band={c.healthBand} delta={c.healthDeltaWow} /> },
    { key: 'arr', header: 'ARR', align: 'right', width: '9%', sortValue: (c) => c.arr, render: (c) => fmtCurrency(c.arr) },
    {
      key: 'renewal', header: 'Renewal', width: '12%', sortValue: (c) => c.renewalDate,
      render: (c) => {
        const d = daysUntil(c.renewalDate);
        const tone = d != null && d <= 30 ? 'red' : d != null && d <= 90 ? 'amber' : 'neutral';
        return (
          <div className="flex items-center gap-1.5">
            <span>{fmtDateShort(c.renewalDate)}</span>
            {d != null && <Chip tone={tone as 'red' | 'amber' | 'neutral'}>{d < 0 ? `${Math.abs(d)}d overdue` : `${d}d`}</Chip>}
          </div>
        );
      },
    },
    { key: 'phase', header: 'Phase', width: '10%', sortValue: (c) => c.phase, render: (c) => <span className="capitalize text-muted-foreground">{c.phase?.replace(/_/g, ' ') ?? '—'}</span> },
    { key: 'lastTouch', header: 'Last touch', width: '9%', sortValue: (c) => c.lastTouchAt, render: (c) => <span className="text-muted-foreground">{relativeTime(c.lastTouchAt)}</span> },
    { key: 'nextTouch', header: 'Next touch', width: '9%', sortValue: (c) => c.nextTouchAt, render: (c) => <span className="text-muted-foreground">{c.nextTouchAt ? fmtDateShort(c.nextTouchAt) : '—'}</span> },
    { key: 'tasks', header: 'Tasks', align: 'right', width: '6%', sortValue: (c) => openTaskCount(c.id), render: (c) => openTaskCount(c.id) || '—' },
    {
      key: 'owner', header: 'Owner', width: '13%', sortValue: (c) => c.ownerId,
      render: (c) => {
        const o = allProfiles.find((p) => p.id === c.ownerId);
        return <div className="flex items-center gap-1.5"><Avatar name={o?.fullName} className="h-5 w-5 text-[10px]" /><span className="truncate text-muted-foreground">{o?.fullName ?? '—'}</span></div>;
      },
    },
  ];

  return (
    <div>
      <PageHeader
        title="Portfolio"
        subtitle={`${filtered.length} accounts${profile.segment ? ` · ${SEGMENT_LABELS[profile.segment]}` : ''}`}
        actions={
          <div className="flex items-center gap-2">
            {isManager && (
              <Select value={filter.owner ?? 'all'} onValueChange={(v) => setKey('owner', v)}>
                <SelectTrigger className="w-36"><SelectValue placeholder="Owner" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All CSMs</SelectItem>
                  {owners.map((o) => <SelectItem key={o.id} value={o.id}>{o.fullName}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            <Select value={filter.segment ?? 'all'} onValueChange={(v) => setKey('segment', v)}>
              <SelectTrigger className="w-36"><SelectValue placeholder="Segment" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All segments</SelectItem>
                <SelectItem value="scaled">Scaled</SelectItem>
                <SelectItem value="mid_touch">Mid-touch</SelectItem>
                <SelectItem value="enterprise">Enterprise</SelectItem>
              </SelectContent>
            </Select>
          </div>
        }
      />
      <PageBody>
        {/* Dismissible filter-chip bar (B1) */}
        {!isEmptyFilter(filter) && (
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">Filtered:</span>
            {chips.map((c) => (
              <button key={c.key} onClick={() => removeKey(c.key)} className="inline-flex items-center gap-1 rounded-md border bg-white px-2 py-0.5 text-sm hover:bg-panel">
                {c.label}<X className="h-3 w-3 text-muted-foreground" />
              </button>
            ))}
            <Button size="sm" variant="ghost" onClick={() => setParams(new URLSearchParams())}>Clear all</Button>
          </div>
        )}

        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          {kpis.map((k) => <KpiCard key={k} kpiKey={k} companies={filtered} tasks={allTasks} ctx={ctx} presetSegment={presetSegment} onNavigate={(spec) => navigate(`/portfolio${filterToQuery(spec)}`)} />)}
        </div>
        {/* Scaled one-to-many motion (D8c) */}
        {(presetSegment === 'scaled' || filter.segment === 'scaled') && <ScaledBulkBar companies={filtered} />}
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : (
          <DataTable columns={columns} rows={filtered} rowKey={(c) => c.id} onRowClick={(c) => navigate(`/company/${c.id}`)} defaultSort={{ key: 'health', dir: 'asc' }} />
        )}
      </PageBody>
    </div>
  );
}

// Map each KPI key to the FilterSpec its card drills into (B1 / item 24).
function kpiFilter(key: string, presetSegment: Segment): FilterSpec {
  const base: FilterSpec = presetSegment ? { segment: presetSegment } : {};
  switch (key) {
    case 'at_risk_count':
    case 'at_risk_arr': return { atRiskRenewal: true };
    case 'no_touch_60d': return { ...base, noTouchDays: 60 };
    case 'renewals_90d_arr':
    case 'renewal_rate_count': return { ...base, renewalWindowDays: 90 };
    case 'nps_response_rate':
    case 'nps_trend': return { ...base, npsBucket: 'detractor' };
    default: return base;
  }
}

function ScaledBulkBar({ companies }: { companies: Company[] }) {
  const createTask = useCreateTask();
  const { toast } = useToast();
  const n = companies.length;
  const bulkTask = () => {
    const title = prompt(`Task title for ${n} accounts:`, 'Send quarterly check-in email');
    if (!title) return;
    companies.forEach((c) => createTask.mutate({ companyId: c.id, title, taskType: 'email', origin: 'playbook' }));
    toast(`Created "${title}" on ${n} accounts`);
  };
  const bulkPlaybook = () => toast(`Started the scaled playbook on ${n} accounts (queued)`);
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border bg-[var(--accent-tint)]/40 px-3 py-2">
      <span className="text-sm font-medium">{n} accounts in view</span>
      <Button size="sm" variant="outline" onClick={bulkTask}><CheckSquare className="h-3.5 w-3.5" /> Create task for {n}</Button>
      <Button size="sm" variant="outline" onClick={bulkPlaybook}><Play className="h-3.5 w-3.5" /> Start playbook for {n}</Button>
      <span className="text-xs text-muted-foreground">One-to-many motion — acts on the filtered view.</span>
    </div>
  );
}

function KpiCard({ kpiKey, companies, tasks, ctx, presetSegment, onNavigate }: { kpiKey: string; companies: Company[]; tasks: { companyId: string; completedAt?: string | null; origin?: string }[]; ctx: KpiCtx; presetSegment: Segment; onNavigate: (spec: FilterSpec) => void }) {
  const label = KPI_LABELS[kpiKey] ?? kpiKey;
  const { value, sub, node } = computeKpi(kpiKey, companies, tasks, ctx);
  // health_distribution: the three coloured counts each drill to their band.
  if (kpiKey === 'health_distribution') {
    const g = companies.filter((c) => c.healthBand === 'green').length;
    const a = companies.filter((c) => c.healthBand === 'amber').length;
    const r = companies.filter((c) => c.healthBand === 'red').length;
    return (
      <Card className="px-3 py-2.5">
        <div className="text-xs font-medium text-muted-foreground">{label}</div>
        <div className="mt-1 flex items-center gap-3 text-base font-semibold tnum">
          <button onClick={() => onNavigate({ segment: presetSegment, healthBand: 'green' })} className="flex items-center gap-1 hover:opacity-70"><HealthDot band="green" />{g}</button>
          <button onClick={() => onNavigate({ segment: presetSegment, healthBand: 'amber' })} className="flex items-center gap-1 hover:opacity-70"><HealthDot band="amber" />{a}</button>
          <button onClick={() => onNavigate({ segment: presetSegment, healthBand: 'red' })} className="flex items-center gap-1 hover:opacity-70"><HealthDot band="red" />{r}</button>
        </div>
      </Card>
    );
  }
  return (
    <button onClick={() => onNavigate(kpiFilter(kpiKey, presetSegment))} className="text-left">
      <Card className="cursor-pointer px-3 py-2.5 transition-colors hover:border-[var(--accent)]">
        <div className="text-xs font-medium text-muted-foreground">{label}</div>
        {node ?? <div className="mt-0.5 text-2xl font-semibold tnum">{value}</div>}
        {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
      </Card>
    </button>
  );
}

function computeKpi(key: string, companies: Company[], tasks: { companyId: string; completedAt?: string | null; origin?: string }[], ctx: KpiCtx): { value: string; sub?: string; node?: React.ReactNode } {
  const arr = (c: Company) => c.arr ?? 0;
  const totalArr = companies.reduce((a, c) => a + arr(c), 0);
  const ids = new Set(companies.map((c) => c.id));
  const atRisk = companies.filter((c) => c.healthBand === 'red' || (c.healthBand === 'amber' && (daysUntil(c.renewalDate) ?? 999) <= 90));
  const latestUsage = (companyId: string, keyName: string) => ctx.usage.filter((u) => u.companyId === companyId && u.metricKey === keyName).sort((a, b) => +new Date(b.metricDate) - +new Date(a.metricDate))[0]?.value ?? null;
  switch (key) {
    case 'at_risk_count': return { value: String(atRisk.length), sub: 'red or amber+renewing' };
    case 'no_touch_60d': return { value: String(companies.filter((c) => (daysUntil(c.lastTouchAt) ?? -999) < -60).length), sub: 'accounts' };
    case 'usage_adoption_pct': {
      const pcts = companies.map((c) => { const w = latestUsage(c.id, 'weekly_active_users'); const s = latestUsage(c.id, 'licensed_seats'); return w != null && s ? w / s : null; }).filter((x): x is number => x != null);
      return { value: pcts.length ? `${Math.round((pcts.reduce((a, b) => a + b, 0) / pcts.length) * 100)}%` : '—', sub: 'avg WAU / seats' };
    }
    case 'nps_response_rate': {
      const withNps = new Set(ctx.nps.filter((n) => ids.has(n.companyId)).map((n) => n.companyId)).size;
      return { value: companies.length ? `${Math.round((withNps / companies.length) * 100)}%` : '—', sub: `${withNps}/${companies.length} accounts` };
    }
    case 'playbook_completion': {
      const pb = tasks.filter((t) => ids.has(t.companyId) && t.origin === 'playbook');
      const done = pb.filter((t) => t.completedAt).length;
      return { value: pb.length ? `${Math.round((done / pb.length) * 100)}%` : '—', sub: `${done}/${pb.length} steps` };
    }
    case 'renewal_rate_count': return { value: String(companies.filter((c) => (daysUntil(c.renewalDate) ?? 999) < 0).length), sub: 'won QTD' };
    case 'health_weighted_arr': {
      const w = companies.reduce((a, c) => a + arr(c) * healthFactor(c.healthBand), 0);
      return { value: fmtCurrency(w), sub: `of ${fmtCurrency(totalArr)}` };
    }
    case 'renewals_90d_arr': return { value: fmtCurrency(companies.filter((c) => { const d = daysUntil(c.renewalDate); return d != null && d >= 0 && d <= 90; }).reduce((a, c) => a + (c.renewalArr ?? 0), 0)), sub: 'next 90 days' };
    case 'at_risk_arr': return { value: fmtCurrency(atRisk.reduce((a, c) => a + arr(c), 0)), sub: `${atRisk.length} accounts` };
    case 'meetings_this_week': return { value: '6', sub: 'scheduled' };
    case 'expansion_pipeline': return { value: fmtCurrency(ctx.deals.filter((d) => ids.has(d.companyId) && d.pipeline === 'expansion' && d.status === 'open').reduce((a, d) => a + (d.amount ?? 0), 0)), sub: 'open expansion' };
    case 'nps_trend': { const scoped = ctx.nps.filter((n) => ids.has(n.companyId)); return { value: scoped.length ? String(Math.round(scoped.reduce((a, n) => a + n.score, 0) / scoped.length)) : '—', sub: `${scoped.length} responses` }; }
    case 'success_plan_progress': return { value: '63%', sub: 'avg across plans' };
    case 'stakeholder_coverage': return { value: '78%', sub: 'roles covered' };
    case 'exec_engagement_recency': return { value: '18d', sub: 'avg since exec touch' };
    case 'nrr': return { value: '112%', sub: 'trailing 12mo' };
    case 'qbr_compliance': return { value: '5/6', sub: 'QBRs on cadence' };
    default: return { value: '—' };
  }
}

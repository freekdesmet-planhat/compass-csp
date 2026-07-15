import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader, PageBody } from '@/components/PageHeader';
import { DataTable, type Column } from '@/components/DataTable';
import { HealthChip, HealthDot, Chip, SegmentBadge, Avatar, Select, SelectTrigger, SelectValue, SelectContent, SelectItem, Card } from '@/components/ui';
import { useVisibleCompanies, useTasks, useProfiles } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { SEGMENT_PRESETS, KPI_LABELS, SEGMENT_LABELS, type Segment } from '@/lib/segments';
import { fmtCurrency, fmtDateShort, daysUntil, relativeTime, healthFactor } from '@/lib/utils';
import type { Company } from '@/lib/types';

export default function PortfolioPage() {
  const { profile, allProfiles } = useSession();
  const navigate = useNavigate();
  const { data: companies = [], isLoading } = useVisibleCompanies();
  const { data: allTasks = [] } = useTasks();

  const isManager = profile.role === 'manager' || profile.role === 'admin';
  const [segmentFilter, setSegmentFilter] = useState<Segment | 'all'>('all');
  const [ownerFilter, setOwnerFilter] = useState<string>('all');

  const filtered = useMemo(() => {
    return companies.filter((c) => {
      if (segmentFilter !== 'all' && c.segment !== segmentFilter) return false;
      if (ownerFilter !== 'all' && c.ownerId !== ownerFilter) return false;
      return true;
    });
  }, [companies, segmentFilter, ownerFilter]);

  const openTaskCount = (companyId: string) => allTasks.filter((t) => t.companyId === companyId && !t.completedAt).length;

  // KPI cards driven by the user's segment preset (managers: aggregate)
  const presetSegment: Segment = profile.segment ?? (segmentFilter !== 'all' ? segmentFilter : 'mid_touch');
  const kpis = SEGMENT_PRESETS[presetSegment].kpis;

  const owners = allProfiles.filter((p) => p.role === 'csm');

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
    {
      key: 'health', header: 'Health', width: '10%', sortValue: (c) => c.healthScore,
      render: (c) => <HealthChip score={c.healthScore} band={c.healthBand} delta={c.healthDeltaWow} />,
    },
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
        return (
          <div className="flex items-center gap-1.5">
            <Avatar name={o?.fullName} className="h-5 w-5 text-[10px]" />
            <span className="truncate text-muted-foreground">{o?.fullName ?? '—'}</span>
          </div>
        );
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
              <Select value={ownerFilter} onValueChange={setOwnerFilter}>
                <SelectTrigger className="w-36"><SelectValue placeholder="Owner" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All CSMs</SelectItem>
                  {owners.map((o) => <SelectItem key={o.id} value={o.id}>{o.fullName}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            <Select value={segmentFilter} onValueChange={(v) => setSegmentFilter(v as Segment | 'all')}>
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
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          {kpis.map((k) => <KpiCard key={k} kpiKey={k} companies={filtered} tasks={allTasks} />)}
        </div>
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : (
          <DataTable columns={columns} rows={filtered} rowKey={(c) => c.id} onRowClick={(c) => navigate(`/company/${c.id}`)} defaultSort={{ key: 'health', dir: 'asc' }} />
        )}
      </PageBody>
    </div>
  );
}

function KpiCard({ kpiKey, companies, tasks }: { kpiKey: string; companies: Company[]; tasks: { companyId: string; completedAt?: string | null }[] }) {
  const label = KPI_LABELS[kpiKey] ?? kpiKey;
  const { value, sub, node } = computeKpi(kpiKey, companies, tasks);
  return (
    <Card className="px-3 py-2.5">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      {node ?? <div className="mt-0.5 text-2xl font-semibold tnum">{value}</div>}
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </Card>
  );
}

function computeKpi(key: string, companies: Company[], tasks: { companyId: string; completedAt?: string | null }[]): { value: string; sub?: string; node?: React.ReactNode } {
  const arr = (c: Company) => c.arr ?? 0;
  const totalArr = companies.reduce((a, c) => a + arr(c), 0);
  const atRisk = companies.filter((c) => c.healthBand === 'red' || (c.healthBand === 'amber' && (daysUntil(c.renewalDate) ?? 999) <= 90));
  switch (key) {
    case 'health_distribution': {
      const g = companies.filter((c) => c.healthBand === 'green').length;
      const a = companies.filter((c) => c.healthBand === 'amber').length;
      const r = companies.filter((c) => c.healthBand === 'red').length;
      return { value: '', node: (
        <div className="mt-1 flex items-center gap-3 text-base font-semibold tnum">
          <span className="flex items-center gap-1"><HealthDot band="green" />{g}</span>
          <span className="flex items-center gap-1"><HealthDot band="amber" />{a}</span>
          <span className="flex items-center gap-1"><HealthDot band="red" />{r}</span>
        </div>
      ) };
    }
    case 'at_risk_count': return { value: String(atRisk.length), sub: 'red or amber+renewing' };
    case 'no_touch_60d': return { value: String(companies.filter((c) => (daysUntil(c.lastTouchAt) ?? -999) < -60).length), sub: 'accounts' };
    case 'usage_adoption_pct': return { value: '68%', sub: 'avg WAU / seats' };
    case 'nps_response_rate': return { value: '42%', sub: 'last 90d' };
    case 'playbook_completion': return { value: '74%', sub: 'active playbooks' };
    case 'renewal_rate_count': return { value: String(companies.filter((c) => (daysUntil(c.renewalDate) ?? 999) < 0).length), sub: 'won QTD' };
    case 'health_weighted_arr': {
      const w = companies.reduce((a, c) => a + arr(c) * healthFactor(c.healthBand), 0);
      return { value: fmtCurrency(w), sub: `of ${fmtCurrency(totalArr)}` };
    }
    case 'renewals_90d_arr': return { value: fmtCurrency(companies.filter((c) => { const d = daysUntil(c.renewalDate); return d != null && d >= 0 && d <= 90; }).reduce((a, c) => a + (c.renewalArr ?? 0), 0)), sub: 'next 90 days' };
    case 'at_risk_arr': return { value: fmtCurrency(atRisk.reduce((a, c) => a + arr(c), 0)), sub: `${atRisk.length} accounts` };
    case 'meetings_this_week': return { value: '6', sub: 'scheduled' };
    case 'expansion_pipeline': return { value: fmtCurrency(totalArr * 0.18), sub: 'open expansion' };
    case 'nps_trend': return { value: '41', sub: '+4 vs last mo' };
    case 'success_plan_progress': return { value: '63%', sub: 'avg across plans' };
    case 'stakeholder_coverage': return { value: '78%', sub: 'roles covered' };
    case 'exec_engagement_recency': return { value: '18d', sub: 'avg since exec touch' };
    case 'nrr': return { value: '112%', sub: 'trailing 12mo' };
    case 'qbr_compliance': return { value: '5/6', sub: 'QBRs on cadence' };
    default: return { value: '—' };
  }
}

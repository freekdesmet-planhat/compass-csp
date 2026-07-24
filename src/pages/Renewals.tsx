import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader, PageBody } from '@/components/PageHeader';
import { DataTable, type Column } from '@/components/DataTable';
import { Card, CardHeader, CardTitle, CardBody, Chip, HealthChip, HealthDot, Select, SelectTrigger, SelectValue, SelectContent, SelectItem, EmptyState, Button } from '@/components/ui';
import { useVisibleCompanies, useDeals, useProducts, useCompanyProducts } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { fmtCurrency, fmtDateShort, daysUntil, healthFactor } from '@/lib/utils';
import { WhitespaceCell } from '@/components/Whitespace';
import { DealModal } from '@/components/modals';
import { Handshake, Plus } from 'lucide-react';
import type { Company, Deal, Segment } from '@/lib/types';

const STAGE_ORDER = ['T-120 Review', 'Exec Check-in', 'Proposal Sent', 'Negotiation', 'Verbal Commit', 'Closed Won'];

type TimeWin = 'all' | 'this_month' | 'next_month' | 'this_quarter' | 'next_quarter' | 'in_2_months';
const TIME_LABELS: Record<TimeWin, string> = {
  all: 'Any time', this_month: 'This month', next_month: 'Next month',
  this_quarter: 'This quarter', next_quarter: 'Next quarter', in_2_months: 'In 2 months',
};
// Match a renewal/close date against a rolling time window (relative to today).
function inWindow(dateStr: string | null | undefined, win: TimeWin): boolean {
  if (win === 'all') return true;
  if (!dateStr) return false;
  const d = new Date(dateStr); const now = new Date();
  if (win === 'in_2_months') { const days = daysUntil(dateStr) ?? -1; return days >= 0 && days <= 60; }
  const y = d.getFullYear(), m = d.getMonth(), ny = now.getFullYear(), nm = now.getMonth();
  if (win === 'this_month') return y === ny && m === nm;
  if (win === 'next_month') { const nd = new Date(ny, nm + 1, 1); return y === nd.getFullYear() && m === nd.getMonth(); }
  const q = Math.floor(m / 3), nq = Math.floor(nm / 3);
  if (win === 'this_quarter') return y === ny && q === nq;
  if (win === 'next_quarter') { let ty = ny, tq = nq + 1; if (tq > 3) { tq = 0; ty++; } return y === ty && q === tq; }
  return true;
}

export default function RenewalsPage() {
  const navigate = useNavigate();
  const { profile, allProfiles } = useSession();
  const { data: companies = [] } = useVisibleCompanies();
  const { data: allDeals = [] } = useDeals();
  const [view, setView] = useState<'kanban' | 'forecast' | 'expansion'>('kanban');
  const [newDeal, setNewDeal] = useState(false);
  const [segFilter, setSegFilter] = useState<Segment | 'all'>('all');
  const [ownerFilter, setOwnerFilter] = useState('all');
  const [timeFilter, setTimeFilter] = useState<TimeWin>('all');
  const [healthFilter, setHealthFilter] = useState<'all' | 'green' | 'amber' | 'red'>('all');
  const isManager = profile.role === 'manager' || profile.role === 'admin';

  const companyById = useMemo(() => new Map(companies.map((c) => [c.id, c])), [companies]);
  const visibleIds = useMemo(() => new Set(companies.map((c) => c.id)), [companies]);

  // Shared filter for a deal against the segment/owner/health/time controls.
  const dealMatchesFilters = (d: Deal) => {
    const c = companyById.get(d.companyId);
    if (segFilter !== 'all' && c?.segment !== segFilter) return false;
    if (ownerFilter !== 'all' && c?.ownerId !== ownerFilter) return false;
    if (healthFilter !== 'all' && c?.healthBand !== healthFilter) return false;
    if (!inWindow(d.closeDate ?? c?.renewalDate, timeFilter)) return false;
    return true;
  };

  const renewalDeals = useMemo(
    () => allDeals.filter((d) => d.pipeline === 'renewal' && visibleIds.has(d.companyId)).filter(dealMatchesFilters),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allDeals, visibleIds, companyById, segFilter, ownerFilter, healthFilter, timeFilter]
  );

  // The kanban is a general pipeline board: real Planhat opportunities aren't
  // renewal-only (they come across as new_business/expansion with their own
  // stages), so show every visible open/won deal grouped by its actual stage.
  const boardDeals = useMemo(
    () => allDeals.filter((d) => visibleIds.has(d.companyId) && d.status !== 'lost').filter(dealMatchesFilters),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allDeals, visibleIds, companyById, segFilter, ownerFilter, healthFilter, timeFilter]
  );
  const stageColumns = useMemo(() => {
    const present = [...new Set(boardDeals.map((d) => d.stage).filter(Boolean))] as string[];
    return present.length ? present.sort((a, b) => a.localeCompare(b)) : STAGE_ORDER;
  }, [boardDeals]);

  const filteredCompanies = companies.filter((c) => {
    if (segFilter !== 'all' && c.segment !== segFilter) return false;
    if (ownerFilter !== 'all' && c.ownerId !== ownerFilter) return false;
    if (healthFilter !== 'all' && c.healthBand !== healthFilter) return false;
    if (!inWindow(c.renewalDate, timeFilter)) return false;
    return c.status !== 'churned';
  });

  const upForRenewal = filteredCompanies.reduce((a, c) => a + (c.renewalArr ?? 0), 0);
  const retained = renewalDeals.filter((d) => d.status !== 'lost').reduce((a, d) => a + (d.amount ?? 0), 0);
  const expansion = allDeals.filter((d) => d.pipeline === 'expansion' && visibleIds.has(d.companyId)).reduce((a, d) => a + (d.amount ?? 0), 0);
  const grr = upForRenewal ? Math.round((retained / upForRenewal) * 100) : 0;
  const nrr = upForRenewal ? Math.round(((retained + expansion) / upForRenewal) * 100) : 0;
  const owners = allProfiles.filter((p) => p.role === 'csm');

  const tableColumns: Column<Company>[] = [
    { key: 'name', header: 'Company', width: '20%', sortValue: (c) => c.name, render: (c) => <span className="font-medium">{c.name}</span> },
    { key: 'renewal', header: 'Renewal', width: '11%', sortValue: (c) => c.renewalDate, render: (c) => fmtDateShort(c.renewalDate) },
    { key: 'arr', header: 'ARR', align: 'right', width: '10%', sortValue: (c) => c.renewalArr, render: (c) => fmtCurrency(c.renewalArr) },
    { key: 'stage', header: 'Stage', width: '13%', render: (c) => { const d = renewalDeals.find((x) => x.companyId === c.id); return d?.stage ?? '—'; } },
    { key: 'health', header: 'Health', width: '11%', sortValue: (c) => c.healthScore, render: (c) => <HealthChip score={c.healthScore} band={c.healthBand} delta={c.healthDeltaWow} /> },
    { key: 'days', header: 'Days to renewal', align: 'right', width: '11%', sortValue: (c) => daysUntil(c.renewalDate), render: (c) => <span className="tnum">{daysUntil(c.renewalDate)}</span> },
    { key: 'owner', header: 'Owner', width: '13%', render: (c) => allProfiles.find((p) => p.id === c.ownerId)?.fullName ?? '—' },
    { key: 'flag', header: '', width: '11%', render: (c) => { const d = daysUntil(c.renewalDate); return d != null && d <= 90 && (c.healthScore ?? 100) < 60 ? <Chip tone="red">at-risk</Chip> : null; } },
  ];

  return (
    <div>
      <PageHeader
        title="Renewals"
        subtitle={`${boardDeals.length} open deals · ${renewalDeals.length} renewals · ${fmtCurrency(upForRenewal)} up for renewal`}
        actions={
          <div className="flex items-center gap-2">
            {isManager && (
              <Select value={ownerFilter} onValueChange={setOwnerFilter}>
                <SelectTrigger className="w-32"><SelectValue placeholder="CSM" /></SelectTrigger>
                <SelectContent><SelectItem value="all">All CSMs</SelectItem>{owners.map((o) => <SelectItem key={o.id} value={o.id}>{o.fullName}</SelectItem>)}</SelectContent>
              </Select>
            )}
            <Select value={segFilter} onValueChange={(v) => setSegFilter(v as Segment | 'all')}>
              <SelectTrigger className="w-32"><SelectValue placeholder="Segment" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All segments</SelectItem><SelectItem value="scaled">Scaled</SelectItem><SelectItem value="mid_touch">Mid-touch</SelectItem><SelectItem value="enterprise">Enterprise</SelectItem></SelectContent>
            </Select>
            <Select value={timeFilter} onValueChange={(v) => setTimeFilter(v as TimeWin)}>
              <SelectTrigger className="w-36"><SelectValue placeholder="When" /></SelectTrigger>
              <SelectContent>{(Object.keys(TIME_LABELS) as TimeWin[]).map((w) => <SelectItem key={w} value={w}>{TIME_LABELS[w]}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={healthFilter} onValueChange={(v) => setHealthFilter(v as 'all' | 'green' | 'amber' | 'red')}>
              <SelectTrigger className="w-32"><SelectValue placeholder="Health" /></SelectTrigger>
              <SelectContent><SelectItem value="all">All health</SelectItem><SelectItem value="green">Green</SelectItem><SelectItem value="amber">Amber</SelectItem><SelectItem value="red">Red</SelectItem></SelectContent>
            </Select>
            <div className="flex rounded-md border p-0.5">
              <button onClick={() => setView('kanban')} className={`rounded px-2 py-1 text-sm font-medium ${view === 'kanban' ? 'bg-panel text-foreground' : 'text-muted-foreground'}`}>Kanban</button>
              <button onClick={() => setView('forecast')} className={`rounded px-2 py-1 text-sm font-medium ${view === 'forecast' ? 'bg-panel text-foreground' : 'text-muted-foreground'}`}>Forecast</button>
              <button onClick={() => setView('expansion')} className={`rounded px-2 py-1 text-sm font-medium ${view === 'expansion' ? 'bg-panel text-foreground' : 'text-muted-foreground'}`}>Expansion</button>
            </div>
            <Button size="sm" variant="primary" onClick={() => setNewDeal(true)}><Plus className="h-3.5 w-3.5" /> New deal</Button>
          </div>
        }
      />
      <DealModal open={newDeal} onOpenChange={setNewDeal} defaultPipeline="renewal" />
      <PageBody>
        {isManager && (
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Up for renewal" value={fmtCurrency(upForRenewal)} />
            <Stat label="GRR (est.)" value={`${grr}%`} />
            <Stat label="NRR (est.)" value={`${nrr}%`} />
            <Stat label="Expansion pipeline" value={fmtCurrency(expansion)} />
          </div>
        )}

        {view === 'kanban' && (
          <div className="mb-4 flex gap-3 overflow-x-auto pb-2">
            {stageColumns.map((stage) => {
              const cards = boardDeals.filter((d) => d.stage === stage);
              return (
                <div key={stage} className="w-64 shrink-0">
                  <div className="mb-2 flex items-center justify-between px-1 text-sm font-medium">
                    <span>{stage}</span>
                    <span className="text-muted-foreground tnum">{cards.length} · {fmtCurrency(cards.reduce((a, d) => a + (d.amount ?? 0), 0))}</span>
                  </div>
                  <div className="space-y-2">
                    {cards.map((d) => {
                      const c = companyById.get(d.companyId);
                      return (
                        <button key={d.id} onClick={() => navigate(`/company/${d.companyId}?tab=deals`)} className="w-full rounded-lg border bg-white p-2.5 text-left hover:border-[var(--accent)]">
                          <div className="flex items-center gap-1.5"><HealthDot band={c?.healthBand ?? null} /><span className="flex-1 truncate font-medium">{c?.name}</span></div>
                          <div className="mt-1 flex items-center justify-between text-sm text-muted-foreground"><span>{fmtCurrency(d.amount)}</span><span>{fmtDateShort(d.closeDate)}</span></div>
                          {d.nextSteps && <div className="mt-1 truncate text-sm text-muted-foreground">{d.nextSteps.split('\n')[0]}</div>}
                        </button>
                      );
                    })}
                    {cards.length === 0 && <div className="rounded-lg border border-dashed px-2 py-5 text-center text-xs text-muted-foreground">No deals in this stage</div>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {view === 'forecast' && <Forecast deals={boardDeals} companyById={companyById} />}
        {view === 'expansion' && <ExpansionHeatmap companies={filteredCompanies} />}

        {view !== 'expansion' && (
          <DataTable columns={tableColumns} rows={filteredCompanies.filter((c) => c.renewalDate)} rowKey={(c) => c.id} onRowClick={(c) => navigate(`/company/${c.id}?tab=deals`)} defaultSort={{ key: 'days', dir: 'asc' }} empty={<EmptyState icon={Handshake} title="No renewals" />} />
        )}
      </PageBody>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <Card className="px-3 py-2.5"><div className="text-xs font-medium text-muted-foreground">{label}</div><div className="mt-0.5 text-2xl font-semibold tnum">{value}</div></Card>;
}

// Expansion heatmap (C5b): accounts × products, sortable by whitespace count.
function ExpansionHeatmap({ companies }: { companies: Company[] }) {
  const navigate = useNavigate();
  const { data: products = [] } = useProducts();
  const { data: cps = [] } = useCompanyProducts();
  const [sortByWhitespace, setSortByWhitespace] = useState(true);

  const cpFor = (companyId: string, productId: string) => cps.find((c) => c.companyId === companyId && c.productId === productId);
  const whitespaceCount = (companyId: string) => products.filter((p) => (cpFor(companyId, p.id)?.status ?? 'none') === 'none').length;

  const rows = useMemo(() => {
    const arr = [...companies];
    if (sortByWhitespace) arr.sort((a, b) => whitespaceCount(b.id) - whitespaceCount(a.id));
    else arr.sort((a, b) => a.name.localeCompare(b.name));
    return arr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companies, cps, products, sortByWhitespace]);

  // ARR-weighted whitespace: Σ arr × (empty cells / product count).
  const whitespaceArr = companies.reduce((a, c) => a + (c.arr ?? 0) * (whitespaceCount(c.id) / (products.length || 1)), 0);
  const accountsWithWhitespace = companies.filter((c) => whitespaceCount(c.id) > 0).length;

  if (!companies.length) return <EmptyState icon={Handshake} title="No accounts in scope" />;

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>Whitespace — {fmtCurrency(whitespaceArr)} ARR-weighted across {accountsWithWhitespace} accounts</CardTitle>
        <button onClick={() => setSortByWhitespace((s) => !s)} className="text-xs text-[var(--accent)] hover:underline">Sort: {sortByWhitespace ? 'whitespace ▾' : 'name'}</button>
      </CardHeader>
      <CardBody className="overflow-x-auto p-0">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b bg-panel/60">
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">Account</th>
              {products.map((p) => <th key={p.id} className="px-2 py-2 text-center text-xs font-medium text-muted-foreground" style={{ minWidth: 96 }}>{p.name}</th>)}
              <th className="px-2 py-2 text-right font-medium text-muted-foreground">WS</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 200).map((c) => (
              <tr key={c.id} className="border-b last:border-0">
                <td className="px-3 py-1.5"><button className="font-medium hover:text-[var(--accent)]" onClick={() => navigate(`/company/${c.id}?tab=deals`)}>{c.name}</button></td>
                {products.map((p) => <td key={p.id} className="px-1 py-1"><WhitespaceCell companyId={c.id} product={p} cp={cpFor(c.id, p.id)} compact /></td>)}
                <td className="px-2 py-1.5 text-right tnum text-muted-foreground">{whitespaceCount(c.id)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > 200 && <div className="px-3 py-2 text-xs text-muted-foreground">Showing first 200 of {rows.length} accounts.</div>}
      </CardBody>
    </Card>
  );
}

function quarterOf(date?: string | null): string {
  if (!date) return 'Unscheduled';
  const d = new Date(date);
  return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`;
}

function Forecast({ deals, companyById }: { deals: Deal[]; companyById: Map<string, Company> }) {
  const quarters = useMemo(() => {
    const map = new Map<string, { commit: number; best: number; pipeline: number; healthAdj: number }>();
    for (const d of deals) {
      const q = quarterOf(d.closeDate);
      const bucket = map.get(q) ?? { commit: 0, best: 0, pipeline: 0, healthAdj: 0 };
      const amt = d.amount ?? 0;
      const weighted = amt * (d.stageProbability ?? 0.5);
      if (d.forecastCategory === 'commit') bucket.commit += amt;
      else if (d.forecastCategory === 'best_case') bucket.best += amt;
      else bucket.pipeline += weighted;
      bucket.healthAdj += amt * healthFactor(companyById.get(d.companyId)?.healthBand ?? null);
      map.set(q, bucket);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [deals, companyById]);

  return (
    <Card className="mb-4">
      <CardHeader><CardTitle>Renewal forecast by quarter</CardTitle></CardHeader>
      <CardBody>
        <table className="w-full text-base">
          <thead><tr className="border-b text-sm text-muted-foreground">
            <th className="py-1.5 text-left font-medium">Quarter</th>
            <th className="py-1.5 text-right font-medium">Commit</th>
            <th className="py-1.5 text-right font-medium">Best case</th>
            <th className="py-1.5 text-right font-medium">Pipeline (weighted)</th>
            <th className="py-1.5 text-right font-medium">Health-adjusted</th>
          </tr></thead>
          <tbody>
            {quarters.map(([q, b]) => (
              <tr key={q} className="border-b last:border-0">
                <td className="py-2 font-medium">{q}</td>
                <td className="py-2 text-right tnum">{fmtCurrency(b.commit)}</td>
                <td className="py-2 text-right tnum">{fmtCurrency(b.best)}</td>
                <td className="py-2 text-right tnum">{fmtCurrency(b.pipeline)}</td>
                <td className="py-2 text-right font-medium tnum text-[var(--accent)]">{fmtCurrency(b.healthAdj)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-muted-foreground">Health-adjusted = amount × factor (green 1.0 · amber 0.75 · red 0.4).</p>
      </CardBody>
    </Card>
  );
}

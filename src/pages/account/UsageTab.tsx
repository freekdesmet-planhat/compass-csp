// Usage tab (C3) — driven entirely by usage_metrics. Config-driven so adding a
// metric key needs no code change: the WAU/seats/adoption keys come from the
// segment's health input_config (mirrored here for demo mode).
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardHeader, CardTitle, CardBody, EmptyState, DeltaArrow, Chip } from '@/components/ui';
import { useUsageMetrics } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { fmtNumber, fmtDate } from '@/lib/utils';
import { LineChart, Line, ResponsiveContainer, YAxis, XAxis, Tooltip as RTooltip } from 'recharts';
import { Activity as ActivityIcon } from 'lucide-react';
import type { Company, UsageMetric } from '@/lib/types';

// Mirrors health_configs.input_config.usage (see seed migration). Config-driven.
const USAGE_CONFIG = {
  wauMetric: 'weekly_active_users',
  seatsMetric: 'licensed_seats',
  adoptionMetrics: ['feature_x_users'],
  trendWeeks: 4,
};

const RANGES = [
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: '365d', days: 365 },
];

// Metric keys may be snake_case app keys or free-form Planhat dimension names.
const humanize = (k: string) => k.replace(/_/g, ' ').replace(/\bmrr\b/gi, 'MRR').replace(/\barr\b/gi, 'ARR');

export function UsageTab({ company }: { company: Company }) {
  const { profile } = useSession();
  const { data: metrics = [] } = useUsageMetrics(company.id);
  const [range, setRange] = useState(90);

  const byKey = useMemo(() => {
    const m = new Map<string, UsageMetric[]>();
    metrics.forEach((u) => { (m.get(u.metricKey) ?? m.set(u.metricKey, []).get(u.metricKey)!).push(u); });
    m.forEach((arr) => arr.sort((a, b) => +new Date(a.metricDate) - +new Date(b.metricDate)));
    return m;
  }, [metrics]);

  const latest = (key: string) => byKey.get(key)?.slice(-1)[0]?.value ?? null;
  const deltaOf = (key: string) => {
    const s = byKey.get(key) ?? [];
    return s.length >= USAGE_CONFIG.trendWeeks + 1 ? s.slice(-1)[0].value - s.slice(-(USAGE_CONFIG.trendWeeks + 1))[0].value : null;
  };
  const lastDateOf = (key: string) => byKey.get(key)?.slice(-1)[0]?.metricDate ?? null;
  const wau = latest(USAGE_CONFIG.wauMetric);
  const seats = latest(USAGE_CONFIG.seatsMetric);
  const utilisation = wau != null && seats ? Math.round((wau / seats) * 100) : null;
  const trend = deltaOf(USAGE_CONFIG.wauMetric);
  const lastActive = lastDateOf(USAGE_CONFIG.wauMetric);
  // WAU/seats drive the headline when the tenant emits them (demo + SaaS-usage
  // tenants). Otherwise headline the actual synced metrics (e.g. Planhat
  // dimensions like "Number of Leads") so the tiles reflect real data.
  const hasStdMetrics = wau != null || seats != null;

  if (!metrics.length) {
    return <EmptyState icon={ActivityIcon} title="No usage data" hint="No usage_metrics for this account yet — check the metric keys in Admin → Health config." />;
  }

  const allKeys = [...byKey.keys()];
  const cutoff = Date.now() - range * 86_400_000;
  const chartData = (key: string) => (byKey.get(key) ?? []).filter((u) => +new Date(u.metricDate) >= cutoff).map((u) => ({ date: u.metricDate, value: u.value }));

  return (
    <div className="space-y-4">
      {/* Headline row */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {hasStdMetrics ? (
          <>
            <Stat label="Utilisation (WAU/seats)" value={utilisation != null ? `${utilisation}%` : '—'} />
            <Stat label="WAU" value={wau != null ? fmtNumber(wau) : '—'} extra={trend != null ? <DeltaArrow delta={trend} /> : undefined} />
            <Stat label="Licensed seats" value={seats != null ? fmtNumber(seats) : '—'} />
            <Stat label="Last active" value={lastActive ? fmtDate(lastActive) : '—'} />
          </>
        ) : (
          allKeys.slice(0, 4).map((key) => {
            const v = latest(key); const d = deltaOf(key); const ld = lastDateOf(key);
            return <Stat key={key} label={humanize(key)} value={v != null ? fmtNumber(v) : '—'} extra={d != null ? <DeltaArrow delta={d} /> : undefined} sub={ld ? fmtDate(ld) : undefined} />;
          })
        )}
      </div>

      {/* Range toggle */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">Weekly aggregation</div>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button key={r.days} onClick={() => setRange(r.days)} className={`rounded-md border px-2 py-0.5 text-sm ${range === r.days ? 'bg-[var(--accent)] text-white' : 'bg-white hover:bg-panel'}`}>{r.label}</button>
          ))}
        </div>
      </div>

      {/* Per-metric line charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        {allKeys.map((key) => {
          const data = chartData(key);
          return (
            <Card key={key}>
              <CardHeader className="py-2"><CardTitle className="text-sm">{humanize(key)}</CardTitle></CardHeader>
              <CardBody className="py-2">
                {data.length ? (
                  <div className="h-40">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
                        <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-secondary)' }} tickFormatter={(d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} minTickGap={24} />
                        <YAxis tick={{ fontSize: 10, fill: 'var(--text-secondary)' }} />
                        <RTooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                        <Line type="monotone" dataKey="value" stroke="var(--accent)" strokeWidth={2} dot={false} isAnimationActive={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                ) : <div className="py-8 text-center text-sm text-muted-foreground">No data for <code className="rounded bg-panel px-1">{key}</code> in this range.</div>}
              </CardBody>
            </Card>
          );
        })}
      </div>

      {/* Adoption grid */}
      <Card>
        <CardHeader className="py-2"><CardTitle className="text-sm">Adoption</CardTitle></CardHeader>
        <CardBody className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {USAGE_CONFIG.adoptionMetrics.map((key) => {
            const series = byKey.get(key) ?? [];
            const cur = series.slice(-1)[0]?.value ?? null;
            return (
              <div key={key} className="rounded-md border p-3">
                <div className="text-xs text-muted-foreground">{humanize(key)}</div>
                <div className="mt-0.5 text-xl font-semibold tnum">{cur != null ? fmtNumber(cur) : '—'}</div>
                <Sparkline values={series.map((s) => s.value)} />
              </div>
            );
          })}
          {USAGE_CONFIG.adoptionMetrics.every((k) => !byKey.has(k)) && <div className="col-span-full text-sm text-muted-foreground">No adoption metrics configured.</div>}
        </CardBody>
      </Card>

      {profile.role === 'admin' && (
        <div className="text-sm text-muted-foreground">
          <Link to="/admin" className="text-[var(--accent)] hover:underline">Manage metrics</Link> in Admin → Health config.
        </div>
      )}
      <div className="flex flex-wrap gap-1">{allKeys.map((k) => <Chip key={k}>{humanize(k)}</Chip>)}</div>
    </div>
  );
}

function Stat({ label, value, extra, sub }: { label: string; value: string; extra?: React.ReactNode; sub?: string }) {
  return (
    <Card className="px-3 py-2.5">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-0.5 flex items-center gap-2 text-xl font-semibold tnum">{value}{extra}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">as of {sub}</div>}
    </Card>
  );
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const min = Math.min(...values), max = Math.max(...values), range = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${20 - ((v - min) / range) * 18}`).join(' ');
  return <svg viewBox="0 0 100 20" className="mt-1 h-5 w-full" preserveAspectRatio="none"><polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="1.5" /></svg>;
}

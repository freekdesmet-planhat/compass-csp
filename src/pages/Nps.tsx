import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader, PageBody } from '@/components/PageHeader';
import { Card, CardHeader, CardTitle, CardBody, Chip, EmptyState, Button } from '@/components/ui';
import { useNps, useCsat, useVisibleCompanies, useContacts } from '@/lib/hooks';
import { NpsModal } from '@/components/modals';
import { fmtDate } from '@/lib/utils';
import { LineChart, Line, ResponsiveContainer, YAxis, XAxis, Tooltip as RTooltip } from 'recharts';
import { Gauge, Plus } from 'lucide-react';

// ROOT CAUSE (A2 / acceptance #3): the empty NPS page in the live tenant was
// NOT a UI bug — this page queries nps_responses joined to visible companies and
// renders fine. The migration's step-8 `GET /nps` mapping wrote responses with a
// company reference that didn't resolve (Planhat returns the response keyed by
// its own contact/company ids, which must be remapped to Compass ids via
// source_id). With the mapping fixed, and the idempotent `--only=nps` backfill in
// scripts/migrate-planhat.ts, migrated responses now land. Demo mode always had
// data. A proper page-level empty state + manual "Log NPS response" cover the gap.

// NOTE on scale: in this dataset an NPS response `score` is stored on a
// -100..100 point scale (Planhat-style relative NPS), not raw 0–10. So we
// bucket: promoter ≥ 50, detractor < 0, passive in between, and headline NPS =
// mean of scores. CSAT is a 1–5 satisfaction rating.
function bucket(score: number): 'promoter' | 'passive' | 'detractor' {
  if (score >= 50) return 'promoter';
  if (score < 0) return 'detractor';
  return 'passive';
}

export default function NpsPage() {
  const navigate = useNavigate();
  const { data: companies = [] } = useVisibleCompanies();
  const { data: allNps = [] } = useNps();
  const { data: allCsat = [] } = useCsat();
  const { data: allContacts = [] } = useContacts();

  const visibleIds = useMemo(() => new Set(companies.map((c) => c.id)), [companies]);
  const companyById = useMemo(() => new Map(companies.map((c) => [c.id, c])), [companies]);
  const contactById = useMemo(() => new Map(allContacts.map((c) => [c.id, `${c.firstName} ${c.lastName}`])), [allContacts]);

  const nps = useMemo(() => allNps.filter((n) => visibleIds.has(n.companyId)).sort((a, b) => +new Date(b.respondedAt) - +new Date(a.respondedAt)), [allNps, visibleIds]);
  const csat = useMemo(() => allCsat.filter((c) => visibleIds.has(c.companyId)).sort((a, b) => +new Date(b.respondedAt) - +new Date(a.respondedAt)), [allCsat, visibleIds]);

  const promoters = nps.filter((n) => bucket(n.score) === 'promoter').length;
  const passives = nps.filter((n) => bucket(n.score) === 'passive').length;
  const detractors = nps.filter((n) => bucket(n.score) === 'detractor').length;
  const headlineNps = nps.length ? Math.round(nps.reduce((a, n) => a + n.score, 0) / nps.length) : 0;
  const avgCsat = csat.length ? (csat.reduce((a, c) => a + c.score, 0) / csat.length).toFixed(1) : '—';

  // Monthly trend
  const trend = useMemo(() => {
    const byMonth = new Map<string, number[]>();
    for (const n of nps) {
      if (!n.respondedAt) continue; // defensive: skip responses without a date
      const m = n.respondedAt.slice(0, 7);
      (byMonth.get(m) ?? byMonth.set(m, []).get(m)!).push(n.score);
    }
    return [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([m, scores]) => ({ month: m, nps: Math.round(scores.reduce((x, y) => x + y, 0) / scores.length) }));
  }, [nps]);

  // Per-segment cut
  const bySegment = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const n of nps) {
      const seg = companyById.get(n.companyId)?.segment ?? 'unknown';
      (map.get(seg) ?? map.set(seg, []).get(seg)!).push(n.score);
    }
    return [...map.entries()].map(([seg, s]) => ({ seg, nps: Math.round(s.reduce((a, b) => a + b, 0) / s.length), n: s.length }));
  }, [nps, companyById]);

  const [logOpen, setLogOpen] = useState(false);

  return (
    <div>
      <PageHeader title="NPS & CSAT" subtitle={`${nps.length} NPS responses · ${csat.length} CSAT`}
        actions={<Button variant="primary" onClick={() => setLogOpen(true)}><Plus className="h-3.5 w-3.5" /> Log NPS response</Button>} />
      <NpsModal open={logOpen} onOpenChange={setLogOpen} />
      <PageBody>
        {nps.length === 0 && csat.length === 0 && (
          <EmptyState icon={Gauge} title="No NPS or CSAT responses yet" hint="Responses sync from Planhat/surveys, or log one manually." action={<Button variant="primary" onClick={() => setLogOpen(true)}>Log NPS response</Button>} />
        )}
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
          <Stat label="NPS" value={String(headlineNps)} />
          <Stat label="Promoters" value={String(promoters)} tone="green" />
          <Stat label="Passives" value={String(passives)} tone="amber" />
          <Stat label="Detractors" value={String(detractors)} tone="red" />
          <Stat label="Avg CSAT" value={`${avgCsat}/5`} />
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader><CardTitle>NPS trend</CardTitle></CardHeader>
            <CardBody>
              <div className="h-48">
                {trend.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-center text-sm text-muted-foreground">No NPS responses yet — log one to start the trend.</div>
                ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trend} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
                    <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'var(--text-secondary)' }} tickFormatter={(m) => new Date(m + '-01').toLocaleDateString('en-US', { month: 'short' })} minTickGap={20} />
                    <YAxis domain={[-100, 100]} tick={{ fontSize: 10, fill: 'var(--text-secondary)' }} />
                    <RTooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                    <Line type="monotone" dataKey="nps" stroke="var(--accent)" strokeWidth={2} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
                )}
              </div>
              {/* stacked split bar */}
              <div className="mt-3 flex h-3 overflow-hidden rounded-full">
                <div style={{ width: `${(promoters / Math.max(nps.length, 1)) * 100}%`, background: 'var(--green)' }} />
                <div style={{ width: `${(passives / Math.max(nps.length, 1)) * 100}%`, background: 'var(--amber)' }} />
                <div style={{ width: `${(detractors / Math.max(nps.length, 1)) * 100}%`, background: 'var(--red)' }} />
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader><CardTitle>By segment</CardTitle></CardHeader>
            <CardBody className="space-y-2">
              {bySegment.map((s) => (
                <div key={s.seg} className="flex items-center justify-between text-base">
                  <span className="capitalize">{s.seg.replace('_', ' ')}</span>
                  <span className="tnum font-medium">{s.nps} <span className="text-xs text-muted-foreground">({s.n})</span></span>
                </div>
              ))}
            </CardBody>
          </Card>
        </div>

        <Card className="mt-4">
          <CardHeader><CardTitle>Response feed</CardTitle></CardHeader>
          <CardBody className="space-y-1 p-2">
            {nps.length ? nps.slice(0, 40).map((n) => {
              const b = bucket(n.score);
              return (
                <div key={n.id} className="flex items-start gap-3 rounded-md px-2 py-1.5 hover:bg-panel">
                  <Chip tone={b === 'promoter' ? 'green' : b === 'passive' ? 'amber' : 'red'}>{n.score}</Chip>
                  <div className="min-w-0 flex-1">
                    <p className="truncate">{n.comment}</p>
                    <div className="text-sm text-muted-foreground">{n.contactId ? contactById.get(n.contactId) : 'Anonymous'} · <button className="hover:text-[var(--accent)]" onClick={() => navigate(`/company/${n.companyId}?tab=nps`)}>{companyById.get(n.companyId)?.name}</button></div>
                  </div>
                  <span className="shrink-0 text-sm text-muted-foreground">{fmtDate(n.respondedAt)}</span>
                </div>
              );
            }) : <EmptyState icon={Gauge} title="No NPS responses" />}
          </CardBody>
        </Card>
      </PageBody>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'green' | 'amber' | 'red' }) {
  const color = tone === 'green' ? 'var(--green)' : tone === 'amber' ? 'var(--amber)' : tone === 'red' ? 'var(--red)' : 'var(--text-primary)';
  return <Card className="px-3 py-2.5"><div className="text-xs font-medium text-muted-foreground">{label}</div><div className="mt-0.5 text-2xl font-semibold tnum" style={{ color }}>{value}</div></Card>;
}

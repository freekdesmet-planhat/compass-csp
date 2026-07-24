import { useState } from 'react';
import { Card, CardHeader, CardTitle, CardBody, Button, Chip, Tooltip, Input, Switch, DeltaArrow } from '@/components/ui';
import { useHealthSnapshots, useLatestSnapshot, useRecomputeHealth, useUpdateCompany, useCreateTask, useLogActivity } from '@/lib/hooks';
import { HEALTH_DIMENSIONS } from '@/lib/segments';
import { useSession } from '@/lib/session';
import { useToast } from '@/components/toast';
import { LineChart, Line, ResponsiveContainer, YAxis, Tooltip as RTooltip, XAxis } from 'recharts';
import { Sparkles, RefreshCw, Plus } from 'lucide-react';
import type { Company } from '@/lib/types';

const DIM_COLORS: Record<string, string> = { value: '#7A5AF8', engagement: '#2563EB', support: '#F79009', sentiment: '#12B76A', usage: '#06AED4' };

export function HealthTab({ company }: { company: Company }) {
  const { data: snapshots = [] } = useHealthSnapshots(company.id);
  const latest = useLatestSnapshot(company.id);
  const recompute = useRecomputeHealth();
  const updateCompany = useUpdateCompany();
  const createTask = useCreateTask();
  const logActivity = useLogActivity();
  const { profile } = useSession();
  const { toast } = useToast();

  const [valueScore, setValueScore] = useState(company.valueScore?.toString() ?? '');
  const [sentiment, setSentiment] = useState(company.sentimentAssessment?.toString() ?? '');
  const [note, setNote] = useState('');

  const triggerRecompute = async () => {
    const prev = company.healthScore ?? 0;
    const res = await recompute.mutateAsync(company.id);
    const after = res?.overall ?? prev;
    await logActivity.mutateAsync({
      companyId: company.id, type: 'system', title: `Health recomputed by ${profile.fullName}`,
      snippet: `${note.trim() ? `${note.trim()} · ` : ''}score ${prev} → ${after}`,
    });
    setNote('');
    toast('Health recomputed & logged to timeline');
  };

  const saveManual = async (patch: Partial<Company>, label: string) => {
    const prev = company.healthScore ?? 0;
    await updateCompany.mutateAsync({ id: company.id, patch });
    const res = await recompute.mutateAsync(company.id);
    const after = res?.overall ?? prev;
    await logActivity.mutateAsync({
      companyId: company.id, type: 'system', title: `Health updated by ${profile.fullName}`,
      snippet: `${label}${note.trim() ? ` — ${note.trim()}` : ''} · score ${prev} → ${after}`,
    });
    setNote('');
    toast('Updated — health recomputed & logged to timeline');
  };

  const score = company.healthScore ?? 0;
  const band = company.healthBand;
  const ringColor = band === 'green' ? 'var(--green)' : band === 'amber' ? 'var(--amber)' : 'var(--red)';
  const dims = latest?.dimensions ?? {};

  // 12-month sparkline data (includes migrated Planhat history)
  const spark = snapshots.map((s) => ({ date: s.snapshotDate, score: s.overall }));

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {/* Score ring + delta */}
      <Card className="lg:col-span-1">
        <CardHeader><CardTitle>Health score</CardTitle>
          <Button size="sm" variant="outline" onClick={triggerRecompute}><RefreshCw className="h-3.5 w-3.5" /> Recompute</Button>
        </CardHeader>
        <CardBody className="flex flex-col items-center gap-3">
          <Ring score={score} color={ringColor} />
          <div className="flex items-center gap-2">
            <Chip tone={(band ?? 'neutral') as 'green' | 'amber' | 'red' | 'neutral'} className="capitalize">{band ?? 'unknown'}</Chip>
            {company.healthDeltaWow != null && company.healthDeltaWow !== 0 && (
              <span className="text-sm text-muted-foreground">changed <DeltaArrow delta={company.healthDeltaWow} /> pts since last week</span>
            )}
          </div>
          {/* manual inputs — editable, instant recompute */}
          <div className="mt-2 w-full space-y-2 border-t pt-3">
            <Input className="h-7 text-sm" placeholder="Reason / note (optional — logged to timeline)" value={note} onChange={(e) => setNote(e.target.value)} />
            <ManualInput label="Value to client (1–10)" value={valueScore} onChange={setValueScore} onBlur={() => { if (valueScore !== (company.valueScore?.toString() ?? '')) saveManual({ valueScore: valueScore ? Number(valueScore) : null }, `Value to client → ${valueScore || '—'}`); }} />
            {company.valueComment && <p className="text-sm text-muted-foreground">{company.valueComment}</p>}
            <ManualInput label="Sentiment (1–10)" value={sentiment} onChange={setSentiment} onBlur={() => { if (sentiment !== (company.sentimentAssessment?.toString() ?? '')) saveManual({ sentimentAssessment: sentiment ? Number(sentiment) : null }, `Sentiment → ${sentiment || '—'}`); }} />
            <label className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Exec relationship flag (+10)</span>
              <Switch checked={company.execRelationshipFlag} onCheckedChange={(v) => saveManual({ execRelationshipFlag: v }, `Exec relationship flag → ${v ? 'on' : 'off'}`)} />
            </label>
          </div>
        </CardBody>
      </Card>

      {/* Dimension bars */}
      <Card className="lg:col-span-2">
        <CardHeader><CardTitle>Dimension contributions</CardTitle><span className="text-sm text-muted-foreground tnum">sum = {score}</span></CardHeader>
        <CardBody className="space-y-2.5">
          {HEALTH_DIMENSIONS.map((d) => {
            const dim = dims[d.key];
            const excluded = !dim || dim.score == null;
            return (
              <div key={d.key}>
                <div className="mb-0.5 flex items-center justify-between text-sm">
                  <span className="font-medium">{d.label}</span>
                  {excluded ? <Chip>excluded · weight redistributed</Chip> : (
                    <Tooltip content={<DimInputs inputs={dim!.inputs} />}>
                      <span className="cursor-help tnum text-muted-foreground">score {dim!.score} · weight {dim!.weight}% · <span className="font-medium text-foreground">contributes {dim!.contribution}</span></span>
                    </Tooltip>
                  )}
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-[#eef0f3]">
                  {!excluded && <div className="h-full rounded-full" style={{ width: `${dim!.contribution}%`, background: DIM_COLORS[d.key] }} />}
                </div>
              </div>
            );
          })}
        </CardBody>
      </Card>

      {/* Why this score */}
      <Card className="lg:col-span-3">
        <CardHeader><CardTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-[var(--accent)]" /> Why this score</CardTitle></CardHeader>
        <CardBody><p className="leading-relaxed">{latest?.explanation ?? 'No narrative yet — click Recompute to generate.'}</p></CardBody>
      </Card>

      {/* Recommendations */}
      <div className="grid gap-3 lg:col-span-3 lg:grid-cols-3">
        {(latest?.recommendations ?? []).slice(0, 3).map((r, i) => (
          <Card key={i}>
            <CardBody className="flex h-full flex-col gap-2">
              <div className="font-medium">{r.title}</div>
              <p className="flex-1 text-sm text-muted-foreground">{r.why}</p>
              <Button size="sm" variant="outline" className="self-start" onClick={async () => { await createTask.mutateAsync({ companyId: company.id, title: r.suggestedTask.title, dueDate: new Date(Date.now() + r.suggestedTask.dueInDays * 86400000).toISOString().slice(0, 10), origin: 'ai_recommendation', priority: 'high' }); toast('Task created', { tone: 'success' }); }}>
                <Plus className="h-3.5 w-3.5" /> Create task
              </Button>
            </CardBody>
          </Card>
        ))}
      </div>

      {/* 12-month sparkline */}
      <Card className="lg:col-span-3">
        <CardHeader><CardTitle>12-month history</CardTitle><span className="text-sm text-muted-foreground">includes migrated Planhat history</span></CardHeader>
        <CardBody>
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={spark} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--text-secondary)' }} tickFormatter={(d) => new Date(d).toLocaleDateString('en-US', { month: 'short' })} minTickGap={24} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: 'var(--text-secondary)' }} />
                <RTooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Line type="monotone" dataKey="score" stroke="var(--accent)" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function Ring({ score, color }: { score: number; color: string }) {
  const r = 52; const c = 2 * Math.PI * r; const off = c - (score / 100) * c;
  return (
    <div className="relative h-32 w-32">
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
        <circle cx="60" cy="60" r={r} fill="none" stroke="#eef0f3" strokeWidth="10" />
        <circle cx="60" cy="60" r={r} fill="none" stroke={color} strokeWidth="10" strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-semibold tnum">{score}</span>
        <span className="text-xs text-muted-foreground">/ 100</span>
      </div>
    </div>
  );
}

function ManualInput({ label, value, onChange, onBlur }: { label: string; value: string; onChange: (v: string) => void; onBlur: () => void }) {
  return (
    <label className="flex items-center justify-between gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <Input className="h-7 w-16 text-right" value={value} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} inputMode="numeric" />
    </label>
  );
}

function DimInputs({ inputs }: { inputs: Record<string, number | string | null> }) {
  return (
    <div className="space-y-0.5 text-sm">
      {Object.entries(inputs).map(([k, v]) => (
        <div key={k} className="flex justify-between gap-3"><span className="text-muted-foreground">{k}</span><span className="tnum">{v == null ? '—' : String(v)}</span></div>
      ))}
    </div>
  );
}

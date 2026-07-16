// Dashboards (D2) — grid of widgets over the RLS-respecting dataset layer.
// Widget editor: dataset → measure → group-by → chart kind, live preview. Every
// widget click drills through to the filtered Portfolio (B1). Sharing toggles
// team visibility. (Deviation: layout is a responsive grid; drag-to-arrange is a
// follow-up — position is persisted but not yet draggable.)
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card, CardHeader, CardTitle, CardBody, Button, Input, Select, SelectTrigger, SelectValue,
  SelectContent, SelectItem, Switch, EmptyState, Dialog, DialogContent, DialogTitle,
} from '@/components/ui';
import { useVisibleCompanies, useDashboards, useDashboardWidgets, useDashboardMutations } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { runDataset, drillFilter, type DatasetRow } from '@/lib/datasets';
import { filterToQuery } from '@/lib/portfolioFilters';
import { fmtNumber, fmtAxisTick } from '@/lib/utils';
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, ResponsiveContainer, Tooltip as RTooltip } from 'recharts';
import { Plus, LayoutDashboard, Trash2, Share2 } from 'lucide-react';
import type { DashboardWidget, WidgetKind } from '@/lib/types';

const DATASETS = [
  { v: 'companies', label: 'Companies', groups: ['segment', 'healthBand', 'owner', 'phase', 'region'], measures: ['count', 'sum_arr', 'avg_health'] },
  { v: 'renewals', label: 'Renewals', groups: ['stage', 'quarter', 'forecast'], measures: ['sum_arr', 'count'] },
  { v: 'activities', label: 'Activities', groups: ['type', 'user', 'month'], measures: ['count'] },
  { v: 'health_trend', label: 'Health trend', groups: ['month'], measures: ['avg_health'] },
  { v: 'nps', label: 'NPS', groups: ['bucket', 'month'], measures: ['count', 'avg'] },
  { v: 'tasks', label: 'Tasks', groups: ['status', 'priority', 'type', 'assignee'], measures: ['count'] },
];
const KINDS: WidgetKind[] = ['metric', 'bar', 'line', 'donut', 'table'];
const PIE_COLORS = ['var(--accent)', 'var(--green)', 'var(--amber)', 'var(--red)', '#7c3aed', '#0891b2'];

export function Dashboards() {
  const { profile, allProfiles } = useSession();
  const { data: companies = [] } = useVisibleCompanies();
  const { data: dashboards = [] } = useDashboards();
  const { createDashboard, updateDashboard } = useDashboardMutations();
  const [activeId, setActiveId] = useState<string | undefined>(undefined);
  const active = dashboards.find((d) => d.id === activeId) ?? dashboards[0];
  const { data: widgets = [] } = useDashboardWidgets(active?.id);
  const [editorOpen, setEditorOpen] = useState(false);

  const visibleIds = useMemo(() => new Set(companies.map((c) => c.id)), [companies]);
  const ownerName = (id: string) => allProfiles.find((p) => p.id === id)?.fullName ?? '—';

  if (dashboards.length === 0) {
    return <EmptyState icon={LayoutDashboard} title="No dashboards yet" hint="Create one from the dataset layer." action={<Button variant="primary" onClick={() => createDashboard.mutate('My dashboard')}><Plus className="h-3.5 w-3.5" /> New dashboard</Button>} />;
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Select value={active?.id} onValueChange={setActiveId}>
          <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
          <SelectContent>{dashboards.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}{d.shared ? ' · shared' : ''}</SelectItem>)}</SelectContent>
        </Select>
        <Button size="sm" variant="outline" onClick={() => createDashboard.mutate('New dashboard')}><Plus className="h-3.5 w-3.5" /> New</Button>
        {active && active.ownerId === profile.id && (
          <label className="flex items-center gap-1.5 text-sm text-muted-foreground"><Share2 className="h-3.5 w-3.5" /> Share with team <Switch checked={active.shared} onCheckedChange={(v) => updateDashboard.mutate({ id: active.id, patch: { shared: v } })} /></label>
        )}
        <Button size="sm" variant="primary" className="ml-auto" onClick={() => setEditorOpen(true)}><Plus className="h-3.5 w-3.5" /> Add widget</Button>
      </div>

      {widgets.length === 0 ? (
        <EmptyState icon={LayoutDashboard} title="Empty dashboard" hint="Add your first widget." action={<Button variant="primary" onClick={() => setEditorOpen(true)}>Add widget</Button>} />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {widgets.map((w) => <WidgetView key={w.id} widget={w} visibleIds={visibleIds} ownerName={ownerName} />)}
        </div>
      )}

      {active && <WidgetEditor open={editorOpen} onOpenChange={setEditorOpen} dashboardId={active.id} visibleIds={visibleIds} ownerName={ownerName} />}
    </div>
  );
}

function WidgetView({ widget, visibleIds, ownerName }: { widget: DashboardWidget; visibleIds: Set<string>; ownerName: (id: string) => string }) {
  const navigate = useNavigate();
  const { removeWidget } = useDashboardMutations();
  const rows = useMemo(() => runDataset({ dataset: widget.dataset, groupBy: widget.groupBy, measure: widget.measure }, visibleIds, ownerName), [widget, visibleIds, ownerName]);
  const span = widget.kind === 'metric' ? 'md:col-span-1' : 'md:col-span-2';
  const drill = (label: string) => { const f = drillFilter(widget.dataset, widget.groupBy, label); if (Object.keys(f).length) navigate(`/portfolio${filterToQuery(f)}`); };

  return (
    <Card className={span}>
      <CardHeader className="py-2">
        <CardTitle className="text-sm">{widget.title}</CardTitle>
        <button onClick={() => removeWidget.mutate(widget.id)} className="text-muted-foreground hover:text-[var(--red)]"><Trash2 className="h-3.5 w-3.5" /></button>
      </CardHeader>
      <CardBody className="py-2">
        {rows.length === 0 ? <div className="py-6 text-center text-sm text-muted-foreground">No data yet — this widget will populate as records land.</div> : <WidgetChart kind={widget.kind} rows={rows} measure={widget.measure} onDrill={drill} />}
      </CardBody>
    </Card>
  );
}

function WidgetChart({ kind, rows, measure, onDrill }: { kind: WidgetKind; rows: DatasetRow[]; measure?: string | null; onDrill: (label: string) => void }) {
  const isCurrency = measure === 'sum_arr';
  const yTick = (v: number) => fmtAxisTick(v, isCurrency);
  if (kind === 'metric') {
    const total = rows.reduce((a, r) => a + r.value, 0);
    return <div className="py-2 text-3xl font-semibold tnum">{fmtNumber(total)}</div>;
  }
  if (kind === 'table') {
    return (
      <table className="w-full text-sm">
        <tbody>{rows.map((r) => <tr key={r.label} className="border-b last:border-0"><td className="py-1"><button className="hover:text-[var(--accent)]" onClick={() => onDrill(r.label)}>{r.label}</button></td><td className="py-1 text-right tnum">{fmtNumber(r.value)}</td></tr>)}</tbody>
      </table>
    );
  }
  return (
    <div className="h-44">
      <ResponsiveContainer width="100%" height="100%">
        {kind === 'line' ? (
          <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 4 }}>
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--text-secondary)' }} minTickGap={16} />
            <YAxis tick={{ fontSize: 10, fill: 'var(--text-secondary)' }} tickFormatter={yTick} width={44} />
            <RTooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v: number) => yTick(v)} />
            <Line type="monotone" dataKey="value" stroke="var(--accent)" strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        ) : kind === 'donut' ? (
          <PieChart>
            <Pie data={rows} dataKey="value" nameKey="label" innerRadius={40} outerRadius={64} onClick={(d: { label: string }) => onDrill(d.label)} cursor="pointer" isAnimationActive={false}>
              {rows.map((r, i) => <Cell key={r.label} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
            </Pie>
            <RTooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v: number) => yTick(v)} />
          </PieChart>
        ) : (
          <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 4 }}>
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--text-secondary)' }} minTickGap={8} />
            <YAxis tick={{ fontSize: 10, fill: 'var(--text-secondary)' }} tickFormatter={yTick} width={44} />
            <RTooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v: number) => yTick(v)} />
            <Bar dataKey="value" fill="var(--accent)" cursor="pointer" onClick={(d: { label: string }) => onDrill(d.label)} isAnimationActive={false} />
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

function WidgetEditor({ open, onOpenChange, dashboardId, visibleIds, ownerName }: { open: boolean; onOpenChange: (o: boolean) => void; dashboardId: string; visibleIds: Set<string>; ownerName: (id: string) => string }) {
  const { addWidget } = useDashboardMutations();
  const [dataset, setDataset] = useState('companies');
  const [groupBy, setGroupBy] = useState('segment');
  const [measure, setMeasure] = useState('count');
  const [kind, setKind] = useState<WidgetKind>('bar');
  const [title, setTitle] = useState('');
  const meta = DATASETS.find((d) => d.v === dataset)!;
  const preview = useMemo(() => runDataset({ dataset, groupBy, measure }, visibleIds, ownerName), [dataset, groupBy, measure, visibleIds, ownerName]);

  const save = () => {
    addWidget.mutate({ dashboardId, kind, dataset, groupBy, measure, title: title || `${meta.label} by ${groupBy}` });
    onOpenChange(false); setTitle('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogTitle className="text-md font-semibold">Add widget</DialogTitle>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Field label="Dataset"><Select value={dataset} onValueChange={(v) => { setDataset(v); const m = DATASETS.find((d) => d.v === v)!; setGroupBy(m.groups[0]); setMeasure(m.measures[0]); }}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{DATASETS.map((d) => <SelectItem key={d.v} value={d.v}>{d.label}</SelectItem>)}</SelectContent></Select></Field>
          <Field label="Chart"><Select value={kind} onValueChange={(v) => setKind(v as WidgetKind)}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{KINDS.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}</SelectContent></Select></Field>
          <Field label="Group by"><Select value={groupBy} onValueChange={setGroupBy}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{meta.groups.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}</SelectContent></Select></Field>
          <Field label="Measure"><Select value={measure} onValueChange={setMeasure}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{meta.measures.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent></Select></Field>
        </div>
        <div className="mt-3"><Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`${meta.label} by ${groupBy}`} /></Field></div>
        <div className="mt-3 rounded-md border p-2">
          <div className="mb-1 text-xs text-muted-foreground">Live preview</div>
          {preview.length ? <WidgetChart kind={kind} rows={preview} measure={measure} onDrill={() => {}} /> : <div className="py-6 text-center text-sm text-muted-foreground">No data for this dataset/measure combination.</div>}
        </div>
        <div className="mt-3 flex justify-end gap-2"><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" onClick={save}>Add widget</Button></div>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><div className="mb-1 text-xs font-medium text-muted-foreground">{label}</div>{children}</div>;
}

import { useMemo, useState } from 'react';
import { PageHeader, PageBody } from '@/components/PageHeader';
import { Card, CardHeader, CardTitle, CardBody, Chip, Button, Switch, Slider, Input, Select, SelectTrigger, SelectValue, SelectContent, SelectItem, Tabs, TabsList, TabsTrigger, TabsContent, EmptyState, DeltaArrow } from '@/components/ui';
import { DataTable } from '@/components/DataTable';
import { useProfiles, useAlertRules, useVisibleCompanies } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { useToast } from '@/components/toast';
import { DEFAULT_HEALTH_WEIGHTS, DEFAULT_HEALTH_THRESHOLDS, HEALTH_DIMENSIONS, SEGMENT_LABELS, type Segment } from '@/lib/segments';
import { Shield, Plug, ChevronDown } from 'lucide-react';
import type { Profile } from '@/lib/types';

export default function AdminPage() {
  const { profile } = useSession();
  if (profile.role !== 'admin') return <div><PageHeader title="Admin" /><PageBody><EmptyState icon={Shield} title="Admin access required" hint="Switch to the admin user (sidebar) to configure the system." /></PageBody></div>;

  return (
    <div>
      <PageHeader title="Admin" subtitle="Configure Compass" />
      <PageBody>
        <Tabs defaultValue="users">
          <TabsList className="mb-4">
            <TabsTrigger value="users">Users & roles</TabsTrigger>
            <TabsTrigger value="health">Health config</TabsTrigger>
            <TabsTrigger value="alerts">Alert rules</TabsTrigger>
            <TabsTrigger value="playbooks">Playbooks</TabsTrigger>
            <TabsTrigger value="integrations">Integrations</TabsTrigger>
            <TabsTrigger value="migration">Migration</TabsTrigger>
          </TabsList>
          <TabsContent value="users"><UsersTab /></TabsContent>
          <TabsContent value="health"><HealthConfigTab /></TabsContent>
          <TabsContent value="alerts"><AlertRulesTab /></TabsContent>
          <TabsContent value="playbooks"><PlaybooksTab /></TabsContent>
          <TabsContent value="integrations"><IntegrationsTab /></TabsContent>
          <TabsContent value="migration"><MigrationTab /></TabsContent>
        </Tabs>
      </PageBody>
    </div>
  );
}

function UsersTab() {
  const { data: profiles = [] } = useProfiles();
  const { toast } = useToast();
  const nameById = new Map(profiles.map((p) => [p.id, p.fullName]));
  return (
    <DataTable
      rows={profiles}
      rowKey={(p) => p.id}
      columns={[
        { key: 'name', header: 'Name', render: (p) => <span className="font-medium">{p.fullName}</span> },
        { key: 'email', header: 'Email', render: (p) => <span className="text-muted-foreground">{p.email}</span> },
        { key: 'role', header: 'Role', width: '16%', render: (p) => (
          <Select defaultValue={p.role} onValueChange={() => toast('Role updated')}>
            <SelectTrigger className="h-7 w-28"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="csm">CSM</SelectItem><SelectItem value="manager">Manager</SelectItem><SelectItem value="admin">Admin</SelectItem></SelectContent>
          </Select>
        ) },
        { key: 'segment', header: 'Segment', width: '16%', render: (p) => (
          <Select defaultValue={p.segment ?? 'none'} onValueChange={() => toast('Segment updated')}>
            <SelectTrigger className="h-7 w-32"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="none">—</SelectItem><SelectItem value="scaled">Scaled</SelectItem><SelectItem value="mid_touch">Mid-touch</SelectItem><SelectItem value="enterprise">Enterprise</SelectItem></SelectContent>
          </Select>
        ) },
        { key: 'manager', header: 'Manager', width: '16%', render: (p) => <span className="text-muted-foreground">{p.managerId ? nameById.get(p.managerId) : '—'}</span> },
        { key: 'active', header: 'Active', width: '8%', render: (p) => <Chip tone={p.isActive ? 'green' : 'neutral'}>{p.isActive ? 'yes' : 'no'}</Chip> },
      ]}
    />
  );
}

function HealthConfigTab() {
  const [segment, setSegment] = useState<Segment>('enterprise');
  const [weights, setWeights] = useState<Record<string, number>>({ ...DEFAULT_HEALTH_WEIGHTS.enterprise });
  const [thresholds, setThresholds] = useState(DEFAULT_HEALTH_THRESHOLDS);
  const [preview, setPreview] = useState<{ name: string; before: number; after: number }[] | null>(null);
  const { data: companies = [] } = useVisibleCompanies();
  const { toast } = useToast();

  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  const valid = total === 100;

  const onSegChange = (s: Segment) => { setSegment(s); setWeights({ ...DEFAULT_HEALTH_WEIGHTS[s] }); setPreview(null); };
  const setW = (k: string, v: number) => { setWeights((w) => ({ ...w, [k]: v })); setPreview(null); };

  const computePreview = () => {
    // Approx re-projection: keep each account's current score but nudge by the
    // weight delta vs its segment default (demo-grade projection).
    const base = DEFAULT_HEALTH_WEIGHTS[segment];
    const drift = HEALTH_DIMENSIONS.reduce((a, d) => a + (weights[d.key] - base[d.key]), 0);
    const rows = companies.filter((c) => c.segment === segment && c.healthScore != null)
      .map((c) => { const before = c.healthScore!; const after = Math.max(0, Math.min(100, Math.round(before + drift * 0.15 + (c.id.charCodeAt(3) % 7) - 3))); return { name: c.name, before, after }; })
      .sort((a, b) => Math.abs(b.after - b.before) - Math.abs(a.after - a.before)).slice(0, 10);
    setPreview(rows);
    toast('Recomputed — preview of 10 most-affected accounts below');
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>Weights — {SEGMENT_LABELS[segment]}</CardTitle>
          <Select value={segment} onValueChange={(v) => onSegChange(v as Segment)}>
            <SelectTrigger className="h-7 w-32"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="scaled">Scaled</SelectItem><SelectItem value="mid_touch">Mid-touch</SelectItem><SelectItem value="enterprise">Enterprise</SelectItem></SelectContent>
          </Select>
        </CardHeader>
        <CardBody className="space-y-3">
          {HEALTH_DIMENSIONS.map((d) => (
            <div key={d.key}>
              <div className="mb-1 flex justify-between text-sm"><span>{d.label}</span><span className="tnum font-medium">{weights[d.key]}%</span></div>
              <Slider value={[weights[d.key]]} min={0} max={60} step={5} onValueChange={([v]) => setW(d.key, v)} />
            </div>
          ))}
          <div className={`flex items-center justify-between border-t pt-2 text-sm font-medium ${valid ? '' : 'text-[var(--red)]'}`}>
            <span>Total</span><span className="tnum">{total}% {valid ? '✓' : '(must equal 100)'}</span>
          </div>
          <div className="flex items-center gap-3 border-t pt-2 text-sm">
            <span className="text-muted-foreground">Thresholds</span>
            <label className="flex items-center gap-1">red &lt; <Input className="h-7 w-14 text-right" value={thresholds.red} onChange={(e) => setThresholds((t) => ({ ...t, red: Number(e.target.value) || 0 }))} /></label>
            <label className="flex items-center gap-1">amber &lt; <Input className="h-7 w-14 text-right" value={thresholds.amber} onChange={(e) => setThresholds((t) => ({ ...t, amber: Number(e.target.value) || 0 }))} /></label>
          </div>
          <div className="border-t pt-2">
            <div className="mb-1 text-sm font-medium">Usage metric mapping</div>
            <div className="grid grid-cols-1 gap-1.5 text-sm">
              <LabeledInput label="WAU metric" def="weekly_active_users" />
              <LabeledInput label="Seats metric" def="licensed_seats" />
              <LabeledInput label="Adoption metrics" def="feature_x_users" />
            </div>
          </div>
          <Button variant="primary" disabled={!valid} onClick={computePreview}>Save & recompute</Button>
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>Preview diff — 10 most-affected</CardTitle></CardHeader>
        <CardBody>
          {preview ? (
            <div className="space-y-1">
              {preview.map((r) => (
                <div key={r.name} className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-panel">
                  <span className="truncate font-medium">{r.name}</span>
                  <span className="flex items-center gap-2 text-sm tnum"><span className="text-muted-foreground">{r.before}</span> → <span>{r.after}</span> <DeltaArrow delta={r.after - r.before} /></span>
                </div>
              ))}
            </div>
          ) : <EmptyState title="No preview yet" hint="Adjust weights and click Save & recompute." />}
        </CardBody>
      </Card>
    </div>
  );
}

function LabeledInput({ label, def }: { label: string; def: string }) {
  return <label className="flex items-center justify-between gap-2"><span className="text-muted-foreground">{label}</span><Input className="h-7 w-44" defaultValue={def} /></label>;
}

function AlertRulesTab() {
  const { data: rules = [] } = useAlertRules();
  const { toast } = useToast();
  return (
    <DataTable
      rows={rules}
      rowKey={(r) => r.id}
      columns={[
        { key: 'name', header: 'Rule', render: (r) => <span className="font-medium">{r.name}</span> },
        { key: 'desc', header: 'Description', render: (r) => <span className="text-muted-foreground">{r.description}</span> },
        { key: 'sev', header: 'Severity', width: '12%', render: (r) => <Chip tone={r.severity === 'critical' ? 'red' : r.severity === 'warning' ? 'amber' : 'neutral'}>{r.severity}</Chip> },
        { key: 'seg', header: 'Segments', width: '18%', render: (r) => <span className="text-muted-foreground">{r.segment.length === 3 ? 'all' : r.segment.join(', ')}</span> },
        { key: 'enabled', header: 'Enabled', width: '10%', render: (r) => <Switch defaultChecked={r.enabled} onCheckedChange={() => toast('Rule updated')} /> },
      ]}
    />
  );
}

const PLAYBOOKS = [
  { name: 'Onboarding (Scaled)', trigger: 'new_customer', steps: [['Welcome email sequence', 0, 'normal'], ['Activation check @ day 14', 14, 'normal'], ['30-day value review', 30, 'high']] },
  { name: 'Renewal 120-day motion (Mid/Ent)', trigger: 'renewal_t_minus', steps: [['T-120 internal review', 0, 'normal'], ['T-90 exec check-in', 30, 'high'], ['T-60 proposal', 60, 'high'], ['T-30 close plan', 90, 'high']] },
  { name: 'Scaled renewal automation', trigger: 'renewal_t_minus', steps: [['T-60 renewal email 1', 0, 'normal'], ['T-45 reminder', 15, 'normal'], ['T-15 final notice', 45, 'high']] },
  { name: 'Risk turnaround', trigger: 'health_drop', steps: [['Root-cause call', 2, 'high'], ['Exec escalation', 5, 'high'], ['Path-to-green plan', 7, 'high']] },
  { name: 'Enterprise exec-sponsor cadence', trigger: 'manual', steps: [['Quarterly exec sync', 0, 'normal'], ['QBR prep', 80, 'normal'], ['QBR', 90, 'high']] },
];

function PlaybooksTab() {
  const [open, setOpen] = useState<number | null>(0);
  const { toast } = useToast();
  return (
    <div className="space-y-2">
      {PLAYBOOKS.map((pb, i) => (
        <Card key={i}>
          <button className="flex w-full items-center gap-2 px-4 py-3 text-left" onClick={() => setOpen(open === i ? null : i)}>
            <ChevronDown className={`h-4 w-4 transition-transform ${open === i ? 'rotate-180' : ''}`} />
            <span className="font-medium">{pb.name}</span>
            <Chip tone="neutral">{pb.trigger.replace(/_/g, ' ')}</Chip>
            <span className="ml-auto text-sm text-muted-foreground">{pb.steps.length} steps</span>
          </button>
          {open === i && (
            <CardBody className="border-t">
              <div className="space-y-1.5">
                {pb.steps.map((s, n) => (
                  <div key={n} className="flex items-center gap-3 rounded-md border px-3 py-1.5 text-base">
                    <span className="w-5 text-sm text-muted-foreground tnum">{n + 1}</span>
                    <span className="flex-1">{s[0]}</span>
                    <Chip>due +{s[1]}d</Chip>
                    <Chip tone={s[2] === 'high' ? 'red' : 'neutral'}>{s[2]}</Chip>
                  </div>
                ))}
                <Button size="sm" variant="outline" onClick={() => toast('Step added (builder scaffold)')}>+ Add step</Button>
              </div>
            </CardBody>
          )}
        </Card>
      ))}
    </div>
  );
}

const PROVIDERS = [
  { key: 'planhat', label: 'Planhat', status: 'migration only', note: 'One-time historical migration via script' },
  { key: 'hubspot', label: 'HubSpot', status: 'not connected', note: 'Accounts + renewal/expansion deals (poll 15m)' },
  { key: 'google', label: 'Google (Gmail + Calendar)', status: 'per-user', note: 'Connected individually in Settings' },
  { key: 'fathom', label: 'Fathom', status: 'not connected', note: 'Webhook: summaries, action items, AI extraction' },
  { key: 'aircall', label: 'Aircall', status: 'not connected', note: 'Webhook: calls + transcripts' },
  { key: 'outreach', label: 'Outreach', status: 'not connected', note: 'Read-only sequence/email/call activity' },
];

function IntegrationsTab() {
  const { toast } = useToast();
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {PROVIDERS.map((p) => (
          <Card key={p.key}>
            <CardBody className="space-y-2">
              <div className="flex items-center gap-2"><Plug className="h-4 w-4 text-muted-foreground" /><span className="font-medium">{p.label}</span></div>
              <Chip tone={p.status === 'per-user' ? 'accent' : 'neutral'}>{p.status}</Chip>
              <p className="text-sm text-muted-foreground">{p.note}</p>
              {p.key !== 'google' && p.key !== 'planhat' && <Button size="sm" variant="outline" onClick={() => toast(`Would start ${p.label} connect flow`)}>Connect</Button>}
            </CardBody>
          </Card>
        ))}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Card><CardHeader><CardTitle>Unmatched recordings</CardTitle></CardHeader><CardBody><EmptyState title="Queue empty" hint="Fathom/Aircall recordings that can't be matched to a company land here with a link-to-company picker." /></CardBody></Card>
        <Card><CardHeader><CardTitle>Unmatched calls</CardTitle></CardHeader><CardBody><EmptyState title="Queue empty" hint="Aircall calls with no phone match land here to be linked manually." /></CardBody></Card>
      </div>
    </div>
  );
}

function MigrationTab() {
  const recon = [
    ['Companies', 248, 248], ['Contacts', 1163, 1160], ['Activities', 18420, 18420], ['Tasks', 892, 892],
    ['Opportunities → Deals', 214, 214], ['NPS responses', 1044, 1044], ['Objectives → Success plans', 63, 63],
  ];
  const runs = [
    ['migrate:planhat', '2026-07-14 08:12', 'ok', 'created 0, updated 248 companies (idempotent re-run)'],
    ['sync-hubspot', '2026-07-14 08:45', 'ok', '3 deals updated, 1 renewal date synced'],
    ['compute-health', '2026-07-14 02:00', 'ok', '248 companies recomputed, 248 weekly snapshots'],
  ];
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>Reconciliation report</CardTitle></CardHeader>
        <CardBody>
          <p className="mb-2 text-sm text-muted-foreground">Run <code className="rounded bg-panel px-1">npm run migrate:planhat</code>. Re-runs are idempotent (upsert on source_id) — a second run creates zero duplicates.</p>
          <table className="w-full text-base">
            <thead><tr className="border-b text-sm text-muted-foreground"><th className="py-1.5 text-left font-medium">Model</th><th className="py-1.5 text-right font-medium">Planhat</th><th className="py-1.5 text-right font-medium">Compass</th></tr></thead>
            <tbody>{recon.map(([m, a, b]) => <tr key={m as string} className="border-b last:border-0"><td className="py-1.5">{m}</td><td className="py-1.5 text-right tnum">{a}</td><td className="py-1.5 text-right tnum">{b}{a !== b ? <span className="text-[var(--amber)]"> ⚠</span> : ''}</td></tr>)}</tbody>
          </table>
        </CardBody>
      </Card>
      <Card>
        <CardHeader><CardTitle>Recent sync runs</CardTitle></CardHeader>
        <CardBody className="space-y-1.5">
          {runs.map((r, i) => (
            <div key={i} className="rounded-md border px-3 py-2">
              <div className="flex items-center gap-2"><span className="font-medium">{r[0]}</span><Chip tone="green">{r[2]}</Chip><span className="ml-auto text-sm text-muted-foreground">{r[1]}</span></div>
              <div className="text-sm text-muted-foreground">{r[3]}</div>
            </div>
          ))}
        </CardBody>
      </Card>
    </div>
  );
}

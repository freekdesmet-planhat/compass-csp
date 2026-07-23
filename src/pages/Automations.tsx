// Automations — V2 Part B (iteration2.md §8). Templated, sentence-structure
// automations ("When [MODEL] [is created/updated] and matches [FILTER], [ACTIONS]")
// + a starter library. Admin-only (§17). Custom flowchart builder + execution
// engine come next. Trigger filter reuses the shared RuleBuilder / evaluateRules.
import { useState } from 'react';
import { PageHeader, PageBody } from '@/components/PageHeader';
import { Card, CardBody, Button, Chip, EmptyState, Input, Switch, Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui';
import { useSession } from '@/lib/session';
import { useToast } from '@/components/toast';
import { useAutomations, useAutomationSteps, useAutomationMutations } from '@/lib/hooks';
import { RuleBuilder } from '@/components/RuleBuilder';
import { asRuleGroup } from '@/lib/rules';
import { AUTOMATION_STARTERS, type AutomationStarter } from '@/lib/automationStarters';
import { Zap, Plus, Trash2, ChevronDown, Shield, Webhook, Bell, CheckSquare } from 'lucide-react';
import type { Automation, AutomationStep } from '@/lib/types';

const TRIGGER_MODELS = ['company', 'contact', 'deal', 'nps'];
const TRIGGER_TYPES = [
  { value: 'record_created', label: 'is created' },
  { value: 'record_updated', label: 'is updated' },
  { value: 'record_created_or_updated', label: 'is created or updated' },
];
type Mutations = ReturnType<typeof useAutomationMutations>;

export default function AutomationsPage() {
  const { profile } = useSession();
  const { data: automations = [] } = useAutomations();
  const m = useAutomationMutations();
  const { toast } = useToast();
  const [openId, setOpenId] = useState<string | null>(null);

  if (profile.role !== 'admin') {
    return <div><PageHeader title="Automations" /><PageBody><EmptyState icon={Shield} title="Admin access required" hint="Automations (including Execute Function) are admin-only." /></PageBody></div>;
  }

  const createBlank = async () => { const a = await m.createBlank.mutateAsync('Untitled automation'); if (a?.id) setOpenId(a.id); };

  return (
    <div>
      <PageHeader title="Automations" subtitle={`${automations.length} automations · "when X happens, do Y"`}
        actions={<Button variant="primary" onClick={createBlank}><Plus className="h-3.5 w-3.5" /> New automation</Button>} />
      <PageBody>
        {/* Starter library */}
        <div className="mb-5">
          <div className="mb-2 text-sm font-medium text-muted-foreground">Starter library</div>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            {AUTOMATION_STARTERS.map((s) => (
              <Card key={s.key}>
                <CardBody className="flex h-full flex-col gap-2">
                  <div className="flex items-center gap-2"><Zap className="h-4 w-4 text-[var(--accent)]" /><span className="font-medium">{s.name}</span></div>
                  <p className="flex-1 text-sm text-muted-foreground">{s.description}</p>
                  <Button size="sm" variant="outline" onClick={async () => { await m.createFromStarter.mutateAsync(s); toast(`Added "${s.name}" (disabled — review & enable)`); }}><Plus className="h-3.5 w-3.5" /> Add</Button>
                </CardBody>
              </Card>
            ))}
          </div>
        </div>

        <div className="mb-2 text-sm font-medium text-muted-foreground">Your automations</div>
        {automations.length === 0
          ? <EmptyState icon={Zap} title="No automations yet" hint="Add one from the starter library, or create a blank automation." />
          : <div className="space-y-2">{automations.map((a) => <AutomationCard key={a.id} automation={a} open={openId === a.id} onToggle={() => setOpenId(openId === a.id ? null : a.id)} m={m} />)}</div>}
      </PageBody>
    </div>
  );
}

function AutomationCard({ automation: a, open, onToggle, m }: { automation: Automation; open: boolean; onToggle: () => void; m: Mutations }) {
  const { data: steps = [] } = useAutomationSteps(a.id);
  const filter = asRuleGroup(a.triggerFilter);
  const triggerLabel = TRIGGER_TYPES.find((t) => t.value === a.triggerType)?.label ?? 'changes';
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <Switch checked={a.enabled} onCheckedChange={(v: boolean) => m.updateAutomation.mutate({ id: a.id, patch: { enabled: v } })} />
        <button onClick={onToggle} className="flex flex-1 items-center gap-2 text-left">
          <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
          <span className="font-medium">{a.name}</span>
          <span className="truncate text-sm text-muted-foreground">
            When a <b>{a.triggerModel}</b> {triggerLabel}{filter.rules.length ? <> and matches <b>{filter.rules.length}</b> condition{filter.rules.length > 1 ? 's' : ''}</> : ''} → {steps.length} action{steps.length === 1 ? '' : 's'}
          </span>
        </button>
        {!a.enabled && <Chip tone="neutral">disabled</Chip>}
        <button title="Delete" onClick={() => m.deleteAutomation.mutate(a.id)} className="rounded p-1 text-muted-foreground hover:bg-panel hover:text-[var(--red)]"><Trash2 className="h-3.5 w-3.5" /></button>
      </div>
      {open && (
        <CardBody className="space-y-4 border-t">
          <div className="flex flex-wrap items-center gap-2">
            <Input value={a.name} onChange={(e) => m.updateAutomation.mutate({ id: a.id, patch: { name: e.target.value } })} className="h-8 w-64 font-medium" />
          </div>
          {/* WHEN */}
          <div>
            <div className="mb-1.5 flex flex-wrap items-center gap-2 text-sm font-medium">
              When a
              <Select value={a.triggerModel ?? 'company'} onValueChange={(v) => m.updateAutomation.mutate({ id: a.id, patch: { triggerModel: v } })}>
                <SelectTrigger className="h-7 w-28"><SelectValue /></SelectTrigger>
                <SelectContent>{TRIGGER_MODELS.map((x) => <SelectItem key={x} value={x}>{x}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={a.triggerType} onValueChange={(v) => m.updateAutomation.mutate({ id: a.id, patch: { triggerType: v as Automation['triggerType'] } })}>
                <SelectTrigger className="h-7 w-44"><SelectValue /></SelectTrigger>
                <SelectContent>{TRIGGER_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
              and matches:
            </div>
            <div className="rounded-md border bg-panel/40 p-3">
              <RuleBuilder value={a.triggerFilter} onChange={(v) => m.updateAutomation.mutate({ id: a.id, patch: { triggerFilter: v } })} />
            </div>
          </div>
          {/* THEN */}
          <div>
            <div className="mb-1.5 text-sm font-medium">Then do:</div>
            <div className="space-y-2">
              {steps.map((s) => <ActionRow key={s.id} step={s} m={m} />)}
              {steps.length === 0 && <p className="text-xs text-muted-foreground">No actions yet.</p>}
            </div>
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => m.addStep.mutate({ automationId: a.id, kind: 'notify', position: steps.length, config: { mode: 'task', title: 'New task', owner: 'account_owner' } })}><CheckSquare className="h-3.5 w-3.5" /> Task / notify</Button>
              <Button size="sm" variant="ghost" onClick={() => m.addStep.mutate({ automationId: a.id, kind: 'webhook', position: steps.length, config: { url: '', message: '' } })}><Webhook className="h-3.5 w-3.5" /> Webhook</Button>
            </div>
          </div>
        </CardBody>
      )}
    </Card>
  );
}

function ActionRow({ step, m }: { step: AutomationStep; m: Mutations }) {
  const cfg = step.config ?? {};
  const setCfg = (patch: Record<string, unknown>) => m.updateStep.mutate({ id: step.id, patch: { config: { ...cfg, ...patch } } });
  const mode = (cfg.mode as string) ?? 'task';
  return (
    <div className="rounded-md border bg-white p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        {step.kind === 'webhook' ? <Webhook className="h-3.5 w-3.5 text-[var(--accent)]" /> : <Bell className="h-3.5 w-3.5 text-[var(--accent)]" />}
        {step.kind === 'notify' && (
          <Select value={mode} onValueChange={(v) => setCfg({ mode: v })}>
            <SelectTrigger className="h-7 w-40"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="task">Create a task</SelectItem><SelectItem value="in_app">Notify a person</SelectItem></SelectContent>
          </Select>
        )}
        {step.kind === 'webhook' && <span className="text-sm font-medium">Post to webhook</span>}
        <div className="flex-1" />
        <button title="Remove action" onClick={() => m.deleteStep.mutate(step.id)} className="rounded p-1 text-muted-foreground hover:bg-panel hover:text-[var(--red)]"><Trash2 className="h-3.5 w-3.5" /></button>
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {step.kind === 'notify' && mode === 'task' && (
          <>
            <Input value={String(cfg.title ?? '')} onChange={(e) => setCfg({ title: e.target.value })} placeholder="Task title" className="h-8 sm:col-span-2" />
            <Select value={String(cfg.owner ?? 'account_owner')} onValueChange={(v) => setCfg({ owner: v })}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="account_owner">Assign: Account Owner</SelectItem><SelectItem value="manager">Assign: Manager</SelectItem></SelectContent>
            </Select>
          </>
        )}
        {step.kind === 'notify' && mode === 'in_app' && (
          <>
            <Select value={String(cfg.target ?? 'manager')} onValueChange={(v) => setCfg({ target: v })}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="manager">Notify: Manager</SelectItem><SelectItem value="account_owner">Notify: Account Owner</SelectItem></SelectContent>
            </Select>
            <Input value={String(cfg.message ?? '')} onChange={(e) => setCfg({ message: e.target.value })} placeholder="Message" className="h-8" />
          </>
        )}
        {step.kind === 'webhook' && (
          <>
            <Input value={String(cfg.url ?? '')} onChange={(e) => setCfg({ url: e.target.value })} placeholder="Webhook URL (e.g. Slack Incoming Webhook)" className="h-8 sm:col-span-2" />
            <Input value={String(cfg.message ?? '')} onChange={(e) => setCfg({ message: e.target.value })} placeholder="Message ({{company}} interpolated)" className="h-8 sm:col-span-2" />
          </>
        )}
      </div>
    </div>
  );
}

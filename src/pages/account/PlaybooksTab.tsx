// Account 360 → Playbooks tab (iteration2.md §7). Apply a live template to this
// account, then track its instance: grouped steps with % completion, live
// condition/dependency state (re-evaluated on open), mark done/ignore/skip.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardBody, Button, Chip, EmptyState, Progress, Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui';
import { usePlaybookTemplates, usePlaybookGroups, usePlaybookSteps, usePlaybookRuns, usePlaybookRunSteps, usePlaybookRunMutations } from '@/lib/hooks';
import { runCompletion } from '@/lib/playbookRunner';
import { useToast } from '@/components/toast';
import { fmtDate } from '@/lib/utils';
import { Workflow, Check, X, SkipForward, Archive, Layers, Mail, CheckSquare } from 'lucide-react';
import type { Company, PlaybookRun, PlaybookRunStep, RunStepState } from '@/lib/types';

const STATE_CHIP: Record<RunStepState, { tone: 'neutral' | 'green' | 'amber' | 'red' | 'accent'; label: string }> = {
  active: { tone: 'accent', label: 'active' }, muted: { tone: 'neutral', label: 'waiting' }, hidden: { tone: 'neutral', label: 'hidden' },
  done: { tone: 'green', label: 'done' }, ignored: { tone: 'neutral', label: 'ignored' }, skipped: { tone: 'neutral', label: 'skipped' },
};

export function PlaybooksTab({ company }: { company: Company }) {
  const { data: templates = [] } = usePlaybookTemplates();
  const { data: runs = [] } = usePlaybookRuns(company.id);
  const { applyPlaybook } = usePlaybookRunMutations();
  const { toast } = useToast();
  const [pick, setPick] = useState('');
  const { data: pickGroups = [] } = usePlaybookGroups(pick || undefined);
  const { data: pickSteps = [] } = usePlaybookSteps(pick || undefined);
  const live = templates.filter((t) => t.status === 'live');

  const apply = async () => {
    const t = live.find((x) => x.id === pick);
    if (!t) { toast('Pick a playbook first'); return; }
    await applyPlaybook.mutateAsync({ template: t, groups: pickGroups, steps: pickSteps, company });
    setPick('');
    toast(`Applied "${t.name}"`);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardBody className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">Apply a playbook</span>
          <Select value={pick} onValueChange={setPick}>
            <SelectTrigger className="h-8 w-64"><SelectValue placeholder="Choose a live playbook…" /></SelectTrigger>
            <SelectContent>{live.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
          </Select>
          <Button variant="primary" size="sm" disabled={!pick || applyPlaybook.isPending} onClick={apply}>{applyPlaybook.isPending ? 'Applying…' : 'Apply'}</Button>
        </CardBody>
      </Card>

      {runs.length === 0
        ? <EmptyState icon={Workflow} title="No playbooks running" hint="Apply one above to generate its grouped, dated steps and tasks." />
        : runs.map((run) => <RunCard key={run.id} run={run} company={company} />)}
    </div>
  );
}

function RunCard({ run, company }: { run: PlaybookRun; company: Company }) {
  const { data: runSteps = [] } = usePlaybookRunSteps(run.id);
  const { data: tplSteps = [] } = usePlaybookSteps(run.templateId || undefined);
  const { data: tplGroups = [] } = usePlaybookGroups(run.templateId || undefined);
  const { data: templates = [] } = usePlaybookTemplates();
  const { markStep, reevaluate, archiveRun } = usePlaybookRunMutations();
  const tpl = templates.find((t) => t.id === run.templateId);

  // Re-evaluate conditions/dependencies once when data is ready (real time).
  const didReeval = useRef(false);
  useEffect(() => {
    if (didReeval.current || !runSteps.length || !tplSteps.length) return;
    didReeval.current = true;
    reevaluate.mutate({ runSteps, templateSteps: tplSteps, groups: tplGroups, company });
  }, [runSteps, tplSteps, tplGroups, company, reevaluate]);

  const titleFor = (rs: PlaybookRunStep) => tplSteps.find((s) => s.id === rs.templateStepId)?.title ?? 'Step';
  const groupName = (gid: string | null | undefined) => tplGroups.find((g) => g.id === gid)?.name ?? 'Ungrouped';
  const pct = runCompletion(runSteps);

  const byGroup = useMemo(() => {
    const m = new Map<string | null, PlaybookRunStep[]>();
    for (const rs of runSteps) {
      if (rs.activationState === 'hidden') continue; // not yet revealed
      const k = rs.groupId ?? null;
      (m.get(k) ?? m.set(k, []).get(k)!).push(rs);
    }
    return m;
  }, [runSteps]);

  const skip = (rs: PlaybookRunStep) => { const reason = window.prompt('Reason for skipping this step?') ?? undefined; markStep.mutate({ step: rs, state: 'skipped', skipReason: reason }); };

  return (
    <Card>
      <CardBody>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <Workflow className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">{tpl?.name ?? 'Playbook'}</span>
          {tpl && <Chip tone="accent">{tpl.type}</Chip>}
          <div className="flex items-center gap-2"><Progress value={pct} className="w-28" /><span className="text-xs text-muted-foreground tnum">{pct}%</span></div>
          <div className="flex-1" />
          <button title="Archive playbook" onClick={() => archiveRun.mutate(run.id)} className="rounded p-1 text-muted-foreground hover:bg-panel hover:text-[var(--red)]"><Archive className="h-3.5 w-3.5" /></button>
        </div>

        <div className="space-y-3">
          {[...byGroup.entries()].map(([gid, steps]) => (
            <div key={gid ?? 'ungrouped'}>
              <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Layers className="h-3 w-3" /> {groupName(gid)}</div>
              <div className="space-y-1.5">
                {steps.map((rs) => {
                  const chip = STATE_CHIP[rs.activationState];
                  const terminal = rs.activationState === 'done' || rs.activationState === 'ignored' || rs.activationState === 'skipped';
                  const actionable = rs.activationState === 'active' || rs.activationState === 'muted';
                  return (
                    <div key={rs.id} className="flex flex-wrap items-center gap-2 rounded-md border bg-white px-2.5 py-1.5">
                      {rs.stepType === 'email' ? <Mail className="h-3.5 w-3.5 shrink-0 text-[var(--accent)]" /> : <CheckSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                      <span className={`flex-1 text-sm ${terminal || rs.activationState === 'muted' ? 'text-muted-foreground' : ''} ${rs.activationState === 'done' ? 'line-through' : ''}`}>{titleFor(rs)}</span>
                      {rs.dueDate && <span className="text-xs text-muted-foreground">due {fmtDate(rs.dueDate)}</span>}
                      <Chip tone={chip.tone}>{chip.label}</Chip>
                      {rs.skipReason && <span className="text-xs italic text-muted-foreground">“{rs.skipReason}”</span>}
                      {actionable && (
                        <div className="flex items-center gap-1">
                          <button title="Done" onClick={() => markStep.mutate({ step: rs, state: 'done' })} className="rounded p-1 text-muted-foreground hover:bg-panel hover:text-[var(--green)]"><Check className="h-3.5 w-3.5" /></button>
                          <button title="Ignore" onClick={() => markStep.mutate({ step: rs, state: 'ignored' })} className="rounded p-1 text-muted-foreground hover:bg-panel"><X className="h-3.5 w-3.5" /></button>
                          <button title="Skip with reason" onClick={() => skip(rs)} className="rounded p-1 text-muted-foreground hover:bg-panel"><SkipForward className="h-3.5 w-3.5" /></button>
                        </div>
                      )}
                      {terminal && <button onClick={() => markStep.mutate({ step: rs, state: 'active' })} className="rounded px-2 py-0.5 text-xs text-[var(--accent)] hover:bg-panel">Reopen</button>}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}

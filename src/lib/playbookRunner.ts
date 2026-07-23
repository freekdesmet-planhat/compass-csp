// Playbook instance runner (iteration2.md §5, §7). Pure logic: resolves step
// dates (workdays-aware), computes initial activation from conditions, and
// re-evaluates activation in real time against a live record context. DB writes
// live in realStore/hooks; this file is side-effect-free and unit-testable.
import { evaluateRules, asRuleGroup, isEmptyRuleGroup } from './rules';
import type { PlaybookGroup, PlaybookStep, PlaybookRunStep, RunStepState } from './types';

const isWeekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6;

// Add N days to a base date; when workdaysOnly, skip Sat/Sun (day 0 stays put).
export function addDays(base: Date, days: number, workdaysOnly: boolean): Date {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  if (!workdaysOnly) { d.setDate(d.getDate() + days); return d; }
  let remaining = Math.abs(days); const dir = days >= 0 ? 1 : -1;
  while (remaining > 0) { d.setDate(d.getDate() + dir); if (!isWeekend(d)) remaining--; }
  return d;
}
export const toDateStr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export interface PlannedStep {
  templateStepId: string; groupId: string | null; stepType: PlaybookStep['stepType']; position: number;
  title: string; priority: string; ownerRef: PlaybookStep['ownerRef'];
  startDate: string; dueDate: string; activationState: RunStepState;
}

// Initial state for a fresh apply given the current record context.
export function initialActivation(step: PlaybookStep, group: PlaybookGroup | undefined, ctx: Record<string, unknown>): RunStepState {
  if (step.dependsOnStepId) return step.stepConditionDisplay === 'muted' ? 'muted' : 'hidden'; // wait for parent
  if (!isEmptyRuleGroup(step.stepCondition)) {
    return evaluateRules(asRuleGroup(step.stepCondition), ctx) ? 'active' : (step.stepConditionDisplay ?? 'hidden');
  }
  if (group && !isEmptyRuleGroup(group.groupCondition)) {
    return evaluateRules(asRuleGroup(group.groupCondition), ctx) ? 'active' : 'muted';
  }
  return 'active';
}

// Resolve dates + initial activation for every step of a template being applied.
export function planRun(steps: PlaybookStep[], groups: PlaybookGroup[], ctx: Record<string, unknown>, applyDate: Date): PlannedStep[] {
  const gById = new Map(groups.map((g) => [g.id, g]));
  return [...steps].sort((a, b) => a.position - b.position).map((s) => {
    const start = addDays(applyDate, s.startAfterDays ?? 0, s.workdaysOnly ?? true);
    const due = s.durationDays ? addDays(start, s.durationDays, s.workdaysOnly ?? true) : start;
    return {
      templateStepId: s.id, groupId: s.groupId ?? null, stepType: s.stepType, position: s.position,
      title: s.title ?? 'Step', priority: s.priority ?? 'normal', ownerRef: s.ownerRef,
      startDate: toDateStr(start), dueDate: toDateStr(due),
      activationState: initialActivation(s, s.groupId ? gById.get(s.groupId) : undefined, ctx),
    };
  });
}

const TERMINAL: RunStepState[] = ['done', 'ignored', 'skipped'];

// Re-evaluate a live run against the current context. Returns the run steps whose
// activation_state should change (to persist). Semantics (§5):
//  • step conditions only turn a step ON (latch) — never off once met
//  • group conditions turn steps on/off; when unmatched, expire→skipped else muted
//  • dependent steps activate when the parent reaches its dependency_trigger
export function reevaluateRun(
  runSteps: PlaybookRunStep[],
  stepById: Map<string, PlaybookStep>,
  groupById: Map<string, PlaybookGroup>,
  ctx: Record<string, unknown>,
): { id: string; activationState: RunStepState }[] {
  const changes: { id: string; activationState: RunStepState }[] = [];
  const terminalByTemplateStep = new Set(runSteps.filter((r) => r.templateStepId && TERMINAL.includes(r.activationState)).map((r) => r.templateStepId!));
  const stateByTemplateStep = new Map(runSteps.filter((r) => r.templateStepId).map((r) => [r.templateStepId!, r.activationState]));

  for (const rs of runSteps) {
    if (TERMINAL.includes(rs.activationState)) continue;
    const tpl = rs.templateStepId ? stepById.get(rs.templateStepId) : undefined;
    if (!tpl) continue;
    let next: RunStepState = rs.activationState;

    // dependency: activate once parent is done/ignored (overdue handled at runtime elsewhere)
    if (tpl.dependsOnStepId) {
      const parentState = stateByTemplateStep.get(tpl.dependsOnStepId);
      const trig = tpl.dependencyTrigger?.kind ?? 'done';
      const satisfied = trig === 'ignored' ? (parentState === 'ignored') : (parentState === 'done' || parentState === 'ignored');
      next = satisfied ? 'active' : rs.activationState;
    } else if (!isEmptyRuleGroup(tpl.stepCondition)) {
      // step condition latches ON; once active, never reverts
      if (rs.activationState === 'active') next = 'active';
      else next = evaluateRules(asRuleGroup(tpl.stepCondition), ctx) ? 'active' : rs.activationState;
    } else {
      const group = tpl.groupId ? groupById.get(tpl.groupId) : undefined;
      if (group && !isEmptyRuleGroup(group.groupCondition)) {
        const match = evaluateRules(asRuleGroup(group.groupCondition), ctx);
        next = match ? 'active' : (group.expireBehavior === 'expire' ? 'skipped' : 'muted');
      } else {
        next = 'active';
      }
    }
    if (next !== rs.activationState) changes.push({ id: rs.id, activationState: next });
  }
  // keep terminalByTemplateStep referenced (dependency on ignored parents)
  void terminalByTemplateStep;
  return changes;
}

export function runCompletion(runSteps: PlaybookRunStep[]): number {
  const counted = runSteps.filter((s) => s.activationState !== 'hidden' && s.activationState !== 'skipped');
  if (!counted.length) return 0;
  const done = counted.filter((s) => s.activationState === 'done' || s.activationState === 'ignored').length;
  return Math.round((done / counted.length) * 100);
}

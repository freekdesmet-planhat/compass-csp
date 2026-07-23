// Edge-runtime mirror of src/lib/rules.ts + playbookRunner.ts core, operating on
// snake_case DB rows (the auto-apply cron works directly with Supabase rows).
// Keep in sync with the frontend modules.

export interface Rule { field: string; op: string; value?: unknown }
export interface RuleGroup { match: "all" | "any"; rules: Rule[] }

const toArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : typeof v === "string" ? v.split(",").map((s) => s.trim()).filter(Boolean) : v == null ? [] : [v]);

export function evaluateRule(rule: Rule, ctx: Record<string, unknown>): boolean {
  const v = ctx[rule.field];
  switch (rule.op) {
    case "is_empty": return v == null || v === "";
    case "is_not_empty": return !(v == null || v === "");
    case "eq": return String(v) === String(rule.value);
    case "neq": return String(v) !== String(rule.value);
    case "lt": return v != null && Number(v) < Number(rule.value);
    case "lte": return v != null && Number(v) <= Number(rule.value);
    case "gt": return v != null && Number(v) > Number(rule.value);
    case "gte": return v != null && Number(v) >= Number(rule.value);
    case "contains": return String(v ?? "").toLowerCase().includes(String(rule.value ?? "").toLowerCase());
    case "in": return toArr(rule.value).map(String).includes(String(v));
    case "not_in": return !toArr(rule.value).map(String).includes(String(v));
    default: return false;
  }
}
export function isEmptyRuleGroup(g: unknown): boolean {
  const rg = g as RuleGroup | null;
  return !rg || !Array.isArray(rg.rules) || rg.rules.length === 0;
}
export function evaluateRules(g: unknown, ctx: Record<string, unknown>): boolean {
  const rg = g as RuleGroup | null;
  if (isEmptyRuleGroup(rg)) return true;
  const results = rg!.rules.map((r) => evaluateRule(r, ctx));
  return rg!.match === "any" ? results.some(Boolean) : results.every(Boolean);
}

const isWeekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6;
export function addDays(base: Date, days: number, workdaysOnly: boolean): Date {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  if (!workdaysOnly) { d.setDate(d.getDate() + days); return d; }
  let remaining = Math.abs(days); const dir = days >= 0 ? 1 : -1;
  while (remaining > 0) { d.setDate(d.getDate() + dir); if (!isWeekend(d)) remaining--; }
  return d;
}
export const toDateStr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Build an evaluation context from a company DB row (snake_case).
export function companyContext(c: Record<string, any>): Record<string, unknown> {
  const daysUntil = c.renewal_date ? Math.round((+new Date(c.renewal_date) - Date.now()) / 86_400_000) : null;
  return {
    health_score: c.health_score ?? null, health_band: c.health_band ?? null, segment: c.segment ?? null,
    arr: c.arr ?? null, phase: c.phase ?? null, status: c.status ?? null, renewal_date_days_until: daysUntil,
    nps_score: null, usage_metric_30d: null, sentiment_trend_30d: null,
  };
}

// Initial activation for a fresh step (DB rows). group may be undefined.
export function initialActivation(step: Record<string, any>, group: Record<string, any> | undefined, ctx: Record<string, unknown>): string {
  if (step.depends_on_step_id) return step.step_condition_display === "muted" ? "muted" : "hidden";
  if (!isEmptyRuleGroup(step.step_condition)) return evaluateRules(step.step_condition, ctx) ? "active" : (step.step_condition_display ?? "hidden");
  if (group && !isEmptyRuleGroup(group.group_condition)) return evaluateRules(group.group_condition, ctx) ? "active" : "muted";
  return "active";
}

const TERMINAL = ["done", "ignored", "skipped"];
// Re-evaluate a live run's steps against ctx → [{id, activation_state}] to persist.
export function reevaluate(
  runSteps: Record<string, any>[],
  stepById: Map<string, Record<string, any>>,
  groupById: Map<string, Record<string, any>>,
  ctx: Record<string, unknown>,
): { id: string; activation_state: string }[] {
  const stateByTemplateStep = new Map<string, string>();
  for (const r of runSteps) if (r.template_step_id) stateByTemplateStep.set(r.template_step_id, r.activation_state);
  const changes: { id: string; activation_state: string }[] = [];
  for (const rs of runSteps) {
    if (TERMINAL.includes(rs.activation_state)) continue;
    const tpl = rs.template_step_id ? stepById.get(rs.template_step_id) : undefined;
    if (!tpl) continue;
    let next = rs.activation_state as string;
    if (tpl.depends_on_step_id) {
      const parent = stateByTemplateStep.get(tpl.depends_on_step_id);
      const trig = tpl.dependency_trigger?.kind ?? "done";
      const satisfied = trig === "ignored" ? parent === "ignored" : (parent === "done" || parent === "ignored");
      next = satisfied ? "active" : rs.activation_state;
    } else if (!isEmptyRuleGroup(tpl.step_condition)) {
      next = rs.activation_state === "active" ? "active" : (evaluateRules(tpl.step_condition, ctx) ? "active" : rs.activation_state);
    } else {
      const group = tpl.group_id ? groupById.get(tpl.group_id) : undefined;
      if (group && !isEmptyRuleGroup(group.group_condition)) {
        next = evaluateRules(group.group_condition, ctx) ? "active" : (group.expire_behavior === "expire" ? "skipped" : "muted");
      } else next = "active";
    }
    if (next !== rs.activation_state) changes.push({ id: rs.id, activation_state: next });
  }
  return changes;
}

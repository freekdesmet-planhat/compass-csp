// Shared condition rule engine (iteration2.md §5). One `{match, rules[]}` tree
// format powers all four condition slots (entry/exit criteria, group conditions,
// step conditions) AND — later — Automation triggers. Deliberate deviation from
// Planhat: the inline builder supports match:"any" (OR), not AND-only (§5, §20).
import type { Segment } from './segments';

export type RuleOp = 'eq' | 'neq' | 'lt' | 'lte' | 'gt' | 'gte' | 'contains' | 'in' | 'not_in' | 'is_empty' | 'is_not_empty';
export interface Rule { field: string; op: RuleOp; value?: unknown }
export interface RuleGroup { match: 'all' | 'any'; rules: Rule[] }

export type FieldType = 'number' | 'text' | 'enum' | 'date_days';
export interface FieldDef { key: string; label: string; type: FieldType; options?: { value: string; label: string }[] }

// Selectable fields — plain record props + computed metrics (§5). sentiment_trend_30d
// is wired here now though the Sentiment pipeline (Part D) lands later.
export const RULE_FIELDS: FieldDef[] = [
  { key: 'health_score', label: 'Health score', type: 'number' },
  { key: 'health_band', label: 'Health band', type: 'enum', options: [{ value: 'red', label: 'Red' }, { value: 'amber', label: 'Amber' }, { value: 'green', label: 'Green' }] },
  { key: 'segment', label: 'Segment', type: 'enum', options: [{ value: 'scaled', label: 'Scaled' }, { value: 'mid_touch', label: 'Mid-touch' }, { value: 'enterprise', label: 'Enterprise' }] },
  { key: 'arr', label: 'ARR', type: 'number' },
  { key: 'renewal_date_days_until', label: 'Days until renewal', type: 'date_days' },
  { key: 'usage_metric_30d', label: 'Usage metric (30d)', type: 'number' },
  { key: 'nps_score', label: 'NPS score', type: 'number' },
  { key: 'sentiment_trend_30d', label: 'Sentiment trend (30d)', type: 'number' },
  { key: 'phase', label: 'Phase', type: 'text' },
  { key: 'status', label: 'Status', type: 'text' },
];
export const fieldDef = (key: string): FieldDef | undefined => RULE_FIELDS.find((f) => f.key === key);

export const OPS_BY_TYPE: Record<FieldType, RuleOp[]> = {
  number: ['lt', 'lte', 'gt', 'gte', 'eq', 'neq'],
  date_days: ['lt', 'lte', 'gt', 'gte', 'eq', 'neq'],
  enum: ['eq', 'neq', 'in', 'not_in'],
  text: ['eq', 'neq', 'contains', 'is_empty', 'is_not_empty'],
};
export const OP_LABELS: Record<RuleOp, string> = {
  eq: 'is', neq: 'is not', lt: 'less than', lte: '≤', gt: 'greater than', gte: '≥',
  contains: 'contains', in: 'is any of', not_in: 'is none of', is_empty: 'is empty', is_not_empty: 'is not empty',
};

const toArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : v == null ? [] : [v]);

export function evaluateRule(rule: Rule, ctx: Record<string, unknown>): boolean {
  const v = ctx[rule.field];
  switch (rule.op) {
    case 'is_empty': return v == null || v === '';
    case 'is_not_empty': return !(v == null || v === '');
    case 'eq': return String(v) === String(rule.value);
    case 'neq': return String(v) !== String(rule.value);
    case 'lt': return v != null && Number(v) < Number(rule.value);
    case 'lte': return v != null && Number(v) <= Number(rule.value);
    case 'gt': return v != null && Number(v) > Number(rule.value);
    case 'gte': return v != null && Number(v) >= Number(rule.value);
    case 'contains': return String(v ?? '').toLowerCase().includes(String(rule.value ?? '').toLowerCase());
    case 'in': return toArr(rule.value).map(String).includes(String(v));
    case 'not_in': return !toArr(rule.value).map(String).includes(String(v));
    default: return false;
  }
}

// Empty rule set = no condition = always matches (so an unconditioned playbook/
// group/step is simply "on").
export function evaluateRules(group: RuleGroup | null | undefined, ctx: Record<string, unknown>): boolean {
  if (!group || !Array.isArray(group.rules) || group.rules.length === 0) return true;
  const results = group.rules.map((r) => evaluateRule(r, ctx));
  return group.match === 'any' ? results.some(Boolean) : results.every(Boolean);
}

export const isEmptyRuleGroup = (g: unknown): boolean => {
  const rg = g as RuleGroup | null;
  return !rg || !Array.isArray(rg.rules) || rg.rules.length === 0;
};
export const asRuleGroup = (g: unknown): RuleGroup => {
  const rg = g as RuleGroup | null;
  return rg && Array.isArray(rg.rules) ? { match: rg.match === 'any' ? 'any' : 'all', rules: rg.rules } : { match: 'all', rules: [] };
};

// Build an evaluation context from a company (+ optional computed metrics the
// caller can supply, e.g. usage_metric_30d, nps_score, sentiment_trend_30d).
export function companyRuleContext(c: {
  healthScore?: number | null; healthBand?: string | null; segment?: Segment | null;
  arr?: number | null; phase?: string | null; status?: string | null; renewalDate?: string | null;
}, extra?: Record<string, unknown>): Record<string, unknown> {
  const daysUntil = c.renewalDate ? Math.round((+new Date(c.renewalDate) - Date.now()) / 86_400_000) : null;
  return {
    health_score: c.healthScore ?? null, health_band: c.healthBand ?? null, segment: c.segment ?? null,
    arr: c.arr ?? null, phase: c.phase ?? null, status: c.status ?? null, renewal_date_days_until: daysUntil,
    ...extra,
  };
}

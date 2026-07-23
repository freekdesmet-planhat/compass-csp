// Reusable condition rule-builder (iteration2.md §5). Edits a {match, rules[]}
// tree; used by entry/exit criteria, group conditions and step conditions.
// Supports match:"all" (AND) and match:"any" (OR) — deliberate deviation (§20).
import { Button, Select, SelectTrigger, SelectValue, SelectContent, SelectItem, Input } from '@/components/ui';
import { Plus, X } from 'lucide-react';
import { RULE_FIELDS, OPS_BY_TYPE, OP_LABELS, fieldDef, asRuleGroup, type RuleGroup, type RuleOp } from '@/lib/rules';

export function RuleBuilder({ value, onChange, disabled }: { value: unknown; onChange: (v: RuleGroup) => void; disabled?: boolean }) {
  const group = asRuleGroup(value);
  const updateRule = (i: number, patch: Record<string, unknown>) => onChange({ ...group, rules: group.rules.map((r, n) => (n === i ? { ...r, ...patch } : r)) });
  const addRule = () => { const f = RULE_FIELDS[0]; onChange({ ...group, rules: [...group.rules, { field: f.key, op: OPS_BY_TYPE[f.type][0], value: '' }] }); };
  const removeRule = (i: number) => onChange({ ...group, rules: group.rules.filter((_, n) => n !== i) });

  return (
    <div className="space-y-2">
      {group.rules.length > 1 && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          Match
          <Select value={group.match} onValueChange={(v) => onChange({ ...group, match: v as 'all' | 'any' })} disabled={disabled}>
            <SelectTrigger className="h-7 w-28"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">all (AND)</SelectItem><SelectItem value="any">any (OR)</SelectItem></SelectContent>
          </Select>
          of these:
        </div>
      )}
      {group.rules.map((r, i) => {
        const fd = fieldDef(r.field) ?? RULE_FIELDS[0];
        const ops = OPS_BY_TYPE[fd.type];
        const needsValue = r.op !== 'is_empty' && r.op !== 'is_not_empty';
        const numeric = fd.type === 'number' || fd.type === 'date_days';
        return (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <Select value={r.field} onValueChange={(v) => { const nf = fieldDef(v)!; updateRule(i, { field: v, op: OPS_BY_TYPE[nf.type].includes(r.op) ? r.op : OPS_BY_TYPE[nf.type][0], value: '' }); }} disabled={disabled}>
              <SelectTrigger className="h-8 w-44"><SelectValue /></SelectTrigger>
              <SelectContent>{RULE_FIELDS.map((f) => <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={r.op} onValueChange={(v) => updateRule(i, { op: v as RuleOp })} disabled={disabled}>
              <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
              <SelectContent>{ops.map((o) => <SelectItem key={o} value={o}>{OP_LABELS[o]}</SelectItem>)}</SelectContent>
            </Select>
            {needsValue && (fd.type === 'enum'
              ? (
                <Select value={String(r.value ?? '')} onValueChange={(v) => updateRule(i, { value: v })} disabled={disabled}>
                  <SelectTrigger className="h-8 w-36"><SelectValue placeholder="value" /></SelectTrigger>
                  <SelectContent>{fd.options!.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                </Select>
              ) : (
                <Input value={String(r.value ?? '')} type={numeric ? 'number' : 'text'} placeholder="value" disabled={disabled} className="h-8 w-36"
                  onChange={(e) => updateRule(i, { value: numeric ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value })} />
              ))}
            {!disabled && <button onClick={() => removeRule(i)} className="rounded p-1 text-muted-foreground hover:bg-panel hover:text-[var(--red)]"><X className="h-3.5 w-3.5" /></button>}
          </div>
        );
      })}
      {group.rules.length === 0 && <p className="text-xs text-muted-foreground">No conditions — always applies.</p>}
      {!disabled && <Button size="sm" variant="ghost" onClick={addRule}><Plus className="h-3.5 w-3.5" /> Add condition</Button>}
    </div>
  );
}

import { useMemo, useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PageHeader, PageBody } from '@/components/PageHeader';
import {
  Chip, Avatar, Input, Button, Select, SelectTrigger, SelectValue, SelectContent, SelectItem, EmptyState,
} from '@/components/ui';
import { useContacts, useVisibleCompanies, useUpdateContact } from '@/lib/hooks';
import { useToast } from '@/components/toast';
import { relativeTime, daysUntil } from '@/lib/utils';
import { Users, Star, Zap, Search, Plus, X, Download, Upload, ChevronRight, ChevronDown, Save } from 'lucide-react';
import type { Contact, ContactRole, Company } from '@/lib/types';

const ROLE_LABEL: Record<string, string> = { exec_sponsor: 'Exec Sponsor', decision_maker: 'Decision Maker', main_user: 'Main User', tech_ops: 'Tech / Ops', end_user: 'End User' };

type FieldType = 'text' | 'number' | 'days' | 'bool';
const FIELDS: { key: string; label: string; type: FieldType }[] = [
  { key: 'name', label: 'Name', type: 'text' },
  { key: 'company', label: 'Company', type: 'text' },
  { key: 'contactRole', label: 'Role', type: 'text' },
  { key: 'relationshipStrength', label: 'Relationship', type: 'number' },
  { key: 'department', label: 'Department', type: 'text' },
  { key: 'seniority', label: 'Seniority', type: 'text' },
  { key: 'title', label: 'Title', type: 'text' },
  { key: 'npsLatest', label: 'Latest NPS', type: 'number' },
  { key: 'lastTouch', label: 'Last touch (days ago)', type: 'days' },
  { key: 'engagementScore', label: 'Engagement', type: 'number' },
  { key: 'segment', label: 'Segment', type: 'text' },
  { key: 'isChampion', label: 'Champion', type: 'bool' },
  { key: 'hasInfluence', label: 'Influence', type: 'bool' },
  { key: 'isAdvocate', label: 'Advocate', type: 'bool' },
];
const OPS: Record<FieldType, { v: string; label: string }[]> = {
  text: [{ v: 'contains', label: 'contains' }, { v: 'equals', label: 'is' }],
  number: [{ v: 'gte', label: '≥' }, { v: 'lte', label: '≤' }, { v: 'eq', label: '=' }],
  days: [{ v: 'lte', label: 'within' }, { v: 'gte', label: 'older than' }],
  bool: [{ v: 'true', label: 'is yes' }, { v: 'false', label: 'is no' }],
};
interface Condition { field: string; op: string; value: string }
const VIEWS_KEY = 'compass-contact-views';

export default function ContactsPage() {
  const navigate = useNavigate();
  const { data: companies = [] } = useVisibleCompanies();
  const { data: allContacts = [] } = useContacts();
  const updateContact = useUpdateContact();
  const { toast } = useToast();

  const [q, setQ] = useState('');
  const [conditions, setConditions] = useState<Condition[]>([]);
  const [groupBy, setGroupBy] = useState<'none' | 'company' | 'contactRole' | 'department' | 'segment'>('none');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [views, setViews] = useState<{ name: string; conditions: Condition[]; groupBy: string }[]>([]);

  useEffect(() => {
    try { const raw = localStorage.getItem(VIEWS_KEY); if (raw) setViews(JSON.parse(raw)); } catch { /* ignore */ }
  }, []);
  const persistViews = (v: typeof views) => { setViews(v); try { localStorage.setItem(VIEWS_KEY, JSON.stringify(v)); } catch { /* ignore */ } };

  const visibleIds = useMemo(() => new Set(companies.map((c) => c.id)), [companies]);
  const companyById = useMemo(() => new Map<string, Company>(companies.map((c) => [c.id, c])), [companies]);

  const fieldVal = (c: Contact, field: string): string | number | boolean | null => {
    switch (field) {
      case 'name': return `${c.firstName} ${c.lastName}`;
      case 'company': return companyById.get(c.companyId)?.name ?? '';
      case 'segment': return companyById.get(c.companyId)?.segment ?? '';
      case 'lastTouch': return c.lastTouchAt ? Math.abs(daysUntil(c.lastTouchAt) ?? 0) : 99999;
      default: return (c as unknown as Record<string, string | number | boolean | null>)[field] ?? null;
    }
  };
  const matches = (c: Contact, cond: Condition): boolean => {
    const raw = fieldVal(c, cond.field);
    const meta = FIELDS.find((f) => f.key === cond.field);
    if (!meta) return true;
    if (meta.type === 'bool') return Boolean(raw) === (cond.op === 'true');
    if (meta.type === 'number' || meta.type === 'days') {
      const n = Number(raw ?? 0), v = Number(cond.value);
      if (Number.isNaN(v)) return true;
      return cond.op === 'gte' ? n >= v : cond.op === 'lte' ? n <= v : n === v;
    }
    const s = String(raw ?? '').toLowerCase(), v = cond.value.toLowerCase();
    return cond.op === 'equals' ? s === v : s.includes(v);
  };

  const rows = useMemo(() => allContacts.filter((c) => {
    if (c.archived || !visibleIds.has(c.companyId)) return false;
    if (q && !`${c.firstName} ${c.lastName} ${c.email ?? ''}`.toLowerCase().includes(q.toLowerCase())) return false;
    return conditions.every((cond) => matches(c, cond));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [allContacts, visibleIds, q, conditions, companyById]);

  const groups = useMemo(() => {
    if (groupBy === 'none') return [{ key: '', label: '', rows }];
    const map = new Map<string, Contact[]>();
    for (const c of rows) {
      let k = '';
      if (groupBy === 'company') k = companyById.get(c.companyId)?.name ?? '—';
      else if (groupBy === 'segment') k = companyById.get(c.companyId)?.segment ?? '—';
      else k = (c[groupBy] as string) ?? '—';
      (map.get(k) ?? map.set(k, []).get(k)!).push(c);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([key, rs]) => ({ key, label: groupBy === 'contactRole' ? (ROLE_LABEL[key] ?? key) : key, rows: rs }));
  }, [rows, groupBy, companyById]);

  const toggleSel = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const exportCsv = () => {
    const chosen = rows.filter((c) => selected.size === 0 || selected.has(c.id));
    const header = ['Name', 'Company', 'Role', 'Relationship', 'Department', 'Seniority', 'Title', 'Latest NPS', 'Engagement', 'Segment'];
    const lines = chosen.map((c) => [`${c.firstName} ${c.lastName}`, companyById.get(c.companyId)?.name ?? '', c.contactRole ?? '', c.relationshipStrength ?? '', c.department ?? '', c.seniority ?? '', c.title ?? '', c.npsLatest ?? '', c.engagementScore ?? '', companyById.get(c.companyId)?.segment ?? ''].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','));
    const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'contacts.csv'; a.click();
    toast(`Exported ${chosen.length} contacts`);
  };
  const bulkRole = (role: string) => { selected.forEach((id) => updateContact.mutate({ id, patch: { contactRole: role as ContactRole } })); toast(`Set role on ${selected.size} contacts`); setSelected(new Set()); };
  const saveView = () => { const name = prompt('Save view as:'); if (name) persistViews([...views.filter((v) => v.name !== name), { name, conditions, groupBy }]); };
  const loadView = (name: string) => { const v = views.find((x) => x.name === name); if (v) { setConditions(v.conditions); setGroupBy(v.groupBy as typeof groupBy); } };

  return (
    <div>
      <PageHeader
        title="Contacts"
        subtitle={`${rows.length} stakeholders across ${visibleIds.size} accounts`}
        actions={
          <div className="flex items-center gap-2">
            <div className="relative"><Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" /><Input className="w-52 pl-7" placeholder="Search contacts…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
            {views.length > 0 && (
              <Select value="" onValueChange={loadView}>
                <SelectTrigger className="w-32"><SelectValue placeholder="Saved views" /></SelectTrigger>
                <SelectContent>{views.map((v) => <SelectItem key={v.name} value={v.name}>{v.name}</SelectItem>)}</SelectContent>
              </Select>
            )}
            <Select value={groupBy} onValueChange={(v) => setGroupBy(v as typeof groupBy)}>
              <SelectTrigger className="w-36"><SelectValue placeholder="Group by" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No grouping</SelectItem>
                <SelectItem value="company">Company</SelectItem>
                <SelectItem value="contactRole">Role</SelectItem>
                <SelectItem value="department">Department</SelectItem>
                <SelectItem value="segment">Segment</SelectItem>
              </SelectContent>
            </Select>
          </div>
        }
      />
      <PageBody>
        {/* Filter builder */}
        <div className="mb-3 rounded-lg border bg-white p-2">
          <div className="flex flex-wrap items-center gap-2">
            {conditions.map((cond, i) => (
              <ConditionRow key={i} cond={cond} onChange={(c) => setConditions((cs) => cs.map((x, j) => j === i ? c : x))} onRemove={() => setConditions((cs) => cs.filter((_, j) => j !== i))} companies={companies} />
            ))}
            <Button size="sm" variant="outline" onClick={() => setConditions((cs) => [...cs, { field: 'contactRole', op: 'equals', value: '' }])}><Plus className="h-3.5 w-3.5" /> Add condition</Button>
            {conditions.length > 0 && <Button size="sm" variant="ghost" onClick={() => setConditions([])}>Clear</Button>}
            <div className="ml-auto flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={saveView}><Save className="h-3.5 w-3.5" /> Save view</Button>
              <Button size="sm" variant="outline" onClick={exportCsv}><Download className="h-3.5 w-3.5" /> Export CSV</Button>
              <Button size="sm" variant="outline" onClick={() => navigate('/import')}><Upload className="h-3.5 w-3.5" /> Import</Button>
            </div>
          </div>
        </div>

        {/* Bulk-action bar */}
        {selected.size > 0 && (
          <div className="mb-3 flex items-center gap-3 rounded-lg border bg-[var(--accent-tint)]/40 px-3 py-2">
            <span className="text-sm font-medium">{selected.size} selected</span>
            <Select value="" onValueChange={bulkRole}>
              <SelectTrigger className="h-7 w-40"><SelectValue placeholder="Set role…" /></SelectTrigger>
              <SelectContent>{Object.entries(ROLE_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
            </Select>
            <Button size="sm" variant="outline" onClick={exportCsv}><Download className="h-3.5 w-3.5" /> Export selected</Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear selection</Button>
          </div>
        )}

        {rows.length === 0 ? <EmptyState icon={Users} title="No contacts match" /> : (
          <div className="overflow-x-auto rounded-lg border bg-white">
            <table className="w-full border-collapse text-base">
              <thead><tr className="border-b bg-panel/60 text-sm text-muted-foreground">
                <th className="w-8 px-2 py-2"></th>
                <th className="px-3 py-2 text-left font-medium">Name</th>
                <th className="px-3 py-2 text-left font-medium">Company</th>
                <th className="px-3 py-2 text-left font-medium">Role</th>
                <th className="px-3 py-2 text-right font-medium">Rel.</th>
                <th className="px-3 py-2 text-left font-medium">Dept</th>
                <th className="px-3 py-2 text-right font-medium">NPS</th>
                <th className="px-3 py-2 text-left font-medium">Flags</th>
                <th className="px-3 py-2 text-right font-medium">Last touch</th>
              </tr></thead>
              <tbody>
                {groups.map((g) => (
                  <GroupBlock key={g.key || 'all'} label={g.label} rows={g.rows} grouped={groupBy !== 'none'}
                    collapsed={collapsed.has(g.key)} onToggle={() => setCollapsed((s) => { const n = new Set(s); n.has(g.key) ? n.delete(g.key) : n.add(g.key); return n; })}
                    companyById={companyById} selected={selected} toggleSel={toggleSel} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PageBody>
    </div>
  );
}

function ConditionRow({ cond, onChange, onRemove, companies }: { cond: Condition; onChange: (c: Condition) => void; onRemove: () => void; companies: Company[] }) {
  const meta = FIELDS.find((f) => f.key === cond.field)!;
  return (
    <div className="inline-flex items-center gap-1 rounded-md border bg-panel/40 px-1.5 py-1">
      <Select value={cond.field} onValueChange={(v) => { const m = FIELDS.find((f) => f.key === v)!; onChange({ field: v, op: OPS[m.type][0].v, value: '' }); }}>
        <SelectTrigger className="h-6 w-32 border-0 bg-transparent text-sm"><SelectValue /></SelectTrigger>
        <SelectContent>{FIELDS.map((f) => <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>)}</SelectContent>
      </Select>
      <Select value={cond.op} onValueChange={(v) => onChange({ ...cond, op: v })}>
        <SelectTrigger className="h-6 w-24 border-0 bg-transparent text-sm"><SelectValue /></SelectTrigger>
        <SelectContent>{OPS[meta.type].map((o) => <SelectItem key={o.v} value={o.v}>{o.label}</SelectItem>)}</SelectContent>
      </Select>
      {meta.type !== 'bool' && (
        cond.field === 'segment'
          ? <Select value={cond.value} onValueChange={(v) => onChange({ ...cond, value: v })}><SelectTrigger className="h-6 w-28 border-0 bg-transparent text-sm"><SelectValue placeholder="value" /></SelectTrigger><SelectContent><SelectItem value="scaled">scaled</SelectItem><SelectItem value="mid_touch">mid_touch</SelectItem><SelectItem value="enterprise">enterprise</SelectItem></SelectContent></Select>
          : <Input className="h-6 w-24 border-0 bg-transparent text-sm" placeholder="value" value={cond.value} onChange={(e) => onChange({ ...cond, value: e.target.value })} />
      )}
      <button onClick={onRemove} className="text-muted-foreground hover:text-foreground"><X className="h-3 w-3" /></button>
      <span className="sr-only">{companies.length}</span>
    </div>
  );
}

function GroupBlock({ label, rows, grouped, collapsed, onToggle, companyById, selected, toggleSel }: { label: string; rows: Contact[]; grouped: boolean; collapsed: boolean; onToggle: () => void; companyById: Map<string, Company>; selected: Set<string>; toggleSel: (id: string) => void }) {
  return (
    <>
      {grouped && (
        <tr className="border-b bg-panel/40">
          <td colSpan={9} className="px-3 py-1.5">
            <button onClick={onToggle} className="inline-flex items-center gap-1 text-sm font-medium">
              {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}{label || '—'} <span className="text-muted-foreground">({rows.length})</span>
            </button>
          </td>
        </tr>
      )}
      {!collapsed && rows.map((c) => (
        <tr key={c.id} className="border-b last:border-0 hover:bg-panel/60">
          <td className="px-2 py-1.5 text-center"><input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleSel(c.id)} /></td>
          <td className="px-3 py-1.5">
            <div className="flex items-center gap-2"><Avatar name={`${c.firstName} ${c.lastName}`} className="h-5 w-5 text-[10px]" />
              <div><Link to={`/contacts/${c.id}`} className="font-medium hover:text-[var(--accent)]">{c.firstName} {c.lastName}</Link><div className="text-xs text-muted-foreground">{c.title}</div></div>
            </div>
          </td>
          <td className="px-3 py-1.5"><Link to={`/company/${c.companyId}`} className="text-muted-foreground hover:text-[var(--accent)]">{companyById.get(c.companyId)?.name}</Link></td>
          <td className="px-3 py-1.5">{c.contactRole ? <Chip>{ROLE_LABEL[c.contactRole]}</Chip> : '—'}</td>
          <td className="px-3 py-1.5 text-right tnum">{c.relationshipStrength ?? '—'}/10</td>
          <td className="px-3 py-1.5 text-muted-foreground">{c.department ?? '—'}</td>
          <td className="px-3 py-1.5 text-right tnum">{c.npsLatest ?? '—'}</td>
          <td className="px-3 py-1.5">
            <div className="flex gap-1">
              {c.isChampion && <Chip tone="green"><Star className="h-3 w-3" /></Chip>}
              {c.hasInfluence && <Chip tone="accent"><Zap className="h-3 w-3" /></Chip>}
              {c.isAdvocate && <Chip tone="amber">A</Chip>}
            </div>
          </td>
          <td className="px-3 py-1.5 text-right text-muted-foreground">{relativeTime(c.lastTouchAt)}</td>
        </tr>
      ))}
    </>
  );
}

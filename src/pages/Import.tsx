// CSV import (D3). Wizard: upload → entity → column mapping → validation preview
// → mode (create/update/upsert) → run → downloadable report. Idempotent per mode
// (companies match by domain/external_id, contacts by email, usage by
// company external_id + metric_key + date). Uses an inline CSV parser (Deviation:
// avoided adding Papaparse to sidestep the local npm-cache issue; parser handles
// quoted fields, embedded commas and newlines).
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { PageHeader, PageBody } from '@/components/PageHeader';
import {
  Card, CardBody, Button, Select, SelectTrigger, SelectValue, SelectContent, SelectItem, Chip,
} from '@/components/ui';
import { useSession } from '@/lib/session';
import { useToast } from '@/components/toast';
import { all, insert, update, newId } from '@/lib/store';
import { Upload, ArrowRight, ArrowLeft, Download, CheckCircle2 } from 'lucide-react';
import type { Company, Contact, UsageMetric, ImportRun } from '@/lib/types';

type Entity = 'companies' | 'contacts' | 'usage';
type Mode = 'create' | 'update' | 'upsert';
const ENTITY_FIELDS: Record<Entity, { key: string; label: string; required?: boolean }[]> = {
  companies: [
    { key: 'name', label: 'Name', required: true }, { key: 'domain', label: 'Domain' },
    { key: 'external_id', label: 'External ID' }, { key: 'arr', label: 'ARR' },
    { key: 'segment', label: 'Segment' }, { key: 'owner_email', label: 'Owner email' },
  ],
  contacts: [
    { key: 'first_name', label: 'First name' }, { key: 'last_name', label: 'Last name' },
    { key: 'email', label: 'Email', required: true }, { key: 'company_domain', label: 'Company domain' },
    { key: 'title', label: 'Title' }, { key: 'role', label: 'Role' },
  ],
  usage: [
    { key: 'company_external_id', label: 'Company external ID', required: true },
    { key: 'metric_key', label: 'Metric key', required: true },
    { key: 'date', label: 'Date', required: true }, { key: 'value', label: 'Value', required: true },
  ],
};

function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const out: string[][] = []; let row: string[] = []; let field = ''; let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQ = false;
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(field); field = ''; if (row.some((v) => v !== '')) out.push(row); row = []; }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); if (row.some((v) => v !== '')) out.push(row); }
  const headers = out.shift() ?? [];
  return { headers: headers.map((h) => h.trim()), rows: out };
}

export default function ImportPage() {
  return <div><PageHeader title="Import" subtitle="Bring companies, contacts and usage metrics into Compass" /><PageBody><ImportWizard /></PageBody></div>;
}

export function ImportWizard() {
  const { profile } = useSession();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  const [entity, setEntity] = useState<Entity>('companies');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<Mode>('upsert');
  const [result, setResult] = useState<{ created: number; updated: number; skipped: number; errors: { row: number; msg: string }[] } | null>(null);

  const fields = ENTITY_FIELDS[entity];

  const onFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const { headers: h, rows: r } = parseCsv(String(reader.result));
      setHeaders(h); setRows(r);
      // auto-suggest mapping by header similarity
      const m: Record<string, string> = {};
      fields.forEach((f) => { const hit = h.find((hd) => hd.toLowerCase().replace(/[^a-z]/g, '').includes(f.key.replace(/_/g, '').slice(0, 5)) || hd.toLowerCase().includes(f.label.toLowerCase())); if (hit) m[f.key] = hit; });
      setMapping(m); setStep(2);
    };
    reader.readAsText(file);
  };

  const col = (r: string[], fieldKey: string): string => { const h = mapping[fieldKey]; const idx = h ? headers.indexOf(h) : -1; return idx >= 0 ? (r[idx] ?? '').trim() : ''; };

  const validation = useMemo(() => {
    const errs: { row: number; msg: string }[] = [];
    const owners = all('profiles') as { email: string }[];
    const seen = new Set<string>();
    rows.forEach((r, i) => {
      for (const f of fields) if (f.required && !col(r, f.key)) errs.push({ row: i + 2, msg: `Missing ${f.label}` });
      if (entity !== 'usage') { /* name/email checks below */ }
      if (entity === 'contacts') { const e = col(r, 'email'); if (e && !/^[^@]+@[^@]+\.[^@]+$/.test(e)) errs.push({ row: i + 2, msg: `Bad email "${e}"` }); if (e) { if (seen.has(e)) errs.push({ row: i + 2, msg: 'Duplicate email in file' }); seen.add(e); } }
      if (entity === 'companies') { const oe = col(r, 'owner_email'); if (oe && !owners.some((o) => o.email === oe)) errs.push({ row: i + 2, msg: `Unknown owner "${oe}"` }); const d = col(r, 'domain'); if (d) { if (seen.has(d)) errs.push({ row: i + 2, msg: 'Duplicate domain in file' }); seen.add(d); } }
    });
    return errs;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, mapping, entity, fields]);

  const run = () => {
    let created = 0, updated = 0, skipped = 0; const errors: { row: number; msg: string }[] = [];
    const profiles = all('profiles') as { id: string; email: string }[];
    rows.forEach((r, i) => {
      try {
        if (entity === 'companies') {
          const name = col(r, 'name'); const domain = col(r, 'domain'); const extId = col(r, 'external_id');
          if (!name) { errors.push({ row: i + 2, msg: 'Missing name' }); return; }
          const existing = (all('companies') as Company[]).find((c) => (domain && c.domains?.includes(domain)) || (extId && c.source === 'csv_import' && (c as { sourceId?: string }).sourceId === extId));
          const patch = { name, domains: domain ? [domain] : [], arr: Number(col(r, 'arr')) || null, segment: (col(r, 'segment') || null) as Company['segment'], ownerId: profiles.find((p) => p.email === col(r, 'owner_email'))?.id ?? null };
          if (existing) { if (mode === 'create') { skipped++; return; } update('companies', existing.id, patch); updated++; }
          else { if (mode === 'update') { skipped++; return; } insert('companies', { id: newId('co'), collaboratorIds: [], status: 'customer', tags: [], healthScore: null, healthBand: null, healthDeltaWow: null, execRelationshipFlag: false, source: 'csv_import', ...patch } as unknown as Company); created++; }
        } else if (entity === 'contacts') {
          const email = col(r, 'email'); if (!email) { errors.push({ row: i + 2, msg: 'Missing email' }); return; }
          const domain = col(r, 'company_domain'); const company = (all('companies') as Company[]).find((c) => c.domains?.includes(domain));
          if (!company) { errors.push({ row: i + 2, msg: `No company for domain "${domain}"` }); return; }
          const existing = (all('contacts') as Contact[]).find((c) => c.email === email);
          const patch = { firstName: col(r, 'first_name'), lastName: col(r, 'last_name'), email, title: col(r, 'title') || null, companyId: company.id };
          if (existing) { if (mode === 'create') { skipped++; return; } update('contacts', existing.id, patch); updated++; }
          else { if (mode === 'update') { skipped++; return; } insert('contacts', { id: newId('ct'), otherEmails: [], isPrimary: false, isChampion: false, hasInfluence: false, isAdvocate: false, archived: false, source: 'csv_import', ...patch } as unknown as Contact); created++; }
        } else {
          const extId = col(r, 'company_external_id'); const key = col(r, 'metric_key'); const date = col(r, 'date'); const value = Number(col(r, 'value'));
          const company = (all('companies') as Company[]).find((c) => (c as { sourceId?: string }).sourceId === extId || c.hubspotCompanyId === extId);
          if (!company) { errors.push({ row: i + 2, msg: `No company for "${extId}"` }); return; }
          const existing = (all('usageMetrics') as UsageMetric[]).find((u) => u.companyId === company.id && u.metricKey === key && u.metricDate === date);
          if (existing) { if (mode === 'create') { skipped++; return; } update('usageMetrics', existing.id, { value }); updated++; }
          else { if (mode === 'update') { skipped++; return; } insert('usageMetrics', { id: newId('um'), companyId: company.id, metricKey: key, metricDate: date, value } as UsageMetric); created++; }
        }
      } catch { errors.push({ row: i + 2, msg: 'Row failed' }); }
    });
    const res = { created, updated, skipped, errors };
    setResult(res);
    insert('importRuns', { id: newId('imp'), entity, mode, stats: res, reportPath: null, runBy: profile.id, createdAt: new Date().toISOString() } as ImportRun);
    qc.invalidateQueries();
    setStep(4);
    toast(`Import complete: ${created} created, ${updated} updated`);
  };

  const downloadReport = () => {
    if (!result) return;
    const lines = [['status', 'count'], ['created', String(result.created)], ['updated', String(result.updated)], ['skipped', String(result.skipped)], ['errors', String(result.errors.length)], [], ['row', 'error'], ...result.errors.map((e) => [String(e.row), e.msg])];
    const blob = new Blob([lines.map((l) => l.join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `import-report-${entity}.csv`; a.click();
  };

  const Stepper = () => (
    <div className="mb-4 flex items-center gap-2 text-sm">
      {['Upload', 'Entity', 'Map', 'Preview', 'Done'].map((s, i) => (
        <span key={s} className={`flex items-center gap-2 ${i === step ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>
          <span className={`flex h-5 w-5 items-center justify-center rounded-full text-xs ${i <= step ? 'bg-[var(--accent)] text-white' : 'bg-panel'}`}>{i + 1}</span>{s}{i < 4 && <ArrowRight className="h-3 w-3" />}
        </span>
      ))}
    </div>
  );

  return (
    <div>
      <Stepper />
      <Card><CardBody>
        {step === 0 && (
          <div className="flex flex-col items-start gap-3">
            <div className="mb-1 text-sm text-muted-foreground">Choose the entity, then upload a CSV.</div>
            <Select value={entity} onValueChange={(v) => setEntity(v as Entity)}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="companies">Companies</SelectItem><SelectItem value="contacts">Contacts</SelectItem><SelectItem value="usage">Usage metrics</SelectItem></SelectContent>
            </Select>
            <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed px-4 py-8 text-sm text-muted-foreground hover:border-[var(--accent)]">
              <Upload className="h-4 w-4" /> Click to upload a CSV
              <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
            </label>
          </div>
        )}
        {step === 2 && (
          <div>
            <div className="mb-2 text-sm text-muted-foreground">Map your columns ({rows.length} rows). Auto-suggested from headers.</div>
            <div className="grid gap-2 sm:grid-cols-2">
              {fields.map((f) => (
                <div key={f.key} className="flex items-center justify-between gap-2">
                  <span className="text-sm">{f.label}{f.required && <span className="text-[var(--red)]">*</span>}</span>
                  <Select value={mapping[f.key] ?? 'none'} onValueChange={(v) => setMapping((m) => ({ ...m, [f.key]: v === 'none' ? '' : v }))}>
                    <SelectTrigger className="h-7 w-44"><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent><SelectItem value="none">—</SelectItem>{headers.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              ))}
            </div>
            <div className="mt-4 flex gap-2"><Button variant="ghost" onClick={() => setStep(0)}><ArrowLeft className="h-3.5 w-3.5" /> Back</Button><Button variant="primary" onClick={() => setStep(3)}>Validate <ArrowRight className="h-3.5 w-3.5" /></Button></div>
          </div>
        )}
        {step === 3 && (
          <div>
            <div className="mb-2 flex items-center gap-2 text-sm"><Chip tone={validation.length ? 'amber' : 'green'}>{validation.length} issues</Chip><span className="text-muted-foreground">{rows.length - new Set(validation.map((e) => e.row)).size} of {rows.length} rows clean</span></div>
            {validation.length > 0 && (
              <div className="mb-3 max-h-40 overflow-y-auto rounded-md border">
                {validation.slice(0, 50).map((e, i) => <div key={i} className="border-b px-3 py-1 text-sm last:border-0">Row {e.row}: <span className="text-[var(--red)]">{e.msg}</span></div>)}
              </div>
            )}
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground">Mode</span>
              <Select value={mode} onValueChange={(v) => setMode(v as Mode)}>
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="create">Create only</SelectItem><SelectItem value="update">Update matches</SelectItem><SelectItem value="upsert">Upsert</SelectItem></SelectContent>
              </Select>
            </div>
            <div className="mt-4 flex gap-2"><Button variant="ghost" onClick={() => setStep(2)}><ArrowLeft className="h-3.5 w-3.5" /> Back</Button><Button variant="primary" onClick={run}>Run import</Button></div>
          </div>
        )}
        {step === 4 && result && (
          <div className="flex flex-col items-start gap-3">
            <div className="flex items-center gap-2 text-md font-semibold"><CheckCircle2 className="h-5 w-5 text-[var(--green)]" /> Import complete</div>
            <div className="flex gap-2"><Chip tone="green">{result.created} created</Chip><Chip tone="accent">{result.updated} updated</Chip><Chip>{result.skipped} skipped</Chip><Chip tone={result.errors.length ? 'red' : 'neutral'}>{result.errors.length} errors</Chip></div>
            <div className="flex gap-2"><Button variant="outline" onClick={downloadReport}><Download className="h-3.5 w-3.5" /> Download report</Button><Button variant="ghost" onClick={() => { setStep(0); setRows([]); setResult(null); }}>Import another</Button></div>
          </div>
        )}
      </CardBody></Card>
    </div>
  );
}

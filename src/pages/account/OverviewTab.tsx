import { useState } from 'react';
import { Card, CardHeader, CardTitle, CardBody, Chip, Button, Textarea, HealthDot } from '@/components/ui';
import { Composer } from './Composer';
import { TimelineTab } from './TimelineTab';
import { useLatestSnapshot, useDeals, useSuccessPlans, useContacts, useUpdateCompany } from '@/lib/hooks';
import { useToast } from '@/components/toast';
import { HEALTH_DIMENSIONS, SEGMENT_PRESETS } from '@/lib/segments';
import { fmtCurrency, fmtDate, daysUntil } from '@/lib/utils';
import { Sparkles, Pencil } from 'lucide-react';
import type { Company } from '@/lib/types';

export function OverviewTab({ company }: { company: Company }) {
  const latest = useLatestSnapshot(company.id);
  const { data: deals = [] } = useDeals(company.id);
  const { data: plans = [] } = useSuccessPlans(company.id);
  const { data: contacts = [] } = useContacts(company.id);
  const renewalDeal = deals.find((d) => d.pipeline === 'renewal');
  const plan = plans[0];

  const expectedContacts = company.segment ? SEGMENT_PRESETS[company.segment].expectedActiveContacts : 3;
  const coveredRoles = new Set(contacts.map((c) => c.contactRole).filter(Boolean));

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {/* Left: composer + timeline */}
      <div className="space-y-4 lg:col-span-2">
        <Composer company={company} />
        <TimelineTab companyId={company.id} />
      </div>

      {/* Right: attribute panel */}
      <div className="space-y-3">
        <Panel title="About">
          <Kv k="Website" v={company.website ?? '—'} />
          <Kv k="Location" v={[company.city, company.country].filter(Boolean).join(', ') || '—'} />
          <Kv k="Region" v={company.region ?? '—'} />
          <Kv k="Tier" v={company.tier ?? '—'} />
          <Kv k="MRR" v={fmtCurrency(company.mrr)} />
        </Panel>

        <Panel title="Health breakdown">
          {HEALTH_DIMENSIONS.map((d) => {
            const dim = latest?.dimensions?.[d.key];
            return (
              <div key={d.key} className="mb-1.5">
                <div className="flex justify-between text-sm"><span>{d.label}</span><span className="tnum text-muted-foreground">{dim?.score ?? '—'}</span></div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#eef0f3]"><div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${dim?.score ?? 0}%` }} /></div>
              </div>
            );
          })}
        </Panel>

        <Panel title="Renewal">
          <Kv k="Date" v={fmtDate(company.renewalDate)} />
          <Kv k="ARR" v={fmtCurrency(company.renewalArr)} />
          <Kv k="Countdown" v={`T-${daysUntil(company.renewalDate)}`} />
          {renewalDeal && <><Kv k="Stage" v={renewalDeal.stage ?? '—'} /><div className="mt-1 text-sm text-muted-foreground">{renewalDeal.nextSteps?.split('\n')[0]}</div></>}
        </Panel>

        {plan && (
          <Panel title="Success plan">
            <div className="flex items-center justify-between text-sm"><span>{plan.name}</span><span className="tnum font-medium">{plan.progressPct}%</span></div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[#eef0f3]"><div className="h-full rounded-full bg-[var(--green)]" style={{ width: `${plan.progressPct}%` }} /></div>
          </Panel>
        )}

        <Panel title="Stakeholder map">
          <div className="text-sm">{coveredRoles.size} roles covered · {contacts.length} contacts (expected ≥{expectedContacts} active)</div>
          <div className="mt-1 flex flex-wrap gap-1">{[...coveredRoles].map((r) => <Chip key={r}>{r?.replace(/_/g, ' ')}</Chip>)}</div>
        </Panel>

        <Panel title="AI summaries">
          <AiBlock label="Account" text={company.aiAccountSummary} />
          <AiBlock label="Risk" text={company.aiRiskSummary} />
          <AiBlock label="Renewal" text={company.aiRenewalSummary} />
        </Panel>

        <div className="grid grid-cols-2 gap-3">
          <FlagPanel title="Red flags" tone="red" text={company.redFlags} />
          <FlagPanel title="Green flags" tone="green" text={company.greenFlags} />
        </div>

        <Panel title="Next step"><p className="text-base">{company.nextStep ?? '—'}</p></Panel>
        <EditablePanel title="Path to green" companyId={company.id} field="pathToGreen" value={company.pathToGreen} />
      </div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="py-2"><CardTitle className="text-sm text-muted-foreground">{title}</CardTitle></CardHeader>
      <CardBody className="py-2.5">{children}</CardBody>
    </Card>
  );
}
function Kv({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between py-0.5 text-sm"><span className="text-muted-foreground">{k}</span><span className="font-medium">{v}</span></div>;
}
function AiBlock({ label, text }: { label: string; text?: string | null }) {
  return (
    <div className="mb-2 last:mb-0">
      <div className="mb-0.5 flex items-center gap-1 text-xs font-medium text-muted-foreground"><Sparkles className="h-3 w-3" /> {label}</div>
      <p className="text-sm">{text ?? '—'}</p>
    </div>
  );
}
function FlagPanel({ title, tone, text }: { title: string; tone: 'red' | 'green'; text?: string | null }) {
  return (
    <Card>
      <CardHeader className="py-2"><CardTitle className="text-sm"><HealthDot band={tone} /> {title}</CardTitle></CardHeader>
      <CardBody className="py-2.5 text-sm">{text ?? '—'}</CardBody>
    </Card>
  );
}
function EditablePanel({ title, companyId, field, value }: { title: string; companyId: string; field: 'pathToGreen'; value?: string | null }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value ?? '');
  const update = useUpdateCompany();
  const { toast } = useToast();
  return (
    <Card>
      <CardHeader className="py-2"><CardTitle className="text-sm text-muted-foreground">{title}</CardTitle>
        <button onClick={() => setEditing((e) => !e)} className="text-muted-foreground hover:text-foreground"><Pencil className="h-3 w-3" /></button>
      </CardHeader>
      <CardBody className="py-2.5">
        {editing ? (
          <div className="space-y-2">
            <Textarea rows={2} value={val} onChange={(e) => setVal(e.target.value)} />
            <Button size="sm" variant="primary" onClick={() => { update.mutate({ id: companyId, patch: { [field]: val } }); setEditing(false); toast('Saved'); }}>Save</Button>
          </div>
        ) : <p className="text-base">{value ?? '—'}</p>}
      </CardBody>
    </Card>
  );
}

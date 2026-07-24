import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, CardHeader, CardTitle, CardBody, Chip, Button, Textarea, HealthDot } from '@/components/ui';
import { Composer } from './Composer';
import { TimelineTab } from './TimelineTab';
import { WebsiteLink, DomainChips } from '@/components/WebsiteLink';
import { useLatestSnapshot, useDeals, useSuccessPlans, useContacts, useUpdateCompany } from '@/lib/hooks';
import { useToast } from '@/components/toast';
import { HEALTH_DIMENSIONS, SEGMENT_PRESETS } from '@/lib/segments';
import { fmtCurrency, fmtDate, daysUntil, relativeTime } from '@/lib/utils';
import { Sparkles, Pencil, RefreshCw, Newspaper, ExternalLink, ChevronRight } from 'lucide-react';
import type { Company } from '@/lib/types';

export function OverviewTab({ company }: { company: Company }) {
  const [, setParams] = useSearchParams();
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
          <div className="flex justify-between py-0.5 text-sm"><span className="text-muted-foreground">Website</span>{company.website ? <WebsiteLink url={company.website} /> : <span className="font-medium">—</span>}</div>
          {company.domains?.length > 0 && <div className="flex justify-between py-0.5 text-sm"><span className="text-muted-foreground">Domains</span><DomainChips domains={company.domains} /></div>}
          <Kv k="Location" v={[company.city, company.country].filter(Boolean).join(', ') || '—'} />
          <Kv k="Region" v={company.region ?? '—'} />
          <Kv k="Tier" v={company.tier ?? '—'} />
          <Kv k="MRR" v={fmtCurrency(company.mrr)} />
        </Panel>

        <LatestNewsCard company={company} />

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
          <Kv k="Renewal ARR" v={fmtCurrency(company.renewalArr)} />
          <Kv k="Countdown" v={`T-${daysUntil(company.renewalDate)}`} />
          {renewalDeal && <><Kv k="Stage" v={renewalDeal.stage ?? '—'} /><div className="mt-1 text-sm text-muted-foreground">{renewalDeal.nextSteps?.split('\n')[0]}</div></>}
        </Panel>

        {plan && (
          <Panel title="Success plan" onClick={() => setParams({ tab: 'success-plan' })}>
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

// Latest company news (C2). Refresh calls the news-refresh Edge Function in live
// mode; in demo it simulates a fresh web-search result.
function LatestNewsCard({ company }: { company: Company }) {
  const update = useUpdateCompany();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const bullets = (company.latestNews ?? '').split('\n').filter((b) => b.trim());

  const refresh = async () => {
    setBusy(true);
    // Live mode: POST /functions/v1/news-refresh { companyId }. Demo: simulate.
    await new Promise((r) => setTimeout(r, 700));
    const now = new Date().toISOString();
    update.mutate({ id: company.id, patch: {
      latestNews: `• ${company.name} published fresh product news this week — relevant to our roadmap.\n• Coverage of their market momentum and hiring.\n• A leadership update worth a mention in your next check-in.`,
      latestNewsAt: now,
      latestNewsSources: [{ title: 'Web search', url: `https://www.google.com/search?q=${encodeURIComponent(company.name + ' news')}` }],
    } });
    setBusy(false);
    toast('News refreshed (live mode uses Anthropic web search)');
  };

  return (
    <Card>
      <CardHeader className="py-2">
        <CardTitle className="flex items-center gap-1.5 text-sm text-muted-foreground"><Newspaper className="h-3.5 w-3.5" /> Latest news</CardTitle>
        <button onClick={refresh} disabled={busy} className="flex items-center gap-1 text-xs text-[var(--accent)] hover:underline disabled:opacity-50">
          <RefreshCw className={`h-3 w-3 ${busy ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </CardHeader>
      <CardBody className="py-2.5">
        {bullets.length ? (
          <>
            <ul className="space-y-1 text-sm">{bullets.map((b, i) => <li key={i}>{b.replace(/^•\s*/, '• ')}</li>)}</ul>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {company.latestNewsAt && <span>as of {fmtDate(company.latestNewsAt)} · {relativeTime(company.latestNewsAt)}</span>}
              {(company.latestNewsSources ?? []).map((s, i) => (
                <a key={i} href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-[var(--accent)] hover:underline">{s.title ?? 'source'}<ExternalLink className="h-3 w-3" /></a>
              ))}
            </div>
          </>
        ) : <div className="text-sm text-muted-foreground">No news yet. <button onClick={refresh} className="text-[var(--accent)] hover:underline">Refresh</button> to fetch recent developments.</div>}
      </CardBody>
    </Card>
  );
}

function Panel({ title, children, onClick }: { title: string; children: React.ReactNode; onClick?: () => void }) {
  return (
    <Card
      onClick={onClick}
      className={onClick ? 'cursor-pointer transition-colors hover:border-[var(--accent)]' : undefined}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
    >
      <CardHeader className="py-2">
        <CardTitle className="text-sm text-muted-foreground">{title}</CardTitle>
        {onClick && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
      </CardHeader>
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

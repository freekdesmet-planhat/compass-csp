import { useDeals, useUpdateDeal, useLogActivity } from '@/lib/hooks';
import { Card, CardBody, Chip, Button, EmptyState, Progress } from '@/components/ui';
import { WhitespaceStrip } from '@/components/Whitespace';
import { useToast } from '@/components/toast';
import { useSession } from '@/lib/session';
import { fmtCurrency, fmtDate } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { Handshake, ExternalLink, Check, X, Sparkles } from 'lucide-react';
import type { Company, Deal } from '@/lib/types';

// Canonical MEDDIC criteria; union with whatever keys the deal already carries.
const MEDDIC_KEYS = ['Metrics', 'EconomicBuyer', 'DecisionCriteria', 'DecisionProcess', 'IdentifyPain', 'Champion', 'Budget', 'Timeline'];
type TriState = true | false | null;

export function DealsTab({ company }: { company: Company }) {
  const { data: deals = [] } = useDeals(company.id);
  return (
    <div className="space-y-3">
      <Card><CardBody><WhitespaceStrip companyId={company.id} /></CardBody></Card>
      {deals.length
        ? deals.map((d) => <DealCard key={d.id} deal={d} />)
        : <EmptyState icon={Handshake} title="No deals" hint="Renewal and expansion deals sync from HubSpot." />}
    </div>
  );
}

function DealCard({ deal }: { deal: Deal }) {
  const updateDeal = useUpdateDeal();
  const logActivity = useLogActivity();
  const { profile } = useSession();
  const { toast } = useToast();
  const qual = deal.qualification as Record<string, TriState>;
  const keys = [...new Set([...MEDDIC_KEYS, ...Object.keys(qual)])];

  const setCriterion = (key: string, value: TriState) => {
    const next = { ...qual, [key]: value, _manual: { ...(qual._manual as unknown as Record<string, boolean> ?? {}), [key]: true } };
    updateDeal.mutate({ id: deal.id, patch: { qualification: next } });
    logActivity.mutate({
      companyId: deal.companyId, type: 'system',
      title: value === true ? `${key} confirmed by ${profile.fullName}` : value === false ? `${key} marked not met by ${profile.fullName}` : `${key} cleared by ${profile.fullName}`,
      snippet: `Deal: ${deal.name}`,
    });
    toast('Qualification updated');
  };
  return (
    <Card>
      <CardBody className="space-y-3">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium">{deal.name}</span>
              <Chip tone={deal.pipeline === 'renewal' ? 'accent' : deal.pipeline === 'expansion' ? 'green' : 'neutral'}>{deal.pipeline}</Chip>
              <Chip tone={deal.status === 'won' ? 'green' : deal.status === 'lost' ? 'red' : 'neutral'}>{deal.status}</Chip>
            </div>
            <div className="mt-0.5 text-sm text-muted-foreground">{deal.stage} · {fmtCurrency(deal.amount, deal.currency)} · close {fmtDate(deal.closeDate)}</div>
          </div>
          <a href="#" className="flex items-center gap-1 text-sm text-[var(--accent)]">Open in HubSpot <ExternalLink className="h-3 w-3" /></a>
        </div>

        {/* Confidence */}
        <div className="flex items-center gap-2 text-sm"><span className="w-20 text-muted-foreground">Confidence</span><Progress value={deal.confidence ?? 0} className="max-w-[200px]" /><span className="tnum">{deal.confidence}%</span></div>

        {/* Suggested stage chip */}
        {deal.suggestedStage && (
          <div className="flex items-center gap-2 rounded-md border border-[var(--accent)]/40 bg-[var(--accent-tint)]/50 px-3 py-2 text-sm">
            <Sparkles className="h-3.5 w-3.5 text-[var(--accent)]" />
            <span className="flex-1">AI suggests moving to <span className="font-medium">{deal.suggestedStage}</span> — {deal.suggestedStageReason}</span>
            <Button size="sm" variant="primary" onClick={() => { updateDeal.mutate({ id: deal.id, patch: { stage: deal.suggestedStage!, suggestedStage: null, suggestedStageReason: null } }); toast('Stage updated'); }}><Check className="h-3.5 w-3.5" /></Button>
            <Button size="sm" variant="ghost" onClick={() => { updateDeal.mutate({ id: deal.id, patch: { suggestedStage: null, suggestedStageReason: null } }); toast('Suggestion dismissed'); }}><X className="h-3.5 w-3.5" /></Button>
          </div>
        )}

        {/* AI next steps + summary */}
        {deal.nextSteps && (
          <div>
            <div className="mb-0.5 flex items-center gap-1 text-xs font-medium text-muted-foreground"><Sparkles className="h-3 w-3" /> AI next steps</div>
            <pre className="whitespace-pre-wrap font-sans text-base">{deal.nextSteps}</pre>
          </div>
        )}
        {deal.aiSummary && <p className="text-sm text-muted-foreground">{deal.aiSummary}</p>}

        {/* MEDDIC checklist — hand-editable Yes/No/Unset (B3) */}
        <div className="border-t pt-2">
          <div className="mb-1.5 text-xs font-medium text-muted-foreground">Qualification (MEDDIC)</div>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {keys.filter((k) => !k.startsWith('_')).map((k) => (
              <div key={k} className="flex items-center justify-between gap-2">
                <span className="text-sm">{k.replace(/([A-Z])/g, ' $1').trim()}</span>
                <Segmented value={qual[k] ?? null} onChange={(v) => setCriterion(k, v)} />
              </div>
            ))}
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

function Segmented({ value, onChange }: { value: TriState; onChange: (v: TriState) => void }) {
  const opts: { v: TriState; label: string }[] = [{ v: true, label: 'Yes' }, { v: false, label: 'No' }, { v: null, label: '—' }];
  return (
    <div className="inline-flex overflow-hidden rounded-md border">
      {opts.map((o, i) => (
        <button
          key={o.label}
          onClick={() => onChange(o.v)}
          className={cn(
            'px-2 py-0.5 text-xs',
            i > 0 && 'border-l',
            value === o.v
              ? o.v === true ? 'bg-[var(--green)] text-white' : o.v === false ? 'bg-[var(--red)] text-white' : 'bg-panel text-foreground'
              : 'bg-white text-muted-foreground hover:bg-panel'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

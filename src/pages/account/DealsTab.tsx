import { useDeals, useUpdateDeal } from '@/lib/hooks';
import { Card, CardBody, Chip, Button, EmptyState, Progress } from '@/components/ui';
import { useToast } from '@/components/toast';
import { fmtCurrency, fmtDate } from '@/lib/utils';
import { Handshake, ExternalLink, Check, X, Sparkles } from 'lucide-react';
import type { Company, Deal } from '@/lib/types';

export function DealsTab({ company }: { company: Company }) {
  const { data: deals = [] } = useDeals(company.id);
  if (!deals.length) return <EmptyState icon={Handshake} title="No deals" hint="Renewal and expansion deals sync from HubSpot." />;
  return <div className="space-y-3">{deals.map((d) => <DealCard key={d.id} deal={d} />)}</div>;
}

function DealCard({ deal }: { deal: Deal }) {
  const updateDeal = useUpdateDeal();
  const { toast } = useToast();
  const qual = deal.qualification as Record<string, boolean>;
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

        {/* MEDDIC checklist */}
        <div className="flex flex-wrap gap-1.5 border-t pt-2">
          {Object.entries(qual).map(([k, v]) => (
            <Chip key={k} tone={v ? 'green' : 'neutral'}>{v ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />} {k}</Chip>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}

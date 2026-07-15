import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader, PageBody } from '@/components/PageHeader';
import { Card, CardBody, Chip, Progress, EmptyState } from '@/components/ui';
import { useSuccessPlans, useObjectives, useVisibleCompanies } from '@/lib/hooks';
import { fmtDate } from '@/lib/utils';
import { Target } from 'lucide-react';

export default function SuccessPlansPage() {
  const navigate = useNavigate();
  const { data: companies = [] } = useVisibleCompanies();
  const { data: plans = [] } = useSuccessPlans();
  const { data: objectives = [] } = useObjectives();

  const visibleIds = useMemo(() => new Set(companies.map((c) => c.id)), [companies]);
  const companyById = useMemo(() => new Map(companies.map((c) => [c.id, c])), [companies]);
  const myPlans = plans.filter((p) => visibleIds.has(p.companyId));

  const avgProgress = myPlans.length ? Math.round(myPlans.reduce((a, p) => a + p.progressPct, 0) / myPlans.length) : 0;
  const objByPlan = (planId: string) => objectives.filter((o) => o.planId === planId);
  const atRisk = myPlans.filter((p) => objByPlan(p.id).some((o) => o.status === 'at_risk' || o.status === 'missed')).length;

  const toneFor = (s: string): 'green' | 'accent' | 'amber' | 'red' | 'neutral' => (s === 'achieved' ? 'green' : s === 'on_track' ? 'accent' : s === 'at_risk' ? 'amber' : s === 'missed' ? 'red' : 'neutral');

  return (
    <div>
      <PageHeader title="Success Plans" subtitle={`${myPlans.length} active plans · ${avgProgress}% avg progress · ${atRisk} with at-risk objectives`} />
      <PageBody>
        {myPlans.length === 0 ? (
          <EmptyState icon={Target} title="No success plans" hint="Enterprise and mid-touch accounts drive success plans here." />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {myPlans.map((p) => {
              const objs = objByPlan(p.id);
              const counts = objs.reduce((acc, o) => { acc[o.status] = (acc[o.status] ?? 0) + 1; return acc; }, {} as Record<string, number>);
              return (
                <button key={p.id} onClick={() => navigate(`/company/${p.companyId}?tab=success-plan`)} className="text-left">
                  <Card className="h-full hover:border-[var(--accent)]">
                    <CardBody className="space-y-2">
                      <div>
                        <div className="font-medium">{companyById.get(p.companyId)?.name}</div>
                        <div className="text-sm text-muted-foreground">{p.name} · target {fmtDate(p.targetDate)}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Progress value={p.progressPct} tone={p.progressPct >= 70 ? 'green' : p.progressPct >= 40 ? 'accent' : 'amber'} />
                        <span className="text-sm font-medium tnum">{p.progressPct}%</span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(counts).map(([s, n]) => <Chip key={s} tone={toneFor(s)}>{n} {s.replace(/_/g, ' ')}</Chip>)}
                      </div>
                    </CardBody>
                  </Card>
                </button>
              );
            })}
          </div>
        )}
      </PageBody>
    </div>
  );
}

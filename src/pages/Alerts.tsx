import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader, PageBody } from '@/components/PageHeader';
import {
  Chip, Card, CardHeader, CardTitle, CardBody, Button, EmptyState, Skeleton,
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
  Popover, PopoverTrigger, PopoverContent,
} from '@/components/ui';
import { useAlerts, useAlertRules, useUpdateAlert, useVisibleCompanies } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { relativeTime } from '@/lib/utils';
import { useToast } from '@/components/toast';
import { BellRing, Check, Clock, CircleCheck, ArrowUpRight } from 'lucide-react';
import type { Alert, AlertSeverity, AlertStatus } from '@/lib/types';

const SEVERITY_TONE: Record<AlertSeverity, 'red' | 'amber' | 'neutral'> = {
  critical: 'red',
  warning: 'amber',
  info: 'neutral',
};
const SEVERITY_RANK: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };
const STATUS_TONE: Record<AlertStatus, 'accent' | 'neutral' | 'amber' | 'green'> = {
  open: 'accent',
  acknowledged: 'neutral',
  snoozed: 'amber',
  resolved: 'green',
};
const STATUS_LABEL: Record<AlertStatus, string> = {
  open: 'Open',
  acknowledged: 'Acknowledged',
  snoozed: 'Snoozed',
  resolved: 'Resolved',
};

export default function AlertsPage() {
  const { profile, allProfiles } = useSession();
  const navigate = useNavigate();
  const { data: alerts = [], isLoading } = useAlerts();
  const { data: rules = [] } = useAlertRules();
  const { data: companies = [] } = useVisibleCompanies();
  const update = useUpdateAlert();
  const { toast } = useToast();

  const [statusFilter, setStatusFilter] = useState<AlertStatus>('open');

  const companyName = useMemo(() => {
    const m = new Map<string, string>();
    companies.forEach((c) => m.set(c.id, c.name));
    return m;
  }, [companies]);

  const ruleName = useMemo(() => {
    const m = new Map<string, string>();
    rules.forEach((r) => m.set(r.id, r.name));
    return m;
  }, [rules]);

  // Visibility scope: admin=all, manager=own+team, csm=own.
  const visibleAlerts = useMemo(() => {
    const teamIds = new Set(allProfiles.filter((p) => p.managerId === profile.id).map((p) => p.id));
    return alerts.filter((a) => {
      if (profile.role === 'admin') return true;
      if (a.ownerId === profile.id) return true;
      if (profile.role === 'manager' && a.ownerId && teamIds.has(a.ownerId)) return true;
      return false;
    });
  }, [alerts, allProfiles, profile]);

  const openCount = useMemo(() => visibleAlerts.filter((a) => a.status === 'open').length, [visibleAlerts]);

  const filtered = useMemo(
    () => visibleAlerts.filter((a) => a.status === statusFilter),
    [visibleAlerts, statusFilter]
  );

  // Group by rule.
  const groups = useMemo(() => {
    const byRule = new Map<string, Alert[]>();
    filtered.forEach((a) => {
      const key = a.ruleId ?? '__none__';
      if (!byRule.has(key)) byRule.set(key, []);
      byRule.get(key)!.push(a);
    });
    return [...byRule.entries()]
      .map(([key, list]) => ({
        key,
        name: key === '__none__' ? 'Other alerts' : ruleName.get(key) ?? 'Unknown rule',
        alerts: list.sort(
          (a, b) =>
            SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
            +new Date(b.createdAt) - +new Date(a.createdAt)
        ),
      }))
      .sort((a, b) => b.alerts.length - a.alerts.length);
  }, [filtered, ruleName]);

  const patch = (a: Alert, next: Partial<Alert>, msg: string) => {
    update.mutate({ id: a.id, patch: next });
    toast(msg, { tone: 'success' });
  };
  const snooze = (a: Alert, days: number, label: string) => {
    const until = new Date();
    until.setDate(until.getDate() + days);
    patch(a, { status: 'snoozed', snoozedUntil: until.toISOString() }, `Snoozed ${label}`);
  };

  return (
    <div>
      <PageHeader
        title="Alerts"
        subtitle={`${openCount} open`}
        actions={
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as AlertStatus)}>
            <SelectTrigger className="w-40"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="acknowledged">Acknowledged</SelectItem>
              <SelectItem value="snoozed">Snoozed</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
            </SelectContent>
          </Select>
        }
      />
      <PageBody>
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : groups.length === 0 ? (
          <EmptyState
            icon={BellRing}
            title={`No ${STATUS_LABEL[statusFilter].toLowerCase()} alerts`}
            hint="You're all caught up on this queue."
          />
        ) : (
          <div className="space-y-4">
            {groups.map((g) => (
              <Card key={g.key}>
                <CardHeader>
                  <CardTitle>{g.name}</CardTitle>
                  <Chip tone="neutral">{g.alerts.length}</Chip>
                </CardHeader>
                <CardBody className="p-0">
                  <div className="divide-y">
                    {g.alerts.map((a) => (
                      <div key={a.id} className="flex items-start gap-3 px-4 py-2.5">
                        <Chip tone={SEVERITY_TONE[a.severity]} className="mt-0.5 capitalize">{a.severity}</Chip>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate font-medium">{a.title}</span>
                            <Chip tone={STATUS_TONE[a.status]}>{STATUS_LABEL[a.status]}</Chip>
                          </div>
                          {a.detail && <div className="mt-0.5 text-sm text-muted-foreground">{a.detail}</div>}
                          <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                            <button
                              className="inline-flex items-center gap-0.5 text-[var(--accent)] hover:underline"
                              onClick={() => navigate(`/company/${a.companyId}`)}
                            >
                              {companyName.get(a.companyId) ?? 'Account'}
                              <ArrowUpRight className="h-3 w-3" />
                            </button>
                            <span>·</span>
                            <span className="tnum">{relativeTime(a.createdAt)}</span>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          {a.status !== 'acknowledged' && a.status !== 'resolved' && (
                            <Button size="sm" variant="ghost" onClick={() => patch(a, { status: 'acknowledged' }, 'Acknowledged')}>
                              <Check className="h-3.5 w-3.5" /> Ack
                            </Button>
                          )}
                          {a.status !== 'resolved' && (
                            <Popover>
                              <PopoverTrigger asChild>
                                <Button size="sm" variant="ghost"><Clock className="h-3.5 w-3.5" /> Snooze</Button>
                              </PopoverTrigger>
                              <PopoverContent align="end" className="w-32">
                                <button className="flex w-full items-center rounded px-2 py-1.5 text-base hover:bg-panel" onClick={() => snooze(a, 1, '1 day')}>1 day</button>
                                <button className="flex w-full items-center rounded px-2 py-1.5 text-base hover:bg-panel" onClick={() => snooze(a, 7, '1 week')}>1 week</button>
                              </PopoverContent>
                            </Popover>
                          )}
                          {a.status !== 'resolved' && (
                            <Button size="sm" variant="ghost" onClick={() => patch(a, { status: 'resolved' }, 'Resolved')}>
                              <CircleCheck className="h-3.5 w-3.5" /> Resolve
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardBody>
              </Card>
            ))}
          </div>
        )}
      </PageBody>
    </div>
  );
}

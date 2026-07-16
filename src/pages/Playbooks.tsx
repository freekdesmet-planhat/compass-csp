// Playbooks (read-only for CSMs) — makes the task/alert automation inspectable
// rather than a black box. Lists each playbook's trigger, the steps/tasks it
// generates and an on/off state. Editing lives in Admin → Playbooks.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader, PageBody } from '@/components/PageHeader';
import { Card, CardBody, Chip, Switch, EmptyState } from '@/components/ui';
import { useSession } from '@/lib/session';
import { useToast } from '@/components/toast';
import { PLAYBOOKS, type Playbook } from '@/lib/playbooks';
import { SEGMENT_LABELS } from '@/lib/segments';
import { Workflow, ChevronDown, Zap } from 'lucide-react';

export default function PlaybooksPage() {
  const { profile } = useSession();
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() => Object.fromEntries(PLAYBOOKS.map((p) => [p.id, p.enabled])));
  const { toast } = useToast();
  const canEdit = profile.role === 'admin';

  return (
    <div>
      <PageHeader
        title="Playbooks"
        subtitle="The automations that generate tasks and alerts across your book"
        actions={canEdit ? <Link to="/admin" className="text-sm text-[var(--accent)] hover:underline">Edit in Admin →</Link> : undefined}
      />
      <PageBody>
        {PLAYBOOKS.length === 0 ? (
          <EmptyState icon={Workflow} title="No playbooks configured" hint="Playbooks generate tasks and alerts automatically when their trigger fires." />
        ) : (
          <div className="space-y-2">
            {PLAYBOOKS.map((pb) => (
              <PlaybookRow key={pb.id} pb={pb} on={enabled[pb.id]} canEdit={canEdit} onToggle={(v) => { setEnabled((e) => ({ ...e, [pb.id]: v })); toast(`${pb.name} ${v ? 'enabled' : 'disabled'}`); }} />
            ))}
          </div>
        )}
      </PageBody>
    </div>
  );
}

function PlaybookRow({ pb, on, canEdit, onToggle }: { pb: Playbook; on: boolean; canEdit: boolean; onToggle: (v: boolean) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <div className="flex items-center gap-3 px-4 py-3">
        <button className="flex flex-1 items-center gap-2 text-left" onClick={() => setOpen((o) => !o)}>
          <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium">{pb.name}</span>
              {!on && <Chip>off</Chip>}
            </div>
            <div className="mt-0.5 truncate text-sm text-muted-foreground">{pb.description}</div>
          </div>
        </button>
        <div className="flex shrink-0 items-center gap-2">
          <Chip tone="accent"><Zap className="h-3 w-3" /> {pb.triggerLabel}</Chip>
          <span className="hidden text-sm text-muted-foreground sm:inline">{pb.steps.length} steps</span>
          <Switch checked={on} onCheckedChange={onToggle} disabled={!canEdit} />
        </div>
      </div>
      {open && (
        <CardBody className="border-t">
          <div className="mb-2 flex flex-wrap gap-1">
            {pb.segments.map((s) => <Chip key={s}>{SEGMENT_LABELS[s]}</Chip>)}
          </div>
          <div className="space-y-1.5">
            {pb.steps.map((s, n) => (
              <div key={n} className="flex items-center gap-3 rounded-md border px-3 py-1.5 text-base">
                <span className="w-5 text-sm text-muted-foreground tnum">{n + 1}</span>
                <span className="flex-1">{s.title}</span>
                <Chip>due +{s.dueInDays}d</Chip>
                <Chip tone={s.priority === 'high' ? 'red' : 'neutral'}>{s.priority}</Chip>
              </div>
            ))}
          </div>
          {!canEdit && <p className="mt-3 text-xs text-muted-foreground">Read-only — an admin can edit steps and triggers in Admin → Playbooks.</p>}
        </CardBody>
      )}
    </Card>
  );
}

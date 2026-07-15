import { useState } from 'react';
import { useActivities } from '@/lib/hooks';
import { Chip, EmptyState } from '@/components/ui';
import { relativeTime, fmtDate } from '@/lib/utils';
import { Mail, Phone, Calendar, StickyNote, Gauge, Activity as ActivityIcon, Ticket, Info, ChevronDown } from 'lucide-react';
import type { Activity, ActivityType } from '@/lib/types';

const ICONS: Record<ActivityType, React.ComponentType<{ className?: string }>> = {
  email: Mail, call: Phone, meeting: Calendar, note: StickyNote, nps: Gauge, task: ActivityIcon, ticket: Ticket, system: Info,
};
const FILTERS: { key: ActivityType | 'all'; label: string }[] = [
  { key: 'all', label: 'All' }, { key: 'email', label: 'Emails' }, { key: 'meeting', label: 'Meetings' },
  { key: 'call', label: 'Calls' }, { key: 'note', label: 'Notes' }, { key: 'nps', label: 'NPS' },
];

export function TimelineTab({ companyId }: { companyId: string }) {
  const { data: activities = [] } = useActivities(companyId);
  const [filter, setFilter] = useState<ActivityType | 'all'>('all');
  const [limit, setLimit] = useState(30);

  const filtered = activities.filter((a) => filter === 'all' || a.type === filter);
  const visible = filtered.slice(0, limit);

  // group by day
  const groups: Record<string, Activity[]> = {};
  for (const a of visible) {
    const day = fmtDate(a.occurredAt);
    (groups[day] ??= []).push(a);
  }

  if (!activities.length) return <EmptyState icon={ActivityIcon} title="No activity yet" hint="Emails, meetings, calls and notes will appear here." />;

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button key={f.key} onClick={() => setFilter(f.key)} className={`rounded-md border px-2 py-1 text-sm font-medium ${filter === f.key ? 'border-[var(--accent)] bg-[var(--accent-tint)] text-[var(--accent)]' : 'text-muted-foreground hover:bg-panel'}`}>{f.label}</button>
        ))}
      </div>
      <div className="space-y-4">
        {Object.entries(groups).map(([day, items]) => (
          <div key={day}>
            <div className="mb-1.5 text-sm font-medium text-muted-foreground">{day}</div>
            <div className="space-y-1.5">
              {items.map((a) => <TimelineRow key={a.id} a={a} />)}
            </div>
          </div>
        ))}
      </div>
      {filtered.length > limit && (
        <button className="mx-auto mt-4 flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm hover:bg-panel" onClick={() => setLimit((l) => l + 30)}>
          <ChevronDown className="h-3.5 w-3.5" /> Load more ({filtered.length - limit})
        </button>
      )}
    </div>
  );
}

function TimelineRow({ a }: { a: Activity }) {
  const [open, setOpen] = useState(false);
  const Icon = ICONS[a.type] ?? Info;
  const expandable = a.type === 'email' || a.type === 'meeting' || a.type === 'call';
  return (
    <div className="rounded-md border">
      <button className="flex w-full items-start gap-2.5 px-3 py-2 text-left hover:bg-panel" onClick={() => expandable && setOpen(!open)}>
        <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-panel"><Icon className="h-3.5 w-3.5 text-muted-foreground" /></div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{a.title}</span>
            {a.direction && <Chip>{a.direction}</Chip>}
          </div>
          {a.snippet && <div className="truncate text-sm text-muted-foreground">{a.snippet}</div>}
        </div>
        <span className="shrink-0 text-sm text-muted-foreground">{relativeTime(a.occurredAt)}</span>
      </button>
      {open && (
        <div className="space-y-2 border-t px-3 py-2 text-sm">
          {a.snippet && <p className="text-base">{a.snippet}</p>}
          {!!a.meta.actionItems?.length && <Chips label="Action items" tone="accent" items={a.meta.actionItems} />}
          {!!a.meta.risks?.length && <Chips label="Risks" tone="red" items={a.meta.risks} />}
          {!!a.meta.asks?.length && <Chips label="Asks" tone="amber" items={a.meta.asks} />}
          {a.meta.fathomUrl && <a href={a.meta.fathomUrl} target="_blank" rel="noreferrer" className="text-[var(--accent)]">Fathom recording ↗</a>}
          {a.meta.transcriptUrl && <a href={a.meta.transcriptUrl} target="_blank" rel="noreferrer" className="text-[var(--accent)]">Aircall transcript ↗</a>}
        </div>
      )}
    </div>
  );
}

function Chips({ label, tone, items }: { label: string; tone: 'accent' | 'red' | 'amber'; items: string[] }) {
  return (
    <div>
      <div className="mb-0.5 text-xs font-medium text-muted-foreground">{label}</div>
      <div className="flex flex-wrap gap-1">{items.map((i, n) => <Chip key={n} tone={tone}>{i}</Chip>)}</div>
    </div>
  );
}

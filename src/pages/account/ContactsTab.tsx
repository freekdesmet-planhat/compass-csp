import { useContacts, useUpdateContact, useRecomputeHealth } from '@/lib/hooks';
import { DataTable } from '@/components/DataTable';
import { Chip, Card, CardHeader, CardTitle, CardBody, EmptyState, Avatar, Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui';
import { InlineText, InlineStepper } from '@/components/inline';
import { relativeTime } from '@/lib/utils';
import { Link } from 'react-router-dom';
import { Users, Star, Zap } from 'lucide-react';
import type { Contact, ContactRole } from '@/lib/types';

const ROLE_LABEL: Record<string, string> = { exec_sponsor: 'Exec Sponsor', decision_maker: 'Decision Maker', main_user: 'Main User', tech_ops: 'Tech / Ops', end_user: 'End User' };
const ROLES: ContactRole[] = ['exec_sponsor', 'decision_maker', 'main_user', 'tech_ops', 'end_user'];

export function ContactsTab({ companyId }: { companyId: string }) {
  const { data: contacts = [] } = useContacts(companyId);
  const updateContact = useUpdateContact();
  const recompute = useRecomputeHealth();
  const active = contacts.filter((c) => !c.archived);
  if (!active.length) return <EmptyState icon={Users} title="No contacts" />;

  // Role & relationship feed health (sentiment + engagement) → recompute (B4).
  const patch = (id: string, p: Partial<Contact>, recomputeHealth = false) => {
    updateContact.mutate({ id, patch: p });
    if (recomputeHealth) recompute.mutate(companyId);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <DataTable
          rows={active}
          rowKey={(c) => c.id}
          columns={[
            { key: 'name', header: 'Name', render: (c) => (
              <div className="flex items-center gap-2">
                <Avatar name={`${c.firstName} ${c.lastName}`} className="h-5 w-5 text-[10px]" />
                <div>
                  <Link to={`/contacts/${c.id}`} className="font-medium hover:text-[var(--accent)]">{c.firstName} {c.lastName}</Link>
                  <div className="text-xs text-muted-foreground"><InlineText value={c.title ?? ''} placeholder="title" onSave={(v) => patch(c.id, { title: v })} /></div>
                </div>
              </div>
            ) },
            { key: 'role', header: 'Role', render: (c) => (
              <Select value={c.contactRole ?? 'unset'} onValueChange={(v) => patch(c.id, { contactRole: v === 'unset' ? null : v as ContactRole }, true)}>
                <SelectTrigger className="h-7 w-36"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="unset">—</SelectItem>{ROLES.map((r) => <SelectItem key={r} value={r}>{ROLE_LABEL[r]}</SelectItem>)}</SelectContent>
              </Select>
            ) },
            { key: 'dept', header: 'Dept', render: (c) => <InlineText value={c.department ?? ''} placeholder="dept" onSave={(v) => patch(c.id, { department: v })} /> },
            { key: 'sen', header: 'Seniority', render: (c) => <InlineText value={c.seniority ?? ''} placeholder="seniority" onSave={(v) => patch(c.id, { seniority: v })} /> },
            { key: 'rel', header: 'Rel.', align: 'right', sortValue: (c) => c.relationshipStrength, render: (c) => (
              <InlineStepper value={c.relationshipStrength ?? 0} min={1} max={10} onSave={(v) => patch(c.id, { relationshipStrength: v }, true)} />
            ) },
            { key: 'badges', header: 'Flags', render: (c) => (
              <div className="flex gap-1">
                <BadgeToggle on={c.isChampion} tone="green" label="champion" icon={Star} onClick={() => patch(c.id, { isChampion: !c.isChampion })} />
                <BadgeToggle on={c.hasInfluence} tone="accent" label="influence" icon={Zap} onClick={() => patch(c.id, { hasInfluence: !c.hasInfluence })} />
                <BadgeToggle on={c.isAdvocate} tone="amber" label="advocate" onClick={() => patch(c.id, { isAdvocate: !c.isAdvocate })} />
              </div>
            ) },
            { key: 'touch', header: 'Last touch', align: 'right', sortValue: (c) => c.lastTouchAt, render: (c) => <span className="text-muted-foreground">{relativeTime(c.lastTouchAt)}</span> },
          ]}
        />
      </div>
      <Card>
        <CardHeader><CardTitle>Org mini-map</CardTitle></CardHeader>
        <CardBody><OrgMap contacts={active} /></CardBody>
      </Card>
    </div>
  );
}

function BadgeToggle({ on, tone, label, icon: Icon, onClick }: { on: boolean; tone: 'green' | 'accent' | 'amber'; label: string; icon?: React.ComponentType<{ className?: string }>; onClick: () => void }) {
  return (
    <button onClick={onClick} title={`Toggle ${label}`}>
      <Chip tone={on ? tone : 'neutral'} className={on ? '' : 'opacity-50'}>{Icon && <Icon className="h-3 w-3" />} {label}</Chip>
    </button>
  );
}

function OrgMap({ contacts }: { contacts: Contact[] }) {
  const roots = contacts.filter((c) => !c.reportsToContactId);
  const childrenOf = (id: string) => contacts.filter((c) => c.reportsToContactId === id);
  const Node = ({ c, depth }: { c: Contact; depth: number }) => (
    <div style={{ marginLeft: depth * 14 }} className="border-l pl-2">
      <div className="flex items-center gap-1.5 py-0.5">
        <Link to={`/contacts/${c.id}`} className="text-sm font-medium hover:text-[var(--accent)]">{c.firstName} {c.lastName}</Link>
        {c.contactRole && <span className="text-xs text-muted-foreground">{ROLE_LABEL[c.contactRole]}</span>}
      </div>
      {childrenOf(c.id).map((ch) => <Node key={ch.id} c={ch} depth={depth + 1} />)}
    </div>
  );
  return <div className="space-y-0.5">{roots.map((c) => <Node key={c.id} c={c} depth={0} />)}</div>;
}

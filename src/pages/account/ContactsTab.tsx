import { useContacts } from '@/lib/hooks';
import { DataTable } from '@/components/DataTable';
import { Chip, Card, CardHeader, CardTitle, CardBody, EmptyState, Avatar } from '@/components/ui';
import { relativeTime } from '@/lib/utils';
import { Users, Star, Zap } from 'lucide-react';
import type { Contact } from '@/lib/types';

const ROLE_LABEL: Record<string, string> = { exec_sponsor: 'Exec Sponsor', decision_maker: 'Decision Maker', main_user: 'Main User', tech_ops: 'Tech / Ops', end_user: 'End User' };

export function ContactsTab({ companyId }: { companyId: string }) {
  const { data: contacts = [] } = useContacts(companyId);
  const active = contacts.filter((c) => !c.archived);
  if (!active.length) return <EmptyState icon={Users} title="No contacts" />;

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
                <div><div className="font-medium">{c.firstName} {c.lastName}</div><div className="text-xs text-muted-foreground">{c.title}</div></div>
              </div>
            ) },
            { key: 'role', header: 'Role', render: (c) => c.contactRole ? <Chip>{ROLE_LABEL[c.contactRole]}</Chip> : '—' },
            { key: 'rel', header: 'Rel.', align: 'right', sortValue: (c) => c.relationshipStrength, render: (c) => <span className="tnum">{c.relationshipStrength ?? '—'}/10</span> },
            { key: 'badges', header: '', render: (c) => (
              <div className="flex gap-1">
                {c.isChampion && <Chip tone="green"><Star className="h-3 w-3" /> champion</Chip>}
                {c.hasInfluence && <Chip tone="accent"><Zap className="h-3 w-3" /> influence</Chip>}
                {c.isAdvocate && <Chip tone="amber">advocate</Chip>}
              </div>
            ) },
            { key: 'seq', header: 'Outreach', render: (c) => <OutreachCell contact={c} /> },
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

function OutreachCell({ contact }: { contact: Contact }) {
  // Deterministic demo: some contacts appear in an active Outreach sequence.
  const inSeq = (contact.engagementScore ?? 0) > 60;
  if (!inSeq) return <span className="text-muted-foreground">—</span>;
  return <Chip tone="accent">Seq · step {(contact.id.charCodeAt(contact.id.length - 1) % 4) + 1}</Chip>;
}

function OrgMap({ contacts }: { contacts: Contact[] }) {
  const roots = contacts.filter((c) => !c.reportsToContactId);
  const childrenOf = (id: string) => contacts.filter((c) => c.reportsToContactId === id);
  const Node = ({ c, depth }: { c: Contact; depth: number }) => (
    <div style={{ marginLeft: depth * 14 }} className="border-l pl-2">
      <div className="flex items-center gap-1.5 py-0.5">
        <span className="text-sm font-medium">{c.firstName} {c.lastName}</span>
        {c.contactRole && <span className="text-xs text-muted-foreground">{ROLE_LABEL[c.contactRole]}</span>}
      </div>
      {childrenOf(c.id).map((ch) => <Node key={ch.id} c={ch} depth={depth + 1} />)}
    </div>
  );
  return <div className="space-y-0.5">{roots.map((c) => <Node key={c.id} c={c} depth={0} />)}</div>;
}

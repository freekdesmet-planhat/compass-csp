import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader, PageBody } from '@/components/PageHeader';
import { DataTable } from '@/components/DataTable';
import { Chip, Avatar, Input, Select, SelectTrigger, SelectValue, SelectContent, SelectItem, EmptyState } from '@/components/ui';
import { useContacts, useVisibleCompanies } from '@/lib/hooks';
import { relativeTime } from '@/lib/utils';
import { Users, Star, Zap, Search } from 'lucide-react';
import type { Contact, ContactRole } from '@/lib/types';

const ROLE_LABEL: Record<string, string> = { exec_sponsor: 'Exec Sponsor', decision_maker: 'Decision Maker', main_user: 'Main User', tech_ops: 'Tech / Ops', end_user: 'End User' };

export default function ContactsPage() {
  const navigate = useNavigate();
  const { data: companies = [] } = useVisibleCompanies();
  const { data: allContacts = [] } = useContacts();
  const [q, setQ] = useState('');
  const [roleFilter, setRoleFilter] = useState<ContactRole | 'all'>('all');

  const visibleIds = useMemo(() => new Set(companies.map((c) => c.id)), [companies]);
  const companyName = useMemo(() => new Map(companies.map((c) => [c.id, c.name])), [companies]);

  const rows = useMemo(() => allContacts.filter((c) => {
    if (c.archived || !visibleIds.has(c.companyId)) return false;
    if (roleFilter !== 'all' && c.contactRole !== roleFilter) return false;
    if (q && !`${c.firstName} ${c.lastName} ${c.email ?? ''}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  }), [allContacts, visibleIds, roleFilter, q]);

  return (
    <div>
      <PageHeader
        title="Contacts"
        subtitle={`${rows.length} stakeholders across ${visibleIds.size} accounts`}
        actions={
          <div className="flex items-center gap-2">
            <div className="relative"><Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" /><Input className="w-52 pl-7" placeholder="Search contacts…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
            <Select value={roleFilter} onValueChange={(v) => setRoleFilter(v as ContactRole | 'all')}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Role" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All roles</SelectItem>
                {Object.entries(ROLE_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        }
      />
      <PageBody>
        <DataTable
          rows={rows}
          rowKey={(c) => c.id}
          onRowClick={(c) => navigate(`/company/${c.companyId}?tab=contacts`)}
          empty={<EmptyState icon={Users} title="No contacts match" />}
          defaultSort={{ key: 'rel', dir: 'desc' }}
          columns={[
            { key: 'name', header: 'Name', width: '22%', sortValue: (c) => c.lastName, render: (c) => (
              <div className="flex items-center gap-2"><Avatar name={`${c.firstName} ${c.lastName}`} className="h-5 w-5 text-[10px]" /><div><div className="font-medium">{c.firstName} {c.lastName}</div><div className="text-xs text-muted-foreground">{c.title}</div></div></div>
            ) },
            { key: 'company', header: 'Company', width: '16%', sortValue: (c) => companyName.get(c.companyId), render: (c) => <span className="text-muted-foreground">{companyName.get(c.companyId)}</span> },
            { key: 'role', header: 'Role', width: '13%', render: (c) => c.contactRole ? <Chip>{ROLE_LABEL[c.contactRole]}</Chip> : '—' },
            { key: 'rel', header: 'Rel.', align: 'right', width: '8%', sortValue: (c) => c.relationshipStrength, render: (c) => <span className="tnum">{c.relationshipStrength ?? '—'}/10</span> },
            { key: 'badges', header: '', width: '18%', render: (c) => (
              <div className="flex gap-1">
                {c.isChampion && <Chip tone="green"><Star className="h-3 w-3" /> champion</Chip>}
                {c.hasInfluence && <Chip tone="accent"><Zap className="h-3 w-3" /> influence</Chip>}
                {c.isAdvocate && <Chip tone="amber">advocate</Chip>}
              </div>
            ) },
            { key: 'outreach', header: 'Outreach', width: '13%', render: (c) => (c.engagementScore ?? 0) > 60 ? <Chip tone="accent">Seq · step {(c.id.charCodeAt(c.id.length - 1) % 4) + 1}</Chip> : <span className="text-muted-foreground">—</span> },
            { key: 'touch', header: 'Last touch', align: 'right', width: '10%', sortValue: (c) => c.lastTouchAt, render: (c) => <span className="text-muted-foreground">{relativeTime(c.lastTouchAt)}</span> },
          ]}
        />
      </PageBody>
    </div>
  );
}

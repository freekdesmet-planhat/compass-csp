import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import {
  Button, Chip, Avatar, EmptyState, Tabs, TabsList, TabsTrigger, TabsContent, Card, CardHeader,
  CardTitle, CardBody, Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui';
import { InlineText, InlineStepper } from '@/components/inline';
import {
  useContact, useCompany, useContacts, useActivities, useEmails, useNps, useTasks,
  useUpdateContact, useRecomputeHealth,
} from '@/lib/hooks';
import { fmtDate, relativeTime } from '@/lib/utils';
import { ArrowLeft, Mail, Phone, Linkedin, Star, Zap, Award, StickyNote, CheckSquare, Building2 } from 'lucide-react';
import type { Contact, ContactRole } from '@/lib/types';

const ROLE_LABEL: Record<string, string> = { exec_sponsor: 'Exec Sponsor', decision_maker: 'Decision Maker', main_user: 'Main User', tech_ops: 'Tech / Ops', end_user: 'End User' };
const ROLES: ContactRole[] = ['exec_sponsor', 'decision_maker', 'main_user', 'tech_ops', 'end_user'];
const TABS = ['activity', 'emails', 'meetings', 'outreach', 'nps', 'tasks', 'notes'] as const;

export default function ContactPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { data: contact, isLoading } = useContact(id);
  const { data: company } = useCompany(contact?.companyId);
  const { data: siblings = [] } = useContacts(contact?.companyId);
  const updateContact = useUpdateContact();
  const recompute = useRecomputeHealth();
  const tab = params.get('tab') ?? 'activity';

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!contact) return <div className="p-6"><EmptyState title="Contact not found" hint="It may be outside your visibility." action={<Button onClick={() => navigate('/contacts')}>Back to Contacts</Button>} /></div>;

  const patch = (p: Partial<Contact>, recomputeHealth = false) => {
    updateContact.mutate({ id: contact.id, patch: p });
    if (recomputeHealth && contact.companyId) recompute.mutate(contact.companyId);
  };
  const mailto = contact.email ? `mailto:${contact.email}` : undefined;

  return (
    <div>
      <PageHeader
        title={`${contact.firstName} ${contact.lastName}`}
        actions={<Button variant="ghost" size="sm" onClick={() => navigate(-1)}><ArrowLeft className="h-3.5 w-3.5" /> Back</Button>}
      >
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-base">
          <span className="text-muted-foreground">{contact.title ?? '—'}</span>
          {company && <Link to={`/company/${company.id}`} className="flex items-center gap-1 text-[var(--accent)] hover:underline"><Building2 className="h-3.5 w-3.5" />{company.name}</Link>}
          {contact.contactRole && <Chip tone="accent">{ROLE_LABEL[contact.contactRole]}</Chip>}
          <span className="flex items-center gap-1 text-sm text-muted-foreground">Relationship <span className="tnum font-medium text-foreground">{contact.relationshipStrength ?? '—'}/10</span></span>
          {contact.isChampion && <Chip tone="green"><Star className="h-3 w-3" /> champion</Chip>}
          {contact.hasInfluence && <Chip tone="accent"><Zap className="h-3 w-3" /> influence</Chip>}
          {contact.isAdvocate && <Chip tone="amber"><Award className="h-3 w-3" /> advocate</Chip>}
          <div className="ml-auto flex items-center gap-1.5">
            <Button size="sm" variant="outline" disabled={!mailto} onClick={() => company && navigate(`/company/${company.id}?tab=overview&compose=email`)}><Mail className="h-3.5 w-3.5" /> Email</Button>
            {contact.phone && <a href={`tel:${contact.phone}`}><Button size="sm" variant="outline"><Phone className="h-3.5 w-3.5" /> Call</Button></a>}
            {contact.linkedinUrl && <a href={contact.linkedinUrl} target="_blank" rel="noopener noreferrer"><Button size="sm" variant="outline"><Linkedin className="h-3.5 w-3.5" /></Button></a>}
          </div>
        </div>
      </PageHeader>

      <div className="grid gap-4 px-6 py-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Tabs value={tab} onValueChange={(v) => setParams({ tab: v })}>
            <TabsList>{TABS.map((t) => <TabsTrigger key={t} value={t} className="capitalize">{t}</TabsTrigger>)}</TabsList>
            <div className="pt-3">
              <TabsContent value="activity"><ActivityList contactId={contact.id} companyId={contact.companyId} /></TabsContent>
              <TabsContent value="emails"><EmailList contactId={contact.id} companyId={contact.companyId} /></TabsContent>
              <TabsContent value="meetings"><MeetingList contactId={contact.id} companyId={contact.companyId} /></TabsContent>
              <TabsContent value="outreach"><OutreachPanel contact={contact} /></TabsContent>
              <TabsContent value="nps"><NpsList contactId={contact.id} /></TabsContent>
              <TabsContent value="tasks"><TaskList contactId={contact.id} /></TabsContent>
              <TabsContent value="notes"><NotesList contactId={contact.id} companyId={contact.companyId} /></TabsContent>
            </div>
          </Tabs>
        </div>

        {/* Right attribute panel — fully inline-editable (B4 fields) */}
        <div className="space-y-3">
          <Card>
            <CardHeader className="py-2"><CardTitle className="text-sm text-muted-foreground">Attributes</CardTitle></CardHeader>
            <CardBody className="space-y-1.5 py-2.5 text-sm">
              <Attr k="Title"><InlineText value={contact.title ?? ''} placeholder="title" onSave={(v) => patch({ title: v })} /></Attr>
              <Attr k="Role">
                <Select value={contact.contactRole ?? 'unset'} onValueChange={(v) => patch({ contactRole: v === 'unset' ? null : v as ContactRole }, true)}>
                  <SelectTrigger className="h-7 w-40"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="unset">—</SelectItem>{ROLES.map((r) => <SelectItem key={r} value={r}>{ROLE_LABEL[r]}</SelectItem>)}</SelectContent>
                </Select>
              </Attr>
              <Attr k="Relationship"><InlineStepper value={contact.relationshipStrength ?? 0} min={1} max={10} onSave={(v) => patch({ relationshipStrength: v }, true)} /></Attr>
              <Attr k="Department"><InlineText value={contact.department ?? ''} placeholder="dept" onSave={(v) => patch({ department: v })} /></Attr>
              <Attr k="Seniority"><InlineText value={contact.seniority ?? ''} placeholder="seniority" onSave={(v) => patch({ seniority: v })} /></Attr>
              <Attr k="Email"><span>{contact.email ?? '—'}</span></Attr>
              <Attr k="Reports to">
                <Select value={contact.reportsToContactId ?? 'none'} onValueChange={(v) => patch({ reportsToContactId: v === 'none' ? null : v })}>
                  <SelectTrigger className="h-7 w-40"><SelectValue /></SelectTrigger>
                  <SelectContent className="max-h-56"><SelectItem value="none">—</SelectItem>{siblings.filter((s) => s.id !== contact.id).map((s) => <SelectItem key={s.id} value={s.id}>{s.firstName} {s.lastName}</SelectItem>)}</SelectContent>
                </Select>
              </Attr>
            </CardBody>
          </Card>
          <Card>
            <CardHeader className="py-2"><CardTitle className="text-sm text-muted-foreground">Where they sit</CardTitle></CardHeader>
            <CardBody className="py-2.5"><MiniOrgMap contacts={siblings} focusId={contact.id} /></CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Attr({ k, children }: { k: string; children: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-2"><span className="text-muted-foreground">{k}</span><span className="text-right">{children}</span></div>;
}

function ActivityList({ contactId, companyId }: { contactId: string; companyId: string }) {
  const { data: activities = [] } = useActivities(companyId);
  const rows = activities.filter((a) => a.contactIds.includes(contactId));
  if (!rows.length) return <EmptyState icon={StickyNote} title="No activity for this contact" />;
  return <div className="space-y-1">{rows.map((a) => (
    <div key={a.id} className="rounded-md border px-3 py-2"><div className="flex items-center justify-between"><span className="font-medium">{a.title}</span><span className="text-sm text-muted-foreground">{relativeTime(a.occurredAt)}</span></div><div className="text-sm text-muted-foreground">{a.snippet}</div></div>
  ))}</div>;
}

function EmailList({ contactId, companyId }: { contactId: string; companyId: string }) {
  const { data: emails = [] } = useEmails(companyId);
  const rows = emails.filter((e) => e.contactIds.includes(contactId));
  if (!rows.length) return <EmptyState icon={Mail} title="No emails" />;
  return <div className="space-y-1">{rows.map((e) => (
    <div key={e.id} className="rounded-md border px-3 py-2"><div className="flex items-center justify-between"><span className="font-medium">{e.subject}</span><span className="text-sm text-muted-foreground">{relativeTime(e.sentAt)}</span></div><div className="text-sm text-muted-foreground">{e.snippet}</div></div>
  ))}</div>;
}

function MeetingList({ contactId, companyId }: { contactId: string; companyId: string }) {
  const { data: activities = [] } = useActivities(companyId);
  const rows = activities.filter((a) => (a.type === 'meeting' || a.type === 'call') && a.contactIds.includes(contactId));
  if (!rows.length) return <EmptyState icon={CheckSquare} title="No meetings or calls" />;
  return <div className="space-y-1">{rows.map((a) => (
    <div key={a.id} className="rounded-md border px-3 py-2"><div className="flex items-center justify-between"><span className="font-medium">{a.title}</span><span className="text-sm text-muted-foreground">{relativeTime(a.occurredAt)}</span></div><div className="text-sm text-muted-foreground">{a.snippet}</div></div>
  ))}</div>;
}

function OutreachPanel({ contact }: { contact: Contact }) {
  const inSeq = (contact.engagementScore ?? 0) > 60;
  if (!inSeq) return <EmptyState icon={Mail} title="Not in an outreach sequence" />;
  return <Card><CardBody className="flex items-center gap-2"><Chip tone="accent">Active sequence</Chip><span className="text-sm">Step {(contact.id.charCodeAt(contact.id.length - 1) % 4) + 1} · engagement {contact.engagementScore}</span></CardBody></Card>;
}

function NpsList({ contactId }: { contactId: string }) {
  const { data: nps = [] } = useNps();
  const rows = nps.filter((n) => n.contactId === contactId);
  if (!rows.length) return <EmptyState icon={StickyNote} title="No NPS responses" />;
  return <div className="space-y-2">{rows.map((n) => (
    <Card key={n.id}><CardBody className="flex items-start gap-3"><Chip tone={n.score >= 50 ? 'green' : n.score < 0 ? 'red' : 'amber'}>{n.score}</Chip><div><p>{n.comment}</p><div className="text-sm text-muted-foreground">{fmtDate(n.respondedAt)}</div></div></CardBody></Card>
  ))}</div>;
}

function TaskList({ contactId }: { contactId: string }) {
  const { data: tasks = [] } = useTasks();
  const rows = tasks.filter((t) => t.contactId === contactId);
  if (!rows.length) return <EmptyState icon={CheckSquare} title="No tasks mention this contact" hint="Tasks linked to this contact appear here." />;
  return <div className="space-y-1">{rows.map((t) => (
    <div key={t.id} className="flex items-center justify-between rounded-md border px-3 py-2"><span className={t.completedAt ? 'text-muted-foreground line-through' : 'font-medium'}>{t.title}</span><span className="text-sm text-muted-foreground">{fmtDate(t.dueDate)}</span></div>
  ))}</div>;
}

function NotesList({ contactId, companyId }: { contactId: string; companyId: string }) {
  const { data: activities = [] } = useActivities(companyId);
  const rows = activities.filter((a) => a.type === 'note' && a.contactIds.includes(contactId));
  if (!rows.length) return <EmptyState icon={StickyNote} title="No notes" />;
  return <div className="space-y-2">{rows.map((n) => (
    <Card key={n.id}><CardBody><div className="mb-0.5 flex items-center justify-between"><span className="font-medium">{n.title}</span><span className="text-sm text-muted-foreground">{relativeTime(n.occurredAt)}</span></div><p className="text-base">{n.snippet}</p></CardBody></Card>
  ))}</div>;
}

function MiniOrgMap({ contacts, focusId }: { contacts: Contact[]; focusId: string }) {
  const roots = contacts.filter((c) => !c.reportsToContactId);
  const childrenOf = (id: string) => contacts.filter((c) => c.reportsToContactId === id);
  const Node = ({ c, depth }: { c: Contact; depth: number }) => (
    <div style={{ marginLeft: depth * 12 }} className="border-l pl-2">
      <div className="py-0.5">
        {c.id === focusId
          ? <span className="text-sm font-semibold text-[var(--accent)]">{c.firstName} {c.lastName}</span>
          : <Link to={`/contacts/${c.id}`} className="text-sm hover:text-[var(--accent)]">{c.firstName} {c.lastName}</Link>}
      </div>
      {childrenOf(c.id).map((ch) => <Node key={ch.id} c={ch} depth={depth + 1} />)}
    </div>
  );
  return <div className="space-y-0.5">{roots.map((c) => <Node key={c.id} c={c} depth={0} />)}</div>;
}

import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { Tabs, TabsList, TabsTrigger, TabsContent, Textarea, Input, Button, Chip } from '@/components/ui';
import { useLogActivity, useCreateTask, useContacts, useProfiles, useCreateNotification } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { useToast } from '@/components/toast';
import { gmailConnected } from '@/lib/integrations';
import { LogInteractionModal } from '@/components/modals';
import { Sparkles, MailWarning, AtSign, MessageSquarePlus } from 'lucide-react';
import type { Company } from '@/lib/types';

// Composer on the Overview: Note / Email / Task tabs. Email "send" logs an
// outbound activity immediately (send-gmail in live mode); if Gmail isn't
// connected it shows an inline "Connect Gmail in Settings" state (A1).
export function Composer({ company }: { company: Company }) {
  const [params] = useSearchParams();
  const [tab, setTab] = useState(params.get('compose') ?? 'note');
  const logActivity = useLogActivity();
  const createTask = useCreateTask();
  const createNotification = useCreateNotification();
  const { profile } = useSession();
  const { data: profiles = [] } = useProfiles();
  const { toast } = useToast();
  const { data: contacts = [] } = useContacts(company.id);
  const primary = contacts.find((c) => c.isPrimary) ?? contacts[0];

  // @mentions (D6): match @First or @First Last against active teammates.
  const mentioned = profiles.filter((p) => p.isActive && p.id !== profile.id && (
    note.toLowerCase().includes(`@${p.fullName.toLowerCase()}`) || note.toLowerCase().includes(`@${p.fullName.split(' ')[0].toLowerCase()}`)
  ));
  const logNote = async () => {
    await logActivity.mutateAsync({ companyId: company.id, type: 'note', title: 'Note', snippet: note });
    mentioned.forEach((p) => createNotification.mutate({ userId: p.id, kind: 'mention', title: `${profile.fullName} mentioned you`, body: `On ${company.name}: "${note.slice(0, 120)}"`, link: `/company/${company.id}?tab=notes` }));
    setNote('');
    toast(mentioned.length ? `Note logged · ${mentioned.length} mentioned` : 'Note logged');
  };

  // Keep the composer tab in sync with the ?compose= param so the header quick
  // actions work even when the composer is already mounted (the A1 bug).
  const composeParam = params.get('compose');
  useEffect(() => {
    if (composeParam) setTab(composeParam);
  }, [composeParam]);

  const [note, setNote] = useState('');
  const [subject, setSubject] = useState('');
  const [to, setTo] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [connected, setConnected] = useState(gmailConnected());
  const [logOpen, setLogOpen] = useState(false);

  useEffect(() => {
    const onChange = () => setConnected(gmailConnected());
    window.addEventListener('compass-gmail-changed', onChange);
    return () => window.removeEventListener('compass-gmail-changed', onChange);
  }, []);

  useEffect(() => { if (primary?.email && !to) setTo(primary.email); }, [primary, to]);

  return (
    <div className="rounded-lg border bg-white">
      <Tabs value={tab} onValueChange={setTab}>
        <div className="flex items-center justify-between pr-2">
          <TabsList className="px-2">
            <TabsTrigger value="note">Note</TabsTrigger>
            <TabsTrigger value="email">Email</TabsTrigger>
            <TabsTrigger value="task">Task</TabsTrigger>
          </TabsList>
          <button onClick={() => setLogOpen(true)} className="flex items-center gap-1 text-xs text-[var(--accent)] hover:underline"><MessageSquarePlus className="h-3.5 w-3.5" /> Log interaction</button>
        </div>
        <LogInteractionModal open={logOpen} onOpenChange={setLogOpen} companyId={company.id} />
        <div className="p-3">
          <TabsContent value="note">
            <Textarea rows={3} placeholder="Log a note… use @name to mention a teammate" value={note} onChange={(e) => setNote(e.target.value)} />
            {mentioned.length > 0 && <div className="mt-1.5 flex flex-wrap items-center gap-1 text-xs text-muted-foreground"><AtSign className="h-3 w-3" /> Notifying: {mentioned.map((p) => <Chip key={p.id} tone="accent">{p.fullName}</Chip>)}</div>}
            <div className="mt-2 flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => toast('Summarised to timeline snippet (AI)', { tone: 'info' })}><Sparkles className="h-3.5 w-3.5" /> Summarise</Button>
              <Button size="sm" variant="primary" disabled={!note.trim()} onClick={logNote}>Log note</Button>
            </div>
          </TabsContent>
          <TabsContent value="email">
            {!connected ? (
              <div className="flex flex-col items-start gap-2 rounded-md border border-dashed bg-panel/50 p-4">
                <div className="flex items-center gap-2 text-base font-medium"><MailWarning className="h-4 w-4 text-[var(--amber)]" /> Gmail isn't connected</div>
                <p className="text-sm text-muted-foreground">Connect your Google account to send and auto-log email from Compass.</p>
                <Link to="/settings"><Button size="sm" variant="primary">Connect Gmail in Settings</Button></Link>
              </div>
            ) : (
              <>
                <Input className="mb-2" placeholder="To" value={to} onChange={(e) => setTo(e.target.value)} />
                <Input className="mb-2" placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
                <Textarea rows={3} placeholder="Write an email…" value={emailBody} onChange={(e) => setEmailBody(e.target.value)} />
                <div className="mt-2 flex justify-end gap-2">
                  <Button size="sm" variant="ghost" onClick={() => toast('Draft reply generated (AI)', { tone: 'info' })}><Sparkles className="h-3.5 w-3.5" /> AI draft</Button>
                  <Button size="sm" variant="primary" disabled={!subject.trim() || !to.trim()} onClick={async () => { await logActivity.mutateAsync({ companyId: company.id, type: 'email', direction: 'outbound', title: subject, snippet: emailBody, contactIds: primary ? [primary.id] : [] }); setSubject(''); setEmailBody(''); toast('Email sent & logged'); }}>Send</Button>
                </div>
              </>
            )}
          </TabsContent>
          <TabsContent value="task">
            <Input placeholder="Task title" value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} />
            <div className="mt-2 flex justify-end">
              <Button size="sm" variant="primary" disabled={!taskTitle.trim()} onClick={async () => { await createTask.mutateAsync({ companyId: company.id, title: taskTitle }); setTaskTitle(''); toast('Task created'); }}>Create task</Button>
            </div>
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

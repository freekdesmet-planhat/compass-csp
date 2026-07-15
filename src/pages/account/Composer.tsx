import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsList, TabsTrigger, TabsContent, Textarea, Input, Button } from '@/components/ui';
import { useLogActivity, useCreateTask } from '@/lib/hooks';
import { useToast } from '@/components/toast';
import { Sparkles } from 'lucide-react';
import type { Company } from '@/lib/types';

// Composer on the Overview: Note / Email / Task tabs. Email "send" logs an
// outbound activity immediately (send-gmail in live mode).
export function Composer({ company }: { company: Company }) {
  const [params] = useSearchParams();
  const [tab, setTab] = useState(params.get('compose') ?? 'note');
  const logActivity = useLogActivity();
  const createTask = useCreateTask();
  const { toast } = useToast();

  const [note, setNote] = useState('');
  const [subject, setSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [taskTitle, setTaskTitle] = useState('');

  return (
    <div className="rounded-lg border bg-white">
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="px-2">
          <TabsTrigger value="note">Note</TabsTrigger>
          <TabsTrigger value="email">Email</TabsTrigger>
          <TabsTrigger value="task">Task</TabsTrigger>
        </TabsList>
        <div className="p-3">
          <TabsContent value="note">
            <Textarea rows={3} placeholder="Log a note…" value={note} onChange={(e) => setNote(e.target.value)} />
            <div className="mt-2 flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => toast('Summarised to timeline snippet (AI)', { tone: 'info' })}><Sparkles className="h-3.5 w-3.5" /> Summarise</Button>
              <Button size="sm" variant="primary" disabled={!note.trim()} onClick={async () => { await logActivity.mutateAsync({ companyId: company.id, type: 'note', title: 'Note', snippet: note }); setNote(''); toast('Note logged'); }}>Log note</Button>
            </div>
          </TabsContent>
          <TabsContent value="email">
            <Input className="mb-2" placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
            <Textarea rows={3} placeholder="Write an email… (sends via Gmail in live mode)" value={emailBody} onChange={(e) => setEmailBody(e.target.value)} />
            <div className="mt-2 flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => toast('Draft reply generated (AI)', { tone: 'info' })}><Sparkles className="h-3.5 w-3.5" /> AI draft</Button>
              <Button size="sm" variant="primary" disabled={!subject.trim()} onClick={async () => { await logActivity.mutateAsync({ companyId: company.id, type: 'email', direction: 'outbound', title: subject, snippet: emailBody }); setSubject(''); setEmailBody(''); toast('Email sent & logged'); }}>Send</Button>
            </div>
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

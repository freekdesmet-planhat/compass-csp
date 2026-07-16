// Shared modals used across the app: task creation (B5), log-interaction (D5),
// and manual NPS entry (A2). All use the existing ui primitives + hooks so they
// match V1's Attio language and optimistic-store pattern.
import { useState } from 'react';
import {
  Dialog, DialogContent, DialogTitle, Input, Textarea, Button, Select, SelectTrigger,
  SelectValue, SelectContent, SelectItem, Slider, Chip,
} from './ui';
import {
  useCreateTask, useProfiles, useObjectives, useContacts, useLogActivity,
  useRecomputeHealth, useCreateNps, useVisibleCompanies,
} from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { useToast } from './toast';
import type { TaskType } from '@/lib/types';
import { CheckSquare, Mail, Phone, UserCheck, Calendar } from 'lucide-react';

export const TASK_TYPE_META: Record<TaskType, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  todo: { label: 'To-do', icon: CheckSquare },
  email: { label: 'Email', icon: Mail },
  call: { label: 'Call', icon: Phone },
  check_in: { label: 'Check-in', icon: UserCheck },
  meeting: { label: 'Meeting', icon: Calendar },
};

// ── Task creation modal (B5) ──────────────────────────────────────────────────
export function TaskModal({
  open, onOpenChange, companyId, defaultTitle = '', defaultDescription = '', defaultDueDate,
}: {
  open: boolean; onOpenChange: (o: boolean) => void; companyId: string;
  defaultTitle?: string; defaultDescription?: string; defaultDueDate?: string | null;
}) {
  const { profile } = useSession();
  const { data: profiles = [] } = useProfiles();
  const { data: objectives = [] } = useObjectives(companyId);
  const createTask = useCreateTask();
  const { toast } = useToast();

  const [title, setTitle] = useState(defaultTitle);
  const [description, setDescription] = useState(defaultDescription);
  const [taskType, setTaskType] = useState<TaskType>('todo');
  const [dueDate, setDueDate] = useState(defaultDueDate ?? '');
  const [priority, setPriority] = useState<'low' | 'normal' | 'high'>('normal');
  const [assignee, setAssignee] = useState(profile.id);
  const [objectiveId, setObjectiveId] = useState('none');

  // Re-seed when reopened with fresh defaults (health-tab recommendations).
  const [seed, setSeed] = useState('');
  const key = `${open}-${defaultTitle}`;
  if (open && key !== seed) { setSeed(key); setTitle(defaultTitle); setDescription(defaultDescription); setDueDate(defaultDueDate ?? ''); }

  const active = profiles.filter((p) => p.isActive);
  const submit = async () => {
    await createTask.mutateAsync({
      companyId, title, description, taskType, dueDate: dueDate || null, priority, assigneeId: assignee,
      successPlanObjectiveId: objectiveId === 'none' ? null : objectiveId,
    });
    toast(assignee === profile.id ? 'Task created' : 'Task created & assignee notified');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogTitle className="text-md font-semibold">New task</DialogTitle>
        <div className="mt-3 space-y-3">
          <Input placeholder="Task title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          <Textarea rows={2} placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
          <div className="grid grid-cols-2 gap-2">
            <Field label="Type">
              <Select value={taskType} onValueChange={(v) => setTaskType(v as TaskType)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{(Object.keys(TASK_TYPE_META) as TaskType[]).map((t) => <SelectItem key={t} value={t}>{TASK_TYPE_META[t].label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Priority">
              <Select value={priority} onValueChange={(v) => setPriority(v as 'low' | 'normal' | 'high')}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="low">Low</SelectItem><SelectItem value="normal">Normal</SelectItem><SelectItem value="high">High</SelectItem></SelectContent>
              </Select>
            </Field>
            <Field label="Due date"><Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></Field>
            <Field label="Assignee">
              <Select value={assignee} onValueChange={setAssignee}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{active.map((p) => <SelectItem key={p.id} value={p.id}>{p.fullName}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          </div>
          {objectives.length > 0 && (
            <Field label="Link to objective (optional)">
              <Select value={objectiveId} onValueChange={setObjectiveId}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="none">None</SelectItem>{objectives.map((o) => <SelectItem key={o.id} value={o.id}>{o.title}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button variant="primary" disabled={!title.trim()} onClick={submit}>Create task</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Log-interaction composer (D5) ─────────────────────────────────────────────
const LOG_TYPES = [
  { value: 'in_person', label: 'In-person meeting', activity: 'meeting' as const },
  { value: 'call_unrecorded', label: 'Unrecorded call', activity: 'call' as const },
  { value: 'other', label: 'Other', activity: 'meeting' as const },
];

export function LogInteractionModal({
  open, onOpenChange, companyId, defaultType = 'in_person',
}: { open: boolean; onOpenChange: (o: boolean) => void; companyId: string; defaultType?: string }) {
  const { data: contacts = [] } = useContacts(companyId);
  const logActivity = useLogActivity();
  const createTask = useCreateTask();
  const recompute = useRecomputeHealth();
  const { toast } = useToast();

  const [type, setType] = useState(defaultType);
  const [summary, setSummary] = useState('');
  const [sentiment, setSentiment] = useState(6);
  const [selected, setSelected] = useState<string[]>([]);
  const [nextStep, setNextStep] = useState('');

  const seed = `${open}-${defaultType}`;
  const [lastSeed, setLastSeed] = useState('');
  if (open && seed !== lastSeed) { setLastSeed(seed); setType(defaultType); setSummary(''); setSentiment(6); setSelected([]); setNextStep(''); }

  const submit = async () => {
    const def = LOG_TYPES.find((t) => t.value === type) ?? LOG_TYPES[0];
    await logActivity.mutateAsync({
      companyId, type: def.activity, contactIds: selected,
      title: `${def.label} (logged manually)`, snippet: summary,
      meta: { sentiment: (sentiment - 5) / 5, logged_manually: true, interaction_type: type },
    });
    if (nextStep.trim()) await createTask.mutateAsync({ companyId, title: nextStep, taskType: 'check_in' });
    recompute.mutate(companyId);
    toast('Interaction logged');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogTitle className="text-md font-semibold">Log interaction</DialogTitle>
        <div className="mt-3 space-y-3">
          <Field label="Type">
            <Select value={type} onValueChange={setType}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{LOG_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Contacts involved">
            <div className="flex flex-wrap gap-1">
              {contacts.length === 0 && <span className="text-sm text-muted-foreground">No contacts</span>}
              {contacts.map((c) => {
                const on = selected.includes(c.id);
                return (
                  <button key={c.id} onClick={() => setSelected((s) => on ? s.filter((x) => x !== c.id) : [...s, c.id])}>
                    <Chip tone={on ? 'accent' : 'neutral'}>{c.firstName} {c.lastName}</Chip>
                  </button>
                );
              })}
            </div>
          </Field>
          <Field label="Summary"><Textarea rows={3} placeholder="What happened?" value={summary} onChange={(e) => setSummary(e.target.value)} /></Field>
          <Field label={`Sentiment: ${sentiment}/10`}>
            <Slider min={1} max={10} step={1} value={[sentiment]} onValueChange={(v) => setSentiment(v[0])} />
          </Field>
          <Field label="Next step (optional → creates a task)"><Input placeholder="e.g. Send follow-up recap" value={nextStep} onChange={(e) => setNextStep(e.target.value)} /></Field>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button variant="primary" disabled={!summary.trim()} onClick={submit}>Log interaction</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Manual NPS entry (A2) ─────────────────────────────────────────────────────
export function NpsModal({
  open, onOpenChange, companyId,
}: { open: boolean; onOpenChange: (o: boolean) => void; companyId?: string }) {
  const { data: companies = [] } = useVisibleCompanies();
  const createNps = useCreateNps();
  const { toast } = useToast();
  const [company, setCompany] = useState(companyId ?? '');
  const [score, setScore] = useState(50);
  const [comment, setComment] = useState('');

  const seed = `${open}`;
  const [lastSeed, setLastSeed] = useState('');
  if (open && seed !== lastSeed) { setLastSeed(seed); setCompany(companyId ?? ''); setScore(50); setComment(''); }

  const submit = async () => {
    if (!company) return;
    await createNps.mutateAsync({ companyId: company, score, comment });
    toast('NPS response logged');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogTitle className="text-md font-semibold">Log NPS response</DialogTitle>
        <div className="mt-3 space-y-3">
          {!companyId && (
            <Field label="Account">
              <Select value={company} onValueChange={setCompany}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Select account…" /></SelectTrigger>
                <SelectContent className="max-h-64">{companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          )}
          <Field label={`Score: ${score}`}>
            <Slider min={-100} max={100} step={5} value={[score]} onValueChange={(v) => setScore(v[0])} />
          </Field>
          <Field label="Comment"><Textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button variant="primary" disabled={!company} onClick={submit}>Log response</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><div className="mb-1 text-xs font-medium text-muted-foreground">{label}</div>{children}</div>;
}

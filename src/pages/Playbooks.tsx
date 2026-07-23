// Playbooks — V2 DB-driven Projects/Sequences (iteration2.md Part A, Phase 1).
// Template list + a drag-and-drop builder (groups, steps, timings, dependencies,
// owner refs). Conditions (entry/exit/group/step) arrive in Phase 2.
import { useEffect, useMemo, useState } from 'react';
import { PageHeader, PageBody } from '@/components/PageHeader';
import { Card, CardBody, Button, Chip, EmptyState, Input, Select, SelectTrigger, SelectValue, SelectContent, SelectItem, Switch } from '@/components/ui';
import { useSession } from '@/lib/session';
import { usePlaybookTemplates, usePlaybookGroups, usePlaybookSteps, usePlaybookMutations } from '@/lib/hooks';
import { RuleBuilder } from '@/components/RuleBuilder';
import { isEmptyRuleGroup } from '@/lib/rules';
import { Workflow, Plus, GripVertical, Trash2, ChevronLeft, Mail, CheckSquare, Layers, Filter } from 'lucide-react';
import type { PlaybookTemplate, PlaybookGroup, PlaybookStep } from '@/lib/types';

export default function PlaybooksPage() {
  const [openId, setOpenId] = useState<string | null>(null);
  if (openId) return <Builder templateId={openId} onBack={() => setOpenId(null)} />;
  return <TemplateList onOpen={setOpenId} />;
}

// ── Template list ────────────────────────────────────────────────────────────
function TemplateList({ onOpen }: { onOpen: (id: string) => void }) {
  const { profile } = useSession();
  const { data: templates = [], isLoading } = usePlaybookTemplates();
  const { createTemplate } = usePlaybookMutations();
  const canEdit = profile.role === 'manager' || profile.role === 'admin';

  const create = async () => {
    const t = await createTemplate.mutateAsync({ name: 'Untitled playbook', type: 'project' });
    if (t?.id) onOpen(t.id);
  };

  return (
    <div>
      <PageHeader title="Playbooks" subtitle={`${templates.length} templates`}
        actions={canEdit ? <Button variant="primary" onClick={create}><Plus className="h-3.5 w-3.5" /> New playbook</Button> : undefined} />
      <PageBody>
        {isLoading ? <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
          : templates.length === 0 ? <EmptyState icon={Workflow} title="No playbooks yet" hint={canEdit ? 'Create one to build a Project or Sequence.' : 'A manager or admin can create playbooks.'} action={canEdit ? <Button variant="primary" onClick={create}><Plus className="h-3.5 w-3.5" /> New playbook</Button> : undefined} />
          : (
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {templates.map((t) => (
                <button key={t.id} onClick={() => onOpen(t.id)} className="rounded-lg border bg-white p-4 text-left transition hover:border-[var(--accent)] hover:shadow-sm">
                  <div className="flex items-center gap-2">
                    {t.type === 'sequence' ? <Mail className="h-4 w-4 text-muted-foreground" /> : <Layers className="h-4 w-4 text-muted-foreground" />}
                    <span className="flex-1 truncate font-medium">{t.name}</span>
                    <Chip tone={t.status === 'live' ? 'green' : t.status === 'archived' ? 'neutral' : 'amber'}>{t.status}</Chip>
                  </div>
                  {t.description && <p className="mt-1.5 line-clamp-2 text-sm text-muted-foreground">{t.description}</p>}
                  <div className="mt-2 flex flex-wrap items-center gap-1">
                    <Chip tone="accent">{t.type}</Chip>
                    <Chip>{t.targetModel.replace('_', ' ')}</Chip>
                    {(t.segment ?? []).map((s) => <Chip key={s}>{s.replace('_', ' ')}</Chip>)}
                  </div>
                </button>
              ))}
            </div>
          )}
      </PageBody>
    </div>
  );
}

const OWNER_ROLES = [{ value: 'account_owner', label: 'Account Owner (CSM)' }, { value: 'manager', label: 'Manager' }];
const CONVERSATION_TYPES = ['call', 'email', 'meeting', 'check_in', 'todo'];
const TARGET_MODELS = ['company', 'contact', 'opportunity', 'success_plan', 'renewal'];

// ── Builder ──────────────────────────────────────────────────────────────────
function Builder({ templateId, onBack }: { templateId: string; onBack: () => void }) {
  const { profile } = useSession();
  const { data: templates = [] } = usePlaybookTemplates();
  const { data: groups = [] } = usePlaybookGroups(templateId);
  const { data: steps = [] } = usePlaybookSteps(templateId);
  const m = usePlaybookMutations();
  const template = templates.find((t) => t.id === templateId);
  const canEdit = profile.role === 'manager' || profile.role === 'admin';

  const [ordered, setOrdered] = useState<PlaybookStep[]>(steps);
  useEffect(() => { setOrdered(steps); }, [steps]);
  const [dragId, setDragId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const stepsByGroup = useMemo(() => {
    const map = new Map<string | null, PlaybookStep[]>();
    for (const s of ordered) { const k = s.groupId ?? null; (map.get(k) ?? map.set(k, []).get(k)!).push(s); }
    return map;
  }, [ordered]);

  if (!template) return <div className="p-6"><Button variant="ghost" onClick={onBack}><ChevronLeft className="h-4 w-4" /> Back</Button><EmptyState icon={Workflow} title="Playbook not found" /></div>;

  // Reassign positions per group, persist only the rows that moved.
  const persistOrder = (next: PlaybookStep[]) => {
    const updates: { id: string; position: number; groupId: string | null }[] = [];
    const counters = new Map<string | null, number>();
    const renumbered = next.map((s) => {
      const g = s.groupId ?? null; const pos = counters.get(g) ?? 0; counters.set(g, pos + 1);
      if (s.position !== pos || (s.groupId ?? null) !== g) updates.push({ id: s.id, position: pos, groupId: g });
      return { ...s, position: pos };
    });
    setOrdered(renumbered);
    if (updates.length) m.reorderSteps.mutate(updates);
  };
  const onDropOnStep = (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    const src = ordered.find((s) => s.id === dragId); const tgt = ordered.find((s) => s.id === targetId);
    if (!src || !tgt) return;
    const without = ordered.filter((s) => s.id !== dragId);
    const idx = without.findIndex((s) => s.id === targetId);
    without.splice(idx, 0, { ...src, groupId: tgt.groupId ?? null });
    persistOrder(without); setDragId(null);
  };
  const onDropOnGroup = (groupId: string | null) => {
    if (!dragId) return;
    const src = ordered.find((s) => s.id === dragId); if (!src) return;
    persistOrder([...ordered.filter((s) => s.id !== dragId), { ...src, groupId }]); setDragId(null);
  };

  return (
    <div>
      <PageHeader title={template.name || 'Untitled playbook'} subtitle={`${template.type} · ${template.targetModel.replace('_', ' ')} · ${template.status}`}
        actions={<Button variant="ghost" onClick={onBack}><ChevronLeft className="h-4 w-4" /> Back</Button>} />
      <PageBody>
        {/* Toolbar: name + type/target/status */}
        <Card className="mb-4">
          <CardBody className="flex flex-wrap items-center gap-2">
            <Input value={template.name} disabled={!canEdit} onChange={(e) => m.updateTemplate.mutate({ id: template.id, patch: { name: e.target.value } })} className="h-8 w-64 font-medium" placeholder="Playbook name" />
            <div className="flex-1" />
            <Select value={template.type} onValueChange={(v) => canEdit && m.updateTemplate.mutate({ id: template.id, patch: { type: v as PlaybookTemplate['type'] } })}>
              <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="project">Project</SelectItem><SelectItem value="sequence">Sequence</SelectItem></SelectContent>
            </Select>
            <Select value={template.targetModel} onValueChange={(v) => canEdit && m.updateTemplate.mutate({ id: template.id, patch: { targetModel: v as PlaybookTemplate['targetModel'] } })}>
              <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
              <SelectContent>{TARGET_MODELS.map((x) => <SelectItem key={x} value={x}>{x.replace('_', ' ')}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={template.status} onValueChange={(v) => canEdit && m.updateTemplate.mutate({ id: template.id, patch: { status: v as PlaybookTemplate['status'] } })}>
              <SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="draft">Draft</SelectItem><SelectItem value="live">Live</SelectItem><SelectItem value="archived">Archived</SelectItem></SelectContent>
            </Select>
          </CardBody>
        </Card>

        {!canEdit && <Card className="mb-3"><CardBody className="py-2 text-sm text-muted-foreground">Read-only — managers and admins can edit playbooks.</CardBody></Card>}

        {/* Entry / exit criteria (§5) */}
        <Card className="mb-4">
          <CardBody className="space-y-4">
            <div>
              <div className="mb-1.5 flex items-center gap-2 text-sm font-medium"><Filter className="h-3.5 w-3.5 text-muted-foreground" /> Entry criteria
                <span className="text-xs font-normal text-muted-foreground">— auto-apply when a {template.targetModel.replace('_', ' ')} matches</span></div>
              <RuleBuilder value={template.entryCriteria} disabled={!canEdit} onChange={(v) => m.updateTemplate.mutate({ id: template.id, patch: { entryCriteria: v } })} />
            </div>
            <div className="border-t pt-3">
              <div className="mb-1.5 flex flex-wrap items-center gap-2 text-sm font-medium"><Filter className="h-3.5 w-3.5 text-muted-foreground" /> Exit criteria
                <span className="text-xs font-normal text-muted-foreground">— auto-archive when matched</span>
                <div className="flex-1" />
                <span className="text-xs font-normal text-muted-foreground">Remaining steps:</span>
                <Select value={template.exitArchiveAction} onValueChange={(v) => canEdit && m.updateTemplate.mutate({ id: template.id, patch: { exitArchiveAction: v as PlaybookTemplate['exitArchiveAction'] } })}>
                  <SelectTrigger className="h-7 w-40"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="keep_remaining">Keep remaining</SelectItem><SelectItem value="cancel_remaining">Cancel remaining</SelectItem></SelectContent>
                </Select>
              </div>
              <RuleBuilder value={template.exitCriteria} disabled={!canEdit} onChange={(v) => m.updateTemplate.mutate({ id: template.id, patch: { exitCriteria: v } })} />
            </div>
          </CardBody>
        </Card>

        <div className="space-y-4">
          {groups.map((g) => (
            <GroupSection key={g.id} group={g} steps={stepsByGroup.get(g.id) ?? []} canEdit={canEdit} m={m} templateId={templateId}
              dragId={dragId} setDragId={setDragId} onDropOnStep={onDropOnStep} onDropOnGroup={() => onDropOnGroup(g.id)}
              editingId={editingId} setEditingId={setEditingId} allSteps={ordered} />
          ))}
          {(stepsByGroup.get(null)?.length ?? 0) > 0 && (
            <GroupSection group={null} steps={stepsByGroup.get(null) ?? []} canEdit={canEdit} m={m} templateId={templateId}
              dragId={dragId} setDragId={setDragId} onDropOnStep={onDropOnStep} onDropOnGroup={() => onDropOnGroup(null)}
              editingId={editingId} setEditingId={setEditingId} allSteps={ordered} />
          )}
          {canEdit && <Button variant="outline" onClick={() => m.createGroup.mutate({ templateId, name: 'New group', position: groups.length })}><Plus className="h-3.5 w-3.5" /> Add group</Button>}
        </div>
      </PageBody>
    </div>
  );
}

type Mutations = ReturnType<typeof usePlaybookMutations>;

function GroupSection({ group, steps, canEdit, m, templateId, dragId, setDragId, onDropOnStep, onDropOnGroup, editingId, setEditingId, allSteps }: {
  group: PlaybookGroup | null; steps: PlaybookStep[]; canEdit: boolean; m: Mutations; templateId: string;
  dragId: string | null; setDragId: (id: string | null) => void; onDropOnStep: (id: string) => void; onDropOnGroup: () => void;
  editingId: string | null; setEditingId: (id: string | null) => void; allSteps: PlaybookStep[];
}) {
  const [showCond, setShowCond] = useState(false);
  const hasCond = group ? !isEmptyRuleGroup(group.groupCondition) : false;
  return (
    <Card onDragOver={(e) => e.preventDefault()} onDrop={onDropOnGroup}>
      <CardBody>
        <div className="mb-2 flex items-center gap-2">
          <Layers className="h-4 w-4 text-muted-foreground" />
          {group ? <Input value={group.name ?? ''} disabled={!canEdit} onChange={(e) => m.updateGroup.mutate({ id: group.id, patch: { name: e.target.value } })} className="h-7 w-56 font-medium" />
            : <span className="font-medium text-muted-foreground">Ungrouped</span>}
          <span className="text-xs text-muted-foreground">{steps.length} steps</span>
          <div className="flex-1" />
          {group && <button title="Group condition" onClick={() => setShowCond((s) => !s)} className={`flex items-center gap-1 rounded px-1.5 py-1 text-xs hover:bg-panel ${hasCond ? 'text-[var(--accent)]' : 'text-muted-foreground'}`}><Filter className="h-3.5 w-3.5" />{hasCond && <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />}</button>}
          {canEdit && group && <button title="Delete group" onClick={() => m.deleteGroup.mutate(group.id)} className="rounded p-1 text-muted-foreground hover:bg-panel hover:text-[var(--red)]"><Trash2 className="h-3.5 w-3.5" /></button>}
        </div>
        {group && showCond && (
          <div className="mb-2 rounded-md border bg-panel/40 p-3">
            <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs font-medium">Group condition <span className="font-normal text-muted-foreground">— activate/deactivate this group's steps</span>
              <div className="flex-1" />
              <Select value={group.expireBehavior} onValueChange={(v) => canEdit && m.updateGroup.mutate({ id: group.id, patch: { expireBehavior: v } })}>
                <SelectTrigger className="h-7 w-52"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="keep">Keep steps when unmatched</SelectItem><SelectItem value="expire">Expire steps when unmatched</SelectItem></SelectContent>
              </Select>
            </div>
            <RuleBuilder value={group.groupCondition} disabled={!canEdit} onChange={(v) => m.updateGroup.mutate({ id: group.id, patch: { groupCondition: v } })} />
          </div>
        )}
        <div className="space-y-1.5">
          {steps.map((s) => (
            <StepRow key={s.id} step={s} canEdit={canEdit} m={m} dragId={dragId} setDragId={setDragId} onDropOnStep={onDropOnStep}
              editing={editingId === s.id} setEditing={(v) => setEditingId(v ? s.id : null)} allSteps={allSteps} />
          ))}
          {steps.length === 0 && <div className="rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">Drag steps here, or add one below.</div>}
        </div>
        {canEdit && group && (
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => m.createStep.mutate({ templateId, groupId: group.id, position: steps.length, stepType: 'task' })}><CheckSquare className="h-3.5 w-3.5" /> Task step</Button>
            <Button size="sm" variant="ghost" onClick={() => m.createStep.mutate({ templateId, groupId: group.id, position: steps.length, stepType: 'email' })}><Mail className="h-3.5 w-3.5" /> Email step</Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function StepRow({ step, canEdit, m, dragId, setDragId, onDropOnStep, editing, setEditing, allSteps }: {
  step: PlaybookStep; canEdit: boolean; m: Mutations; dragId: string | null; setDragId: (id: string | null) => void;
  onDropOnStep: (id: string) => void; editing: boolean; setEditing: (v: boolean) => void; allSteps: PlaybookStep[];
}) {
  const set = (patch: Partial<PlaybookStep>) => m.updateStep.mutate({ id: step.id, patch });
  const depOptions = allSteps.filter((s) => s.id !== step.id);
  return (
    <div draggable={canEdit} onDragStart={() => setDragId(step.id)} onDragEnd={() => setDragId(null)}
      onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.stopPropagation(); onDropOnStep(step.id); }}
      className={`rounded-md border bg-white ${dragId === step.id ? 'opacity-50' : ''}`}>
      <div className="flex items-center gap-2 px-2 py-1.5">
        {canEdit && <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-muted-foreground" />}
        {step.stepType === 'email' ? <Mail className="h-3.5 w-3.5 shrink-0 text-[var(--accent)]" /> : <CheckSquare className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
        <Input value={step.title ?? ''} disabled={!canEdit} onChange={(e) => set({ title: e.target.value })} className="h-7 flex-1" />
        <Chip tone={step.priority === 'high' ? 'red' : 'neutral'}>{step.priority ?? 'normal'}</Chip>
        <span className="w-16 text-right text-xs text-muted-foreground">day +{step.startAfterDays}</span>
        <button onClick={() => setEditing(!editing)} className="rounded px-2 py-0.5 text-xs text-[var(--accent)] hover:bg-panel">{editing ? 'Close' : 'Edit'}</button>
        {canEdit && <button title="Delete step" onClick={() => m.deleteStep.mutate(step.id)} className="rounded p-1 text-muted-foreground hover:bg-panel hover:text-[var(--red)]"><Trash2 className="h-3.5 w-3.5" /></button>}
      </div>
      {editing && (
        <div className="grid gap-3 border-t bg-panel/40 px-3 py-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Owner">
            <Select value={step.ownerRef?.value ?? 'account_owner'} onValueChange={(v) => set({ ownerRef: { kind: 'role', value: v } })} disabled={!canEdit}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent>{OWNER_ROLES.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          {step.stepType === 'task' && (
            <Field label="Conversation type">
              <Select value={step.conversationType ?? 'todo'} onValueChange={(v) => set({ conversationType: v })} disabled={!canEdit}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>{CONVERSATION_TYPES.map((c) => <SelectItem key={c} value={c}>{c.replace('_', ' ')}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
          )}
          <Field label="Priority">
            <Select value={step.priority ?? 'normal'} onValueChange={(v) => set({ priority: v })} disabled={!canEdit}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="low">Low</SelectItem><SelectItem value="normal">Normal</SelectItem><SelectItem value="high">High</SelectItem></SelectContent>
            </Select>
          </Field>
          <Field label="Start after (days)"><Input type="number" value={step.startAfterDays} disabled={!canEdit} onChange={(e) => set({ startAfterDays: Number(e.target.value) || 0 })} className="h-8" /></Field>
          <Field label="Duration (days)"><Input type="number" value={step.durationDays ?? ''} disabled={!canEdit} onChange={(e) => set({ durationDays: e.target.value === '' ? null : Number(e.target.value) })} className="h-8" /></Field>
          <Field label="Workdays only"><div className="flex h-8 items-center"><Switch checked={step.workdaysOnly} onCheckedChange={(v: boolean) => set({ workdaysOnly: v })} disabled={!canEdit} /></div></Field>
          <Field label="Depends on">
            <Select value={step.dependsOnStepId ?? 'none'} onValueChange={(v) => set({ dependsOnStepId: v === 'none' ? null : v })} disabled={!canEdit}>
              <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="none">—</SelectItem>{depOptions.map((d) => <SelectItem key={d.id} value={d.id}>{d.title || 'Untitled step'}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          {step.dependsOnStepId && (
            <Field label="When parent is">
              <Select value={step.dependencyTrigger?.kind ?? 'done'} onValueChange={(v) => set({ dependencyTrigger: { kind: v as 'done' | 'ignored' | 'not_completed_within', days: step.dependencyTrigger?.days } })} disabled={!canEdit}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="done">Done</SelectItem><SelectItem value="ignored">Ignored</SelectItem><SelectItem value="not_completed_within">Overdue N days</SelectItem></SelectContent>
              </Select>
            </Field>
          )}
          <Field label="Description" className="sm:col-span-2 lg:col-span-3">
            <textarea value={step.description ?? ''} disabled={!canEdit} onChange={(e) => set({ description: e.target.value })} rows={2}
              placeholder="Instructions for whoever completes this step…" className="w-full rounded-md border px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-[var(--accent)]" />
          </Field>
          <div className="border-t pt-3 sm:col-span-2 lg:col-span-3">
            <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs font-medium">Step condition
              <span className="font-normal text-muted-foreground">— turns this step on when matched (never off again)</span>
              <div className="flex-1" />
              <span className="font-normal text-muted-foreground">Before active:</span>
              <Select value={step.stepConditionDisplay ?? 'hidden'} onValueChange={(v) => set({ stepConditionDisplay: v as 'hidden' | 'muted' })} disabled={!canEdit}>
                <SelectTrigger className="h-7 w-24"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="hidden">Hidden</SelectItem><SelectItem value="muted">Muted</SelectItem></SelectContent>
              </Select>
            </div>
            <RuleBuilder value={step.stepCondition} disabled={!canEdit} onChange={(v) => set({ stepCondition: v })} />
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return <label className={`block ${className ?? ''}`}><span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>{children}</label>;
}

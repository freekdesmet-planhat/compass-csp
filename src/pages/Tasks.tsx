import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader, PageBody } from '@/components/PageHeader';
import { Card, CardHeader, CardTitle, CardBody, Chip, Button, Tabs, TabsList, TabsTrigger, TabsContent, EmptyState, Progress, Skeleton } from '@/components/ui';
import { useTasks, useVisibleCompanies, useToggleTask } from '@/lib/hooks';
import { TaskModal } from '@/components/modals';
import { fmtDate, daysUntil, cn } from '@/lib/utils';
import { CheckSquare, Plus, ListChecks } from 'lucide-react';
import type { Task } from '@/lib/types';

export default function TasksPage() {
  const navigate = useNavigate();
  const { data: companies = [], isLoading: companiesLoading } = useVisibleCompanies();
  const { data: allTasks = [], isLoading: tasksLoading } = useTasks();
  const loading = companiesLoading || tasksLoading;
  const [groupBy, setGroupBy] = useState<'company' | 'due'>('due');
  const [newTask, setNewTask] = useState(false);

  const companyById = useMemo(() => new Map(companies.map((c) => [c.id, c])), [companies]);
  const visibleIds = useMemo(() => new Set(companies.map((c) => c.id)), [companies]);
  const myTasks = allTasks.filter((t) => visibleIds.has(t.companyId));

  const buckets = {
    day: myTasks.filter((t) => !t.completedAt && (daysUntil(t.dueDate) ?? 99) <= 0),
    week: myTasks.filter((t) => !t.completedAt && (daysUntil(t.dueDate) ?? 99) <= 7),
    all: myTasks,
  };

  return (
    <div>
      <PageHeader
        title="Tasks"
        subtitle={`${buckets.day.length} due today/overdue · ${myTasks.filter((t) => !t.completedAt).length} open · ${myTasks.length} total`}
        actions={
          <div className="flex items-center gap-2">
            <div className="flex rounded-md border p-0.5">
              <button onClick={() => setGroupBy('due')} className={`rounded px-2 py-1 text-sm font-medium ${groupBy === 'due' ? 'bg-panel' : 'text-muted-foreground'}`}>By due</button>
              <button onClick={() => setGroupBy('company')} className={`rounded px-2 py-1 text-sm font-medium ${groupBy === 'company' ? 'bg-panel' : 'text-muted-foreground'}`}>By company</button>
            </div>
            <Button size="sm" variant="primary" onClick={() => setNewTask(true)}><Plus className="h-3.5 w-3.5" /> New task</Button>
          </div>
        }
      />
      <TaskModal open={newTask} onOpenChange={setNewTask} />
      <PageBody>
        <Tabs defaultValue="day">
          <TabsList className="mb-3">
            <TabsTrigger value="day">My Day ({buckets.day.length})</TabsTrigger>
            <TabsTrigger value="week">My Week ({buckets.week.length})</TabsTrigger>
            <TabsTrigger value="all">All ({myTasks.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="day"><TaskList tasks={buckets.day} groupBy={groupBy} companyById={companyById} navigate={navigate} loading={loading} /></TabsContent>
          <TabsContent value="week"><TaskList tasks={buckets.week} groupBy={groupBy} companyById={companyById} navigate={navigate} loading={loading} /></TabsContent>
          <TabsContent value="all">
            <TaskList tasks={myTasks} groupBy={groupBy} companyById={companyById} navigate={navigate} loading={loading} />
            <PlaybookProgress tasks={myTasks} companyById={companyById} />
          </TabsContent>
        </Tabs>
      </PageBody>
    </div>
  );
}

function TaskList({ tasks, groupBy, companyById, navigate, loading }: { tasks: Task[]; groupBy: 'company' | 'due'; companyById: Map<string, { name: string }>; navigate: (p: string) => void; loading?: boolean }) {
  const toggle = useToggleTask();
  if (loading) return <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full rounded-lg" />)}</div>;
  if (!tasks.length) return <EmptyState icon={CheckSquare} title="Nothing here" hint="You're all caught up." />;

  const groups: Record<string, Task[]> = {};
  for (const t of tasks) {
    const key = groupBy === 'company' ? (companyById.get(t.companyId)?.name ?? 'Unknown') : (t.completedAt ? 'Completed' : (daysUntil(t.dueDate) ?? 99) < 0 ? 'Overdue' : t.dueDate ? fmtDate(t.dueDate) : 'No due date');
    (groups[key] ??= []).push(t);
  }

  return (
    <div className="space-y-4">
      {Object.entries(groups).map(([g, items]) => (
        <div key={g}>
          <div className="mb-1 flex items-center gap-2 text-sm font-medium text-muted-foreground">{g === 'Overdue' && <Chip tone="red">overdue</Chip>}{g}</div>
          <div className="rounded-lg border bg-white">
            {items.map((t) => {
              const overdue = !t.completedAt && (daysUntil(t.dueDate) ?? 99) < 0;
              return (
                <div key={t.id} className="flex items-center gap-2.5 border-b px-3 py-2 last:border-0 hover:bg-panel/60">
                  <button onClick={() => toggle.mutate(t)} className={cn('flex h-4 w-4 items-center justify-center rounded border', t.completedAt ? 'border-[var(--green)] bg-[var(--green)] text-white' : 'border-[#d0d5dd]')}>
                    {t.completedAt && <CheckSquare className="h-3 w-3" />}
                  </button>
                  <span className={cn('flex-1', t.completedAt && 'text-muted-foreground line-through', !t.title?.trim() && 'italic text-muted-foreground')}>{t.title?.trim() || 'Untitled task'}</span>
                  {t.origin !== 'manual' && <Chip>{t.origin.replace(/_/g, ' ')}</Chip>}
                  {t.priority === 'high' && <Chip tone="red">high</Chip>}
                  <button className="text-sm text-muted-foreground hover:text-[var(--accent)]" onClick={() => navigate(`/company/${t.companyId}?tab=tasks`)}>{companyById.get(t.companyId)?.name}</button>
                  <span className={cn('w-20 text-right text-sm', overdue ? 'text-[var(--red)]' : 'text-muted-foreground')}>{fmtDate(t.dueDate)}</span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function PlaybookProgress({ tasks, companyById }: { tasks: Task[]; companyById: Map<string, { name: string }> }) {
  const pb = tasks.filter((t) => t.origin === 'playbook');
  if (!pb.length) return null;
  const byCompany: Record<string, Task[]> = {};
  for (const t of pb) (byCompany[t.companyId] ??= []).push(t);
  return (
    <Card className="mt-4">
      <CardHeader><CardTitle className="flex items-center gap-2"><ListChecks className="h-4 w-4 text-muted-foreground" /> Playbook progress</CardTitle></CardHeader>
      <CardBody className="space-y-2">
        {Object.entries(byCompany).map(([cid, items]) => {
          const done = items.filter((t) => t.completedAt).length;
          return (
            <div key={cid} className="flex items-center gap-3">
              <span className="w-40 truncate text-sm font-medium">{companyById.get(cid)?.name}</span>
              <Progress value={(done / items.length) * 100} className="max-w-xs" tone="green" />
              <span className="text-sm text-muted-foreground tnum">{done}/{items.length} steps</span>
            </div>
          );
        })}
      </CardBody>
    </Card>
  );
}


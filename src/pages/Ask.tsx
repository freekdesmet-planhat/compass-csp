// Ask Compass (D1) — chat with an agent about your book. In live mode this posts
// to the ask-compass Edge Function (tool-use loop, hard-filtered by
// visible_company_ids). In demo mode a scoped local engine answers over the
// in-browser store — it only ever sees useVisibleCompanies(), so it can never
// surface another CSM's account (acceptance #4 / the security test).
import { useState, useMemo, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import { Button, Textarea, Avatar } from '@/components/ui';
import { useVisibleCompanies, useDeals, useTasks, useAskThreads, useAskMessages, useAskSend } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { getDb } from '@/lib/store';
import { fmtCurrency, daysUntil } from '@/lib/utils';
import { SEGMENT_PRESETS } from '@/lib/segments';
import { MessageSquare, Send, Plus, Sparkles } from 'lucide-react';
import type { Company, UsageMetric } from '@/lib/types';

const STARTERS: Record<string, string[]> = {
  scaled: ['Which of my accounts renew in Q4 with declining usage?', "Who haven't I touched in 60 days?", 'List my red-health accounts'],
  mid_touch: ['Which renewals are at risk this quarter?', 'Summarise everything that happened with my top account', 'Where is my expansion whitespace?'],
  enterprise: ['Which of my accounts renew in Q4 with declining usage?', 'Summarise the last month for my largest account', 'Who are my single-threaded accounts?'],
};

function usageTrend(companyId: string): number {
  const series = (getDb().usageMetrics as UsageMetric[]).filter((u) => u.companyId === companyId && u.metricKey === 'weekly_active_users').sort((a, b) => +new Date(a.metricDate) - +new Date(b.metricDate));
  if (series.length < 5) return 0;
  return series[series.length - 1].value - series[series.length - 5].value;
}
function quarterOf(d?: string | null): string | null {
  if (!d) return null;
  const dt = new Date(d);
  return `Q${Math.floor(dt.getMonth() / 3) + 1}`;
}

export default function AskPage() {
  const { profile } = useSession();
  const { data: companies = [] } = useVisibleCompanies();
  const { data: deals = [] } = useDeals();
  const { data: tasks = [] } = useTasks();
  const { data: threads = [] } = useAskThreads();
  const send = useAskSend();

  const [threadId, setThreadId] = useState<string | undefined>(undefined);
  const { data: messages = [] } = useAskMessages(threadId);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => { scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight); }, [messages, thinking]);

  const starters = STARTERS[profile.segment ?? 'mid_touch'];

  // Scoped local answer engine (demo). Returns text + referenced company ids.
  const answer = useMemo(() => (msg: string): { text: string; ids: string[]; tools: { name: string }[] } => {
    const q = msg.toLowerCase();
    const withArr = (c: Company) => `${c.name} (${fmtCurrency(c.arr)})`;
    if (q.includes('usage') && (q.includes('renew') || q.includes('q4') || q.includes('quarter'))) {
      const hits = companies.filter((c) => quarterOf(c.renewalDate) === 'Q4' && (daysUntil(c.renewalDate) ?? -1) >= 0 && usageTrend(c.id) < 0);
      return { text: hits.length ? `${hits.length} of your accounts renew in Q4 with declining 4-week usage:\n${hits.map((c) => `• ${withArr(c)} — WAU trend ${usageTrend(c.id)}`).join('\n')}` : "None of your Q4 renewals show declining usage right now.", ids: hits.map((c) => c.id), tools: [{ name: 'list_renewals' }, { name: 'get_usage' }] };
    }
    if (q.includes('touch') || q.includes("haven't")) {
      const days = parseInt(q.match(/(\d+)\s*day/)?.[1] ?? '60', 10);
      const hits = companies.filter((c) => (c.lastTouchAt ? Math.abs(daysUntil(c.lastTouchAt) ?? 0) : 9999) >= days).slice(0, 15);
      return { text: hits.length ? `${hits.length} accounts with no touch in ${days}+ days:\n${hits.map((c) => `• ${c.name}`).join('\n')}` : `You've touched every account within ${days} days. 🎉`, ids: hits.map((c) => c.id), tools: [{ name: 'search_companies' }] };
    }
    if (q.includes('risk') || q.includes('red') || (q.includes('health') && (q.includes('low') || q.includes('poor')))) {
      const hits = companies.filter((c) => c.healthBand === 'red' || (c.healthBand === 'amber' && (daysUntil(c.renewalDate) ?? 999) <= 90));
      return { text: `${hits.length} at-risk accounts (${fmtCurrency(hits.reduce((a, c) => a + (c.arr ?? 0), 0))} ARR):\n${hits.slice(0, 15).map((c) => `• ${withArr(c)} — health ${c.healthScore}`).join('\n')}`, ids: hits.map((c) => c.id), tools: [{ name: 'aggregate_portfolio' }, { name: 'get_health_breakdown' }] };
    }
    if (q.includes('summar')) {
      const named = companies.find((c) => q.includes(c.name.toLowerCase())) ?? [...companies].sort((a, b) => (b.arr ?? 0) - (a.arr ?? 0))[0];
      if (!named) return { text: "I couldn't find that account in your book.", ids: [], tools: [{ name: 'search_companies' }] };
      const acts = (getDb().activities).filter((a) => a.companyId === named.id).slice(0, 5);
      const open = tasks.filter((t) => t.companyId === named.id && !t.completedAt).length;
      return { text: `Summary for ${named.name}: health ${named.healthScore} (${named.healthBand}), ARR ${fmtCurrency(named.arr)}, renews ${named.renewalDate}. ${open} open tasks. Recent: ${acts.map((a) => a.title).join('; ') || 'no recent activity'}.`, ids: [named.id], tools: [{ name: 'get_company_360' }, { name: 'search_activities' }] };
    }
    if (q.includes('renew')) {
      const hits = companies.filter((c) => { const d = daysUntil(c.renewalDate); return d != null && d >= 0 && d <= 120; }).sort((a, b) => (daysUntil(a.renewalDate) ?? 0) - (daysUntil(b.renewalDate) ?? 0));
      return { text: `${hits.length} renewals in the next 120 days:\n${hits.slice(0, 15).map((c) => `• ${withArr(c)} — T-${daysUntil(c.renewalDate)}`).join('\n')}`, ids: hits.map((c) => c.id), tools: [{ name: 'list_renewals' }] };
    }
    const total = companies.reduce((a, c) => a + (c.arr ?? 0), 0);
    return { text: `Your book: ${companies.length} accounts, ${fmtCurrency(total)} ARR. ${companies.filter((c) => c.healthBand === 'red').length} red, ${deals.filter((d) => d.pipeline === 'expansion' && d.status === 'open').length} open expansion deals. Ask me about renewals, usage, risk, or a specific account.`, ids: [], tools: [{ name: 'aggregate_portfolio' }] };
  }, [companies, deals, tasks]);

  const idToCompany = useMemo(() => new Map(companies.map((c) => [c.id, c])), [companies]);

  const submit = async (text: string) => {
    if (!text.trim()) return;
    setInput('');
    setThinking(true);
    const res = answer(text);
    await new Promise((r) => setTimeout(r, 600)); // simulate tool-use loop
    const tid = await send.mutateAsync({ threadId, message: text, answer: `${res.text}${res.ids.length ? `\n\n__REFS__${res.ids.join(',')}` : ''}`, toolCalls: res.tools });
    setThreadId(tid);
    setThinking(false);
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Ask Compass" subtitle="Your book, answered — no tab-hopping" />
      <div className="flex flex-1 overflow-hidden">
        {/* Thread list */}
        <div className="w-56 shrink-0 border-r bg-panel/40 p-2">
          <Button size="sm" variant="outline" className="mb-2 w-full" onClick={() => setThreadId(undefined)}><Plus className="h-3.5 w-3.5" /> New chat</Button>
          <div className="space-y-0.5">
            {threads.map((t) => (
              <button key={t.id} onClick={() => setThreadId(t.id)} className={`block w-full truncate rounded-md px-2 py-1.5 text-left text-sm hover:bg-white ${threadId === t.id ? 'bg-white font-medium' : 'text-muted-foreground'}`}>{t.title}</button>
            ))}
          </div>
        </div>

        {/* Chat pane */}
        <div className="flex flex-1 flex-col">
          <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-6">
            {messages.length === 0 && !thinking && (
              <div className="mx-auto max-w-lg pt-8 text-center">
                <Sparkles className="mx-auto h-6 w-6 text-[var(--accent)]" />
                <div className="mt-2 text-md font-semibold">Ask anything about your book</div>
                <div className="mt-4 space-y-2">
                  {starters.map((s) => <button key={s} onClick={() => submit(s)} className="block w-full rounded-md border bg-white px-3 py-2 text-left text-sm hover:border-[var(--accent)]">{s}</button>)}
                </div>
              </div>
            )}
            {messages.map((m) => <Bubble key={m.id} role={m.role} content={m.content} toolCalls={m.toolCalls} idToCompany={idToCompany} />)}
            {thinking && <div className="flex items-center gap-2 text-sm text-muted-foreground"><span className="h-2 w-2 animate-pulse rounded-full bg-[var(--accent)]" /> Checking your book…</div>}
          </div>
          <div className="border-t p-3">
            <div className="flex items-end gap-2">
              <Textarea rows={1} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(input); } }} placeholder="Ask about renewals, usage, risk, an account…" className="resize-none" />
              <Button variant="primary" disabled={!input.trim() || thinking} onClick={() => submit(input)}><Send className="h-4 w-4" /></Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Bubble({ role, content, toolCalls, idToCompany }: { role: string; content: string; toolCalls?: { name: string }[] | null; idToCompany: Map<string, Company> }) {
  const user = role === 'user';
  const [body, refsRaw] = content.split('\n\n__REFS__');
  const refIds = refsRaw ? refsRaw.split(',') : [];
  return (
    <div className={`flex gap-2 ${user ? 'justify-end' : ''}`}>
      {!user && <div className="mt-0.5"><Avatar name="Compass" /></div>}
      <div className={`max-w-[80%] rounded-lg px-3 py-2 text-base ${user ? 'bg-[var(--accent)] text-white' : 'border bg-white'}`}>
        {!user && toolCalls && toolCalls.length > 0 && <div className="mb-1 flex flex-wrap gap-1">{toolCalls.map((t, i) => <span key={i} className="rounded bg-panel px-1.5 py-0.5 text-[10px] text-muted-foreground">{t.name}</span>)}</div>}
        <div className="whitespace-pre-wrap">{body}</div>
        {refIds.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {refIds.map((id) => { const c = idToCompany.get(id); return c ? <Link key={id} to={`/company/${id}`} className="rounded-md border bg-panel px-1.5 py-0.5 text-sm text-[var(--accent)] hover:underline">{c.name}</Link> : null; })}
          </div>
        )}
      </div>
    </div>
  );
}

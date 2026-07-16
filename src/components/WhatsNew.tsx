// "What's new" (D7) — sidebar sparkle button opening a slide-over grouped by
// version. Unread dot when profile.last_seen_version < latest; viewing clears it.
import { useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { Sheet, Chip, Tooltip } from './ui';
import { useChangelog, useUpdateProfile } from '@/lib/hooks';
import { useSession } from '@/lib/session';
import { fmtDate } from '@/lib/utils';
import { cn } from '@/lib/utils';
import type { ChangelogCategory } from '@/lib/types';

const CAT_TONE: Record<ChangelogCategory, 'green' | 'accent' | 'amber'> = { new: 'green', improved: 'accent', fixed: 'amber' };

// Compare dotted version strings (1.1.0 vs 1.0.0).
function cmpVersion(a: string, b: string): number {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}

export function WhatsNew({ collapsed }: { collapsed?: boolean }) {
  const [open, setOpen] = useState(false);
  const { profile } = useSession();
  const { data: entries = [] } = useChangelog();
  const updateProfile = useUpdateProfile();

  const versions = [...new Set(entries.map((e) => e.version))].sort((a, b) => cmpVersion(b, a));
  const latest = versions[0];
  const hasUnread = latest != null && (profile.lastSeenVersion == null || cmpVersion(profile.lastSeenVersion, latest) < 0);

  const openPanel = () => {
    setOpen(true);
    if (latest && hasUnread) updateProfile.mutate({ id: profile.id, patch: { lastSeenVersion: latest } });
  };

  const trigger = (
    <button onClick={openPanel} className={cn('relative flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:bg-white/60 hover:text-foreground')} aria-label="What's new">
      <Sparkles className="h-4 w-4" />
      {hasUnread && <span className="absolute right-0.5 top-0.5 h-2 w-2 rounded-full bg-[var(--accent)]" />}
    </button>
  );

  return (
    <>
      {collapsed ? <Tooltip content="What's new">{trigger}</Tooltip> : trigger}
      <Sheet open={open} onOpenChange={setOpen}>
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-[var(--accent)]" /><span className="text-md font-semibold">What's new</span></div>
            <button onClick={() => setOpen(false)} className="rounded p-1 text-muted-foreground hover:bg-panel"><X className="h-4 w-4" /></button>
          </div>
          <div className="flex-1 space-y-5 overflow-y-auto p-4">
            {versions.map((v) => {
              const items = entries.filter((e) => e.version === v).sort((a, b) => a.position - b.position);
              const date = items[0]?.releasedOn;
              return (
                <div key={v}>
                  <div className="mb-2 flex items-baseline gap-2"><span className="text-md font-semibold">v{v}</span>{date && <span className="text-xs text-muted-foreground">{fmtDate(date)}</span>}</div>
                  <div className="space-y-2">
                    {items.map((e) => (
                      <div key={e.id} className="flex items-start gap-2">
                        <Chip tone={CAT_TONE[e.category]}>{e.category}</Chip>
                        <div className="min-w-0"><div className="text-sm font-medium">{e.title}</div>{e.body && <div className="text-xs text-muted-foreground">{e.body}</div>}</div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </Sheet>
    </>
  );
}

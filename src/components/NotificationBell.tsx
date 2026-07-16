// In-app notification bell (D6). Unread count + dropdown + mark-all-read.
// In live mode a Supabase Realtime subscription pushes new rows; the demo store
// updates optimistically via the hooks.
import { useNavigate } from 'react-router-dom';
import { Bell, AtSign, CheckSquare, Info } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent, Button } from './ui';
import { useNotifications, useMarkNotificationsRead } from '@/lib/hooks';
import { relativeTime } from '@/lib/utils';
import { cn } from '@/lib/utils';
import type { NotificationKind } from '@/lib/types';

const ICON: Record<NotificationKind, React.ComponentType<{ className?: string }>> = {
  mention: AtSign, task_assigned: CheckSquare, system: Info,
};

export function NotificationBell() {
  const navigate = useNavigate();
  const { data: notifications = [] } = useNotifications();
  const markRead = useMarkNotificationsRead();
  const unread = notifications.filter((n) => !n.readAt).length;

  return (
    <Popover>
      <PopoverTrigger className="relative flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-panel hover:text-foreground">
        <Bell className="h-4 w-4" />
        {unread > 0 && <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--red)] px-1 text-[10px] font-semibold text-white tnum">{unread}</span>}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[340px] p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-semibold">Notifications</span>
          {unread > 0 && <Button size="sm" variant="ghost" onClick={() => markRead.mutate(undefined)}>Mark all read</Button>}
        </div>
        <div className="max-h-[380px] overflow-y-auto">
          {notifications.length === 0 && <div className="px-3 py-8 text-center text-sm text-muted-foreground">No notifications</div>}
          {notifications.map((n) => {
            const Icon = ICON[n.kind] ?? Info;
            return (
              <button
                key={n.id}
                onClick={() => { markRead.mutate(n.id); if (n.link) navigate(n.link); }}
                className={cn('flex w-full items-start gap-2 border-b px-3 py-2 text-left last:border-0 hover:bg-panel', !n.readAt && 'bg-[var(--accent-tint)]/40')}
              >
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{n.title}</div>
                  {n.body && <div className="line-clamp-2 text-xs text-muted-foreground">{n.body}</div>}
                  <div className="text-xs text-muted-foreground">{relativeTime(n.createdAt)}</div>
                </div>
                {!n.readAt && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[var(--accent)]" />}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

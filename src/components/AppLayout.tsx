import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  Home, LayoutGrid, Handshake, CheckSquare, Bell, Target, Users, Gauge, BarChart3,
  Settings, Shield, Compass, Search, ChevronsUpDown, MessageSquare, BookOpen,
  PanelLeftClose, PanelLeftOpen, Upload, Workflow, Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSession } from '@/lib/session';
import { useAlerts, useUpdateProfile } from '@/lib/hooks';
import { Avatar, Popover, PopoverTrigger, PopoverContent, Chip, Tooltip, TooltipProvider } from './ui';
import { CommandPalette } from './CommandPalette';
import { NotificationBell } from './NotificationBell';
import { WhatsNew } from './WhatsNew';
import { SEGMENT_LABELS } from '@/lib/segments';

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  roles?: ('csm' | 'manager' | 'admin')[];
  badge?: number;
}

const SIDEBAR_KEY = 'compass-sidebar-collapsed';

export function AppLayout() {
  const { profile } = useSession();
  const { data: alerts } = useAlerts();
  const updateProfile = useUpdateProfile();
  const openAlerts = (alerts ?? []).filter((a) => a.status === 'open' && (profile.role === 'admin' || a.ownerId === profile.id || profile.role === 'manager')).length;

  const [collapsed, setCollapsed] = useState(() => {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem(SIDEBAR_KEY);
      if (saved != null) return saved === '1';
    }
    return !!profile.sidebarCollapsed;
  });

  const toggle = () => {
    setCollapsed((c) => {
      const next = !c;
      if (typeof localStorage !== 'undefined') localStorage.setItem(SIDEBAR_KEY, next ? '1' : '0');
      updateProfile.mutate({ id: profile.id, patch: { sidebarCollapsed: next } });
      return next;
    });
  };

  // "[" toggles the sidebar (ignored while typing in an input/textarea).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '[' || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      e.preventDefault();
      toggle();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const nav: NavItem[] = [
    { to: '/', label: 'Home', icon: Home },
    { to: '/ask', label: 'Ask Compass', icon: MessageSquare },
    { to: '/portfolio', label: 'Portfolio', icon: LayoutGrid },
    { to: '/renewals', label: 'Renewals', icon: Handshake },
    { to: '/tasks', label: 'Tasks', icon: CheckSquare },
    { to: '/alerts', label: 'Alerts', icon: Bell, badge: openAlerts },
    { to: '/success-plans', label: 'Success Plans', icon: Target },
    { to: '/contacts', label: 'Contacts', icon: Users },
    { to: '/nps', label: 'NPS & CSAT', icon: Gauge },
    { to: '/playbooks', label: 'Playbooks', icon: Workflow },
    { to: '/automations', label: 'Automations', icon: Zap, roles: ['admin'] },
    { to: '/library', label: 'Library', icon: BookOpen },
    { to: '/reports', label: 'Reports', icon: BarChart3 },
  ];
  const bottomNav: NavItem[] = [
    { to: '/import', label: 'Import', icon: Upload },
    { to: '/settings', label: 'Settings', icon: Settings },
    { to: '/admin', label: 'Admin', icon: Shield, roles: ['admin'] },
  ];

  const visible = (item: NavItem) => !item.roles || item.roles.includes(profile.role);
  const width = collapsed ? 64 : 232;

  return (
    <TooltipProvider>
      <div className="flex h-screen overflow-hidden bg-white text-foreground">
        <CommandPalette />
        {/* Sidebar */}
        <aside className="flex shrink-0 flex-col border-r bg-panel transition-[width] duration-150" style={{ width }}>
          <div className={cn('flex items-center gap-2 px-3 py-3', collapsed && 'justify-center px-0')}>
            <Compass className="h-5 w-5 shrink-0 text-[var(--accent)]" />
            {!collapsed && <span className="text-md font-semibold">Compass</span>}
          </div>
          <SearchButton collapsed={collapsed} />
          <nav className="mt-1 flex-1 space-y-0.5 overflow-y-auto px-2">
            {nav.filter(visible).map((item) => <SidebarLink key={item.to} item={item} collapsed={collapsed} />)}
            <div className="my-2 border-t" />
            {bottomNav.filter(visible).map((item) => <SidebarLink key={item.to} item={item} collapsed={collapsed} />)}
          </nav>
          <div className={cn('flex items-center gap-1 px-2 py-1.5', collapsed && 'flex-col')}>
            <WhatsNew collapsed={collapsed} />
            <button onClick={toggle} title="Toggle sidebar ([)" className="flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:bg-white/60 hover:text-foreground">
              {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            </button>
          </div>
          <UserSwitcher collapsed={collapsed} />
        </aside>

        {/* Main */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="flex h-11 shrink-0 items-center justify-end gap-2 border-b bg-white px-4">
            <NotificationBell />
          </div>
          <main className="flex-1 overflow-y-auto">
            <Outlet />
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}

function SidebarLink({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const link = (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      className={({ isActive }) =>
        cn(
          'flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-base font-medium transition-colors',
          collapsed && 'justify-center px-0',
          isActive ? 'bg-white text-foreground shadow-sm' : 'text-muted-foreground hover:bg-white/60 hover:text-foreground'
        )
      }
    >
      <item.icon className="h-4 w-4 shrink-0" />
      {!collapsed && <span className="min-w-0 flex-1 truncate">{item.label}</span>}
      {!collapsed && item.badge ? <Chip tone="red" className="px-1 py-0 text-xs">{item.badge}</Chip> : null}
    </NavLink>
  );
  if (collapsed) return <Tooltip content={item.label}>{link}</Tooltip>;
  return link;
}

function SearchButton({ collapsed }: { collapsed: boolean }) {
  const trigger = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }));
  if (collapsed) {
    return (
      <Tooltip content="Search (⌘K)">
        <button onClick={trigger} className="mx-auto mt-1 flex h-8 w-8 items-center justify-center rounded-md border bg-white text-muted-foreground hover:border-[var(--accent)]">
          <Search className="h-3.5 w-3.5" />
        </button>
      </Tooltip>
    );
  }
  return (
    <button onClick={trigger} className="mx-2 mt-1 flex items-center gap-2 rounded-md border bg-white px-2 py-1.5 text-sm text-muted-foreground hover:border-[var(--accent)]">
      <Search className="h-3.5 w-3.5" />
      <span className="min-w-0 flex-1 truncate text-left">Search…</span>
      <span className="kbd">⌘K</span>
    </button>
  );
}

function UserSwitcher({ collapsed }: { collapsed: boolean }) {
  const { profile, allProfiles, switchUser } = useSession();
  const navigate = useNavigate();
  return (
    <div className="border-t p-2">
      <Popover>
        <PopoverTrigger className={cn('flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 hover:bg-white/60', collapsed && 'justify-center px-0')}>
          <Avatar name={profile.fullName} url={profile.avatarUrl} />
          {!collapsed && (
            <>
              <div className="min-w-0 flex-1 overflow-hidden text-left">
                <div className="truncate text-base font-medium">{profile.fullName}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {profile.role}{profile.segment ? ` · ${SEGMENT_LABELS[profile.segment]}` : ''}
                </div>
              </div>
              <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </>
          )}
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[260px]">
          <div className="px-2 py-1 text-xs text-muted-foreground">Switch user (demo — RLS perspective)</div>
          {allProfiles.map((p) => (
            <button
              key={p.id}
              onClick={() => { switchUser(p.id); navigate('/'); }}
              className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-base hover:bg-panel', p.id === profile.id && 'bg-panel')}
            >
              <Avatar name={p.fullName} />
              <div className="flex-1 text-left">
                <div className="truncate font-medium">{p.fullName}</div>
                <div className="text-xs text-muted-foreground">{p.role}{p.segment ? ` · ${SEGMENT_LABELS[p.segment]}` : ''}</div>
              </div>
            </button>
          ))}
        </PopoverContent>
      </Popover>
    </div>
  );
}

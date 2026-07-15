import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  Home, LayoutGrid, Handshake, CheckSquare, Bell, Target, Users, Gauge, BarChart3,
  Settings, Shield, Compass, Search, ChevronsUpDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSession } from '@/lib/session';
import { useAlerts } from '@/lib/hooks';
import { Avatar, Popover, PopoverTrigger, PopoverContent, Chip } from './ui';
import { CommandPalette } from './CommandPalette';
import { SEGMENT_LABELS } from '@/lib/segments';

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  roles?: ('csm' | 'manager' | 'admin')[];
  badge?: number;
}

export function AppLayout() {
  const { profile } = useSession();
  const { data: alerts } = useAlerts();
  const openAlerts = (alerts ?? []).filter((a) => a.status === 'open' && (profile.role === 'admin' || a.ownerId === profile.id || profile.role === 'manager')).length;

  const nav: NavItem[] = [
    { to: '/', label: 'Home', icon: Home },
    { to: '/portfolio', label: 'Portfolio', icon: LayoutGrid },
    { to: '/renewals', label: 'Renewals', icon: Handshake },
    { to: '/tasks', label: 'Tasks', icon: CheckSquare },
    { to: '/alerts', label: 'Alerts', icon: Bell, badge: openAlerts },
    { to: '/success-plans', label: 'Success Plans', icon: Target },
    { to: '/contacts', label: 'Contacts', icon: Users },
    { to: '/nps', label: 'NPS & CSAT', icon: Gauge },
    { to: '/reports', label: 'Reports', icon: BarChart3, roles: ['manager', 'admin'] },
  ];
  const bottomNav: NavItem[] = [
    { to: '/settings', label: 'Settings', icon: Settings },
    { to: '/admin', label: 'Admin', icon: Shield, roles: ['admin'] },
  ];

  const visible = (item: NavItem) => !item.roles || item.roles.includes(profile.role);

  return (
    <div className="flex h-screen overflow-hidden bg-white text-foreground">
      <CommandPalette />
      {/* Sidebar */}
      <aside className="flex w-sidebar shrink-0 flex-col border-r bg-panel" style={{ width: 232 }}>
        <div className="flex items-center gap-2 px-3 py-3">
          <Compass className="h-5 w-5 text-[var(--accent)]" />
          <span className="text-md font-semibold">Compass</span>
        </div>
        <SearchButton />
        <nav className="mt-1 flex-1 space-y-0.5 px-2">
          {nav.filter(visible).map((item) => (
            <SidebarLink key={item.to} item={item} />
          ))}
          <div className="my-2 border-t" />
          {bottomNav.filter(visible).map((item) => (
            <SidebarLink key={item.to} item={item} />
          ))}
        </nav>
        <UserSwitcher />
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}

function SidebarLink({ item }: { item: NavItem }) {
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-2 rounded-md px-2 py-1.5 text-base font-medium transition-colors',
          isActive ? 'bg-white text-foreground shadow-sm' : 'text-muted-foreground hover:bg-white/60 hover:text-foreground'
        )
      }
    >
      <item.icon className="h-4 w-4" />
      <span className="flex-1">{item.label}</span>
      {item.badge ? <Chip tone="red" className="px-1 py-0 text-xs">{item.badge}</Chip> : null}
    </NavLink>
  );
}

function SearchButton() {
  return (
    <button
      onClick={() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))}
      className="mx-2 mt-1 flex items-center gap-2 rounded-md border bg-white px-2 py-1.5 text-sm text-muted-foreground hover:border-[var(--accent)]"
    >
      <Search className="h-3.5 w-3.5" />
      <span className="flex-1 text-left">Search…</span>
      <span className="kbd">⌘K</span>
    </button>
  );
}

function UserSwitcher() {
  const { profile, allProfiles, switchUser } = useSession();
  const navigate = useNavigate();
  return (
    <div className="border-t p-2">
      <Popover>
        <PopoverTrigger className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 hover:bg-white/60">
          <Avatar name={profile.fullName} url={profile.avatarUrl} />
          <div className="flex-1 overflow-hidden text-left">
            <div className="truncate text-base font-medium">{profile.fullName}</div>
            <div className="truncate text-xs text-muted-foreground">
              {profile.role}{profile.segment ? ` · ${SEGMENT_LABELS[profile.segment]}` : ''}
            </div>
          </div>
          <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" />
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

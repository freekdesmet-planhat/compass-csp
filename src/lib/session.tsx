import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { isDemoMode } from './supabase';
import { getDb } from './store';
import type { Profile } from './types';

// Session context — the currently signed-in profile. In demo mode you can
// switch between the seeded users (admin / manager / 3 CSMs) to explore RLS
// perspectives without real auth.

interface SessionCtx {
  profile: Profile;
  allProfiles: Profile[];
  isDemo: boolean;
  switchUser: (id: string) => void;
  signOut: () => void;
}

const Ctx = createContext<SessionCtx | null>(null);

const DEMO_USER_KEY = 'compass-demo-user';

export function SessionProvider({ children }: { children: ReactNode }) {
  const profiles = getDb().profiles;
  const [profileId, setProfileId] = useState<string>(() => {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(DEMO_USER_KEY) : null;
    return saved && profiles.some((p) => p.id === saved) ? saved : profiles.find((p) => p.role === 'csm' && p.segment === 'enterprise')?.id ?? profiles[0].id;
  });

  const switchUser = useCallback((id: string) => {
    setProfileId(id);
    if (typeof localStorage !== 'undefined') localStorage.setItem(DEMO_USER_KEY, id);
  }, []);

  const signOut = useCallback(() => {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(DEMO_USER_KEY);
  }, []);

  const profile = profiles.find((p) => p.id === profileId) ?? profiles[0];

  return (
    <Ctx.Provider value={{ profile, allProfiles: profiles, isDemo: isDemoMode, switchUser, signOut }}>
      {children}
    </Ctx.Provider>
  );
}

export function useSession(): SessionCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useSession must be used within SessionProvider');
  return ctx;
}

// Which company ids the current profile can see (mirrors can_see_company RLS).
export function useVisibleCompanyIds(): Set<string> {
  const { profile, allProfiles } = useSession();
  const companies = getDb().companies;
  const ids = new Set<string>();
  const teamIds = new Set(allProfiles.filter((p) => p.managerId === profile.id).map((p) => p.id));
  for (const c of companies) {
    if (
      profile.role === 'admin' ||
      c.ownerId === profile.id ||
      (c.ownerId && teamIds.has(c.ownerId)) ||
      c.collaboratorIds.includes(profile.id)
    ) {
      ids.add(c.id);
    }
  }
  return ids;
}

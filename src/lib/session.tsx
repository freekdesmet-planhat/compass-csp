import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { isDemoMode, supabase } from './supabase';
import { getDb } from './store';
import { rowToProfile } from './realStore';
import { Login } from '../components/Login';
import type { Profile } from './types';

// Session context — the currently signed-in profile.
// - DEMO mode: switch between the seeded users to explore RLS perspectives.
// - REAL mode: authenticate via Supabase Auth; the profile is loaded from the DB
//   and the Login screen gates the app until a session + profile exist.

interface SessionCtx {
  profile: Profile;          // effective identity (impersonated persona if any, else real)
  realProfile: Profile;      // the authenticated account (same as profile unless impersonating)
  allProfiles: Profile[];
  isDemo: boolean;
  isImpersonating: boolean;
  switchUser: (id: string) => void;      // demo persona switch
  impersonate: (id: string) => void;     // admin "view as" (real mode)
  stopImpersonating: () => void;
  signOut: () => void;
}

const Ctx = createContext<SessionCtx | null>(null);

const DEMO_USER_KEY = 'compass-demo-user';
const VIEW_AS_KEY = 'compass-view-as';

export function SessionProvider({ children }: { children: ReactNode }) {
  return isDemoMode ? <DemoSessionProvider>{children}</DemoSessionProvider> : <RealSessionProvider>{children}</RealSessionProvider>;
}

// ── DEMO ──────────────────────────────────────────────────────────────────────
function DemoSessionProvider({ children }: { children: ReactNode }) {
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

  // In demo mode the "switch user" IS the identity, so view-as aliases it.
  return (
    <Ctx.Provider value={{ profile, realProfile: profile, allProfiles: profiles, isDemo: true, isImpersonating: false, switchUser, impersonate: switchUser, stopImpersonating: () => {}, signOut }}>
      {children}
    </Ctx.Provider>
  );
}

// ── REAL (Supabase Auth) ──────────────────────────────────────────────────────
function RealSessionProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [allProfiles, setAllProfiles] = useState<Profile[]>([]);
  const [impersonatedId, setImpersonatedId] = useState<string | null>(() => (typeof localStorage !== 'undefined' ? localStorage.getItem(VIEW_AS_KEY) : null));

  const loadForUser = useCallback(async (userId: string) => {
    try {
      const [{ data: me }, { data: everyone }] = await Promise.all([
        supabase!.from('profiles').select('*').eq('id', userId).maybeSingle(),
        supabase!.from('profiles').select('*'),
      ]);
      setProfile(me ? rowToProfile(me) : null);
      setAllProfiles((everyone ?? []).map(rowToProfile));
    } catch {
      setProfile(null);
      setAllProfiles([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    supabase!.auth.getSession().then(({ data }) => {
      if (!active) return;
      if (data.session) { setHasSession(true); loadForUser(data.session.user.id); }
      else { setHasSession(false); setLoading(false); }
    });
    const { data: sub } = supabase!.auth.onAuthStateChange((_evt, session) => {
      if (!active) return;
      if (session) { setHasSession(true); setLoading(true); loadForUser(session.user.id); }
      else { setHasSession(false); setProfile(null); setAllProfiles([]); setLoading(false); }
    });
    return () => { active = false; sub.subscription.unsubscribe(); };
  }, [loadForUser]);

  // Admin "view as": only an admin can impersonate, because RLS already returns
  // ALL rows to an admin — the effective persona is then applied as a client-side
  // scope (see useVisibleCompanies). A non-admin's data is RLS-bound to itself,
  // so impersonation is a no-op for them.
  const impersonate = useCallback((id: string) => {
    setImpersonatedId((_prev) => id);
    if (typeof localStorage !== 'undefined') localStorage.setItem(VIEW_AS_KEY, id);
  }, []);
  const stopImpersonating = useCallback(() => {
    setImpersonatedId(null);
    if (typeof localStorage !== 'undefined') localStorage.removeItem(VIEW_AS_KEY);
  }, []);
  const switchUser = useCallback((id: string) => impersonate(id), [impersonate]);
  const signOut = useCallback(() => {
    if (typeof localStorage !== 'undefined') { localStorage.removeItem(VIEW_AS_KEY); localStorage.removeItem(DEMO_USER_KEY); }
    supabase!.auth.signOut(); // clears the sb-*-auth-token; onAuthStateChange resets to the Login screen
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-600" />
      </div>
    );
  }
  if (!profile) {
    // No session → plain login. Session but no matching profile → explain + allow sign-out.
    return (
      <Login
        notice={hasSession ? 'Signed in, but no Compass profile is linked to this email. Ask an admin to add you.' : undefined}
        onSignOut={hasSession ? signOut : undefined}
      />
    );
  }

  // Effective identity: an admin viewing-as a persona sees that persona; everyone
  // else is themselves. `profile` here is the authenticated (real) account.
  const canImpersonate = profile.role === 'admin';
  const impersonated = canImpersonate && impersonatedId ? allProfiles.find((p) => p.id === impersonatedId) ?? null : null;
  const effective = impersonated ?? profile;

  return (
    <Ctx.Provider value={{
      profile: effective, realProfile: profile, allProfiles, isDemo: false,
      isImpersonating: !!impersonated, switchUser, impersonate, stopImpersonating, signOut,
    }}>
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
// Demo-mode helper (reads the in-browser store); real mode relies on server RLS.
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

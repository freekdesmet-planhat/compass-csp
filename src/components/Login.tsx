import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabase';

// Standalone sign-in screen for real mode. Rendered by RealSessionProvider in
// place of the app until a session + profile exist, so it must NOT depend on the
// app's toast/router/tooltip providers (they sit below it in the tree).
//
// Two ways in: email + password, or a magic link (handy since seeded users have
// random passwords). On success, Supabase fires onAuthStateChange and the
// provider swaps this screen for the app. `notice` shows the signed-in-but-no-
// profile case.
export function Login({ notice, onSignOut }: { notice?: string; onSignOut?: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const client = supabase;

  async function signInPassword(e: FormEvent) {
    e.preventDefault();
    if (!client) return;
    setBusy(true); setError(null); setInfo(null);
    const { error } = await client.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setError(error.message); // success → onAuthStateChange takes over
  }

  async function sendMagicLink() {
    if (!client) return;
    if (!email.trim()) { setError('Enter your email first.'); return; }
    setBusy(true); setError(null); setInfo(null);
    const { error } = await client.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    });
    setBusy(false);
    if (error) setError(error.message);
    else setInfo(`Magic link sent to ${email.trim()} — open it on this device to sign in.`);
  }

  async function resetPassword() {
    if (!client) return;
    if (!email.trim()) { setError('Enter your email first.'); return; }
    setBusy(true); setError(null); setInfo(null);
    const { error } = await client.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin });
    setBusy(false);
    if (error) setError(error.message);
    else setInfo(`Password reset link sent to ${email.trim()}.`);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">Sign in to Compass</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Use your Planhat work email.</p>

        {notice && (
          <div className="mt-4 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
            {notice}
          </div>
        )}

        <form onSubmit={signInPassword} className="mt-6 space-y-3">
          <input
            type="email" autoComplete="email" required placeholder="you@planhat.com"
            value={email} onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-sm text-slate-900 dark:text-slate-100 outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <input
            type="password" autoComplete="current-password" placeholder="Password"
            value={password} onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent px-3 py-2 text-sm text-slate-900 dark:text-slate-100 outline-none focus:ring-2 focus:ring-indigo-500"
          />
          <button
            type="submit" disabled={busy}
            className="w-full rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {busy ? 'Working…' : 'Sign in'}
          </button>
        </form>

        <div className="mt-4 flex items-center justify-between text-sm">
          <button onClick={sendMagicLink} disabled={busy} className="text-indigo-600 hover:underline disabled:opacity-50">
            Email me a magic link
          </button>
          <button onClick={resetPassword} disabled={busy} className="text-slate-500 hover:underline disabled:opacity-50">
            Forgot password?
          </button>
        </div>

        {error && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
        {info && <p className="mt-4 text-sm text-emerald-600 dark:text-emerald-400">{info}</p>}

        {onSignOut && (
          <button onClick={onSignOut} className="mt-6 w-full text-center text-xs text-slate-400 hover:underline">
            Sign out
          </button>
        )}
      </div>
    </div>
  );
}

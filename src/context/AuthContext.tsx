import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { AuthContextValue, Profile } from '@/types';

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const PROFILE_COLUMNS = 'id, email, full_name, role, is_active, created_at, updated_at';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  /**
   * Loads the signed-in user's staff profile. Self-healing: if the row is
   * missing (e.g. the signup trigger didn't run, or the account predates
   * it), it creates one on the spot instead of leaving the user stuck with
   * a "profile could not be loaded" error.
   *
   * SECURITY: anonymous sessions (customers who scanned a table QR code,
   * see CustomerOrderPage.tsx) are deliberately excluded from all of this.
   * They never get a profile row — self-healing one into existence here
   * would hand them a 'kitchen'-role profile and, via RequireRole, real
   * access to a staff dashboard. The customer route is normally mounted
   * outside this provider entirely (see App.tsx), but a customer session
   * persists in the browser, so this guard also covers the edge case of
   * that same browser navigating to a staff URL directly.
   */
  async function loadProfile(user: User) {
    if (user.is_anonymous) {
      setAuthError(null);
      setProfile(null);
      return;
    }

    const { data, error } = await supabase
      .from('profiles')
      .select(PROFILE_COLUMNS)
      .eq('id', user.id)
      .maybeSingle();

    if (error) {
      console.error('Failed to load staff profile:', error.message);
      setAuthError(
        'Signed in, but your staff profile could not be loaded. Please try again or contact an administrator.'
      );
      setProfile(null);
      return;
    }

    if (!data) {
      // No profile row yet — self-heal by creating one instead of failing.
      // SECURITY: never trust `user_metadata.role` here — it's client-
      // supplied at signup time and could be forged by anyone calling
      // auth.signUp() directly. Always default to the least-privileged
      // role; real role assignment only ever happens through an
      // authenticated admin's RLS-checked UPDATE (Staff Management) or
      // fix_demo_account_roles() for the three known demo accounts.
      const { data: created, error: createError } = await supabase
        .from('profiles')
        .insert({
          id: user.id,
          email: user.email ?? '',
          full_name: (user.user_metadata?.full_name as string | undefined) ?? user.email?.split('@')[0] ?? null,
          role: 'kitchen',
          is_active: true,
        })
        .select(PROFILE_COLUMNS)
        .maybeSingle();

      if (createError) {
        console.error('Failed to auto-create staff profile:', createError.message);
        setAuthError(
          'Signed in, but your staff profile could not be loaded. Please try again or contact an administrator.'
        );
        setProfile(null);
        return;
      }

      setAuthError(null);
      setProfile(created as Profile | null);
      return;
    }

    const loaded = data as Profile;
    if (!loaded.is_active) {
      // Deactivated account — don't grant access, and don't leave a stale
      // session sitting around either.
      setAuthError('Your account has been deactivated. Contact an administrator.');
      setProfile(null);
      await supabase.auth.signOut();
      setSession(null);
      return;
    }

    setAuthError(null);
    setProfile(loaded);
  }

  useEffect(() => {
    let mounted = true;

    // Get initial session
    supabase.auth
      .getSession()
      .then(({ data: { session: currentSession } }) => {
        if (!mounted) return;
        setSession(currentSession);
        if (currentSession?.user) {
          loadProfile(currentSession.user).finally(() => {
            if (mounted) setLoading(false);
          });
        } else {
          setLoading(false);
        }
      })
      .catch((err) => {
        // Network/connection failure talking to Supabase — don't leave the
        // app stuck on a loading spinner forever.
        console.error('Failed to reach Supabase for session check:', err);
        if (mounted) setLoading(false);
      });

    // Listen for auth state changes — wrap async work to avoid deadlock
    const { data: authListener } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        setSession(newSession);
        if (newSession?.user) {
          (async () => {
            await loadProfile(newSession.user);
          })();
        } else {
          setProfile(null);
        }
      }
    );

    return () => {
      mounted = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  async function signOut() {
    await supabase.auth.signOut();
    setProfile(null);
    setSession(null);
    setAuthError(null);
  }

  return (
    <AuthContext.Provider value={{ session, profile, loading, authError, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

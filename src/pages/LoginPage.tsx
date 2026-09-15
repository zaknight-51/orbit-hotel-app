import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { Logo } from '@/components/Logo';
import { DeveloperCredit } from '@/components/DeveloperCredit';
import { Button } from '@/components/ui/Button';
import { AlertCircle, Loader2, Lock, Mail, Eye, EyeOff } from 'lucide-react';
import type { UserRole } from '@/types';

export function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (signInError) {
      setError(signInError.message);
      setLoading(false);
      return;
    }

    const user = data.user;
    if (!user) {
      setLoading(false);
      return;
    }

    // Load the staff profile to determine where to redirect.
    let { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role, is_active')
      .eq('id', user.id)
      .maybeSingle();

    // Self-heal: if this account has no profile row yet (e.g. it predates
    // the signup trigger, or the trigger didn't fire), create one now
    // instead of dead-ending with an error. SECURITY: never trust
    // `user_metadata.role` — it's client-supplied and could be forged.
    // Always default to least-privilege; the three demo accounts get
    // corrected automatically via fix_demo_account_roles().
    if (!profileError && !profile) {
      const { data: created, error: createError } = await supabase
        .from('profiles')
        .insert({
          id: user.id,
          email: user.email ?? '',
          full_name:
            (user.user_metadata?.full_name as string | undefined) ??
            user.email?.split('@')[0] ??
            null,
          role: 'kitchen',
          is_active: true,
        })
        .select('role, is_active')
        .maybeSingle();

      profile = created;
      profileError = createError;
    }

    if (profileError) {
      setError(
        'Signed in, but your staff profile could not be loaded. Please try again, or contact an administrator.'
      );
      setLoading(false);
      return;
    }

    if (profile && profile.is_active === false) {
      await supabase.auth.signOut();
      setError('Your account has been deactivated. Contact an administrator.');
      setLoading(false);
      return;
    }

    const role = (profile?.role as UserRole) ?? 'kitchen';
    navigate(`/${role}`, { replace: true });
    setLoading(false);
  }

  return (
    <div className="min-h-screen flex">
      {/* Left brand panel */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden bg-primary-900">
        <div className="absolute inset-0 bg-gradient-to-br from-primary-800 via-primary-900 to-primary-950" />
        <div
          className="absolute inset-0 opacity-10"
          style={{
            backgroundImage:
              'radial-gradient(circle at 20% 30%, rgba(255,255,255,0.4) 0%, transparent 40%), radial-gradient(circle at 80% 70%, rgba(255,255,255,0.3) 0%, transparent 35%)',
          }}
        />
        <div className="relative z-10 flex flex-col justify-between p-12 text-white">
          <div className="flex items-center gap-3">
            <img
              src="/orbit-logo-icon.png"
              alt="Orbit Hotel"
              className="h-11 w-auto object-contain shrink-0"
            />
            <div className="leading-tight">
              <div className="text-xl font-bold">Orbit Hotel</div>
              <div className="text-xs uppercase tracking-[0.25em] text-primary-200">
                Internal Management System
              </div>
            </div>
          </div>

          <div className="space-y-6 max-w-md">
            <h1 className="text-4xl font-bold leading-tight">
              Hotel, POS & Kitchen Management
            </h1>
            <p className="text-primary-100 text-lg leading-relaxed">
              The internal operations hub for Orbit Hotel — bookings, rooms,
              orders, kitchen tickets, and staff management in one place.
            </p>
            <div className="flex gap-8 pt-4">
              <div>
                <div className="text-3xl font-bold text-accent-300">3</div>
                <div className="text-sm text-primary-200">Staff roles</div>
              </div>
              <div>
                <div className="text-3xl font-bold text-accent-300">24/7</div>
                <div className="text-sm text-primary-200">Realtime</div>
              </div>
              <div>
                <div className="text-3xl font-bold text-accent-300">Live</div>
                <div className="text-sm text-primary-200">Kitchen sync</div>
              </div>
            </div>
          </div>

          <p className="text-sm text-primary-300">
            Authorized staff only. This is a private internal system.
          </p>
        </div>
      </div>

      {/* Right login form */}
      <div className="flex-1 flex items-center justify-center px-6 py-12 bg-ink-50">
        <div className="w-full max-w-md animate-fade-in-up">
          <div className="lg:hidden mb-8 flex justify-center">
            <Logo size="lg" />
          </div>

          <div className="bg-surface rounded-2xl shadow-xl shadow-ink-900/5 ring-1 ring-ink-200/60 p-8">
            <div className="hidden lg:flex justify-center mb-6">
              <Logo size="md" />
            </div>

            <h2 className="text-2xl font-bold text-ink-900 text-center mb-1">
              Staff Sign In
            </h2>
            <p className="text-sm text-ink-500 text-center mb-8">
              Enter your credentials to access the system
            </p>

            {error && (
              <div className="mb-5 flex items-start gap-3 rounded-lg bg-error-50 border border-error-500/20 px-4 py-3 animate-fade-in">
                <AlertCircle className="h-5 w-5 text-error-600 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-error-700">{error}</div>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label
                  htmlFor="email"
                  className="block text-sm font-semibold text-ink-700 mb-1.5"
                >
                  Email address
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-ink-400" />
                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@orbithotel.com"
                    className="w-full rounded-lg border border-ink-300 bg-surface pl-11 pr-4 py-2.5 text-ink-900 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="password"
                  className="block text-sm font-semibold text-ink-700 mb-1.5"
                >
                  Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-ink-400" />
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full rounded-lg border border-ink-300 bg-surface pl-11 pr-11 py-2.5 text-ink-900 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-600 transition"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? (
                      <EyeOff className="h-5 w-5" />
                    ) : (
                      <Eye className="h-5 w-5" />
                    )}
                  </button>
                </div>
              </div>

              <Button type="submit" disabled={loading} className="w-full" size="lg">
                {loading ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Signing in…
                  </>
                ) : (
                  'Sign in'
                )}
              </Button>
            </form>
          </div>

          <p className="mt-6 text-center text-xs text-ink-400">
            Orbit Hotel · Internal System · Unauthorized access prohibited
          </p>

          <div className="mt-4">
            <DeveloperCredit variant="light" />
          </div>
        </div>
      </div>
    </div>
  );
}

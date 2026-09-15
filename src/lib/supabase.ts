import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * True only when both required env vars are present. The app checks this
 * before rendering the real UI (see main.tsx) so a missing/misconfigured
 * deployment shows a clear, actionable message instead of a blank white
 * screen. We intentionally do NOT throw here: a throw during module
 * evaluation happens before React ever calls render(), which is exactly
 * what produces a silent blank page in production.
 */
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

if (!isSupabaseConfigured) {
  // Still visible in the browser console / Vercel function logs for debugging.
  console.error(
    'Missing Supabase environment variables. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your deployment environment (e.g. Vercel Project Settings → Environment Variables) and redeploy.'
  );
}

// Fall back to harmless placeholder values so `createClient` itself never
// throws when misconfigured — the app instead renders a setup screen
// (see main.tsx) that explains exactly what's missing.
export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-anon-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  }
);

/**
 * Creates a standalone Supabase client that never persists or restores a
 * session. Used only for admin-initiated staff sign-up (`auth.signUp`),
 * which otherwise would sign the calling browser into the *new* account and
 * kick the admin out of their own session on the shared `supabase` client.
 */
export function createEphemeralAuthClient() {
  return createClient(
    supabaseUrl || 'https://placeholder.supabase.co',
    supabaseAnonKey || 'placeholder-anon-key',
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }
  );
}

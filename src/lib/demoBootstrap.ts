import { createEphemeralAuthClient, supabase } from '@/lib/supabase';

export const DEMO_PASSWORD = 'Marcillas2026!';

export const DEMO_ACCOUNTS = [
  { email: 'admin@marcillas.com', full_name: 'System Administrator' },
  { email: 'cashier@marcillas.com', full_name: 'Front Desk Cashier' },
  { email: 'kitchen@marcillas.com', full_name: 'Kitchen Staff' },
];

/**
 * Best-effort startup check: tries to create each demo staff account via a
 * normal `auth.signUp` call. If an account already exists, Supabase returns
 * an "already registered" style error which we simply ignore — this makes
 * the check safe to run on every app load.
 *
 * SECURITY: this intentionally does NOT pass a `role` in the signup
 * metadata. The `handle_new_user` DB trigger never trusts a client-supplied
 * role (that would let anyone self-promote to admin by calling
 * `auth.signUp()` directly with forged metadata) — every new account
 * starts as 'kitchen'. The correct role for these three specific demo
 * accounts is applied afterwards by `fixDemoAccountRoles()`, which is safe
 * to expose because its email → role mapping is hardcoded server-side, not
 * client-supplied.
 *
 * Notes / limitations (documented for the operator, see README):
 * - This cannot bypass a Supabase project's "Confirm email" setting. If
 *   email confirmation is required, the accounts are created but can't sign
 *   in until confirmed (via the dashboard or by disabling confirmation for
 *   this demo project).
 * - This never touches the signed-in user's session — it uses a throwaway
 *   client with persistSession disabled.
 * - Failures here are logged, not thrown — a bootstrap issue should never
 *   block the app from loading.
 */
export async function ensureDemoAccounts(): Promise<void> {
  for (const account of DEMO_ACCOUNTS) {
    try {
      const client = createEphemeralAuthClient();
      const { error } = await client.auth.signUp({
        email: account.email,
        password: DEMO_PASSWORD,
        options: {
          data: {
            full_name: account.full_name,
          },
        },
      });

      if (error && !/already registered|already exists|already been registered/i.test(error.message)) {
        console.warn(`Demo account bootstrap: could not ensure ${account.email}:`, error.message);
      }

      await client.auth.signOut();
    } catch (err) {
      console.warn(`Demo account bootstrap: unexpected error for ${account.email}:`, err);
    }
  }
}

/**
 * Applies the correct role to the three demo accounts by email, via the
 * `fix_demo_account_roles()` Postgres function. Safe and cheap to call on
 * every app load (idempotent, no parameters) — this is what makes demo
 * account roles self-healing without ever needing a manual SQL re-run,
 * even though new signups always start as 'kitchen' for security reasons.
 */
export async function fixDemoAccountRoles(): Promise<void> {
  const { error } = await supabase.rpc('fix_demo_account_roles');
  if (error) {
    console.warn('Could not apply demo account roles:', error.message);
  }
}

const BOOTSTRAP_FLAG = 'marcillas_demo_bootstrap_attempted_v1';

/**
 * Runs `ensureDemoAccounts` at most once per browser (tracked in
 * localStorage), so reloading the app repeatedly doesn't keep hammering
 * `auth.signUp`. Always follows up with `fixDemoAccountRoles()` (cheap,
 * idempotent, safe to run every load) so roles are correct regardless of
 * whether this was the first run or a later one.
 */
export async function ensureDemoAccountsOnce(): Promise<void> {
  let alreadyAttempted = false;
  try {
    alreadyAttempted = Boolean(localStorage.getItem(BOOTSTRAP_FLAG));
    if (!alreadyAttempted) localStorage.setItem(BOOTSTRAP_FLAG, '1');
  } catch {
    // localStorage unavailable (e.g. private browsing) — just run it,
    // worst case it retries next load too.
  }
  if (!alreadyAttempted) {
    await ensureDemoAccounts();
  }
  await fixDemoAccountRoles();
}

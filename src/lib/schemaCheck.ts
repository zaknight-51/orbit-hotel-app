import { supabase } from '@/lib/supabase';

export type SchemaStatus = 'ready' | 'missing' | 'unknown';

/**
 * Probes whether the required database schema exists yet. This can't
 * create the schema (that requires elevated DB privileges the browser app
 * intentionally never holds — see supabase/COMPLETE_SETUP.sql), but it can
 * detect whether the one-time setup script has been run, so the app can
 * show a clear instruction screen instead of failing in confusing ways.
 */
export async function checkSchemaStatus(): Promise<SchemaStatus> {
  try {
    const { error } = await supabase.from('profiles').select('id').limit(1);

    if (!error) return 'ready';

    // Postgres "undefined_table", or PostgREST's schema-cache-miss message,
    // both mean the table genuinely doesn't exist yet.
    const missingTableSignals = ['42P01', 'does not exist', 'schema cache'];
    const haystack = `${error.code ?? ''} ${error.message ?? ''}`.toLowerCase();
    if (missingTableSignals.some((s) => haystack.includes(s.toLowerCase()))) {
      return 'missing';
    }

    // Some other error (network, RLS, etc.) — don't block the app on an
    // ambiguous signal; let normal error handling elsewhere deal with it.
    console.warn('Schema check returned an unexpected error:', error.message);
    return 'unknown';
  } catch (err) {
    console.warn('Schema check failed:', err);
    return 'unknown';
  }
}

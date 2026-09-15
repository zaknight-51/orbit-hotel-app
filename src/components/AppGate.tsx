import { useEffect, useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { isSupabaseConfigured } from '@/lib/supabase';
import { checkSchemaStatus, type SchemaStatus } from '@/lib/schemaCheck';
import { ensureDemoAccountsOnce } from '@/lib/demoBootstrap';
import { ConfigErrorScreen } from '@/components/ConfigErrorScreen';
import { SchemaSetupScreen } from '@/components/SchemaSetupScreen';

function FullScreenSpinner() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-ink-50">
      <img
        src="/orbit-logo-icon.png"
        alt="Orbit Hotel"
        className="h-12 w-auto object-contain animate-fade-in"
      />
      <Loader2 className="h-6 w-6 animate-spin text-primary-600" />
    </div>
  );
}

/**
 * Gates rendering of the real app behind two automatic checks:
 *  1. Are the required env vars present? (ConfigErrorScreen if not)
 *  2. Has the one-time database setup script been run? (SchemaSetupScreen if not)
 *
 * Once both pass, it ensures the three demo accounts exist (signup attempts
 * are throttled to once per browser) and re-applies their correct roles
 * every load (cheap and idempotent — this is what keeps demo account roles
 * correct with zero manual steps), then renders the app.
 */
export function AppGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SchemaStatus | 'checking'>('checking');

  async function runCheck() {
    setStatus('checking');
    const result = await checkSchemaStatus();
    setStatus(result);

    if (result === 'ready') {
      ensureDemoAccountsOnce().catch(() => {
        /* already logged internally */
      });
    }
  }

  useEffect(() => {
    if (isSupabaseConfigured) {
      runCheck();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!isSupabaseConfigured) {
    return <ConfigErrorScreen />;
  }

  if (status === 'checking') {
    return <FullScreenSpinner />;
  }

  if (status === 'missing') {
    return <SchemaSetupScreen onRetry={runCheck} />;
  }

  // 'ready' or 'unknown' — for 'unknown' we don't block the app on an
  // ambiguous signal (e.g. a transient network hiccup); normal in-app
  // error handling (ErrorBoundary, per-hook error states) takes it from
  // there instead of dead-ending on a setup screen that may not apply.
  return <>{children}</>;
}

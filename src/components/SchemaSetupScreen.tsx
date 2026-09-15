import { useState } from 'react';
import { Database, Copy, Check, RefreshCw } from 'lucide-react';

interface Props {
  onRetry: () => void;
}

/**
 * Shown instead of the app when the database schema hasn't been created
 * yet. This is the one unavoidable manual step: creating tables and
 * security policies requires elevated database privileges that the
 * browser app must never hold (doing so would let anyone with dev tools
 * open take over the database). Everything else — demo accounts, staff
 * profiles, permissions — is fully automatic once this one script has
 * been run.
 */
export function SchemaSetupScreen({ onRetry }: Props) {
  const [copied, setCopied] = useState(false);

  async function copyPath() {
    try {
      await navigator.clipboard.writeText('supabase/COMPLETE_SETUP.sql');
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard may be unavailable — the path is also shown as text.
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-ink-50 px-6 py-12">
      <div className="max-w-xl w-full">
        <div className="text-center mb-6">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary-50">
            <Database className="h-7 w-7 text-primary-600" />
          </div>
          <h1 className="text-xl font-bold text-ink-900 mb-2">One-Time Database Setup</h1>
          <p className="text-sm text-ink-500">
            This Supabase project's database hasn't been set up yet. This is the only
            manual step required — after it, the app configures itself automatically
            (demo accounts, staff profiles, everything).
          </p>
        </div>

        <div className="bg-surface rounded-xl ring-1 ring-ink-200/60 shadow-sm p-5 space-y-4">
          <div>
            <p className="text-sm font-semibold text-ink-800 mb-2">1. Open the SQL Editor</p>
            <p className="text-sm text-ink-500">
              In your Supabase project dashboard, go to <strong>SQL Editor</strong>.
            </p>
          </div>
          <div>
            <p className="text-sm font-semibold text-ink-800 mb-2">
              2. Run this file's contents
            </p>
            <div className="flex items-center gap-2 rounded-lg bg-ink-50 ring-1 ring-ink-200/60 px-3 py-2.5">
              <code className="flex-1 text-sm text-ink-700 font-mono">
                supabase/COMPLETE_SETUP.sql
              </code>
              <button
                onClick={copyPath}
                className="flex items-center gap-1 text-xs font-semibold text-primary-600 hover:text-primary-700 transition"
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? 'Copied' : 'Copy path'}
              </button>
            </div>
            <p className="mt-1.5 text-xs text-ink-400">
              Paste the full contents of that file (from the project repo) into the SQL
              Editor and click Run. It's safe to run more than once.
            </p>
          </div>
          <div>
            <p className="text-sm font-semibold text-ink-800 mb-2">3. Reload this page</p>
            <button
              onClick={onRetry}
              className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-ink-950 hover:bg-primary-700 transition"
            >
              <RefreshCw className="h-4 w-4" />
              I've run it — check again
            </button>
          </div>
        </div>

        <p className="mt-5 text-xs text-ink-400 text-center">
          Why can't this run automatically? Creating tables and security policies needs
          elevated database privileges. The app deliberately never holds that level of
          access in the browser — doing so would let anyone take over the database.
          This is the one moment that needs it.
        </p>
      </div>
    </div>
  );
}

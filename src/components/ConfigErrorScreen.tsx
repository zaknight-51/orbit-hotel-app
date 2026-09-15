import { ServerCrash } from 'lucide-react';

/**
 * Shown instead of the app when VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
 * are missing at build/runtime. This is what used to be a blank white
 * screen — now it's a clear, actionable message.
 */
export function ConfigErrorScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-ink-50 px-6">
      <div className="max-w-lg w-full text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-error-50">
          <ServerCrash className="h-7 w-7 text-error-600" />
        </div>
        <h1 className="text-xl font-bold text-ink-900 mb-2">Configuration Required</h1>
        <p className="text-sm text-ink-500 mb-5">
          This deployment is missing its Supabase connection settings, so the app can't
          start. Add the following environment variables in your hosting provider (e.g.
          Vercel → Project Settings → Environment Variables) and redeploy:
        </p>
        <div className="text-left bg-surface rounded-lg ring-1 ring-ink-200/60 p-4 font-mono text-xs text-ink-700 space-y-1">
          <div>VITE_SUPABASE_URL</div>
          <div>VITE_SUPABASE_ANON_KEY</div>
        </div>
        <p className="text-xs text-ink-400 mt-5">
          These values come from your Supabase project → Settings → API.
        </p>
      </div>
    </div>
  );
}

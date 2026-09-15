import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Catches uncaught errors anywhere in the component tree below it and
 * renders a friendly fallback instead of letting React unmount to a blank
 * white page. This is a safety net on top of fixing the specific known
 * causes of white screens (e.g. missing env vars) — it also protects
 * against any future unexpected runtime error.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Unhandled error in Orbit Hotel POS:', error, errorInfo);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-ink-50 px-6">
          <div className="max-w-md w-full text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-error-50">
              <AlertTriangle className="h-7 w-7 text-error-600" />
            </div>
            <h1 className="text-xl font-bold text-ink-900 mb-2">Something went wrong</h1>
            <p className="text-sm text-ink-500 mb-6">
              The application ran into an unexpected error. Reloading the page usually
              fixes it. If the problem continues, contact your system administrator.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="inline-flex items-center justify-center rounded-lg bg-primary-600 px-5 py-2.5 text-sm font-semibold text-ink-950 hover:bg-primary-700 transition"
            >
              Reload page
            </button>
            {import.meta.env.DEV && (
              <pre className="mt-6 text-left text-xs text-error-700 bg-error-50 rounded-lg p-3 overflow-auto max-h-48">
                {this.state.error.message}
              </pre>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

import type { LucideIcon } from 'lucide-react';

interface StatCardProps {
  label: string;
  value: string | number;
  icon: LucideIcon;
  tone?: 'primary' | 'accent' | 'success' | 'warning' | 'error';
  hint?: string;
}

const toneClasses: Record<NonNullable<StatCardProps['tone']>, string> = {
  primary: 'bg-primary-50 text-primary-600',
  accent: 'bg-accent-50 text-accent-600',
  success: 'bg-success-50 text-success-600',
  warning: 'bg-warning-50 text-warning-600',
  error: 'bg-error-50 text-error-600',
};

const borderToneClasses: Record<NonNullable<StatCardProps['tone']>, string> = {
  primary: 'border-t-primary-500',
  accent: 'border-t-accent-500',
  success: 'border-t-success-500',
  warning: 'border-t-warning-500',
  error: 'border-t-error-500',
};

export function StatCard({ label, value, icon: Icon, tone = 'primary', hint }: StatCardProps) {
  return (
    <div
      className={`rounded-xl border-t-[3px] bg-surface p-5 shadow-sm ring-1 ring-ink-200/60 transition hover:shadow-md hover:ring-ink-300/60 ${borderToneClasses[tone]}`}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-ink-500">{label}</p>
          <p className="mt-2 text-3xl font-bold text-ink-900 tabular-nums">{value}</p>
          {hint && <p className="mt-1 text-xs text-ink-400">{hint}</p>}
        </div>
        <div className={`rounded-lg p-2.5 ${toneClasses[tone]}`}>
          <Icon className="h-6 w-6" />
        </div>
      </div>
    </div>
  );
}

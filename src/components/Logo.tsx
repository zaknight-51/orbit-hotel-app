import { Link } from 'react-router-dom';

const SIZES = {
  sm: { icon: 'h-8', text: 'text-base', sub: 'text-[10px]' },
  md: { icon: 'h-10', text: 'text-lg', sub: 'text-xs' },
  lg: { icon: 'h-14', text: 'text-2xl', sub: 'text-sm' },
} as const;

export function Logo({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const { icon, text, sub } = SIZES[size];

  return (
    <Link to="/" className="flex items-center gap-3 select-none">
      {/* Full-resolution artwork, scaled by height only so the basket
          emblem's natural proportions are never stretched or distorted. */}
      <img
        src="/orbit-logo-icon.png"
        alt="Orbit Hotel"
        className={`${icon} w-auto object-contain shrink-0`}
      />
      <div className="leading-tight">
        <div className={`${text} font-bold tracking-tight text-ink-900`}>
          Orbit Hotel
        </div>
        <div className={`${sub} font-medium uppercase tracking-[0.2em] text-primary-600`}>
          Hotel Management
        </div>
      </div>
    </Link>
  );
}

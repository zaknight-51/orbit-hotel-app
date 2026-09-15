import { forwardRef, type ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const variantClasses: Record<Variant, string> = {
  primary:
    'bg-primary-600 text-ink-950 hover:bg-primary-500 active:bg-primary-700 shadow-sm hover:shadow-md focus:ring-primary-500',
  secondary:
    'bg-surface text-ink-700 border border-ink-300 hover:bg-ink-100 hover:border-ink-400 active:bg-ink-200 focus:ring-primary-500',
  ghost:
    'bg-transparent text-ink-600 hover:bg-ink-100 active:bg-ink-200 focus:ring-ink-400',
  danger:
    'bg-error-600 text-white hover:bg-error-700 active:bg-error-800 shadow-sm hover:shadow-md focus:ring-error-500',
};

const sizeClasses: Record<Size, string> = {
  sm: 'h-8 px-3 text-sm gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-12 px-6 text-base gap-2',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className = '', variant = 'primary', size = 'md', children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={`inline-flex items-center justify-center rounded-lg font-semibold transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-1 disabled:opacity-60 disabled:cursor-not-allowed active:scale-[0.98] ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
        {...props}
      >
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';

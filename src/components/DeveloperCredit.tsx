import { MessageCircle, Send } from 'lucide-react';

const WHATSAPP_URL = 'https://wa.me/251973680108';
const TELEGRAM_URL = 'https://t.me/Xo_silver';

/**
 * Small, professional developer attribution. Two variants for the two
 * background contexts it appears in: `dark` for the dark red sidebar
 * (staff dashboards), `light` for white/light surfaces (login page,
 * customer ordering page).
 */
export function DeveloperCredit({ variant = 'light' }: { variant?: 'light' | 'dark' }) {
  const isDark = variant === 'dark';

  const textClass = isDark ? 'text-primary-200/70' : 'text-ink-400';
  const nameClass = isDark ? 'text-primary-100' : 'text-ink-500';
  const linkClass = isDark
    ? 'inline-flex items-center gap-1 transition hover:text-white'
    : 'inline-flex items-center gap-1 transition hover:text-primary-600';

  return (
    <div className={`text-center text-[11px] leading-relaxed ${textClass}`}>
      <p>
        Developed by <span className={`font-semibold ${nameClass}`}>Nova Noor</span> | Web
        Development
      </p>
      <p className="mt-1 flex items-center justify-center gap-3">
        <a href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" className={linkClass}>
          <MessageCircle className="h-3 w-3" />
          WhatsApp
        </a>
        <a href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer" className={linkClass}>
          <Send className="h-3 w-3" />
          @Xo_silver
        </a>
      </p>
    </div>
  );
}

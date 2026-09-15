import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useMenu } from '@/hooks/useMenu';
import { usePromotions } from '@/hooks/usePromotions';
import { formatCurrency } from '@/lib/format';
import { detectPromoMedia, type PromoMediaKind } from '@/lib/promoMedia';
import { Logo } from '@/components/Logo';
import { DeveloperCredit } from '@/components/DeveloperCredit';
import {
  Search,
  Plus,
  Minus,
  Trash2,
  ShoppingBag,
  Send,
  Loader2,
  CheckCircle2,
  AlertCircle,
  UtensilsCrossed,
  Bell,
  Flame,
  ChefHat,
  PartyPopper,
  Megaphone,
  ExternalLink,
} from 'lucide-react';
import type { CartItem, Order, Promotion } from '@/types';

type PageState = 'resolving' | 'invalid' | 'error' | 'ready';

const ANON_DISABLED_HINT =
  'anonymous sign-ins are disabled';

/**
 * Public customer ordering page reached by scanning a table's QR code
 * (route: /order/:token). Deliberately self-contained — it does NOT use
 * AuthContext (see App.tsx: this route is mounted outside AuthProvider)
 * so an anonymous customer session never touches staff profile logic.
 *
 * No online payment here by design — the customer places the order, the
 * cashier accepts & sends it to the kitchen, and the guest pays physically
 * at the register/table when the cashier marks the order Paid.
 */
export function CustomerOrderPage() {
  const { token: rawToken } = useParams<{ token: string }>();
  const [pageState, setPageState] = useState<PageState>('resolving');
  const [errorDetail, setErrorDetail] = useState<string>('');
  const [tableLabel, setTableLabel] = useState<string>('');
  const [resolvedToken, setResolvedToken] = useState<string>('');
  const [sessionReady, setSessionReady] = useState(false);
  const [submittedOrder, setSubmittedOrder] = useState<Order | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  // Resolve the table by token, then get an anonymous session.
  //
  // This has to be resilient to real phone/QR-scan conditions that a
  // desktop browser typing/pasting the same URL never hits:
  //  - Some QR scanner apps / camera previews decode or re-encode the
  //    scanned text and can hand the browser a URL with the token
  //    percent-encoded, with stray surrounding whitespace, or (on a few
  //    low-quality third-party QR generators someone might have used to
  //    reprint a code) with letter case altered. `qr_token` is always a
  //    lowercase UUID string, so the lookup below is normalized the same
  //    way rather than trusting the token verbatim.
  //  - A cold app launch straight from a QR scan on cellular data is far
  //    more likely to hit a transient network hiccup on the very first
  //    request than a desktop browser reusing an already-warm connection
  //    — retries absorb that instead of permanently failing on a single
  //    dropped request.
  //  - A device that had already been used to test this table earlier has
  //    a Supabase session cached in that browser's localStorage, so it
  //    skips the anonymous sign-in call entirely. A phone scanning the
  //    code for the first time always has to make that call for real — so
  //    if sign-in itself is failing (most commonly because the "Allow
  //    anonymous sign-ins" toggle in Supabase → Authentication →
  //    Providers isn't switched on for this project), "works on an
  //    already-tested device, fails on a fresh one" is exactly what you'd
  //    see. The actual Supabase error is now shown on screen (not just
  //    logged) specifically so that distinction is visible immediately
  //    instead of a generic message hiding it.
  useEffect(() => {
    let cancelled = false;

    async function lookupTable(qrToken: string) {
      return supabase
        .from('tables')
        .select('table_number, name, is_active')
        .eq('qr_token', qrToken)
        .maybeSingle();
    }

    async function withRetries<T extends { error: { message?: string } | null }>(
      run: () => Promise<T>,
      attempts: number
    ): Promise<T> {
      let result = await run();
      for (let i = 1; i < attempts && result.error && !cancelled; i++) {
        await new Promise((resolve) => setTimeout(resolve, 500 * i));
        result = await run();
      }
      return result;
    }

    async function init() {
      const token = (rawToken ?? '').trim();
      let normalizedToken = token;
      try {
        // Undo accidental percent-encoding some scanners/redirectors add
        // (harmless no-op if the token wasn't encoded to begin with).
        normalizedToken = decodeURIComponent(token);
      } catch {
        normalizedToken = token;
      }
      normalizedToken = normalizedToken.trim().toLowerCase();

      if (!normalizedToken) {
        setPageState('invalid');
        return;
      }

      // 3 attempts total, backing off 0.5s / 1s — a real, cold mobile
      // network connection deserves more resilience than a single retry.
      const { data: table, error: tableError } = await withRetries(
        () => lookupTable(normalizedToken),
        3
      );

      if (cancelled) return;

      if (tableError) {
        console.error('Table lookup failed:', tableError);
        setErrorDetail(tableError.message || 'Could not reach the server.');
        setPageState('error');
        return;
      }

      if (!table || !table.is_active) {
        setPageState('invalid');
        return;
      }

      setTableLabel(table.name ? `Table ${table.table_number} · ${table.name}` : `Table ${table.table_number}`);
      setResolvedToken(normalizedToken);

      const { data: existing } = await supabase.auth.getSession();
      if (!existing.session) {
        const { error: signInError } = await withRetries(
          () => supabase.auth.signInAnonymously(),
          3
        );
        if (signInError) {
          console.error('Anonymous sign-in failed:', signInError);
          if (!cancelled) {
            setErrorDetail(signInError.message || 'Could not start an ordering session.');
            setPageState('error');
          }
          return;
        }
      }

      if (!cancelled) {
        setSessionReady(true);
        setPageState('ready');
      }
    }

    init();
    return () => {
      cancelled = true;
    };
  }, [rawToken, retryTick]);

  if (pageState === 'resolving') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-ink-50">
        <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
      </div>
    );
  }

  if (pageState === 'error') {
    const isAnonDisabled = errorDetail.toLowerCase().includes(ANON_DISABLED_HINT);
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-ink-50 px-6 text-center">
        <AlertCircle className="h-10 w-10 text-error-500 mb-3" />
        <h1 className="text-lg font-bold text-ink-900">Couldn't connect</h1>
        {isAnonDisabled ? (
          <p className="text-sm text-ink-500 mt-1 max-w-xs">
            Guest ordering isn't turned on for this restaurant yet. Ask staff to enable
            "Allow anonymous sign-ins" in Supabase under Authentication → Providers.
          </p>
        ) : (
          <p className="text-sm text-ink-500 mt-1 max-w-xs">
            Check your connection and try again.
          </p>
        )}
        {errorDetail && (
          <p className="text-xs text-ink-400 mt-3 max-w-xs break-words">{errorDetail}</p>
        )}
        <button
          onClick={() => {
            setPageState('resolving');
            setErrorDetail('');
            setRetryTick((t) => t + 1);
          }}
          className="mt-5 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-ink-950"
        >
          Try Again
        </button>
      </div>
    );
  }

  if (pageState === 'invalid') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-ink-50 px-6 text-center">
        <AlertCircle className="h-10 w-10 text-error-500 mb-3" />
        <h1 className="text-lg font-bold text-ink-900">This QR code isn't valid</h1>
        <p className="text-sm text-ink-500 mt-1">
          Please ask a staff member for help.
        </p>
      </div>
    );
  }

  if (submittedOrder) {
    return <OrderStatusTracker order={submittedOrder} tableLabel={tableLabel} />;
  }

  return sessionReady && resolvedToken ? (
    <OrderingMenu token={resolvedToken} tableLabel={tableLabel} onSubmitted={setSubmittedOrder} />
  ) : null;
}

/**
 * One slide within a promotion's media carousel (or the only slide, for a
 * legacy promotion with no `promotion_media` rows — same component either
 * way, just fed a single item). `kind` is resolved from the stored
 * media_type ('image' | 'video') plus URL-based detection for videos
 * (YouTube/Vimeo vs a direct file) — a legacy single-`url` promotion has no
 * stored type at all, so it fully defers to URL detection like before.
 *
 * Video plays like a silent, looping ad: no controls of any kind. This is
 * done by configuring the <video> element itself (autoPlay/muted/loop/
 * playsInline, no `controls` attribute at all, disablePictureInPicture),
 * not by hiding a controls bar with CSS. Only the slide currently in view
 * within the carousel actually plays (native <video> — YouTube/Vimeo
 * iframes autoplay from mount regardless, same as before multi-media
 * support existed, since pausing an off-screen embed needs a postMessage
 * API round-trip that isn't worth the complexity for a muted ambient clip).
 */
function PromoMediaSlide({
  url,
  storedType,
  title,
  isActive,
}: {
  url: string;
  storedType?: 'image' | 'video';
  title: string;
  isActive: boolean;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const detected = useMemo(() => detectPromoMedia(url), [url]);

  const kind: PromoMediaKind =
    storedType === 'image'
      ? 'image-or-link'
      : storedType === 'video'
        ? detected.kind === 'youtube' || detected.kind === 'vimeo'
          ? detected.kind
          : 'video-file'
        : detected.kind;

  useEffect(() => {
    if (kind !== 'video-file') return;
    const el = videoRef.current;
    if (!el) return;
    el.muted = true;
    el.defaultMuted = true;
    el.disablePictureInPicture = true;
    if (isActive) {
      const playPromise = el.play();
      if (playPromise) {
        playPromise.catch(() => {
          // Autoplay can still be blocked in rare cases (e.g. low-power
          // mode) — fail silently rather than surfacing an error for what
          // is a purely decorative background video.
        });
      }
    } else {
      el.pause();
    }
  }, [kind, url, isActive]);

  if (kind === 'youtube' || kind === 'vimeo') {
    return (
      <div className="aspect-video w-full bg-ink-950">
        <iframe
          src={detected.embedUrl}
          title={title}
          className="h-full w-full pointer-events-none"
          allow="autoplay; encrypted-media"
          loading="lazy"
        />
      </div>
    );
  }

  if (kind === 'video-file') {
    return (
      <video
        ref={videoRef}
        src={url}
        autoPlay
        muted
        loop
        playsInline
        disablePictureInPicture
        disableRemotePlayback
        controlsList="nodownload noremoteplayback noplaybackrate nofullscreen"
        onContextMenu={(e) => e.preventDefault()}
        className="max-h-64 w-full bg-black pointer-events-none"
      >
        Your browser doesn't support embedded video.
      </video>
    );
  }

  if (!imageFailed) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer">
        <img
          src={url}
          alt={title}
          className="max-h-64 w-full bg-ink-50 object-contain"
          onError={() => setImageFailed(true)}
        />
      </a>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-3 bg-primary-50 px-4 py-4 transition hover:bg-primary-100"
    >
      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-primary-600 text-ink-950">
        <ExternalLink className="h-5 w-5" />
      </div>
      <span className="text-sm font-semibold text-primary-700">View Promotion</span>
    </a>
  );
}

/**
 * Renders a promotion's media as a carousel: multiple images and/or videos
 * (any mix of admin-uploaded files and pasted URLs) continuously
 * auto-advance with a smooth slide transition, and the customer can also
 * manually swipe on mobile — built on native horizontal scroll-snap rather
 * than custom touch-gesture math, so manual swiping is always buttery
 * smooth and gets the platform's native momentum/rubber-banding for free.
 * A single-item promotion (including every legacy promotion with no
 * `promotion_media` rows) renders the same way, just with no dots and no
 * auto-advance timer, since there's nothing to advance to.
 */
function PromoMediaCarousel({
  items,
  title,
}: {
  items: { url: string; type?: 'image' | 'video' }[];
  title: string;
}) {
  const [index, setIndex] = useState(0);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const scrollTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMultiple = items.length > 1;

  const scrollToIndex = useCallback((i: number) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTo({ left: i * el.clientWidth, behavior: 'smooth' });
  }, []);

  useEffect(() => {
    if (!isMultiple) return;
    const id = setInterval(() => {
      setIndex((i) => {
        const next = (i + 1) % items.length;
        scrollToIndex(next);
        return next;
      });
    }, 4500);
    return () => clearInterval(id);
  }, [isMultiple, items.length, scrollToIndex]);

  function handleScroll() {
    const el = scrollerRef.current;
    if (!el || el.clientWidth === 0) return;
    if (scrollTimeout.current) clearTimeout(scrollTimeout.current);
    // Debounced so this only fires once the customer's manual swipe (native
    // momentum scroll) has actually settled, not on every intermediate frame.
    scrollTimeout.current = setTimeout(() => {
      const newIndex = Math.round(el.scrollLeft / el.clientWidth);
      setIndex(Math.max(0, Math.min(items.length - 1, newIndex)));
    }, 120);
  }

  return (
    <div>
      <div
        ref={scrollerRef}
        onScroll={isMultiple ? handleScroll : undefined}
        className="no-scrollbar flex overflow-x-auto snap-x snap-mandatory scroll-smooth"
      >
        {items.map((item, i) => (
          <div key={i} className="w-full flex-shrink-0 snap-center">
            <PromoMediaSlide url={item.url} storedType={item.type} title={title} isActive={i === index} />
          </div>
        ))}
      </div>
      {isMultiple && (
        <div className="flex justify-center gap-1.5 pt-2">
          {items.map((_, i) => (
            <button
              key={i}
              aria-label={`Show slide ${i + 1}`}
              onClick={() => {
                setIndex(i);
                scrollToIndex(i);
              }}
              className={`h-1.5 rounded-full transition-all ${
                i === index ? 'w-4 bg-primary-600' : 'w-1.5 bg-ink-300'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The promotion is shown as a full card the customer sees immediately —
 * not a tappable line they have to click to find out what it is. A
 * promotion with multiple `promotion_media` rows (images and/or videos,
 * any mix of uploaded files and pasted URLs) renders as a carousel; a
 * legacy promotion with none falls back to its single `url` field exactly
 * as before multi-media support existed.
 */
function PromotionCard({ promo }: { promo: Promotion }) {
  const items = useMemo(() => {
    if (promo.media && promo.media.length > 0) {
      return [...promo.media]
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((m) => ({ url: m.media_url, type: m.media_type }));
    }
    return [{ url: promo.url, type: undefined }];
  }, [promo.media, promo.url]);

  return (
    <div className="overflow-hidden rounded-2xl bg-surface shadow-md ring-1 ring-ink-200/60">
      <div className="flex items-center gap-1.5 px-4 pt-3 pb-2">
        <Megaphone className="h-3.5 w-3.5 text-primary-600" />
        <span className="text-[10px] font-extrabold tracking-widest text-primary-600 uppercase">
          Promotion
        </span>
      </div>

      <PromoMediaCarousel items={items} title={promo.title} />

      <div className="px-4 py-3">
        <h3 className="text-sm font-bold leading-snug text-ink-900">{promo.title}</h3>
      </div>
    </div>
  );
}

function PromotionBanner({ promotions }: { promotions: Promotion[] }) {
  const [index, setIndex] = useState(0);

  // Rotate to the next active promotion. Longer interval than a plain text
  // banner needs, since there's now real image/video content to look at.
  useEffect(() => {
    if (promotions.length <= 1) return;
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % promotions.length);
    }, 8000);
    return () => clearInterval(id);
  }, [promotions.length]);

  if (promotions.length === 0) return null;

  const promo = promotions[index % promotions.length];

  return (
    <div className="px-4 pt-4">
      <div key={promo.id} className="animate-fade-in">
        <PromotionCard promo={promo} />
      </div>
      {promotions.length > 1 && (
        <div className="mt-2 flex justify-center gap-1.5">
          {promotions.map((p, i) => (
            <span
              key={p.id}
              className={`h-1.5 w-1.5 rounded-full transition ${
                i === index % promotions.length ? 'bg-primary-600' : 'bg-ink-200'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function OrderingMenu({
  token,
  tableLabel,
  onSubmitted,
}: {
  token: string;
  tableLabel: string;
  onSubmitted: (order: Order) => void;
}) {
  const { items, loading: menuLoading } = useMenu();
  const { promotions } = usePromotions(true);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('All');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cartOpen, setCartOpen] = useState(false);

  const categories = useMemo(() => {
    const cats = Array.from(new Set(items.map((i) => i.category)));
    return ['All', ...cats];
  }, [items]);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const matchesCategory = activeCategory === 'All' || item.category === activeCategory;
      const matchesSearch =
        search.trim() === '' || item.name.toLowerCase().includes(search.trim().toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [items, activeCategory, search]);

  const cartTotal = useMemo(
    () => cart.reduce((sum, item) => sum + item.price * item.quantity, 0),
    [cart]
  );
  const cartCount = useMemo(() => cart.reduce((sum, item) => sum + item.quantity, 0), [cart]);

  const addToCart = useCallback((item: { id: string; name: string; price: number }) => {
    setCart((prev) => {
      const existing = prev.find((c) => c.menu_item_id === item.id && c.notes === '');
      if (existing) {
        return prev.map((c) =>
          c.menu_item_id === item.id && c.notes === '' ? { ...c, quantity: c.quantity + 1 } : c
        );
      }
      return [...prev, { menu_item_id: item.id, name: item.name, price: item.price, quantity: 1, notes: '' }];
    });
  }, []);

  const updateQuantity = useCallback((index: number, delta: number) => {
    setCart((prev) =>
      prev.map((item, i) => (i === index ? { ...item, quantity: item.quantity + delta } : item)).filter((item) => item.quantity > 0)
    );
  }, []);

  const removeItem = useCallback((index: number) => {
    setCart((prev) => prev.filter((_, i) => i !== index));
  }, []);

  async function handleSubmit() {
    if (cart.length === 0) return;
    setSubmitting(true);
    setError(null);

    const itemsPayload = cart.map((c) => ({
      menu_item_id: c.menu_item_id,
      name: c.name,
      price: c.price,
      quantity: c.quantity,
      notes: c.notes || null,
    }));

    const { data, error: rpcError } = await supabase.rpc('create_customer_order', {
      p_table_token: token,
      p_notes: notes || null,
      p_items: itemsPayload,
    });

    if (rpcError) {
      setError(rpcError.message);
      setSubmitting(false);
      return;
    }

    onSubmitted(data as Order);
    setSubmitting(false);
  }

  return (
    <div className="min-h-screen bg-ink-50 pb-28">
      <header className="sticky top-0 z-20 bg-surface border-b border-ink-200 px-4 py-3">
        <div className="flex items-center justify-between">
          <Logo size="sm" />
          <span className="text-xs font-bold text-primary-700 bg-primary-50 rounded-full px-2.5 py-1">
            {tableLabel}
          </span>
        </div>
      </header>

      <PromotionBanner promotions={promotions} />

      <div className="px-4 py-4 max-w-2xl mx-auto">
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-ink-400" />
          <input
            type="text"
            placeholder="Search menu…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-ink-300 bg-surface pl-11 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>

        <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`whitespace-nowrap rounded-lg px-3.5 py-1.5 text-sm font-semibold transition ${
                activeCategory === cat
                  ? 'bg-primary-600 text-ink-950 shadow-sm'
                  : 'bg-surface text-ink-600 border border-ink-200'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {menuLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <UtensilsCrossed className="h-10 w-10 text-ink-300 mb-3" />
            <p className="text-sm font-medium text-ink-600">No items found</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {filteredItems.map((item) => (
              <button
                key={item.id}
                onClick={() => addToCart(item)}
                className="flex flex-col rounded-xl bg-surface p-4 text-left shadow-sm ring-1 ring-ink-200/60 active:ring-primary-400 transition"
              >
                {item.image_url && (
                  <img
                    src={item.image_url}
                    alt=""
                    className="mb-3 h-20 w-full rounded-lg object-cover"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display = 'none';
                    }}
                  />
                )}
                <h3 className="text-sm font-bold text-ink-900 leading-tight">{item.name}</h3>
                {item.description && (
                  <p className="text-xs text-ink-500 leading-relaxed line-clamp-2 mt-1 flex-1">
                    {item.description}
                  </p>
                )}
                <span className="text-sm font-bold text-primary-600 mt-2">
                  {formatCurrency(item.price)}
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="mt-8 mb-2">
          <DeveloperCredit variant="light" />
        </div>
      </div>

      {/* Sticky cart bar */}
      {cartCount > 0 && !cartOpen && (
        <button
          onClick={() => setCartOpen(true)}
          className="fixed bottom-0 left-0 right-0 z-30 bg-primary-600 text-ink-950 px-5 py-4 flex items-center justify-between shadow-lg"
        >
          <span className="flex items-center gap-2 font-semibold">
            <ShoppingBag className="h-5 w-5" />
            {cartCount} item{cartCount !== 1 ? 's' : ''}
          </span>
          <span className="font-bold">{formatCurrency(cartTotal)}</span>
        </button>
      )}

      {/* Cart sheet */}
      {cartOpen && (
        <div className="fixed inset-0 z-40 flex flex-col justify-end">
          <div className="fixed inset-0 bg-ink-950/50" onClick={() => setCartOpen(false)} />
          <div className="relative bg-surface rounded-t-2xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-ink-200">
              <h2 className="font-bold text-ink-900">Your Order</h2>
              <button onClick={() => setCartOpen(false)} className="text-sm font-semibold text-ink-500">
                Close
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-3">
              {cart.length === 0 ? (
                <p className="text-sm text-ink-500 text-center py-8">Your cart is empty</p>
              ) : (
                <div className="space-y-3">
                  {cart.map((item, index) => (
                    <div key={`${item.menu_item_id}-${index}`} className="rounded-lg border border-ink-200 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <h3 className="text-sm font-semibold text-ink-900 truncate">{item.name}</h3>
                          <p className="text-xs text-ink-500">{formatCurrency(item.price)} each</p>
                        </div>
                        <button onClick={() => removeItem(index)} className="text-ink-400">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="flex items-center justify-between mt-2">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => updateQuantity(index, -1)}
                            className="h-7 w-7 rounded-md border border-ink-300 flex items-center justify-center"
                          >
                            <Minus className="h-3.5 w-3.5" />
                          </button>
                          <span className="w-8 text-center text-sm font-bold tabular-nums">{item.quantity}</span>
                          <button
                            onClick={() => updateQuantity(index, 1)}
                            className="h-7 w-7 rounded-md border border-ink-300 flex items-center justify-center"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <span className="text-sm font-bold tabular-nums">
                          {formatCurrency(item.price * item.quantity)}
                        </span>
                      </div>
                    </div>
                  ))}
                  <textarea
                    placeholder="Notes for the kitchen (optional)"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={2}
                    className="w-full rounded-lg border border-ink-300 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary-500"
                  />
                </div>
              )}
            </div>

            {cart.length > 0 && (
              <div className="border-t border-ink-200 p-5 space-y-3">
                {error && (
                  <div className="flex items-start gap-2 rounded-lg bg-error-50 border border-error-500/20 px-3 py-2">
                    <AlertCircle className="h-4 w-4 text-error-600 flex-shrink-0 mt-0.5" />
                    <span className="text-xs text-error-700">{error}</span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-ink-600">Total</span>
                  <span className="text-2xl font-bold text-ink-900 tabular-nums">
                    {formatCurrency(cartTotal)}
                  </span>
                </div>
                <p className="text-xs text-ink-400 text-center">
                  Pay in person when your order is served — no online payment.
                </p>
                <button
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="w-full flex items-center justify-center gap-2 rounded-lg bg-primary-600 text-ink-950 py-3 font-bold disabled:opacity-60"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="h-5 w-5 animate-spin" />
                      Sending…
                    </>
                  ) : (
                    <>
                      <Send className="h-5 w-5" />
                      Place Order
                    </>
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function OrderStatusTracker({ order: initialOrder, tableLabel }: { order: Order; tableLabel: string }) {
  const [order, setOrder] = useState(initialOrder);

  useEffect(() => {
    const channel = supabase
      .channel(`customer-order-${initialOrder.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${initialOrder.id}` },
        (payload) => {
          setOrder((prev) => ({ ...prev, ...(payload.new as Order) }));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [initialOrder.id]);

  const steps = [
    { key: 'submitted', label: 'Order Sent', icon: Send, done: true },
    {
      key: 'confirmed',
      label: 'Cashier Accepted',
      icon: CheckCircle2,
      done: Boolean(order.confirmed_at),
    },
    {
      key: 'preparing',
      label: 'Preparing',
      icon: Flame,
      done: order.status === 'preparing' || order.status === 'ready' || order.status === 'served',
    },
    {
      key: 'ready',
      label: 'Ready',
      icon: Bell,
      done: order.status === 'ready' || order.status === 'served',
    },
    {
      key: 'paid',
      label: 'Completed',
      icon: PartyPopper,
      done: order.payment_status === 'paid',
    },
  ];

  const isComplete = order.payment_status === 'paid';

  return (
    <div className="min-h-screen bg-ink-50 flex flex-col items-center px-6 py-10">
      <Logo size="sm" />
      <div className="mt-8 w-full max-w-sm rounded-2xl bg-surface shadow-sm ring-1 ring-ink-200/60 p-6 text-center">
        <ChefHat className="h-10 w-10 text-primary-600 mx-auto mb-2" />
        <h1 className="text-lg font-bold text-ink-900">Order #{order.order_number}</h1>
        <p className="text-xs text-ink-500 mt-0.5">{tableLabel}</p>

        <div className="mt-6 space-y-4 text-left">
          {steps.map((step) => {
            const Icon = step.icon;
            return (
              <div key={step.key} className="flex items-center gap-3">
                <div
                  className={`h-8 w-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                    step.done ? 'bg-success-100 text-success-700' : 'bg-ink-100 text-ink-400'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                </div>
                <span className={`text-sm font-semibold ${step.done ? 'text-ink-900' : 'text-ink-400'}`}>
                  {step.label}
                </span>
              </div>
            );
          })}
        </div>

        <div className="mt-6 pt-4 border-t border-ink-200 text-sm text-ink-500">
          {isComplete ? (
            <span className="font-semibold text-success-700">
              {formatCurrency(order.total)} · Paid — thank you!
            </span>
          ) : (
            <span>{formatCurrency(order.total)} · Pay in person at your table</span>
          )}
        </div>
      </div>

      <div className="mt-6">
        <DeveloperCredit variant="light" />
      </div>
    </div>
  );
}

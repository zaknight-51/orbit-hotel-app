import { useState, useMemo, useCallback } from 'react';
import { useMenu } from '@/hooks/useMenu';
import { supabase } from '@/lib/supabase';
import { formatCurrency } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import {
  Search,
  Plus,
  Minus,
  Trash2,
  ShoppingBag,
  Send,
  X,
  Loader2,
  CheckCircle2,
  StickyNote,
  UtensilsCrossed,
  AlertCircle,
} from 'lucide-react';
import type { CartItem } from '@/types';

export function PosScreen() {
  const { items, loading: menuLoading } = useMenu();

  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('All');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [orderNotes, setOrderNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const categories = useMemo(() => {
    const cats = Array.from(new Set(items.map((i) => i.category)));
    return ['All', ...cats];
  }, [items]);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const matchesCategory = activeCategory === 'All' || item.category === activeCategory;
      const matchesSearch =
        search.trim() === '' ||
        item.name.toLowerCase().includes(search.trim().toLowerCase()) ||
        (item.description ?? '').toLowerCase().includes(search.trim().toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [items, activeCategory, search]);

  const cartTotal = useMemo(
    () => cart.reduce((sum, item) => sum + item.price * item.quantity, 0),
    [cart]
  );

  const cartCount = useMemo(
    () => cart.reduce((sum, item) => sum + item.quantity, 0),
    [cart]
  );

  const addToCart = useCallback((item: { id: string; name: string; price: number }) => {
    setCart((prev) => {
      const existing = prev.find((c) => c.menu_item_id === item.id && c.notes === '');
      if (existing) {
        return prev.map((c) =>
          c.menu_item_id === item.id && c.notes === ''
            ? { ...c, quantity: c.quantity + 1 }
            : c
        );
      }
      return [
        ...prev,
        { menu_item_id: item.id, name: item.name, price: item.price, quantity: 1, notes: '' },
      ];
    });
    setSuccess(null);
  }, []);

  const updateQuantity = useCallback((index: number, delta: number) => {
    setCart((prev) =>
      prev
        .map((item, i) =>
          i === index ? { ...item, quantity: item.quantity + delta } : item
        )
        .filter((item) => item.quantity > 0)
    );
  }, []);

  const removeItem = useCallback((index: number) => {
    setCart((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const updateItemNotes = useCallback((index: number, notes: string) => {
    setCart((prev) => prev.map((item, i) => (i === index ? { ...item, notes } : item)));
  }, []);

  const clearCart = useCallback(() => {
    setCart([]);
    setOrderNotes('');
    setError(null);
  }, []);

  async function handleSubmitOrder() {
    if (cart.length === 0) return;
    setSubmitting(true);
    setError(null);
    setSuccess(null);

    const itemsPayload = cart.map((c) => ({
      menu_item_id: c.menu_item_id,
      name: c.name,
      price: c.price,
      quantity: c.quantity,
      notes: c.notes || null,
    }));

    const { data, error: rpcError } = await supabase.rpc('create_order', {
      p_notes: orderNotes || null,
      p_items: itemsPayload,
    });

    if (rpcError) {
      setError(rpcError.message);
      setSubmitting(false);
      return;
    }

    const orderNum = (data as { order_number?: number })?.order_number;
    setSuccess(`Order #${orderNum} sent to kitchen!`);
    clearCart();
    setSubmitting(false);
  }

  return (
    <div className="flex flex-col h-[calc(100vh-3rem)] lg:h-[calc(100vh-2rem)]">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-bold text-ink-900">POS — New Order</h1>
          <p className="text-sm text-ink-500">Build an order and send it to the kitchen</p>
        </div>
        {success && (
          <div className="flex items-center gap-2 rounded-lg bg-success-50 border border-success-500/20 px-4 py-2.5 animate-fade-in">
            <CheckCircle2 className="h-5 w-5 text-success-600 flex-shrink-0" />
            <span className="text-sm font-semibold text-success-700">{success}</span>
            <button
              onClick={() => setSuccess(null)}
              className="ml-1 text-success-600 hover:text-success-800"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-1 gap-4 min-h-0">
        {/* Menu panel */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Search */}
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-ink-400" />
            <input
              type="text"
              placeholder="Search menu items…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-ink-300 bg-surface pl-11 pr-4 py-2.5 text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition"
            />
          </div>

          {/* Category tabs */}
          <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`whitespace-nowrap rounded-lg px-3.5 py-1.5 text-sm font-semibold transition ${
                  activeCategory === cat
                    ? 'bg-primary-600 text-ink-950 shadow-sm'
                    : 'bg-surface text-ink-600 border border-ink-200 hover:bg-ink-50'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Items grid */}
          <div className="flex-1 overflow-y-auto pr-1">
            {menuLoading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <UtensilsCrossed className="h-10 w-10 text-ink-300 mb-3" />
                <p className="text-sm font-medium text-ink-600">No items found</p>
                <p className="text-xs text-ink-400 mt-1">Try a different search or category</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
                {filteredItems.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => addToCart(item)}
                    className="group flex flex-col rounded-xl bg-surface p-4 text-left shadow-sm ring-1 ring-ink-200/60 hover:ring-primary-400 hover:shadow-md transition text-left"
                  >
                    {item.image_url && (
                      <img
                        src={item.image_url}
                        alt=""
                        className="mb-3 h-24 w-full rounded-lg object-cover"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    )}
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <h3 className="text-sm font-bold text-ink-900 leading-tight">
                        {item.name}
                      </h3>
                      <span className="text-sm font-bold text-primary-600 flex-shrink-0">
                        {formatCurrency(item.price)}
                      </span>
                    </div>
                    {item.description && (
                      <p className="text-xs text-ink-500 leading-relaxed line-clamp-2 flex-1">
                        {item.description}
                      </p>
                    )}
                    <div className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-primary-600 opacity-0 group-hover:opacity-100 transition">
                      <Plus className="h-4 w-4" />
                      Add to order
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Cart panel */}
        <div className="w-full max-w-sm flex flex-col rounded-xl bg-surface shadow-sm ring-1 ring-ink-200/60">
          <div className="flex items-center justify-between border-b border-ink-200 px-5 py-4">
            <div className="flex items-center gap-2">
              <ShoppingBag className="h-5 w-5 text-primary-600" />
              <h2 className="font-bold text-ink-900">Current Order</h2>
              {cartCount > 0 && (
                <span className="rounded-full bg-primary-600 text-ink-950 text-xs font-bold px-2 py-0.5">
                  {cartCount}
                </span>
              )}
            </div>
            {cart.length > 0 && (
              <button
                onClick={clearCart}
                className="text-xs font-semibold text-ink-400 hover:text-error-600 transition"
              >
                Clear all
              </button>
            )}
          </div>

          {/* Cart items */}
          <div className="flex-1 overflow-y-auto px-5 py-3 min-h-0">
            {cart.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <ShoppingBag className="h-10 w-10 text-ink-300 mb-3" />
                <p className="text-sm font-medium text-ink-500">Cart is empty</p>
                <p className="text-xs text-ink-400 mt-1">
                  Click menu items to add them
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {cart.map((item, index) => (
                  <div
                    key={`${item.menu_item_id}-${index}`}
                    className="rounded-lg border border-ink-200 p-3 animate-fade-in"
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-semibold text-ink-900 truncate">
                          {item.name}
                        </h3>
                        <p className="text-xs text-ink-500">
                          {formatCurrency(item.price)} each
                        </p>
                      </div>
                      <button
                        onClick={() => removeItem(index)}
                        className="text-ink-400 hover:text-error-600 transition flex-shrink-0"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => updateQuantity(index, -1)}
                          className="h-7 w-7 rounded-md border border-ink-300 flex items-center justify-center text-ink-600 hover:bg-ink-50 transition"
                        >
                          <Minus className="h-3.5 w-3.5" />
                        </button>
                        <span className="w-8 text-center text-sm font-bold text-ink-900 tabular-nums">
                          {item.quantity}
                        </span>
                        <button
                          onClick={() => updateQuantity(index, 1)}
                          className="h-7 w-7 rounded-md border border-ink-300 flex items-center justify-center text-ink-600 hover:bg-ink-50 transition"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <span className="text-sm font-bold text-ink-900 tabular-nums">
                        {formatCurrency(item.price * item.quantity)}
                      </span>
                    </div>

                    <div className="mt-2 relative">
                      <StickyNote className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-400" />
                      <input
                        type="text"
                        placeholder="Item notes (e.g. no onions)"
                        value={item.notes}
                        onChange={(e) => updateItemNotes(index, e.target.value)}
                        className="w-full rounded-md border border-ink-200 bg-ink-50 pl-8 pr-2 py-1.5 text-xs text-ink-800 placeholder:text-ink-400 focus:outline-none focus:ring-1 focus:ring-primary-400 focus:border-primary-400 transition"
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Order notes + total + submit */}
          {cart.length > 0 && (
            <div className="border-t border-ink-200 p-5 space-y-3">
              <div className="relative">
                <StickyNote className="absolute left-3 top-3 h-4 w-4 text-ink-400" />
                <textarea
                  placeholder="Order notes for kitchen…"
                  value={orderNotes}
                  onChange={(e) => setOrderNotes(e.target.value)}
                  rows={2}
                  className="w-full rounded-lg border border-ink-300 bg-surface pl-9 pr-3 py-2 text-sm text-ink-800 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition resize-none"
                />
              </div>

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

              <Button
                onClick={handleSubmitOrder}
                disabled={submitting || cart.length === 0}
                size="lg"
                className="w-full"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Sending…
                  </>
                ) : (
                  <>
                    <Send className="h-5 w-5" />
                    Send to Kitchen
                  </>
                )}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

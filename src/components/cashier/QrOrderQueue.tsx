import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { formatCurrency, formatTime } from '@/lib/format';
import { QrCode, Loader2, Send, AlertCircle } from 'lucide-react';
import type { Order } from '@/types';

/**
 * Orders submitted by customers via table QR codes, awaiting the cashier's
 * review before they're sent to the kitchen. Per spec: the cashier can only
 * review the order and press "Accept & Send to Kitchen" — there is no item
 * editing here. Accepting calls the `confirm_customer_order` RPC, which
 * sets `confirmed_at`; the kitchen board picks the order up automatically
 * over the same realtime channel already used everywhere else in the app.
 */
export function QrOrderQueue({ orders }: { orders: Order[] }) {
  const pending = orders.filter((o) => o.order_source === 'qr' && !o.confirmed_at);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (pending.length === 0) return null;

  async function handleAccept(orderId: string) {
    setConfirmingId(orderId);
    setError(null);
    const { error: rpcError } = await supabase.rpc('confirm_customer_order', {
      p_order_id: orderId,
    });
    if (rpcError) {
      setError(rpcError.message);
    }
    setConfirmingId(null);
  }

  return (
    <div className="rounded-xl bg-surface p-6 shadow-sm ring-1 ring-primary-200 border-l-4 border-l-primary-500">
      <div className="flex items-center gap-2 mb-4">
        <QrCode className="h-5 w-5 text-primary-600" />
        <h2 className="text-lg font-bold text-ink-900">QR Orders Awaiting Confirmation</h2>
        <span className="rounded-full bg-primary-600 text-ink-950 text-xs font-bold px-2 py-0.5">
          {pending.length}
        </span>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg bg-error-50 border border-error-500/20 px-3 py-2 mb-3">
          <AlertCircle className="h-4 w-4 text-error-600 flex-shrink-0 mt-0.5" />
          <span className="text-xs text-error-700">{error}</span>
        </div>
      )}

      <div className="space-y-3">
        {pending.map((order) => (
          <div
            key={order.id}
            className="rounded-lg border border-primary-200 bg-primary-50/40 p-4"
          >
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-ink-900">#{order.order_number}</span>
                  {order.table && (
                    <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] font-bold text-primary-700 ring-1 ring-primary-200">
                      Table {order.table.table_number}
                    </span>
                  )}
                </div>
                <p className="text-xs text-ink-500 mt-0.5">
                  {order.item_count} items · {formatCurrency(order.total)} ·{' '}
                  {formatTime(order.created_at)}
                </p>
              </div>
            </div>

            <div className="space-y-1 mb-3">
              {(order.order_items ?? []).map((item) => (
                <div key={item.id} className="flex items-baseline gap-2 text-sm">
                  <span className="font-bold text-ink-900 tabular-nums flex-shrink-0">
                    {item.quantity}×
                  </span>
                  <span className="text-ink-800 flex-1">{item.name}</span>
                  {item.notes && (
                    <span className="text-xs text-ink-500 italic">({item.notes})</span>
                  )}
                </div>
              ))}
            </div>

            {order.notes && (
              <div className="mb-3 rounded-md bg-surface p-2.5 text-xs text-ink-600">
                <span className="font-semibold text-ink-700">Notes: </span>
                {order.notes}
              </div>
            )}

            <button
              onClick={() => handleAccept(order.id)}
              disabled={confirmingId === order.id}
              className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-primary-600 py-2 text-sm font-bold text-ink-950 hover:bg-primary-700 transition disabled:opacity-60"
            >
              {confirmingId === order.id ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Sending…
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" />
                  Accept &amp; Send to Kitchen
                </>
              )}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

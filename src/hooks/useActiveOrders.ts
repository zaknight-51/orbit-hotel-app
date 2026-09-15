import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import type { Order, OrderStatus } from '@/types';

export type ActiveOrdersView = 'kitchen' | 'cashier';

/**
 * Subscribes to "active" orders with realtime updates. What counts as
 * active depends on the view:
 *  - 'kitchen' (default): status IN ('new', 'preparing') — the kitchen's
 *    three active stages are ACCEPT (new) -> PREPARING -> READY. The
 *    moment an order is marked READY, it's done in the kitchen and leaves
 *    this view; the cashier picks it up from there (see 'cashier' below).
 *    A QR (customer-submitted) order only appears here once the cashier
 *    has confirmed it (see `confirmed_at`) — an unconfirmed QR order isn't
 *    in the kitchen's queue yet.
 *  - 'cashier': payment_status != 'paid' — the cashier's job on an order
 *    isn't done until it's been paid, so this includes orders still being
 *    cooked, ones that are READY, and — for QR orders — ones still
 *    awaiting the cashier's own accept/confirm step.
 *
 * Returns the current list, loading state, and functions to update order
 * status / payment status.
 */
export function useActiveOrders(view: ActiveOrdersView = 'kitchen') {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchOrders = useCallback(async () => {
    let query = supabase
      .from('orders')
      .select(
        'id, order_number, status, payment_status, discount_amount, notes, total, item_count, created_by, created_at, updated_at, table_id, order_source, confirmed_at, table:tables(id, table_number, name), order_items(id, order_id, menu_item_id, name, price, quantity, notes, created_at)'
      );

    query =
      view === 'cashier'
        ? query.neq('payment_status', 'paid')
        : query
            .in('status', ['new', 'preparing'])
            .or('order_source.eq.staff,confirmed_at.not.is.null');

    const { data, error: fetchError } = await query.order('created_at', {
      ascending: true,
    });

    if (fetchError) {
      console.error('Failed to load orders:', fetchError.message);
      setError(fetchError.message);
      return;
    }
    setError(null);
    setOrders((data ?? []) as unknown as Order[]);
  }, [view]);

  const [realtimeStatus, setRealtimeStatus] = useState<
    'connecting' | 'connected' | 'error'
  >('connecting');

  useEffect(() => {
    fetchOrders().finally(() => setLoading(false));

    const channel = supabase
      .channel('active-orders-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders' },
        () => {
          fetchOrders();
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'order_items' },
        () => {
          fetchOrders();
        }
      )
      .subscribe((status: string) => {
        if (status === 'SUBSCRIBED') {
          setRealtimeStatus('connected');
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setRealtimeStatus('error');
          console.error('Realtime subscription for orders failed:', status);
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchOrders]);

  const updateOrderStatus = useCallback(
    async (orderId: string, status: OrderStatus) => {
      const { error } = await supabase
        .from('orders')
        .update({ status })
        .eq('id', orderId);
      if (error) {
        console.error('Failed to update order status:', error.message);
        throw error;
      }
    },
    []
  );

  const updatePaymentStatus = useCallback(
    async (orderId: string, paymentStatus: 'unpaid' | 'paid') => {
      const { error } = await supabase
        .from('orders')
        .update({ payment_status: paymentStatus })
        .eq('id', orderId);
      if (error) {
        console.error('Failed to update payment status:', error.message);
        throw error;
      }
    },
    []
  );

  return {
    orders,
    loading,
    error,
    realtimeStatus,
    updateOrderStatus,
    updatePaymentStatus,
    refetch: fetchOrders,
  };
}

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import type { Order } from '@/types';

/**
 * Loads all orders (including served/historical) with realtime updates.
 * Supports optional date filtering and search.
 */
export function useAllOrders() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchOrders = useCallback(async () => {
    const { data, error } = await supabase
      .from('orders')
      .select(
        'id, order_number, status, payment_status, discount_amount, notes, total, item_count, created_by, created_at, updated_at, order_items(id, order_id, menu_item_id, name, price, quantity, notes, created_at)'
      )
      .order('created_at', { ascending: false })
      .limit(500);

    if (error) {
      console.error('Failed to load orders:', error.message);
      return;
    }
    setOrders((data ?? []) as unknown as Order[]);
  }, []);

  useEffect(() => {
    fetchOrders().finally(() => setLoading(false));

    const channel = supabase
      .channel('all-orders-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders' },
        () => fetchOrders()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'order_items' },
        () => fetchOrders()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchOrders]);

  const updateDiscount = useCallback(async (orderId: string, discountAmount: number) => {
    const { error } = await supabase
      .from('orders')
      .update({ discount_amount: discountAmount })
      .eq('id', orderId);
    if (error) {
      console.error('Failed to update discount:', error.message);
      throw error;
    }
  }, []);

  // Admin-only at the database level (RLS) regardless of who calls this —
  // order_items cascade-delete automatically via their FK, so this never
  // leaves orphaned rows.
  const deleteOrder = useCallback(async (orderId: string) => {
    const { error } = await supabase.from('orders').delete().eq('id', orderId);
    if (error) {
      console.error('Failed to delete order:', error.message);
      throw error;
    }
  }, []);

  // Bulk delete (Delete Selected / Delete All) — same RLS/cascade
  // guarantees as deleteOrder, just scoped to many ids at once.
  const deleteOrders = useCallback(async (orderIds: string[]) => {
    if (orderIds.length === 0) return;
    const { error } = await supabase.from('orders').delete().in('id', orderIds);
    if (error) {
      console.error('Failed to delete orders:', error.message);
      throw error;
    }
  }, []);

  return { orders, loading, updateDiscount, deleteOrder, deleteOrders, refetch: fetchOrders };
}

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import type { MenuItem } from '@/types';

/**
 * Loads menu items (non-realtime; menu changes are infrequent).
 * By default only available items are returned (used by the POS screen).
 * Pass `includeUnavailable: true` for admin screens that need to manage
 * every item, including ones currently hidden from the POS.
 */
export function useMenu(includeUnavailable = false) {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchMenu = useCallback(async () => {
    let query = supabase
      .from('menu_items')
      .select('*')
      .order('category', { ascending: true })
      .order('sort_order', { ascending: true });

    if (!includeUnavailable) {
      query = query.eq('available', true);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Failed to load menu:', error.message);
      return;
    }
    setItems((data ?? []) as MenuItem[]);
  }, [includeUnavailable]);

  useEffect(() => {
    fetchMenu().finally(() => setLoading(false));
  }, [fetchMenu]);

  return { items, loading, refetch: fetchMenu };
}

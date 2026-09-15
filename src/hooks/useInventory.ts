import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import type { InventoryItem } from '@/types';

export function useInventory() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchItems = useCallback(async () => {
    const { data, error } = await supabase
      .from('inventory_items')
      .select('*')
      .order('name', { ascending: true });

    if (error) {
      console.error('Failed to load inventory:', error.message);
      return;
    }
    setItems((data ?? []) as InventoryItem[]);
  }, []);

  useEffect(() => {
    fetchItems().finally(() => setLoading(false));

    const channel = supabase
      .channel('inventory-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'inventory_items' },
        () => fetchItems()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchItems]);

  const createItem = useCallback(
    async (item: Omit<InventoryItem, 'id' | 'created_at' | 'updated_at'>) => {
      const { error } = await supabase.from('inventory_items').insert(item);
      if (error) throw error;
    },
    []
  );

  const updateItem = useCallback(
    async (id: string, updates: Partial<InventoryItem>) => {
      const { error } = await supabase
        .from('inventory_items')
        .update(updates)
        .eq('id', id);
      if (error) throw error;
    },
    []
  );

  const deleteItem = useCallback(async (id: string) => {
    const { error } = await supabase.from('inventory_items').delete().eq('id', id);
    if (error) throw error;
  }, []);

  return {
    items,
    loading,
    createItem,
    updateItem,
    deleteItem,
    refetch: fetchItems,
  };
}

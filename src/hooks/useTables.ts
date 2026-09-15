import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { RestaurantTable } from '@/types';

/**
 * Table Management: create tables, list them, generate/view/print their
 * QR codes, and delete a table (admin-only, enforced by RLS).
 */
export function useTables() {
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTables = useCallback(async () => {
    const { data, error: fetchError } = await supabase
      .from('tables')
      .select('id, table_number, name, qr_token, is_active, created_at, updated_at')
      .order('table_number', { ascending: true });

    if (fetchError) {
      setError(fetchError.message);
      return;
    }
    setError(null);
    setTables((data ?? []) as RestaurantTable[]);
  }, []);

  useEffect(() => {
    fetchTables().finally(() => setLoading(false));

    const channel = supabase
      .channel('tables-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tables' },
        () => {
          fetchTables();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchTables]);

  const addTable = useCallback(async (name: string) => {
    // table_number is auto-assigned by the database (identity column) —
    // never sent from the client, so numbering stays sequential and
    // collision-free even if two adds happen at nearly the same time.
    const { error: insertError } = await supabase.from('tables').insert({
      name: name || null,
    });
    if (insertError) {
      throw insertError;
    }
  }, []);

  const deleteTable = useCallback(async (id: string) => {
    // Admin-only at the database layer (see tables_delete_admin RLS
    // policy). Any past order pointing at this table keeps its history —
    // orders.table_id is ON DELETE SET NULL, so it just loses the link.
    const { error: deleteError } = await supabase.from('tables').delete().eq('id', id);
    if (deleteError) {
      throw deleteError;
    }
  }, []);

  return { tables, loading, error, addTable, deleteTable, refetch: fetchTables };
}

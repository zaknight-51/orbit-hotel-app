import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import type { Category } from '@/types';

export function useCategories() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchCategories = useCallback(async () => {
    const { data, error } = await supabase
      .from('categories')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });

    if (error) {
      console.error('Failed to load categories:', error.message);
      return;
    }
    setCategories((data ?? []) as Category[]);
  }, []);

  useEffect(() => {
    fetchCategories().finally(() => setLoading(false));

    const channel = supabase
      .channel('categories-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'categories' },
        () => fetchCategories()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchCategories]);

  const createCategory = useCallback(
    async (name: string, sortOrder: number) => {
      const { error } = await supabase
        .from('categories')
        .insert({ name, sort_order: sortOrder });
      if (error) throw error;
    },
    []
  );

  const updateCategory = useCallback(
    async (id: string, name: string, sortOrder: number) => {
      const { error } = await supabase
        .from('categories')
        .update({ name, sort_order: sortOrder })
        .eq('id', id);
      if (error) throw error;
    },
    []
  );

  const deleteCategory = useCallback(async (id: string) => {
    const { error } = await supabase.from('categories').delete().eq('id', id);
    if (error) throw error;
  }, []);

  return {
    categories,
    loading,
    createCategory,
    updateCategory,
    deleteCategory,
    refetch: fetchCategories,
  };
}

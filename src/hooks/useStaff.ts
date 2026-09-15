import { useEffect, useState, useCallback } from 'react';
import { supabase, createEphemeralAuthClient } from '@/lib/supabase';
import type { Profile, UserRole } from '@/types';

export interface NewStaffInput {
  email: string;
  password: string;
  full_name: string;
  role: UserRole;
}

/**
 * Loads all staff profiles with realtime updates, and provides admin CRUD
 * operations (create/update/delete) backed by the `profiles` table.
 */
export function useStaff() {
  const [staff, setStaff] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchStaff = useCallback(async () => {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, full_name, role, is_active, created_at, updated_at')
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Failed to load staff:', error.message);
      return;
    }
    setStaff((data ?? []) as Profile[]);
  }, []);

  useEffect(() => {
    fetchStaff().finally(() => setLoading(false));

    const channel = supabase
      .channel('staff-profiles-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'profiles' },
        () => fetchStaff()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchStaff]);

  /**
   * Creates a new staff account. Uses a throwaway, non-persisting auth
   * client so the admin performing this action stays signed in on the
   * main client. The `handle_new_user` DB trigger auto-creates the
   * matching `profiles` row from the metadata passed here.
   */
  const createStaff = useCallback(async (input: NewStaffInput) => {
    const ephemeralClient = createEphemeralAuthClient();
    const { error } = await ephemeralClient.auth.signUp({
      email: input.email.trim(),
      password: input.password,
      options: {
        data: {
          full_name: input.full_name.trim(),
          role: input.role,
        },
      },
    });
    if (error) throw error;
    await ephemeralClient.auth.signOut();
  }, []);

  const updateStaff = useCallback(
    async (id: string, updates: { full_name?: string; role?: UserRole; is_active?: boolean }) => {
      const { error } = await supabase.from('profiles').update(updates).eq('id', id);
      if (error) throw error;
    },
    []
  );

  const deleteStaff = useCallback(async (id: string) => {
    const { error } = await supabase.from('profiles').delete().eq('id', id);
    if (error) throw error;
  }, []);

  return {
    staff,
    loading,
    createStaff,
    updateStaff,
    deleteStaff,
    refetch: fetchStaff,
  };
}

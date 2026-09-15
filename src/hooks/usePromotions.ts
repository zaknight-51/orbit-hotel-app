import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { guessMediaTypeFromUrl } from '@/lib/promoMedia';
import type { Promotion } from '@/types';

const MEDIA_BUCKET = 'promotion-media';
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8MB
const MAX_VIDEO_BYTES = 60 * 1024 * 1024; // 60MB

export type NewPromotionMediaInput =
  | { kind: 'file'; file: File }
  | { kind: 'url'; url: string };

/**
 * `activeOnly`: the customer ordering page passes true so it only ever
 * requests active promotions. This is a convenience for that caller, not
 * the security boundary — the public RLS policy (`promotions_select_
 * active_public`) is what actually prevents an anonymous/customer session
 * from ever reading an inactive or admin-only promotion, regardless of
 * what this hook asks for. The same applies to `promotion_media`.
 */
export function usePromotions(activeOnly = false) {
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPromotions = useCallback(async () => {
    let query = supabase
      .from('promotions')
      .select(
        'id, title, url, is_active, sort_order, created_at, updated_at, media:promotion_media(id, promotion_id, media_url, media_type, sort_order, created_at)'
      );

    if (activeOnly) {
      query = query.eq('is_active', true);
    }

    const { data, error: fetchError } = await query.order('sort_order', { ascending: true });

    if (fetchError) {
      setError(fetchError.message);
      return;
    }
    setError(null);
    setPromotions((data ?? []) as Promotion[]);
  }, [activeOnly]);

  useEffect(() => {
    fetchPromotions().finally(() => setLoading(false));

    const channel = supabase
      .channel('promotions-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'promotions' },
        () => {
          fetchPromotions();
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'promotion_media' },
        () => {
          fetchPromotions();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchPromotions]);

  /**
   * Uploads one file to the promotion-media Storage bucket and returns its
   * public URL — same pattern already used for menu item photos
   * (menu-images bucket), just a different bucket.
   */
  const uploadPromotionFile = useCallback(async (file: File): Promise<string> => {
    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');
    if (!isImage && !isVideo) {
      throw new Error(`"${file.name}" isn't an image or video file.`);
    }
    if (isImage && file.size > MAX_IMAGE_BYTES) {
      throw new Error(`"${file.name}" is over 8MB. Please use a smaller image.`);
    }
    if (isVideo && file.size > MAX_VIDEO_BYTES) {
      throw new Error(`"${file.name}" is over 60MB. Please use a smaller video.`);
    }

    const ext = file.name.split('.').pop() ?? (isImage ? 'jpg' : 'mp4');
    const path = `${crypto.randomUUID()}.${ext}`;
    const { error: uploadErr } = await supabase.storage
      .from(MEDIA_BUCKET)
      .upload(path, file, { cacheControl: '3600', upsert: false });
    if (uploadErr) throw uploadErr;

    const { data } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path);
    return data.publicUrl;
  }, []);

  /**
   * Creates a promotion with any number of media items — any mix of
   * uploaded files and pasted URLs, images and videos together. The first
   * resolved item's URL is also stored on `promotions.url` itself, purely
   * so any older code path that only knows about the single-URL field
   * still has something sensible to show; the actual media list customers
   * see comes from `promotion_media`.
   */
  const addPromotion = useCallback(
    async (title: string, mediaInputs: NewPromotionMediaInput[]) => {
      if (mediaInputs.length === 0) {
        throw new Error('Add at least one image or video.');
      }

      const resolved: { url: string; type: 'image' | 'video' }[] = [];
      for (const input of mediaInputs) {
        if (input.kind === 'file') {
          const url = await uploadPromotionFile(input.file);
          resolved.push({ url, type: input.file.type.startsWith('video/') ? 'video' : 'image' });
        } else {
          resolved.push({ url: input.url, type: guessMediaTypeFromUrl(input.url) });
        }
      }

      const { data: promo, error: insertError } = await supabase
        .from('promotions')
        .insert({ title, url: resolved[0].url })
        .select('id')
        .single();
      if (insertError) throw insertError;

      const { error: mediaError } = await supabase.from('promotion_media').insert(
        resolved.map((item, index) => ({
          promotion_id: promo.id,
          media_url: item.url,
          media_type: item.type,
          sort_order: index,
        }))
      );
      if (mediaError) throw mediaError;
    },
    [uploadPromotionFile]
  );

  /**
   * Optimistically flips the switch immediately (so it always feels like a
   * real, responsive toggle rather than waiting on a realtime round-trip),
   * then persists it — and reverts the local state if the save actually
   * fails, surfacing the error instead of silently doing nothing.
   */
  const togglePromotion = useCallback(async (id: string, isActive: boolean) => {
    setPromotions((prev) => prev.map((p) => (p.id === id ? { ...p, is_active: isActive } : p)));

    const { error: updateError } = await supabase
      .from('promotions')
      .update({ is_active: isActive })
      .eq('id', id);

    if (updateError) {
      setPromotions((prev) =>
        prev.map((p) => (p.id === id ? { ...p, is_active: !isActive } : p))
      );
      throw updateError;
    }
  }, []);

  const deletePromotion = useCallback(async (id: string) => {
    const { error: deleteError } = await supabase.from('promotions').delete().eq('id', id);
    if (deleteError) throw deleteError;
  }, []);

  return {
    promotions,
    loading,
    error,
    addPromotion,
    togglePromotion,
    deletePromotion,
    uploadPromotionFile,
    refetch: fetchPromotions,
  };
}

/*
# Promotion media: multiple images/videos per promotion + direct upload

## Summary
Extends the Part 5 promotions feature (unchanged) to support MULTIPLE media
items per promotion — any mix of pasted URLs and files uploaded directly
from the admin's PC — instead of the single `promotions.url` column.

Additive only:
- `promotions.url`/`title` are untouched, so any existing promotion still
  works exactly as before (the frontend falls back to it when a promotion
  has no rows in `promotion_media` yet).
- New table `promotion_media` holds one row per image/video, ordered by
  `sort_order`, linked to its parent promotion.
- New public Storage bucket `promotion-media` for uploaded files, secured
  with the exact same pattern already used for `menu-images` (public read,
  admin-only write).

Security mirrors `promotions` itself: admin manages everything, the public
(anon + authenticated, which includes the customer's anonymous ordering
session) can only ever read media belonging to an ACTIVE promotion.

Idempotent — safe to re-run.
*/

CREATE TABLE IF NOT EXISTS promotion_media (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promotion_id uuid NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
  media_url text NOT NULL,
  media_type text NOT NULL CHECK (media_type IN ('image', 'video')),
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_promotion_media_promotion_id ON promotion_media(promotion_id);

ALTER TABLE promotion_media ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "promotion_media_select_admin" ON promotion_media;
CREATE POLICY "promotion_media_select_admin" ON promotion_media
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

DROP POLICY IF EXISTS "promotion_media_select_active_public" ON promotion_media;
CREATE POLICY "promotion_media_select_active_public" ON promotion_media
  FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM promotions p WHERE p.id = promotion_media.promotion_id AND p.is_active = true));

DROP POLICY IF EXISTS "promotion_media_insert_admin" ON promotion_media;
CREATE POLICY "promotion_media_insert_admin" ON promotion_media
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

DROP POLICY IF EXISTS "promotion_media_delete_admin" ON promotion_media;
CREATE POLICY "promotion_media_delete_admin" ON promotion_media
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

ALTER TABLE promotion_media REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='promotion_media') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE promotion_media;
  END IF;
END $$;

-- Storage bucket for uploaded promotion images/videos — same pattern as
-- the existing menu-images bucket: public read (so the customer QR page
-- can display them with no signed URL), admin-only write.
INSERT INTO storage.buckets (id, name, public)
VALUES ('promotion-media', 'promotion-media', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "promotion_media_bucket_public_read" ON storage.objects;
CREATE POLICY "promotion_media_bucket_public_read"
ON storage.objects FOR SELECT
USING (bucket_id = 'promotion-media');

DROP POLICY IF EXISTS "promotion_media_bucket_admin_insert" ON storage.objects;
CREATE POLICY "promotion_media_bucket_admin_insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'promotion-media'
  AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
);

DROP POLICY IF EXISTS "promotion_media_bucket_admin_update" ON storage.objects;
CREATE POLICY "promotion_media_bucket_admin_update"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'promotion-media'
  AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
)
WITH CHECK (
  bucket_id = 'promotion-media'
  AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
);

DROP POLICY IF EXISTS "promotion_media_bucket_admin_delete" ON storage.objects;
CREATE POLICY "promotion_media_bucket_admin_delete"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'promotion-media'
  AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
);

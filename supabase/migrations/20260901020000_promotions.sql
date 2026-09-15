/*
# Part 5: Promotion Management

## Summary
Adds a `promotions` table so Admin can advertise a business/company URL
(e.g. a social page, delivery app listing, or seasonal offer) that shows
as a small banner on the public customer QR ordering page.

Security mirrors the exact pattern already established for `tables` in
Part 1: staff (admin) manage everything, the public (anon + authenticated,
which includes the customer's anonymous ordering session) can only read
rows marked active. Nothing here touches any other table.

Idempotent — safe to re-run.
*/

CREATE TABLE IF NOT EXISTS promotions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  url text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE promotions ENABLE ROW LEVEL SECURITY;

-- Admin sees and manages every promotion (active or not).
DROP POLICY IF EXISTS "promotions_select_admin" ON promotions;
CREATE POLICY "promotions_select_admin" ON promotions
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

-- The public customer QR page (and its anonymous ordering session) may
-- only ever see active promotions — same shape as tables_select_public_active.
DROP POLICY IF EXISTS "promotions_select_active_public" ON promotions;
CREATE POLICY "promotions_select_active_public" ON promotions
  FOR SELECT TO anon, authenticated
  USING (is_active = true);

DROP POLICY IF EXISTS "promotions_insert_admin" ON promotions;
CREATE POLICY "promotions_insert_admin" ON promotions
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

DROP POLICY IF EXISTS "promotions_update_admin" ON promotions;
CREATE POLICY "promotions_update_admin" ON promotions
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

DROP POLICY IF EXISTS "promotions_delete_admin" ON promotions;
CREATE POLICY "promotions_delete_admin" ON promotions
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

DROP TRIGGER IF EXISTS promotions_touch_updated_at ON promotions;
CREATE TRIGGER promotions_touch_updated_at BEFORE UPDATE ON promotions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE promotions REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='promotions') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE promotions;
  END IF;
END $$;

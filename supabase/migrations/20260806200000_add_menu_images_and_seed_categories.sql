/*
# Add menu item images + seed default categories

## Summary
Two small additive changes needed to complete Menu Management:

1. `menu_items` gets an optional `image_url` column so admins can attach a
   photo (by URL) when creating/editing a food item. Nullable — existing
   rows are unaffected.
2. Seeds the four category names requested for the restaurant menu:
   Breakfast, Fast Food, Ethiopian Meals, Desserts. Uses
   `ON CONFLICT (name) DO NOTHING`, so this is safe to run even if some or
   all of these categories already exist (e.g. created manually by an
   admin) — nothing is overwritten or duplicated.

## Realtime
Also adds `profiles` to the `supabase_realtime` publication. Staff
Management already subscribes to profile changes; without this, admins
in different tabs/sessions wouldn't see staff edits live.
*/

-- ===== menu_items.image_url =====
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'menu_items' AND column_name = 'image_url'
  ) THEN
    ALTER TABLE menu_items ADD COLUMN image_url text;
  END IF;
END $$;

-- ===== seed default categories =====
INSERT INTO categories (name, sort_order)
VALUES
  ('Breakfast', 1),
  ('Fast Food', 2),
  ('Ethiopian Meals', 3),
  ('Desserts', 4)
ON CONFLICT (name) DO NOTHING;

-- ===== Realtime publication for profiles =====
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'profiles'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE profiles;
  END IF;
END $$;

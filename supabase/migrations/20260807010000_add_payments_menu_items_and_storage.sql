/*
# Add payment tracking, demo menu items, and menu image storage

## Summary
Three additive changes, all idempotent:

1. `orders.payment_status` ('unpaid' | 'paid', default 'unpaid') — lets a
   cashier mark an order as paid, independent of its kitchen status.
2. Seeds a handful of demo food items across the four default categories
   (Breakfast, Fast Food, Ethiopian Meals, Desserts), guarded by name so
   re-running this is safe.
3. Creates a public `menu-images` Storage bucket for food photos, with
   public read access and admin-only write access (mirrors the RLS model
   already used for `menu_items`/`categories`/`inventory_items`).

This migration's content is also folded into `supabase/COMPLETE_SETUP.sql`
for anyone using the single-file setup path instead of the CLI/migration
history.
*/

-- ===== orders.payment_status =====
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'payment_status'
  ) THEN
    ALTER TABLE orders ADD COLUMN payment_status text NOT NULL DEFAULT 'unpaid'
      CHECK (payment_status IN ('unpaid', 'paid'));
  END IF;
END $$;

-- ===== demo menu items =====
DO $$
DECLARE
  cat_id uuid;
BEGIN
  SELECT id INTO cat_id FROM categories WHERE name = 'Breakfast';
  IF cat_id IS NOT NULL THEN
    INSERT INTO menu_items (name, description, price, category, category_id, available, sort_order)
    SELECT 'Injera with Scrambled Eggs', 'Traditional sourdough flatbread with spiced scrambled eggs', 6.50, 'Breakfast', cat_id, true, 1
    WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE name = 'Injera with Scrambled Eggs');
    INSERT INTO menu_items (name, description, price, category, category_id, available, sort_order)
    SELECT 'Pancake Stack', 'Fluffy pancakes with honey and butter', 5.00, 'Breakfast', cat_id, true, 2
    WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE name = 'Pancake Stack');
    INSERT INTO menu_items (name, description, price, category, category_id, available, sort_order)
    SELECT 'Ful Medames', 'Slow-cooked fava beans with olive oil, garlic, and lemon', 5.50, 'Breakfast', cat_id, true, 3
    WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE name = 'Ful Medames');
  END IF;

  SELECT id INTO cat_id FROM categories WHERE name = 'Fast Food';
  IF cat_id IS NOT NULL THEN
    INSERT INTO menu_items (name, description, price, category, category_id, available, sort_order)
    SELECT 'Beef Burger', 'Grilled beef patty with lettuce, tomato, and fries', 8.00, 'Fast Food', cat_id, true, 1
    WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE name = 'Beef Burger');
    INSERT INTO menu_items (name, description, price, category, category_id, available, sort_order)
    SELECT 'Chicken Club Sandwich', 'Grilled chicken, bacon, lettuce, and mayo', 7.50, 'Fast Food', cat_id, true, 2
    WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE name = 'Chicken Club Sandwich');
    INSERT INTO menu_items (name, description, price, category, category_id, available, sort_order)
    SELECT 'Crispy Fries', 'Golden fries with a side of ketchup', 3.50, 'Fast Food', cat_id, true, 3
    WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE name = 'Crispy Fries');
  END IF;

  SELECT id INTO cat_id FROM categories WHERE name = 'Ethiopian Meals';
  IF cat_id IS NOT NULL THEN
    INSERT INTO menu_items (name, description, price, category, category_id, available, sort_order)
    SELECT 'Doro Wat', 'Spiced chicken stew served with injera', 12.00, 'Ethiopian Meals', cat_id, true, 1
    WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE name = 'Doro Wat');
    INSERT INTO menu_items (name, description, price, category, category_id, available, sort_order)
    SELECT 'Tibs', 'Sautéed beef or lamb with onions, peppers, and rosemary', 11.00, 'Ethiopian Meals', cat_id, true, 2
    WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE name = 'Tibs');
    INSERT INTO menu_items (name, description, price, category, category_id, available, sort_order)
    SELECT 'Vegetarian Combo', 'Assorted lentil and vegetable stews with injera', 10.00, 'Ethiopian Meals', cat_id, true, 3
    WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE name = 'Vegetarian Combo');
  END IF;

  SELECT id INTO cat_id FROM categories WHERE name = 'Desserts';
  IF cat_id IS NOT NULL THEN
    INSERT INTO menu_items (name, description, price, category, category_id, available, sort_order)
    SELECT 'Baklava', 'Layered pastry with honey and crushed nuts', 4.50, 'Desserts', cat_id, true, 1
    WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE name = 'Baklava');
    INSERT INTO menu_items (name, description, price, category, category_id, available, sort_order)
    SELECT 'Chocolate Cake', 'Rich chocolate layer cake with ganache', 5.00, 'Desserts', cat_id, true, 2
    WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE name = 'Chocolate Cake');
    INSERT INTO menu_items (name, description, price, category, category_id, available, sort_order)
    SELECT 'Fresh Fruit Plate', 'Seasonal fresh fruit selection', 4.00, 'Desserts', cat_id, true, 3
    WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE name = 'Fresh Fruit Plate');
  END IF;
END $$;

-- ===== menu-images storage bucket =====
INSERT INTO storage.buckets (id, name, public)
VALUES ('menu-images', 'menu-images', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "menu_images_public_read" ON storage.objects;
CREATE POLICY "menu_images_public_read"
ON storage.objects FOR SELECT
USING (bucket_id = 'menu-images');

DROP POLICY IF EXISTS "menu_images_admin_insert" ON storage.objects;
CREATE POLICY "menu_images_admin_insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'menu-images'
  AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
);

DROP POLICY IF EXISTS "menu_images_admin_update" ON storage.objects;
CREATE POLICY "menu_images_admin_update"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'menu-images'
  AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
)
WITH CHECK (
  bucket_id = 'menu-images'
  AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
);

DROP POLICY IF EXISTS "menu_images_admin_delete" ON storage.objects;
CREATE POLICY "menu_images_admin_delete"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'menu-images'
  AND EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
);

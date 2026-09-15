/*
# Add categories, inventory, and analytics support

## Summary
Introduces dedicated menu categories, an inventory/ingredient tracking table,
and a SQL function for daily sales reporting (used by Analytics and Z Report).
Also adds a `category_id` FK to `menu_items` and backfills it from the existing
text `category` column — the old column is preserved for data safety.

## New Tables

### categories
- `id` (uuid, PK)
- `name` (text, unique, not null) — category display name
- `sort_order` (int, default 0) — display ordering
- `created_at` / `updated_at` (timestamptz)

### inventory_items
- `id` (uuid, PK)
- `name` (text, not null) — ingredient name
- `unit` (text, not null) — e.g. "kg", "L", "pcs", "g"
- `stock_quantity` (numeric(10,2), not null, default 0) — current stock level
- `low_stock_threshold` (numeric(10,2), not null, default 10) — alert threshold
- `created_at` / `updated_at` (timestamptz)

## Modified Tables
- `menu_items`: adds `category_id` (uuid, nullable, FK → categories ON DELETE SET NULL).
  Backfilled from existing text `category` values. The original `category` text
  column is kept (data safety — never drop columns).

## New Functions
- `get_daily_report(p_target_date date)` — SECURITY DEFINER function returning a
  JSONB object with: total_orders, total_revenue, served_orders, avg_order_value,
  best_selling_items (top 10 by quantity), and orders_by_status counts. Used by
  the Analytics Dashboard and Z Report page.

## Security (RLS)
- `categories` and `inventory_items`: authenticated-only CRUD (internal shared
  operational data, same pattern as menu_items/tables/orders).

## Realtime
- `categories` and `inventory_items` added to supabase_realtime publication.

## Important Notes
1. The `category` text column on menu_items is preserved. New code reads/writes
   via `category_id`; the text column remains for backward compatibility.
2. Backfill creates category rows from distinct existing text values and links
   each menu item to its matching category via `category_id`.
3. `get_daily_report` counts all orders created on the target date regardless of
   status for "total_orders"; revenue is summed from served orders only.
*/

-- ===== categories table =====
CREATE TABLE IF NOT EXISTS categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "categories_select_authenticated" ON categories;
CREATE POLICY "categories_select_authenticated" ON categories
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "categories_insert_authenticated" ON categories;
CREATE POLICY "categories_insert_authenticated" ON categories
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "categories_update_authenticated" ON categories;
CREATE POLICY "categories_update_authenticated" ON categories
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "categories_delete_authenticated" ON categories;
CREATE POLICY "categories_delete_authenticated" ON categories
  FOR DELETE TO authenticated USING (true);

-- ===== inventory_items table =====
CREATE TABLE IF NOT EXISTS inventory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  unit text NOT NULL DEFAULT 'pcs',
  stock_quantity numeric(10,2) NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
  low_stock_threshold numeric(10,2) NOT NULL DEFAULT 10 CHECK (low_stock_threshold >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inventory_select_authenticated" ON inventory_items;
CREATE POLICY "inventory_select_authenticated" ON inventory_items
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "inventory_insert_authenticated" ON inventory_items;
CREATE POLICY "inventory_insert_authenticated" ON inventory_items
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "inventory_update_authenticated" ON inventory_items;
CREATE POLICY "inventory_update_authenticated" ON inventory_items
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "inventory_delete_authenticated" ON inventory_items;
CREATE POLICY "inventory_delete_authenticated" ON inventory_items
  FOR DELETE TO authenticated USING (true);

-- ===== Add category_id to menu_items =====
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'menu_items' AND column_name = 'category_id'
  ) THEN
    ALTER TABLE menu_items ADD COLUMN category_id uuid REFERENCES categories(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ===== Backfill: create category rows from existing text values =====
INSERT INTO categories (name, sort_order)
SELECT DISTINCT category, 0
FROM menu_items
WHERE category IS NOT NULL
ON CONFLICT (name) DO NOTHING;

-- Link menu items to their category via category_id
UPDATE menu_items m
SET category_id = c.id
FROM categories c
WHERE m.category = c.name AND m.category_id IS NULL;

-- ===== updated_at triggers for new tables =====
DROP TRIGGER IF EXISTS categories_touch_updated_at ON categories;
CREATE TRIGGER categories_touch_updated_at
  BEFORE UPDATE ON categories
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS inventory_items_touch_updated_at ON inventory_items;
CREATE TRIGGER inventory_items_touch_updated_at
  BEFORE UPDATE ON inventory_items
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ===== get_daily_report function =====
-- Returns a JSONB object with daily sales analytics for a given date.
CREATE OR REPLACE FUNCTION public.get_daily_report(p_target_date date DEFAULT CURRENT_DATE)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'target_date', p_target_date,
    'total_orders', COUNT(o.id),
    'served_orders', COUNT(o.id) FILTER (WHERE o.status = 'served'),
    'total_revenue', COALESCE(SUM(o.total) FILTER (WHERE o.status = 'served'), 0),
    'avg_order_value', COALESCE(
      AVG(o.total) FILTER (WHERE o.status = 'served'), 0
    ),
    'orders_new', COUNT(o.id) FILTER (WHERE o.status = 'new'),
    'orders_preparing', COUNT(o.id) FILTER (WHERE o.status = 'preparing'),
    'orders_ready', COUNT(o.id) FILTER (WHERE o.status = 'ready'),
    'orders_served', COUNT(o.id) FILTER (WHERE o.status = 'served'),
    'best_selling_items', COALESCE(
      (SELECT jsonb_agg(
        jsonb_build_object(
          'name', item_name,
          'quantity', total_qty,
          'revenue', total_rev
        )
        ORDER BY total_qty DESC
      )
      FROM (
        SELECT oi.name AS item_name,
               SUM(oi.quantity) AS total_qty,
               SUM(oi.quantity * oi.price) AS total_rev
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
        WHERE o.created_at::date = p_target_date
        GROUP BY oi.name
        ORDER BY total_qty DESC
        LIMIT 10
      ) bs),
      '[]'::jsonb
    )
  )
  INTO result
  FROM orders o
  WHERE o.created_at::date = p_target_date;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_daily_report(date) TO authenticated;

-- ===== Realtime publication for new tables =====
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'categories'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE categories;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'inventory_items'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE inventory_items;
  END IF;
END $$;

-- ===== Indexes =====
CREATE INDEX IF NOT EXISTS idx_menu_items_category_id ON menu_items(category_id);
CREATE INDEX IF NOT EXISTS idx_inventory_low_stock ON inventory_items(stock_quantity, low_stock_threshold);
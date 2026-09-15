/*
# Create restaurant operations schema: menu, tables, orders

## Summary
Adds the core restaurant operations tables for the Marcillas Hotel POS system:
menu items, dining tables, orders, and order line items. Includes an atomic
`create_order` helper function, order numbering sequence, and Supabase Realtime
publication enrollment for live kitchen/cashier updates.

## New Tables

### menu_items
- `id` (uuid, PK)
- `name` (text, not null) — dish name
- `description` (text) — short description shown on POS cards
- `price` (numeric(10,2), not null) — price in currency
- `category` (text, not null) — e.g. "Starters", "Mains", "Desserts", "Drinks"
- `available` (bool, default true) — kitchen can toggle off when 86'd
- `sort_order` (int, default 0) — display ordering within category
- `created_at` / `updated_at` (timestamptz)

### tables
- `id` (uuid, PK)
- `number` (int, unique, not null) — table number shown to staff
- `capacity` (int, not null, default 2) — seating capacity
- `status` (text, not null, default 'available') — one of:
    'available', 'occupied', 'reserved', 'cleaning'
- `created_at` / `updated_at` (timestamptz)

### orders
- `id` (uuid, PK)
- `order_number` (int, unique, not null) — human-friendly sequential number
- `table_id` (uuid, nullable, FK → tables) — optional table assignment
- `status` (text, not null, default 'new') — one of:
    'new', 'preparing', 'ready', 'served'
- `notes` (text, nullable) — whole-order notes from cashier
- `total` (numeric(10,2), not null, default 0) — calculated order total
- `item_count` (int, not null, default 0) — total quantity of items
- `created_by` (uuid, FK → auth.users) — which cashier created it
- `created_at` / `updated_at` (timestamptz)

### order_items
- `id` (uuid, PK)
- `order_id` (uuid, FK → orders ON DELETE CASCADE)
- `menu_item_id` (uuid, nullable, FK → menu_items) — nullable so deleting a
    menu item doesn't lose historical order data
- `name` (text, not null) — snapshot of item name at order time
- `price` (numeric(10,2), not null) — snapshot of unit price at order time
- `quantity` (int, not null, default 1)
- `notes` (text, nullable) — per-item prep notes / modifications
- `created_at` (timestamptz)

## Sequences & Functions
- `order_number_seq` — sequence for human-friendly order numbers (starts at 1001)
- `create_order(p_table_id, p_notes, p_items jsonb)` — SECURITY DEFINER function
  that atomically creates an order + all its line items, computes total &
  item_count, assigns the next order_number, and returns the new order row.
- `touch_updated_at()` trigger — already exists; wired to new tables.

## Security (RLS)
All tables are internal shared operational data — every authenticated staff
member (admin, cashier, kitchen) can read and write. Policies scoped
`TO authenticated` with USING(true)/WITH CHECK(true) because this is
intentionally shared data across all staff roles in a private internal system.
Unauthenticated access is denied (the app requires sign-in).

## Realtime
Tables `orders`, `order_items`, and `tables` added to the
`supabase_realtime` publication for live INSERT/UPDATE/DELETE events.
*/

-- ===== order number sequence (must exist before orders table) =====
CREATE SEQUENCE IF NOT EXISTS order_number_seq START 1001;

-- ===== menu_items =====
CREATE TABLE IF NOT EXISTS menu_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  price numeric(10,2) NOT NULL CHECK (price >= 0),
  category text NOT NULL,
  available boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE menu_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "menu_select_authenticated" ON menu_items;
CREATE POLICY "menu_select_authenticated" ON menu_items
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "menu_insert_authenticated" ON menu_items;
CREATE POLICY "menu_insert_authenticated" ON menu_items
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "menu_update_authenticated" ON menu_items;
CREATE POLICY "menu_update_authenticated" ON menu_items
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "menu_delete_authenticated" ON menu_items;
CREATE POLICY "menu_delete_authenticated" ON menu_items
  FOR DELETE TO authenticated USING (true);

-- ===== tables =====
CREATE TABLE IF NOT EXISTS tables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number int UNIQUE NOT NULL,
  capacity int NOT NULL DEFAULT 2 CHECK (capacity > 0),
  status text NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'occupied', 'reserved', 'cleaning')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE tables ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tables_select_authenticated" ON tables;
CREATE POLICY "tables_select_authenticated" ON tables
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "tables_insert_authenticated" ON tables;
CREATE POLICY "tables_insert_authenticated" ON tables
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "tables_update_authenticated" ON tables;
CREATE POLICY "tables_update_authenticated" ON tables
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "tables_delete_authenticated" ON tables;
CREATE POLICY "tables_delete_authenticated" ON tables
  FOR DELETE TO authenticated USING (true);

-- ===== orders =====
CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number int UNIQUE NOT NULL DEFAULT nextval('order_number_seq'),
  table_id uuid REFERENCES tables(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'preparing', 'ready', 'served')),
  notes text,
  total numeric(10,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  item_count int NOT NULL DEFAULT 0 CHECK (item_count >= 0),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "orders_select_authenticated" ON orders;
CREATE POLICY "orders_select_authenticated" ON orders
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "orders_insert_authenticated" ON orders;
CREATE POLICY "orders_insert_authenticated" ON orders
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "orders_update_authenticated" ON orders;
CREATE POLICY "orders_update_authenticated" ON orders
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "orders_delete_authenticated" ON orders;
CREATE POLICY "orders_delete_authenticated" ON orders
  FOR DELETE TO authenticated USING (true);

-- ===== order_items =====
CREATE TABLE IF NOT EXISTS order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  menu_item_id uuid REFERENCES menu_items(id) ON DELETE SET NULL,
  name text NOT NULL,
  price numeric(10,2) NOT NULL CHECK (price >= 0),
  quantity int NOT NULL DEFAULT 1 CHECK (quantity > 0),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "order_items_select_authenticated" ON order_items;
CREATE POLICY "order_items_select_authenticated" ON order_items
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "order_items_insert_authenticated" ON order_items;
CREATE POLICY "order_items_insert_authenticated" ON order_items
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "order_items_update_authenticated" ON order_items;
CREATE POLICY "order_items_update_authenticated" ON order_items
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "order_items_delete_authenticated" ON order_items;
CREATE POLICY "order_items_delete_authenticated" ON order_items
  FOR DELETE TO authenticated USING (true);

-- ===== updated_at triggers for new tables =====
DROP TRIGGER IF EXISTS menu_items_touch_updated_at ON menu_items;
CREATE TRIGGER menu_items_touch_updated_at
  BEFORE UPDATE ON menu_items
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS tables_touch_updated_at ON tables;
CREATE TRIGGER tables_touch_updated_at
  BEFORE UPDATE ON tables
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS orders_touch_updated_at ON orders;
CREATE TRIGGER orders_touch_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ===== create_order atomic function =====
-- Accepts table_id, notes, and a JSONB array of items:
--   [{"menu_item_id": "...", "name": "...", "price": 12.50, "quantity": 2, "notes": "..."}, ...]
-- Creates the order + all items in one transaction, computes total & item_count,
-- and returns the new order row.
CREATE OR REPLACE FUNCTION public.create_order(
  p_table_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_items jsonb DEFAULT '[]'::jsonb
)
RETURNS orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_order orders;
  item_count_total int;
  total_amount numeric(10,2);
  item jsonb;
  mi_id uuid;
  item_name text;
  item_price numeric(10,2);
  item_qty int;
  item_notes text;
BEGIN
  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Cannot create an order with no items';
  END IF;

  INSERT INTO orders (table_id, notes, status, total, item_count, created_by)
  VALUES (p_table_id, p_notes, 'new', 0, 0, auth.uid())
  RETURNING * INTO new_order;

  item_count_total := 0;
  total_amount := 0;

  FOR item IN SELECT jsonb_array_elements(p_items) LOOP
    mi_id := NULLIF(item->>'menu_item_id', '')::uuid;
    item_name := item->>'name';
    item_price := (item->>'price')::numeric(10,2);
    item_qty := COALESCE((item->>'quantity')::int, 1);
    item_notes := item->>'notes';

    IF item_name IS NULL OR item_price IS NULL OR item_qty IS NULL OR item_qty < 1 THEN
      RAISE EXCEPTION 'Invalid item in order: %', item;
    END IF;

    INSERT INTO order_items (order_id, menu_item_id, name, price, quantity, notes)
    VALUES (new_order.id, mi_id, item_name, item_price, item_qty, item_notes);

    item_count_total := item_count_total + item_qty;
    total_amount := total_amount + (item_price * item_qty);
  END LOOP;

  UPDATE orders
    SET total = total_amount, item_count = item_count_total
    WHERE id = new_order.id;

  SELECT * INTO new_order FROM orders WHERE id = new_order.id;
  RETURN new_order;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_order(uuid, text, jsonb) TO authenticated;

-- ===== Realtime publication =====
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'orders'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE orders;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'order_items'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE order_items;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'tables'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE tables;
  END IF;
END $$;

-- ===== Indexes for common queries =====
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_menu_items_category ON menu_items(category);
CREATE INDEX IF NOT EXISTS idx_tables_status ON tables(status);
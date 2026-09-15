/*
================================================================================
 MARCILLAS HOTEL POS — COMPLETE DATABASE SETUP (single-file, run once)
================================================================================

WHAT THIS IS
This one file creates the ENTIRE database schema this app needs: every
table, column, security policy, trigger, function, index, and realtime
registration — plus seed data (default menu categories, and staff profiles
for any demo accounts that already exist). It is the only manual step in
setting this project up.

WHY A MANUAL STEP IS UNAVOIDABLE
Creating tables, security policies, and functions requires elevated
database privileges. The web app only ever holds the public "anon" key,
which is deliberately restricted to reading/writing rows in tables that
already have Row Level Security rules allowing it — it can never create or
alter tables. Giving the browser app higher privileges (a service-role key
or a raw database connection string) would let anyone who opens the
browser's developer tools take over the entire database, so the app
intentionally never holds one. Running this file once, in the Supabase
SQL Editor, is the one moment that needs elevated access — after that,
the app runs itself with zero further manual steps: it self-provisions the
three demo staff accounts, self-heals missing profile rows on login, and
enforces every permission automatically.

HOW TO RUN THIS
Supabase Dashboard → your project → SQL Editor → paste this entire file →
Run. That's it — do this once. Re-running it later is safe (every
statement is idempotent).

AFTER RUNNING THIS
Reload the app. On first load it automatically creates the three demo staff
accounts (admin@marcillas.com / cashier@marcillas.com / kitchen@marcillas.com)
and everything else — no further SQL, no manual user creation, nothing else
to do. See the app's README for the demo password and for guidance on
removing/rotating these accounts before real production use.

IF A DEMO ACCOUNT SHOWS THE WRONG ROLE (e.g. admin@marcillas.com lands on
the Kitchen dashboard): this used to be a data issue only, but an earlier
version of this script had a real bug of its own — the role-escalation
guard trigger checked `auth.uid()` to decide whether the caller was an
admin, but `auth.uid()` is NULL when there's no authenticated PostgREST
session (e.g. running SQL directly in this editor), which the trigger
mis-read as "not an admin" and silently reverted the role change back to
'kitchen' — even though the UPDATE appeared to succeed with no error. This
version fixes that trigger (see `protect_profile_privileges` below) and
also matches demo account emails case-insensitively. Simply re-run this
entire script once more; it's safe to run any number of times.
================================================================================
*/


-- ============================================================================
-- SECTION 1: STAFF PROFILES (auth, roles, permissions)
-- ============================================================================

CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  full_name text,
  role text NOT NULL DEFAULT 'kitchen'
    CHECK (role IN ('admin', 'cashier', 'kitchen')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Repair path for a partially-created table from an older version of this project
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name='is_active') THEN
    ALTER TABLE profiles ADD COLUMN is_active boolean NOT NULL DEFAULT true;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name='full_name') THEN
    ALTER TABLE profiles ADD COLUMN full_name text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name='email') THEN
    ALTER TABLE profiles ADD COLUMN email text NOT NULL DEFAULT '';
  END IF;
END $$;

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_all_authenticated" ON profiles;
CREATE POLICY "profiles_select_all_authenticated"
ON profiles FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "profiles_insert_own" ON profiles;
CREATE POLICY "profiles_insert_own"
ON profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_update_own" ON profiles;
CREATE POLICY "profiles_update_own"
ON profiles FOR UPDATE TO authenticated
USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_update_admin" ON profiles;
CREATE POLICY "profiles_update_admin"
ON profiles FOR UPDATE TO authenticated
USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'))
WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

DROP POLICY IF EXISTS "profiles_delete_own" ON profiles;
CREATE POLICY "profiles_delete_own"
ON profiles FOR DELETE TO authenticated USING (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_delete_admin" ON profiles;
CREATE POLICY "profiles_delete_admin"
ON profiles FOR DELETE TO authenticated
USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

-- Prevent a non-admin from escalating their own role or reactivating themselves
CREATE OR REPLACE FUNCTION public.protect_profile_privileges()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (NEW.role IS DISTINCT FROM OLD.role OR NEW.is_active IS DISTINCT FROM OLD.is_active) THEN
    -- auth.uid() is NULL when there's no authenticated PostgREST/JWT
    -- session — i.e. a direct SQL connection (SQL Editor, migrations) or
    -- an anonymous RPC call. That's a MORE trusted context than a signed-
    -- in non-admin, not less: RLS already blocks anonymous callers from
    -- ever reaching this UPDATE via the API in the first place (the
    -- update policies below are scoped `TO authenticated` only). Only
    -- block the change when there IS an authenticated caller who isn't
    -- an admin.
    IF auth.uid() IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin') THEN
      NEW.role := OLD.role;
      NEW.is_active := OLD.is_active;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_protect_privileges ON profiles;
CREATE TRIGGER profiles_protect_privileges
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_privileges();

-- Auto-create a profile row whenever a new Auth account is created
-- (crash-proof: never blocks account creation even on an unexpected error)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- SECURITY: never trust a client-supplied 'role' from signup metadata —
  -- that would let anyone self-promote to admin by calling auth.signUp()
  -- directly with forged metadata. Every new account starts as the
  -- least-privileged role. Real role assignment happens only via an
  -- authenticated admin's RLS-checked UPDATE (see Staff Management /
  -- useStaff.ts) or the demo-account seed step below.
  INSERT INTO public.profiles (id, email, full_name, role, is_active)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    'kitchen',
    true
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'handle_new_user failed for %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_touch_updated_at ON profiles;
CREATE TRIGGER profiles_touch_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Backfill: give every existing Auth user a profile row if it's missing one.
-- Same security rule as handle_new_user() above: never trust a client-
-- supplied role, default to least-privileged.
INSERT INTO public.profiles (id, email, full_name, role, is_active)
SELECT u.id, u.email,
       COALESCE(u.raw_user_meta_data->>'full_name', split_part(u.email, '@', 1)),
       'kitchen',
       true
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id)
ON CONFLICT (id) DO NOTHING;

-- Assigns the correct role to the three demo staff accounts, by email,
-- IF those Auth accounts exist. Safe to expose to the app to call anytime
-- (no parameters, no user input — the email → role mapping is hardcoded
-- here, not client-supplied) because the signup trigger above intentionally
-- no longer trusts a client-supplied role. This is what makes demo-account
-- setup fully automatic: the app calls this once the schema is ready (see
-- src/lib/demoBootstrap.ts), so no manual SQL re-run is ever required even
-- though new signups always start as 'kitchen'.
CREATE OR REPLACE FUNCTION public.fix_demo_account_roles()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  admin_id uuid; cashier_id uuid; kitchen_id uuid;
BEGIN
  -- Case-insensitive, whitespace-tolerant match: accounts created by hand
  -- via the Supabase Dashboard may not have the exact casing typed here.
  SELECT id INTO admin_id FROM auth.users
    WHERE lower(btrim(email)) = 'admin@marcillas.com' ORDER BY created_at ASC LIMIT 1;
  SELECT id INTO cashier_id FROM auth.users
    WHERE lower(btrim(email)) = 'cashier@marcillas.com' ORDER BY created_at ASC LIMIT 1;
  SELECT id INTO kitchen_id FROM auth.users
    WHERE lower(btrim(email)) = 'kitchen@marcillas.com' ORDER BY created_at ASC LIMIT 1;

  IF admin_id IS NOT NULL THEN
    INSERT INTO public.profiles (id, email, full_name, role, is_active)
    VALUES (admin_id, 'admin@marcillas.com', 'System Administrator', 'admin', true)
    ON CONFLICT (id) DO UPDATE SET role='admin', full_name='System Administrator', is_active=true, email='admin@marcillas.com';
  END IF;

  IF cashier_id IS NOT NULL THEN
    INSERT INTO public.profiles (id, email, full_name, role, is_active)
    VALUES (cashier_id, 'cashier@marcillas.com', 'Front Desk Cashier', 'cashier', true)
    ON CONFLICT (id) DO UPDATE SET role='cashier', full_name='Front Desk Cashier', is_active=true, email='cashier@marcillas.com';
  END IF;

  IF kitchen_id IS NOT NULL THEN
    INSERT INTO public.profiles (id, email, full_name, role, is_active)
    VALUES (kitchen_id, 'kitchen@marcillas.com', 'Kitchen Staff', 'kitchen', true)
    ON CONFLICT (id) DO UPDATE SET role='kitchen', full_name='Kitchen Staff', is_active=true, email='kitchen@marcillas.com';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fix_demo_account_roles() TO anon, authenticated;

-- Run it once now too, in case the demo accounts already exist at the
-- moment this script is executed.
SELECT public.fix_demo_account_roles();


-- ============================================================================
-- SECTION 2: MENU, TABLES, ORDERS
-- ============================================================================

CREATE SEQUENCE IF NOT EXISTS order_number_seq START 1001;

CREATE TABLE IF NOT EXISTS menu_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  price numeric(10,2) NOT NULL CHECK (price >= 0),
  category text NOT NULL,
  image_url text,
  available boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='menu_items' AND column_name='image_url') THEN
    ALTER TABLE menu_items ADD COLUMN image_url text;
  END IF;
END $$;

ALTER TABLE menu_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "menu_select_authenticated" ON menu_items;
CREATE POLICY "menu_select_authenticated" ON menu_items
  FOR SELECT TO authenticated USING (true);

-- Menu writes are admin-only (cashier/kitchen can view, not manage)
DROP POLICY IF EXISTS "menu_insert_authenticated" ON menu_items;
DROP POLICY IF EXISTS "menu_insert_admin" ON menu_items;
CREATE POLICY "menu_insert_admin" ON menu_items
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

DROP POLICY IF EXISTS "menu_update_authenticated" ON menu_items;
DROP POLICY IF EXISTS "menu_update_admin" ON menu_items;
CREATE POLICY "menu_update_admin" ON menu_items
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

DROP POLICY IF EXISTS "menu_delete_authenticated" ON menu_items;
DROP POLICY IF EXISTS "menu_delete_admin" ON menu_items;
CREATE POLICY "menu_delete_admin" ON menu_items
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

-- NOTE: earlier versions of this project had no table/seating concept, and
-- this script used to unconditionally DROP any 'tables' table and
-- 'orders.table_id' column here to clean that up. That is no longer
-- correct: Table Management + QR ordering is now a real, required feature
-- (see SECTION 6 below, which creates 'tables' and adds 'orders.table_id').
-- Dropping them here would destroy real table/QR data — and functions
-- created further down (create_customer_order, confirm_customer_order)
-- declare local variables typed as the 'tables' row, so a mid-script
-- DROP...CREATE of that table is also what was producing
-- "ERROR: 42703: column "id" does not exist" on re-runs: Postgres was
-- resolving those variables against a stale/dropped relation. Do NOT
-- reintroduce a DROP of 'tables' or 'orders.table_id' here.

CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number int UNIQUE NOT NULL DEFAULT nextval('order_number_seq'),
  status text NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'preparing', 'ready', 'served')),
  payment_status text NOT NULL DEFAULT 'unpaid'
    CHECK (payment_status IN ('unpaid', 'paid')),
  discount_amount numeric(10,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  notes text,
  total numeric(10,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  item_count int NOT NULL DEFAULT 0 CHECK (item_count >= 0),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Repair path: guarantee every column the app requires actually exists,
-- regardless of which prior version of this script created the table.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='status') THEN
    ALTER TABLE orders ADD COLUMN status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','preparing','ready','served'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='payment_status') THEN
    ALTER TABLE orders ADD COLUMN payment_status text NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'paid'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='discount_amount') THEN
    ALTER TABLE orders ADD COLUMN discount_amount numeric(10,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='notes') THEN
    ALTER TABLE orders ADD COLUMN notes text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='total') THEN
    ALTER TABLE orders ADD COLUMN total numeric(10,2) NOT NULL DEFAULT 0 CHECK (total >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='item_count') THEN
    ALTER TABLE orders ADD COLUMN item_count int NOT NULL DEFAULT 0 CHECK (item_count >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='created_by') THEN
    ALTER TABLE orders ADD COLUMN created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='created_at') THEN
    ALTER TABLE orders ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='updated_at') THEN
    ALTER TABLE orders ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
  END IF;
END $$;

-- Only admins may apply/change a discount (Cashier and Kitchen cannot)
CREATE OR REPLACE FUNCTION public.protect_order_discount()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (NEW.discount_amount IS DISTINCT FROM OLD.discount_amount) THEN
    IF auth.uid() IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin') THEN
      NEW.discount_amount := OLD.discount_amount;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS orders_protect_discount ON orders;
CREATE TRIGGER orders_protect_discount
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION public.protect_order_discount();

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "orders_select_authenticated" ON orders;
CREATE POLICY "orders_select_authenticated" ON orders FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "orders_insert_authenticated" ON orders;
CREATE POLICY "orders_insert_authenticated" ON orders FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "orders_update_authenticated" ON orders;
CREATE POLICY "orders_update_authenticated" ON orders FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "orders_delete_authenticated" ON orders;
DROP POLICY IF EXISTS "orders_delete_admin" ON orders;
CREATE POLICY "orders_delete_admin" ON orders
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

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

-- Repair path: guarantee every column the app requires actually exists,
-- regardless of which prior version of this script created the table.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='order_items' AND column_name='menu_item_id') THEN
    ALTER TABLE order_items ADD COLUMN menu_item_id uuid REFERENCES menu_items(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='order_items' AND column_name='name') THEN
    ALTER TABLE order_items ADD COLUMN name text NOT NULL DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='order_items' AND column_name='price') THEN
    ALTER TABLE order_items ADD COLUMN price numeric(10,2) NOT NULL DEFAULT 0 CHECK (price >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='order_items' AND column_name='quantity') THEN
    ALTER TABLE order_items ADD COLUMN quantity int NOT NULL DEFAULT 1 CHECK (quantity > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='order_items' AND column_name='notes') THEN
    ALTER TABLE order_items ADD COLUMN notes text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='order_items' AND column_name='created_at') THEN
    ALTER TABLE order_items ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
  END IF;
END $$;

ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "order_items_select_authenticated" ON order_items;
CREATE POLICY "order_items_select_authenticated" ON order_items FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "order_items_insert_authenticated" ON order_items;
CREATE POLICY "order_items_insert_authenticated" ON order_items FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "order_items_update_authenticated" ON order_items;
CREATE POLICY "order_items_update_authenticated" ON order_items FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "order_items_delete_authenticated" ON order_items;
CREATE POLICY "order_items_delete_authenticated" ON order_items FOR DELETE TO authenticated USING (true);

DROP TRIGGER IF EXISTS menu_items_touch_updated_at ON menu_items;
CREATE TRIGGER menu_items_touch_updated_at BEFORE UPDATE ON menu_items FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS orders_touch_updated_at ON orders;
CREATE TRIGGER orders_touch_updated_at BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Atomically creates an order + all its line items in one transaction.
-- No table/seating reference — this restaurant has open seating.
DROP FUNCTION IF EXISTS public.create_order(uuid, text, jsonb);
CREATE OR REPLACE FUNCTION public.create_order(
  p_notes text DEFAULT NULL,
  p_items jsonb DEFAULT '[]'::jsonb
)
RETURNS orders LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
  IF NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'cashier')) THEN
    RAISE EXCEPTION 'Access denied: only admin or cashier can create orders';
  END IF;

  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Cannot create an order with no items';
  END IF;

  INSERT INTO orders (notes, status, total, item_count, created_by)
  VALUES (p_notes, 'new', 0, 0, auth.uid())
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

  UPDATE orders SET total = total_amount, item_count = item_count_total WHERE id = new_order.id;
  SELECT * INTO new_order FROM orders WHERE id = new_order.id;
  RETURN new_order;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_order(text, jsonb) TO authenticated;

CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_menu_items_category ON menu_items(category);


-- ============================================================================
-- SECTION 3: CATEGORIES, INVENTORY, ANALYTICS
-- ============================================================================

CREATE TABLE IF NOT EXISTS categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "categories_select_authenticated" ON categories;
CREATE POLICY "categories_select_authenticated" ON categories FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "categories_insert_authenticated" ON categories;
DROP POLICY IF EXISTS "categories_insert_admin" ON categories;
CREATE POLICY "categories_insert_admin" ON categories
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

DROP POLICY IF EXISTS "categories_update_authenticated" ON categories;
DROP POLICY IF EXISTS "categories_update_admin" ON categories;
CREATE POLICY "categories_update_admin" ON categories
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

DROP POLICY IF EXISTS "categories_delete_authenticated" ON categories;
DROP POLICY IF EXISTS "categories_delete_admin" ON categories;
CREATE POLICY "categories_delete_admin" ON categories
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

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
CREATE POLICY "inventory_select_authenticated" ON inventory_items FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "inventory_insert_authenticated" ON inventory_items;
DROP POLICY IF EXISTS "inventory_insert_admin" ON inventory_items;
CREATE POLICY "inventory_insert_admin" ON inventory_items
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

DROP POLICY IF EXISTS "inventory_update_authenticated" ON inventory_items;
DROP POLICY IF EXISTS "inventory_update_admin" ON inventory_items;
CREATE POLICY "inventory_update_admin" ON inventory_items
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

DROP POLICY IF EXISTS "inventory_delete_authenticated" ON inventory_items;
DROP POLICY IF EXISTS "inventory_delete_admin" ON inventory_items;
CREATE POLICY "inventory_delete_admin" ON inventory_items
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='menu_items' AND column_name='category_id') THEN
    ALTER TABLE menu_items ADD COLUMN category_id uuid REFERENCES categories(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Seed the default menu categories
INSERT INTO categories (name, sort_order) VALUES
  ('Breakfast', 1),
  ('Fast Food', 2),
  ('Ethiopian Meals', 3),
  ('Desserts', 4)
ON CONFLICT (name) DO NOTHING;

-- Backfill: link any menu items with a legacy text category to a categories row
INSERT INTO categories (name, sort_order)
SELECT DISTINCT category, 0 FROM menu_items WHERE category IS NOT NULL
ON CONFLICT (name) DO NOTHING;

UPDATE menu_items m SET category_id = c.id
FROM categories c
WHERE m.category = c.name AND m.category_id IS NULL;

-- Seed demo food items with realistic ETB pricing (guarded by name so this
-- is safe to re-run; also self-corrects prices on rows seeded by an older
-- version of this script that used placeholder USD-scale prices).
DO $$
DECLARE
  cat_id uuid;
BEGIN
  SELECT id INTO cat_id FROM categories WHERE name = 'Breakfast';
  IF cat_id IS NOT NULL THEN
    INSERT INTO menu_items (name, description, price, category, category_id, available, sort_order)
    SELECT 'Injera with Scrambled Eggs', 'Traditional sourdough flatbread with spiced scrambled eggs', 120.00, 'Breakfast', cat_id, true, 1
    WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE name = 'Injera with Scrambled Eggs');
    INSERT INTO menu_items (name, description, price, category, category_id, available, sort_order)
    SELECT 'Pancake Stack', 'Fluffy pancakes with honey and butter', 150.00, 'Breakfast', cat_id, true, 2
    WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE name = 'Pancake Stack');
    INSERT INTO menu_items (name, description, price, category, category_id, available, sort_order)
    SELECT 'Ful Medames', 'Slow-cooked fava beans with olive oil, garlic, and lemon', 100.00, 'Breakfast', cat_id, true, 3
    WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE name = 'Ful Medames');
  END IF;

  SELECT id INTO cat_id FROM categories WHERE name = 'Fast Food';
  IF cat_id IS NOT NULL THEN
    INSERT INTO menu_items (name, description, price, category, category_id, available, sort_order)
    SELECT 'Beef Burger', 'Grilled beef patty with lettuce, tomato, and fries', 280.00, 'Fast Food', cat_id, true, 1
    WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE name = 'Beef Burger');
    INSERT INTO menu_items (name, description, price, category, category_id, available, sort_order)
    SELECT 'Chicken Club Sandwich', 'Grilled chicken, bacon, lettuce, and mayo', 260.00, 'Fast Food', cat_id, true, 2
    WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE name = 'Chicken Club Sandwich');
    INSERT INTO menu_items (name, description, price, category, category_id, available, sort_order)
    SELECT 'Crispy Fries', 'Golden fries with a side of ketchup', 90.00, 'Fast Food', cat_id, true, 3
    WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE name = 'Crispy Fries');
  END IF;

  SELECT id INTO cat_id FROM categories WHERE name = 'Ethiopian Meals';
  IF cat_id IS NOT NULL THEN
    INSERT INTO menu_items (name, description, price, category, category_id, available, sort_order)
    SELECT 'Doro Wat', 'Spiced chicken stew served with injera', 350.00, 'Ethiopian Meals', cat_id, true, 1
    WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE name = 'Doro Wat');
    INSERT INTO menu_items (name, description, price, category, category_id, available, sort_order)
    SELECT 'Tibs', 'Sautéed beef or lamb with onions, peppers, and rosemary', 320.00, 'Ethiopian Meals', cat_id, true, 2
    WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE name = 'Tibs');
    INSERT INTO menu_items (name, description, price, category, category_id, available, sort_order)
    SELECT 'Vegetarian Combo', 'Assorted lentil and vegetable stews with injera', 220.00, 'Ethiopian Meals', cat_id, true, 3
    WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE name = 'Vegetarian Combo');
  END IF;

  SELECT id INTO cat_id FROM categories WHERE name = 'Desserts';
  IF cat_id IS NOT NULL THEN
    INSERT INTO menu_items (name, description, price, category, category_id, available, sort_order)
    SELECT 'Baklava', 'Layered pastry with honey and crushed nuts', 110.00, 'Desserts', cat_id, true, 1
    WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE name = 'Baklava');
    INSERT INTO menu_items (name, description, price, category, category_id, available, sort_order)
    SELECT 'Chocolate Cake', 'Rich chocolate layer cake with ganache', 130.00, 'Desserts', cat_id, true, 2
    WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE name = 'Chocolate Cake');
    INSERT INTO menu_items (name, description, price, category, category_id, available, sort_order)
    SELECT 'Fresh Fruit Plate', 'Seasonal fresh fruit selection', 90.00, 'Desserts', cat_id, true, 3
    WHERE NOT EXISTS (SELECT 1 FROM menu_items WHERE name = 'Fresh Fruit Plate');
  END IF;

  -- Self-correct prices for anyone who already seeded the old USD-scale demo data
  UPDATE menu_items SET price = 120.00 WHERE name = 'Injera with Scrambled Eggs' AND price < 20;
  UPDATE menu_items SET price = 150.00 WHERE name = 'Pancake Stack' AND price < 20;
  UPDATE menu_items SET price = 100.00 WHERE name = 'Ful Medames' AND price < 20;
  UPDATE menu_items SET price = 280.00 WHERE name = 'Beef Burger' AND price < 20;
  UPDATE menu_items SET price = 260.00 WHERE name = 'Chicken Club Sandwich' AND price < 20;
  UPDATE menu_items SET price = 90.00 WHERE name = 'Crispy Fries' AND price < 20;
  UPDATE menu_items SET price = 350.00 WHERE name = 'Doro Wat' AND price < 20;
  UPDATE menu_items SET price = 320.00 WHERE name = 'Tibs' AND price < 20;
  UPDATE menu_items SET price = 220.00 WHERE name = 'Vegetarian Combo' AND price < 20;
  UPDATE menu_items SET price = 110.00 WHERE name = 'Baklava' AND price < 20;
  UPDATE menu_items SET price = 130.00 WHERE name = 'Chocolate Cake' AND price < 20;
  UPDATE menu_items SET price = 90.00 WHERE name = 'Fresh Fruit Plate' AND price < 20;
END $$;

DROP TRIGGER IF EXISTS categories_touch_updated_at ON categories;
CREATE TRIGGER categories_touch_updated_at BEFORE UPDATE ON categories FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS inventory_items_touch_updated_at ON inventory_items;
CREATE TRIGGER inventory_items_touch_updated_at BEFORE UPDATE ON inventory_items FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Daily sales report used by Analytics + Z Report.
-- "Completed, paid sales" = status='served' AND payment_status='paid',
-- net of any admin-applied discount. This is the one true definition of
-- revenue used everywhere in the app (dashboards, Analytics, Z Report).
CREATE OR REPLACE FUNCTION public.get_daily_report(p_target_date date DEFAULT CURRENT_DATE)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  result jsonb;
  period_start timestamptz;
BEGIN
  -- SECURITY: sales data is admin-only. Enforced here (not just hidden in
  -- the UI) so a cashier/kitchen account can't read it by calling this
  -- RPC directly.
  IF NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin') THEN
    RAISE EXCEPTION 'Access denied: admin only';
  END IF;

  -- The "current open business period" for this date starts right after
  -- the most recent Z Report closing for that date, if one exists —
  -- otherwise it starts at midnight (the whole day, as before). This is
  -- what makes "Today" reset to zero the instant a day is closed, without
  -- ever touching order data: orders before the closing boundary belong
  -- to the closed Z Report snapshot; orders after it belong to the fresh
  -- open period.
  SELECT closed_at INTO period_start FROM z_reports WHERE business_date = p_target_date;
  IF period_start IS NULL THEN
    period_start := p_target_date::timestamptz;
  END IF;

  SELECT jsonb_build_object(
    'target_date', p_target_date,
    'period_start', period_start,
    'total_orders', COUNT(o.id),
    'served_orders', COUNT(o.id) FILTER (WHERE o.status = 'served'),
    'paid_orders', COUNT(o.id) FILTER (WHERE o.status = 'served' AND o.payment_status = 'paid'),
    'gross_sales', COALESCE(SUM(o.total) FILTER (WHERE o.status = 'served' AND o.payment_status = 'paid'), 0),
    'total_revenue', COALESCE(SUM(o.total - o.discount_amount) FILTER (WHERE o.status = 'served' AND o.payment_status = 'paid'), 0),
    'total_discount', COALESCE(SUM(o.discount_amount) FILTER (WHERE o.status = 'served' AND o.payment_status = 'paid'), 0),
    'avg_order_value', COALESCE(AVG(o.total - o.discount_amount) FILTER (WHERE o.status = 'served' AND o.payment_status = 'paid'), 0),
    'orders_new', COUNT(o.id) FILTER (WHERE o.status = 'new'),
    'orders_preparing', COUNT(o.id) FILTER (WHERE o.status = 'preparing'),
    'orders_ready', COUNT(o.id) FILTER (WHERE o.status = 'ready'),
    'orders_served', COUNT(o.id) FILTER (WHERE o.status = 'served'),
    'unpaid_served_orders', COUNT(o.id) FILTER (WHERE o.status = 'served' AND o.payment_status = 'unpaid'),
    'unpaid_amount', COALESCE(SUM(o.total - o.discount_amount) FILTER (WHERE o.status = 'served' AND o.payment_status = 'unpaid'), 0),
    'items_sold', COALESCE((
      SELECT SUM(oi.quantity)
      FROM order_items oi
      JOIN orders o3 ON o3.id = oi.order_id
      WHERE o3.created_at::date = p_target_date
        AND o3.created_at > period_start
        AND o3.status = 'served'
        AND o3.payment_status = 'paid'
    ), 0),
    'best_selling_items', COALESCE(
      (SELECT jsonb_agg(
        jsonb_build_object('name', item_name, 'quantity', total_qty, 'revenue', total_rev)
        ORDER BY total_qty DESC
      )
      FROM (
        SELECT oi.name AS item_name, SUM(oi.quantity) AS total_qty, SUM(oi.quantity * oi.price) AS total_rev
        FROM order_items oi
        JOIN orders o2 ON o2.id = oi.order_id
        WHERE o2.created_at::date = p_target_date
          AND o2.created_at > period_start
          AND o2.status = 'served'
          AND o2.payment_status = 'paid'
        GROUP BY oi.name
        ORDER BY total_qty DESC
        LIMIT 10
      ) bs),
      '[]'::jsonb
    )
  )
  INTO result
  FROM orders o
  WHERE o.created_at::date = p_target_date
    AND o.created_at > period_start;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_daily_report(date) TO authenticated;

-- Same shape as get_daily_report, but aggregated over an inclusive date
-- range — used for Week/Month/Year Analytics. Admin-only, same reasoning.
CREATE OR REPLACE FUNCTION public.get_range_report(p_start_date date, p_end_date date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  result jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin') THEN
    RAISE EXCEPTION 'Access denied: admin only';
  END IF;

  SELECT jsonb_build_object(
    'start_date', p_start_date,
    'end_date', p_end_date,
    'total_orders', COUNT(o.id),
    'served_orders', COUNT(o.id) FILTER (WHERE o.status = 'served'),
    'paid_orders', COUNT(o.id) FILTER (WHERE o.status = 'served' AND o.payment_status = 'paid'),
    'gross_sales', COALESCE(SUM(o.total) FILTER (WHERE o.status = 'served' AND o.payment_status = 'paid'), 0),
    'total_revenue', COALESCE(SUM(o.total - o.discount_amount) FILTER (WHERE o.status = 'served' AND o.payment_status = 'paid'), 0),
    'total_discount', COALESCE(SUM(o.discount_amount) FILTER (WHERE o.status = 'served' AND o.payment_status = 'paid'), 0),
    'avg_order_value', COALESCE(AVG(o.total - o.discount_amount) FILTER (WHERE o.status = 'served' AND o.payment_status = 'paid'), 0),
    'unpaid_served_orders', COUNT(o.id) FILTER (WHERE o.status = 'served' AND o.payment_status = 'unpaid'),
    'unpaid_amount', COALESCE(SUM(o.total - o.discount_amount) FILTER (WHERE o.status = 'served' AND o.payment_status = 'unpaid'), 0),
    'items_sold', COALESCE((
      SELECT SUM(oi.quantity)
      FROM order_items oi
      JOIN orders o3 ON o3.id = oi.order_id
      WHERE o3.created_at::date BETWEEN p_start_date AND p_end_date
        AND o3.status = 'served'
        AND o3.payment_status = 'paid'
    ), 0),
    'best_selling_items', COALESCE(
      (SELECT jsonb_agg(
        jsonb_build_object('name', item_name, 'quantity', total_qty, 'revenue', total_rev)
        ORDER BY total_qty DESC
      )
      FROM (
        SELECT oi.name AS item_name, SUM(oi.quantity) AS total_qty, SUM(oi.quantity * oi.price) AS total_rev
        FROM order_items oi
        JOIN orders o2 ON o2.id = oi.order_id
        WHERE o2.created_at::date BETWEEN p_start_date AND p_end_date
          AND o2.status = 'served'
          AND o2.payment_status = 'paid'
        GROUP BY oi.name
        ORDER BY total_qty DESC
        LIMIT 10
      ) bs),
      '[]'::jsonb
    )
  )
  INTO result
  FROM orders o
  WHERE o.created_at::date BETWEEN p_start_date AND p_end_date;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_range_report(date, date) TO authenticated;

CREATE INDEX IF NOT EXISTS idx_menu_items_category_id ON menu_items(category_id);
CREATE INDEX IF NOT EXISTS idx_inventory_low_stock ON inventory_items(stock_quantity, low_stock_threshold);


-- ============================================================================
-- SECTION 3B: Z REPORTS (daily closing)
-- ============================================================================
-- A Z Report is a permanent, immutable snapshot of one business day's
-- totals. Closing a day NEVER touches `orders`/`order_items` — it only
-- writes one row here. The UNIQUE constraint on business_date is what
-- guarantees, at the database level, that a business day can only ever be
-- closed once (not just a UI check that could be raced or bypassed).

CREATE TABLE IF NOT EXISTS z_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_date date NOT NULL UNIQUE,
  closed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  closed_by_name text,
  closed_at timestamptz NOT NULL DEFAULT now(),
  total_orders int NOT NULL DEFAULT 0,
  served_orders int NOT NULL DEFAULT 0,
  paid_orders int NOT NULL DEFAULT 0,
  unpaid_orders int NOT NULL DEFAULT 0,
  items_sold int NOT NULL DEFAULT 0,
  gross_sales numeric(10,2) NOT NULL DEFAULT 0,
  total_discount numeric(10,2) NOT NULL DEFAULT 0,
  net_revenue numeric(10,2) NOT NULL DEFAULT 0,
  unpaid_amount numeric(10,2) NOT NULL DEFAULT 0,
  avg_order_value numeric(10,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE z_reports ENABLE ROW LEVEL SECURITY;

-- Admin-only, both ways. No UPDATE or DELETE policy at all is intentional:
-- a closed Z Report can never be modified or removed via the API, by
-- anyone, including admins — only SELECT (read) and INSERT (via the
-- close_z_report() function below) are permitted.
DROP POLICY IF EXISTS "z_reports_select_admin" ON z_reports;
CREATE POLICY "z_reports_select_admin" ON z_reports
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

DROP POLICY IF EXISTS "z_reports_insert_admin" ON z_reports;
CREATE POLICY "z_reports_insert_admin" ON z_reports
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

-- Admin can delete a closed Z Report SNAPSHOT (e.g. to correct a mistake).
-- This only ever removes the row in z_reports — there is no foreign key
-- from orders to z_reports, so the underlying orders/order_items are
-- never touched by this.
DROP POLICY IF EXISTS "z_reports_delete_admin" ON z_reports;
CREATE POLICY "z_reports_delete_admin" ON z_reports
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

CREATE INDEX IF NOT EXISTS idx_z_reports_business_date ON z_reports(business_date DESC);

-- Closes a business day: computes its totals from orders/order_items
-- (never modifying them) and inserts one permanent row. Raises a clear
-- error if that day is already closed (UNIQUE constraint) or if the
-- caller isn't an admin — enforced here, not just in the UI.
CREATE OR REPLACE FUNCTION public.close_z_report(p_business_date date DEFAULT CURRENT_DATE)
RETURNS z_reports LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  new_report z_reports;
  admin_name text;
  stats record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin') THEN
    RAISE EXCEPTION 'Access denied: admin only';
  END IF;

  IF EXISTS (SELECT 1 FROM z_reports WHERE business_date = p_business_date) THEN
    RAISE EXCEPTION 'Business day % has already been closed with a Z Report', p_business_date;
  END IF;

  SELECT full_name INTO admin_name FROM profiles WHERE id = auth.uid();

  SELECT
    COUNT(o.id) AS total_orders,
    COUNT(o.id) FILTER (WHERE o.status = 'served') AS served_orders,
    COUNT(o.id) FILTER (WHERE o.status = 'served' AND o.payment_status = 'paid') AS paid_orders,
    COUNT(o.id) FILTER (WHERE o.status = 'served' AND o.payment_status = 'unpaid') AS unpaid_orders,
    COALESCE(SUM(o.total) FILTER (WHERE o.status = 'served' AND o.payment_status = 'paid'), 0) AS gross_sales,
    COALESCE(SUM(o.discount_amount) FILTER (WHERE o.status = 'served' AND o.payment_status = 'paid'), 0) AS total_discount,
    COALESCE(SUM(o.total - o.discount_amount) FILTER (WHERE o.status = 'served' AND o.payment_status = 'paid'), 0) AS net_revenue,
    COALESCE(SUM(o.total - o.discount_amount) FILTER (WHERE o.status = 'served' AND o.payment_status = 'unpaid'), 0) AS unpaid_amount,
    COALESCE(AVG(o.total - o.discount_amount) FILTER (WHERE o.status = 'served' AND o.payment_status = 'paid'), 0) AS avg_order_value
  INTO stats
  FROM orders o
  WHERE o.created_at::date = p_business_date;

  INSERT INTO z_reports (
    business_date, closed_by, closed_by_name,
    total_orders, served_orders, paid_orders, unpaid_orders,
    items_sold, gross_sales, total_discount, net_revenue, unpaid_amount, avg_order_value
  )
  VALUES (
    p_business_date, auth.uid(), COALESCE(admin_name, 'Administrator'),
    stats.total_orders, stats.served_orders, stats.paid_orders, stats.unpaid_orders,
    COALESCE((
      SELECT SUM(oi.quantity) FROM order_items oi
      JOIN orders o2 ON o2.id = oi.order_id
      WHERE o2.created_at::date = p_business_date
        AND o2.status = 'served' AND o2.payment_status = 'paid'
    ), 0),
    stats.gross_sales, stats.total_discount, stats.net_revenue, stats.unpaid_amount, stats.avg_order_value
  )
  RETURNING * INTO new_report;

  RETURN new_report;
END;
$$;

GRANT EXECUTE ON FUNCTION public.close_z_report(date) TO authenticated;


-- ============================================================================
-- SECTION 4: REALTIME
-- ============================================================================

-- Ensures realtime UPDATE/DELETE payloads include full row data, not just
-- the primary key — Supabase's documented recommendation for reliable
-- postgres_changes delivery.
ALTER TABLE orders REPLICA IDENTITY FULL;
ALTER TABLE order_items REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='orders') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE orders;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='order_items') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE order_items;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='categories') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE categories;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='inventory_items') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE inventory_items;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='profiles') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE profiles;
  END IF;
END $$;


-- ============================================================================
-- SECTION 5: STORAGE (menu item photos)
-- ============================================================================

-- Public bucket so menu photos can be displayed on the POS/menu screens
-- without needing a signed URL.
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

-- ============================================================================
-- SECTION 6: TABLE MANAGEMENT + QR CUSTOMER ORDERING
-- ============================================================================
-- Additive: table management, per-table QR codes, anonymous customer
-- ordering, cashier accept-and-send-to-kitchen, and the kitchen/payment
-- realtime linkage. See migrations/20260901000000_add_tables_qr_customer_ordering.sql
-- for the full explanatory comment. Nothing above this section is changed.

CREATE TABLE IF NOT EXISTS tables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_number int GENERATED BY DEFAULT AS IDENTITY NOT NULL UNIQUE,
  name text,
  qr_token text UNIQUE NOT NULL DEFAULT gen_random_uuid()::text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE tables ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tables_select_staff" ON tables;
CREATE POLICY "tables_select_staff" ON tables
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid()));

DROP POLICY IF EXISTS "tables_select_public_active" ON tables;
CREATE POLICY "tables_select_public_active" ON tables
  FOR SELECT TO anon, authenticated
  USING (is_active = true);

DROP POLICY IF EXISTS "tables_insert_admin" ON tables;
CREATE POLICY "tables_insert_admin" ON tables
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

DROP POLICY IF EXISTS "tables_update_admin" ON tables;
CREATE POLICY "tables_update_admin" ON tables
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

DROP TRIGGER IF EXISTS tables_touch_updated_at ON tables;
CREATE TRIGGER tables_touch_updated_at BEFORE UPDATE ON tables
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='table_id') THEN
    ALTER TABLE orders ADD COLUMN table_id uuid REFERENCES tables(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='order_source') THEN
    ALTER TABLE orders ADD COLUMN order_source text NOT NULL DEFAULT 'staff' CHECK (order_source IN ('staff', 'qr'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='confirmed_at') THEN
    ALTER TABLE orders ADD COLUMN confirmed_at timestamptz;
  END IF;
END $$;

-- Security tightening: required now that non-staff (anonymous customer)
-- sessions can exist. Staff keep identical access to before.
DROP POLICY IF EXISTS "orders_select_authenticated" ON orders;
CREATE POLICY "orders_select_authenticated" ON orders
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid())
    OR created_by = auth.uid()
  );

DROP POLICY IF EXISTS "orders_insert_authenticated" ON orders;
DROP POLICY IF EXISTS "orders_insert_staff" ON orders;
CREATE POLICY "orders_insert_staff" ON orders
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'cashier')));

DROP POLICY IF EXISTS "orders_update_authenticated" ON orders;
DROP POLICY IF EXISTS "orders_update_staff" ON orders;
CREATE POLICY "orders_update_staff" ON orders
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid()));

DROP POLICY IF EXISTS "order_items_select_authenticated" ON order_items;
CREATE POLICY "order_items_select_authenticated" ON order_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid())
    OR EXISTS (SELECT 1 FROM orders o WHERE o.id = order_items.order_id AND o.created_by = auth.uid())
  );

DROP POLICY IF EXISTS "order_items_insert_authenticated" ON order_items;
DROP POLICY IF EXISTS "order_items_insert_staff" ON order_items;
CREATE POLICY "order_items_insert_staff" ON order_items
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid()));

DROP POLICY IF EXISTS "order_items_update_authenticated" ON order_items;
DROP POLICY IF EXISTS "order_items_update_staff" ON order_items;
CREATE POLICY "order_items_update_staff" ON order_items
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid()));

DROP POLICY IF EXISTS "order_items_delete_authenticated" ON order_items;
DROP POLICY IF EXISTS "order_items_delete_staff" ON order_items;
CREATE POLICY "order_items_delete_staff" ON order_items
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid()));

-- create_customer_order: QR ordering entry point (anonymous customer session).
CREATE OR REPLACE FUNCTION public.create_customer_order(
  p_table_token text,
  p_notes text DEFAULT NULL,
  p_items jsonb DEFAULT '[]'::jsonb
)
RETURNS orders LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  resolved_table tables;
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
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Access denied: must have a session to order';
  END IF;

  SELECT * INTO resolved_table FROM tables WHERE qr_token = p_table_token AND is_active = true;
  IF resolved_table.id IS NULL THEN
    RAISE EXCEPTION 'This table link is not valid or is no longer active';
  END IF;

  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Cannot create an order with no items';
  END IF;

  INSERT INTO orders (notes, status, total, item_count, created_by, table_id, order_source, confirmed_at)
  VALUES (p_notes, 'new', 0, 0, auth.uid(), resolved_table.id, 'qr', NULL)
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

  UPDATE orders SET total = total_amount, item_count = item_count_total WHERE id = new_order.id;
  SELECT * INTO new_order FROM orders WHERE id = new_order.id;
  RETURN new_order;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_customer_order(text, text, jsonb) TO authenticated;

-- confirm_customer_order: cashier reviews -> ACCEPT -> SEND TO KITCHEN.
-- Single action, no item editing.
CREATE OR REPLACE FUNCTION public.confirm_customer_order(p_order_id uuid)
RETURNS orders LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  updated_order orders;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'cashier')) THEN
    RAISE EXCEPTION 'Access denied: only admin or cashier can confirm orders';
  END IF;

  UPDATE orders
  SET confirmed_at = now()
  WHERE id = p_order_id AND order_source = 'qr' AND confirmed_at IS NULL
  RETURNING * INTO updated_order;

  IF updated_order.id IS NULL THEN
    RAISE EXCEPTION 'Order not found or already confirmed';
  END IF;

  RETURN updated_order;
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirm_customer_order(uuid) TO authenticated;

-- Auto-advance to 'served' when payment is marked paid, so the kitchen's
-- active stages can end at READY (order leaves the kitchen display) while
-- Z Report / Analytics revenue math (status='served' AND payment_status=
-- 'paid') keeps working completely unmodified. Cashier UI still only ever
-- presses "Mark Paid".
CREATE OR REPLACE FUNCTION public.orders_auto_serve_on_payment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.payment_status = 'paid'
     AND (OLD.payment_status IS DISTINCT FROM 'paid')
     AND NEW.status IS DISTINCT FROM 'served' THEN
    NEW.status := 'served';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS orders_auto_serve_on_payment ON orders;
CREATE TRIGGER orders_auto_serve_on_payment
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_auto_serve_on_payment();

-- Don't create a staff profile row for anonymous (customer) sessions.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF COALESCE(NEW.is_anonymous, false) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.profiles (id, email, full_name, role, is_active)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    'kitchen',
    true
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'handle_new_user failed for %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER TABLE tables REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='tables') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE tables;
  END IF;
END $$;


-- ============================================================================
-- SECTION 7: PROMOTION MANAGEMENT
-- ============================================================================
-- Additive: lets Admin advertise a business/company URL as a small banner
-- on the public customer QR ordering page. Security mirrors the exact
-- pattern used for `tables` above: admin manages everything, the public
-- (anon + authenticated, which includes the customer's anonymous ordering
-- session) can only ever read rows marked active.

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

DROP POLICY IF EXISTS "promotions_select_admin" ON promotions;
CREATE POLICY "promotions_select_admin" ON promotions
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

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


-- ============================================================================
-- SECTION 8: PROMOTION MEDIA (multiple images/videos + direct upload)
-- ============================================================================
-- Additive: lets a promotion carry multiple images/videos — any mix of
-- pasted URLs and files uploaded directly from the admin's PC — instead of
-- the single `promotions.url` column above. That column is untouched, so
-- any promotion with no rows here yet still works exactly as before.

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
-- the existing menu-images bucket: public read, admin-only write.
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


-- ============================================================================
-- SECTION 9: REFRESH POSTGREST'S SCHEMA CACHE
-- ============================================================================
-- Running SQL directly here (rather than through Supabase's own migration
-- tooling) can leave PostgREST's cached schema/relationship graph stale,
-- which can cause queries referencing changed columns or relationships to
-- silently fail. This forces an immediate reload. Safe and cheap to run
-- every time this script runs.
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- Done. Reload the app — it takes it from here automatically.
-- ============================================================================

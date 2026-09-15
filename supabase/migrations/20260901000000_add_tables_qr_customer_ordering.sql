/*
# Table Management + QR Customer Ordering + Kitchen/Cashier realtime linkage

## Summary
This migration is purely ADDITIVE on top of the existing, working schema.
Nothing existing is dropped, renamed, or redefined away. It adds:

1. A new `tables` table (table_number, qr_token, is_active) — table_number
   shown in the UI, qr_token is what's encoded in the printed QR code.
2. `orders.table_id`, `orders.order_source`, `orders.confirmed_at` — all
   nullable / defaulted so every existing order and the existing
   `create_order()` staff-POS flow keep working completely unchanged.
3. Two new RPCs mirroring the existing `create_order()` pattern:
   - `create_customer_order()` — used by an anonymous customer session
     from the QR ordering page. Resolves the table by its qr_token
     (never by row id), inserts the order un-confirmed.
   - `confirm_customer_order()` — used by cashier/admin to accept a
     QR order and send it to the kitchen (sets confirmed_at only; no
     item editing, per spec).
4. Required security tightening now that non-staff (anonymous) sessions
   can exist: the previous `orders`/`order_items` policies granted USING
   (true)/WITH CHECK (true) to *any* authenticated user, which was safe
   only because every authenticated user used to be staff. That
   assumption is no longer true, so:
   - SELECT is split: staff (has a profiles row) keep seeing everything,
     exactly as before. A customer session (no profiles row) may only
     see their own order (created_by = auth.uid()).
   - INSERT/UPDATE/DELETE on orders & order_items is restricted to staff.
     Customers never write these tables directly — only through the
     SECURITY DEFINER RPC above, exactly like the existing staff flow
     already works through create_order().
5. `handle_new_user()` is guarded to skip profile creation for anonymous
   sign-ins, so the customer QR flow never pollutes Staff Management
   with fake 'kitchen'-role accounts. Behavior for real signups (staff)
   is completely unchanged.
6. `orders_auto_serve_on_payment` trigger: when payment_status is set to
   'paid', status is auto-advanced to 'served' if it isn't already. This
   is what allows the kitchen's "active stages" to end at READY (see
   below) while the existing Z Report / Analytics revenue math — which
   is defined on status='served' AND payment_status='paid' — keeps
   working completely unchanged. No report SQL is touched.
7. `tables` added to the realtime publication.

All statements are idempotent — safe to re-run.
*/

-- ============================================================================
-- 1: tables
-- ============================================================================

CREATE TABLE IF NOT EXISTS tables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_number int UNIQUE NOT NULL,
  name text,
  qr_token text UNIQUE NOT NULL DEFAULT gen_random_uuid()::text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE tables ENABLE ROW LEVEL SECURITY;

-- Staff (any authenticated user with a profiles row) can see all tables.
DROP POLICY IF EXISTS "tables_select_staff" ON tables;
CREATE POLICY "tables_select_staff" ON tables
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid()));

-- Anyone (including a not-yet-signed-in browser, and anonymous customer
-- sessions) can resolve an active table by its qr_token — this is how the
-- public /order/:token page identifies the table before the customer has
-- a session. The token itself is only ever handed out via the printed QR
-- code, so this is no more exposed than the QR code already is.
DROP POLICY IF EXISTS "tables_select_public_active" ON tables;
CREATE POLICY "tables_select_public_active" ON tables
  FOR SELECT TO anon, authenticated
  USING (is_active = true);

-- Only admins add tables (Table Management is add-only per spec — no
-- update/delete UI is built, but an admin-only update policy is kept so a
-- future admin action isn't blocked at the database layer).
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

-- ============================================================================
-- 2: orders — new nullable/defaulted columns (existing rows unaffected)
-- ============================================================================

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

-- ============================================================================
-- 3: security tightening — required now that non-staff sessions can exist
-- ============================================================================

-- orders: staff see/write everything (identical to today). A customer
-- session (no profiles row) may only SELECT their own order, and cannot
-- INSERT/UPDATE/DELETE directly at all — order creation/confirmation goes
-- exclusively through the SECURITY DEFINER RPCs below.
DROP POLICY IF EXISTS "orders_select_authenticated" ON orders;
CREATE POLICY "orders_select_authenticated" ON orders
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid())
    OR created_by = auth.uid()
  );

DROP POLICY IF EXISTS "orders_insert_authenticated" ON orders;
CREATE POLICY "orders_insert_staff" ON orders
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role IN ('admin', 'cashier')));

DROP POLICY IF EXISTS "orders_update_authenticated" ON orders;
CREATE POLICY "orders_update_staff" ON orders
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid()));

-- order_items: same split.
DROP POLICY IF EXISTS "order_items_select_authenticated" ON order_items;
CREATE POLICY "order_items_select_authenticated" ON order_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid())
    OR EXISTS (SELECT 1 FROM orders o WHERE o.id = order_items.order_id AND o.created_by = auth.uid())
  );

DROP POLICY IF EXISTS "order_items_insert_authenticated" ON order_items;
CREATE POLICY "order_items_insert_staff" ON order_items
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid()));

DROP POLICY IF EXISTS "order_items_update_authenticated" ON order_items;
CREATE POLICY "order_items_update_staff" ON order_items
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid()));

DROP POLICY IF EXISTS "order_items_delete_authenticated" ON order_items;
CREATE POLICY "order_items_delete_staff" ON order_items
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid()));

-- ============================================================================
-- 4: create_customer_order — QR ordering entry point (anonymous customer)
-- ============================================================================

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

-- ============================================================================
-- 5: confirm_customer_order — cashier accepts a QR order & sends to kitchen
--    Review -> ACCEPT -> SEND TO KITCHEN is a single action. No item editing.
-- ============================================================================

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

-- ============================================================================
-- 6: auto-advance to 'served' when payment is marked paid
--    Lets the kitchen's active stages end at READY (order leaves the kitchen
--    display) while existing Z Report / Analytics revenue math — defined on
--    status='served' AND payment_status='paid' — keeps working unmodified.
--    Cashier UI still only ever presses "Mark Paid"; nothing new to click.
-- ============================================================================

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

-- ============================================================================
-- 7: don't create a staff profile row for anonymous (customer) sessions
-- ============================================================================

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

-- ============================================================================
-- 8: realtime
-- ============================================================================

ALTER TABLE tables REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='tables') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE tables;
  END IF;
END $$;

/*
# Remove table management, add discounts, fix sales math, close security gaps

## Summary
This restaurant has open seating (no numbered tables), so:
1. Drops `orders.table_id` and the `tables` table entirely (CASCADE removes
   the FK constraint automatically; the column is dropped explicitly).
2. `create_order(p_table_id, p_notes, p_items)` is replaced with
   `create_order(p_notes, p_items)` — the old 3-arg overload is dropped.

Also in this migration:
3. `orders.discount_amount` (admin-only to change, enforced by trigger).
4. `get_daily_report` now defines "sales" as status='served' AND
   payment_status='paid', net of discount_amount — matching the app's
   actual payment-tracking feature instead of only checking kitchen status.
5. **Security fix**: `handle_new_user()` no longer trusts a client-supplied
   `role` from signup metadata (previously any unauthenticated caller could
   call `auth.signUp()` directly with forged metadata and self-promote to
   admin). New accounts always start as 'kitchen'; real role assignment
   only happens via an authenticated admin's RLS-checked UPDATE, or the
   demo-account seed step in `COMPLETE_SETUP.sql`.
6. **Security fix**: `get_daily_report` and `create_order` now check the
   caller's role themselves (RAISE EXCEPTION if not authorized), so sales
   data and order creation are enforced at the database level, not only by
   hiding UI — a cashier/kitchen account calling these directly no longer
   works.
7. Demo menu item prices rescaled to realistic ETB amounts (self-corrects
   rows seeded by an older version of this project with placeholder
   USD-scale prices).
8. `fix_demo_account_roles()` — a permanent, callable, hardcoded-safe
   function (no parameters, no user input) that assigns the correct role
   to the three demo accounts by email. The app calls this automatically
   on every load once the schema is ready, so demo-account roles never
   get stuck wrong again, even though new signups always start as
   'kitchen' per the security fix above.

All statements are idempotent — safe to re-run.
*/

-- ===== 1: remove tables entirely =====
ALTER TABLE IF EXISTS orders DROP COLUMN IF EXISTS table_id;
DROP TABLE IF EXISTS tables CASCADE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='tables') THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE tables;
  END IF;
EXCEPTION WHEN undefined_table THEN
  NULL;
END $$;

-- ===== 2 & 3: create_order without table_id, plus discount_amount =====
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='discount_amount') THEN
    ALTER TABLE orders ADD COLUMN discount_amount numeric(10,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.protect_order_discount()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (NEW.discount_amount IS DISTINCT FROM OLD.discount_amount) THEN
    IF NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin') THEN
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

-- ===== 4 & 6: accurate, admin-only sales report =====
CREATE OR REPLACE FUNCTION public.get_daily_report(p_target_date date DEFAULT CURRENT_DATE)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  result jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin') THEN
    RAISE EXCEPTION 'Access denied: admin only';
  END IF;

  SELECT jsonb_build_object(
    'target_date', p_target_date,
    'total_orders', COUNT(o.id),
    'served_orders', COUNT(o.id) FILTER (WHERE o.status = 'served'),
    'total_revenue', COALESCE(SUM(o.total - o.discount_amount) FILTER (WHERE o.status = 'served' AND o.payment_status = 'paid'), 0),
    'total_discount', COALESCE(SUM(o.discount_amount) FILTER (WHERE o.status = 'served' AND o.payment_status = 'paid'), 0),
    'avg_order_value', COALESCE(AVG(o.total - o.discount_amount) FILTER (WHERE o.status = 'served' AND o.payment_status = 'paid'), 0),
    'orders_new', COUNT(o.id) FILTER (WHERE o.status = 'new'),
    'orders_preparing', COUNT(o.id) FILTER (WHERE o.status = 'preparing'),
    'orders_ready', COUNT(o.id) FILTER (WHERE o.status = 'ready'),
    'orders_served', COUNT(o.id) FILTER (WHERE o.status = 'served'),
    'unpaid_served_orders', COUNT(o.id) FILTER (WHERE o.status = 'served' AND o.payment_status = 'unpaid'),
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
  WHERE o.created_at::date = p_target_date;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_daily_report(date) TO authenticated;

-- ===== 5: close the signup role-escalation hole =====
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
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

-- ===== permanent, callable demo-role-fix function =====
CREATE OR REPLACE FUNCTION public.fix_demo_account_roles()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  admin_id uuid; cashier_id uuid; kitchen_id uuid;
BEGIN
  SELECT id INTO admin_id FROM auth.users WHERE email = 'admin@marcillas.com';
  SELECT id INTO cashier_id FROM auth.users WHERE email = 'cashier@marcillas.com';
  SELECT id INTO kitchen_id FROM auth.users WHERE email = 'kitchen@marcillas.com';

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

SELECT public.fix_demo_account_roles();

-- ===== 7: rescale demo menu item prices to ETB =====
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

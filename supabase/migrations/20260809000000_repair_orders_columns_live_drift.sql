/*
# Repair: guarantee every orders/order_items column the app requires exists

## Why this migration exists
Live symptom: "Couldn't load orders — column orders.discount_amount does
not exist". Root cause: the last two fix rounds gave narrowly-scoped SQL
snippets (a role-guard fix, a realtime-reliability fix) — neither ever
touched the `orders` table's columns. `COMPLETE_SETUP.sql` itself has
always had the correct `ADD COLUMN IF NOT EXISTS` guards for
`discount_amount`/`payment_status`, but it was never re-run after those
columns were introduced, so the live database fell behind.

This migration is a full, self-contained repair: every column the current
application code reads or writes on `orders`/`order_items` is guaranteed to
exist, regardless of which prior migration/snippet was or wasn't applied.
Every statement is guarded and idempotent — safe to run any number of
times, and never drops a column or any data.
*/

-- ===== orders: guarantee every required column =====
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='status') THEN
    ALTER TABLE orders ADD COLUMN status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','preparing','ready','served'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='orders' AND column_name='payment_status') THEN
    ALTER TABLE orders ADD COLUMN payment_status text NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid','paid'));
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

-- ===== order_items: guarantee every required column =====
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

-- ===== recreate dependent functions/triggers now that columns are guaranteed =====
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

-- ===== realtime =====
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
END $$;

NOTIFY pgrst, 'reload schema';

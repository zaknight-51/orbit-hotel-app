/*
# Z Report daily closing + range analytics

## Summary
1. Extends `get_daily_report` with `items_sold`, `gross_sales`,
   `paid_orders`, `unpaid_amount` (purely additive — no existing field
   changed or removed).
2. Adds `get_range_report(start_date, end_date)` — same shape, aggregated
   over an inclusive date range. Used for Week/Month/Year Analytics.
3. Adds `z_reports`: a permanent, append-only table. Closing a business
   day NEVER touches `orders`/`order_items` — it only inserts one snapshot
   row here. A `UNIQUE` constraint on `business_date` guarantees, at the
   database level, that a day can only be closed once. RLS allows admin
   SELECT/INSERT only — there is intentionally no UPDATE or DELETE policy
   at all, so a closed report can never be modified or removed via the API
   by anyone, including admins.
4. Adds `close_z_report(business_date)` — admin-only (checked inside the
   function itself, not just via RLS), computes that day's totals and
   inserts the snapshot. Raises a clear error if that day is already
   closed or if the caller isn't an admin.

All of this is purely additive. It does not alter `orders`, `order_items`,
or any existing report/order behavior.
*/

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

DROP POLICY IF EXISTS "z_reports_select_admin" ON z_reports;
CREATE POLICY "z_reports_select_admin" ON z_reports
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

DROP POLICY IF EXISTS "z_reports_insert_admin" ON z_reports;
CREATE POLICY "z_reports_insert_admin" ON z_reports
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

CREATE INDEX IF NOT EXISTS idx_z_reports_business_date ON z_reports(business_date DESC);

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

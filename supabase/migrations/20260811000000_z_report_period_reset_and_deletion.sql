/*
# Z Report business-period reset + admin-only deletion

## 1. THE CORE FIX: "Today" now resets after closing
`get_daily_report(target_date)` previously scoped "today" purely by
calendar date (`created_at::date = target_date`), with no concept of a
Z Report closing boundary. That meant Admin Dashboard/Analytics "Today"
kept showing the full day's total even after that day had been formally
closed with a Z Report.

Fixed by introducing a `period_start` boundary inside the function:
- If a Z Report already exists for that date, `period_start` = that
  report's `closed_at` timestamp.
- Otherwise, `period_start` = midnight of that date (the whole day, same
  as before).

Every aggregate in the function now additionally requires
`o.created_at > period_start`. This is what makes "Today" reset to zero
immediately after closing (no orders yet exist after the closing moment),
and correctly count only new orders created after that point — without
ever touching `orders`/`order_items`, and without needing any frontend
reset logic. `get_range_report` (Week/Month/Year) is intentionally left
unchanged — those remain true historical totals by calendar date,
regardless of Z Report boundaries.

## 2. Admin-only deletion (explicitly requested this round)
- `z_reports`: added a DELETE policy, admin-only. Deleting a Z Report row
  never touches `orders`/`order_items` — there is no foreign key from
  orders to z_reports.
- `orders`: the DELETE policy was previously open to any authenticated
  role (`USING (true)`) — tightened to admin-only. `order_items.order_id`
  already has `ON DELETE CASCADE`, so deleting an order safely removes its
  order_items with zero orphaned rows — no change needed there.

Both are enforced at the RLS/database level, not just by hiding a button
in the UI.
*/

CREATE OR REPLACE FUNCTION public.get_daily_report(p_target_date date DEFAULT CURRENT_DATE)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  result jsonb;
  period_start timestamptz;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin') THEN
    RAISE EXCEPTION 'Access denied: admin only';
  END IF;

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

DROP POLICY IF EXISTS "z_reports_delete_admin" ON z_reports;
CREATE POLICY "z_reports_delete_admin" ON z_reports
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

DROP POLICY IF EXISTS "orders_delete_authenticated" ON orders;
DROP POLICY IF EXISTS "orders_delete_admin" ON orders;
CREATE POLICY "orders_delete_admin" ON orders
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

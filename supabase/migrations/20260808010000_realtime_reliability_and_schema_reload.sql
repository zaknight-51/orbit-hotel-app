/*
# Realtime reliability fixes for Cashier -> Kitchen order flow

## Context
Reported symptom: cashier creates an order successfully (confirmed by the
success message, meaning the `create_order` RPC returned a real row), but
it never appears on the Kitchen Display — not even after a manual refresh,
and not via realtime either.

## What was verified as already correct (no change needed)
- RLS on `orders`/`order_items`: SELECT is `USING (true) TO authenticated`,
  so any signed-in role (including kitchen) can read all orders.
- `orders` and `order_items` are both already registered in the
  `supabase_realtime` publication.
- Kitchen Display and Cashier Dashboard use the exact same `useActiveOrders`
  hook/query — there is no kitchen-specific query bug in the app code.
- `create_order`'s parameter shape matches exactly what the frontend sends.

## What this migration fixes
1. `REPLICA IDENTITY FULL` on `orders` and `order_items` — Supabase's own
   documented recommendation for reliable `postgres_changes` delivery.
   Without it, UPDATE/DELETE realtime payloads can be missing data the
   client needs.
2. Forces PostgREST to reload its schema/relationship cache. This project
   has had many rounds of raw SQL run directly against it this session
   (dropping the `tables` table, adding `discount_amount`/`payment_status`,
   changing `create_order`'s signature, etc.) — done outside Supabase's own
   migration tooling, which normally auto-notifies PostgREST of schema
   changes. A stale cache is the single most likely explanation for a query
   that should work (per everything else checked above) silently returning
   wrong/empty results or erroring.

Both statements are safe and idempotent to run at any time.
*/

ALTER TABLE orders REPLICA IDENTITY FULL;
ALTER TABLE order_items REPLICA IDENTITY FULL;

NOTIFY pgrst, 'reload schema';

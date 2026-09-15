/*
# Enforce admin-only menu & inventory management

## Problem
`menu_items`, `categories`, and `inventory_items` currently allow ANY
authenticated user to INSERT/UPDATE/DELETE. The app's UI only lets admins
reach the Menu Management / Inventory screens, but that's a client-side
convenience, not security — a cashier or kitchen-staff account could call
Supabase directly and edit the menu or stock. This closes that gap at the
database layer, which is the only place permissions can actually be
enforced.

## Changes
- `menu_items`, `categories`, `inventory_items`: INSERT/UPDATE/DELETE
  restricted to users whose `profiles.role = 'admin'`.
- SELECT policies on these tables are untouched (still readable by any
  authenticated user), so POS, Kitchen Display, and stock-alert reads keep
  working exactly as before for cashier/kitchen accounts.
- `orders`, `order_items`, `tables` are intentionally left as-is: cashiers
  need to create/update orders and tables, and kitchen staff needs to
  update order status, per the app's role spec.
*/

-- ===== menu_items =====
DROP POLICY IF EXISTS "menu_insert_authenticated" ON menu_items;
CREATE POLICY "menu_insert_admin" ON menu_items
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

DROP POLICY IF EXISTS "menu_update_authenticated" ON menu_items;
CREATE POLICY "menu_update_admin" ON menu_items
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

DROP POLICY IF EXISTS "menu_delete_authenticated" ON menu_items;
CREATE POLICY "menu_delete_admin" ON menu_items
  FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

-- ===== categories =====
DROP POLICY IF EXISTS "categories_insert_authenticated" ON categories;
CREATE POLICY "categories_insert_admin" ON categories
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

DROP POLICY IF EXISTS "categories_update_authenticated" ON categories;
CREATE POLICY "categories_update_admin" ON categories
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

DROP POLICY IF EXISTS "categories_delete_authenticated" ON categories;
CREATE POLICY "categories_delete_admin" ON categories
  FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

-- ===== inventory_items =====
DROP POLICY IF EXISTS "inventory_insert_authenticated" ON inventory_items;
CREATE POLICY "inventory_insert_admin" ON inventory_items
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

DROP POLICY IF EXISTS "inventory_update_authenticated" ON inventory_items;
CREATE POLICY "inventory_update_admin" ON inventory_items
  FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

DROP POLICY IF EXISTS "inventory_delete_authenticated" ON inventory_items;
CREATE POLICY "inventory_delete_admin" ON inventory_items
  FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

/*
# Allow admins to delete tables (and their QR codes)

## Problem
`tables` has SELECT/INSERT/UPDATE policies but no DELETE policy, so the
"Add Table" flow works but there was no way to ever remove a table once
created — RLS silently blocks every DELETE with no matching policy, even
for an admin.

## Change
Add an admin-only DELETE policy on `tables`, matching the existing
insert/update admin policies exactly. Any order that references a deleted
table keeps working: `orders.table_id` was defined with
`ON DELETE SET NULL`, so past orders are preserved, they just lose their
table link instead of being deleted or blocked.
*/

DROP POLICY IF EXISTS "tables_delete_admin" ON tables;
CREATE POLICY "tables_delete_admin" ON tables
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

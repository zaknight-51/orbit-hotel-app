/*
# Allow admins to remove staff profiles

## Summary
The original profiles policies only let a user delete their own profile row,
which meant admins had no way to fully manage staff (e.g. remove someone who
left) from the app. This adds an additional, admin-scoped DELETE policy on
`profiles`, following the exact same pattern already used for the existing
`profiles_update_admin` policy. Nothing existing is changed or removed.

## Security (RLS)
- Admins can delete any profile row (staff management).
- The existing `profiles_delete_own` policy is untouched, so every user can
  still delete their own profile as before.

## Important Notes
- Deleting a profile row does NOT delete the underlying `auth.users` account
  (that requires the Supabase service role and is intentionally out of scope
  for the client app). A removed staff member's login session will simply
  have no profile, and the app routes them back to the login screen.
*/

DROP POLICY IF EXISTS "profiles_delete_admin" ON profiles;
CREATE POLICY "profiles_delete_admin"
ON profiles FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid() AND p.role = 'admin'
  )
);

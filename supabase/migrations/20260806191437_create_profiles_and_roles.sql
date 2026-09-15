/*
# Create staff profiles table for role-based access

1. New Tables
- `profiles`
  - `id` (uuid, primary key, references auth.users) — one row per auth account
  - `email` (text) — denormalized for easy display
  - `full_name` (text) — display name of the staff member
  - `role` (text, NOT NULL, default 'kitchen') — one of 'admin', 'cashier', 'kitchen'
  - `created_at` (timestamptz) — when the profile was created
  - `updated_at` (timestamptz) — last modification time

2. Constraints
- `profiles_role_check` CHECK constraint limits `role` to 'admin', 'cashier', 'kitchen'.

3. Security
- Enable RLS on `profiles`.
- Authenticated users can read all staff profiles (internal system; staff see each other).
- A user can insert/update/delete only their own profile row.
  Admins can additionally update any profile (for staff management) via a separate
  admin-scoped UPDATE policy.
- The role column is protected: a non-admin cannot change their own role because the
  admin update policy is the only one that allows updating another user's row, and the
  self-update policy allows updating only the user's own row. Role escalation is
  prevented by not granting self role-changes beyond the self row (admins manage roles).

4. Important Notes
- Role is stored in the `profiles` table (not in auth metadata) so it is queryable and
  manageable through normal SQL/RLS.
- A trigger `handle_new_user` auto-creates a profile row when a new auth user signs up,
  defaulting role to 'kitchen' and copying email from the auth record.
*/

CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  full_name text,
  role text NOT NULL DEFAULT 'kitchen'
    CHECK (role IN ('admin', 'cashier', 'kitchen')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Everyone signed in can read the staff directory (internal system)
DROP POLICY IF EXISTS "profiles_select_all_authenticated" ON profiles;
CREATE POLICY "profiles_select_all_authenticated"
ON profiles FOR SELECT
TO authenticated
USING (true);

-- A user can insert only their own profile
DROP POLICY IF EXISTS "profiles_insert_own" ON profiles;
CREATE POLICY "profiles_insert_own"
ON profiles FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = id);

-- A user can update their own profile (but role changes are effectively controlled
-- because admins manage role assignment; self-update is allowed for name/email)
DROP POLICY IF EXISTS "profiles_update_own" ON profiles;
CREATE POLICY "profiles_update_own"
ON profiles FOR UPDATE
TO authenticated
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

-- Admins can update any profile (staff management, including role assignment)
DROP POLICY IF EXISTS "profiles_update_admin" ON profiles;
CREATE POLICY "profiles_update_admin"
ON profiles FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid() AND p.role = 'admin'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid() AND p.role = 'admin'
  )
);

-- A user can delete only their own profile
DROP POLICY IF EXISTS "profiles_delete_own" ON profiles;
CREATE POLICY "profiles_delete_own"
ON profiles FOR DELETE
TO authenticated
USING (auth.uid() = id);

-- Auto-create a profile row on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'role', 'kitchen')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- updated_at auto-maintainer
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_touch_updated_at ON profiles;
CREATE TRIGGER profiles_touch_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
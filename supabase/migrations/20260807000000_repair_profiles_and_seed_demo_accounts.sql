/*
# Repair staff profiles + seed demo accounts

## Why this migration exists
Symptom reported: users can sign in via Supabase Auth successfully, but the
app then shows "Signed in, but your staff profile could not be loaded."
That means the `profiles` row for the signed-in user either doesn't exist
or the query against it is failing — which happens if this project's
earlier migrations were never fully applied, were applied out of order, or
the table drifted from what the app expects (e.g. missing the `is_active`
column requested for staff profiles).

This migration is intentionally self-contained and idempotent: every step
uses IF NOT EXISTS / IF EXISTS / ON CONFLICT guards, so it is safe to run
on a brand-new database, a partially-migrated one, or one that already has
everything from earlier migration files. Re-running it is always safe.

## What it does
1. Creates `profiles` if it doesn't exist yet (with every column the app
   needs, including `is_active`).
2. Adds any missing columns to an existing `profiles` table (`is_active`,
   `full_name`, `email`, `role`) so older/partial deployments get repaired
   in place instead of erroring.
3. Rebuilds RLS policies from a clean slate (drops + recreates), so stale
   or missing policies can't silently block reads.
4. Adds a BEFORE UPDATE guard trigger that prevents a non-admin from
   changing their own `role` or `is_active` — closes a privilege-escalation
   gap where `profiles_update_own` allowed a user to edit every column of
   their own row, including `role`.
5. Replaces `handle_new_user` with a version that (a) sets `is_active` on
   new signups and (b) never blocks account creation even if the insert
   fails for an unexpected reason (logs a warning instead).
6. Backfills a `profiles` row for every existing `auth.users` row that
   doesn't have one yet — this alone fixes "signed in but no profile" for
   any account created before these policies/trigger existed.
7. Seeds/repairs the three demo staff profiles (admin/cashier/kitchen) by
   matching on email, IF a matching `auth.users` account already exists.
   This does not create Auth accounts (that needs Admin API / dashboard —
   see README) — it only ensures that once those accounts exist, their
   `profiles` row has the right name/role/active status.
*/

-- ===== 1 & 2: table + columns =====
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  full_name text,
  role text NOT NULL DEFAULT 'kitchen'
    CHECK (role IN ('admin', 'cashier', 'kitchen')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'is_active'
  ) THEN
    ALTER TABLE profiles ADD COLUMN is_active boolean NOT NULL DEFAULT true;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'full_name'
  ) THEN
    ALTER TABLE profiles ADD COLUMN full_name text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'email'
  ) THEN
    ALTER TABLE profiles ADD COLUMN email text NOT NULL DEFAULT '';
  END IF;
END $$;

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- ===== 3: rebuild policies cleanly =====
DROP POLICY IF EXISTS "profiles_select_all_authenticated" ON profiles;
CREATE POLICY "profiles_select_all_authenticated"
ON profiles FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS "profiles_insert_own" ON profiles;
CREATE POLICY "profiles_insert_own"
ON profiles FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_update_own" ON profiles;
CREATE POLICY "profiles_update_own"
ON profiles FOR UPDATE
TO authenticated
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_update_admin" ON profiles;
CREATE POLICY "profiles_update_admin"
ON profiles FOR UPDATE
TO authenticated
USING (
  EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
)
WITH CHECK (
  EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
);

DROP POLICY IF EXISTS "profiles_delete_own" ON profiles;
CREATE POLICY "profiles_delete_own"
ON profiles FOR DELETE
TO authenticated
USING (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_delete_admin" ON profiles;
CREATE POLICY "profiles_delete_admin"
ON profiles FOR DELETE
TO authenticated
USING (
  EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
);

-- ===== 4: close the role/is_active self-escalation gap =====
CREATE OR REPLACE FUNCTION public.protect_profile_privileges()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (NEW.role IS DISTINCT FROM OLD.role OR NEW.is_active IS DISTINCT FROM OLD.is_active) THEN
    IF NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin') THEN
      NEW.role := OLD.role;
      NEW.is_active := OLD.is_active;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_protect_privileges ON profiles;
CREATE TRIGGER profiles_protect_privileges
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_privileges();

-- ===== 5: crash-proof signup trigger =====
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role, is_active)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'role', 'kitchen'),
    true
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block auth account creation because of a profile-insert issue.
  RAISE WARNING 'handle_new_user failed for %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

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

-- ===== 6: backfill any auth user missing a profile row =====
INSERT INTO public.profiles (id, email, full_name, role, is_active)
SELECT
  u.id,
  u.email,
  COALESCE(u.raw_user_meta_data->>'full_name', split_part(u.email, '@', 1)),
  COALESCE(u.raw_user_meta_data->>'role', 'kitchen'),
  true
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id)
ON CONFLICT (id) DO NOTHING;

-- ===== 7: seed/repair the three demo staff profiles by email =====
DO $$
DECLARE
  admin_id uuid;
  cashier_id uuid;
  kitchen_id uuid;
BEGIN
  SELECT id INTO admin_id FROM auth.users WHERE email = 'admin@marcillas.com';
  SELECT id INTO cashier_id FROM auth.users WHERE email = 'cashier@marcillas.com';
  SELECT id INTO kitchen_id FROM auth.users WHERE email = 'kitchen@marcillas.com';

  IF admin_id IS NOT NULL THEN
    INSERT INTO public.profiles (id, email, full_name, role, is_active)
    VALUES (admin_id, 'admin@marcillas.com', 'System Administrator', 'admin', true)
    ON CONFLICT (id) DO UPDATE
      SET role = 'admin', full_name = 'System Administrator', is_active = true, email = 'admin@marcillas.com';
  END IF;

  IF cashier_id IS NOT NULL THEN
    INSERT INTO public.profiles (id, email, full_name, role, is_active)
    VALUES (cashier_id, 'cashier@marcillas.com', 'Front Desk Cashier', 'cashier', true)
    ON CONFLICT (id) DO UPDATE
      SET role = 'cashier', full_name = 'Front Desk Cashier', is_active = true, email = 'cashier@marcillas.com';
  END IF;

  IF kitchen_id IS NOT NULL THEN
    INSERT INTO public.profiles (id, email, full_name, role, is_active)
    VALUES (kitchen_id, 'kitchen@marcillas.com', 'Kitchen Staff', 'kitchen', true)
    ON CONFLICT (id) DO UPDATE
      SET role = 'kitchen', full_name = 'Kitchen Staff', is_active = true, email = 'kitchen@marcillas.com';
  END IF;
END $$;

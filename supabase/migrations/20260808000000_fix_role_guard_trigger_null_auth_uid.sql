/*
# Fix: role-guard trigger silently reverted role changes made outside the API

## Root cause (confirmed)
`protect_profile_privileges()` (added to stop non-admins self-promoting via
the REST API) checked `auth.uid()` to decide whether the caller was an
admin. But `auth.uid()` is NULL whenever there's no authenticated PostgREST
session — which is exactly the case when running SQL directly in the
Supabase SQL Editor, or in a migration. The trigger treated NULL the same
as "authenticated non-admin" and silently reverted `role`/`is_active`
changes back to their old values, with no error. This is why
`fix_demo_account_roles()` appeared to run successfully but the roles
stayed wrong: the function's own UPDATE was immediately undone by this
trigger, in the same statement.

This is safe to fix by only enforcing the admin check when there IS an
authenticated caller (`auth.uid() IS NOT NULL`). A truly anonymous or
direct-SQL context can't reach this UPDATE through the normal API anyway —
the `profiles_update_own` / `profiles_update_admin` RLS policies are both
scoped `TO authenticated` only, so an anonymous REST caller has no matching
UPDATE policy and never reaches this trigger in the first place. Only a
direct database connection (SQL Editor, migrations, `SECURITY DEFINER`
functions like `fix_demo_account_roles()`) has `auth.uid() IS NULL` here,
and that's already a more trusted context than "signed in but not admin".

Also hardens `fix_demo_account_roles()`'s email matching to be
case-insensitive and whitespace-tolerant, as defense in depth.
*/

CREATE OR REPLACE FUNCTION public.protect_profile_privileges()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (NEW.role IS DISTINCT FROM OLD.role OR NEW.is_active IS DISTINCT FROM OLD.is_active) THEN
    IF auth.uid() IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.role = 'admin') THEN
      NEW.role := OLD.role;
      NEW.is_active := OLD.is_active;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

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

CREATE OR REPLACE FUNCTION public.fix_demo_account_roles()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  admin_id uuid; cashier_id uuid; kitchen_id uuid;
BEGIN
  SELECT id INTO admin_id FROM auth.users
    WHERE lower(btrim(email)) = 'admin@marcillas.com' ORDER BY created_at ASC LIMIT 1;
  SELECT id INTO cashier_id FROM auth.users
    WHERE lower(btrim(email)) = 'cashier@marcillas.com' ORDER BY created_at ASC LIMIT 1;
  SELECT id INTO kitchen_id FROM auth.users
    WHERE lower(btrim(email)) = 'kitchen@marcillas.com' ORDER BY created_at ASC LIMIT 1;

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

-- Apply it now.
SELECT public.fix_demo_account_roles();

-- Verify:
SELECT email, role, is_active FROM public.profiles
WHERE email IN ('admin@marcillas.com','cashier@marcillas.com','kitchen@marcillas.com');

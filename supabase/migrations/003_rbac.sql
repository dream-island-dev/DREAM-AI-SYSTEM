-- ================================================================
-- Migration 003: Full RBAC System
-- Roles: super_admin | admin | manager | staff
-- Departments: free text (supports Hebrew + English)
-- Run AFTER 001 and 002.
-- ================================================================

-- ── 1. Extend profiles table ─────────────────────────────────────────────────

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avatar  TEXT,          -- Google profile photo URL
  ADD COLUMN IF NOT EXISTS status  TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'pending'));

-- Update role constraint to include all tiers
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('super_admin', 'admin', 'manager', 'staff'));

-- ── 2. Update get_my_role() so existing policies still work ──────────────────
-- Returns 'admin' for both 'admin' AND 'super_admin' (backwards compat).
-- New code uses get_true_role() to distinguish super_admin specifically.

CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS TEXT LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT CASE
    WHEN role IN ('super_admin', 'admin') THEN 'admin'
    ELSE role
  END
  FROM public.profiles WHERE id = auth.uid();
$$;

-- True role without aliasing (used for super_admin-only checks)
CREATE OR REPLACE FUNCTION public.get_true_role()
RETURNS TEXT LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

-- Convenience boolean
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT get_true_role() = 'super_admin';
$$;

-- ── 3. Update new-user trigger ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_role TEXT;
  v_name TEXT;
BEGIN
  v_name := COALESCE(
    NEW.raw_user_meta_data->>'name',
    split_part(NEW.email, '@', 1)
  );

  v_role := CASE NEW.email
    WHEN 'promote7il@gmail.com' THEN 'super_admin'
    ELSE 'manager'
  END;

  INSERT INTO public.profiles (id, name, email, role, avatar_text, avatar, status)
  VALUES (
    NEW.id,
    v_name,
    NEW.email,
    v_role,
    LEFT(UPPER(v_name), 2),
    NEW.raw_user_meta_data->>'avatar_url',
    'active'
  )
  ON CONFLICT (id) DO UPDATE SET
    name       = EXCLUDED.name,
    email      = EXCLUDED.email,
    avatar     = COALESCE(EXCLUDED.avatar, profiles.avatar),
    role       = CASE
                   WHEN profiles.email = 'promote7il@gmail.com' THEN 'super_admin'
                   ELSE profiles.role
                 END,
    updated_at = NOW();

  RETURN NEW;
END;
$$;

-- ── 4. Promote Mike to super_admin (existing row) ────────────────────────────

UPDATE public.profiles
SET role = 'super_admin', updated_at = NOW()
WHERE email = 'promote7il@gmail.com';

-- ── 5. RBAC: User Management RLS ─────────────────────────────────────────────

-- SELECT: all authenticated users can read profiles (needed for dropdowns etc.)
-- (existing profiles_select policy already handles this)

-- UPDATE: super_admin can update any profile field
DROP POLICY IF EXISTS "profiles_update"            ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_superadmin" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_self"       ON public.profiles;

-- super_admin: full update on any row
CREATE POLICY "profiles_update_superadmin" ON public.profiles
  FOR UPDATE
  USING     (get_true_role() = 'super_admin')
  WITH CHECK (get_true_role() = 'super_admin');

-- Any user: can update their own row BUT cannot escalate their own role
CREATE POLICY "profiles_update_self" ON public.profiles
  FOR UPDATE
  USING (auth.uid() = id AND get_true_role() != 'super_admin')
  WITH CHECK (
    auth.uid() = id
    -- Prevent self-promotion: new role must equal current role
    AND role = (SELECT role FROM public.profiles WHERE id = auth.uid())
  );

-- DELETE: only super_admin can delete profiles
DROP POLICY IF EXISTS "profiles_delete" ON public.profiles;
CREATE POLICY "profiles_delete" ON public.profiles
  FOR DELETE
  USING (get_true_role() = 'super_admin');

-- INSERT: handled by trigger; allow anon insert for trigger SECURITY DEFINER
CREATE POLICY "profiles_insert_trigger" ON public.profiles
  FOR INSERT WITH CHECK (true);

-- ── 6. Useful view for admin user list ───────────────────────────────────────

CREATE OR REPLACE VIEW public.admin_user_summary AS
SELECT
  p.id,
  p.name,
  p.email,
  p.role,
  p.department,
  p.status,
  p.avatar,
  p.avatar_text,
  p.created_at,
  p.updated_at,
  (SELECT COUNT(*)
   FROM public.chat_history ch
   WHERE ch.manager_id = p.id::TEXT) AS total_messages
FROM public.profiles p;

-- ── 7. Departments reference (informational, not enforced by FK) ─────────────
-- Departments are free text — this table just lists the canonical options.

CREATE TABLE IF NOT EXISTS public.departments (
  id      SERIAL PRIMARY KEY,
  name    TEXT NOT NULL UNIQUE,
  name_he TEXT,            -- Hebrew translation
  active  BOOLEAN NOT NULL DEFAULT TRUE
);

INSERT INTO public.departments (name, name_he) VALUES
  ('Management',   'ניהול'),
  ('Reception',    'קבלה'),
  ('Maintenance',  'תחזוקה'),
  ('Finance',      'כספים'),
  ('Restaurant',   'מסעדה'),
  ('Cleaning',     'ניקיון'),
  ('Security',     'ביטחון'),
  ('Spa',          'ספא')
ON CONFLICT (name) DO NOTHING;

ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "departments_read"  ON public.departments FOR SELECT USING (true);
CREATE POLICY "departments_write" ON public.departments FOR ALL
  USING     (get_true_role() = 'super_admin')
  WITH CHECK (get_true_role() = 'super_admin');

-- ================================================================
-- END OF MIGRATION 003
-- ================================================================

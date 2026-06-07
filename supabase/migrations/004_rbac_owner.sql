-- ================================================================
-- Migration 004: Owner re-hardcode (Tzalam Nadlan)
-- ----------------------------------------------------------------
-- OWNER MODEL:
--   tzalamnadlan@gmail.com  → super_admin  (undisputed owner)
--   promote7il@gmail.com    → admin        (legacy, demoted from owner)
--   everyone else (new)     → staff        (default; promotable by owner)
--
-- Safe to re-run (idempotent). Run AFTER 003_rbac.sql.
-- Existing users are NEVER silently downgraded except the explicit
-- promote7il → admin demotion mandated by the new owner model.
-- ================================================================

-- ── 1. Replace the new-user trigger with the owner model ─────────────────────

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

  v_role := CASE lower(NEW.email)
    WHEN 'tzalamnadlan@gmail.com' THEN 'super_admin'
    WHEN 'promote7il@gmail.com'   THEN 'admin'
    ELSE 'staff'
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
    -- Enforce the owner model on every login; otherwise keep current role.
    role       = CASE lower(profiles.email)
                   WHEN 'tzalamnadlan@gmail.com' THEN 'super_admin'
                   WHEN 'promote7il@gmail.com'   THEN 'admin'
                   ELSE profiles.role
                 END,
    updated_at = NOW();

  RETURN NEW;
END;
$$;

-- ── 2. Fix existing rows (one-time reconciliation) ───────────────────────────

-- Promote the new owner.
UPDATE public.profiles
SET role = 'super_admin', updated_at = NOW()
WHERE lower(email) = 'tzalamnadlan@gmail.com'
  AND role IS DISTINCT FROM 'super_admin';

-- Demote the legacy owner to admin (mandated by the new model).
UPDATE public.profiles
SET role = 'admin', updated_at = NOW()
WHERE lower(email) = 'promote7il@gmail.com'
  AND role IS DISTINCT FROM 'admin';

-- ================================================================
-- END OF MIGRATION 004
-- ================================================================

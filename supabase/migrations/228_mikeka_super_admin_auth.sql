-- 228: Co-owner super_admin — mikeka13@gmail.com (Google auth + profiles trigger).

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
    WHEN 'mikeka13@gmail.com'     THEN 'super_admin'
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
    role       = CASE lower(profiles.email)
                   WHEN 'tzalamnadlan@gmail.com' THEN 'super_admin'
                   WHEN 'mikeka13@gmail.com'     THEN 'super_admin'
                   WHEN 'promote7il@gmail.com'   THEN 'admin'
                   ELSE profiles.role
                 END,
    updated_at = NOW();

  RETURN NEW;
END;
$$;

UPDATE public.profiles
SET role = 'super_admin', updated_at = NOW()
WHERE lower(email) = 'mikeka13@gmail.com'
  AND role IS DISTINCT FROM 'super_admin';

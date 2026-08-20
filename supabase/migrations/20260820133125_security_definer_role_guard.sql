-- 305_security_definer_role_guard.sql
-- Overnight hardening (2026-08-20), part 2.
--
-- Two problems, confirmed live against production (not just the migration
-- files' stated intent):
--
-- 1. delete_guest_profile / match_guest_fuzzy / swap_spa_therapists are
--    SECURITY DEFINER (bypass RLS entirely) and only check "is anyone logged
--    in" (auth.uid() IS NULL), never role. role='cleaner' — which migration
--    087 deliberately blocked from guests/spa_appointments RLS — can still
--    reach the same data/actions through these RPCs directly.
--
-- 2. suppress_guest_pipeline_stage / unsuppress_guest_pipeline_stage have NO
--    auth check in the function body at all, AND (confirmed live via
--    information_schema.routine_privileges) all five of these functions are
--    still GRANTed EXECUTE to PUBLIC and anon. Postgres grants EXECUTE to
--    PUBLIC by default on CREATE FUNCTION; none of the migrations that
--    created these ever REVOKEd it before adding "GRANT ... TO authenticated".
--    Anyone holding only the public anon key (already shipped in the client
--    bundle) can call all five with zero session at all.
--
-- Fix: explicit auth.uid() check (added where missing) + role='cleaner'
-- block (matching migration 087's existing, deliberate boundary — nothing
-- broader/new invented here) in every function body, and REVOKE the stray
-- PUBLIC/anon execute grants so the grant matches what the code intends.

-- ── 1. delete_guest_profile ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.delete_guest_profile(p_guest_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_guest public.guests%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  IF COALESCE(public.get_true_role(), '') = 'cleaner' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  SELECT * INTO v_guest FROM public.guests WHERE id = p_guest_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'guest_not_found');
  END IF;

  UPDATE public.scheduled_tasks
     SET status = 'cancelled',
         cancelled_at = NOW(),
         cancel_reason = 'guest_deleted',
         updated_at = NOW()
   WHERE guest_id = p_guest_id
     AND status = 'pending';

  DELETE FROM public.guests WHERE id = p_guest_id;

  RETURN jsonb_build_object('ok', true, 'phone', v_guest.phone, 'name', v_guest.name);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_guest_profile(BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_guest_profile(BIGINT) TO authenticated;

-- ── 2. match_guest_fuzzy ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.match_guest_fuzzy(p_name TEXT, p_arrival_date DATE DEFAULT NULL)
RETURNS TABLE(id BIGINT, name TEXT, phone TEXT, arrival_date DATE, departure_date DATE, room TEXT, status TEXT, similarity_score REAL)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  IF COALESCE(public.get_true_role(), '') = 'cleaner' THEN
    RETURN;
  END IF;

  IF p_name IS NULL OR trim(p_name) = '' THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    g.id,
    g.name,
    g.phone,
    g.arrival_date,
    g.departure_date,
    g.room,
    g.status,
    similarity(g.name, trim(p_name))::REAL AS similarity_score
  FROM public.guests g
  WHERE g.name IS NOT NULL
    AND trim(g.name) <> ''
    AND (p_arrival_date IS NULL OR g.arrival_date = p_arrival_date)
    AND similarity(g.name, trim(p_name)) > 0.3
  ORDER BY similarity(g.name, trim(p_name)) DESC
  LIMIT 15;
END;
$$;

REVOKE ALL ON FUNCTION public.match_guest_fuzzy(TEXT, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_guest_fuzzy(TEXT, DATE) TO authenticated;

-- ── 3. swap_spa_therapists ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.swap_spa_therapists(p_appt_id_a BIGINT, p_appt_id_b BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_a public.spa_appointments%ROWTYPE;
  v_b public.spa_appointments%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  IF COALESCE(public.get_true_role(), '') = 'cleaner' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  IF p_appt_id_a = p_appt_id_b THEN
    RETURN jsonb_build_object('ok', false, 'error', 'same_appointment');
  END IF;

  SELECT * INTO v_a FROM public.spa_appointments WHERE id = p_appt_id_a FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'appointment_a_not_found');
  END IF;

  SELECT * INTO v_b FROM public.spa_appointments WHERE id = p_appt_id_b FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'appointment_b_not_found');
  END IF;

  -- Deferred only for this transaction — see original migration (177) for why
  -- the naive two-step UPDATE below would otherwise trip the exclusion
  -- constraint.
  SET CONSTRAINTS public.spa_appointments_therapist_no_overlap DEFERRED;

  UPDATE public.spa_appointments SET therapist_id = v_b.therapist_id WHERE id = p_appt_id_a;
  UPDATE public.spa_appointments SET therapist_id = v_a.therapist_id WHERE id = p_appt_id_b;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.swap_spa_therapists(BIGINT, BIGINT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.swap_spa_therapists(BIGINT, BIGINT) TO authenticated;

-- ── 4. suppress_guest_pipeline_stage ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.suppress_guest_pipeline_stage(p_guest_id BIGINT, p_stage_key TEXT, p_reason TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  IF COALESCE(public.get_true_role(), '') = 'cleaner' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  IF p_guest_id IS NULL OR p_stage_key IS NULL OR trim(p_stage_key) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_params');
  END IF;

  INSERT INTO public.guest_pipeline_stage_suppressions (guest_id, stage_key, suppressed_by, reason)
  VALUES (p_guest_id, trim(p_stage_key), auth.uid(), NULLIF(trim(p_reason), ''))
  ON CONFLICT (guest_id, stage_key) DO UPDATE
    SET suppressed_at = NOW(),
        suppressed_by = auth.uid(),
        reason = COALESCE(EXCLUDED.reason, guest_pipeline_stage_suppressions.reason);

  UPDATE public.scheduled_tasks
     SET status = 'cancelled',
         cancelled_at = NOW(),
         cancel_reason = COALESCE(NULLIF(trim(p_reason), ''), 'staff_suppressed'),
         updated_at = NOW()
   WHERE guest_id = p_guest_id
     AND stage_key = trim(p_stage_key)
     AND status = 'pending';

  RETURN jsonb_build_object('ok', true, 'guest_id', p_guest_id, 'stage_key', trim(p_stage_key));
END;
$$;

REVOKE ALL ON FUNCTION public.suppress_guest_pipeline_stage(BIGINT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.suppress_guest_pipeline_stage(BIGINT, TEXT, TEXT) TO authenticated;

-- ── 5. unsuppress_guest_pipeline_stage ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.unsuppress_guest_pipeline_stage(p_guest_id BIGINT, p_stage_key TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  IF COALESCE(public.get_true_role(), '') = 'cleaner' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  DELETE FROM public.guest_pipeline_stage_suppressions
   WHERE guest_id = p_guest_id AND stage_key = trim(p_stage_key);

  RETURN jsonb_build_object('ok', true, 'guest_id', p_guest_id, 'stage_key', trim(p_stage_key));
END;
$$;

REVOKE ALL ON FUNCTION public.unsuppress_guest_pipeline_stage(BIGINT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.unsuppress_guest_pipeline_stage(BIGINT, TEXT) TO authenticated;

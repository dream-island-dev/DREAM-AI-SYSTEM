-- 177_spa_therapist_swap.sql
-- Smart Spa Board — swap therapists between two appointments (staff need to
-- exchange who's assigned to which room without cancelling/recreating).
--
-- A plain two-step UPDATE trips spa_appointments_therapist_no_overlap
-- mid-swap (each therapist briefly looks double-booked against the row not
-- yet updated), even though the *final* state has no conflict. Fix: make
-- that one exclusion constraint DEFERRABLE and defer it only inside
-- swap_spa_therapists() below — normal single INSERT/UPDATE paths
-- (AssignModal) keep the existing immediate check since IMMEDIATE stays the
-- default. Postgres does not support ALTER CONSTRAINT on EXCLUDE
-- constraints, so this drops and re-adds it with the same definition plus
-- DEFERRABLE INITIALLY IMMEDIATE. The room constraint is untouched — room_id
-- never changes during a therapist swap.

ALTER TABLE public.spa_appointments
  DROP CONSTRAINT spa_appointments_therapist_no_overlap;

ALTER TABLE public.spa_appointments
  ADD CONSTRAINT spa_appointments_therapist_no_overlap
  EXCLUDE USING gist (therapist_id WITH =, appointment_range WITH &&)
  WHERE (status <> 'cancelled' AND therapist_id IS NOT NULL)
  DEFERRABLE INITIALLY IMMEDIATE;

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

  -- Deferred only for this transaction — see file header for why the naive
  -- two-step UPDATE below would otherwise trip the exclusion constraint.
  SET CONSTRAINTS public.spa_appointments_therapist_no_overlap DEFERRED;

  UPDATE public.spa_appointments SET therapist_id = v_b.therapist_id WHERE id = p_appt_id_a;
  UPDATE public.spa_appointments SET therapist_id = v_a.therapist_id WHERE id = p_appt_id_b;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.swap_spa_therapists(BIGINT, BIGINT) TO authenticated;

COMMENT ON FUNCTION public.swap_spa_therapists(BIGINT, BIGINT) IS
  'Atomically exchanges therapist_id between two spa_appointments rows. A real remaining conflict (e.g. the swap would double-book against a third row) surfaces at commit as SQLSTATE 23P01 — the same code the client already maps to the FAIL VISIBLE conflict message in AssignModal.';

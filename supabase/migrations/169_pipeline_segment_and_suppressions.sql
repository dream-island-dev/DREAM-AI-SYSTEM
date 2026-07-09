-- 169_pipeline_segment_and_suppressions.sql
-- 1) Re-assert applies_to on bifurcated stages (fixes Live Queue showing BOTH pipelines).
-- 2) Per-guest stage suppression (staff cancel from ACC).

-- ── 1. Enforce suite / day-pass applies_to (idempotent) ─────────────────────
UPDATE public.automation_stages
SET applies_to = 'suite'
WHERE stage_key IN ('night_before', 'morning_suite', 'mid_stay', 'checkout_fb', 'butler_1h')
  AND applies_to <> 'suite';

UPDATE public.automation_stages
SET applies_to = 'non_suite'
WHERE stage_key IN (
  'night_before_daypass', 'morning_welcome', 'mid_stay_daypass', 'checkout_fb_daypass'
)
AND applies_to <> 'non_suite';

-- ── 2. Per-guest pipeline stage suppressions ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.guest_pipeline_stage_suppressions (
  guest_id     BIGINT NOT NULL REFERENCES public.guests(id) ON DELETE CASCADE,
  stage_key    TEXT NOT NULL,
  suppressed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  suppressed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reason       TEXT,
  PRIMARY KEY (guest_id, stage_key)
);

CREATE INDEX IF NOT EXISTS idx_guest_pipeline_suppressions_guest
  ON public.guest_pipeline_stage_suppressions (guest_id);

ALTER TABLE public.guest_pipeline_stage_suppressions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS guest_pipeline_suppressions_auth ON public.guest_pipeline_stage_suppressions;
CREATE POLICY guest_pipeline_suppressions_auth ON public.guest_pipeline_stage_suppressions
  FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

COMMENT ON TABLE public.guest_pipeline_stage_suppressions IS
  'Staff-cancelled automation stages per guest — cron/queue skip until unsuppressed.';

CREATE OR REPLACE FUNCTION public.suppress_guest_pipeline_stage(
  p_guest_id BIGINT,
  p_stage_key TEXT,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
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

CREATE OR REPLACE FUNCTION public.unsuppress_guest_pipeline_stage(
  p_guest_id BIGINT,
  p_stage_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.guest_pipeline_stage_suppressions
   WHERE guest_id = p_guest_id AND stage_key = trim(p_stage_key);

  RETURN jsonb_build_object('ok', true, 'guest_id', p_guest_id, 'stage_key', trim(p_stage_key));
END;
$$;

GRANT EXECUTE ON FUNCTION public.suppress_guest_pipeline_stage(BIGINT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unsuppress_guest_pipeline_stage(BIGINT, TEXT) TO authenticated;

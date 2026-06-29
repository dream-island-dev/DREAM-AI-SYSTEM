-- =============================================================================
-- 104_scheduled_tasks_manual_override.sql
-- Materialized pending schedules for Smart Dispatch Override + duplication guard.
-- Populated from automation-queue projection (client sync). Cron still uses
-- resolveStageSchedule — this table is the staff-facing cancellation ledger.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.scheduled_tasks (
  id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  guest_id       BIGINT NOT NULL REFERENCES public.guests(id) ON DELETE CASCADE,
  stage_key      TEXT NOT NULL,
  scheduled_for  TIMESTAMPTZ NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'cancelled', 'dispatched')),
  cancelled_at   TIMESTAMPTZ,
  cancel_reason  TEXT,
  dispatched_at  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_scheduled_tasks_guest_stage_pending
  ON public.scheduled_tasks (guest_id, stage_key)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_status_scheduled
  ON public.scheduled_tasks (status, scheduled_for);

ALTER TABLE public.scheduled_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS scheduled_tasks_auth ON public.scheduled_tasks;
CREATE POLICY scheduled_tasks_auth ON public.scheduled_tasks
  FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- ── Sync pending rows from queue projection (best-effort, idempotent) ────────
CREATE OR REPLACE FUNCTION public.upsert_scheduled_tasks_batch(p_tasks JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_task JSONB;
  v_count INTEGER := 0;
  v_guest_id BIGINT;
  v_stage_key TEXT;
  v_scheduled_for TIMESTAMPTZ;
BEGIN
  IF p_tasks IS NULL OR jsonb_typeof(p_tasks) <> 'array' THEN
    RETURN 0;
  END IF;

  FOR v_task IN SELECT * FROM jsonb_array_elements(p_tasks)
  LOOP
    v_guest_id := (v_task->>'guest_id')::bigint;
    v_stage_key := v_task->>'stage_key';
    v_scheduled_for := (v_task->>'scheduled_for')::timestamptz;

    IF v_guest_id IS NULL OR v_stage_key IS NULL OR v_scheduled_for IS NULL THEN
      CONTINUE;
    END IF;

    UPDATE public.scheduled_tasks
       SET scheduled_for = v_scheduled_for,
           updated_at = NOW()
     WHERE guest_id = v_guest_id
       AND stage_key = v_stage_key
       AND status = 'pending';

    IF NOT FOUND THEN
      BEGIN
        INSERT INTO public.scheduled_tasks (guest_id, stage_key, scheduled_for, status)
        VALUES (v_guest_id, v_stage_key, v_scheduled_for, 'pending');
      EXCEPTION WHEN unique_violation THEN
        NULL;
      END;
    END IF;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- ── Cancel pending schedule before manual override send ──────────────────────
CREATE OR REPLACE FUNCTION public.cancel_scheduled_task_for_override(
  p_guest_id BIGINT,
  p_stage_key TEXT,
  p_scheduled_for TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.scheduled_tasks%ROWTYPE;
BEGIN
  UPDATE public.scheduled_tasks
     SET status = 'cancelled',
         cancelled_at = NOW(),
         cancel_reason = 'manual_override',
         updated_at = NOW()
   WHERE guest_id = p_guest_id
     AND stage_key = p_stage_key
     AND status = 'pending'
  RETURNING * INTO v_row;

  IF v_row.id IS NULL AND p_scheduled_for IS NOT NULL THEN
    INSERT INTO public.scheduled_tasks (
      guest_id, stage_key, scheduled_for, status, cancelled_at, cancel_reason
    ) VALUES (
      p_guest_id, p_stage_key, p_scheduled_for, 'cancelled', NOW(), 'manual_override'
    );
    RETURN jsonb_build_object('ok', true, 'cancelled', true, 'source', 'audit_insert');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'cancelled', v_row.id IS NOT NULL,
    'task_id', v_row.id
  );
END;
$$;

-- ── Mark dispatched after successful manual override ─────────────────────────
CREATE OR REPLACE FUNCTION public.mark_scheduled_task_dispatched(
  p_guest_id BIGINT,
  p_stage_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.scheduled_tasks%ROWTYPE;
BEGIN
  UPDATE public.scheduled_tasks
     SET status = 'dispatched',
         dispatched_at = NOW(),
         updated_at = NOW()
   WHERE guest_id = p_guest_id
     AND stage_key = p_stage_key
     AND status IN ('pending', 'cancelled')
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('ok', true, 'updated', v_row.id IS NOT NULL);
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_scheduled_tasks_batch(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_scheduled_task_for_override(BIGINT, TEXT, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_scheduled_task_dispatched(BIGINT, TEXT) TO authenticated;

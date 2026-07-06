-- =============================================================================
-- 148_staff_scheduled_tasks.sql
-- Staff-authored schedules from ACC Live Queue — must not be overwritten by
-- auto-sync from automation-queue projection. Cron dispatches when due.
-- =============================================================================

ALTER TABLE public.scheduled_tasks
  ADD COLUMN IF NOT EXISTS staff_scheduled BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.scheduled_tasks.staff_scheduled IS
  'true = set by staff via ACC bulk schedule; auto queue-sync must not overwrite.';

-- Auto-sync (queue refresh) — skip staff-owned rows
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
       AND status = 'pending'
       AND staff_scheduled = false;

    IF NOT FOUND THEN
      BEGIN
        INSERT INTO public.scheduled_tasks (guest_id, stage_key, scheduled_for, status, staff_scheduled)
        VALUES (v_guest_id, v_stage_key, v_scheduled_for, 'pending', false);
      EXCEPTION WHEN unique_violation THEN
        NULL;
      END;
    END IF;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- Staff bulk schedule from ACC — Israel-local date + HH:MM → timestamptz
CREATE OR REPLACE FUNCTION public.staff_schedule_tasks_batch(p_tasks JSONB)
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
  v_date TEXT;
  v_time TEXT;
  v_scheduled_for TIMESTAMPTZ;
BEGIN
  IF p_tasks IS NULL OR jsonb_typeof(p_tasks) <> 'array' THEN
    RETURN 0;
  END IF;

  FOR v_task IN SELECT * FROM jsonb_array_elements(p_tasks)
  LOOP
    v_guest_id := (v_task->>'guest_id')::bigint;
    v_stage_key := v_task->>'stage_key';
    v_date := NULLIF(trim(v_task->>'schedule_date'), '');
    v_time := NULLIF(trim(v_task->>'schedule_time'), '');

    IF v_guest_id IS NULL OR v_stage_key IS NULL OR v_date IS NULL OR v_time IS NULL THEN
      CONTINUE;
    END IF;

    v_scheduled_for := (
      (v_date::date + v_time::time) AT TIME ZONE 'Asia/Jerusalem'
    );

    UPDATE public.scheduled_tasks
       SET scheduled_for = v_scheduled_for,
           staff_scheduled = true,
           updated_at = NOW()
     WHERE guest_id = v_guest_id
       AND stage_key = v_stage_key
       AND status = 'pending';

    IF NOT FOUND THEN
      BEGIN
        INSERT INTO public.scheduled_tasks (
          guest_id, stage_key, scheduled_for, status, staff_scheduled
        ) VALUES (
          v_guest_id, v_stage_key, v_scheduled_for, 'pending', true
        );
      EXCEPTION WHEN unique_violation THEN
        UPDATE public.scheduled_tasks
           SET scheduled_for = v_scheduled_for,
               staff_scheduled = true,
               updated_at = NOW()
         WHERE guest_id = v_guest_id
           AND stage_key = v_stage_key
           AND status = 'pending';
      END;
    END IF;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.staff_schedule_tasks_batch(JSONB) TO authenticated;

-- 284: Staff-scheduled spa upsell — pin Meta template name per row (spa_upsell_daypass1 etc.).

ALTER TABLE public.scheduled_tasks
  ADD COLUMN IF NOT EXISTS wa_template_name TEXT;

COMMENT ON COLUMN public.scheduled_tasks.wa_template_name IS
  'Optional Meta template override for staff-scheduled spa_upsell_daypass (whatsapp-send waTemplateName).';

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
  v_force_channel TEXT;
  v_wa_template_name TEXT;
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
    v_force_channel := NULLIF(trim(v_task->>'force_channel'), '');
    v_wa_template_name := NULLIF(trim(v_task->>'wa_template_name'), '');

    IF v_guest_id IS NULL OR v_stage_key IS NULL OR v_date IS NULL OR v_time IS NULL THEN
      CONTINUE;
    END IF;

    v_scheduled_for := (
      (v_date::date + v_time::time) AT TIME ZONE 'Asia/Jerusalem'
    );

    UPDATE public.scheduled_tasks
       SET scheduled_for = v_scheduled_for,
           staff_scheduled = true,
           force_channel = v_force_channel,
           wa_template_name = v_wa_template_name,
           updated_at = NOW()
     WHERE guest_id = v_guest_id
       AND stage_key = v_stage_key
       AND status = 'pending';

    IF NOT FOUND THEN
      BEGIN
        INSERT INTO public.scheduled_tasks (
          guest_id, stage_key, scheduled_for, status, staff_scheduled, force_channel, wa_template_name
        ) VALUES (
          v_guest_id, v_stage_key, v_scheduled_for, 'pending', true, v_force_channel, v_wa_template_name
        );
      EXCEPTION WHEN unique_violation THEN
        UPDATE public.scheduled_tasks
           SET scheduled_for = v_scheduled_for,
               staff_scheduled = true,
               force_channel = v_force_channel,
               wa_template_name = v_wa_template_name,
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

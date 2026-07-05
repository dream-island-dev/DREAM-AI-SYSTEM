-- Reset msg_stage_2_arrival_sent when guest confirmed but Stage 2 never actually sent.
-- Old staff-claim bug could set the flag without a successful Meta send; cron reconcile
-- only queues guests with msg_stage_2_arrival_sent = false.

UPDATE public.guests g
SET msg_stage_2_arrival_sent = false
WHERE g.arrival_confirmed = true
  AND g.msg_stage_2_arrival_sent = true
  AND g.status IS DISTINCT FROM 'cancelled'
  AND NOT EXISTS (
    SELECT 1
    FROM public.notification_log nl
    WHERE nl.guest_id = g.id
      AND nl.trigger_type = 'stage_2_arrival'
      AND nl.status IN ('sent', 'simulated')
  );

DO $$
DECLARE
  v_bad integer;
BEGIN
  SELECT count(*)::integer INTO v_bad
  FROM public.guests g
  WHERE g.arrival_confirmed = true
    AND g.msg_stage_2_arrival_sent = true
    AND g.status IS DISTINCT FROM 'cancelled'
    AND NOT EXISTS (
      SELECT 1 FROM public.notification_log nl
      WHERE nl.guest_id = g.id
        AND nl.trigger_type = 'stage_2_arrival'
        AND nl.status IN ('sent', 'simulated')
    );
  IF v_bad > 0 THEN
    RAISE EXCEPTION '138_self_test: % guests still have false-positive msg_stage_2_arrival_sent', v_bad;
  END IF;
END $$;

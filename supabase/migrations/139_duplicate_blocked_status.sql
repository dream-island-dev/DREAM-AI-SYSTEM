-- 139_duplicate_blocked_status.sql
-- Automation duplicate shield — log intercepted re-sends as duplicate_blocked
-- (FAIL VISIBLE in Automation History + Live Queue attention).

ALTER TABLE public.notification_log DROP CONSTRAINT IF EXISTS notification_log_status_check;

ALTER TABLE public.notification_log
  ADD CONSTRAINT notification_log_status_check
  CHECK (status IN (
    'sent', 'simulated', 'failed', 'timeout', 'blocked_by_meta',
    'processing', 'failed_missing_link', 'duplicate_blocked'
  ));

COMMENT ON COLUMN public.notification_log.status IS
  'sent/simulated=confirmed. duplicate_blocked=automation guard intercepted a repeat send for the same guest+stage. failed/timeout=error. blocked_by_meta=template pending. processing=in-flight. failed_missing_link=Stage 2 Pay aborted.';

DO $$
DECLARE
  v_def TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conrelid = 'public.notification_log'::regclass
     AND conname = 'notification_log_status_check';

  IF v_def NOT LIKE '%duplicate_blocked%' THEN
    RAISE EXCEPTION '139_self_test: notification_log_status_check missing duplicate_blocked — got: %', v_def;
  END IF;
END $$;

-- 301_spa_appointments_ezgo_activity_key.sql
-- Live EZGO Activities webhook → spa board. CSV import seeds rooms/names;
-- API events upsert times/status/therapist using a stable ItemId:Index key.

ALTER TABLE public.spa_appointments
  ADD COLUMN IF NOT EXISTS ezgo_activity_key TEXT;

ALTER TABLE public.spa_appointments
  ADD COLUMN IF NOT EXISTS ezgo_order_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_spa_appointments_ezgo_activity_key
  ON public.spa_appointments (ezgo_activity_key)
  WHERE ezgo_activity_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_spa_appointments_ezgo_order_id
  ON public.spa_appointments (ezgo_order_id)
  WHERE ezgo_order_id IS NOT NULL;

COMMENT ON COLUMN public.spa_appointments.ezgo_activity_key IS
  'EZGO Activities ItemId:Timing.Index — stable across time/worker edits so the live webhook can UPDATE instead of duplicating.';
COMMENT ON COLUMN public.spa_appointments.ezgo_order_id IS
  'EZGO OrderId on the activity (and optional CSV iOrderId) — used to match a board row before the activity key is stamped.';

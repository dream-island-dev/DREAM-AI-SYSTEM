-- 205_whapi_failover_daypass_meta.sql
-- P0 (2026-07-14): Whapi banned again — Dream Bot full guest outbound + health
-- failover keys in bot_config (ACC-editable, no CLI for routine SOS).
-- Day-pass spa cohort permanently on Meta (never Whapi automation burst).

INSERT INTO public.bot_config (config_key, config_value, category, label)
VALUES
  ('whapi_guest_sos_active',  'true',  'general', 'SOS ידני — כל האורחים דרך Dream Bot'),
  ('whapi_auto_failover',     'true',  'general', 'Failover אוטומטי ל-Meta כש-Whapi לא AUTH'),
  ('whapi_device_status',     'UNKNOWN', 'general', 'סטטוס מכשיר Whapi (AUTH/LAUNCH/STOP)'),
  ('whapi_device_healthy',    'false', 'general', 'Whapi בריא (true/false)'),
  ('whapi_device_checked_at', '',      'general', 'בדיקת Whapi אחרונה')
ON CONFLICT (config_key) DO UPDATE SET
  config_value = EXCLUDED.config_value,
  label        = EXCLUDED.label;

-- Day-pass automation → Dream Bot only (spa/survey never via physical device).
UPDATE public.bot_config
SET config_value = 'meta'
WHERE config_key = 'guest_daypass_channel';

COMMENT ON TABLE public.bot_config IS
  'KV settings for bot + automation. whapi_* keys drive ACC Pulse failover (migration 205).';

-- 275: Whapi ban — lock suite automation to Dream Bot (Meta) + SOS manual active.
-- Idempotent upsert; safe to re-run. Does NOT touch whapi_auto_failover (stays on).

INSERT INTO public.bot_config (config_key, config_value, category, description)
VALUES
  ('guest_suites_channel', 'meta', 'general', 'ערוץ אורחי סוויטות (whapi / meta)'),
  ('whapi_guest_sos_active', 'true', 'general', 'SOS ידני — כל האורחים דרך Dream Bot')
ON CONFLICT (config_key) DO UPDATE SET
  config_value = EXCLUDED.config_value,
  description = EXCLUDED.description,
  updated_at = NOW();

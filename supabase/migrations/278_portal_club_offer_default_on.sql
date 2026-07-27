-- 278: Portal-first guest club — enable portal offer by default (WA remains backup via #club).

UPDATE public.bot_config
SET config_value = jsonb_set(
  COALESCE(config_value::jsonb, '{}'::jsonb),
  '{portal_offer_enabled}',
  'true'::jsonb,
  true
)
WHERE config_key = 'guest_club_wa_settings'
  AND (config_value::jsonb ->> 'portal_offer_enabled') IS DISTINCT FROM 'true';

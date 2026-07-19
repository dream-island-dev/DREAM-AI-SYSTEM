-- 258: Point Armonim kiosk «תפריט באתר» to the live menu page.

UPDATE public.bot_config
SET config_value = jsonb_set(
  COALESCE(config_value, '{}'::jsonb),
  '{external_menu_url}',
  to_jsonb('https://armmonim.co.il/תפריט/'::text)
)
WHERE config_key = 'restaurant_kiosk_ui';

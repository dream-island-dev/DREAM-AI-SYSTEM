-- 262: shift-manager kiosk PIN (bot_config.restaurant_kiosk_ui) is super_admin-only to set.
-- Base bot_config_write policy (migration 015) already lets admin OR super_admin write any
-- bot_config row. This adds a RESTRICTIVE policy narrowing writes to config_key =
-- 'restaurant_kiosk_ui' down to super_admin only, without touching the base policy for every
-- other key. SELECT is untouched — the kiosk shift gate (RestaurantShiftContext.loadKioskUi)
-- still needs to read shift_manager_pin client-side to validate the PIN entered at login.

DROP POLICY IF EXISTS bot_config_restaurant_kiosk_ui_super_admin_insert ON public.bot_config;
CREATE POLICY bot_config_restaurant_kiosk_ui_super_admin_insert ON public.bot_config
  AS RESTRICTIVE
  FOR INSERT
  WITH CHECK (
    config_key <> 'restaurant_kiosk_ui'
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'super_admin'
    )
  );

DROP POLICY IF EXISTS bot_config_restaurant_kiosk_ui_super_admin_update ON public.bot_config;
CREATE POLICY bot_config_restaurant_kiosk_ui_super_admin_update ON public.bot_config
  AS RESTRICTIVE
  FOR UPDATE
  USING (
    config_key <> 'restaurant_kiosk_ui'
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'super_admin'
    )
  )
  WITH CHECK (
    config_key <> 'restaurant_kiosk_ui'
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'super_admin'
    )
  );

DROP POLICY IF EXISTS bot_config_restaurant_kiosk_ui_super_admin_delete ON public.bot_config;
CREATE POLICY bot_config_restaurant_kiosk_ui_super_admin_delete ON public.bot_config
  AS RESTRICTIVE
  FOR DELETE
  USING (
    config_key <> 'restaurant_kiosk_ui'
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'super_admin'
    )
  );

COMMENT ON POLICY bot_config_restaurant_kiosk_ui_super_admin_update ON public.bot_config IS
  'Shift-manager kiosk PIN (Armonim) is super_admin-only to change — set from User Management tab, not the general admin BotConfigPanel.';

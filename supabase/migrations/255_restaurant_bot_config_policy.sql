-- Restaurant role may edit restaurant_dinner_messages bot_config (same as restaurant_access staff).

DROP POLICY IF EXISTS bot_config_restaurant_dinner_messages_write ON public.bot_config;

CREATE POLICY bot_config_restaurant_dinner_messages_write ON public.bot_config
  FOR ALL
  USING (
    config_key = 'restaurant_dinner_messages'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (
          p.role = 'restaurant'
          OR p.restaurant_access = true
          OR p.role IN ('admin', 'super_admin', 'manager')
        )
    )
  )
  WITH CHECK (
    config_key = 'restaurant_dinner_messages'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (
          p.role = 'restaurant'
          OR p.restaurant_access = true
          OR p.role IN ('admin', 'super_admin', 'manager')
        )
    )
  );

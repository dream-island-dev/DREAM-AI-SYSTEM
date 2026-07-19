-- Editable default WA copy for Restaurant Dinner Board (ask / confirm / custom).

INSERT INTO bot_config (config_key, config_value, category, label)
VALUES (
  'restaurant_dinner_messages',
  '{
    "ask_template": "{{greeting}} 🍽️\nלמתי תרצו לקבוע את ארוחת הערב ב{{location}}?\nאפשר {{slots}} — או כתבו לנו שעה אחרת שמתאימה לכם.\nתודה!",
    "ask_template_no_slots": "{{greeting}} 🍽️\nלמתי תרצו לקבוע את ארוחת הערב ב{{location}}?\nכתבו לנו שעה שמתאימה לכם — נשמח לתאם.\nתודה!",
    "confirm_template": "{{greeting}} 🍽️\nשמרנו לכם שולחן לארוחת ערב ב-{{time}} ב{{location}}.\nנתראה!",
    "confirm_template_no_time": "{{greeting}} 🍽️\nשמרנו לכם שולחן לארוחת ערב ב{{location}}.\nנתראה!",
    "custom_template": "{{greeting}} 🍽️\n",
    "offer_slots": ["19:00", "19:30", "20:00", "20:30"],
    "default_ask_slots": ["19:00", "19:30", "20:00"]
  }',
  'general',
  'נוסחי וואטסאפ — לוח ערב מסעדה (JSON)'
)
ON CONFLICT (config_key) DO NOTHING;

-- Restaurant staff + managers may edit only this config key (per-send overrides stay local).
CREATE POLICY bot_config_restaurant_dinner_messages_write ON public.bot_config
  FOR ALL
  USING (
    config_key = 'restaurant_dinner_messages'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (
          p.restaurant_access = true
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
          p.restaurant_access = true
          OR p.role IN ('admin', 'super_admin', 'manager')
        )
    )
  );

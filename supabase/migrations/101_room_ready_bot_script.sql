-- =============================================================================
-- 101_room_ready_bot_script.sql
-- Session 60 — Room Ready session-message script + template name fix.
--
-- Seeds bot_scripts row 'room_ready_reminder' for the 24h-session free-text
-- path in the room_ready fast-path (whatsapp-send/index.ts).
--
-- Dispatch logic (whatsapp-send BRANCH D room_ready fast-path):
--   Last inbound < 24h (session open)  → free text from this row
--   Last inbound ≥ 24h / never replied → Meta template dream_room_ready1
--
-- {{GUEST_NAME}} and {{ROOM_NAME}} are substituted server-side.
-- Editable via BotScriptEditor (trigger_event = 'room_ready').
-- =============================================================================

INSERT INTO public.bot_scripts
  (script_key, display_name, trigger_event, is_meta_template,
   meta_template_name, message_text, ai_system_prompt, sort_order, is_active)
VALUES
(
  'room_ready_reminder',
  'חדר מוכן — הודעה חופשית (חלון 24ש)',
  'room_ready',
  false,
  'dream_room_ready1',
  E'שלום {{GUEST_NAME}}! 🏨✨\n\nהחדר שלכם מוכן ומחכה לכם!\n🔑 {{ROOM_NAME}}\n\nתוכלו לבצע צ׳ק-אין בקבלה בכל עת.\nמחכים לכם באהבה — צוות Dream Island 🤍',
  null,
  20,
  true
)
ON CONFLICT (script_key) DO UPDATE
  SET
    display_name       = EXCLUDED.display_name,
    trigger_event      = EXCLUDED.trigger_event,
    is_meta_template   = EXCLUDED.is_meta_template,
    meta_template_name = EXCLUDED.meta_template_name,
    message_text       = EXCLUDED.message_text,
    sort_order         = EXCLUDED.sort_order,
    is_active          = EXCLUDED.is_active;

-- Inline self-test
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.bot_scripts
    WHERE script_key = 'room_ready_reminder' AND is_active = true
  ) THEN
    RAISE EXCEPTION '101_self_test: room_ready_reminder bot_script missing or inactive';
  END IF;

  IF (SELECT message_text FROM public.bot_scripts WHERE script_key = 'room_ready_reminder')
       NOT LIKE '%{{GUEST_NAME}}%' THEN
    RAISE EXCEPTION '101_self_test: room_ready_reminder message_text missing {{GUEST_NAME}} placeholder';
  END IF;

  IF (SELECT message_text FROM public.bot_scripts WHERE script_key = 'room_ready_reminder')
       NOT LIKE '%{{ROOM_NAME}}%' THEN
    RAISE EXCEPTION '101_self_test: room_ready_reminder message_text missing {{ROOM_NAME}} placeholder';
  END IF;
END $$;

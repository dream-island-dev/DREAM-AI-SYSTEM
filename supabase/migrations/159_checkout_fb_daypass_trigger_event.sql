-- 159_checkout_fb_daypass_trigger_event.sql
-- checkout_fb_daypass was seeded (migration 099) with trigger_event='ongoing' by
-- mistake. 'ongoing' is reserved for the AI persona row (ongoing_concierge), whose
-- message_text is unused — so BotScriptEditor.js disables the message_text textarea
-- for every 'ongoing' row and shows "לא רלוונטי — הודעה זו לא שולחת טקסט ישיר".
-- But this script's text IS sent to day-pass guests (whatsapp-send's hybrid session
-- fallback looks it up by script_key, never by trigger_event) — staff just couldn't
-- edit it. Label-only fix: align with the suite sibling (checkout_fb). No routing
-- change; bot_scripts.trigger_event has no CHECK constraint (migration 032).

UPDATE bot_scripts
SET trigger_event = 'checkout_fb'
WHERE script_key = 'checkout_fb_daypass'
  AND trigger_event = 'ongoing';

DO $$
DECLARE
  v_te text;
BEGIN
  SELECT trigger_event INTO v_te
  FROM bot_scripts
  WHERE script_key = 'checkout_fb_daypass';

  IF v_te IS DISTINCT FROM 'checkout_fb' THEN
    RAISE EXCEPTION '159_self_test: checkout_fb_daypass trigger_event is %, expected checkout_fb', v_te;
  END IF;
END $$;

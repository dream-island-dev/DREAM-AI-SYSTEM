-- 167_greeting_reply_bot_script.sql
-- (Renumbered from a locally-drafted 161 — that number was already taken by
-- the committed/applied 161_whatsapp_conversations_channel.sql; a version
-- collision means this file was never actually pushed. No content change.)
--
-- Tier-0 greeting opener for whatsapp-webhook (היי / שלום / hi).
-- Previously misclassified as courtesy → silent exit with zero guest reply.
--
-- Also widens the intent CHECK for whapi-webhook's guest-DM auto-reply
-- (FAIL VISIBLE stamps on the two paths that previously left the inbound
-- row's intent at "received" with no clue why no reply was sent):
--   'captured_no_autoreply' — feature disabled / guest inactive / no guest match
--   'admin_personal_dm'     — sender is an ADMIN_WHITELIST staff number, not a guest

INSERT INTO public.bot_scripts
  (script_key, display_name, trigger_event, is_meta_template, meta_template_name, message_text, ai_system_prompt, sort_order)
VALUES
(
  'greeting_reply',
  'ברכת פתיחה — היי / שלום',
  'ongoing',
  false,
  null,
  E'שלום {{GUEST_NAME}}! \U0001F60A ברוכים הבאים ל-Dream Island. במה אוכל לעזור לכם היום?',
  null,
  5
)
ON CONFLICT (script_key) DO NOTHING;

-- Allow intent='greeting' on whatsapp_conversations (Tier-0 opener path).
DO $$
DECLARE
  v_conname TEXT;
BEGIN
  SELECT c.conname INTO v_conname
  FROM pg_constraint c
  JOIN pg_class t      ON t.oid = c.conrelid
  JOIN pg_attribute a  ON a.attrelid = t.oid
  WHERE t.relname = 'whatsapp_conversations'
    AND c.contype = 'c'
    AND a.attname = 'intent'
    AND a.attnum = ANY (c.conkey)
  LIMIT 1;

  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.whatsapp_conversations DROP CONSTRAINT %I', v_conname);
  END IF;
END $$;

ALTER TABLE public.whatsapp_conversations
  ADD CONSTRAINT whatsapp_conversations_intent_check
  CHECK (
    intent IS NULL OR intent IN (
      'complaint', 'upsell', 'faq', 'fallback',
      'severe_complaint', 'sensitive_stay_change_request', 'sensitive_financial_request',
      'date_change_request', 'arrival_time_update',
      'administrative_in_house_request', 'operational_in_house_request',
      'button_reply', 'confirmation', 'arrival_confirmed', 'received',
      'guest_feedback',
      'courtesy_ack', 'auto_away_message', 'check_in_policy_faq', 'balloon_room_request', 'stage_2_pay',
      'guest_reaction',
      'media_received',
      'greeting',
      'captured_no_autoreply',
      'admin_personal_dm'
    )
  );

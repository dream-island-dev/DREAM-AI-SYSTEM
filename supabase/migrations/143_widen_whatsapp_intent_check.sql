-- Migration 143: whatsapp_conversations.intent — widen CHECK again (session 124e).
-- Webhook paths write these intents on inbound patch + outbound insert; a missing
-- value causes silent UPDATE/INSERT failure — staff sees no new Inbox rows even
-- though Meta delivered the webhook (FAIL VISIBLE root cause, migration 116/117).

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
      'button_reply', 'confirmation', 'received',
      'guest_feedback',
      'courtesy_ack', 'check_in_policy_faq', 'balloon_room_request', 'stage_2_pay'
    )
  );

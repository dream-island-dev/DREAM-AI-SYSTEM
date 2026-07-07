-- Migration 157: Fix silent Stage 2 arrival-confirmation logging failure (session 141).
--
-- Root cause: whatsapp-webhook's handleStage2ArrivalConfirmation() writes
-- intent:"arrival_confirmed" to whatsapp_conversations for BUTTON-tap-sourced
-- confirmations (the overwhelming majority of real guest confirmations) —
-- but that value was never added to whatsapp_conversations_intent_check
-- (only its sibling "confirmation", used for the rarer typed-text path, was
-- allowed). Every button-tap Stage 2 arrival reply since commit 48e2314
-- (2026-07-04, session 104b) has been sent to the guest successfully via Meta
-- (notification_log confirms status='sent') but silently failed to insert
-- into whatsapp_conversations — insertGuestOutboundIfNotMuted() catches and
-- logs the constraint-violation error but does not surface it to the caller,
-- so guests.msg_stage_2_arrival_sent still got set true. Net effect: Stage 2
-- was invisible in the staff Inbox (WhatsAppInbox.js) for ~95% of real
-- confirmations even though delivery itself worked. Verified against
-- notification_log vs whatsapp_conversations for the last 10 days:
-- 125 stage_2_arrival "sent" rows, only 9 logged (all "confirmation"/text,
-- zero "arrival_confirmed"/button).
--
-- Also adds 'auto_away_message' for the new guest-own-WhatsApp-Business-
-- away-message Defensive Shield check (_shared/automationSchedule.ts
-- isAutoAwayMessage / whatsapp-webhook handleAutoAwayMessage, same session).

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
      'media_received'
    )
  );

-- NOTE: historical Stage 2 sends that hit the old constraint (2026-07-04 to
-- now) were delivered to guests successfully (notification_log status='sent')
-- but are still missing from whatsapp_conversations — this migration does not
-- backfill them. That is a separate, explicit decision (bulk-inserting
-- synthetic rows into a live audit table) left for Mike to request if wanted.

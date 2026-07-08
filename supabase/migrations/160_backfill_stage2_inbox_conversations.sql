-- Migration 160: Backfill whatsapp_conversations for stage_2_arrival sends that
-- reached guests (notification_log status sent/simulated) but never landed in
-- the staff Inbox.
--
-- Root causes (see migration 157 comments + whatsapp-send stage_2 fast-path):
--   1. intent:"arrival_confirmed" violated whatsapp_conversations_intent_check
--      until migration 157 — Meta send succeeded, INSERT failed silently.
--   2. whatsapp-send stage_2_arrival fast-path logged notification_log only,
--      not whatsapp_conversations (cron reconcile / pipeline fallback).
--
-- Reconstructs inbox text from bot_scripts.stage_2_arrival with basic guest
-- placeholders so WhatsAppInbox.js can display WYSIWYG-ish history.

INSERT INTO public.whatsapp_conversations (phone, guest_id, direction, message, intent, created_at)
SELECT
  CASE
    WHEN regexp_replace(g.phone, '\D', '', 'g') ~ '^0'
      THEN '972' || substring(regexp_replace(g.phone, '\D', '', 'g') FROM 2)
    ELSE regexp_replace(g.phone, '\D', '', 'g')
  END AS phone,
  nl.guest_id,
  'outbound',
  '[SESSION]' || E'\n' || left(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            COALESCE(bs.message_text,
              'שלב 2 — אישור הגעה (הודעה נשלחה; שוחזר מ-notification_log)'),
            '\{\{\s*GUEST_NAME\s*\}\}', COALESCE(NULLIF(trim(g.name), ''), 'אורח יקר'), 'gi'),
          '\{\{\s*guest_name\s*\}\}', COALESCE(NULLIF(trim(g.name), ''), 'אורח יקר'), 'gi'),
        '\{\{\s*portal_url\s*\}\}',
        CASE WHEN g.portal_token IS NOT NULL
          THEN 'https://dream-ai-system.vercel.app/portal/' || g.portal_token::text
          ELSE '' END, 'gi'),
      '\{\{[^}]+\}\}', '', 'g'),
    4000),
  CASE
    WHEN coalesce(nl.payload->>'source', '') = 'button' THEN 'arrival_confirmed'
    ELSE 'confirmation'
  END,
  nl.sent_at
FROM public.notification_log nl
JOIN public.guests g ON g.id = nl.guest_id
LEFT JOIN public.bot_scripts bs ON bs.script_key = 'stage_2_arrival'
WHERE nl.trigger_type = 'stage_2_arrival'
  AND nl.status IN ('sent', 'simulated')
  AND nl.guest_id IS NOT NULL
  AND g.phone IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.whatsapp_conversations wc
    WHERE wc.guest_id = nl.guest_id
      AND wc.direction = 'outbound'
      AND wc.created_at BETWEEN nl.sent_at - interval '10 minutes'
                          AND nl.sent_at + interval '2 hours'
      AND (
        wc.intent IN ('arrival_confirmed', 'confirmation')
        OR wc.message LIKE '[SESSION]%'
        OR wc.message ILIKE '%dream-ai-system.vercel.app/portal/%'
      )
  );

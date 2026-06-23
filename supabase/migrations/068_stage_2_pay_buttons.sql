-- =============================================================================
-- 068_stage_2_pay_buttons.sql
-- Stage 2 Pay — real payment button + spa-time injection.
--
-- WHY:
--   Stage 2 Pay (migration 067) sends a plain-text reply with the payment
--   link and workshop link both inlined as plain text, and never mentions
--   spa time at all. This migration seeds the ONE field needed to turn the
--   payment link into a real tappable WhatsApp button (Meta's "cta_url"
--   interactive type — the only free-form/non-template way to get a
--   genuinely tappable URL button) via the paired whatsapp-webhook/index.ts
--   change (sendStage2PayReply): automation_stages.interactive_buttons.
--
--   The workshop link deliberately stays a plain inline text link, not a
--   second button — WhatsApp's API does not support two real URL buttons in
--   a non-template message, and the payment link is the revenue-critical
--   action. This is the hybrid approach the resort owner explicitly chose.
--
--   bot_scripts.stage_2_payment_reply's default text is updated to:
--     1. Add {{SPA_LINE}} (resolved via the existing buildSpaSentence() —
--        same helper stage_2_arrival already uses, not a new mechanism).
--     2. Drop the explicit "{{PAYMENT_LINK}}" line — that link is now the
--        button itself, so it's never shown twice. Text says "click the
--        button below" instead, matching what sendStage2PayReply() actually
--        sends when a payment button is configured.
--     3. Keep {{WORKSHOP_URL}} inline, exactly as before.
--
--   Both are admin-editable today via the Automation Control Center's
--   existing session-message textarea and interactive_buttons editor — no
--   new UI, see AutomationControlCenter.js.
-- =============================================================================

UPDATE public.automation_stages
SET interactive_buttons = '[{"type":"url","label":"תשלום מהיר","url":"{{PAYMENT_LINK}}"}]'::jsonb
WHERE stage_key = 'stage_2_pay'
  AND (interactive_buttons IS NULL OR interactive_buttons = '[]'::jsonb);

UPDATE public.bot_scripts
SET message_text = E'מגיעים! \U0001F389 כבר מתרגשים מאד מהגעתכם, {{GUEST_NAME}}!\n\nהצוות שלנו ב-Dream Island מכין את הכל ומחכה לכם עם חיוך גדול \U0001F334\n\n{{SPA_LINE}}\n\nלפני ההגעה, נשארה יתרת תשלום בסך {{PAYMENT_AMOUNT}} ₪ להסדרה — לחצו על הכפתור למטה כדי להסדיר בקליק אחד.\n\n\U0001F3AF *לסדנאות שלנו — הרשמו מראש:*\n\U0001F449 {{WORKSHOP_URL}}\n\nיש לכם שאלות לפני ההגעה? אני כאן לכל שאלה \U0001F60A'
WHERE script_key = 'stage_2_payment_reply'
  AND message_text = E'מגיעים! \U0001F389 כבר מתרגשים מאד מהגעתכם, {{GUEST_NAME}}!\n\nהצוות שלנו ב-Dream Island מכין את הכל ומחכה לכם עם חיוך גדול \U0001F334\n\nלפני ההגעה, נשארה יתרת תשלום בסך {{PAYMENT_AMOUNT}} ₪ להסדרה — ניתן לסגור את זה בקליק אחד כאן:\n\U0001F449 {{PAYMENT_LINK}}\n\n\U0001F3AF *לסדנאות שלנו — הרשמו מראש:*\n\U0001F449 {{WORKSHOP_URL}}\n\nיש לכם שאלות לפני ההגעה? אני כאן לכל שאלה \U0001F60A';

COMMENT ON COLUMN public.automation_stages.interactive_buttons IS 'JSONB array of {type, label, url}. type="quick_reply" → real WhatsApp reply button (max 3). type="url" → plain tappable "🔗 label: url" text line UNLESS the stage''s own send logic special-cases it (stage_2_pay: a url button whose url template contains {{PAYMENT_LINK}} is sent as a real Meta cta_url button instead — see whatsapp-webhook/index.ts sendStage2PayReply).';

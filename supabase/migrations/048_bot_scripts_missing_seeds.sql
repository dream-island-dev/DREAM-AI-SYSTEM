-- =============================================================================
-- 048_bot_scripts_missing_seeds.sql
-- Phase 6 Bot Brain Audit follow-up — seed the script_keys the webhook already
-- reads but that had no row to edit (admin had to redeploy code to change them).
--
-- message_text values below are copied VERBATIM from the hardcoded fallback
-- strings in supabase/functions/whatsapp-webhook/index.ts at the time of writing.
-- This migration changes zero guest-facing behavior — it only makes the text
-- editable via BotScriptEditor.js. Admins can change wording after this lands.
--
-- 'generic_button_reply' is new: index.ts previously had NO bot_scripts lookup
-- for the unmatched-button case at all (paired code patch adds the lookup).
-- =============================================================================

INSERT INTO public.bot_scripts
  (script_key, display_name, trigger_event, is_meta_template, meta_template_name, message_text, ai_system_prompt, sort_order)
VALUES

-- ── Sent when intent classifies as "fallback" (line ~1321) ───────────────────
(
  'fallback_reply',
  'תגובת נפילה — לא זוהתה כוונה',
  'fallback',
  false,
  null,
  E'תודה רבה על פנייתך. \U0001F64F אני אעביר אותה לצוות הקבלה שלנו, שישמח לסייע לך בהקדם האפשרי.',
  null,
  6
),

-- ── Button: "ספא/טיפולים 📜" (line ~1056) ─────────────────────────────────────
(
  'spa_menu',
  'תפריט ספא',
  'button_reply',
  false,
  null,
  E'\U0001F33F *תפריט ספא Dream Island*\n\n\U0001F486 *טיפולים זוגיים:*\n• ספא בואטסו — 60 דק''\n• חמאם ושמנים — 90 דק''\n• עיסוי לכל הגוף — 60 דק''\n\n\U0001F486 *טיפולים אישיים:*\n• טיפול פנים — 45 דק''\n• עיסוי רגליים — 30 דק''\n• עיסוי גב — 30 דק''\n\n\U0001F4DE להזמנה — שלחו לנו את שם הטיפול והשעה המועדפת ונתאם לכם. תמשיכו ליהנות! \U0001F64F',
  null,
  7
),

-- ── Button: "דברו איתי/מענה אנושי 📞" (line ~1069) ────────────────────────────
(
  'callback_reply',
  'בקשת מענה אנושי',
  'button_reply',
  false,
  null,
  E'קיבלנו! \U0001F64F אחד מהצוות שלנו יצור אתכם קשר בהקדם. תמשיכו ליהנות!',
  null,
  8
),

-- ── Button: "היה מושלם!/מושלמת ✨" (line ~1079) ───────────────────────────────
-- {{GOOGLE_REVIEW_URL}} resolved by a paired code patch (index.ts) to the
-- GOOGLE_REVIEW_URL secret, same value the hardcoded fallback already used —
-- kept as a placeholder (not a literal URL) since the real secret value is
-- unknown at migration-authoring time and must not be guessed/baked in.
(
  'positive_feedback_reply',
  'משוב חיובי — בקשת ביקורת',
  'button_reply',
  false,
  null,
  E'שמחנו מאוד לשמוע! \U0001F31F אם תרצו לשתף את החוויה שלכם — זה יאיר לנו את היום:\n{{GOOGLE_REVIEW_URL}}\nתודה ענקית ומחכים לכם בפעם הבאה! \U0001F4AB',
  null,
  9
),

-- ── Button: "יש מקום לשיפור 💬" (line ~1091) ──────────────────────────────────
(
  'negative_feedback_reply',
  'משוב לשיפור',
  'button_reply',
  false,
  null,
  E'תודה על הכנות — זה חשוב לנו מאוד. \U0001F64F מה היה אפשר לשפר? כתבו לנו כאן ונשתפר.',
  null,
  10
),

-- ── Button: "נשמע מושלם/שריינו לי מקום" upsell accept (line ~1106) ───────────
(
  'upsell_accepted_reply',
  'שדרוג — אישור התעניינות',
  'button_reply',
  false,
  null,
  E'איזה יופי! ✨ העברתי את פנייתך לצוות הספא שלנו, והם ייצרו איתך קשר בהקדם לתיאום שעה מדויקת.',
  null,
  11
),

-- ── Button: "פחות מתאים הפעם" upsell decline (line ~1130) ────────────────────
(
  'upsell_decline_reply',
  'שדרוג — דחייה עדינה',
  'button_reply',
  false,
  null,
  E'הכל בסדר גמור! אנחנו כאן לכל דבר אחר שתצטרכו לקראת החופשה. \U0001F334',
  null,
  12
),

-- ── Unmatched/unknown button — paired with index.ts code patch adding the
-- lookup that previously did not exist (line ~1141) ──────────────────────────
(
  'generic_button_reply',
  'כפתור לא מזוהה — תגובה גנרית',
  'button_reply',
  false,
  null,
  E'תודה! \U0001F60A קיבלנו את בחירתך. האם יש משהו נוסף שנוכל לעשות עבורכם?',
  null,
  13
)

ON CONFLICT (script_key) DO UPDATE
  SET
    display_name       = EXCLUDED.display_name,
    message_text       = EXCLUDED.message_text,
    ai_system_prompt    = EXCLUDED.ai_system_prompt,
    trigger_event       = EXCLUDED.trigger_event,
    meta_template_name  = EXCLUDED.meta_template_name,
    sort_order          = EXCLUDED.sort_order
    -- is_active intentionally NOT overwritten on conflict —
    -- preserves admin's choice if they disabled a script
;

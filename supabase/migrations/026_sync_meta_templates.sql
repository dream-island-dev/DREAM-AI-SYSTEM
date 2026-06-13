-- Migration 026: Sync message_templates with real Meta-approved WA templates
-- Removes old mock seed rows (NULL wa_template_name).
-- Adds unique constraint on wa_template_name for safe upserts.
-- Seeds all 7 approved Dream Island templates in automation-flow order.

-- 1. Drop old mock rows (no wa_template_name linkage)
DELETE FROM public.message_templates
WHERE wa_template_name IS NULL;

-- 2. Add unique constraint so ON CONFLICT (wa_template_name) works
ALTER TABLE public.message_templates
  DROP CONSTRAINT IF EXISTS message_templates_wa_template_name_key;
ALTER TABLE public.message_templates
  ADD CONSTRAINT message_templates_wa_template_name_key UNIQUE (wa_template_name);

-- 3. Upsert all 7 approved templates (sort_order = automation sequence)
INSERT INTO public.message_templates (label, content, sort_order, wa_template_name)
VALUES
(
  'אישור הגעה 🌴',
  E'היי {{1}}! ברוכים הבאים ל-Dream Island Resort & Spa 🤍\nמחכים לכם עם המון אהבה.\nהאם אתם מגיעים בתאריך המתוכנן?',
  0,
  'dream_arrival_confirmation'
),
(
  'בוקר הגעה ☀️',
  E'בוקר טוב {{1}} 🌅\nהיום היום הגדול! מחכים לכם ב-Dream Island.\nהצ׳ק-אין פתוח החל מ-15:00 🏨',
  1,
  'dream_welcome_morning'
),
(
  'תשלום וסדנאות 💳',
  E'היי {{1}}! להשלמת ההזמנה:\n💳 לתשלום: {{2}}\n🎯 לרישום לסדנאות: {{3}}\nנשמח לראות אתכם!',
  2,
  'dream_payment_and_workshops'
),
(
  'מצב שהות 🏨',
  E'היי {{1}}, מקווים שאתם נהנים! 😊\nכיצד השהות עד כה?\nיש משהו שנוכל לשפר עבורכם?',
  3,
  'dream_mid_stay_check'
),
(
  'פידבק יציאה ⭐',
  E'תודה שבחרתם ב-Dream Island {{1}}! 🙏\nנשמח לשמוע את חוות דעתכם:\n⭐ להשארת ביקורת: {{2}}',
  4,
  'dream_checkout_feedback'
),
(
  'תזכורת צ׳ק-אין 📅',
  E'היי {{1}}! מזכירים — מחר ההגעה שלכם ל-Dream Island 🌴\nהצ׳ק-אין זמין מ-15:00.\nנתראה מחר!',
  5,
  'dream_checkin_reminder_v2'
),
(
  'העברת סוכן 🤝',
  E'היי {{1}}, מעביר אתכם לנציג שירות שיוכל לסייע טוב יותר 😊\nנחזור אליכם בהקדם!',
  6,
  'dream_handover_agent_v2'
)
ON CONFLICT (wa_template_name) DO UPDATE
  SET label      = EXCLUDED.label,
      content    = EXCLUDED.content,
      sort_order = EXCLUDED.sort_order;

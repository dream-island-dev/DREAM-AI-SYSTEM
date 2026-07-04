-- 130_inbox_wysiwyg_template_bodies.sql
-- Inbox WYSIWYG (session 113): seed/refresh message_templates.content for pipeline
-- Meta templates so whatsapp_conversations logs show real body text, not
-- "📋 תבנית Meta: <name>" placeholders.

INSERT INTO public.message_templates (label, content, sort_order, wa_template_name)
VALUES
(
  'תזכורת ערב — סוויטות (חול) 📅',
  E'היי {{1}} מה שלומכם?🌸\nמצפים להגעה שלכם לדרים איילנד.\nמעדכנים שהכניסה למתחם תיהיה דרך הכניסה של dream suites🙏\nתגיעו לשער ותצלצלו בפעמון יפתחו לכם.\nממליצים להגיע מוכנים עם בגדי ים וכפכפים.\nכניסה למתחם החל מהשעה - 12:00\nוקבלת החדרים החל משעה - 15:00\nמחכים לכם\nצוות דרים איילנד🌸',
  10,
  'night_before_suites'
),
(
  'תזכורת ערב — סוויטות (שבת) 🕯️',
  E'היי {{1}} מה שלומכם?🌸\nמצפים להגעה שלכם לדרים איילנד.\nמעדכנים שהכניסה למתחם תיהיה דרך הכניסה של dream suites🙏\nתגיעו לשער ותצלצלו בפעמון יפתחו לכם.\nממליצים להגיע מוכנים עם בגדי ים וכפכפים.\nכניסה למתחם החל מהשעה - 15:00\nוקבלת החדרים החל משעה - 18:00\nמחכים לכם\nצוות דרים איילנד🌸',
  11,
  'night_before_suites_shabbat'
),
(
  'תזכורת סוויטה — דינמי 🌸',
  E'היי {{1}} מה שלומכם?🌸\nמצפים להגעה שלכם לדרים איילנד.\nמעדכנים שהכניסה למתחם תיהיה דרך הכניסה של dream suites🙏\nתגיעו לשער ותצלצלו בפעמון יפתחו לכם.\nממליצים להגיע מוכנים עם בגדי ים וכפכפים.\nכניסה למתחם החל מהשעה - {{2}}\nוקבלת החדרים החל משעה - {{3}}\nמחכים לכם\nצוות דרים איילנד🌸',
  12,
  'dream_suite_reminder'
),
(
  'בוקר הגעה — סוויטות ☀️',
  E'בוקר אור {{1}}! ✨ היום זה היום!\nהריזורט מוכן, השמש בחוץ, וכל הצוות שלנו כבר מחכה להעניק לכם חוויה בלתי נשכחת.\n\nכמה פרטים קטנים וחשובים לדרך:\n🌸 מתקני הריזורט, הבריכות והמתחמים פתוחים עבורכם כבר מהשעה 09:00 בבוקר.\n🔑 קבלת החדרים והסוויטות היא החל מהשעה 15:00.\n\nאם יש לכם שאלה כלשהי בדרך, אנחנו זמינים כאן בצ''אט. נסיעה טובה ובטוחה! 🚗❤️',
  13,
  'suite_welcome_morning'
),
(
  'בוקר הגעה — שבת ☀️',
  E'בוקר אור {{1}}! ✨ היום זה היום!\nהריזורט מוכן, השמש בחוץ, וכל הצוות שלנו כבר מחכה להעניק לכם חוויה בלתי נשכחת.\n\nכמה פרטים קטנים וחשובים לדרך:\n🌸 כניסה למתחם החל מהשעה 12:00.\n🔑 קבלת החדרים והסוויטות היא החל מהשעה 18:00.\n\nאם יש לכם שאלה כלשהי בדרך, אנחנו זמינים כאן בצ''אט. נסיעה טובה ובטוחה! 🚗❤️',
  14,
  'suite_welcome_morning_shabbat'
),
(
  'חדר מוכן 🔑',
  E'🔑 {{1}}, יש לנו בשורה — הסוויטה {{2}} שלך מוכנה ומחכה לך! אפשר לגשת לדלפק הקבלה לקבלת המפתח ולהתחיל את החוויה. מצפים לראותכם 🌴',
  15,
  'dream_room_ready1'
)
ON CONFLICT (wa_template_name) DO UPDATE
  SET label      = EXCLUDED.label,
      content    = EXCLUDED.content,
      sort_order = EXCLUDED.sort_order;

-- Refresh legacy rows to match Meta-approved copy (inbox logging accuracy).
UPDATE public.message_templates
SET content = E'היי מה שלומכם?🌸\nמצפים להגעה שלכם לדרים איילנד.\nמעדכנים שהכניסה למתחם תיהיה דרך הכניסה של dream suites🙏\nתגיעו לשער ותצלצלו בפעמון יפתחו לכם.\nממליצים להגיע מוכנים עם בגדי ים וכפכפים.\nכניסה למתחם החל מהשעה - {{1}}\nוקבלת החדרים החל משעה - {{2}}\nמחכים לכם\nצוות דרים איילנד🌸'
WHERE wa_template_name = 'dream_checkin_reminder_v2';

UPDATE public.message_templates
SET content = E'היי {{1}}! איזה כיף, אנחנו כבר מחכים לכם! 🥰\nכדי שהצ''ק-אין שלכם בריזורט יהיה מהיר, חלק וללא המתנה מיותרת בדלפק הקבלה, נשמח אם תסדירו את יתרת השהות על סך {{2}} ₪ בקישור המאובטח שלכם.\n\nבנוסף, מקומות היין והסדנאות הייחודיות שלנו בריזורט כבר כמעט מלאים! שווה לשריין מקום מראש בקישור המצורף. נתראה ממש בקרוב! 🥂'
WHERE wa_template_name = 'dream_payment_and_workshops';

UPDATE public.message_templates
SET content = E'היי {{1}}, השערים של הריזורט נסגרו מאחוריכם, ורצינו להגיד תודה ענקית שהתארחתם אצלנו. 🙏 החיוך והחוויה שלכם הם הכל עבורנו.\nנשמח מאוד לשמוע בכנות — איך היתה השהות שלכם אצלנו?'
WHERE wa_template_name = 'dream_checkout_feedback';

UPDATE public.message_templates
SET content = E'🔑 {{1}}, יש לנו בשורה — הסוויטה {{2}} שלך מוכנה ומחכה לך! אפשר לגשת לדלפק הקבלה לקבלת המפתח ולהתחיל את החוויה. מצפים לראותכם 🌴'
WHERE wa_template_name = 'dream_room_ready';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.message_templates
    WHERE wa_template_name = 'night_before_suites'
      AND content LIKE '%12:00%'
  ) THEN
    RAISE EXCEPTION '130_self_test: night_before_suites content missing';
  END IF;
END $$;

-- 268: Guest Club profile dates for personalized perks (birthday / partner / anniversary).

ALTER TABLE public.guest_club_members
  ADD COLUMN IF NOT EXISTS guest_birthday       DATE,
  ADD COLUMN IF NOT EXISTS partner_birthday     DATE,
  ADD COLUMN IF NOT EXISTS wedding_anniversary  DATE;

COMMENT ON COLUMN public.guest_club_members.guest_birthday IS
  'Guest birthday for club perks (year optional — portal may use sentinel year).';
COMMENT ON COLUMN public.guest_club_members.partner_birthday IS
  'Partner birthday when provided at opt-in.';
COMMENT ON COLUMN public.guest_club_members.wedding_anniversary IS
  'Wedding anniversary when provided at opt-in.';

-- Extend editable club UI copy (staff Feedback → Surveys).
UPDATE public.bot_config
SET config_value = config_value::jsonb || '{
  "benefits_hint": "מלאו תאריכים מיוחדים וקבלו הטבות ליום הולדת, יום נישואין ועוד 🎁",
  "profile_step_title": "פרטים להטבות אישיות",
  "guest_birthday_label": "תאריך לידה שלכם",
  "guest_birthday_hint": "חובה להצטרפות — לקבלת הטבות ביום ההולדת",
  "partner_toggle_label": "יש לי בן/בת זוג",
  "partner_birthday_label": "תאריך לידה של בן/בת הזוג",
  "anniversary_label": "יום נישואין",
  "optional_suffix": "(לא חובה)",
  "continue_label": "המשך להצטרפות ✨",
  "submit_profile_label": "הצטרפות למועדון 🎁",
  "wa_review_hint": "נשלחה אליכם גם הודעה בוואטסאפ עם קישור לביקורת בגוגל ⭐"
}'::jsonb
WHERE config_key = 'guest_club_ui'
  AND NOT (config_value::jsonb ? 'benefits_hint');

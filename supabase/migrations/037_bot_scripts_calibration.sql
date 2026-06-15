-- Migration 037: Bot Brain Calibration
-- Upserts 4 active conversation scripts with production-ready content.

INSERT INTO public.bot_scripts
  (script_key, display_name, trigger_event, is_active, sort_order, message_text, ai_system_prompt)
VALUES

-- 1. Ongoing concierge — AI system prompt used for all FAQ intents
(
  'ongoing_concierge',
  'קונסיירז'' מתמשך — הנחיות AI',
  'ongoing',
  true,
  10,
  NULL,
  'You are the exclusive Digital Concierge for Dream Island Resort & Spa. Your tone is elegant, philosophical, grounding, and deeply connected to nature and serenity. You solve problems creatively and calmly.
YOUR ONLY PURPOSE: To assist arriving and checked-in guests with their on-site experience (estate navigation, wellness philosophy, workshops).
STRICT GUARDRAILS:
- NEVER act as a sales agent.
- NEVER quote prices, rates, or check room availability.
- NEVER assist with new reservations.
If asked about bookings/prices, deflect smoothly: ''לפרטים לגבי זמינות ומחירים, נשמח לעמוד לרשותך באתר הרשמי שלנו או דרך צוות ההזמנות. אשמח לסייע בכל שאלה אחרת לגבי השהות שלכם כאן.''
Be concise, accurate, and do not hallucinate amenities.'
),

-- 2. Stage 2 arrival — sent after guest confirms "כן, מגיעים!"
-- {{OPTIONAL_SPA_TEXT}} is resolved by the webhook: "מתואם לכם טיפול בספא בשעה HH:MM.\n" or ""
(
  'stage_2_arrival',
  'שלב 2 — אישור הגעה',
  'arrival_confirmed',
  true,
  20,
  'איזה כיף, אנחנו כבר מחכים לכם! 🥰 {{OPTIONAL_SPA_TEXT}}מקומות היין והסדנאות מחכים לכם בקישור... https://go.oncehub.com/DreamIsland',
  NULL
),

-- 3. Complaint reply — scripted empathy + escalation
(
  'complaint_reply',
  'תשובה לתלונה',
  'complaint',
  true,
  30,
  '{{GUEST_NAME}}, אנו מתנצלים בכנות על אי הנוחות. התחושה שלך חשובה לנו. העברתי את הפנייה לצוות הניהול שיטפל בכך באופן מיידי.',
  NULL
),

-- 4. Upsell reply — warm invitation without price mention
(
  'upsell_reply',
  'תשובה לעניין בשירותים',
  'upsell',
  true,
  40,
  '{{GUEST_NAME}}, שמחים לשמוע שאתם נהנים! להעצמת החוויה שלכם, אתם מוזמנים לעיין בשירותים הנוספים שלנו... https://go.oncehub.com/DreamIsland',
  NULL
)

ON CONFLICT (script_key) DO UPDATE SET
  display_name     = EXCLUDED.display_name,
  is_active        = EXCLUDED.is_active,
  sort_order       = EXCLUDED.sort_order,
  message_text     = EXCLUDED.message_text,
  ai_system_prompt = EXCLUDED.ai_system_prompt,
  updated_at       = NOW();

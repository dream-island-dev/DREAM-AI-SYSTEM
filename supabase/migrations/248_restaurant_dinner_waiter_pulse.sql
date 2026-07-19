-- Restaurant Dinner Board access + Waiter Service Pulse (public magic-link survey).

-- ── Restaurant board access flag (like orit_cs_agent_access) ───────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS restaurant_access BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.restaurant_access IS
  'Grants לוח ערב — מסעדה. Restaurant-only staff see kiosk dinner board on login.';

-- ── Public survey magic links (/pulse/:token) ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.waiter_pulse_links (
  id          BIGSERIAL    PRIMARY KEY,
  token       UUID         NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  label       TEXT         NOT NULL DEFAULT 'מסעדה — סבב שירות',
  is_active   BOOLEAN      NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  created_by  UUID         REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.waiter_pulse_links IS
  'No-login magic link for waiter service-improvement pulse. Token IS the auth (same model as inventory_portal_links).';

CREATE TABLE IF NOT EXISTS public.waiter_pulse_responses (
  id                  BIGSERIAL    PRIMARY KEY,
  link_id             BIGINT       REFERENCES public.waiter_pulse_links(id) ON DELETE SET NULL,
  answers             JSONB        NOT NULL DEFAULT '{}',
  submitter_name      TEXT,
  management_status   TEXT         NOT NULL DEFAULT 'new'
    CHECK (management_status IN ('new', 'reviewing', 'implemented', 'declined')),
  management_note     TEXT,
  reviewed_at         TIMESTAMPTZ,
  reviewed_by         UUID         REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.waiter_pulse_responses IS
  'Waiter-facing service improvement submissions — outward-focused (what to fix), not self-performance ratings.';

CREATE INDEX IF NOT EXISTS idx_waiter_pulse_responses_created
  ON public.waiter_pulse_responses (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_waiter_pulse_responses_status
  ON public.waiter_pulse_responses (management_status)
  WHERE management_status = 'new';

ALTER TABLE public.waiter_pulse_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.waiter_pulse_responses ENABLE ROW LEVEL SECURITY;

CREATE POLICY waiter_pulse_links_authed_rw ON public.waiter_pulse_links
  FOR ALL
  USING     (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY waiter_pulse_responses_authed_rw ON public.waiter_pulse_responses
  FOR ALL
  USING     (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- Seed one active link when table is empty (manager can rotate from UI).
INSERT INTO public.waiter_pulse_links (label, is_active)
SELECT 'מסעדה — סבב שירות', true
WHERE NOT EXISTS (SELECT 1 FROM public.waiter_pulse_links WHERE is_active = true);

-- Editable survey UI (Feedback → סבב מלצרים).
INSERT INTO bot_config (config_key, config_value, category, label)
VALUES (
  'waiter_service_pulse_ui',
  '{
    "panel_title": "מה ראיתם מהרצפה?",
    "intro_text": "אנחנו לא בודקים אתכם — רוצים לשמוע מה אתם רואים מול האורחים: מה מפריע לשירות טוב, ומה הייתם משנים.",
    "submit_label": "📨 שליחת התשובות",
    "thank_you_title": "תודה — שמענו אתכם",
    "thank_you_body": "ההנהלה עוברת על התשובות וחוזרת עם עדכון.",
    "questions": [
      {
        "key": "system_friction",
        "type": "multi_choice",
        "label": "מה הכי מפריע היום לתת שירות טוב לאורח?",
        "required": true,
        "options": [
          {"id": "no_guest_info", "label": "אין מידע על אלרגיות / פנסיון לפני שהאורח יושב"},
          {"id": "no_table_time", "label": "אורחים לא יודעים מתי השולחן / מגיעים לא בזמן"},
          {"id": "peak_load", "label": "עומס בשעות שיא בלי תגבור"},
          {"id": "kitchen_comms", "label": "תקשורת עם מטבח / מעבר פנימי"},
          {"id": "menu_availability", "label": "תפריט / זמינות מנים"},
          {"id": "unclear_expectations", "label": "ציפיות לא ברורות של האורח (מה כלול, מה לא)"}
        ],
        "allow_other": true,
        "other_label": "משהו אחר"
      },
      {
        "key": "guest_pain_point",
        "type": "single_choice",
        "label": "איפה האורח הכי מתוסכל אצלנו?",
        "required": true,
        "options": [
          {"id": "arrival", "label": "הגעה למסעדה"},
          {"id": "waiting", "label": "המתנה לשולחן"},
          {"id": "menu_explain", "label": "הסבר על התפריט / מה כלול"},
          {"id": "speed", "label": "מהירות שירות"},
          {"id": "warmth", "label": "חום / יחס אישי"},
          {"id": "checkout", "label": "סיום / חשבון"},
          {"id": "other", "label": "אחר"}
        ]
      },
      {
        "key": "change_tomorrow",
        "type": "text",
        "label": "מה הייתם משנים מחר בבוקר?",
        "required": true,
        "placeholder": "למשל: לשלוח לנו שעת שולחן לפני הערב…",
        "min_length": 15
      },
      {
        "key": "one_idea",
        "type": "text",
        "label": "רעיון אחד ששווה לנסות",
        "required": true,
        "placeholder": "אם הייתם מנהלים לשבוע — מה הייתם מנסים?",
        "min_length": 15
      },
      {
        "key": "example_story",
        "type": "text",
        "label": "דוגמה מהשבוע האחרון (אופציונלי)",
        "required": false,
        "placeholder": "מקרה אחד שבו הרגשתם שאפשר היה לעשות יותר טוב — בלי שמות אורח"
      },
      {
        "key": "submitter_name",
        "type": "text",
        "label": "שם (אופציונלי — עוזר לחזור אליכם)",
        "required": false,
        "placeholder": "שם פרטי או ראשי תיבות"
      }
    ]
  }',
  'general',
  'סקר סבב שירות מלצרים (JSON)'
)
ON CONFLICT (config_key) DO NOTHING;

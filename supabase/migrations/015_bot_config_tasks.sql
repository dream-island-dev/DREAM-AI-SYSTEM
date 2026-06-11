-- ================================================================
-- Migration 015: bot_config table + tasks table + storage policies
-- Safe to re-run (idempotent). Run in Supabase SQL Editor.
-- ================================================================

-- ── A. bot_config table ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bot_config (
  id           UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  config_key   TEXT         UNIQUE NOT NULL,
  config_value TEXT         NOT NULL DEFAULT '',
  category     TEXT         NOT NULL DEFAULT 'general',
  label        TEXT,
  updated_by   UUID         REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bot_config_category ON public.bot_config (category);

-- Seed default values (safe — ON CONFLICT DO NOTHING)
INSERT INTO public.bot_config (config_key, config_value, category, label) VALUES
  ('bot_name',
   'DREAM CONCIERGE',
   'persona', 'שם הבוט'),

  ('bot_personality',
   'פרמיום, יוקרתי, אמפתי ומקצועי ביותר — 5 כוכבים בכל משפט. עברית תקנית ואלגנטית בלבד. חמים, מאופק ומרגיש אנושי. תשובות קצרות ומדויקות: 2–4 משפטים.',
   'persona', 'אישיות הבוט'),

  ('hotel_checkin_time',
   '15:00',
   'knowledge', 'שעת צ''ק-אין'),

  ('hotel_checkout_time',
   '11:00',
   'knowledge', 'שעת צ''ק-אאוט'),

  ('hotel_pool_hours',
   '08:00–20:00 (קיץ עד 21:00)',
   'knowledge', 'שעות בריכה'),

  ('hotel_spa_hours',
   '09:00–21:00',
   'knowledge', 'שעות ספא'),

  ('hotel_restaurant_hours',
   'בוקר 07:00–10:30 | צהריים 12:30–15:00 | ערב 18:30–22:00',
   'knowledge', 'שעות מסעדה'),

  ('hotel_wifi',
   'DreamIsland_Guest — סיסמה בקבלה',
   'knowledge', 'WiFi'),

  ('hotel_special_services',
   'שירות חדרים 24/7 · קונסיירז'' · השכרת אופניים · טיולים מאורגנים בסביבה',
   'knowledge', 'שירותים מיוחדים'),

  ('template_night_before',
   'שלום {{name}}! 🌙 כאן Dream Island. אנו מצפים לבואך מחר — הצ''ק-אין מהשעה 15:00. נשמח לדעת שעת הגעה משוערת כדי להכין הכל עבורך. נסיעה טובה! 🏝️',
   'templates', 'הודעת ערב לפני הגעה'),

  ('template_checkin_welcome',
   'ברוך הבא, {{name}}! 🏝️ אנחנו שמחים שהגעת ל-Dream Island. {{room_info}} מעוניין/ת בשדרוג, הארכת שהות או שירות כלשהו? פשוט שלח/י הודעה — הקונסיירז'' הדיגיטלי שלנו לשירותך 24/7.',
   'templates', 'ברכת צ''ק-אין'),

  ('template_midstay_checkin',
   'שלום {{name}} 😊 כבר יום שלם איתנו ב-Dream Island! רצינו לוודא שהכל לטעמך. יש משהו שנוכל לשפר? אנחנו פה בשבילך.',
   'templates', 'בדיקת שביעות רצון'),

  ('template_before_checkout',
   'שלום {{name}}, אנחנו מקווים שהשהייה הייתה מושלמת! 🌟 מחר צ''ק-אאוט עד 11:00. נשמח לשמוע על החוויה שלך — זה עוזר לנו להשתפר עבור הביקור הבא שלך 💛',
   'templates', 'הודעה לפני עזיבה'),

  ('response_complaint_rule',
   'תמיד הפגן אמפתיה מיידית. אל תטפל בתלונה ישירות — כתוב שהעברת לצוות ושיחזרו בהקדם. הפעל התראה למנהל.',
   'rules', 'כלל תגובה לתלונות'),

  ('response_upsell_rule',
   'הצע שדרוגים בנימה חמה ולא לחוצה. ציין זמינות בכפוף לתפוסה. הפנה להשלמת התיאום דרך הקבלה.',
   'rules', 'כלל תגובה לשדרוג'),

  ('response_faq_rule',
   'ענה בצורה ישירה וידידותית. אם שאלה מחוץ לידע — הצע ליצור קשר עם הקבלה בטלפון או בלובי.',
   'rules', 'כלל שאלות נפוצות')

ON CONFLICT (config_key) DO NOTHING;

-- Enable RLS
ALTER TABLE public.bot_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bot_config_read  ON public.bot_config;
DROP POLICY IF EXISTS bot_config_write ON public.bot_config;

-- Anyone (authenticated) can read bot config (Edge Functions use service key anyway)
CREATE POLICY bot_config_read ON public.bot_config
  FOR SELECT USING (true);

-- Only admin / super_admin can write
CREATE POLICY bot_config_write ON public.bot_config
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'super_admin')
    )
  );


-- ── B. tasks table ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tasks (
  id           UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_number  TEXT,
  department   TEXT         NOT NULL,
  description  TEXT         NOT NULL,
  image_url    TEXT,
  status       TEXT         NOT NULL DEFAULT 'open'
                            CHECK (status IN ('open', 'done')),
  priority     TEXT         NOT NULL DEFAULT 'normal'
                            CHECK (priority IN ('urgent', 'normal', 'low')),
  created_by   UUID         REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolved_by  UUID         REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolved_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tasks_dept    ON public.tasks (department);
CREATE INDEX IF NOT EXISTS idx_tasks_status  ON public.tasks (status);
CREATE INDEX IF NOT EXISTS idx_tasks_created ON public.tasks (created_at DESC);

-- Enable RLS
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tasks_select ON public.tasks;
DROP POLICY IF EXISTS tasks_insert ON public.tasks;
DROP POLICY IF EXISTS tasks_update ON public.tasks;

-- All authenticated users can read tasks
CREATE POLICY tasks_select ON public.tasks FOR SELECT USING (true);

-- All authenticated users can create tasks
CREATE POLICY tasks_insert ON public.tasks FOR INSERT WITH CHECK (true);

-- All authenticated users can update tasks (mark done, etc.)
CREATE POLICY tasks_update ON public.tasks FOR UPDATE USING (true);


-- ── C. Storage bucket for task images ──────────────────────────
-- NOTE: The bucket must be created manually in Supabase Dashboard:
--   Storage → New Bucket → Name: "task_images" → Public: ON
--
-- Then run these storage policies in the SQL Editor:

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'task_images',
  'task_images',
  true,
  10485760, -- 10 MB per file
  ARRAY['image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif']
)
ON CONFLICT (id) DO UPDATE
  SET public = true,
      file_size_limit = 10485760;

-- Storage policies
DROP POLICY IF EXISTS task_images_read   ON storage.objects;
DROP POLICY IF EXISTS task_images_insert ON storage.objects;

CREATE POLICY task_images_read ON storage.objects
  FOR SELECT USING (bucket_id = 'task_images');

CREATE POLICY task_images_insert ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'task_images'
    AND auth.role() = 'authenticated'
  );

-- ================================================================
-- Migration 018: bot_settings table
--
-- Stores the AI concierge's system prompt and knowledge base.
-- The whatsapp-webhook Edge Function fetches this single row
-- and injects both fields into every Gemini API call.
--
-- Single-row design: id CHECK (id = 1) enforces exactly one record.
-- BotSettings.js uses UPSERT id=1 to safely save changes.
-- ================================================================

CREATE TABLE IF NOT EXISTS public.bot_settings (
  id             INTEGER PRIMARY KEY CHECK (id = 1),
  system_prompt  TEXT    DEFAULT '',
  knowledge_base TEXT    DEFAULT '',
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO public.bot_settings (id, system_prompt, knowledge_base)
VALUES (
  1,
  $prompt$אתה "DREAM CONCIERGE" — הקונסיירז' הדיגיטלי הרשמי של Dream Island Resort & Spa.
פרמיום, יוקרתי, אמפתי ומקצועי ביותר — 5 כוכבות בכל משפט. עברית תקנית ואלגנטית בלבד.
תשובות קצרות ומדויקות: 2–4 משפטים בלבד. אל תחשוף שאתה AI.
אם אינך בטוח בפרט — הפנה לקבלה בנימוס.$prompt$,
  ''
)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.bot_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY bot_settings_read ON public.bot_settings
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY bot_settings_write ON public.bot_settings
  FOR ALL USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

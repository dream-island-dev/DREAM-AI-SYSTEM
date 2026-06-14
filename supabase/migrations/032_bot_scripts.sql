-- =============================================================================
-- 032_bot_scripts.sql
-- Bot Script Manager — central store for all bot message content.
--
-- PURPOSE:
--   Edge Functions (whatsapp-webhook, whatsapp-send) read from this table
--   instead of using hardcoded strings. Admins edit via BotScriptEditor.js.
--   All text is cached in-memory for 5 minutes (zero DB cost on repeat calls).
--
-- PLACEHOLDER CONVENTION (resolved at send time by Edge Function):
--   {{GUEST_NAME}}   → guest's name from guests table
--   {{SPA_TIME}}     → treatment_time from bookings table (omitted if empty)
--   {{WORKSHOP_URL}} → WORKSHOP_SIGNUP_URL Supabase secret
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.bot_scripts (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  script_key         TEXT        UNIQUE NOT NULL,   -- stable identifier used by Edge Functions
  display_name       TEXT        NOT NULL,           -- Hebrew label shown in BotScriptEditor UI
  trigger_event      TEXT        NOT NULL,           -- 'arrival_confirmed' | 'morning_of' | 'ongoing' | 'complaint' | 'upsell'
  is_meta_template   BOOLEAN     NOT NULL DEFAULT false,  -- true = must be registered in Meta
  meta_template_name TEXT,                           -- Meta template name (when is_meta_template = true)
  message_text       TEXT,                           -- free-form message body with placeholders
  ai_system_prompt   TEXT,                           -- AI system prompt (for ongoing AI stages)
  is_active          BOOLEAN     NOT NULL DEFAULT true,
  sort_order         INTEGER     NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Auto-update updated_at on every row change
-- (uses the same set_updated_at() function already defined in earlier migrations)
DROP TRIGGER IF EXISTS trg_bot_scripts_updated ON public.bot_scripts;
CREATE TRIGGER trg_bot_scripts_updated
  BEFORE UPDATE ON public.bot_scripts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Index for the most common query pattern (Edge Function: SELECT WHERE script_key = ?)
CREATE INDEX IF NOT EXISTS idx_bot_scripts_script_key
  ON public.bot_scripts (script_key);

-- Index for BotScriptEditor list view (sorted by sort_order)
CREATE INDEX IF NOT EXISTS idx_bot_scripts_sort
  ON public.bot_scripts (sort_order);

-- ── Row Level Security ────────────────────────────────────────────────────────
ALTER TABLE public.bot_scripts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated users can read bot_scripts"  ON public.bot_scripts;
DROP POLICY IF EXISTS "authenticated users can write bot_scripts" ON public.bot_scripts;

-- All authenticated users can read (Edge Functions use service role — always bypasses RLS)
CREATE POLICY "authenticated users can read bot_scripts"
  ON public.bot_scripts FOR SELECT
  TO authenticated
  USING (true);

-- All authenticated users can write (admin guard enforced in the frontend via guardPage)
CREATE POLICY "authenticated users can write bot_scripts"
  ON public.bot_scripts FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ── Seed: 5 initial scripts ───────────────────────────────────────────────────
-- ON CONFLICT on script_key → safe to re-run without duplicating rows.

INSERT INTO public.bot_scripts
  (script_key, display_name, trigger_event, is_meta_template, meta_template_name, message_text, ai_system_prompt, sort_order)
VALUES

-- ── STAGE 2: Reply sent automatically when guest confirms arrival ─────────────
-- Triggered by: "כן, מגיעים!" button OR typed "כן"
-- Sent as: free-form text (24h window opened by guest's inbound message)
-- Edge Function injects {{SPA_TIME}} from bookings.treatment_time
-- Edge Function injects {{WORKSHOP_URL}} from WORKSHOP_SIGNUP_URL secret
(
  'stage_2_arrival',
  'Stage 2 — אישור הגעה + ספא 🥰',
  'arrival_confirmed',
  false,
  null,
  E'איזה כיף, אנחנו כבר מחכים לכם! \U0001F970 מתואם לכם טיפול בספא בשעה {{SPA_TIME}}. בנוסף, מקומות היין והסדנאות מחכים לכם בקישור... https://go.oncehub.com/DreamIsland',
  null,
  1
),

-- ── STAGE 3: Morning-of-arrival message ──────────────────────────────────────
-- Triggered by: whatsapp-cron (morning_of / morning_welcome / morning_suite)
-- Sent as: free-form if wa_window_expires_at > now(), else Meta template dream_morning_v2
-- Edge Function injects {{GUEST_NAME}}
(
  'stage_3_morning',
  'Stage 3 — בוקר הגעה ☀️',
  'morning_of',
  false,
  'dream_morning_v2',
  E'בוקר אור {{GUEST_NAME}}! ☀️ היום זה היום! הריזורט מוכן, השמש בחוץ, וכל הצוות שלנו כבר מחכה להעניק לכם חוויה בלתי נשכחת...\n\nכמה פרטים קטנים וחשובים לדרך:\n\U0001F338 מתחמי הריזורט, הבריכות והמתחמים פתוחים עבורכם כבר מהשעה 09:00.\n\nמאחלים לכם יום Dreamy \U0001F90D',
  null,
  2
),

-- ── ONGOING: AI system prompt for free-text conversations ────────────────────
-- Used by whatsapp-webhook for all "faq" and "upsell" intents
-- Replaces the hardcoded FALLBACK_SYSTEM_PROMPT + buildSystemPrompt() output
-- (bot_settings.system_prompt still overrides this if set — existing logic preserved)
(
  'ongoing_concierge',
  'Ongoing AI — Concierge System Prompt 🤖',
  'ongoing',
  false,
  null,
  null,
  E'אתה "DREAM CONCIERGE" — הקונסיירז'' הדיגיטלי הרשמי של Dream Island Resort & Spa.\nפרמיום, יוקרתי, אמפתי ומקצועי ביותר — 5 כוכבים בכל משפט. עברית תקנית ואלגנטית בלבד.\nתשובות קצרות ומדויקות: 2–4 משפטים בלבד. אל תחשוף שאתה AI.\nאם אינך בטוח בפרט — הפנה לקבלה בנימוס.',
  3
),

-- ── COMPLAINT: Pre-written empathy reply ─────────────────────────────────────
-- Sent instantly without AI (< 1ms) when complaint intent is detected
-- Edge Function injects {{GUEST_NAME}}
(
  'complaint_reply',
  'תגובת תלונה — אמפתיה מיידית 🙏',
  'complaint',
  false,
  null,
  E'{{GUEST_NAME}} אנו מתנצלים בכנות על אי הנוחות שנגרמה לך. אני מעדכן מיד את מנהל המשמרת כדי שיטפל בזה עבורכם. נחזור אליך בהקדם האפשרי.',
  null,
  4
),

-- ── UPSELL: Pre-written upgrade offer ────────────────────────────────────────
-- Sent when upsell intent is detected (room upgrade, late checkout, extra night)
-- Edge Function injects {{GUEST_NAME}}
(
  'upsell_reply',
  'הצעת שדרוג / הארכת שהות 🌟',
  'upsell',
  false,
  null,
  E'{{GUEST_NAME}} שמחים לשמוע שאתם נהנים מהשהות! \U0001F31F שדרוגים, הארכת שהות ו-late check-out זמינים בכפוף לתפוסה הנוכחית. האם תרצו שנציג מהצוות שלנו יצור איתכם קשר לתיאום אישי?',
  null,
  5
)

ON CONFLICT (script_key) DO UPDATE
  SET
    display_name       = EXCLUDED.display_name,
    message_text       = EXCLUDED.message_text,
    ai_system_prompt   = EXCLUDED.ai_system_prompt,
    trigger_event      = EXCLUDED.trigger_event,
    meta_template_name = EXCLUDED.meta_template_name,
    sort_order         = EXCLUDED.sort_order
    -- is_active intentionally NOT overwritten on conflict —
    -- preserves admin's choice if they disabled a script
;

COMMENT ON TABLE  public.bot_scripts                    IS 'מקור אמת לכל הודעות הבוט — נערך דרך BotScriptEditor.js';
COMMENT ON COLUMN public.bot_scripts.script_key         IS 'מזהה קבוע שמשמש את Edge Functions (לא לשנות אחרי deploy)';
COMMENT ON COLUMN public.bot_scripts.message_text       IS 'טקסט ההודעה עם placeholders: {{GUEST_NAME}}, {{SPA_TIME}}, {{WORKSHOP_URL}}';
COMMENT ON COLUMN public.bot_scripts.ai_system_prompt   IS 'System prompt ל-AI (רלוונטי רק ל-ongoing_concierge)';
COMMENT ON COLUMN public.bot_scripts.is_meta_template   IS 'true = נשלח כ-Meta template (חייב אישור Meta). false = free-form text';
COMMENT ON COLUMN public.bot_scripts.meta_template_name IS 'שם ה-template ב-Meta Business Manager (כשis_meta_template=true)';

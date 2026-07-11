-- =============================================================================
-- 183_executive_bot_settings.sql
-- Makes the Executive Voice Assistant's base system prompt DB-editable,
-- mirroring bot_settings (migration 018) — same singleton-row pattern, same
-- admin-write RLS shape, plus the same cleaner-lockdown restrictive policy
-- migration 087 already applies to bot_settings/bot_config/bot_scripts.
--
-- {{name}} / {{title}} are substituted at runtime (executiveAssistant.ts)
-- with the resolved ExecutiveProfile's displayName/title — so one template
-- serves every authorized executive (Eliad, Mike, future additions), not a
-- row per person.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.executive_bot_settings (
  id             INTEGER PRIMARY KEY CHECK (id = 1),
  persona_prompt TEXT DEFAULT '',
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO public.executive_bot_settings (id, persona_prompt)
VALUES (
  1,
  $prompt$את/ה העוזר/ת האישי/ת הדיגיטלי/ת של {{name}}, {{title}} ב-Dream Island. אתה מדבר איתו ישירות
בוואטסאפ (מכשיר הסוויטות) — זו לא שיחה עם אורח, זו שיחת ניהול פנימית.

תפקידך: לבצע עבורו פעולות ניהוליות בפועל (פתיחת משימות, בדיקת מצב הריזורט, שליחת
הודעות לאורחים/למנהלים, עדכון פרטי אורח, לימוד העדפות קבועות) ולדווח לו בקצרה.

כללי תשובה (חובה):
• עברית בלבד, 2–4 משפטים לכל היותר. בלי פתיחים מיותרים ("שלום", "בשמחה").
• כשביצעת פעולה בפועל דרך אחד הכלים — פתח את השורה הרלוונטית ב-✅.
• כמה פעולות/עדכונים בתשובה אחת — כל אחת כשורת בולט (•) קצרה.
• אל תמציא נתונים על הריזורט או על אורחים — אם חסר לך מידע קרא לכלי המתאים
  (get_resort_brief / find_guest_by_room / query_open_tasks) לפני שאתה עונה.
• משפט כמו "תזכרי ש..." / "מעכשיו תמיד..." / "מהיום..." = קרא ל-learn_executive_rule
  כדי לשמור את זה כהעדפה קבועה שלך, אחרת תשכח אותה בפעם הבאה.
• לעולם אל תשלח הודעה לאורח שסטטוסו 'cancelled' — הכלים חוסמים זאת; אם זה קרה ציין זאת.
• אם הבקשה לא ברורה מספיק לפעולה (לא ברור באיזה חדר/אורח/משימה מדובר) — שאל שאלת
  הבהרה קצרה אחת במקום לנחש.$prompt$
)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.executive_bot_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY executive_bot_settings_read ON public.executive_bot_settings
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY executive_bot_settings_write ON public.executive_bot_settings
  FOR ALL USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "cleaner_lockdown_executive_bot_settings" ON public.executive_bot_settings
  AS RESTRICTIVE
  FOR ALL
  USING (COALESCE(public.get_true_role(), '') <> 'cleaner')
  WITH CHECK (COALESCE(public.get_true_role(), '') <> 'cleaner');

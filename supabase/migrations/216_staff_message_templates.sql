-- Migration 216: staff_message_templates — editable shells for Adir/Eliad notifications & digests.
-- Edited via Executive Playbook → הודעות ודוחות. Edge functions load with 5min cache.

CREATE TABLE IF NOT EXISTS public.staff_message_templates (
  template_key     TEXT        PRIMARY KEY,
  recipient_role   TEXT        NOT NULL CHECK (recipient_role IN ('front_desk', 'executive')),
  category         TEXT        NOT NULL CHECK (category IN ('scheduled', 'event', 'digest_shell')),
  display_name_he  TEXT        NOT NULL,
  channel_hint     TEXT,
  message_text     TEXT,
  digest_config    JSONB,
  is_active        BOOLEAN     NOT NULL DEFAULT true,
  sort_order       INTEGER     NOT NULL DEFAULT 0,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_staff_message_templates_updated ON public.staff_message_templates;
CREATE TRIGGER trg_staff_message_templates_updated
  BEFORE UPDATE ON public.staff_message_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_staff_message_templates_recipient
  ON public.staff_message_templates (recipient_role, sort_order);

ALTER TABLE public.staff_message_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY staff_message_templates_read ON public.staff_message_templates
  FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE POLICY staff_message_templates_write ON public.staff_message_templates
  FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY cleaner_lockdown_staff_message_templates ON public.staff_message_templates
  AS RESTRICTIVE FOR ALL
  USING (COALESCE(public.get_true_role(), '') <> 'cleaner')
  WITH CHECK (COALESCE(public.get_true_role(), '') <> 'cleaner');

-- ── Seeds (message_text uses {{placeholders}} resolved at send time) ─────────

INSERT INTO public.staff_message_templates
  (template_key, recipient_role, category, display_name_he, channel_hint, message_text, digest_config, sort_order)
VALUES
(
  'adir_morning_brief',
  'front_desk', 'scheduled',
  'בריף בוקר יומי (07:00)',
  'whapi',
  NULL,
  '{
    "greeting": "בוקר טוב אדיר 🌅",
    "title": "עוזרת דלפק הסוויטות — סיכום להיום ({{date_he}})",
    "snapshot": "📊 במבט: {{today_total}} הגעות היום | {{missing_time}} בלי שעה | {{open_summary}}",
    "eta_note": "🕐 {{eta_count}} שעות הגעה רשומות בלוח",
    "tomorrow_note": "📅 מחר: {{tomorrow_total}} הגעות",
    "missing_time_cta": "רוצה שאשלח הודעה קצרה לבקש שעת הגעה מ-{{missing_time}} האורחים שעדיין בלי שעה? רק תגיד לי \"כן, תשלחי\".",
    "open_header": "🔔 בקשות פתוחות (לטיפול):",
    "power_hints": "💪 מה אתה יכול לבקש ממני (קול או טקסט):\n• «לוח הגעות» / «מי בלי שעה?»\n• «טיפלתי בבקשת חדר 7»\n• «חדר 5 מוכן»\nשעות הגעה מאורחים מגיעות אליך אוטומטית 🕐"
  }'::jsonb,
  10
),
(
  'adir_onboarding',
  'front_desk', 'scheduled',
  'מדריך יכולות (חד-פעמי)',
  'whapi',
  $onb$אדיר, בוקר טוב 🌅

זו הודעה חד-פעמית — מדריך מלא לעוזרת דלפק הסוויטות שלך.
מעכשיו, כל בוקר תקבל רק את סיכום ההגעות והבקשות.
אם משהו לא ברור — פשוט תשאל אותי.

━━━━━━━━━━━━━━━━━━━━
📱 איך מדברים איתי?
━━━━━━━━━━━━━━━━━━━━
שלח הודעה קולית או טקסט למכשיר הסוויטות (Whapi).
אני עונה בעברית ומבצעת פעולות אמיתיות במערכת.

━━━━━━━━━━━━━━━━━━━━
🔔 מה מגיע אליך אוטומטית
━━━━━━━━━━━━━━━━━━━━
• בוקר — סיכום הגעות היום/מחר + בקשות פתוחות
• שעת הגעה — כשאורח מדווח (Dream Bot / מכשיר סוויטות)
• התראות — בקשות שלא טופלו, אורח שמחכה, הזמנות מהפורטל, מלאי

━━━━━━━━━━━━━━━━━━━━
🕐 הגעות (עד ~16:00)
━━━━━━━━━━━━━━━━━━━━
«לוח הגעות» / «מי מגיע היום?»
«מי בלי שעת הגעה?»
«מי מגיע מחר?»
«תשלחי לבקש שעות» — רק אחרי שאתה מאשר «כן»
«חדר 5 מוכן» — מעדכנת + שולחת לאורח

━━━━━━━━━━━━━━━━━━━━
📋 בקשות אורחים
━━━━━━━━━━━━━━━━━━━━
«מה פתוח לי?» / «יש בקשות?»
«טיפלתי בבקשת חדר 7» — מסמנת כטופל

━━━━━━━━━━━━━━━━━━━━
👤 מידע על אורח / תפעול
━━━━━━━━━━━━━━━━━━━━
«מי בחדר אמטיסט 5?» | «מי בריזורט?»
«פתחי משימה — מגבות לחדר 8»
«מה פתוח בתחזוקה?»
«שלחי לאורח בחדר 7: ...»

━━━━━━━━━━━━━━━━━━━━
🧠 למידה והסלמה
━━━━━━━━━━━━━━━━━━━━
«תזכרי שתמיד תציגי VIP ראשון»
פיצוי / VIP מורכב → «תעדכני את אליעד — ...»

⛔ אין צ'ק-אין/ביטול/שינוי תאריכים — רק במסך הניהול.

📋 לוח בקשות: {{requests_board_link}}
💬 אינבוקס: {{inbox_link}}

מוכנה. מה תרצה לבדוק קודם? 🙏$onb$,
  NULL,
  20
),
(
  'adir_arrival_eta',
  'front_desk', 'event',
  'שעת הגעה מאורח',
  'whapi',
  $eta${{headline}}

👤 {{guest_name}} | 🏨 {{room}}
📅 {{date_label}} | 🕐 {{time_line}}
📱 מקור: {{channel_label}}
{{quote_line}}

👉 מה לעשות:
עדכן בלוח ההגעות או ענה לאורח אם צריך.
{{inbox_line}}
📋 לוח בקשות: {{requests_board_link}}$eta$,
  NULL,
  30
),
(
  'adir_guest_alert_sla',
  'front_desk', 'event',
  'בקשת אורח — חריגת זמן (10 דק׳)',
  'meta',
  $sla$⚠️ בקשת אורח ממתינה יותר מדי
עברו {{age_minutes}} דק׳ (המקסימום: {{threshold_minutes}} דק׳).

👤 {{guest_label}}
📌 {{alert_type_label}}
💬 «{{message}}»

👉 מה לעשות:
ענה לאורח או סגור את הבקשה בלוח הבקשות.
{{inbox_line}}
📋 לוח בקשות: {{requests_board_link}}
{{future_note}}$sla$,
  NULL,
  40
),
(
  'adir_pre_checkin_request',
  'front_desk', 'event',
  'בקשה לפני צ׳ק-אין',
  'whapi',
  $pre$🌴 בקשה מאורח לפני צ׳ק-אין

🏨 {{room}} | 👤 {{guest_name}}
💬 {{summary}}
{{timing_line}}

👉 מה לעשות:
זו התראה מוקדמת — הבקשה כבר בלוח הבקשות.
אפשר לתאם מראש לפני ההגעה.

📋 לוח בקשות: {{requests_board_link}}$pre$,
  NULL,
  50
),
(
  'adir_portal_order',
  'front_desk', 'event',
  'הזמנה מהפורטל',
  'whapi',
  $ord$🛎️ הזמנה חדשה מהפורטל

{{guest_header}}
{{item_lines}}
{{arrival_tag}}

👉 מה לעשות:
בדוק בלוח התפעול או בלשונית ההזמנות במערכת.$ord$,
  NULL,
  60
),
(
  'adir_inventory_submit',
  'front_desk', 'event',
  'דוח מלאי ממתין לאישור',
  'whapi',
  $inv$📦 דוח מלאי חדש ממתין לאישור

📍 {{location_name}}
{{item_count}} פריטים דווחו

👉 מה לעשות:
פתח את תור אישורי המלאי במערכת ואשר או דחה.

📦 מלאי ואישורים: {{agent_link}}$inv$,
  NULL,
  70
),
(
  'adir_soft_handoff',
  'front_desk', 'event',
  'אורח מחכה לתשובה (20 דק׳)',
  'meta',
  $soft$⚠️ אורח מחכה לתשובה
עברו {{age_minutes}} דק׳ מאז שהבוט העביר לצוות.

👤 {{guest_label}}
📌 {{request_type_label}}
💬 «{{preview}}»

👉 מה לעשות:
זו בקשה שלא דורשת תחזוקה בשטח (ספא / חיוב / שינוי תאריך).
ענה לאורח מהאינבוקס — אל תפתח כרטיס תחזוקה.
{{inbox_line}}
📋 לוח בקשות: {{requests_board_link}}$soft$,
  NULL,
  80
),
(
  'eliad_digest_shell',
  'executive', 'digest_shell',
  'דוח תפעולי (יומי/שבועי/חודשי)',
  'whapi',
  NULL,
  '{
    "opening_line": "📋 {{name}}, כאן העוזרת האישית שלך",
    "period_line": "דוח תפעולי {{period_he}} — {{period_label}}",
    "sla_label": "עמידה ביעדי זמן הטיפול",
    "footer_1": "רוצה לשנות משהו בדוחות? כתוב לי «תזכרי ש…» — אשמור להבא.",
    "footer_2": "לעדכון חי: «מה מצב הריזורט?» או «תן לי דוח יומי עכשיו».",
    "action_hint_quiet": "👉 מצב שקט — אין פעולה דחופה מהדוח. שאל אותי «מה מצב הריזורט?» לעדכון חי."
  }'::jsonb,
  100
)
ON CONFLICT (template_key) DO NOTHING;

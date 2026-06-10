-- ================================================================
-- Migration 019: message_templates table
--
-- Dynamic broadcast templates fetched live by BroadcastDashboard.js.
-- Seeds with Dream Island's 4 official sales templates.
-- Managers can add/remove rows directly in the DB or via future UI.
-- ================================================================

CREATE TABLE IF NOT EXISTS public.message_templates (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  label      TEXT        NOT NULL,
  content    TEXT        NOT NULL,
  sort_order INTEGER     DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Row Level Security
ALTER TABLE public.message_templates ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read (all managers see templates)
CREATE POLICY msg_templates_read ON public.message_templates
  FOR SELECT USING (auth.uid() IS NOT NULL);

-- Any authenticated user can write (managers can save custom templates in future)
CREATE POLICY msg_templates_write ON public.message_templates
  FOR ALL USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- ── Seed: Dream Island official broadcast templates ───────────────────────────
INSERT INTO public.message_templates (label, content, sort_order) VALUES

(
  'בילוי יומי מים וספא',
  'היי {{guest_name}}! הבילוי היומי בדרים איילנד הוא מסע של ניתוק. מחכים לכם 1,500 מ״ר של תענוגות מים, 3 בריכות זרמים, חמאם טורקי ענק וטיפולי וואטסו (Watsu). לשריין מקום: [לינק]',
  1
),

(
  'קולינריה - ערמונים ועמדות אוכל',
  E'שלום {{guest_name}}! 🍷 כשתגיעו לריזורט, תוכלו ליהנות מנשנושים חופשיים בעמדות האוכל שלנו לאורך כל היום. לארוחת ערב יוקרתית ורומנטית על שפת האגם, שריינו מקום מראש במסעדת השף \'ערמונים\': [לינק]',
  2
),

(
  'סוויטות VIP',
  'היי {{guest_name}}! מחפשים פרטיות מוחלטת? 🌴 שדרגו את החופשה שלכם לסוויטת VIP מבודדת, הכוללת בריכה פרטית או Hot Tub מול הנוף. לפרטים וזמינות: [לינק]',
  3
),

(
  'נהלים',
  'אורחים יקרים {{guest_name}}, תזכורת קטנה לקראת הגעתכם: הריזורט שלנו נועד להעניק לכם שקט מוחלט, ולכן האירוח מיועד למבוגרים בלבד (Adults Only). כמו כן, לא מתאפשרת כניסה לבעלי חיים. נתראה בקרוב! ✨',
  4
);

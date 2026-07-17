-- 229: ACC toggle — auto-append Stage 1 «כן, מגיעים» CTA on Whapi when missing from script.
-- Default ON (safety net). Staff can disable in ניהול חכם → שלב 1.

INSERT INTO public.bot_config (config_key, config_value, category, label)
VALUES (
  'stage1_auto_append_cta',
  'true',
  'automation',
  'שלב 1 — הצמד אוטומטית שורת «כן, מגיעים» במכשיר הסוויטות אם חסרה בסקריפט'
)
ON CONFLICT (config_key) DO NOTHING;

-- Migration 025: Link message_templates to Meta WA templates
-- Adds wa_template_name (Meta template name) and workshop_link (per-template URL).
-- Inserts 'אישור הגעה' as the first template in the automation sequence (sort_order=0).

ALTER TABLE public.message_templates
  ADD COLUMN IF NOT EXISTS wa_template_name TEXT,
  ADD COLUMN IF NOT EXISTS workshop_link    TEXT;

COMMENT ON COLUMN public.message_templates.wa_template_name
  IS 'Corresponding Meta WA approved template name (e.g. dream_arrival_confirmation)';
COMMENT ON COLUMN public.message_templates.workshop_link
  IS 'Workshop / activity sign-up URL shown to guest after arrival confirmation';

-- ── Seed: Arrival confirmation — template #1 in the automation flow ───────────
INSERT INTO public.message_templates (label, content, sort_order, wa_template_name, workshop_link)
VALUES (
  'אישור הגעה 🌴',
  E'היי {{1}}! ברוכים הבאים ל-Dream Island Resort & Spa 🤍\nמחכים לכם עם המון אהבה.\nהאם אתם מגיעים בתאריך המתוכנן?',
  0,
  'dream_arrival_confirmation',
  NULL
)
ON CONFLICT DO NOTHING;

-- ── Update existing templates with workshop link ──────────────────────────────
-- Templates that naturally lead a guest to workshops get the sign-up URL.
UPDATE public.message_templates
SET workshop_link = 'https://go.oncehub.com/DreamIsland'
WHERE sort_order IN (1, 2)          -- בילוי יומי, קולינריה
  AND workshop_link IS NULL;

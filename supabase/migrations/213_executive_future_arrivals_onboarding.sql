-- Migration 213: Sync executive persona row with future-arrivals tool + onboarding hints.
-- Code DEFAULT_PERSONA_TEMPLATE already includes these; this keeps the live DB row aligned.

UPDATE public.executive_bot_settings
SET persona_prompt = CASE
  WHEN persona_prompt IS NULL OR btrim(persona_prompt) = '' THEN persona_prompt
  WHEN persona_prompt LIKE '%list_guests_by_date%' THEN persona_prompt
  ELSE persona_prompt || E'\n• לשאלות על מחר / תאריך עתידי — קראי ל-list_guests_by_date; אל תגידי שאין אפשרות לבדוק ימים עתידיים.'
END
WHERE id = 1;

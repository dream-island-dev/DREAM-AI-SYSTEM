-- Migration 187: Append digest-learning note to executive persona (live DB row).
-- Code DEFAULT_PERSONA_TEMPLATE already includes the same rule; this keeps the seeded row in sync.

UPDATE public.executive_bot_settings
SET persona_prompt = CASE
  WHEN persona_prompt IS NULL OR btrim(persona_prompt) = '' THEN persona_prompt
  WHEN persona_prompt LIKE '%דוחות התפעול%' THEN persona_prompt
  ELSE persona_prompt || E'\n• דוחות התפעול היומיים/שבועיים נשלחים ממך (העוזרת האישית) בעברית מסודרת. אם המנכ״ל אומר «תזכרי ש…» / «מעכשיו תמיד…» לגבי הדוח — קראי ל-learn_executive_rule כדי שישפיע על הדוחות הבאים.'
END
WHERE id = 1;

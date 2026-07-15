-- Migration 215: Executive persona — clearer «אני העוזרת האישית של {{name}}» opening (Eliad + shared template).
-- Prepends identity block when live row still has the old את/ה העוזר/ת opening.

UPDATE public.executive_bot_settings
SET persona_prompt = E'אני העוזרת האישית של {{name}}, {{title}} ב-Dream Island.\nאני מדברת איתו ישירות בוואטסאפ (מכשיר הסוויטות) — שיחה פנימית עם {{name}}, לא עם אורח.\n\n{{focus}}\n\n' || persona_prompt
WHERE id = 1
  AND persona_prompt IS NOT NULL
  AND btrim(persona_prompt) <> ''
  AND persona_prompt NOT LIKE '%אני העוזרת האישית של {{name}}%'
  AND (persona_prompt LIKE 'את/ה העוזר%' OR persona_prompt LIKE 'אתה מדבר%');

UPDATE public.executive_bot_settings
SET persona_prompt = persona_prompt || E'\n• פני אליו ישירות («{{name}}, …») — את עוזרתו האישית, לא בוט כללי. עברית, 2–4 משפטים.'
WHERE id = 1
  AND persona_prompt IS NOT NULL
  AND persona_prompt NOT LIKE '%עוזרתו האישית, לא בוט כללי%';

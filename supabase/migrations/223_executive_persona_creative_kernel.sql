-- Migration 223: Append shared self-awareness/wit kernel to executive persona (live DB row).
-- Code DEFAULT_PERSONA_TEMPLATE already includes the same block; this keeps the seeded row in sync
-- (same pattern as migrations 187, 213, 215).

UPDATE public.executive_bot_settings
SET persona_prompt = CASE
  WHEN persona_prompt IS NULL OR btrim(persona_prompt) = '' THEN persona_prompt
  WHEN persona_prompt LIKE '%מודעות עצמית (בלי לפטפט%' THEN persona_prompt
  ELSE persona_prompt || E'\n\nמודעות עצמית (בלי לפטפט, בלי להמציא):\n• מה שאת אומרת מבוסס רק על מה שבאמת קראת מהכלים ברגע הזה — אם לא בדקת, תגידי "בודקת עכשיו" ותקראי לכלי, לא תנחשי.\n• דאטה שנראית לא הגיונית — ⚠ גלוי, לא "הכל תקין" מתחת לשטיח.\n• את לא בוט שירות לקוחות: בלי "שלום", בלי "בשמחה לעזור", בלי איחולים גנריים. משפט חד או שנון כשמתאים — לא בכל תשובה.\n• תובנה יזומה (לא נשאלת) — לכל היותר אחת ביום, ורק אם היא נתמכת בדאטה אמיתי שכבר בדקת בשיחה זו.'
END
WHERE id = 1;

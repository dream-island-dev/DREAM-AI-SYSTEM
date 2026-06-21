-- Migration 056: Append a "request acknowledgment" instruction to the live
-- bot_settings.system_prompt row. finalSystemPrompt (whatsapp-webhook) prefers
-- bot_settings.system_prompt over the code-level buildSystemPrompt()/
-- FALLBACK_SYSTEM_PROMPT — so without this, the equivalent instruction already
-- added to those two code prompts would never actually run against Mike's
-- live custom persona. Append-only (preserves the existing persona text) and
-- idempotent (guarded by NOT LIKE so re-running this migration is a no-op).

UPDATE public.bot_settings
SET system_prompt = system_prompt || E'\n\n[הנחיה קריטית]: אם האורח מעלה בקשה, הערה או דרישה ספציפית (למשל בלונים ליום הולדת, ציוד מיוחד, בקשה לחדר) — אשר/י לו בחמימות שזה נרשם ויועבר לצוות. המערכת שומרת זאת אוטומטית בקובץ האורח — תפקידך רק לאשר זאת בתשובה באופן טבעי, לא "לדאוג" לשמירה בעצמך.'
WHERE id = 1
  AND system_prompt IS NOT NULL
  AND system_prompt NOT LIKE '%הנחיה קריטית%בקשה, הערה או דרישה%';

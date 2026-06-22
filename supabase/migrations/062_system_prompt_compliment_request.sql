-- Migration 062: Append a "compliment the specific choice" enhancement to the
-- live bot_settings.system_prompt row. Migration 056 already appended a
-- generic "warmly confirm it's noted and forwarded" instruction; this adds
-- the more specific behavior requested for Phase 2: compliment the guest's
-- actual choice (e.g. "Great choice of wine!") before stating it's forwarded.
-- Append-only (preserves migration 056's text and Mike's custom persona) and
-- idempotent (guarded by NOT LIKE so re-running this migration is a no-op).
-- Same reasoning as migrations 056/058: finalSystemPrompt (whatsapp-webhook)
-- prefers bot_settings.system_prompt over the code-level prompts, so without
-- this live-row append the equivalent code-level wording never actually runs
-- against Mike's live custom persona.

UPDATE public.bot_settings
SET system_prompt = system_prompt || E'\n\n[הנחיה קריטית - בקשות אורח]: כאשר אורח/ת מעלה בקשה ספציפית וניתנת למימוש (למשל יין, פרחים, בלונים, ציוד מיוחד לחדר) — תחילה החמא/י בטבעיות ובקצרה על הבחירה שלו/ה (למשל "בחירה נהדרת!" או "טעם מצוין!"), ולאחר מכן ציין/י בבירור שהבקשה הועברה לצוות המלון ושיטפלו בה בהקדם. אל תמציא/י זמן טיפול משוער. המערכת שומרת ומעבירה את הבקשה אוטומטית — תפקידך רק לנסח את התשובה באופן טבעי.'
WHERE id = 1
  AND system_prompt IS NOT NULL
  AND system_prompt NOT LIKE '%הנחיה קריטית - בקשות אורח%';

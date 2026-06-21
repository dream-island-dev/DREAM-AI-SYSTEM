-- Migration 058: Append a "use known personal data directly" instruction to
-- the live bot_settings.system_prompt row. Same reason as migration 056:
-- finalSystemPrompt (whatsapp-webhook) prefers bot_settings.system_prompt
-- over the code-level buildSystemPrompt()/FALLBACK_SYSTEM_PROMPT, so without
-- this the equivalent code-level instruction never runs against Mike's live
-- custom persona. Append-only, idempotent (guarded by NOT LIKE).
--
-- Root cause being fixed: guests asking "what time is my spa appointment?"
-- in free text were getting deferred to reception even when spa_time was
-- already present in the guest-stage context injected into the prompt —
-- the model was treating "I'm not 100% certain" as license to defer, this
-- instruction makes the priority explicit instead of relying on inference.

UPDATE public.bot_settings
SET system_prompt = system_prompt || E'\n\n[הנחיה קריטית - מידע אישי]: אם האורח שואל על פרט אישי שלו (למשל שעת טיפול ספא, מספר חדר, תאריך הגעה) והפרט הזה כן מופיע ב"פרטי האורח הנוכחי" שצורפו לשיחה — ענה לו ישירות עם הערך המדויק. אל תפנה אותו לקבלה ואל תכתוב שאינך יודע כשהמידע נמצא לפניך. הפניה לקבלה מתאימה רק כשהפרט באמת לא מופיע בהקשר שצורף.'
WHERE id = 1
  AND system_prompt IS NOT NULL
  AND system_prompt NOT LIKE '%הנחיה קריטית - מידע אישי%';

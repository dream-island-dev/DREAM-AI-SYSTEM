-- Migration 063: Remove the rigid "2-4 sentences only" length cap that has
-- been silently re-seeded into three live DB rows since migration 034
-- (bot_sales_directives) overwrote bot_settings.system_prompt and
-- bot_scripts.ongoing_concierge.ai_system_prompt wholesale, and migration 015
-- originally seeded the same idea into bot_config (key='bot_personality').
--
-- Root cause of guest-facing mid-sentence truncation: telling the model "only
-- 2-4 sentences" creates strong pressure to cut content short — exactly the
-- failure mode session 15 partially fixed (it removed an equivalent
-- call-time-appended suffix and raised max_tokens), but never touched this
-- text baked directly into the persona/system-prompt content itself. Later
-- append-only migrations (056/058/062) only ever added text after this
-- sentence — none of them removed it, so it survived untouched in the live
-- row this entire time.
--
-- REPLACE() is naturally idempotent (no-op if the substring isn't present),
-- the WHERE...LIKE guards just avoid bumping updated_at when there's nothing
-- to change. Surgical removal only — the rest of each field's text (sales
-- directives, persona, "don't reveal you're AI", etc.) is left untouched.

UPDATE public.bot_settings
SET system_prompt = REPLACE(system_prompt, 'תשובות קצרות ומדויקות: 2–4 משפטים בלבד. ', ''),
    updated_at    = NOW()
WHERE id = 1
  AND system_prompt LIKE '%תשובות קצרות ומדויקות: 2–4 משפטים בלבד%';

UPDATE public.bot_scripts
SET ai_system_prompt = REPLACE(ai_system_prompt, 'תשובות קצרות ומדויקות: 2–4 משפטים בלבד. ', ''),
    updated_at       = NOW()
WHERE script_key = 'ongoing_concierge'
  AND ai_system_prompt LIKE '%תשובות קצרות ומדויקות: 2–4 משפטים בלבד%';

UPDATE public.bot_config
SET config_value = REPLACE(config_value, 'תשובות קצרות ומדויקות: 2–4 משפטים.', ''),
    updated_at    = NOW()
WHERE config_key = 'bot_personality'
  AND config_value LIKE '%תשובות קצרות ומדויקות: 2–4 משפטים%';

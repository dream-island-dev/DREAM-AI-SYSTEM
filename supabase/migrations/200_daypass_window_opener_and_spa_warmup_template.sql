-- 200: Day-pass Option C — window-opener CTAs + spa_warmup Meta template wire
--
-- 1) Evening / morning scripts nudge guest reply ("מחכים לכם!") so Meta 24h
--    window opens → spa_warmup + survey can go free-text when Dream Bot is used.
-- 2) interactive_buttons on night_before_daypass + morning_welcome (QR for Meta
--    session path; Whapi still gets plain CTA in script text).
-- 3) spa_warmup_daypass.meta_template_name = dream_spa_warmup (Dream Bot backup).
-- 4) night_before_daypass.meta_template_name = dream_daypass_eve (cold-start QR).

UPDATE bot_scripts
SET message_text = E'מחר היום הגדול {{GUEST_NAME}}! ☀️\n\nרוצים להזכיר — מחר מחכה לכם יום מדהים בריזורט.\nכל הצוות שלנו כבר מתארגן ומתרגש לקראת ביקורכם.\n\nלילה טוב ומנוחה 🤍\n\nנשמח לאישור קצר — לחצו «מחכים לכם!» או כתבו את זה כאן 🌴'
WHERE script_key = 'night_before_daypass';

UPDATE bot_scripts
SET message_text = E'בוקר אור {{GUEST_NAME}}! ☀️ היום זה היום! הריזורט מוכן, השמש בחוץ, וכל הצוות שלנו כבר מחכה להעניק לכם חוויה בלתי נשכחת...\n\nכמה פרטים קטנים וחשובים לדרך:\n🌸 מתחמי הריזורט, הבריכות והמתחמים פתוחים עבורכם כבר מהשעה 09:00.\n\nמאחלים לכם יום Dreamy 🤍\n\nנשמח לאישור קצר — לחצו «מחכים לכם!» או כתבו את זה כאן 🌴'
WHERE script_key = 'morning_daypass';

UPDATE automation_stages
SET interactive_buttons = '[{"type":"quick_reply","label":"מחכים לכם!"}]'::jsonb
WHERE stage_key IN ('night_before_daypass', 'morning_welcome');

UPDATE automation_stages
SET meta_template_name = 'dream_spa_warmup'
WHERE stage_key = 'spa_warmup_daypass';

UPDATE automation_stages
SET meta_template_name = 'dream_daypass_eve'
WHERE stage_key = 'night_before_daypass';

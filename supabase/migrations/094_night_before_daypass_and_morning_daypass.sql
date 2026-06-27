-- migration 093: Split Stage 2.5 (night_before) into suite + day-pass variants,
-- and seed bot_scripts fallback text for both new paths.
--
-- Architectural decision: keeps the cron data-driven (reads automation_stages),
-- adds a second stage_key 'night_before_daypass' with applies_to='non_suite'
-- so day_guest guests fire a separate cron call → whatsapp-send routes to
-- dream_checkin_reminder_v2. Suite guests continue on 'night_before'.
--
-- No whatsapp-cron code changes required — the resolver already handles
-- applies_to='suite'/'non_suite' filtering (automationSchedule.ts:106-107).

-- ── 1. Rename night_before to suites-only ──────────────────────────────────
UPDATE automation_stages
SET
  applies_to   = 'suite',
  display_name = 'Stage 2.5 — תזכורת ערב לפני (סוויטות)'
WHERE stage_key = 'night_before';

-- ── 2. Add night_before_daypass stage (copy timing from night_before) ──────
-- node_type='hybrid': tries 24h free-text script (session_message_script_key),
-- falls back to meta_template if window closed — same as night_before itself.
INSERT INTO automation_stages (
  stage_key,
  display_name,
  journey_phase,
  sequence_order,
  node_type,
  schedule_mode,
  anchor_event,
  day_offset,
  local_time,
  local_time_end,
  applies_to,
  meta_template_name,
  session_message_script_key,
  guest_flag_column,
  is_active
)
SELECT
  'night_before_daypass'                         AS stage_key,
  'Stage 2.5 — תזכורת ערב לפני (בילוי יומי)'   AS display_name,
  journey_phase,
  151                                            AS sequence_order,  -- between night_before(150) and morning_suite(200)
  'hybrid'                                       AS node_type,
  schedule_mode,
  anchor_event,
  day_offset,
  local_time,
  local_time_end,
  'non_suite'                                    AS applies_to,
  'dream_checkin_reminder_v2'                    AS meta_template_name,
  'night_before_daypass'                         AS session_message_script_key,
  'msg_pre_arrival_sent'                         AS guest_flag_column,  -- mutual-exclusivity guaranteed by applies_to
  true                                           AS is_active
FROM automation_stages
WHERE stage_key = 'night_before';

-- ── 3. Seed bot_scripts: Stage 2.5 day-pass 24h free-text fallback ─────────
-- Used by BRANCH D session_message path in whatsapp-send when wa_window is open.
-- Editable via BotScriptEditor without code changes.
INSERT INTO bot_scripts (script_key, display_name, trigger_event, message_text, is_active)
VALUES (
  'night_before_daypass',
  'Stage 2.5 — תזכורת ערב לפני (בילוי יומי)',
  'morning_of',
  E'מחר היום הגדול {{GUEST_NAME}}! ☀️\n\nרוצים להזכיר — מחר מחכה לכם יום מדהים בריזורט.\nכל הצוות שלנו כבר מתארגן ומתרגש לקראת ביקורכם.\n\nלילה טוב ומנוחה 🤍',
  true
)
ON CONFLICT (script_key) DO UPDATE
  SET display_name = EXCLUDED.display_name,
      message_text = EXCLUDED.message_text,
      is_active    = EXCLUDED.is_active;

-- ── 4. Seed bot_scripts: Stage 3 morning day-pass free-text ────────────────
-- Used by whatsapp-send morning day_guest early-return when wa_window is open.
INSERT INTO bot_scripts (script_key, display_name, trigger_event, message_text, is_active)
VALUES (
  'morning_daypass',
  'Stage 3 — בוקר הגעה (בילוי יומי)',
  'morning_of',
  E'בוקר אור {{GUEST_NAME}}! ☀️ היום זה היום! הריזורט מוכן, השמש בחוץ, וכל הצוות שלנו כבר מחכה להעניק לכם חוויה בלתי נשכחת...\n\nכמה פרטים קטנים וחשובים לדרך:\n🌸 מתחמי הריזורט, הבריכות והמתחמים פתוחים עבורכם כבר מהשעה 09:00.\n\nמאחלים לכם יום Dreamy 🤍',
  true
)
ON CONFLICT (script_key) DO UPDATE
  SET display_name = EXCLUDED.display_name,
      message_text = EXCLUDED.message_text,
      is_active    = EXCLUDED.is_active;

-- migration 099: Split Stage 4 (mid_stay) and Stage 5 (checkout_fb) into
-- suite-only + day-pass-only rows — mirrors migration 094's night_before split.
-- Cron stays data-driven (automation_stages + applies_to filter); whatsapp-send
-- DAY_PASS_ALLOWED_TRIGGERS updated to use *_daypass keys instead of shared ones.

-- ── 1. Suite-only labels on existing rows ───────────────────────────────────
UPDATE automation_stages
SET
  applies_to   = 'suite',
  display_name = 'Stage 4 — שיחות נימוסים (סוויטות) 🏨',
  is_active    = true
WHERE stage_key = 'mid_stay';

UPDATE automation_stages
SET
  applies_to   = 'suite',
  display_name = 'Stage 5 — פידבק יציאה (סוויטות) ⭐',
  is_active    = true
WHERE stage_key = 'checkout_fb';

-- ── 2. Stage 4 — day-pass mid-visit check (same day as arrival) ─────────────
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
  'mid_stay_daypass'                              AS stage_key,
  'Stage 4 — שיחות נימוסים (בילוי יומי) 🏃'      AS display_name,
  journey_phase,
  305                                             AS sequence_order,
  node_type,
  schedule_mode,
  anchor_event,
  0                                               AS day_offset,
  '16:00'                                         AS local_time,
  NULL                                            AS local_time_end,
  'non_suite'                                     AS applies_to,
  meta_template_name,
  'mid_stay_daypass'                              AS session_message_script_key,
  'msg_mid_stay_sent'                             AS guest_flag_column,
  true                                            AS is_active
FROM automation_stages
WHERE stage_key = 'mid_stay'
ON CONFLICT (stage_key) DO UPDATE SET
  display_name                 = EXCLUDED.display_name,
  journey_phase                = EXCLUDED.journey_phase,
  sequence_order               = EXCLUDED.sequence_order,
  node_type                    = EXCLUDED.node_type,
  schedule_mode                = EXCLUDED.schedule_mode,
  anchor_event                 = EXCLUDED.anchor_event,
  day_offset                   = EXCLUDED.day_offset,
  local_time                   = EXCLUDED.local_time,
  local_time_end               = EXCLUDED.local_time_end,
  applies_to                   = EXCLUDED.applies_to,
  meta_template_name           = EXCLUDED.meta_template_name,
  session_message_script_key   = EXCLUDED.session_message_script_key,
  guest_flag_column            = EXCLUDED.guest_flag_column,
  is_active                    = EXCLUDED.is_active;

-- ── 3. Stage 5 — day-pass checkout feedback ─────────────────────────────────
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
  'checkout_fb_daypass'                           AS stage_key,
  'Stage 5 — פידבק יציאה (בילוי יומי) ⭐'         AS display_name,
  journey_phase,
  405                                             AS sequence_order,
  node_type,
  schedule_mode,
  anchor_event,
  day_offset,
  local_time,
  local_time_end,
  'non_suite'                                     AS applies_to,
  meta_template_name,
  'checkout_fb_daypass'                           AS session_message_script_key,
  'msg_checkout_fb_sent'                          AS guest_flag_column,
  true                                            AS is_active
FROM automation_stages
WHERE stage_key = 'checkout_fb'
ON CONFLICT (stage_key) DO UPDATE SET
  display_name                 = EXCLUDED.display_name,
  journey_phase                = EXCLUDED.journey_phase,
  sequence_order               = EXCLUDED.sequence_order,
  node_type                    = EXCLUDED.node_type,
  schedule_mode                = EXCLUDED.schedule_mode,
  anchor_event                 = EXCLUDED.anchor_event,
  day_offset                   = EXCLUDED.day_offset,
  local_time                   = EXCLUDED.local_time,
  local_time_end               = EXCLUDED.local_time_end,
  applies_to                   = EXCLUDED.applies_to,
  meta_template_name           = EXCLUDED.meta_template_name,
  session_message_script_key   = EXCLUDED.session_message_script_key,
  guest_flag_column            = EXCLUDED.guest_flag_column,
  is_active                    = EXCLUDED.is_active;

-- ── 4. bot_scripts — editable session-message bodies for day-pass hybrid path
INSERT INTO bot_scripts (script_key, display_name, trigger_event, message_text, is_active)
VALUES
(
  'mid_stay_daypass',
  'Stage 4 — שיחות נימוסים (בילוי יומי)',
  'mid_stay',
  E'{{GUEST_NAME}}, הזמן עף כשנהנים... 🤍\n\nרק רצינו לעצור לרגע ולוודא שאתם נהנים ומנצלים את כל הטוב שיש לדרים איילנד להציע.\n\nאם חסר לכם משהו בסוויטה, או אם אתם צריכים משהו, פשוט תכתבו לנו כאן תגובה חופשית. תמשיכו ליהנות! ✨',
  true
),
(
  'checkout_fb_daypass',
  'Stage 5 — פידבק יציאה (בילוי יומי)',
  'ongoing',
  E'{{GUEST_NAME}}, תודה שביקרתם אצלנו היום! ⭐\n\nנשמח לשמוע איך היה — לחצו על אחת האפשרויות למטה 🙏',
  true
)
ON CONFLICT (script_key) DO UPDATE
  SET display_name  = EXCLUDED.display_name,
      trigger_event = EXCLUDED.trigger_event,
      message_text  = EXCLUDED.message_text,
      is_active     = EXCLUDED.is_active;

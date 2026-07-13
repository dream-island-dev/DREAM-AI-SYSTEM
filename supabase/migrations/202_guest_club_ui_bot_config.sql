-- 202: Editable Guest Club opt-in labels (bot_config JSON).
-- Staff edits from Feedback → Surveys (preview + editor). Portal reads via
-- guest-portal-data.portalConfig.club_ui.

INSERT INTO bot_config (config_key, config_value, category, label)
VALUES (
  'guest_club_ui',
  '{
    "title": "🌴 מועדון לקוחות Dream Island",
    "body": "רוצים לקבל הצעות בלעדיות לאירועים וסדנאות מיוחדים במתחם?",
    "join_label": "כן, אני רוצה ✨",
    "decline_label": "לא תודה",
    "joined_confirm": "אתם במועדון — נעדכן בהצעות בלעדיות ✨"
  }',
  'general',
  'תוויות הצטרפות למועדון לקוחות (JSON)'
)
ON CONFLICT (config_key) DO NOTHING;

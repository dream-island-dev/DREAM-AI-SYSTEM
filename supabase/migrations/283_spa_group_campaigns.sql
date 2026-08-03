-- 283: Spa group campaign registry — wa.me link token → day-pass profile + spa lead.
-- Everest 2026-08-10 seeded; edit bot_config.spa_group_campaigns for future groups.

INSERT INTO bot_config (config_key, config_value, category, label)
VALUES (
  'spa_group_campaigns',
  '{
    "campaigns": [
      {
        "id": "everest-2026-08-10",
        "token": "XOS-EVE-1008",
        "label": "אוורסט טכנולוגיות",
        "arrival_date": "2026-08-10",
        "enabled": true
      }
    ]
  }',
  'general',
  'קמפיינים — ליד ספא מקישור קבוצת WA (JSON)'
)
ON CONFLICT (config_key) DO UPDATE
  SET config_value = EXCLUDED.config_value,
      label        = EXCLUDED.label;

-- Migration 197: Editable Guest Experience Survey UI labels (bot_config JSON).
-- Category keys stay frozen to guest_surveys columns; staff edits Hebrew strings
-- from Feedback → Surveys (preview + editor). Guest Portal reads via
-- guest-portal-data.portalConfig.survey_ui.

INSERT INTO bot_config (config_key, config_value, category, label)
VALUES (
  'guest_survey_ui',
  '{
    "panel_title": "📊 ספרו לנו איך היה",
    "overall_label": "החוויה הכללית (1-10)",
    "free_text_label": "רוצים להוסיף כמה מילים? (לא חובה)",
    "free_text_placeholder": "ספרו לנו עוד...",
    "submit_label": "📨 שליחת הסקר",
    "categories": [
      {"key": "patio", "label": "החצר / הפטיו"},
      {"key": "live_kitchen", "label": "המטבח החי"},
      {"key": "chestnut_restaurant", "label": "מסעדת ערמונים"},
      {"key": "service_team", "label": "צוות השירות"},
      {"key": "spa", "label": "הספא"},
      {"key": "cleaning_maintenance", "label": "ניקיון ותחזוקה"}
    ]
  }',
  'general',
  'תוויות סקר חוויית אורח (JSON)'
)
ON CONFLICT (config_key) DO NOTHING;

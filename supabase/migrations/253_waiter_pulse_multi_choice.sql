-- Waiter Service Pulse — choice questions: single → multi select.

UPDATE public.bot_config
SET config_value = jsonb_set(
  jsonb_set(
    config_value::jsonb,
    '{questions,0,type}',
    '"multi_choice"'::jsonb
  ),
  '{questions,0,label}',
  '"מהם צווארי הבקבוק שמעכבים את מהירות השירות שלכם כרגע? (ניתן לבחור כמה)"'::jsonb
)::text
WHERE config_key = 'waiter_service_pulse_ui';

UPDATE public.bot_config
SET config_value = jsonb_set(
  jsonb_set(
    config_value::jsonb,
    '{questions,1,type}',
    '"multi_choice"'::jsonb
  ),
  '{questions,1,label}',
  '"מהן התלונות או הבקשות החוזרות שאתם שומעים מהאורחים במשמרת? (ניתן לבחור כמה)"'::jsonb
)::text
WHERE config_key = 'waiter_service_pulse_ui';

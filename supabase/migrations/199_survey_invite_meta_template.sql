-- 199: Wire survey_invite_daypass → Meta template dream_survey_invite
-- (URL button → Guest Portal #survey). Mike-locked body has no raw portal URL;
-- session/Whapi script keeps {{portal_url}}#survey as plain-text fallback
-- (Whapi cannot render URL buttons).

UPDATE automation_stages
SET meta_template_name = 'dream_survey_invite'
WHERE stage_key = 'survey_invite_daypass';

UPDATE bot_scripts
SET message_text = E'היי {{GUEST_NAME}}, תודה שביליתם איתנו היום! 🌴\n\nנשמח שתדרגו את החוויה שלכם במתחם 🙏🏽\n{{portal_url}}#survey'
WHERE script_key = 'survey_invite_daypass';

-- Migration 224: Per-tier persona tokens for front_desk (Adir) — no CEO-only tool names in prompt.
-- Code DEFAULT_PERSONA_TEMPLATE uses {{learn_rule_tool}} / {{team_analytics_bullet}};
-- buildExecutivePersona() resolves them per assistantTier. Same idempotent pattern as 187/213/215/223.

UPDATE public.executive_bot_settings
SET persona_prompt = replace(persona_prompt, 'learn_executive_rule', '{{learn_rule_tool}}')
WHERE id = 1
  AND persona_prompt LIKE '%learn_executive_rule%';

UPDATE public.executive_bot_settings
SET persona_prompt = replace(
  persona_prompt,
  '• אנליטיקת צוות בקבוצות וואטסאפ — נוכחות, מעורבות תפעולית, זמני סגירת קריאות, checkout→מוכן (get_team_ops_analytics).',
  '{{team_analytics_bullet}}'
)
WHERE id = 1
  AND persona_prompt LIKE '%get_team_ops_analytics%';

-- 265: Meta template wiring — dream_spa_warmup {{1}} only; spa upsell → spa_upsell_daypass.
-- dream_spa_warmup: automation spa_warmup_daypass (30 min before spa_time).
-- spa_upsell_daypass: manual DataSync Dream Bot path (static body, 0 params).

UPDATE public.automation_stages
SET meta_template_name = 'spa_upsell_daypass'
WHERE stage_key = 'spa_upsell_daypass';

COMMENT ON TABLE public.automation_stages IS
  'WhatsApp pipeline stages — ACC UI. spa_upsell_daypass: manual only (is_active=false); Meta template spa_upsell_daypass. spa_warmup_daypass: dream_spa_warmup {{1}} name only.';

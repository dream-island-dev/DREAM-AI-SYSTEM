-- Migration 055: Add bot_settings.preferred_model — dynamic AI engine/model
-- routing for A/B testing and cost optimization. No CHECK constraint: the
-- valid model set already lives in code (GEMINI_MODELS array + CLAUDE_MODEL
-- constant in whatsapp-webhook/index.ts) and shifts whenever Gemini
-- deprecates/adds flash models — validity is enforced in the webhook
-- (resolveModelRoute), not the database.

ALTER TABLE public.bot_settings
  ADD COLUMN IF NOT EXISTS preferred_model TEXT;

COMMENT ON COLUMN public.bot_settings.preferred_model IS
  'Admin-chosen AI engine/model override read by whatsapp-webhook resolveModelRoute(). "claude" or a known Gemini model id pins that engine first (with automatic failover to the other engine preserved). NULL/unrecognized defaults to "claude".';

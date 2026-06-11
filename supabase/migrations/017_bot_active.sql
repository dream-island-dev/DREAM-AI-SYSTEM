-- ================================================================
-- Migration 017: WhatsApp bot active flag
--
-- The WhatsApp Inbox now has a "Human Handover" toggle.
-- Manager can pause the AI bot instantly; all inbound messages
-- are still logged but no automated reply is sent.
--
-- Storage: a row in bot_config with config_key = 'bot_active'.
-- Default value: 'true'  (bot on).
-- Toggling sets value to 'false'.
--
-- The whatsapp-webhook Edge Function reads this key from its
-- 5-min in-memory cache and skips reply generation when 'false'.
-- ================================================================

INSERT INTO public.bot_config (config_key, config_value)
VALUES ('bot_active', 'true')
ON CONFLICT (config_key) DO NOTHING;

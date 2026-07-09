-- Migration 170: bot_config.bot_active_whapi — per-channel bot toggle stub.
--
-- §2 of the Whapi/Meta parity rollout needs a gate for the Whapi guest-DM
-- LLM/FAQ reply (mirrors bot_config.bot_active on the Meta side) before §4
-- builds the real two-toggle UI in WhatsAppInbox.js. Same convention as
-- migration 017_bot_active.sql: a row in bot_config, default 'true' (bot on).
-- Stage 2 arrival confirmation and record-only ETA are NOT gated by this —
-- same invariant Meta's bot_active already has (see
-- _shared/guestInboundOrchestrator.ts).

INSERT INTO public.bot_config (config_key, config_value)
VALUES ('bot_active_whapi', 'true')
ON CONFLICT (config_key) DO NOTHING;

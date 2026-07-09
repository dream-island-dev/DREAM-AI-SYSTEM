-- Migration 171: per-channel staff claim + bot_active_meta alias (§4, Whapi/Meta parity).
--
-- guests.claimed_by/claimed_at (migration 081) stays exactly as-is and keeps
-- meaning "claimed on the Meta (Dream Bot) channel" — every existing reader
-- (whatsapp-webhook, whatsapp-send, whatsapp-cron, automationSchedule.ts,
-- WhatsAppInbox.js) is UNCHANGED. This table is additive: it is the claim
-- store for every OTHER channel (today: Whapi / מכשיר הסוויטות only), so
-- claiming a guest's thread on one channel never mutes the other.

CREATE TABLE IF NOT EXISTS public.guest_channel_claims (
  id            BIGSERIAL PRIMARY KEY,
  guest_id      BIGINT NOT NULL REFERENCES public.guests(id) ON DELETE CASCADE,
  inbox_channel TEXT NOT NULL CHECK (inbox_channel IN ('meta', 'whapi')),
  claimed_by    UUID,
  claimed_at    TIMESTAMPTZ,
  UNIQUE (guest_id, inbox_channel)
);

CREATE INDEX IF NOT EXISTS idx_guest_channel_claims_guest
  ON public.guest_channel_claims (guest_id, inbox_channel);

-- Same permissive "small-team cooperative tool" trust model as guests_read/
-- guests_write (migration 027) — no per-role gate, any authenticated staff
-- member can claim/release on any channel.
ALTER TABLE public.guest_channel_claims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS guest_channel_claims_read  ON public.guest_channel_claims;
DROP POLICY IF EXISTS guest_channel_claims_write ON public.guest_channel_claims;

CREATE POLICY guest_channel_claims_read ON public.guest_channel_claims
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY guest_channel_claims_write ON public.guest_channel_claims
  FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- ── bot_active_meta — alias/mirror of bot_active (backward compat) ─────────
-- whatsapp-webhook keeps reading "bot_active" only, unchanged. This key
-- exists so the parallel bot_active_meta/bot_active_whapi naming is
-- consistent going forward; WhatsAppInbox.js's Dream Bot toggle writes both
-- keys together so they can never drift apart.
INSERT INTO public.bot_config (config_key, config_value)
SELECT 'bot_active_meta', config_value FROM public.bot_config WHERE config_key = 'bot_active'
ON CONFLICT (config_key) DO NOTHING;

INSERT INTO public.bot_config (config_key, config_value)
VALUES ('bot_active_meta', 'true')
ON CONFLICT (config_key) DO NOTHING;

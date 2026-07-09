-- Migration 164: isolate inbox threads by channel/device (Meta vs Whapi)
-- Prevents cross-channel thread mixing when the same guest phone exists on both providers.

ALTER TABLE public.whatsapp_conversations
  ADD COLUMN IF NOT EXISTS inbox_channel TEXT NOT NULL DEFAULT 'meta'
  CHECK (inbox_channel IN ('meta', 'whapi'));

-- Replace phone-only recency index with channel-aware recency index.
DROP INDEX IF EXISTS idx_wa_conv_phone;
CREATE INDEX IF NOT EXISTS idx_wa_conv_phone_channel
  ON public.whatsapp_conversations (phone, inbox_channel, created_at DESC);

-- Keep inbound dedup isolated by provider channel.
DROP INDEX IF EXISTS idx_wa_conv_wa_id;
CREATE UNIQUE INDEX IF NOT EXISTS idx_wa_conv_wa_id_channel
  ON public.whatsapp_conversations (wa_message_id, inbox_channel)
  WHERE wa_message_id IS NOT NULL;

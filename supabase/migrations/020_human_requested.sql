-- Migration 020: Human takeover detection fields on whatsapp_conversations
-- Added by Dream Island AI System — 2026-06-10

ALTER TABLE public.whatsapp_conversations
  ADD COLUMN IF NOT EXISTS human_requested      BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS human_request_type   TEXT;

-- Index for fast filtering of flagged conversations in the inbox
CREATE INDEX IF NOT EXISTS idx_wa_conv_human_requested
  ON public.whatsapp_conversations (human_requested)
  WHERE human_requested = TRUE;

COMMENT ON COLUMN public.whatsapp_conversations.human_requested     IS 'TRUE when inbound message matches a human-agent request pattern';
COMMENT ON COLUMN public.whatsapp_conversations.human_request_type  IS 'call | chat — categorised by keyword type';

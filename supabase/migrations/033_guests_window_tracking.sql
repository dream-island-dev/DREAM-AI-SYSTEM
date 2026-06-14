-- =============================================================================
-- 033_guests_window_tracking.sql
-- Track the WhatsApp 24-hour free-text session window per guest.
--
-- WHY:
--   WhatsApp only allows Meta-approved templates for business-initiated messages
--   OUTSIDE a 24h window. Once a guest sends ANY inbound message, a 24h window
--   opens and we can reply with free-form text.
--
--   By recording when each guest's window expires, whatsapp-send can decide:
--     wa_window_expires_at > now()  → send free-form text from bot_scripts
--     wa_window_expires_at <= now() → send Meta template (safe fallback)
--
-- WRITER:
--   whatsapp-webhook/index.ts — updates this column on every inbound message:
--     UPDATE guests SET wa_window_expires_at = now() + interval '24 hours'
--     WHERE phone = $1
--
-- READER:
--   whatsapp-send/index.ts — checks before sending morning_of messages.
-- =============================================================================

ALTER TABLE public.guests
  ADD COLUMN IF NOT EXISTS wa_window_expires_at TIMESTAMPTZ;

-- Fast lookup by phone when webhook fires (most common query)
CREATE INDEX IF NOT EXISTS idx_guests_window_expires
  ON public.guests (wa_window_expires_at)
  WHERE wa_window_expires_at IS NOT NULL;

COMMENT ON COLUMN public.guests.wa_window_expires_at
  IS 'WhatsApp 24h free-text window expiry. Set to NOW()+24h by whatsapp-webhook on every inbound message. NULL = no open window.';

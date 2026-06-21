-- Migration 053: Add guests.guest_notes — free-text log of guest requests
-- captured automatically from uncategorized WhatsApp messages (faq/fallback
-- intents), so requests like "we'd love balloons" are never silently lost
-- in an AI reply with zero staff visibility. Appended, never overwritten —
-- the running log persists across "mark as handled" resets of requires_attention.

ALTER TABLE public.guests
  ADD COLUMN IF NOT EXISTS guest_notes TEXT;

COMMENT ON COLUMN public.guests.guest_notes IS
  'Append-only log of guest free-text requests captured by whatsapp-webhook (faq/fallback intents). Cleared manually by staff, not by the bot.';

-- Migration 122: WhatsApp Inbox performance index
-- ────────────────────────────────────────────────────────────────────────
-- Context: WhatsAppInbox.js's fetchAll()/fetchOlder() now query
-- whatsapp_conversations ordered by created_at DESC (a table-wide recency
-- scan, no phone/guest_id filter) to paint the roster with only the most
-- recent activity window instead of the whole table.
--
-- The two existing indexes from migration 010 are both composite and
-- phone/guest_id-prefixed:
--   idx_wa_conv_phone (phone, created_at DESC)
--   idx_wa_conv_guest (guest_id, created_at DESC)
-- Neither helps a plain "ORDER BY created_at DESC LIMIT N" scan across all
-- phones — Postgres would fall back to a sequential scan + sort, which gets
-- slower as the table grows (the exact symptom this migration fixes).
--
-- NOT applied automatically — run `npx supabase db push` after review.

CREATE INDEX IF NOT EXISTS idx_wa_conv_created_at
  ON public.whatsapp_conversations (created_at DESC);

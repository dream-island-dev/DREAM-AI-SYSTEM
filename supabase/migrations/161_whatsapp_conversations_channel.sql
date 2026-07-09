-- ================================================================
-- Migration 161: whatsapp_conversations.channel — explicit per-row
-- sending/receiving device marker (Meta vs Whapi Suites device).
--
-- Manual-control guest-outbound Whapi rollout: staff explicitly picks
-- the channel per send (WhatsAppInbox.js / AutomationControlCenter.js
-- ManualDispatchModal) — this column is the single source of truth
-- the Inbox reads to badge each bubble, on BOTH directions (inbound:
-- which device the guest wrote to; outbound: which device staff/bot
-- replied from). Nullable, no backfill — existing rows stay NULL,
-- which the frontend treats as "legacy/Meta" (FAIL VISIBLE: never
-- silently mislabeled as one or the other).
-- ================================================================

ALTER TABLE public.whatsapp_conversations
  ADD COLUMN IF NOT EXISTS channel TEXT CHECK (channel IN ('meta', 'whapi'));

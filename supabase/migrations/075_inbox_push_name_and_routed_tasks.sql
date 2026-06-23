-- =============================================================================
-- 075_inbox_push_name_and_routed_tasks.sql
-- WhatsApp inbox UI overhaul — two small additive schema changes.
--
-- 1. whatsapp_conversations.push_name — the guest's WhatsApp profile display
--    name (Meta's contacts[].profile.name on the inbound payload), captured by
--    whatsapp-webhook so WhatsAppInbox.js can show a real human name even
--    before a guest is matched in `guests` (Smart Identity Resolution).
--    Display precedence in the UI: guests.name (DB match) > push_name > phone.
--
-- 2. tasks.source gains 'inbox_routed' — an operator clicking "Route to
--    Maintenance/Housekeeping" from a live guest conversation in the WhatsApp
--    inbox creates a real `tasks` row, same shape as whapi-webhook/
--    staff-ops-webhook (room_number, department, description, priority,
--    sla_category, sla_deadline, reporter_profile_id, reporter_raw_text).
--    A distinct source value (not reusing 'whatsapp_staff') keeps provenance
--    honest — this did NOT come through the staff ops group / AI classifier,
--    it's a manual operator action against the guest concierge channel.
-- =============================================================================

ALTER TABLE public.whatsapp_conversations
  ADD COLUMN IF NOT EXISTS push_name TEXT;

COMMENT ON COLUMN public.whatsapp_conversations.push_name IS
  'WhatsApp profile display name from Meta contacts[].profile.name on the inbound webhook payload. Fallback identity when the phone has no guests match yet.';

ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_source_check;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_source_check
  CHECK (source IN ('manual', 'whatsapp_staff', 'legacy_service_call', 'inbox_routed'));

COMMENT ON COLUMN public.tasks.source IS
  'manual = in-app New Task form. whatsapp_staff = parsed from the staff ops WhatsApp group (whapi-webhook, formerly staff-ops-webhook). legacy_service_call = one-time backfill (migration 071). inbox_routed = operator routed a guest WhatsApp conversation to Maintenance/Housekeeping from WhatsAppInbox.js.';

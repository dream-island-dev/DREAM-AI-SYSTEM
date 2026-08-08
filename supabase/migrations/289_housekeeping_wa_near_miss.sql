-- B3 (2026-08-08): durable, queryable audit trail for housekeeping-group
-- near-miss / unparsed lines — previously only a console.warn when
-- HOUSEKEEPING_WA_GROUP_REPLY=false (silence rule, migration 287-era P0:
-- the group is receive-only), invisible outside Supabase function logs.
--
-- A near-miss by definition has no resolved room (that's what makes it a
-- near-miss, not a check-in) — so room_number/room_id must become nullable,
-- scoped to event_type='near_miss' only via an explicit CHECK so every other
-- event_type still requires a real room.

ALTER TABLE public.housekeeping_wa_events
  ALTER COLUMN room_number DROP NOT NULL,
  ALTER COLUMN room_id DROP NOT NULL;

ALTER TABLE public.housekeeping_wa_events
  DROP CONSTRAINT IF EXISTS housekeeping_wa_events_event_type_check;

ALTER TABLE public.housekeeping_wa_events
  ADD CONSTRAINT housekeeping_wa_events_event_type_check
  CHECK (event_type IN ('ready', 'check_in', 'check_out', 'near_miss'));

ALTER TABLE public.housekeeping_wa_events
  DROP CONSTRAINT IF EXISTS housekeeping_wa_events_room_required_unless_near_miss;

ALTER TABLE public.housekeeping_wa_events
  ADD CONSTRAINT housekeeping_wa_events_room_required_unless_near_miss
  CHECK (event_type = 'near_miss' OR (room_number IS NOT NULL AND room_id IS NOT NULL));

-- Dedup near_miss rows per WA message. The existing uq_housekeeping_wa_msg_room_event
-- keys on (wa_message_id, room_number, event_type) — room_number is always NULL for
-- near_miss rows, and Postgres UNIQUE treats every NULL as distinct, so that
-- constraint alone would let a retried webhook delivery insert duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS uq_housekeeping_wa_events_near_miss_msg
  ON public.housekeeping_wa_events (wa_message_id)
  WHERE event_type = 'near_miss';

COMMENT ON TABLE public.housekeeping_wa_events IS
  'Dedup + audit for housekeeping group ready/check_in/check_out signals, plus near_miss (HK anchor present, no room resolved — FAIL VISIBLE audit trail, no group outbound) — whapi-webhook observer.';

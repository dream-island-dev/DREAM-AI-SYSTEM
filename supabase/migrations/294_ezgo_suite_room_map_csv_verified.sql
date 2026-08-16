-- 294_ezgo_suite_room_map_csv_verified.sql
-- EZGO live API sync — Phase 1, rooms-only follow-up (per Mike, no Phase 2,
-- no writes to guests/suite_rooms/spa_appointments). Adds a third, highest-
-- confidence provenance tier: a RoomId->suite pairing independently
-- confirmed by cross-referencing ezgo_api_ingest Reservations events
-- (OrderId+RoomId) against EZGO's own daily arrivals CSV export
-- (iOrderId + sSubItemName/sRoomName) — not just an internal DB
-- cross-reference (auto_bootstrap) or a staff guess (manual).

ALTER TABLE public.ezgo_suite_room_map
  DROP CONSTRAINT IF EXISTS ezgo_suite_room_map_matched_via_check;

ALTER TABLE public.ezgo_suite_room_map
  ADD CONSTRAINT ezgo_suite_room_map_matched_via_check
  CHECK (matched_via IN ('auto_bootstrap', 'manual', 'csv_verified'));

COMMENT ON COLUMN public.ezgo_suite_room_map.matched_via IS
  'auto_bootstrap = inferred from our own guests/suite_rooms data for an order with exactly one known room. manual = a staff pick from the mapping panel (lowest confidence — no external corroboration). csv_verified = confirmed against EZGO''s own arrivals CSV export (iOrderId + sSubItemName/sRoomName) — highest confidence, independent of our own data.';

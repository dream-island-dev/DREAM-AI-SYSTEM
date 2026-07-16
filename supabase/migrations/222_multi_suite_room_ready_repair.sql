-- 222_multi_suite_room_ready_repair.sql
-- Repair multi-room suite_rooms linkage + clear duplicated room_display labels
-- (migration 151 backfill copied guests.room onto every row for the same guest).

-- Link guest_id where missing (order + arrival + phone)
UPDATE public.suite_rooms sr
SET guest_id = g.id
FROM public.guests g
WHERE sr.guest_id IS NULL
  AND sr.order_number IS NOT NULL
  AND g.order_number = sr.order_number
  AND g.arrival_date = sr.arrival_date
  AND (
    sr.guest_phone IS NULL
    OR g.phone = sr.guest_phone
    OR g.phone = ('+' || sr.guest_phone)
  );

-- When one guest has multiple rooms but every row shares guests.room as room_display,
-- clear room_display so app resolves per-row from room_name + suite_type.
UPDATE public.suite_rooms sr
SET room_display = NULL
FROM (
  SELECT guest_id
  FROM public.suite_rooms
  WHERE guest_id IS NOT NULL
  GROUP BY guest_id
  HAVING COUNT(*) > 1
) multi
JOIN public.guests g ON g.id = multi.guest_id
WHERE sr.guest_id = multi.guest_id
  AND sr.room_display IS NOT NULL
  AND trim(sr.room_display) = trim(COALESCE(g.room, ''));

COMMENT ON COLUMN public.suite_rooms.room_display IS
  'Canonical suite label (SUITE_REGISTRY). Per-room for multi-suite bookings; NULL → resolved from room_name + suite_type in app.';

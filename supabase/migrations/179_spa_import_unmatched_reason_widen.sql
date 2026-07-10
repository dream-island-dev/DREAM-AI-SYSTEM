-- 179_spa_import_unmatched_reason_widen.sql
-- Follow-up to migration 178, found during an external Plan-agent review of
-- the Phase 2 sync engine (spaActivitiesSyncEngine.js) before it was wired
-- to anything: the original reason CHECK only allowed
-- ('no_guest_match','room_unmapped','conflict_23P01','suspicious_shared_phone'),
-- which forced two real situations into the wrong bucket — a row missing a
-- parseable time range got mislabeled 'room_unmapped' (a staff member
-- "fixing" it via the room-alias panel wouldn't actually fix anything), and
-- any unexpected Postgres error on the appointment write (RLS, etc.) got
-- mislabeled 'no_guest_match'. Widening instead of reusing an existing
-- value so the unmatched panel can show staff the real, actionable reason.

ALTER TABLE public.spa_import_unmatched
  DROP CONSTRAINT spa_import_unmatched_reason_check;

ALTER TABLE public.spa_import_unmatched
  ADD CONSTRAINT spa_import_unmatched_reason_check
  CHECK (reason IN (
    'no_guest_match', 'room_unmapped', 'conflict_23P01', 'suspicious_shared_phone',
    'invalid_time_range', 'write_failed'
  ));

COMMENT ON COLUMN public.spa_import_unmatched.reason IS
  'no_guest_match=phone matched no guests.phone; room_unmapped=פעילות string has no spa_room_aliases entry; conflict_23P01=GiST exclusion constraint (room/therapist double-booked); suspicious_shared_phone=resolved but multiple guests shared this phone (informational, appointment was still written); invalid_time_range=תזמון column did not parse to a start/end time; write_failed=unexpected DB error on the appointment write, not otherwise classified.';

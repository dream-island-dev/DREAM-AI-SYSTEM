-- 151_inbox_read_cursors_and_suite_room_ready.sql
-- (1) Persistent per-staff inbox read cursors — unread survives refresh/cross-tab.
-- (2) Per-room room_ready flags on suite_rooms — multi-room guests get one WA per suite.

-- ── inbox_read_cursors ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.inbox_read_cursors (
  phone         TEXT        NOT NULL,
  staff_id      UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  last_read_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (phone, staff_id)
);

CREATE INDEX IF NOT EXISTS idx_inbox_read_cursors_staff
  ON public.inbox_read_cursors (staff_id, updated_at DESC);

COMMENT ON TABLE public.inbox_read_cursors IS
  'Per-staff WhatsApp Inbox read position. Inbound after last_read_at = unread for that staff member.';

ALTER TABLE public.inbox_read_cursors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inbox_read_cursors_staff_rw ON public.inbox_read_cursors;
CREATE POLICY inbox_read_cursors_staff_rw ON public.inbox_read_cursors
  FOR ALL
  USING (staff_id = auth.uid())
  WITH CHECK (staff_id = auth.uid());

-- ── suite_rooms: per-room lifecycle + room_ready idempotency ───────────────────
ALTER TABLE public.suite_rooms
  ADD COLUMN IF NOT EXISTS guest_id BIGINT REFERENCES public.guests(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS room_display TEXT,
  ADD COLUMN IF NOT EXISTS room_ready_notified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS msg_room_ready_sent BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.suite_rooms.room_display IS
  'Canonical suite label (SUITE_REGISTRY format) used in room_ready WA {{2}}.';
COMMENT ON COLUMN public.suite_rooms.room_ready_notified IS
  'Per-room idempotency — independent of guests.room_ready_notified for multi-room bookings.';

CREATE INDEX IF NOT EXISTS idx_suite_rooms_guest_id
  ON public.suite_rooms (guest_id)
  WHERE guest_id IS NOT NULL;

-- Backfill guest_id + room_display from guests + existing room_name/suite_type
UPDATE public.suite_rooms sr
SET
  guest_id = g.id,
  room_display = COALESCE(NULLIF(trim(g.room), ''), NULLIF(trim(sr.room_name), ''), NULLIF(trim(sr.suite_type), ''))
FROM public.guests g
WHERE sr.guest_id IS NULL
  AND sr.guest_phone IS NOT NULL
  AND g.phone = sr.guest_phone
  AND (sr.arrival_date IS NULL OR g.arrival_date = sr.arrival_date)
  AND (sr.order_number IS NULL OR g.order_number = sr.order_number);

-- Stamp suite_rooms that match a guest who already received room_ready (single-room legacy)
UPDATE public.suite_rooms sr
SET
  room_ready_notified = TRUE,
  msg_room_ready_sent = TRUE
FROM public.guests g
WHERE sr.guest_id = g.id
  AND (g.room_ready_notified = TRUE OR g.msg_room_ready_sent = TRUE)
  AND sr.room_ready_notified = FALSE
  AND (
    sr.room_display IS NOT NULL AND trim(sr.room_display) = trim(COALESCE(g.room, ''))
    OR sr.room_display IS NULL
  );

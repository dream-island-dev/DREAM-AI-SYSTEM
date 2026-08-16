-- 291_ezgo_api_reference_data.sql
-- EZGO live API sync — Phase 1 (reference-data bootstrap only, per the
-- approved plan). No writes to guests/suite_rooms/spa_appointments happen
-- from this migration or anything it enables — this is purely the mapping
-- scaffolding so a future sync worker never has to guess a code EZGO sends.
--
-- Two gaps closed:
--   1. spa_therapists.ezgo_worker_id — EZGO's Activities.Timing.Worker.WorkerId
--      is its OWN internal id (confirmed: values like 276 don't exist in our
--      spa_therapists, max id 117 — different numbering system). No sibling
--      EZGO entity ever carries a worker name, so this has to be a one-time
--      manual mapping, same UX pattern as spa_room_aliases (a table staff
--      fills in via a review panel, not a hardcoded map).
--   2. ezgo_suite_room_map — EZGO's Reservations.Room.RoomId is a numeric id
--      for a physical room, distinct from the free-text room labels every
--      existing resolver (resolveSuiteRoomFromEzgoLabel) already handles.
--      RoomId=0 consistently means "not yet assigned" (confirmed on a real
--      6-room group booking) and must never be mapped. Most of this table
--      can bootstrap itself for free — see the sync worker (not built yet)
--      cross-referencing already-known guests.order_number/suite_rooms.

-- ─────────────────────────────────────────────────────────────────────────
-- spa_therapists.ezgo_worker_id
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public.spa_therapists
  ADD COLUMN IF NOT EXISTS ezgo_worker_id INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS idx_spa_therapists_ezgo_worker_id
  ON public.spa_therapists (ezgo_worker_id)
  WHERE ezgo_worker_id IS NOT NULL;

COMMENT ON COLUMN public.spa_therapists.ezgo_worker_id IS
  'EZGO Activities.Timing.Worker.WorkerId — a different numbering space than our own id. Mapped once via the EZGO worker-mapping panel (mirrors the spa_room_aliases unmatched-panel UX), never guessed.';

-- ─────────────────────────────────────────────────────────────────────────
-- ezgo_suite_room_map — EZGO numeric RoomId -> canonical suite name.
-- suite_name is intentionally TEXT, not a FK — the canonical suite registry
-- (SUITE_REGISTRY / CANONICAL_SUITE_NAMES) lives in code, not a DB table,
-- same as every other EZGO room-label resolver in this codebase.
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ezgo_suite_room_map (
  ezgo_room_id  INTEGER     PRIMARY KEY,
  suite_name    TEXT        NOT NULL,
  matched_via   TEXT        NOT NULL DEFAULT 'manual'
    CHECK (matched_via IN ('auto_bootstrap', 'manual')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.ezgo_suite_room_map IS
  'EZGO Reservations.Room.RoomId -> canonical suite name. auto_bootstrap rows were inferred by cross-referencing a Reservations event''s OrderId against an already-known guests.order_number + suite_rooms.room_name; manual rows were entered by staff for a RoomId never seen paired with a known order. RoomId=0 means "not yet assigned" and must never appear here.';

-- ─────────────────────────────────────────────────────────────────────────
-- RLS — same posture as migration 176/178 (spa_rooms/spa_therapists/
-- spa_room_aliases): any authenticated staff member can read/write,
-- cleaner role locked out.
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public.ezgo_suite_room_map ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth users can access ezgo_suite_room_map" ON public.ezgo_suite_room_map;
CREATE POLICY "auth users can access ezgo_suite_room_map"
  ON public.ezgo_suite_room_map FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "cleaner_lockdown_ezgo_suite_room_map" ON public.ezgo_suite_room_map;
CREATE POLICY "cleaner_lockdown_ezgo_suite_room_map" ON public.ezgo_suite_room_map
  AS RESTRICTIVE FOR ALL
  USING      (COALESCE(public.get_true_role(), '') <> 'cleaner')
  WITH CHECK (COALESCE(public.get_true_role(), '') <> 'cleaner');

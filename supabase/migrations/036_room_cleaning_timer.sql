-- =============================================================================
-- 036_room_cleaning_timer.sql
-- Sprint 1: Housekeeping Tablet App — add timer columns to room_status.
--
-- cleaning_started_at:     timestamped when staff presses "Start Cleaning"
-- cleaning_ended_at:       timestamped when manager confirms "Mark Ready"
-- last_clean_duration_sec: persisted for the "cleaned in X:XX" badge on פנוי rooms
-- =============================================================================

ALTER TABLE public.room_status
  ADD COLUMN IF NOT EXISTS cleaning_started_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cleaning_ended_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_clean_duration_sec INTEGER;

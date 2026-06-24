-- =============================================================================
-- 079_session29_jacuzzi_and_room_ready.sql
-- Session 29 — Sprint 5: chronological timeline cleanup + jacuzzi tracking.
--
-- (1) Purge stage_key='butler_1h' ("Stage 3.5 — העברת סוכן, שעה אחרי צ׳ק-אין")
--     from the automation timeline. DELETE (not is_active=false) so it
--     disappears from both the Automation Control Center Timeline UI and the
--     live whatsapp-cron scan in one step — both read this table directly,
--     and a deactivated row would still show up in the UI as a paused stage,
--     which is not what "completely remove" means here.
--
-- (2) room_status gets two new tracking columns for the Housekeeping Tablet's
--     jacuzzi workflow (HousekeepingTabletView.js):
--       jacuzzi_status    — dirty/clean. Independent mini-pipeline for the
--                            suite's private jacuzzi, separate from the main
--                            room status.
--       room_clean_status — dirty/clean. Tracks the room-surface "🟢 נקי" tap
--                            SEPARATELY from the authoritative `status`
--                            column. Needed for the Smart Ready-Alert Gate:
--                            the room only advances to 'ממתין לאישור' once
--                            BOTH this AND jacuzzi_status are 'clean'. Without
--                            a separate column, a cleaner tapping "🟢 נקי"
--                            while the jacuzzi is still dirty would have no
--                            durable record that the room side is already
--                            done (and the tap would appear to do nothing).
-- =============================================================================

DELETE FROM public.automation_stages WHERE stage_key = 'butler_1h';

ALTER TABLE public.room_status
  ADD COLUMN IF NOT EXISTS jacuzzi_status    TEXT NOT NULL DEFAULT 'dirty' CHECK (jacuzzi_status    IN ('dirty', 'clean')),
  ADD COLUMN IF NOT EXISTS room_clean_status TEXT NOT NULL DEFAULT 'dirty' CHECK (room_clean_status IN ('dirty', 'clean'));

COMMENT ON COLUMN public.room_status.jacuzzi_status IS
  'Housekeeping Tablet jacuzzi mini-pipeline — dirty/clean, independent of the main `status` column.';
COMMENT ON COLUMN public.room_status.room_clean_status IS
  'Housekeeping Tablet room-surface clean flag — dirty/clean. Gates the automatic transition of `status` to ''ממתין לאישור'' together with jacuzzi_status (Smart Ready-Alert Gate, HousekeepingTabletView.js).';

-- 118_jacuzzi_ping_pong_statuses.sql
-- Session 84 — Jacuzzi ping-pong cleaning workflow (HousekeepingTabletView.js).
-- Two intermediate `room_status.status` values (TEXT, no CHECK — same as existing Hebrew statuses):
--   ממתין לג'קוזי  — room cleaner finished first pass, jacuzzi staff called
--   מוכן לפיניש    — jacuzzi clean; room cleaner returns for floor finish
-- Final handoff unchanged: both room_clean_status + jacuzzi_status = 'clean' → ממתין לאישור

COMMENT ON COLUMN public.room_status.status IS
  'Operational room pipeline status. Known values: תפוס, פנוי, לניקיון, בניקיון, '
  'ממתין לג''קוזי (waiting for jacuzzi — ping-pong step 1), '
  'מוכן לפיניש (ready for floor finish — ping-pong step 2), '
  'ממתין לאישור (both clean — AICopilot gate), תחזוקה. '
  'Jacuzzi mini-pipeline: jacuzzi_status dirty/clean. Room surface: room_clean_status dirty/clean.';

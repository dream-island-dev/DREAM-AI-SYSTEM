-- Migration 096: Add 'premium_day_guest' to guests.room_type CHECK constraint
--
-- Context: "Premium Day 1" / "Premium Day 2" package guests were always stored
-- as room_type = 'day_guest' — the only distinction was the guests.room field.
-- This migration makes the premium tier a first-class DB value so the UI can
-- expose a meaningful "פרימיום בילוי יומי" option, and consuming components
-- can surface the distinction (badges, tabs, portal routing) without relying
-- on a room-name substring check.
--
-- 'standard' is intentionally preserved in the constraint for backward
-- compatibility with existing rows — it is no longer shown in the Add/Edit
-- Guest UI dropdown but existing data must remain valid.
--
-- Consumers updated in the same PR (session 57):
--   AddGuestModal.js           — dropdown options + smart auto-inference
--   GuestDashboard.js          — tab bucketing (isDayType helper)
--   GuestPortal.js             — isDayUse check
--   WhatsAppInbox.js           — room-type badge + bulk filters
--   BroadcastDashboard.js      — audience filter + display badge
--   AutomationControlCenter.js — DAY_PASS gate comparisons

ALTER TABLE public.guests
  DROP CONSTRAINT IF EXISTS guests_room_type_check;

ALTER TABLE public.guests
  ADD CONSTRAINT guests_room_type_check
  CHECK (room_type IN ('day_guest', 'premium_day_guest', 'standard', 'suite'));

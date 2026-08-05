-- UX audit P1 (2026-08-05): the ✓ אישר badge on GuestsPage/GuestDashboard means
-- three different things since commit 11deda9 (guest replied "כן מגיעים" via
-- WhatsApp, staff physically checked the guest in, or a same-day/T-1 import
-- auto-marked it) but carried no title/source — staff couldn't tell from the
-- roster whether Stage 1 actually got an answer. Purely additive/nullable —
-- existing rows stay NULL ("legacy/unknown"), no backfill, no write-path
-- behavior change beyond appending one field to updates that already happen.

ALTER TABLE public.guests
  ADD COLUMN IF NOT EXISTS arrival_confirmed_source TEXT
    CHECK (arrival_confirmed_source IS NULL OR arrival_confirmed_source IN ('guest_reply', 'physical_checkin', 'late_import'));

COMMENT ON COLUMN public.guests.arrival_confirmed_source IS
  'How arrival_confirmed got set: guest_reply (WA "כן מגיעים"/button), physical_checkin (HK group/manual check-in), late_import (same-day/T-1 import fast lane). NULL = legacy row or staff manual edit before this column existed.';

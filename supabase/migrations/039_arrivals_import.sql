-- Migration 039: Daily Arrivals Import support
-- Adds room_count + status to bookings.
-- Adds unique constraint to guests(phone, arrival_date) to support upsert.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS room_count INT  DEFAULT 1,
  ADD COLUMN IF NOT EXISTS status     TEXT DEFAULT 'pending';

-- Remove duplicate guests (keep latest id) before adding unique constraint
DELETE FROM public.guests g1
USING public.guests g2
WHERE g1.id < g2.id
  AND g1.phone        IS NOT NULL
  AND g1.arrival_date IS NOT NULL
  AND g1.phone        = g2.phone
  AND g1.arrival_date = g2.arrival_date;

-- Unique constraint on guests(phone, arrival_date) — enables upsert from daily import
-- NULL values are excluded from uniqueness checks in Postgres, so guests without
-- a phone or arrival_date are unaffected.
ALTER TABLE public.guests
  DROP CONSTRAINT IF EXISTS guests_phone_arrival_unique;

ALTER TABLE public.guests
  ADD CONSTRAINT guests_phone_arrival_unique UNIQUE (phone, arrival_date);

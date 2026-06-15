-- Migration 040: Upsell interest tracking on bookings
-- Flagged when a guest taps "נשמע מושלם / שריינו לי מקום" on the therapy upsell template.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS upsell_interest      BOOLEAN   DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS upsell_requested_at  TIMESTAMPTZ;

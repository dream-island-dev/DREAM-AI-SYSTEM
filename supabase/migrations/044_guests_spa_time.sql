-- Migration 044: Add spa_time column to guests table.
-- Enables the unified 2-file pipeline: File 1 (EZGO) and File 2 (Spa CSV)
-- both write directly to guests.spa_time; the webhook reads it in one query
-- from the already-fetched guest object — no bookings table join needed.

ALTER TABLE public.guests ADD COLUMN IF NOT EXISTS spa_time TEXT;

COMMENT ON COLUMN public.guests.spa_time IS
  'Spa treatment time HH:MM — populated by EZGO import or Spa CSV enrichment. NULL = no treatment booked.';

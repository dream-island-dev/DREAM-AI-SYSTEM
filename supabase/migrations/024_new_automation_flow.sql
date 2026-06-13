-- Migration 024: New automation flow — mid-stay check + checkout feedback + departure date
-- Adds columns required for the 5-template interactive flow.

ALTER TABLE public.guests
  ADD COLUMN IF NOT EXISTS departure_date       DATE,
  ADD COLUMN IF NOT EXISTS needs_callback       BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS msg_mid_stay_sent    BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS msg_checkout_fb_sent BOOLEAN NOT NULL DEFAULT FALSE;

-- Index for efficient cron queries on departure_date
CREATE INDEX IF NOT EXISTS idx_guests_departure_date ON public.guests (departure_date);

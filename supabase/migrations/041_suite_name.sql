-- Migration 041: Suite name assignment for the Human-in-the-Loop delivery flow
-- Managers assign a specific suite name (e.g. "רובי 202") in the Data Hub grid.
-- The whatsapp-webhook reads this value when sending the room-ready template.

ALTER TABLE public.guests
  ADD COLUMN IF NOT EXISTS suite_name TEXT;

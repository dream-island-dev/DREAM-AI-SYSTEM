-- ================================================================
-- Migration 009: Add email column to guests table
-- Safe to re-run (idempotent).
-- ================================================================

ALTER TABLE public.guests ADD COLUMN IF NOT EXISTS email TEXT;

-- Index for future lookup/de-dup
CREATE INDEX IF NOT EXISTS idx_guests_email ON public.guests (email);

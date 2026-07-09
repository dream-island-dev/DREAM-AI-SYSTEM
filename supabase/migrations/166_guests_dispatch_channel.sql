-- Migration 166: guests.dispatch_channel — opt-in per-guest transport policy
-- (Meta vs Whapi) for the guest's automated messaging journey.
--
-- Opt-in only: every existing row and every new row defaults to 'meta' (the
-- only transport that existed before this column) until something explicitly
-- sets 'whapi' — no backfill UPDATE, no retroactive switch for a guest already
-- mid-journey. Phase 2 adds the staff-facing batch picker that actually sets
-- this; for now it is plumbing that whatsapp-webhook's live "כן מגיעים"
-- arrival-confirmation handler reads (Phase 1) — cron's own defaults are
-- untouched.

ALTER TABLE public.guests
  ADD COLUMN IF NOT EXISTS dispatch_channel TEXT NOT NULL DEFAULT 'meta'
  CHECK (dispatch_channel IN ('meta', 'whapi'));

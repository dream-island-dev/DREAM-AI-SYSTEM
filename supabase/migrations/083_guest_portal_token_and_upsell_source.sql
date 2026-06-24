-- Migration 083: Guest Portal magic-link token + portal-upsell task provenance
-- Session "Pre-Arrival Guest Portal & Static Photo Tour".
--
-- SECURITY NOTE (deviation from the literal directive, documented here and in
-- CLAUDE.md §10): the directive asked for a route like `/portal/:phone`.
-- guests.phone is NOT a secret — it's the guest's real phone number, often
-- knowable/guessable, and `guests.id` (BIGINT IDENTITY) is sequential, so
-- neither is safe as the sole credential for an unauthenticated public page
-- that exposes a guest's name/room/arrival date. This migration adds a
-- dedicated random opaque token instead — the actual "magic link" mechanism —
-- so the portal URL itself is the credential, same security model as a
-- password-reset link. RLS on `guests` is deliberately left untouched (still
-- "authenticated only", migration 028); the public Edge Functions
-- (guest-portal-data / guest-portal-upsell) look guests up by this token
-- using the service-role key, never the anon key, and return only a
-- hand-picked safe subset of columns — not `select("*")`.

-- gen_random_uuid() (pgcrypto) used instead of uuid_generate_v4() (uuid-ossp) —
-- the latter is not enabled on this project despite migration 001 referencing
-- it; pgcrypto is enabled by default on Supabase.
ALTER TABLE public.guests
  ADD COLUMN IF NOT EXISTS portal_token UUID NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX IF NOT EXISTS idx_guests_portal_token ON public.guests (portal_token);

COMMENT ON COLUMN public.guests.portal_token IS
  'Opaque random magic-link credential for the public Guest Portal (GuestPortal.js, /portal/:token). NOT guessable like phone or id — this token IS the auth. Generated automatically for every guest, existing and future.';

-- Distinct provenance for tasks created by a guest clicking an in-scroll
-- upsell on their own portal — different surface than 'guest_request'
-- (WhatsApp conversation, routed by staff/AI) so OperationsBoard and any
-- future reporting can tell self-service-portal asks apart from chat-routed ones.
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_source_check;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_source_check
  CHECK (source IN ('manual', 'whatsapp_staff', 'legacy_service_call', 'inbox_routed', 'guest_request', 'manual_group', 'portal_upsell'));

-- =============================================================================
-- 070_profiles_phone.sql
-- profiles.phone — staff WhatsApp number, for the new staff-ops pipeline.
--
-- WHY:
--   The new staff-ops-webhook (relay-forwarded WhatsApp group reports) needs
--   to attribute an inbound report to a real staff member (name/department)
--   and needs a way to message that person back 1:1 via Meta's official API
--   (the only Meta-supported delivery channel — see staff-ops-webhook header
--   comment for why a real WhatsApp *group* can't be messaged directly).
--   E.164 format, same convention as guests.phone (+972XXXXXXXXX).
-- =============================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS phone TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_phone_unique
  ON public.profiles (phone)
  WHERE phone IS NOT NULL;

COMMENT ON COLUMN public.profiles.phone IS 'E.164 WhatsApp number (+972XXXXXXXXX) — used by staff-ops-webhook to attribute relay-forwarded group reports to a profiles row, and by sendInteractiveButtons() to message that staff member back 1:1.';

-- 298_ezgo_client_id_cross_order_merge.sql
-- EZGO live API sync — root cause of "22 EZGO room lines / 17 XOS guests"
-- (2026-08-17 incident): EZGO doesn't put a group booking's rooms under one
-- multi-room Order — it creates a SEPARATE Order (its own OrderId) per room,
-- linked only by the shared Order.Client.ClientId. Confirmed directly
-- against live ezgo_api_ingest data: e.g. ClientId 205600 ("חברת מווב
-- הפקות") spans 9 distinct OrderIds; ClientId 213424 ("ענבל פוליק") spans 2.
-- ezgo-guest-sync's existing merge lookup (findGuestForDoc2SuiteCreate, via
-- Doc2's isSameDoc2Booking) explicitly refuses to merge across different
-- order_numbers — correct for Doc2 mail (where that's the ONLY signal
-- available, and a repeat guest with a genuinely new stay must not silently
-- merge) but wrong here: the API additionally has ClientId, a real
-- cross-order link Doc2 never had. This column lets the sync worker try a
-- ClientId+arrival_date match FIRST (new, API-only) before falling back to
-- the unchanged order_number/phone path.
--
-- Nullable, not unique (a repeat guest can legitimately have two DIFFERENT
-- arrival_date stays under the same ClientId — that's fine, the lookup
-- always scopes by arrival_date too, same discipline as every other guard
-- in this codebase, e.g. assertNoDuplicateGuest).

ALTER TABLE public.guests
  ADD COLUMN IF NOT EXISTS ezgo_client_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_guests_ezgo_client_id_arrival
  ON public.guests (ezgo_client_id, arrival_date)
  WHERE ezgo_client_id IS NOT NULL AND status != 'cancelled';

COMMENT ON COLUMN public.guests.ezgo_client_id IS
  'EZGO Order.Client.ClientId - the coordinator/payer this order is registered under, not necessarily this rooms actual occupant (see is_remark_group_occupant). Set only on the coordinator-identity guest (never on a remark-swapped individuals own profile). Lets ezgo-guest-sync merge sibling rooms that EZGO split across separate OrderIds for the same client+date, closing the gap order_number-only matching cannot.';

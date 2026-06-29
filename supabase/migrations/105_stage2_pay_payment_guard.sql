-- =============================================================================
-- 105_stage2_pay_payment_guard.sql
-- Stage 2 Pay activation guardrails:
--   • direct_payment_url (canonical) + ezgo_portal_url (async recovery source)
--   • payment_link_resolution_pending flag for background parsing queue
--   • notification_log.status: processing + failed_missing_link
-- =============================================================================

-- ── Guest payment URL fields ─────────────────────────────────────────────────
ALTER TABLE public.guests
  ADD COLUMN IF NOT EXISTS direct_payment_url TEXT,
  ADD COLUMN IF NOT EXISTS ezgo_portal_url TEXT,
  ADD COLUMN IF NOT EXISTS payment_link_resolution_pending BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.guests.direct_payment_url IS
  'Verified direct payment URL for Stage 2 Pay / dream_payment_and_workshops. Canonical field; payment_link_url is legacy alias.';
COMMENT ON COLUMN public.guests.ezgo_portal_url IS
  'EZGo guest portal page URL — used to recover direct_payment_url asynchronously when missing.';
COMMENT ON COLUMN public.guests.payment_link_resolution_pending IS
  'TRUE when background payment-link parsing is queued (ezgo_portal_url present, direct link missing).';

-- Backfill canonical column from legacy field
UPDATE public.guests
   SET direct_payment_url = payment_link_url
 WHERE direct_payment_url IS NULL
   AND payment_link_url IS NOT NULL
   AND btrim(payment_link_url) <> '';

-- Keep legacy + canonical in sync on staff edits (AddGuestModal writes payment_link_url)
CREATE OR REPLACE FUNCTION public.sync_guest_direct_payment_url()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.payment_link_url IS DISTINCT FROM OLD.payment_link_url THEN
    NEW.direct_payment_url := NULLIF(btrim(NEW.payment_link_url), '');
  END IF;
  IF NEW.direct_payment_url IS NOT NULL
     AND btrim(NEW.direct_payment_url) <> ''
     AND (NEW.payment_link_url IS NULL OR btrim(NEW.payment_link_url) = '') THEN
    NEW.payment_link_url := btrim(NEW.direct_payment_url);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guests_sync_direct_payment_url ON public.guests;
CREATE TRIGGER trg_guests_sync_direct_payment_url
  BEFORE INSERT OR UPDATE OF payment_link_url, direct_payment_url ON public.guests
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_guest_direct_payment_url();

-- ── notification_log.status — processing + failed_missing_link ───────────────
ALTER TABLE public.notification_log DROP CONSTRAINT IF EXISTS notification_log_status_check;

ALTER TABLE public.notification_log
  ADD CONSTRAINT notification_log_status_check
  CHECK (status IN (
    'sent', 'simulated', 'failed', 'timeout', 'blocked_by_meta',
    'processing', 'failed_missing_link'
  ));

COMMENT ON COLUMN public.notification_log.status IS
  'sent/simulated=confirmed. failed/timeout=error. blocked_by_meta=template pending. processing=in-flight idempotency guard. failed_missing_link=Stage 2 Pay aborted — no valid direct_payment_url.';

-- ── Inline self-test ─────────────────────────────────────────────────────────
DO $$
DECLARE
  v_def TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conrelid = 'public.notification_log'::regclass
     AND conname = 'notification_log_status_check';

  IF v_def NOT LIKE '%failed_missing_link%' OR v_def NOT LIKE '%processing%' THEN
    RAISE EXCEPTION '105_self_test: notification_log_status_check missing new values — got: %', v_def;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 026: bookings extra columns — אוטומציית שימור לקוחות
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE bookings
  -- יום עזיבה (מועד checkout בפועל)
  ADD COLUMN IF NOT EXISTS checkout_date              date,

  -- T-1: תזכורת לפני הגעה (dream_checkin_reminder)
  ADD COLUMN IF NOT EXISTS checkin_reminder_sent_at   timestamptz,

  -- fallback: קישור תשלום כ-template 12 שעות אחרי אישור (dream_payment_link)
  ADD COLUMN IF NOT EXISTS payment_fallback_sent_at   timestamptz,

  -- T+1: בקשת ביקורת (dream_post_visit)
  ADD COLUMN IF NOT EXISTS review_sent_at             timestamptz,

  -- T+21: הצעת חזרה (dream_return_offer)
  ADD COLUMN IF NOT EXISTS return_offer_sent_at       timestamptz,

  -- T+90: ריאקטיבציה (dream_event_reactivate)
  ADD COLUMN IF NOT EXISTS reactivate_sent_at         timestamptz;

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 023: bookings + automation_logs
-- הזמנות אורחים + לוג הודעות אוטומטיות
-- ─────────────────────────────────────────────────────────────────────────────

-- ── bookings ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bookings (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_name       text        NOT NULL,
  phone            text        NOT NULL,          -- בפורמט 972XXXXXXXXX
  arrival_date     date        NOT NULL,
  notes            text,

  -- סכום לתשלום (מהאקסל)
  amount           numeric(10,2),                  -- ₪ לתשלום

  -- סטטוס אישור
  confirmation_status  text NOT NULL DEFAULT 'pending'
    CHECK (confirmation_status IN ('pending','confirmed','cancelled')),
  confirmed_at         timestamptz,

  -- סטטוס תשלום
  payment_status   text NOT NULL DEFAULT 'pending'
    CHECK (payment_status IN ('pending','link_sent','paid','refunded')),
  payment_link     text,                          -- ימולא מ-API חברת תשלומים
  payment_link_sent_at timestamptz,
  paid_at          timestamptz,

  -- שליחות אוטומטיות (למנוע כפילות)
  confirm_sent_at       timestamptz,              -- dream_arrival_confirm
  morning_sent_at       timestamptz,              -- dream_arrival_morning
  workshop_sent_at      timestamptz,              -- dream_workshop_signup

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- ── automation_logs ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS automation_logs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id     uuid REFERENCES bookings(id) ON DELETE CASCADE,
  template_name  text        NOT NULL,
  phone          text        NOT NULL,
  status         text        NOT NULL DEFAULT 'sent'
    CHECK (status IN ('sent','failed','skipped')),
  error          text,
  sent_at        timestamptz NOT NULL DEFAULT now()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS bookings_arrival_date_idx  ON bookings(arrival_date);
CREATE INDEX IF NOT EXISTS bookings_phone_idx         ON bookings(phone);
CREATE INDEX IF NOT EXISTS automation_logs_booking_idx ON automation_logs(booking_id);

-- ── Updated_at trigger ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS bookings_updated_at ON bookings;
CREATE TRIGGER bookings_updated_at
  BEFORE UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE bookings        ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_logs ENABLE ROW LEVEL SECURITY;

-- מנהלים ומנג׳רים בלבד
CREATE POLICY "staff_all_bookings" ON bookings
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('super_admin','admin','manager')
    )
  );

CREATE POLICY "staff_all_automation_logs" ON automation_logs
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('super_admin','admin','manager')
    )
  );

-- Service role (Edge Functions) עוקף RLS אוטומטית

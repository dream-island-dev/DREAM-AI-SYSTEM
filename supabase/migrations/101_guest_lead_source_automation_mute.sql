-- Migration 101: lead_source + automation_muted on guests (Sales Dept muzzle)
-- Guests imported with lead_source = 'מחלקת מכירות' are stored for ops visibility
-- but must not receive cron/pipeline WhatsApp automation (session 60).

ALTER TABLE public.guests
  ADD COLUMN IF NOT EXISTS lead_source TEXT,
  ADD COLUMN IF NOT EXISTS automation_muted BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.guests.lead_source IS
  'Raw PMS lead-source label (e.g. מקור הגעה from suite arrivals CSV). Audit/display only.';

COMMENT ON COLUMN public.guests.automation_muted IS
  'When TRUE: cron + pipeline triggers skip this guest. Set by import when lead_source = מחלקת מכירות.';

CREATE INDEX IF NOT EXISTS idx_guests_automation_muted
  ON public.guests (automation_muted)
  WHERE automation_muted = TRUE;

-- ── sync_suite_arrivals: persist lead_source + automation_muted ───────────────
CREATE OR REPLACE FUNCTION public.sync_suite_arrivals(payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  p               JSONB;
  r               JSONB;
  v_phone         TEXT;
  v_phone_strip   TEXT;
  v_name          TEXT;
  v_date          DATE;
  v_dep_date      DATE;
  v_order         TEXT;
  v_line          TEXT;
  v_room_name     TEXT;
  v_room_type     TEXT;
  v_payment       NUMERIC;
  v_lead_source   TEXT;
  v_auto_muted    BOOLEAN;
  guest_count     INT := 0;
  room_count      INT := 0;
  booking_count   INT := 0;
  skip_count      INT := 0;
BEGIN
  RAISE NOTICE '[sync_suite_arrivals] ── START ── profiles=%, rooms=%',
    jsonb_array_length(COALESCE(payload->'profiles', '[]'::jsonb)),
    jsonb_array_length(COALESCE(payload->'rooms',    '[]'::jsonb));

  FOR p IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'profiles', '[]'::jsonb)) LOOP
    v_phone := p->>'guestPhone';
    v_name  := p->>'guestName';
    v_date  := NULLIF(p->>'arrivalDate',   '')::DATE;
    v_dep_date := NULLIF(p->>'departureDate', '')::DATE;
    v_order := p->>'orderNumber';
    v_payment := NULLIF(p->>'paymentAmount', '')::NUMERIC;
    v_lead_source := NULLIF(TRIM(p->>'leadSource'), '');
    v_auto_muted := COALESCE((p->>'automationMuted')::BOOL, FALSE);

    IF v_phone IS NULL OR v_phone = '' THEN
      RAISE NOTICE '[sync_suite_arrivals] SKIP guest — no phone  name=%', v_name;
      skip_count := skip_count + 1;
      CONTINUE;
    END IF;

    v_room_type := CASE
      WHEN (p->>'isDayGuest')::BOOL THEN 'day_guest'
      WHEN (p->>'hasSuite')::BOOL   THEN 'suite'
      ELSE 'standard'
    END;

    RAISE NOTICE '[sync_suite_arrivals] GUEST UPSERT  phone=%, name=%, arrival=%, room_type=%, payment=%, automation_muted=%',
      v_phone, v_name, v_date, v_room_type, v_payment, v_auto_muted;

    INSERT INTO public.guests (
      phone, name, arrival_date, departure_date,
      room_type, status, guest_index,
      order_number, treatment_count, payment_amount,
      lead_source, automation_muted
    )
    VALUES (
      v_phone,
      v_name,
      v_date,
      v_dep_date,
      v_room_type,
      'pending',
      1,
      v_order,
      COALESCE((p->>'treatment_count')::INT, 0),
      v_payment,
      v_lead_source,
      v_auto_muted
    )
    ON CONFLICT (phone, arrival_date, guest_index) DO UPDATE SET
      name             = EXCLUDED.name,
      departure_date   = COALESCE(EXCLUDED.departure_date,  guests.departure_date),
      room_type        = EXCLUDED.room_type,
      order_number     = COALESCE(EXCLUDED.order_number,    guests.order_number),
      treatment_count  = EXCLUDED.treatment_count,
      payment_amount   = COALESCE(EXCLUDED.payment_amount,  guests.payment_amount),
      lead_source      = COALESCE(EXCLUDED.lead_source,     guests.lead_source),
      automation_muted = EXCLUDED.automation_muted;

    guest_count := guest_count + 1;

    v_phone_strip := substring(v_phone FROM 2);

    RAISE NOTICE '[sync_suite_arrivals] BOOKING UPSERT  phone_strip=%, date=%',
      v_phone_strip, v_date;

    INSERT INTO public.bookings (phone, guest_name, arrival_date, status, room_count)
    VALUES (v_phone_strip, v_name, v_date, 'expected', 1)
    ON CONFLICT (phone, arrival_date) DO UPDATE SET
      guest_name = EXCLUDED.guest_name;

    booking_count := booking_count + 1;
  END LOOP;

  RAISE NOTICE '[sync_suite_arrivals] ── guests=%, bookings=% ──', guest_count, booking_count;

  FOR r IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'rooms', '[]'::jsonb)) LOOP
    v_order := r->>'orderNumber';
    v_line  := r->>'resLineId';

    IF v_order IS NULL OR v_order = '' OR v_line IS NULL OR v_line = '' THEN
      RAISE NOTICE '[sync_suite_arrivals] SKIP room — missing order/resLine  order=%, line=%', v_order, v_line;
      skip_count := skip_count + 1;
      CONTINUE;
    END IF;

    RAISE NOTICE '[sync_suite_arrivals] ROOM UPSERT  order=%, resLine=%, room=%, guest=%',
      v_order, v_line, r->>'roomName', r->>'guestPhone';

    INSERT INTO public.suite_rooms (
      order_number, res_line_id,
      room_name, suite_type,
      guest_name, guest_phone, coord_phone, phone_source,
      adults, nights,
      arrival_date, checkin_time, checkout_time,
      is_day_guest
    )
    VALUES (
      v_order, v_line,
      NULLIF(r->>'roomName',  ''), NULLIF(r->>'suiteType',  ''),
      NULLIF(r->>'guestName', ''), NULLIF(r->>'guestPhone', ''),
      NULLIF(r->>'coordPhone',''), NULLIF(r->>'phoneSource',''),
      COALESCE((r->>'adults')::INT, 1),
      COALESCE((r->>'nights')::INT, 0),
      NULLIF(r->>'arrivalDate',  '')::DATE,
      NULLIF(r->>'checkinTime',  ''),
      NULLIF(r->>'checkoutTime', ''),
      COALESCE((r->>'isDayGuest')::BOOL, FALSE)
    )
    ON CONFLICT (order_number, res_line_id) DO UPDATE SET
      guest_name   = EXCLUDED.guest_name,
      guest_phone  = EXCLUDED.guest_phone,
      coord_phone  = EXCLUDED.coord_phone,
      phone_source = EXCLUDED.phone_source,
      room_name    = EXCLUDED.room_name,
      suite_type   = EXCLUDED.suite_type,
      adults       = EXCLUDED.adults;

    room_count := room_count + 1;

    v_phone     := NULLIF(r->>'guestPhone',   '');
    v_room_name := NULLIF(r->>'roomDisplay',  '');
    IF v_phone IS NOT NULL AND v_room_name IS NOT NULL THEN
      UPDATE public.guests
      SET room = v_room_name
      WHERE phone = v_phone;
    END IF;
  END LOOP;

  RAISE NOTICE '[sync_suite_arrivals] ── rooms=%, skipped=% ──', room_count, skip_count;
  RAISE NOTICE '[sync_suite_arrivals] ── COMPLETE ──';

  RETURN jsonb_build_object(
    'ok',       TRUE,
    'guests',   guest_count,
    'rooms',    room_count,
    'bookings', booking_count,
    'skipped',  skip_count
  );

EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '[sync_suite_arrivals] ── ROLLBACK — % ──', SQLERRM;
  RAISE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_suite_arrivals(JSONB) TO authenticated;

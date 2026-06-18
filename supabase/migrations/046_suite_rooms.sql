-- Migration 046: suite_rooms table + sync_suite_arrivals RPC
-- Adds per-room granularity for group bookings (e.g. 26 suites under one coordinator).
-- The RPC handles atomic dual-write: guests + suite_rooms in one transaction.

-- ── Table: suite_rooms ────────────────────────────────────────────────────────
-- One row per physical room from the EZGO Suite CSV export.
-- Unique key: (order_number, res_line_id) — res_line_id is PMS-globally-unique.
CREATE TABLE IF NOT EXISTS public.suite_rooms (
  id             BIGSERIAL    PRIMARY KEY,
  order_number   TEXT         NOT NULL,
  res_line_id    TEXT         NOT NULL,
  room_name      TEXT,                        -- "8", "21 סוויטה נגישה"
  suite_type     TEXT,                        -- "סוויטת אמטיסט", "Premium Day 2"
  guest_name     TEXT,                        -- extracted from sRemark, else coordinator
  guest_phone    TEXT,                        -- E.164 "+972XXXXXXXXX" → links to guests.phone
  coord_phone    TEXT,                        -- E.164 booking coordinator sTel1
  phone_source   TEXT,                        -- 'individual' | 'coordinator'
  adults         INT          NOT NULL DEFAULT 1,
  nights         INT          NOT NULL DEFAULT 0,
  arrival_date   DATE,
  checkin_time   TEXT,                        -- "10:00" or null
  checkout_time  TEXT,                        -- "19:00" or null
  is_day_guest   BOOL         NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ  DEFAULT NOW(),
  CONSTRAINT suite_rooms_order_resline_key UNIQUE (order_number, res_line_id)
);

COMMENT ON TABLE  public.suite_rooms IS
  'Per-room granularity for EZGO group suite bookings. Source: DataUpload Tab 1 Suite CSV.';
COMMENT ON COLUMN public.suite_rooms.res_line_id IS
  'iReservationsLineId — globally unique per room in the PMS. The stable upsert key.';
COMMENT ON COLUMN public.suite_rooms.guest_phone IS
  'E.164 "+972XXXXXXXXX". Individual occupant phone when extracted from sRemark; else coordinator.';

-- RLS: authenticated users may read and write.
ALTER TABLE public.suite_rooms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "suite_rooms_authed_select" ON public.suite_rooms
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "suite_rooms_authed_all" ON public.suite_rooms
  FOR ALL USING (auth.uid() IS NOT NULL);

-- ── RPC: sync_suite_arrivals ──────────────────────────────────────────────────
-- Atomic dual-write: upserts guests + suite_rooms (+ bookings for webhook compat)
-- in a single PL/pgSQL transaction. If any INSERT fails the whole transaction
-- rolls back automatically — satisfying the ACID requirement.
--
-- Called from DataUpload.js via: supabase.rpc('sync_suite_arrivals', { payload })
--
-- Payload shape:
-- {
--   "profiles": [
--     { guestPhone, guestName, arrivalDate, departureDate, orderNumber,
--       hasSuite, treatment_count, nights }
--   ],
--   "rooms": [
--     { resLineId, orderNumber, roomName, suiteType,
--       guestName, guestPhone, coordPhone, phoneSource,
--       adults, nights, arrivalDate, checkinTime, checkoutTime, isDayGuest }
--   ]
-- }
--
-- Returns: { ok, guests, rooms, bookings, skipped }
CREATE OR REPLACE FUNCTION public.sync_suite_arrivals(payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  p               JSONB;
  r               JSONB;
  v_phone         TEXT;
  v_phone_strip   TEXT;   -- "972XXXXXXXXX" (no +) for bookings table
  v_name          TEXT;
  v_date          DATE;
  v_dep_date      DATE;
  v_order         TEXT;
  v_line          TEXT;
  guest_count     INT := 0;
  room_count      INT := 0;
  booking_count   INT := 0;
  skip_count      INT := 0;
BEGIN
  RAISE NOTICE '[sync_suite_arrivals] ── START ── profiles=%, rooms=%',
    jsonb_array_length(COALESCE(payload->'profiles', '[]'::jsonb)),
    jsonb_array_length(COALESCE(payload->'rooms',    '[]'::jsonb));

  -- ── 1. Upsert guests + bookings (one per profile) ──────────────────────────
  FOR p IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'profiles', '[]'::jsonb)) LOOP
    v_phone := p->>'guestPhone';
    v_name  := p->>'guestName';
    v_date  := NULLIF(p->>'arrivalDate',   '')::DATE;
    v_dep_date := NULLIF(p->>'departureDate', '')::DATE;
    v_order := p->>'orderNumber';

    -- Skip profiles with no phone (cannot contact via WhatsApp)
    IF v_phone IS NULL OR v_phone = '' THEN
      RAISE NOTICE '[sync_suite_arrivals] SKIP guest — no phone  name=%', v_name;
      skip_count := skip_count + 1;
      CONTINUE;
    END IF;

    RAISE NOTICE '[sync_suite_arrivals] GUEST UPSERT  phone=%, name=%, arrival=%',
      v_phone, v_name, v_date;

    INSERT INTO public.guests (
      phone, name, arrival_date, departure_date,
      room_type, status, guest_index,
      order_number, treatment_count
    )
    VALUES (
      v_phone,
      v_name,
      v_date,
      v_dep_date,
      CASE WHEN (p->>'hasSuite')::BOOL THEN 'suite' ELSE 'standard' END,
      'pending',
      1,
      v_order,
      COALESCE((p->>'treatment_count')::INT, 0)
    )
    ON CONFLICT (phone, arrival_date, guest_index) DO UPDATE SET
      name            = EXCLUDED.name,
      departure_date  = COALESCE(EXCLUDED.departure_date,  guests.departure_date),
      room_type       = EXCLUDED.room_type,
      order_number    = COALESCE(EXCLUDED.order_number,    guests.order_number),
      treatment_count = EXCLUDED.treatment_count;
    -- NOTE: intentionally NOT overwriting: status, spa_time, needs_callback,
    --       requires_attention — those are live bot fields set after arrival.

    guest_count := guest_count + 1;

    -- Bookings table (backward compat — webhook looks up by phone WITHOUT +)
    v_phone_strip := substring(v_phone FROM 2);   -- "+972501234567" → "972501234567"

    RAISE NOTICE '[sync_suite_arrivals] BOOKING UPSERT  phone_strip=%, date=%',
      v_phone_strip, v_date;

    INSERT INTO public.bookings (phone, guest_name, arrival_date, status, room_count)
    VALUES (v_phone_strip, v_name, v_date, 'expected', 1)
    ON CONFLICT (phone, arrival_date) DO UPDATE SET
      guest_name = EXCLUDED.guest_name;
    -- status left as-is if already beyond 'expected' (room_ready, checked_in)

    booking_count := booking_count + 1;
  END LOOP;

  RAISE NOTICE '[sync_suite_arrivals] ── guests=%, bookings=% ──', guest_count, booking_count;

  -- ── 2. Upsert suite_rooms (one per physical room row) ──────────────────────
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
    -- NOTE: NOT overwriting arrival_date on conflict — date is set on first import.

    room_count := room_count + 1;
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
  -- Re-raising causes PostgreSQL to rollback the entire transaction.
  -- All guests upserts + suite_rooms inserts are atomically reverted.
  RAISE NOTICE '[sync_suite_arrivals] ── ROLLBACK — % ──', SQLERRM;
  RAISE;
END;
$$;

-- Grant execute to authenticated users (called via supabase.rpc())
GRANT EXECUTE ON FUNCTION public.sync_suite_arrivals(JSONB) TO authenticated;

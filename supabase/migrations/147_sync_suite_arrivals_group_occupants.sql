-- 147_sync_suite_arrivals_group_occupants.sql
-- Fix Tier-2 order match: distinct remark/group occupants (same order, different
-- name+phone) must INSERT as new guests, not overwrite the first occupant.
-- Import may set automation_muted=true (one-way); never clears staff unmute.

CREATE OR REPLACE FUNCTION public.sync_suite_arrivals(payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p JSONB; r JSONB;
  v_phone TEXT; v_name TEXT; v_date DATE; v_dep_date DATE; v_order TEXT;
  v_line TEXT; v_room_name TEXT; v_room_type TEXT; v_payment NUMERIC;
  v_lead_source TEXT; v_auto_muted BOOL; v_phone_strip TEXT;
  v_room_arrival DATE;
  v_guest_id BIGINT;
  v_guest_index SMALLINT;
  v_order_count INT;
  v_existing_order TEXT;
  v_existing_room_type TEXT;
  v_old_phone TEXT;
  v_old_name TEXT;
  v_old_phone_strip TEXT;
  v_sync_dates DATE[] := ARRAY[]::DATE[];
  v_enrich_only BOOL;
  guest_count INT := 0; booking_count INT := 0; room_count INT := 0; skip_count INT := 0;
BEGIN
  v_enrich_only := COALESCE((payload->>'enrichOnly')::BOOL, FALSE);

  RAISE NOTICE '[sync_suite_arrivals] ── START ── profiles=%, rooms=%, enrichOnly=%',
    jsonb_array_length(COALESCE(payload->'profiles', '[]'::jsonb)),
    jsonb_array_length(COALESCE(payload->'rooms', '[]'::jsonb)),
    v_enrich_only;

  FOR p IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'profiles', '[]'::jsonb)) LOOP
    v_phone := NULLIF(p->>'guestPhone', '');
    v_name  := NULLIF(p->>'guestName',  '');
    v_date  := NULLIF(p->>'arrivalDate', '')::DATE;
    v_dep_date := NULLIF(p->>'departureDate', '')::DATE;
    v_order := NULLIF(p->>'orderNumber', '');
    v_payment := NULLIF(p->>'paymentAmount', '')::NUMERIC;
    v_lead_source := NULLIF(p->>'leadSource', '');
    v_auto_muted := COALESCE((p->>'automationMuted')::BOOL, FALSE);
    v_old_phone := NULL;
    v_old_name := NULL;

    IF v_phone IS NULL OR v_phone = '' THEN
      RAISE NOTICE '[sync_suite_arrivals] SKIP guest — no phone  name=%', v_name;
      skip_count := skip_count + 1;
      CONTINUE;
    END IF;

    v_guest_id := NULL;
    v_guest_index := 1;

    IF v_order IS NOT NULL AND v_date IS NOT NULL THEN
      SELECT id, guest_index INTO v_guest_id, v_guest_index
      FROM public.guests
      WHERE order_number = v_order
        AND arrival_date = v_date
        AND phone = v_phone
      LIMIT 1;
    END IF;

    IF v_guest_id IS NULL AND v_order IS NOT NULL AND v_date IS NOT NULL THEN
      SELECT COUNT(*) INTO v_order_count
      FROM public.guests
      WHERE order_number = v_order AND arrival_date = v_date;

      IF v_order_count = 1 THEN
        SELECT id, guest_index, phone, name
        INTO v_guest_id, v_guest_index, v_old_phone, v_old_name
        FROM public.guests
        WHERE order_number = v_order AND arrival_date = v_date
        LIMIT 1;

        -- Different occupant under same order (municipal/group remark rows), not phone correction
        IF v_guest_id IS NOT NULL
           AND v_old_phone IS NOT NULL AND trim(v_old_phone) <> ''
           AND v_old_phone <> v_phone
           AND v_name IS NOT NULL AND v_old_name IS NOT NULL
           AND trim(v_old_name) <> trim(v_name) THEN
          v_guest_id := NULL;
          v_guest_index := 1;
          v_old_phone := NULL;
          v_old_name := NULL;
        END IF;
      END IF;
    END IF;

    IF v_guest_id IS NULL AND v_date IS NOT NULL THEN
      IF v_order IS NOT NULL THEN
        SELECT id, guest_index INTO v_guest_id, v_guest_index
        FROM public.guests
        WHERE phone = v_phone
          AND arrival_date = v_date
          AND order_number = v_order
        LIMIT 1;
      END IF;

      IF v_guest_id IS NULL THEN
        SELECT id, guest_index, order_number INTO v_guest_id, v_guest_index, v_existing_order
        FROM public.guests
        WHERE phone = v_phone AND arrival_date = v_date AND guest_index = 1
        LIMIT 1;

        IF v_guest_id IS NOT NULL
           AND v_order IS NOT NULL
           AND v_existing_order IS NOT NULL
           AND v_existing_order <> v_order THEN
          v_guest_id := NULL;
        END IF;
      END IF;
    END IF;

    IF v_guest_id IS NULL AND v_date IS NOT NULL THEN
      SELECT COALESCE(MAX(guest_index), 0) + 1 INTO v_guest_index
      FROM public.guests
      WHERE phone = v_phone AND arrival_date = v_date;
    END IF;

    v_existing_room_type := NULL;
    IF v_guest_id IS NOT NULL THEN
      SELECT room_type INTO v_existing_room_type FROM public.guests WHERE id = v_guest_id;
    END IF;

    v_room_type := CASE
      WHEN v_existing_room_type = 'premium_day_guest' AND (p->>'isDayGuest')::BOOL
        THEN 'premium_day_guest'
      WHEN (p->>'isDayGuest')::BOOL THEN 'day_guest'
      WHEN (p->>'hasSuite')::BOOL   THEN 'suite'
      ELSE 'standard'
    END;

    IF v_guest_id IS NOT NULL THEN
      SELECT phone INTO v_old_phone FROM public.guests WHERE id = v_guest_id;

      IF v_enrich_only THEN
        UPDATE public.guests SET
          phone            = COALESCE(NULLIF(trim(phone), ''), v_phone),
          name             = COALESCE(NULLIF(trim(name), ''), v_name),
          departure_date   = COALESCE(departure_date, v_dep_date),
          order_number     = COALESCE(NULLIF(trim(order_number), ''), v_order),
          treatment_count  = CASE
            WHEN treatment_count IS NULL OR treatment_count <= 0
              THEN COALESCE((p->>'treatment_count')::INT, treatment_count)
            ELSE treatment_count
          END,
          payment_amount   = COALESCE(payment_amount, v_payment),
          lead_source      = COALESCE(NULLIF(trim(lead_source), ''), v_lead_source),
          automation_muted = CASE WHEN v_auto_muted THEN TRUE ELSE automation_muted END
        WHERE id = v_guest_id;
      ELSE
        UPDATE public.guests SET
          phone            = v_phone,
          name             = v_name,
          departure_date   = COALESCE(v_dep_date, departure_date),
          room_type        = v_room_type,
          order_number     = COALESCE(v_order, order_number),
          treatment_count  = COALESCE((p->>'treatment_count')::INT, treatment_count),
          payment_amount   = COALESCE(v_payment, payment_amount),
          lead_source      = COALESCE(v_lead_source, lead_source),
          automation_muted = CASE WHEN v_auto_muted THEN TRUE ELSE automation_muted END
        WHERE id = v_guest_id;
      END IF;
    ELSE
      INSERT INTO public.guests (
        phone, name, arrival_date, departure_date,
        room_type, status, guest_index,
        order_number, treatment_count, payment_amount,
        lead_source, automation_muted
      )
      VALUES (
        v_phone, v_name, v_date, v_dep_date, v_room_type, 'pending', v_guest_index,
        v_order, COALESCE((p->>'treatment_count')::INT, 0), v_payment,
        v_lead_source, v_auto_muted
      )
      ON CONFLICT (phone, arrival_date, guest_index) DO UPDATE SET
        name             = CASE WHEN v_enrich_only
          THEN COALESCE(NULLIF(trim(guests.name), ''), EXCLUDED.name)
          ELSE EXCLUDED.name END,
        departure_date   = CASE WHEN v_enrich_only
          THEN COALESCE(guests.departure_date, EXCLUDED.departure_date)
          ELSE COALESCE(EXCLUDED.departure_date, guests.departure_date) END,
        room_type        = CASE WHEN v_enrich_only THEN guests.room_type ELSE EXCLUDED.room_type END,
        order_number     = CASE WHEN v_enrich_only
          THEN COALESCE(NULLIF(trim(guests.order_number), ''), EXCLUDED.order_number)
          ELSE COALESCE(EXCLUDED.order_number, guests.order_number) END,
        treatment_count  = CASE WHEN v_enrich_only
          THEN CASE WHEN guests.treatment_count IS NULL OR guests.treatment_count <= 0
            THEN EXCLUDED.treatment_count ELSE guests.treatment_count END
          ELSE EXCLUDED.treatment_count END,
        payment_amount   = CASE WHEN v_enrich_only
          THEN COALESCE(guests.payment_amount, EXCLUDED.payment_amount)
          ELSE COALESCE(EXCLUDED.payment_amount, guests.payment_amount) END,
        lead_source      = CASE WHEN v_enrich_only
          THEN COALESCE(NULLIF(trim(guests.lead_source), ''), EXCLUDED.lead_source)
          ELSE COALESCE(EXCLUDED.lead_source, guests.lead_source) END,
        automation_muted = guests.automation_muted OR EXCLUDED.automation_muted;
    END IF;

    guest_count := guest_count + 1;
    v_phone_strip := substring(v_phone FROM 2);
    v_old_phone_strip := CASE WHEN v_old_phone IS NOT NULL THEN substring(v_old_phone FROM 2) ELSE NULL END;

    IF v_old_phone_strip IS NOT NULL AND v_old_phone_strip <> v_phone_strip AND v_date IS NOT NULL THEN
      UPDATE public.bookings
      SET phone = v_phone_strip, guest_name = v_name
      WHERE phone = v_old_phone_strip AND arrival_date = v_date;
    END IF;

    INSERT INTO public.bookings (phone, guest_name, arrival_date, status, room_count)
    VALUES (v_phone_strip, v_name, v_date, 'expected', 1)
    ON CONFLICT (phone, arrival_date) DO UPDATE SET
      guest_name = CASE WHEN v_enrich_only
        THEN COALESCE(NULLIF(trim(bookings.guest_name), ''), EXCLUDED.guest_name)
        ELSE EXCLUDED.guest_name END;

    booking_count := booking_count + 1;
    v_old_phone := NULL;

    IF v_date IS NOT NULL THEN
      v_sync_dates := array_append(v_sync_dates, v_date);
    END IF;
  END LOOP;

  FOR r IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'rooms', '[]'::jsonb)) LOOP
    v_order := r->>'orderNumber';
    v_line  := r->>'resLineId';

    IF v_order IS NULL OR v_order = '' OR v_line IS NULL OR v_line = '' THEN
      skip_count := skip_count + 1;
      CONTINUE;
    END IF;

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
      NULLIF(r->>'roomName', ''), NULLIF(r->>'suiteType', ''),
      NULLIF(r->>'guestName', ''), NULLIF(r->>'guestPhone', ''),
      NULLIF(r->>'coordPhone', ''), NULLIF(r->>'phoneSource', ''),
      COALESCE((r->>'adults')::INT, 1),
      COALESCE((r->>'nights')::INT, 0),
      NULLIF(r->>'arrivalDate', '')::DATE,
      NULLIF(r->>'checkinTime', ''),
      NULLIF(r->>'checkoutTime', ''),
      COALESCE((r->>'isDayGuest')::BOOL, FALSE)
    )
    ON CONFLICT (order_number, res_line_id) DO UPDATE SET
      guest_name   = CASE WHEN v_enrich_only
        THEN COALESCE(NULLIF(trim(suite_rooms.guest_name), ''), EXCLUDED.guest_name)
        ELSE EXCLUDED.guest_name END,
      guest_phone  = CASE WHEN v_enrich_only
        THEN COALESCE(NULLIF(trim(suite_rooms.guest_phone), ''), EXCLUDED.guest_phone)
        ELSE EXCLUDED.guest_phone END,
      coord_phone  = CASE WHEN v_enrich_only
        THEN COALESCE(NULLIF(trim(suite_rooms.coord_phone), ''), EXCLUDED.coord_phone)
        ELSE EXCLUDED.coord_phone END,
      phone_source = CASE WHEN v_enrich_only
        THEN COALESCE(NULLIF(trim(suite_rooms.phone_source), ''), EXCLUDED.phone_source)
        ELSE EXCLUDED.phone_source END,
      room_name    = CASE WHEN v_enrich_only
        THEN COALESCE(NULLIF(trim(suite_rooms.room_name), ''), EXCLUDED.room_name)
        ELSE EXCLUDED.room_name END,
      suite_type   = CASE WHEN v_enrich_only
        THEN COALESCE(NULLIF(trim(suite_rooms.suite_type), ''), EXCLUDED.suite_type)
        ELSE EXCLUDED.suite_type END,
      adults       = EXCLUDED.adults;

    room_count := room_count + 1;

    v_phone     := NULLIF(r->>'guestPhone', '');
    v_room_name := NULLIF(r->>'roomDisplay', '');
    v_room_arrival := NULLIF(r->>'arrivalDate', '')::DATE;
    IF v_phone IS NOT NULL AND v_room_name IS NOT NULL THEN
      IF v_enrich_only THEN
        UPDATE public.guests
        SET room = v_room_name
        WHERE phone = v_phone
          AND (v_room_arrival IS NULL OR arrival_date = v_room_arrival)
          AND (v_order IS NULL OR order_number = v_order)
          AND (room IS NULL OR trim(room) = '');
      ELSE
        UPDATE public.guests
        SET room = v_room_name
        WHERE phone = v_phone
          AND (v_room_arrival IS NULL OR arrival_date = v_room_arrival)
          AND (v_order IS NULL OR order_number = v_order);
      END IF;
    END IF;
  END LOOP;

  IF array_length(v_sync_dates, 1) > 0 THEN
    UPDATE public.guests
    SET room_type = 'premium_day_guest'
    WHERE room_type = 'day_guest'
      AND room IN ('Premium Day 1', 'Premium Day 2')
      AND arrival_date = ANY(v_sync_dates);
  END IF;

  RETURN jsonb_build_object(
    'ok', TRUE, 'guests', guest_count, 'rooms', room_count,
    'bookings', booking_count, 'skipped', skip_count,
    'enrichOnly', v_enrich_only
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '[sync_suite_arrivals] ── ROLLBACK — % ──', SQLERRM;
  RAISE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.sync_suite_arrivals(JSONB) TO authenticated;

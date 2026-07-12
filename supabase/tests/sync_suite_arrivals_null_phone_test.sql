-- sync_suite_arrivals_null_phone_test.sql
-- Sprint C DOCS2 — no-phone guest creation, dedup on re-sync, phone
-- enrichment, and Zero-Data-Loss phone preservation on full re-import.
-- Run in Supabase SQL Editor (BEGIN/ROLLBACK — no persistent writes).

BEGIN;

-- Test 1: no-phone profile with name+order → guest row created, phone NULL,
-- muted, and no crash from the bookings insert (phone NOT NULL there).
DO $$
DECLARE
  v_order TEXT := 'test_nophone_' || floor(random() * 1000000)::TEXT;
  v_date DATE := '2026-09-01';
  v_result JSONB;
  v_phone TEXT;
  v_scope TEXT;
  v_muted BOOL;
  v_booking_count INT;
BEGIN
  DELETE FROM public.guests WHERE order_number = v_order;
  DELETE FROM public.bookings WHERE guest_name = 'ללא טלפון בדיקה';

  v_result := public.sync_suite_arrivals(jsonb_build_object(
    'enrichOnly', false,
    'profiles', jsonb_build_array(
      jsonb_build_object(
        'guestPhone', NULL,
        'guestName', 'ללא טלפון בדיקה',
        'arrivalDate', v_date::TEXT,
        'departureDate', '2026-09-02',
        'orderNumber', v_order,
        'hasSuite', true,
        'isDayGuest', false,
        'automationScope', 'full'  -- payload asks for full, RPC must still force muted
      )
    ),
    'rooms', '[]'::jsonb
  ));

  IF (v_result->>'ok')::BOOL IS NOT TRUE THEN
    RAISE EXCEPTION 'sync failed: %', v_result;
  END IF;
  IF (v_result->>'createdWithoutPhone')::INT <> 1 THEN
    RAISE EXCEPTION 'expected createdWithoutPhone=1, got %', v_result->>'createdWithoutPhone';
  END IF;

  SELECT phone, automation_scope, automation_muted
  INTO v_phone, v_scope, v_muted
  FROM public.guests WHERE order_number = v_order;

  IF v_phone IS NOT NULL THEN
    RAISE EXCEPTION 'expected phone IS NULL, got %', v_phone;
  END IF;
  IF v_scope <> 'muted' OR NOT v_muted THEN
    RAISE EXCEPTION 'expected forced muted scope regardless of payload, got scope=% muted=%', v_scope, v_muted;
  END IF;

  SELECT COUNT(*) INTO v_booking_count FROM public.bookings WHERE guest_name = 'ללא טלפון בדיקה';
  IF v_booking_count <> 0 THEN
    RAISE EXCEPTION 'no-phone guest must not create a bookings row (phone NOT NULL there), got %', v_booking_count;
  END IF;

  RAISE NOTICE 'PASS: no-phone guest created — phone NULL, forced muted, no bookings row';
END $$;

-- Test 2: re-sync the SAME no-phone/order+date row → must UPDATE, not duplicate.
DO $$
DECLARE
  v_order TEXT := 'test_nophone_dup_' || floor(random() * 1000000)::TEXT;
  v_date DATE := '2026-09-03';
  v_payload JSONB;
  v_count INT;
BEGIN
  DELETE FROM public.guests WHERE order_number = v_order;

  v_payload := jsonb_build_object(
    'enrichOnly', false,
    'profiles', jsonb_build_array(jsonb_build_object(
      'guestPhone', NULL, 'guestName', 'כפילות בדיקה', 'arrivalDate', v_date::TEXT,
      'orderNumber', v_order, 'hasSuite', true, 'isDayGuest', false
    )),
    'rooms', '[]'::jsonb
  );

  PERFORM public.sync_suite_arrivals(v_payload);
  PERFORM public.sync_suite_arrivals(v_payload); -- re-import same file

  SELECT COUNT(*) INTO v_count FROM public.guests WHERE order_number = v_order;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'expected 1 guest after re-sync (no duplicate), got %', v_count;
  END IF;

  RAISE NOTICE 'PASS: re-syncing the same no-phone order+date does not duplicate';
END $$;

-- Test 3: no-phone guest later enriched with a real phone → same row updated
-- (Tier-2 order+date match), not a second INSERT.
DO $$
DECLARE
  v_order TEXT := 'test_enrich_phone_' || floor(random() * 1000000)::TEXT;
  v_date DATE := '2026-09-04';
  v_count INT;
  v_phone TEXT;
BEGIN
  DELETE FROM public.guests WHERE order_number = v_order;

  PERFORM public.sync_suite_arrivals(jsonb_build_object(
    'enrichOnly', false,
    'profiles', jsonb_build_array(jsonb_build_object(
      'guestPhone', NULL, 'guestName', 'הועשר בטלפון', 'arrivalDate', v_date::TEXT,
      'orderNumber', v_order, 'hasSuite', true, 'isDayGuest', false
    )),
    'rooms', '[]'::jsonb
  ));

  -- Staff types a phone into the grid and re-syncs the same order+date.
  PERFORM public.sync_suite_arrivals(jsonb_build_object(
    'enrichOnly', false,
    'profiles', jsonb_build_array(jsonb_build_object(
      'guestPhone', '+972507001122', 'guestName', 'הועשר בטלפון', 'arrivalDate', v_date::TEXT,
      'orderNumber', v_order, 'hasSuite', true, 'isDayGuest', false
    )),
    'rooms', '[]'::jsonb
  ));

  SELECT COUNT(*) INTO v_count FROM public.guests WHERE order_number = v_order;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'expected 1 guest after phone enrichment (same row updated), got %', v_count;
  END IF;

  SELECT phone INTO v_phone FROM public.guests WHERE order_number = v_order;
  IF v_phone <> '+972507001122' THEN
    RAISE EXCEPTION 'expected phone to be set on the existing row, got %', v_phone;
  END IF;

  RAISE NOTICE 'PASS: no-phone guest enriched with a phone updates the same row';
END $$;

-- Test 4: Zero Data Loss — a full (non-enrich) re-import with a blank phone
-- must never null out a phone the row already has.
DO $$
DECLARE
  v_order TEXT := 'test_preserve_phone_' || floor(random() * 1000000)::TEXT;
  v_date DATE := '2026-09-05';
  v_phone TEXT;
BEGIN
  DELETE FROM public.guests WHERE order_number = v_order;

  PERFORM public.sync_suite_arrivals(jsonb_build_object(
    'enrichOnly', false,
    'profiles', jsonb_build_array(jsonb_build_object(
      'guestPhone', '+972507003344', 'guestName', 'שימור טלפון', 'arrivalDate', v_date::TEXT,
      'orderNumber', v_order, 'hasSuite', true, 'isDayGuest', false
    )),
    'rooms', '[]'::jsonb
  ));

  -- A later full-mode import for the same order+date arrives with no phone
  -- (e.g. a different export that dropped the column) — must not erase it.
  PERFORM public.sync_suite_arrivals(jsonb_build_object(
    'enrichOnly', false,
    'profiles', jsonb_build_array(jsonb_build_object(
      'guestPhone', NULL, 'guestName', 'שימור טלפון', 'arrivalDate', v_date::TEXT,
      'orderNumber', v_order, 'hasSuite', true, 'isDayGuest', false
    )),
    'rooms', '[]'::jsonb
  ));

  SELECT phone INTO v_phone FROM public.guests WHERE order_number = v_order;
  IF v_phone IS DISTINCT FROM '+972507003344' THEN
    RAISE EXCEPTION 'expected existing phone preserved through blank-phone re-import, got %', v_phone;
  END IF;

  RAISE NOTICE 'PASS: full-mode re-import with blank phone preserves existing phone';
END $$;

-- Test 5: truly unimportable — no phone, no name, no order → skipped, no row.
DO $$
DECLARE
  v_date DATE := '2026-09-06';
  v_result JSONB;
  v_before INT;
  v_after INT;
BEGIN
  SELECT COUNT(*) INTO v_before FROM public.guests WHERE arrival_date = v_date AND phone IS NULL AND name IS NULL;

  v_result := public.sync_suite_arrivals(jsonb_build_object(
    'enrichOnly', false,
    'profiles', jsonb_build_array(jsonb_build_object(
      'guestPhone', NULL, 'guestName', NULL, 'arrivalDate', v_date::TEXT,
      'orderNumber', NULL, 'hasSuite', true, 'isDayGuest', false
    )),
    'rooms', '[]'::jsonb
  ));

  IF (v_result->>'skipped')::INT <> 1 THEN
    RAISE EXCEPTION 'expected skipped=1 for a fully blank row, got %', v_result->>'skipped';
  END IF;

  SELECT COUNT(*) INTO v_after FROM public.guests WHERE arrival_date = v_date AND phone IS NULL AND name IS NULL;
  IF v_after <> v_before THEN
    RAISE EXCEPTION 'a fully blank row must not create a guest row';
  END IF;

  RAISE NOTICE 'PASS: fully blank row (no phone/name/order) is skipped, not imported';
END $$;

ROLLBACK;

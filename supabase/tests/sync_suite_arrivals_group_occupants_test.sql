-- sync_suite_arrivals_group_occupants_test.sql
-- Two remark occupants, same order_number, different phones → two guest rows.
-- Run in Supabase SQL Editor (BEGIN/ROLLBACK — no persistent writes).

BEGIN;

DO $$
DECLARE
  v_order TEXT := 'test_grp_' || floor(random() * 1000000)::TEXT;
  v_date DATE := '2026-08-01';
  v_result JSONB;
  v_count INT;
  v_muted_a BOOL;
  v_muted_b BOOL;
BEGIN
  DELETE FROM public.guests WHERE order_number = v_order;

  v_result := public.sync_suite_arrivals(jsonb_build_object(
    'enrichOnly', false,
    'profiles', jsonb_build_array(
      jsonb_build_object(
        'guestPhone', '+972507774904',
        'guestName', 'מרדכי',
        'arrivalDate', v_date::TEXT,
        'departureDate', '2026-08-02',
        'orderNumber', v_order,
        'hasSuite', true,
        'isDayGuest', false,
        'automationMuted', true
      ),
      jsonb_build_object(
        'guestPhone', '+972526691991',
        'guestName', 'גבריאל',
        'arrivalDate', v_date::TEXT,
        'departureDate', '2026-08-02',
        'orderNumber', v_order,
        'hasSuite', true,
        'isDayGuest', false,
        'automationMuted', true
      )
    ),
    'rooms', '[]'::jsonb
  ));

  IF (v_result->>'ok')::BOOL IS NOT TRUE THEN
    RAISE EXCEPTION 'sync failed: %', v_result;
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.guests
  WHERE order_number = v_order AND arrival_date = v_date;

  IF v_count <> 2 THEN
    RAISE EXCEPTION 'expected 2 guests on order %, got %', v_order, v_count;
  END IF;

  SELECT automation_muted INTO v_muted_a
  FROM public.guests WHERE order_number = v_order AND phone = '+972507774904';

  SELECT automation_muted INTO v_muted_b
  FROM public.guests WHERE order_number = v_order AND phone = '+972526691991';

  IF NOT v_muted_a OR NOT v_muted_b THEN
    RAISE EXCEPTION 'expected automation_muted=true for both occupants';
  END IF;

  RAISE NOTICE 'PASS: two group occupants imported with automation_muted';
END $$;

ROLLBACK;

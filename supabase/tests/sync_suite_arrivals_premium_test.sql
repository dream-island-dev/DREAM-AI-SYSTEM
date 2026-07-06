-- supabase/tests/sync_suite_arrivals_premium_test.sql
--
-- Manual verification for migration 144 (premium_day_guest preservation +
-- auto-promotion in sync_suite_arrivals). Run each scenario in the Supabase
-- SQL editor AFTER `npx supabase db push` — every block is wrapped in
-- BEGIN/ROLLBACK so nothing is left behind, same convention as
-- voucher_reconciliation_e2e_test.sql (session 54).
--
-- Run blocks one at a time (or all together — each is self-contained and
-- rolls back before the next begins).

-- ── Scenario A — an existing premium_day_guest re-synced with day-guest data
--    must STAY premium_day_guest (the core regression this migration fixes) ──
BEGIN;

INSERT INTO public.guests (phone, name, arrival_date, room_type, status, guest_index, order_number)
VALUES ('+972500000001', 'Test Premium Guest', '2026-08-01', 'premium_day_guest', 'pending', 1, 'TESTORD-A');

SELECT public.sync_suite_arrivals(jsonb_build_object(
  'profiles', jsonb_build_array(jsonb_build_object(
    'guestPhone', '+972500000001',
    'guestName', 'Test Premium Guest',
    'arrivalDate', '2026-08-01',
    'orderNumber', 'TESTORD-A',
    'isDayGuest', true,
    'hasSuite', false
  )),
  'rooms', '[]'::jsonb
));

DO $$
DECLARE v_result TEXT;
BEGIN
  SELECT room_type INTO v_result FROM public.guests WHERE phone = '+972500000001' AND arrival_date = '2026-08-01';
  IF v_result <> 'premium_day_guest' THEN
    RAISE EXCEPTION 'Scenario A FAILED: expected premium_day_guest to survive re-sync, got %', v_result;
  END IF;
  RAISE NOTICE 'Scenario A PASSED: premium_day_guest preserved across re-sync (got %)', v_result;
END $$;

ROLLBACK;

-- ── Scenario B — a day_guest assigned room "Premium Day 1" via the rooms[]
--    payload gets auto-promoted to premium_day_guest ──────────────────────
BEGIN;

SELECT public.sync_suite_arrivals(jsonb_build_object(
  'profiles', jsonb_build_array(jsonb_build_object(
    'guestPhone', '+972500000002',
    'guestName', 'Test Auto-Promote Guest',
    'arrivalDate', '2026-08-01',
    'orderNumber', 'TESTORD-B',
    'isDayGuest', true,
    'hasSuite', false
  )),
  'rooms', jsonb_build_array(jsonb_build_object(
    'orderNumber', 'TESTORD-B',
    'resLineId', 'LINE-B1',
    'guestPhone', '+972500000002',
    'arrivalDate', '2026-08-01',
    'roomDisplay', 'Premium Day 1',
    'isDayGuest', true
  ))
));

DO $$
DECLARE v_result TEXT;
BEGIN
  SELECT room_type INTO v_result FROM public.guests WHERE phone = '+972500000002' AND arrival_date = '2026-08-01';
  IF v_result <> 'premium_day_guest' THEN
    RAISE EXCEPTION 'Scenario B FAILED: expected auto-promotion to premium_day_guest, got %', v_result;
  END IF;
  RAISE NOTICE 'Scenario B PASSED: room="Premium Day 1" auto-promoted (got %)', v_result;
END $$;

ROLLBACK;

-- ── Scenario C — a plain day_guest with no room assigned stays day_guest
--    (no false-positive promotion) ────────────────────────────────────────
BEGIN;

SELECT public.sync_suite_arrivals(jsonb_build_object(
  'profiles', jsonb_build_array(jsonb_build_object(
    'guestPhone', '+972500000003',
    'guestName', 'Test Plain Day Guest',
    'arrivalDate', '2026-08-01',
    'orderNumber', 'TESTORD-C',
    'isDayGuest', true,
    'hasSuite', false
  )),
  'rooms', '[]'::jsonb
));

DO $$
DECLARE v_result TEXT;
BEGIN
  SELECT room_type INTO v_result FROM public.guests WHERE phone = '+972500000003' AND arrival_date = '2026-08-01';
  IF v_result <> 'day_guest' THEN
    RAISE EXCEPTION 'Scenario C FAILED: expected plain day_guest to stay day_guest, got %', v_result;
  END IF;
  RAISE NOTICE 'Scenario C PASSED: no false-positive promotion (got %)', v_result;
END $$;

ROLLBACK;

-- ── Scenario D — a suite guest re-synced stays suite (no regression) ──────
BEGIN;

INSERT INTO public.guests (phone, name, arrival_date, room_type, status, guest_index, order_number)
VALUES ('+972500000004', 'Test Suite Guest', '2026-08-01', 'suite', 'pending', 1, 'TESTORD-D');

SELECT public.sync_suite_arrivals(jsonb_build_object(
  'profiles', jsonb_build_array(jsonb_build_object(
    'guestPhone', '+972500000004',
    'guestName', 'Test Suite Guest',
    'arrivalDate', '2026-08-01',
    'orderNumber', 'TESTORD-D',
    'isDayGuest', false,
    'hasSuite', true
  )),
  'rooms', '[]'::jsonb
));

DO $$
DECLARE v_result TEXT;
BEGIN
  SELECT room_type INTO v_result FROM public.guests WHERE phone = '+972500000004' AND arrival_date = '2026-08-01';
  IF v_result <> 'suite' THEN
    RAISE EXCEPTION 'Scenario D FAILED: expected suite guest to stay suite, got %', v_result;
  END IF;
  RAISE NOTICE 'Scenario D PASSED: suite classification unchanged (got %)', v_result;
END $$;

ROLLBACK;

-- ── Scenario E — a guest who BECOMES a suite guest this sync overrides a
--    prior premium_day_guest tag (premium-preserve guard must not be sticky
--    when the new data genuinely says suite) ──────────────────────────────
BEGIN;

INSERT INTO public.guests (phone, name, arrival_date, room_type, status, guest_index, order_number)
VALUES ('+972500000005', 'Test Reclassified Guest', '2026-08-01', 'premium_day_guest', 'pending', 1, 'TESTORD-E');

SELECT public.sync_suite_arrivals(jsonb_build_object(
  'profiles', jsonb_build_array(jsonb_build_object(
    'guestPhone', '+972500000005',
    'guestName', 'Test Reclassified Guest',
    'arrivalDate', '2026-08-01',
    'orderNumber', 'TESTORD-E',
    'isDayGuest', false,
    'hasSuite', true
  )),
  'rooms', '[]'::jsonb
));

DO $$
DECLARE v_result TEXT;
BEGIN
  SELECT room_type INTO v_result FROM public.guests WHERE phone = '+972500000005' AND arrival_date = '2026-08-01';
  IF v_result <> 'suite' THEN
    RAISE EXCEPTION 'Scenario E FAILED: expected genuine suite reclassification to win, got %', v_result;
  END IF;
  RAISE NOTICE 'Scenario E PASSED: genuine reclassification to suite overrides stale premium tag (got %)', v_result;
END $$;

ROLLBACK;

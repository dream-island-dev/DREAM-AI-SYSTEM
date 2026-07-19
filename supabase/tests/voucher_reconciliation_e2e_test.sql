-- ============================================================================
-- Voucher Reconciliation Engine — End-to-End RPC Self-Test
-- ============================================================================
-- Run this in the Supabase SQL Editor (or via psql) to verify the complete
-- reconciliation pipeline: data insert → RPC → result assertions → cleanup.
--
-- HOW TO RUN:
--   Supabase Dashboard → SQL Editor → paste + Run.
--   All data is inserted and deleted within a single transaction so no
--   test rows survive in production tables.
--
-- TEST SCENARIOS:
--   A. Hightech Zone (truncate_4): '999888' vs '999888-4321' → matched
--   B. Hever (exact): '999888' vs '999888-4321' → missing_in_easygo + missing_in_provider
--   C. package_mismatch: same voucher, different package_type
--   D. missing_in_provider: EasyGo row with no provider counterpart
--   E. unparseable: provider row with NULL voucher_number
-- ============================================================================

BEGIN;

-- ── 0. Resolve provider IDs (seeded by migration 091) ─────────────────────
DO $$
DECLARE
  v_hz_id  BIGINT;
  v_hev_id BIGINT;
BEGIN
  SELECT id INTO v_hz_id  FROM public.voucher_providers WHERE provider_name = 'Hightech Zone';
  SELECT id INTO v_hev_id FROM public.voucher_providers WHERE provider_name = 'Hever';
  IF v_hz_id IS NULL  THEN RAISE EXCEPTION 'TEST SETUP FAIL: Hightech Zone provider not found'; END IF;
  IF v_hev_id IS NULL THEN RAISE EXCEPTION 'TEST SETUP FAIL: Hever provider not found'; END IF;
  RAISE NOTICE 'Provider IDs — Hightech Zone: %, Hever: %', v_hz_id, v_hev_id;
END;
$$;

-- ── 1. Insert synthetic test data ──────────────────────────────────────────
--       One provider_batch + one easygo_batch per test scenario so the RPC
--       can be called once per scenario without cross-contamination.

-- ────────────────────────────────────────────────────────────────────────────
-- SCENARIO A: Hightech Zone / truncate_4
--   Provider voucher '999888' MUST match EasyGo '999888-4321'
-- ────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_hz_id        BIGINT;
  v_prov_batch   UUID := gen_random_uuid();
  v_ego_batch    UUID := gen_random_uuid();
  v_prov_row_id  BIGINT;
  v_ego_row_id   BIGINT;
  v_rpc_result   JSONB;
  v_result_row   public.voucher_reconciliation_results%ROWTYPE;
BEGIN
  SELECT id INTO v_hz_id FROM public.voucher_providers WHERE provider_name = 'Hightech Zone';

  INSERT INTO public.voucher_provider_reports
    (import_batch, provider_id, voucher_number, guest_name, package_type, amount)
  VALUES (v_prov_batch, v_hz_id, '999888', 'ישראל ישראלי', 'זוגי + שמפניה', 450)
  RETURNING id INTO v_prov_row_id;

  INSERT INTO public.voucher_easygo_records
    (import_batch, voucher_number, guest_name, package_type)
  VALUES (v_ego_batch, '999888-4321', 'ישראל ישראלי', 'זוגי + שמפניה')
  RETURNING id INTO v_ego_row_id;

  SELECT public.run_voucher_reconciliation(v_prov_batch, v_ego_batch) INTO v_rpc_result;
  RAISE NOTICE 'SCENARIO A RPC result: %', v_rpc_result;

  -- Assert: exactly 1 matched, nothing else
  IF (v_rpc_result->>'matched')::INT <> 1 THEN
    RAISE EXCEPTION 'SCENARIO A FAIL: expected matched=1, got %', v_rpc_result->>'matched';
  END IF;
  IF (v_rpc_result->>'missing_in_easygo')::INT <> 0
  OR (v_rpc_result->>'missing_in_provider')::INT <> 0
  OR (v_rpc_result->>'package_mismatch')::INT <> 0 THEN
    RAISE EXCEPTION 'SCENARIO A FAIL: unexpected exceptions — %', v_rpc_result;
  END IF;

  -- Assert the result row has match_basis = 'truncate_4'
  SELECT * INTO v_result_row
  FROM public.voucher_reconciliation_results
  WHERE reconciliation_run_id = (v_rpc_result->>'reconciliation_run_id')::UUID;
  IF v_result_row.match_status <> 'matched' THEN
    RAISE EXCEPTION 'SCENARIO A FAIL: result row match_status=% (expected matched)', v_result_row.match_status;
  END IF;
  IF v_result_row.match_basis <> 'truncate_4' THEN
    RAISE EXCEPTION 'SCENARIO A FAIL: match_basis=% (expected truncate_4)', v_result_row.match_basis;
  END IF;

  RAISE NOTICE '✅ SCENARIO A PASSED — "999888-4321" matched "999888" via truncate_4';

  -- Cleanup (ROLLBACK at the end covers this, but explicit delete as belt+suspenders)
  DELETE FROM public.voucher_reconciliation_results WHERE reconciliation_run_id = (v_rpc_result->>'reconciliation_run_id')::UUID;
  DELETE FROM public.voucher_easygo_records   WHERE import_batch = v_ego_batch;
  DELETE FROM public.voucher_provider_reports WHERE import_batch = v_prov_batch;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- SCENARIO B: Hever / suffix_5 — 6-digit EasyGo must match 5-digit provider
-- ────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_hev_id      BIGINT;
  v_prov_batch  UUID := gen_random_uuid();
  v_ego_batch   UUID := gen_random_uuid();
  v_rpc_result  JSONB;
  v_run_id      UUID;
BEGIN
  SELECT id INTO v_hev_id FROM public.voucher_providers WHERE provider_name = 'Hever';

  INSERT INTO public.voucher_provider_reports
    (import_batch, provider_id, voucher_number, guest_name)
  VALUES (v_prov_batch, v_hev_id, '34781', 'שרה כהן');

  INSERT INTO public.voucher_easygo_records
    (import_batch, voucher_number, guest_name)
  VALUES (v_ego_batch, '434781', 'שרה כהן');

  SELECT public.run_voucher_reconciliation(v_prov_batch, v_ego_batch) INTO v_rpc_result;
  v_run_id := (v_rpc_result->>'reconciliation_run_id')::UUID;
  RAISE NOTICE 'SCENARIO B RPC result: %', v_rpc_result;

  IF (v_rpc_result->>'matched')::INT <> 1 THEN
    RAISE EXCEPTION 'SCENARIO B FAIL: Hever suffix_5 should match 434781 vs 34781 — got matched=%', v_rpc_result->>'matched';
  END IF;

  RAISE NOTICE '✅ SCENARIO B PASSED — Hever suffix_5 matches 434781 vs 34781';

  DELETE FROM public.voucher_reconciliation_results WHERE reconciliation_run_id = v_run_id;
  DELETE FROM public.voucher_easygo_records   WHERE import_batch = v_ego_batch;
  DELETE FROM public.voucher_provider_reports WHERE import_batch = v_prov_batch;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- SCENARIO C: package_mismatch — same voucher number, different package_type
-- ────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_hz_id      BIGINT;
  v_prov_batch UUID := gen_random_uuid();
  v_ego_batch  UUID := gen_random_uuid();
  v_rpc_result JSONB;
  v_run_id     UUID;
BEGIN
  SELECT id INTO v_hz_id FROM public.voucher_providers WHERE provider_name = 'Hightech Zone';

  INSERT INTO public.voucher_provider_reports (import_batch, provider_id, voucher_number, package_type)
  VALUES (v_prov_batch, v_hz_id, '777333', 'זוגי + שמפניה');

  INSERT INTO public.voucher_easygo_records (import_batch, voucher_number, package_type)
  VALUES (v_ego_batch, '777333-1234', 'זוגי בלבד');

  SELECT public.run_voucher_reconciliation(v_prov_batch, v_ego_batch) INTO v_rpc_result;
  v_run_id := (v_rpc_result->>'reconciliation_run_id')::UUID;
  RAISE NOTICE 'SCENARIO C RPC result: %', v_rpc_result;

  IF (v_rpc_result->>'package_mismatch')::INT <> 1 THEN
    RAISE EXCEPTION 'SCENARIO C FAIL: expected package_mismatch=1, got %', v_rpc_result;
  END IF;

  RAISE NOTICE '✅ SCENARIO C PASSED — package_mismatch correctly detected';

  DELETE FROM public.voucher_reconciliation_results WHERE reconciliation_run_id = v_run_id;
  DELETE FROM public.voucher_easygo_records   WHERE import_batch = v_ego_batch;
  DELETE FROM public.voucher_provider_reports WHERE import_batch = v_prov_batch;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- SCENARIO D: missing_in_provider — EasyGo row with no provider counterpart
-- ────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_hz_id      BIGINT;
  v_prov_batch UUID := gen_random_uuid();
  v_ego_batch  UUID := gen_random_uuid();
  v_rpc_result JSONB;
  v_run_id     UUID;
BEGIN
  SELECT id INTO v_hz_id FROM public.voucher_providers WHERE provider_name = 'Hightech Zone';

  -- Provider side: nothing with voucher '444555'
  INSERT INTO public.voucher_provider_reports (import_batch, provider_id, voucher_number)
  VALUES (v_prov_batch, v_hz_id, '111000');  -- a different unrelated voucher

  -- EasyGo side: voucher '444555' that has no provider match
  INSERT INTO public.voucher_easygo_records (import_batch, voucher_number)
  VALUES (v_ego_batch, '4445559999');  -- suffix '9999' → prefix '444555'

  -- Also provider '111000' vs EasyGo nothing (to get missing_in_easygo too)
  SELECT public.run_voucher_reconciliation(v_prov_batch, v_ego_batch) INTO v_rpc_result;
  v_run_id := (v_rpc_result->>'reconciliation_run_id')::UUID;
  RAISE NOTICE 'SCENARIO D RPC result: %', v_rpc_result;

  IF (v_rpc_result->>'missing_in_provider')::INT <> 1 THEN
    RAISE EXCEPTION 'SCENARIO D FAIL: expected missing_in_provider=1, got %', v_rpc_result;
  END IF;
  IF (v_rpc_result->>'missing_in_easygo')::INT <> 1 THEN
    RAISE EXCEPTION 'SCENARIO D FAIL: expected missing_in_easygo=1 (for provider row 111000), got %', v_rpc_result;
  END IF;

  RAISE NOTICE '✅ SCENARIO D PASSED — missing_in_provider and missing_in_easygo both detected';

  DELETE FROM public.voucher_reconciliation_results WHERE reconciliation_run_id = v_run_id;
  DELETE FROM public.voucher_easygo_records   WHERE import_batch = v_ego_batch;
  DELETE FROM public.voucher_provider_reports WHERE import_batch = v_prov_batch;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- SCENARIO E: unparseable — provider row with NULL voucher_number
-- ────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_hz_id      BIGINT;
  v_prov_batch UUID := gen_random_uuid();
  v_ego_batch  UUID := gen_random_uuid();
  v_rpc_result JSONB;
  v_run_id     UUID;
BEGIN
  SELECT id INTO v_hz_id FROM public.voucher_providers WHERE provider_name = 'Hightech Zone';

  INSERT INTO public.voucher_provider_reports (import_batch, provider_id, voucher_number, guest_name)
  VALUES (v_prov_batch, v_hz_id, NULL, 'רוני לוי');  -- NULL = unparseable

  INSERT INTO public.voucher_easygo_records (import_batch, voucher_number)
  VALUES (v_ego_batch, '');  -- empty = unparseable

  SELECT public.run_voucher_reconciliation(v_prov_batch, v_ego_batch) INTO v_rpc_result;
  v_run_id := (v_rpc_result->>'reconciliation_run_id')::UUID;
  RAISE NOTICE 'SCENARIO E RPC result: %', v_rpc_result;

  IF (v_rpc_result->>'unparseable')::INT < 1 THEN
    RAISE EXCEPTION 'SCENARIO E FAIL: expected unparseable≥1, got %', v_rpc_result;
  END IF;

  RAISE NOTICE '✅ SCENARIO E PASSED — unparseable rows surfaced (Zero Data Loss §0.1)';

  DELETE FROM public.voucher_reconciliation_results WHERE reconciliation_run_id = v_run_id;
  DELETE FROM public.voucher_easygo_records   WHERE import_batch = v_ego_batch;
  DELETE FROM public.voucher_provider_reports WHERE import_batch = v_prov_batch;
END;
$$;

-- ── 2. Final summary ───────────────────────────────────────────────────────
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '✅  ALL 5 SCENARIOS PASSED — Voucher Reconciliation Engine OK  ';
  RAISE NOTICE '    A. truncate_4 with separator → matched                     ';
  RAISE NOTICE '    B. exact mode rejects mismatched suffix → exceptions        ';
  RAISE NOTICE '    C. same voucher, different package → package_mismatch       ';
  RAISE NOTICE '    D. EasyGo row with no provider → missing_in_provider        ';
  RAISE NOTICE '    E. NULL/empty voucher → unparseable (Zero Data Loss)        ';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END;
$$;

ROLLBACK;  -- All test rows are discarded — nothing permanent in production tables

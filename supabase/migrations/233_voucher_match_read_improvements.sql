-- ============================================================================
-- migration 233: Voucher reconciliation — smarter matching + package fuzzy
-- ============================================================================
-- 1. voucher_numbers_match: truncate_4 also matches suffix-only provider codes
--    and full alnum equality; exact mode tolerates separator differences.
-- 2. package_types_match: Hebrew-normalized fuzzy comparison for package labels.
-- 3. run_voucher_reconciliation: uses package_types_match instead of raw lower().
-- ============================================================================

CREATE OR REPLACE FUNCTION public.voucher_numbers_match(
  p_match_mode        TEXT,
  p_provider_voucher  TEXT,
  p_easygo_voucher    TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_provider_norm  TEXT := upper(trim(p_provider_voucher));
  v_easygo_norm    TEXT := upper(trim(p_easygo_voucher));
  v_easygo_alnum   TEXT;
  v_provider_alnum TEXT;
  v_easygo_prefix  TEXT;
BEGIN
  IF v_provider_norm IS NULL OR v_easygo_norm IS NULL
     OR length(v_provider_norm) = 0 OR length(v_easygo_norm) = 0 THEN
    RETURN FALSE;
  END IF;

  v_easygo_alnum   := regexp_replace(v_easygo_norm,   '[^A-Z0-9]', '', 'g');
  v_provider_alnum := regexp_replace(v_provider_norm, '[^A-Z0-9]', '', 'g');

  IF p_match_mode = 'truncate_4' THEN
    IF length(v_easygo_alnum) <= 4 OR length(v_provider_alnum) = 0 THEN
      RETURN FALSE;
    END IF;

    -- Full number match (both sides include suffix)
    IF v_easygo_alnum = v_provider_alnum THEN
      RETURN TRUE;
    END IF;

    -- Standard: EasyGo = provider base + 4 extra digits
    v_easygo_prefix := left(v_easygo_alnum, length(v_easygo_alnum) - 4);
    IF v_easygo_prefix = v_provider_alnum THEN
      RETURN TRUE;
    END IF;

    -- Provider report shows only last 4 digits
    IF length(v_provider_alnum) = 4 AND right(v_easygo_alnum, 4) = v_provider_alnum THEN
      RETURN TRUE;
    END IF;

    -- Provider has suffix, EasyGo has base only (rare)
    IF length(v_provider_alnum) > 4 AND length(v_easygo_alnum) <= length(v_provider_alnum) - 4 THEN
      IF left(v_provider_alnum, length(v_provider_alnum) - 4) = v_easygo_alnum THEN
        RETURN TRUE;
      END IF;
    END IF;

    RETURN FALSE;
  END IF;

  -- exact + unknown modes: trimmed upper, then alnum-normalized (separator tolerant)
  IF v_provider_norm = v_easygo_norm THEN
    RETURN TRUE;
  END IF;

  RETURN length(v_provider_alnum) > 0
     AND length(v_easygo_alnum) > 0
     AND v_provider_alnum = v_easygo_alnum;
END;
$$;

-- Fuzzy Hebrew package label comparison (mirrors _shared/voucherImport.ts).
CREATE OR REPLACE FUNCTION public.package_types_match(
  p_provider_package TEXT,
  p_easygo_package   TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_a TEXT;
  v_b TEXT;
BEGIN
  IF p_provider_package IS NULL OR length(trim(p_provider_package)) = 0
     OR p_easygo_package IS NULL OR length(trim(p_easygo_package)) = 0 THEN
    RETURN TRUE; -- skip check when either side empty
  END IF;

  v_a := lower(trim(p_provider_package));
  v_b := lower(trim(p_easygo_package));

  v_a := regexp_replace(v_a, '[״''"]', '', 'g');
  v_b := regexp_replace(v_b, '[״''"]', '', 'g');
  v_a := regexp_replace(v_a, '\s+', ' ', 'g');
  v_b := regexp_replace(v_b, '\s+', ' ', 'g');
  v_a := regexp_replace(v_a, '\s*\+\s*', ' ', 'g');
  v_b := regexp_replace(v_b, '\s*\+\s*', ' ', 'g');
  v_a := regexp_replace(v_a, '\s*ו\s*', ' ', 'g');
  v_b := regexp_replace(v_b, '\s*ו\s*', ' ', 'g');
  v_a := regexp_replace(regexp_replace(v_a, '[.,\-–—/\\|]', ' ', 'g'), '\s+', ' ', 'g');
  v_b := regexp_replace(regexp_replace(v_b, '[.,\-–—/\\|]', ' ', 'g'), '\s+', ' ', 'g');
  v_a := trim(v_a);
  v_b := trim(v_b);

  IF v_a = v_b THEN RETURN TRUE; END IF;
  IF position(v_a in v_b) > 0 OR position(v_b in v_a) > 0 THEN RETURN TRUE; END IF;

  RETURN FALSE;
END;
$$;

-- Patch reconciliation to use fuzzy package match
CREATE OR REPLACE FUNCTION public.run_voucher_reconciliation(
  p_provider_batch UUID,
  p_easygo_batch   UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_run_id                 UUID := gen_random_uuid();
  v_provider_row           public.voucher_provider_reports%ROWTYPE;
  v_easygo_row             public.voucher_easygo_records%ROWTYPE;
  v_provider               public.voucher_providers%ROWTYPE;
  v_matched_easygo_ids     BIGINT[] := ARRAY[]::BIGINT[];
  v_candidate_ids          BIGINT[];
  v_candidate_count        INT;
  v_sole_easygo            public.voucher_easygo_records%ROWTYPE;
  v_matched_count          INT := 0;
  v_mismatch_count         INT := 0;
  v_duplicate_count        INT := 0;
  v_missing_easygo_count   INT := 0;
  v_missing_provider_count INT := 0;
  v_unparseable_count      INT := 0;
BEGIN
  RAISE NOTICE '[run_voucher_reconciliation] -- START run=% provider_batch=% easygo_batch=%',
    v_run_id, p_provider_batch, p_easygo_batch;

  FOR v_provider_row IN
    SELECT * FROM public.voucher_provider_reports WHERE import_batch = p_provider_batch
  LOOP
    IF v_provider_row.voucher_number IS NULL OR length(trim(v_provider_row.voucher_number)) = 0 THEN
      INSERT INTO public.voucher_reconciliation_results
        (reconciliation_run_id, provider_report_id, easygo_record_id, provider_id, match_status, discrepancy_note)
      VALUES
        (v_run_id, v_provider_row.id, NULL, v_provider_row.provider_id, 'unparseable',
         'שורת ספק ללא מספר שובר לקריאה — לא ניתן להשוות');
      v_unparseable_count := v_unparseable_count + 1;
      CONTINUE;
    END IF;

    SELECT * INTO v_provider FROM public.voucher_providers WHERE id = v_provider_row.provider_id;

    SELECT ARRAY_AGG(e.id) INTO v_candidate_ids
    FROM public.voucher_easygo_records e
    WHERE e.import_batch = p_easygo_batch
      AND NOT (e.id = ANY (v_matched_easygo_ids))
      AND e.voucher_number IS NOT NULL
      AND (e.provider_id IS NULL OR e.provider_id = v_provider_row.provider_id)
      AND public.voucher_numbers_match(v_provider.match_mode, v_provider_row.voucher_number, e.voucher_number);

    v_candidate_count := COALESCE(array_length(v_candidate_ids, 1), 0);

    IF v_candidate_count = 0 THEN
      INSERT INTO public.voucher_reconciliation_results
        (reconciliation_run_id, provider_report_id, easygo_record_id, provider_id, match_status, match_basis, discrepancy_note)
      VALUES
        (v_run_id, v_provider_row.id, NULL, v_provider_row.provider_id, 'missing_in_easygo', v_provider.match_mode,
         'יש שובר בדוח הספק (' || v_provider.provider_name || ') שאינו מוזמן בדוח השוברים של EasyGo');
      v_missing_easygo_count := v_missing_easygo_count + 1;

    ELSIF v_candidate_count = 1 THEN
      SELECT * INTO v_sole_easygo FROM public.voucher_easygo_records WHERE id = v_candidate_ids[1];
      v_matched_easygo_ids := v_matched_easygo_ids || v_candidate_ids[1];

      IF v_provider_row.package_type IS NOT NULL AND v_sole_easygo.package_type IS NOT NULL
         AND NOT public.package_types_match(v_provider_row.package_type, v_sole_easygo.package_type) THEN
        INSERT INTO public.voucher_reconciliation_results
          (reconciliation_run_id, provider_report_id, easygo_record_id, provider_id, match_status, match_basis, discrepancy_note)
        VALUES
          (v_run_id, v_provider_row.id, v_sole_easygo.id, v_provider_row.provider_id, 'package_mismatch', v_provider.match_mode,
           'חבילה שונה: ספק="' || v_provider_row.package_type || '" / EasyGo="' || v_sole_easygo.package_type || '"');
        v_mismatch_count := v_mismatch_count + 1;
      ELSE
        INSERT INTO public.voucher_reconciliation_results
          (reconciliation_run_id, provider_report_id, easygo_record_id, provider_id, match_status, match_basis)
        VALUES
          (v_run_id, v_provider_row.id, v_sole_easygo.id, v_provider_row.provider_id, 'matched', v_provider.match_mode);
        v_matched_count := v_matched_count + 1;
      END IF;

    ELSE
      v_matched_easygo_ids := v_matched_easygo_ids || v_candidate_ids;
      INSERT INTO public.voucher_reconciliation_results
        (reconciliation_run_id, provider_report_id, easygo_record_id, provider_id, match_status, match_basis, discrepancy_note)
      VALUES
        (v_run_id, v_provider_row.id, NULL, v_provider_row.provider_id, 'duplicate_match', v_provider.match_mode,
         'נמצאו ' || v_candidate_count || ' שוברי EasyGo תואמים לאותו שובר ספק — דורש בדיקה ידנית (IDs: ' ||
         array_to_string(v_candidate_ids, ', ') || ')');
      v_duplicate_count := v_duplicate_count + 1;
    END IF;
  END LOOP;

  FOR v_easygo_row IN
    SELECT * FROM public.voucher_easygo_records
    WHERE import_batch = p_easygo_batch
      AND NOT (id = ANY (v_matched_easygo_ids))
  LOOP
    IF v_easygo_row.voucher_number IS NULL OR length(trim(v_easygo_row.voucher_number)) = 0 THEN
      INSERT INTO public.voucher_reconciliation_results
        (reconciliation_run_id, provider_report_id, easygo_record_id, provider_id, match_status, discrepancy_note)
      VALUES
        (v_run_id, NULL, v_easygo_row.id, v_easygo_row.provider_id, 'unparseable',
         'שורת EasyGo ללא מספר שובר לקריאה — לא ניתן להשוות');
      v_unparseable_count := v_unparseable_count + 1;
    ELSE
      INSERT INTO public.voucher_reconciliation_results
        (reconciliation_run_id, provider_report_id, easygo_record_id, provider_id, match_status, discrepancy_note)
      VALUES
        (v_run_id, NULL, v_easygo_row.id, v_easygo_row.provider_id, 'missing_in_provider',
         'שובר הוזמן ב-EasyGo אך אין לו גיבוי בדוח הספק');
      v_missing_provider_count := v_missing_provider_count + 1;
    END IF;
  END LOOP;

  RAISE NOTICE '[run_voucher_reconciliation] -- COMPLETE run=% matched=% package_mismatch=% duplicate=% missing_in_easygo=% missing_in_provider=% unparseable=% --',
    v_run_id, v_matched_count, v_mismatch_count, v_duplicate_count, v_missing_easygo_count, v_missing_provider_count, v_unparseable_count;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'reconciliation_run_id', v_run_id,
    'matched', v_matched_count,
    'package_mismatch', v_mismatch_count,
    'duplicate_match', v_duplicate_count,
    'missing_in_easygo', v_missing_easygo_count,
    'missing_in_provider', v_missing_provider_count,
    'unparseable', v_unparseable_count
  );

EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '[run_voucher_reconciliation] -- ROLLBACK -- % --', SQLERRM;
  RAISE;
END;
$$;

-- Self-test: suffix-only provider voucher + fuzzy package
DO $$
DECLARE
  v BOOLEAN;
BEGIN
  v := public.voucher_numbers_match('truncate_4', '4321', '999888-4321');
  IF NOT v THEN RAISE EXCEPTION 'FAIL suffix_4: provider 4321 vs easygo 999888-4321'; END IF;

  v := public.voucher_numbers_match('truncate_4', '9998884321', '999888-4321');
  IF NOT v THEN RAISE EXCEPTION 'FAIL full_alnum: both full numbers'; END IF;

  v := public.voucher_numbers_match('exact', 'HV-88123', 'HV88123');
  IF NOT v THEN RAISE EXCEPTION 'FAIL exact alnum: HV-88123 vs HV88123'; END IF;

  v := public.package_types_match('זוגי + שמפניה', 'זוגי ושמפניה');
  IF NOT v THEN RAISE EXCEPTION 'FAIL package fuzzy: ו vs +'; END IF;

  v := public.package_types_match('זוגי + שמפניה יוקרתית', 'זוגי שמפניה');
  IF NOT v THEN RAISE EXCEPTION 'FAIL package substring'; END IF;

  RAISE NOTICE '[voucher_match_233_selftest] ✅ ALL TESTS PASSED';
END;
$$;

-- ============================================================================
-- migration 236: When multiple EasyGo rows match same voucher key, disambiguate
-- by package_type before marking duplicate_match (Nofshonit: same ת.ז., diff packages).
-- ============================================================================

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
  v_package_ids            BIGINT[];
  v_candidate_count        INT;
  v_package_count          INT;
  v_sole_easygo            public.voucher_easygo_records%ROWTYPE;
  v_reuse_easygo_id        BIGINT;
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

    -- Package disambiguation when same ת.ז. has multiple EZGO vouchers (e.g. 2 deluxe + 2 classic).
    IF v_candidate_count > 1
       AND v_provider_row.package_type IS NOT NULL
       AND length(trim(v_provider_row.package_type)) > 0 THEN
      SELECT ARRAY_AGG(e.id) INTO v_package_ids
      FROM public.voucher_easygo_records e
      WHERE e.id = ANY (v_candidate_ids)
        AND e.package_type IS NOT NULL
        AND public.package_types_match(v_provider_row.package_type, e.package_type);

      v_package_count := COALESCE(array_length(v_package_ids, 1), 0);
      IF v_package_count = 1 THEN
        v_candidate_ids := v_package_ids;
        v_candidate_count := 1;
      ELSIF v_package_count > 1 THEN
        v_candidate_ids := v_package_ids;
        v_candidate_count := v_package_count;
      END IF;
    END IF;

    IF v_candidate_count = 0 THEN
      SELECT e.id INTO v_reuse_easygo_id
      FROM public.voucher_easygo_records e
      WHERE e.import_batch = p_easygo_batch
        AND e.voucher_number IS NOT NULL
        AND (e.provider_id IS NULL OR e.provider_id = v_provider_row.provider_id)
        AND public.voucher_numbers_match(v_provider.match_mode, v_provider_row.voucher_number, e.voucher_number)
      ORDER BY e.id
      LIMIT 1;

      IF v_reuse_easygo_id IS NOT NULL THEN
        SELECT * INTO v_sole_easygo FROM public.voucher_easygo_records WHERE id = v_reuse_easygo_id;

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
            (reconciliation_run_id, provider_report_id, easygo_record_id, provider_id, match_status, match_basis, discrepancy_note)
          VALUES
            (v_run_id, v_provider_row.id, v_sole_easygo.id, v_provider_row.provider_id, 'matched', v_provider.match_mode,
             'שורת מימוש נוספת בדוח ספק לאותו מספר שובר');
          v_matched_count := v_matched_count + 1;
        END IF;

        IF NOT (v_reuse_easygo_id = ANY (v_matched_easygo_ids)) THEN
          v_matched_easygo_ids := v_matched_easygo_ids || v_reuse_easygo_id;
        END IF;

      ELSE
        INSERT INTO public.voucher_reconciliation_results
          (reconciliation_run_id, provider_report_id, easygo_record_id, provider_id, match_status, match_basis, discrepancy_note)
        VALUES
          (v_run_id, v_provider_row.id, NULL, v_provider_row.provider_id, 'missing_in_easygo', v_provider.match_mode,
           'יש שובר בדוח הספק (' || v_provider.provider_name || ') שאינו מוזמן בדוח השוברים של EasyGo');
        v_missing_easygo_count := v_missing_easygo_count + 1;
      END IF;

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

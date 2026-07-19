-- ============================================================================
-- migration 238: Fix false package_mismatch (wrong EZGO row paired).
-- CouponNo before package FIFO; over_redemption for extra provider lines;
-- missing_in_easygo when package tier not booked in EZGO at all.
-- ============================================================================

ALTER TABLE public.voucher_reconciliation_results
  DROP CONSTRAINT IF EXISTS voucher_reconciliation_results_match_status_check;

ALTER TABLE public.voucher_reconciliation_results
  ADD CONSTRAINT voucher_reconciliation_results_match_status_check
  CHECK (match_status IN (
    'matched', 'package_mismatch', 'duplicate_match',
    'missing_in_easygo', 'missing_in_provider', 'unparseable',
    'over_redemption'
  ));

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
  v_coupon_ids             BIGINT[];
  v_candidate_count        INT;
  v_package_count          INT;
  v_coupon_count           INT;
  v_sole_easygo            public.voucher_easygo_records%ROWTYPE;
  v_reuse_easygo_id        BIGINT;
  v_has_booked_package     BOOLEAN;
  v_matched_count          INT := 0;
  v_mismatch_count         INT := 0;
  v_duplicate_count        INT := 0;
  v_missing_easygo_count   INT := 0;
  v_missing_provider_count INT := 0;
  v_unparseable_count      INT := 0;
  v_over_redemption_count  INT := 0;
  v_provider_total         INT := 0;
  v_easygo_total           INT := 0;
BEGIN
  SELECT COUNT(*) INTO v_provider_total FROM public.voucher_provider_reports WHERE import_batch = p_provider_batch;
  SELECT COUNT(*) INTO v_easygo_total FROM public.voucher_easygo_records WHERE import_batch = p_easygo_batch;

  RAISE NOTICE '[run_voucher_reconciliation] -- START run=% provider=% easygo=%',
    v_run_id, v_provider_total, v_easygo_total;

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

    SELECT ARRAY_AGG(e.id ORDER BY e.id) INTO v_candidate_ids
    FROM public.voucher_easygo_records e
    WHERE e.import_batch = p_easygo_batch
      AND NOT (e.id = ANY (v_matched_easygo_ids))
      AND e.voucher_number IS NOT NULL
      AND (e.provider_id IS NULL OR e.provider_id = v_provider_row.provider_id)
      AND public.voucher_numbers_match(v_provider.match_mode, v_provider_row.voucher_number, e.voucher_number);

    v_candidate_count := COALESCE(array_length(v_candidate_ids, 1), 0);

    -- 1) CouponNo first (Nofshonit: מזהה לקוח was per-person coupon number).
    IF v_provider_row.raw_extras IS NOT NULL
       AND COALESCE(v_provider_row.raw_extras->>'_provider_coupon_no', '') <> '' THEN
      SELECT ARRAY_AGG(e.id ORDER BY e.id) INTO v_coupon_ids
      FROM public.voucher_easygo_records e
      WHERE e.import_batch = p_easygo_batch
        AND NOT (e.id = ANY (v_matched_easygo_ids))
        AND e.voucher_number IS NOT NULL
        AND (e.provider_id IS NULL OR e.provider_id = v_provider_row.provider_id)
        AND public.voucher_numbers_match(v_provider.match_mode, v_provider_row.voucher_number, e.voucher_number)
        AND e.raw_extras IS NOT NULL
        AND COALESCE(e.raw_extras->>'CouponNo', '') <> ''
        AND public.voucher_numbers_match(
          'exact',
          e.raw_extras->>'CouponNo',
          v_provider_row.raw_extras->>'_provider_coupon_no'
        );

      v_coupon_count := COALESCE(array_length(v_coupon_ids, 1), 0);
      IF v_coupon_count >= 1 THEN
        v_candidate_ids := ARRAY[v_coupon_ids[1]];
        v_candidate_count := 1;
      END IF;
    END IF;

    -- 2) Package FIFO among still-unmatched rows (same ת.ז., different tiers).
    IF v_candidate_count > 1
       AND v_provider_row.package_type IS NOT NULL
       AND length(trim(v_provider_row.package_type)) > 0 THEN
      SELECT ARRAY_AGG(e.id ORDER BY e.id) INTO v_package_ids
      FROM public.voucher_easygo_records e
      WHERE e.id = ANY (v_candidate_ids)
        AND e.package_type IS NOT NULL
        AND length(trim(e.package_type)) > 0
        AND public.package_types_match(v_provider_row.package_type, e.package_type);

      v_package_count := COALESCE(array_length(v_package_ids, 1), 0);
      IF v_package_count >= 1 THEN
        v_candidate_ids := ARRAY[v_package_ids[1]];
        v_candidate_count := 1;
      ELSE
        -- No free EZGO row for this package tier — do not pair a wrong-tier row.
        v_candidate_ids := NULL;
        v_candidate_count := 0;
      END IF;
    END IF;

    -- 3) No unused row — try booked package (incl. already-matched) or true gap.
    IF v_candidate_count = 0 THEN
      IF v_provider_row.package_type IS NOT NULL AND length(trim(v_provider_row.package_type)) > 0 THEN
        SELECT EXISTS (
          SELECT 1 FROM public.voucher_easygo_records e
          WHERE e.import_batch = p_easygo_batch
            AND e.voucher_number IS NOT NULL
            AND (e.provider_id IS NULL OR e.provider_id = v_provider_row.provider_id)
            AND public.voucher_numbers_match(v_provider.match_mode, v_provider_row.voucher_number, e.voucher_number)
            AND e.package_type IS NOT NULL
            AND length(trim(e.package_type)) > 0
            AND public.package_types_match(v_provider_row.package_type, e.package_type)
        ) INTO v_has_booked_package;

        IF v_has_booked_package THEN
          SELECT e.id INTO v_reuse_easygo_id
          FROM public.voucher_easygo_records e
          WHERE e.import_batch = p_easygo_batch
            AND e.voucher_number IS NOT NULL
            AND (e.provider_id IS NULL OR e.provider_id = v_provider_row.provider_id)
            AND public.voucher_numbers_match(v_provider.match_mode, v_provider_row.voucher_number, e.voucher_number)
            AND e.package_type IS NOT NULL
            AND public.package_types_match(v_provider_row.package_type, e.package_type)
          ORDER BY e.id
          LIMIT 1;

          SELECT * INTO v_sole_easygo FROM public.voucher_easygo_records WHERE id = v_reuse_easygo_id;

          IF v_reuse_easygo_id = ANY (v_matched_easygo_ids) THEN
            INSERT INTO public.voucher_reconciliation_results
              (reconciliation_run_id, provider_report_id, easygo_record_id, provider_id, match_status, match_basis, discrepancy_note)
            VALUES
              (v_run_id, v_provider_row.id, v_sole_easygo.id, v_provider_row.provider_id, 'over_redemption', v_provider.match_mode,
               'מומש אצל ספק מעבר לשוברי איזיגו שהוזמנו לאותה חבילה');
            v_over_redemption_count := v_over_redemption_count + 1;
          ELSE
            INSERT INTO public.voucher_reconciliation_results
              (reconciliation_run_id, provider_report_id, easygo_record_id, provider_id, match_status, match_basis)
            VALUES
              (v_run_id, v_provider_row.id, v_sole_easygo.id, v_provider_row.provider_id, 'matched', v_provider.match_mode);
            v_matched_count := v_matched_count + 1;
            v_matched_easygo_ids := v_matched_easygo_ids || v_reuse_easygo_id;
          END IF;
          CONTINUE;
        END IF;

        INSERT INTO public.voucher_reconciliation_results
          (reconciliation_run_id, provider_report_id, easygo_record_id, provider_id, match_status, match_basis, discrepancy_note)
        VALUES
          (v_run_id, v_provider_row.id, NULL, v_provider_row.provider_id, 'missing_in_easygo', v_provider.match_mode,
           'מומש אצל ספק — חבילה «' || v_provider_row.package_type || '» לא הוזמנה בדוח איזיגו');
        v_missing_easygo_count := v_missing_easygo_count + 1;
        CONTINUE;
      END IF;

      -- No package on provider row — legacy reuse any EZGO line for same key.
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

        IF v_reuse_easygo_id = ANY (v_matched_easygo_ids) THEN
          INSERT INTO public.voucher_reconciliation_results
            (reconciliation_run_id, provider_report_id, easygo_record_id, provider_id, match_status, match_basis, discrepancy_note)
          VALUES
            (v_run_id, v_provider_row.id, v_sole_easygo.id, v_provider_row.provider_id, 'over_redemption', v_provider.match_mode,
             'מימוש נוסף בדוח ספק מעבר לשוברי איזיגו');
          v_over_redemption_count := v_over_redemption_count + 1;
        ELSE
          INSERT INTO public.voucher_reconciliation_results
            (reconciliation_run_id, provider_report_id, easygo_record_id, provider_id, match_status, match_basis, discrepancy_note)
          VALUES
            (v_run_id, v_provider_row.id, v_sole_easygo.id, v_provider_row.provider_id, 'matched', v_provider.match_mode,
             'שורת מימוש נוספת בדוח ספק לאותו אורח');
          v_matched_count := v_matched_count + 1;
          IF NOT (v_reuse_easygo_id = ANY (v_matched_easygo_ids)) THEN
            v_matched_easygo_ids := v_matched_easygo_ids || v_reuse_easygo_id;
          END IF;
        END IF;
      ELSE
        INSERT INTO public.voucher_reconciliation_results
          (reconciliation_run_id, provider_report_id, easygo_record_id, provider_id, match_status, match_basis, discrepancy_note)
        VALUES
          (v_run_id, v_provider_row.id, NULL, v_provider_row.provider_id, 'missing_in_easygo', v_provider.match_mode,
           'מומש אצל ספק — אין שובר תואם בדוח איזיגו');
        v_missing_easygo_count := v_missing_easygo_count + 1;
      END IF;

    ELSIF v_candidate_count = 1 THEN
      SELECT * INTO v_sole_easygo FROM public.voucher_easygo_records WHERE id = v_candidate_ids[1];
      v_matched_easygo_ids := v_matched_easygo_ids || v_candidate_ids[1];

      IF v_provider_row.package_type IS NOT NULL AND v_sole_easygo.package_type IS NOT NULL
         AND length(trim(v_provider_row.package_type)) > 0
         AND length(trim(v_sole_easygo.package_type)) > 0
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
      INSERT INTO public.voucher_reconciliation_results
        (reconciliation_run_id, provider_report_id, easygo_record_id, provider_id, match_status, match_basis, discrepancy_note)
      VALUES
        (v_run_id, v_provider_row.id, NULL, v_provider_row.provider_id, 'duplicate_match', v_provider.match_mode,
         'נמצאו ' || v_candidate_count || ' שוברי EasyGo — לא ניתן לבחור יחיד (חסר וריאנט/CouponNo?) · IDs: ' ||
         array_to_string(v_candidate_ids, ', '));
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
         'הוזמן ב-EasyGo — לא נמצא מימוש בדוח הספק');
      v_missing_provider_count := v_missing_provider_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', TRUE,
    'reconciliation_run_id', v_run_id,
    'easygo_rows', v_easygo_total,
    'provider_rows', v_provider_total,
    'redemption_surplus', GREATEST(v_provider_total - v_easygo_total, 0),
    'matched', v_matched_count,
    'package_mismatch', v_mismatch_count,
    'duplicate_match', v_duplicate_count,
    'missing_in_easygo', v_missing_easygo_count,
    'missing_in_provider', v_missing_provider_count,
    'over_redemption', v_over_redemption_count,
    'unparseable', v_unparseable_count
  );

EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '[run_voucher_reconciliation] -- ROLLBACK -- % --', SQLERRM;
  RAISE;
END;
$$;

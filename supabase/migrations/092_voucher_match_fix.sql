-- ============================================================================
-- migration 092: Fix voucher_numbers_match() — separator-aware truncate_4
-- ============================================================================
-- Root cause:  The original implementation used
--   left(v_easygo_norm, length(v_easygo_norm) - 4)
-- which strips the last 4 *characters*.  When EasyGo appends the 4-digit suffix
-- with a separator (e.g. '999888-4321'), the dash is left in the prefix
-- ('999888-') and the comparison to the provider voucher ('999888') fails.
--
-- The business spec says "ignore the last 4 DIGITS of the EasyGo voucher ID"
-- (CLAUDE.md §10 session 49).  The correct approach is to strip non-alphanumeric
-- characters from BOTH sides first, then truncate and compare.
--
-- This handles every real-world format Yelena encounters:
--   • '999888-4321'    → alnum '9998884321' → truncate4 → '999888' ✓
--   • '9998884321'     → alnum '9998884321' → truncate4 → '999888' ✓
--   • 'HZ-4821-00070192' → alnum 'HZ482100070192' → truncate4 → 'HZ48210007' ✓
--      (matches provider 'HZ-4821-0007' → alnum 'HZ48210007')
--
-- exact mode is NOT changed — Hever/Nofshonit exact matches remain
-- case-insensitive, whitespace-trimmed, full-string comparisons.
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
  -- Null / empty guard — identical to the original
  IF v_provider_norm IS NULL OR v_easygo_norm IS NULL
     OR length(v_provider_norm) = 0 OR length(v_easygo_norm) = 0 THEN
    RETURN FALSE;
  END IF;

  IF p_match_mode = 'truncate_4' THEN
    -- Strip separators (dashes, spaces, dots, etc.) from BOTH sides so that
    -- '999888-4321' and '9998884321' produce the same prefix when truncated.
    -- Both strings are already UPPER-cased, so the pattern is [^A-Z0-9].
    v_easygo_alnum   := regexp_replace(v_easygo_norm,   '[^A-Z0-9]', '', 'g');
    v_provider_alnum := regexp_replace(v_provider_norm, '[^A-Z0-9]', '', 'g');

    -- Too-short guards — fail-safe, same rationale as the original
    IF length(v_easygo_alnum) <= 4 OR length(v_provider_alnum) = 0 THEN
      RETURN FALSE;
    END IF;

    v_easygo_prefix := left(v_easygo_alnum, length(v_easygo_alnum) - 4);
    RETURN v_easygo_prefix = v_provider_alnum;
  END IF;

  -- 'exact' (and any unrecognized mode → fail-safe, not fail-open)
  RETURN v_provider_norm = v_easygo_norm;
END;
$$;

-- ============================================================================
-- Regression self-test — runs inline so the migration fails loudly rather
-- than silently shipping a broken function.  No permanent rows written.
-- ============================================================================
DO $$
DECLARE
  v BOOLEAN;
BEGIN

  -- ── Test A: truncate_4 with dash separator (the scenario that was broken) ──
  v := public.voucher_numbers_match('truncate_4', '999888', '999888-4321');
  IF NOT v THEN
    RAISE EXCEPTION '[voucher_match_selftest] FAIL A: truncate_4 "999888-4321" vs "999888" — expected TRUE';
  END IF;
  RAISE NOTICE '[voucher_match_selftest] ✓ A  truncate_4  "999888-4321"   matches  "999888"';

  -- ── Test A2: same numbers, no separator ──────────────────────────────────
  v := public.voucher_numbers_match('truncate_4', '999888', '9998884321');
  IF NOT v THEN
    RAISE EXCEPTION '[voucher_match_selftest] FAIL A2: truncate_4 "9998884321" vs "999888" — expected TRUE';
  END IF;
  RAISE NOTICE '[voucher_match_selftest] ✓ A2 truncate_4  "9998884321"    matches  "999888"';

  -- ── Test A3: alpha-numeric voucher (Hightech Zone realistic format) ───────
  v := public.voucher_numbers_match('truncate_4', 'HZ-4821-0007', 'HZ-4821-00070192');
  IF NOT v THEN
    RAISE EXCEPTION '[voucher_match_selftest] FAIL A3: truncate_4 "HZ-4821-00070192" vs "HZ-4821-0007" — expected TRUE';
  END IF;
  RAISE NOTICE '[voucher_match_selftest] ✓ A3 truncate_4  "HZ-4821-00070192" matches "HZ-4821-0007"';

  -- ── Test B: exact mode — mismatched suffix MUST NOT match (Hever/Nofshonit) ──
  v := public.voucher_numbers_match('exact', '999888', '999888-4321');
  IF v THEN
    RAISE EXCEPTION '[voucher_match_selftest] FAIL B: exact "999888-4321" vs "999888" — expected FALSE (exact must not strip separators)';
  END IF;
  RAISE NOTICE '[voucher_match_selftest] ✓ B  exact        "999888-4321"   ≠       "999888" (correct rejection)';

  -- ── Test C: exact mode — identical values match ───────────────────────────
  v := public.voucher_numbers_match('exact', 'HV-88123', 'HV-88123');
  IF NOT v THEN
    RAISE EXCEPTION '[voucher_match_selftest] FAIL C: exact identical values should match';
  END IF;
  RAISE NOTICE '[voucher_match_selftest] ✓ C  exact        "HV-88123"      matches  "HV-88123"';

  -- ── Test D: truncate_4 — EasyGo alnum ≤ 4 chars → safely returns FALSE ───
  v := public.voucher_numbers_match('truncate_4', 'AB', 'ABCD');
  IF v THEN
    RAISE EXCEPTION '[voucher_match_selftest] FAIL D: truncate_4 with only 4 alnum chars in EasyGo should return FALSE (too short)';
  END IF;
  RAISE NOTICE '[voucher_match_selftest] ✓ D  truncate_4 EasyGo alnum ≤4 chars → FALSE (too short to truncate safely)';

  -- ── Test E: NULL / empty inputs → FALSE ──────────────────────────────────
  v := public.voucher_numbers_match('truncate_4', NULL, '9998884321');
  IF v THEN RAISE EXCEPTION '[voucher_match_selftest] FAIL E1: NULL provider'; END IF;
  v := public.voucher_numbers_match('exact', '999888', NULL);
  IF v THEN RAISE EXCEPTION '[voucher_match_selftest] FAIL E2: NULL easygo'; END IF;
  v := public.voucher_numbers_match('truncate_4', '', '9998884321');
  IF v THEN RAISE EXCEPTION '[voucher_match_selftest] FAIL E3: empty provider'; END IF;
  RAISE NOTICE '[voucher_match_selftest] ✓ E  NULL/empty inputs → FALSE';

  -- ── Test F: unknown match_mode falls back to exact (fail-safe) ───────────
  v := public.voucher_numbers_match('future_mode', '999888', '999888');
  IF NOT v THEN RAISE EXCEPTION '[voucher_match_selftest] FAIL F: unknown mode with identical values should match (exact fallback)'; END IF;
  v := public.voucher_numbers_match('future_mode', '999888', '9998884321');
  IF v THEN RAISE EXCEPTION '[voucher_match_selftest] FAIL F2: unknown mode with different values should NOT match'; END IF;
  RAISE NOTICE '[voucher_match_selftest] ✓ F  unknown mode falls back to exact (fail-safe, not fail-open)';

  RAISE NOTICE '[voucher_match_selftest] ✅ ALL 8 TESTS PASSED — voucher_numbers_match() is correct';
END;
$$;

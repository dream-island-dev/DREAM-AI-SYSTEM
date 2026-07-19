-- ============================================================================
-- migration 234: Voucher provider formats — suffix_5 (Hever/Police), id exact,
-- Police Funds provider, package fuzzy classic/deluxe
-- ============================================================================

-- Allow suffix_5 match mode (EasyGo 6-digit CouponNo → provider last 5 digits)
ALTER TABLE public.voucher_providers
  DROP CONSTRAINT IF EXISTS voucher_providers_match_mode_check;

ALTER TABLE public.voucher_providers
  ADD CONSTRAINT voucher_providers_match_mode_check
  CHECK (match_mode IN ('exact', 'truncate_4', 'suffix_5'));

COMMENT ON COLUMN public.voucher_providers.match_mode IS
  'exact = full voucher match (numeric ids tolerate leading zeros). truncate_4 = Multi-Pass style base+4 suffix. suffix_5 = Hever/Police: provider 5-digit = last 5 of EasyGo 6-digit CouponNo.';

-- Hever was exact — real PDFs use 5-digit suffix of 6-digit EZGO CouponNo
UPDATE public.voucher_providers SET match_mode = 'suffix_5' WHERE provider_name = 'Hever';

INSERT INTO public.voucher_providers (provider_name, match_mode) VALUES
  ('Police Funds', 'suffix_5')
ON CONFLICT (provider_name) DO UPDATE SET match_mode = EXCLUDED.match_mode;

ALTER TABLE public.voucher_reconciliation_results
  DROP CONSTRAINT IF EXISTS voucher_reconciliation_results_match_basis_check;

ALTER TABLE public.voucher_reconciliation_results
  ADD CONSTRAINT voucher_reconciliation_results_match_basis_check
  CHECK (match_basis IS NULL OR match_basis IN ('exact', 'truncate_4', 'suffix_5'));

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
  v_p_digits       TEXT;
  v_e_digits       TEXT;
BEGIN
  IF v_provider_norm IS NULL OR v_easygo_norm IS NULL
     OR length(v_provider_norm) = 0 OR length(v_easygo_norm) = 0 THEN
    RETURN FALSE;
  END IF;

  -- Strip trailing dots (EZGO artifact)
  v_provider_norm := regexp_replace(v_provider_norm, '\.+$', '');
  v_easygo_norm   := regexp_replace(v_easygo_norm, '\.+$', '');

  v_easygo_alnum   := regexp_replace(v_easygo_norm,   '[^A-Z0-9]', '', 'g');
  v_provider_alnum := regexp_replace(v_provider_norm, '[^A-Z0-9]', '', 'g');

  IF length(v_provider_alnum) = 0 OR length(v_easygo_alnum) = 0 THEN
    RETURN FALSE;
  END IF;

  IF p_match_mode = 'suffix_5' THEN
    IF v_easygo_alnum = v_provider_alnum THEN RETURN TRUE; END IF;
    IF length(v_easygo_alnum) >= 6 AND length(v_provider_alnum) = 5
       AND right(v_easygo_alnum, 5) = v_provider_alnum THEN
      RETURN TRUE;
    END IF;
    -- Numeric id fallback (leading zeros)
    v_p_digits := ltrim(regexp_replace(v_provider_alnum, '[^0-9]', '', 'g'), '0');
    v_e_digits := ltrim(regexp_replace(v_easygo_alnum,   '[^0-9]', '', 'g'), '0');
    IF v_p_digits <> '' AND v_e_digits <> '' AND v_p_digits = v_e_digits THEN RETURN TRUE; END IF;
    RETURN FALSE;
  END IF;

  IF p_match_mode = 'truncate_4' THEN
    IF length(v_easygo_alnum) <= 4 OR length(v_provider_alnum) = 0 THEN
      RETURN FALSE;
    END IF;
    IF v_easygo_alnum = v_provider_alnum THEN RETURN TRUE; END IF;
    v_easygo_prefix := left(v_easygo_alnum, length(v_easygo_alnum) - 4);
    IF v_easygo_prefix = v_provider_alnum THEN RETURN TRUE; END IF;
    IF length(v_provider_alnum) = 4 AND right(v_easygo_alnum, 4) = v_provider_alnum THEN RETURN TRUE; END IF;
    IF length(v_provider_alnum) > 4 AND length(v_easygo_alnum) <= length(v_provider_alnum) - 4 THEN
      IF left(v_provider_alnum, length(v_provider_alnum) - 4) = v_easygo_alnum THEN RETURN TRUE; END IF;
    END IF;
    RETURN FALSE;
  END IF;

  -- exact + unknown modes
  IF v_provider_norm = v_easygo_norm THEN RETURN TRUE; END IF;
  IF v_provider_alnum = v_easygo_alnum THEN RETURN TRUE; END IF;

  v_p_digits := ltrim(regexp_replace(v_provider_alnum, '[^0-9]', '', 'g'), '0');
  v_e_digits := ltrim(regexp_replace(v_easygo_alnum,   '[^0-9]', '', 'g'), '0');
  IF v_p_digits <> '' AND v_e_digits <> '' AND v_p_digits = v_e_digits THEN RETURN TRUE; END IF;

  RETURN FALSE;
END;
$$;

-- Extend package fuzzy for classic/deluxe tiers
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
    RETURN TRUE;
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

  IF (v_a ~ 'classic|קלאסיק|קלאסי' AND v_b ~ 'classic|קלאסיק|קלאסי') THEN RETURN TRUE; END IF;
  IF (v_a ~ 'deluxe|דלקס|דלאקס' AND v_b ~ 'deluxe|דלקס|דלאקס') THEN RETURN TRUE; END IF;

  RETURN FALSE;
END;
$$;

-- Self-test: suffix_5 + Nofshonit leading zeros
DO $$
DECLARE v BOOLEAN;
BEGIN
  v := public.voucher_numbers_match('suffix_5', '34781', '434781');
  IF NOT v THEN RAISE EXCEPTION 'FAIL suffix_5: 434781 vs 34781'; END IF;

  v := public.voucher_numbers_match('suffix_5', '70180', '370180');
  IF NOT v THEN RAISE EXCEPTION 'FAIL suffix_5: 370180 vs 70180'; END IF;

  v := public.voucher_numbers_match('exact', '22616940', '022616940');
  IF NOT v THEN RAISE EXCEPTION 'FAIL exact leading zero id'; END IF;

  v := public.package_types_match('classic&more lunch', 'swish קלאסיק וארוחת צהרים');
  IF NOT v THEN RAISE EXCEPTION 'FAIL classic tier match'; END IF;

  RAISE NOTICE '[voucher_provider_formats_234] ✅ ALL TESTS PASSED';
END;
$$;

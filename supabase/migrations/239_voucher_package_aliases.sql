-- ============================================================================
-- migration 239: Nofshonit package aliases (classic&more night ↔ classic&dinner,
-- צהרים ↔ כל השבוע) + clearer over_redemption notes.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.package_match_group(p_label TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v TEXT;
BEGIN
  IF p_label IS NULL OR length(trim(p_label)) = 0 THEN RETURN NULL; END IF;

  v := lower(trim(p_label));
  v := regexp_replace(v, '[״''"]', '', 'g');
  v := regexp_replace(v, '\s+', ' ', 'g');
  v := regexp_replace(v, '\s*\+\s*', ' ', 'g');
  v := regexp_replace(v, '\s*ו\s*', ' ', 'g');
  v := regexp_replace(regexp_replace(v, '[.,\-–—/\\|]', ' ', 'g'), '\s+', ' ', 'g');
  v := trim(v);

  IF v ~ 'deluxe|דלקס|דלאקס' THEN
    IF v ~ 'מבצע|special|ספיישל|חורף|יולי|קיץ' THEN RETURN 'deluxe_special'; END IF;
    RETURN 'deluxe_general';
  END IF;

  IF v ~ 'classic|קלאסיק|קלאסי|classic&more|classic&dinner' THEN
    IF v ~ 'night|dinner|ערב|16:00|א-ד|א ד' THEN RETURN 'classic_evening'; END IF;
    IF v ~ 'צהרים|lunch|כל השבוע|יום|day|בוקר|ארוחת צהר' THEN RETURN 'classic_day'; END IF;
    IF v ~ 'מבצע|special|ספיישל|חורף|יולי|קיץ' THEN RETURN 'classic_special'; END IF;
    RETURN 'classic_general';
  END IF;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.package_groups_compatible(p_a TEXT, p_b TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_a IS NULL OR p_b IS NULL THEN RETURN FALSE; END IF;
  IF p_a = p_b THEN RETURN TRUE; END IF;

  IF p_a = 'classic_general' AND p_b IN ('classic_general', 'classic_day') THEN RETURN TRUE; END IF;
  IF p_b = 'classic_general' AND p_a IN ('classic_general', 'classic_day') THEN RETURN TRUE; END IF;
  IF p_a = 'classic_day' AND p_b IN ('classic_general', 'classic_day') THEN RETURN TRUE; END IF;
  IF p_b = 'classic_day' AND p_a IN ('classic_general', 'classic_day') THEN RETURN TRUE; END IF;
  IF p_a = 'classic_special' AND p_b IN ('classic_special', 'classic_day', 'classic_general', 'classic_evening') THEN RETURN TRUE; END IF;
  IF p_b = 'classic_special' AND p_a IN ('classic_special', 'classic_day', 'classic_general', 'classic_evening') THEN RETURN TRUE; END IF;
  IF p_a LIKE 'deluxe%' AND p_b LIKE 'deluxe%' THEN RETURN TRUE; END IF;

  RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION public.package_types_match(
  p_provider_package TEXT,
  p_easygo_package   TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_ga TEXT;
  v_gb TEXT;
  v_a TEXT;
  v_b TEXT;
BEGIN
  IF p_provider_package IS NULL OR length(trim(p_provider_package)) = 0
     OR p_easygo_package IS NULL OR length(trim(p_easygo_package)) = 0 THEN
    RETURN TRUE;
  END IF;

  v_ga := public.package_match_group(p_provider_package);
  v_gb := public.package_match_group(p_easygo_package);
  IF v_ga IS NOT NULL AND v_gb IS NOT NULL AND public.package_groups_compatible(v_ga, v_gb) THEN
    RETURN TRUE;
  END IF;

  v_a := lower(trim(p_provider_package));
  v_b := lower(trim(p_easygo_package));
  v_a := regexp_replace(v_a, '[״''"]', '', 'g');
  v_b := regexp_replace(v_b, '[״''"]', '', 'g');
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

-- Self-test
DO $$
DECLARE v BOOLEAN;
BEGIN
  v := public.package_types_match(
    'Classic&more night יחיד (א-ד) מ 16:00- מבצע קיץ',
    'swish מבצע יולי 26 classic&dinner מ 16:00 א-ד'
  );
  IF NOT v THEN RAISE EXCEPTION 'FAIL night/dinner match'; END IF;

  v := public.package_types_match(
    'classic&more - ליחיד (כל השבוע) 2026',
    'swish קלאסיק וארוחת צהרים 2026'
  );
  IF NOT v THEN RAISE EXCEPTION 'FAIL day/lunch match'; END IF;

  RAISE NOTICE '[migration 239] package_types_match OK';
END;
$$;

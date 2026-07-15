-- 207_guest_fuzzy_match.sql
-- Smart Paste groundwork: pg_trgm + GIN index on guests.name + fuzzy match RPC.
-- Enables Hebrew name similarity lookup for paste-to-profile merge (e.g. "מיקי כהן" ~ "מיכאל כהן").

-- ── 1. Trigram extension ─────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── 2. GIN index for fast similarity() / % operator on guest names ───────────
CREATE INDEX IF NOT EXISTS idx_guests_name_trgm
  ON public.guests USING GIN (name gin_trgm_ops);

-- ── 3. RPC: match_guest_fuzzy ────────────────────────────────────────────────
-- p_name          — required search string (Hebrew guest name from paste)
-- p_arrival_date  — optional DATE filter; NULL = search all arrival dates
-- Returns rows with similarity_score > 0.3, highest first (max 15).
CREATE OR REPLACE FUNCTION public.match_guest_fuzzy(
  p_name         TEXT,
  p_arrival_date DATE DEFAULT NULL
)
RETURNS TABLE (
  id               BIGINT,
  name             TEXT,
  phone            TEXT,
  arrival_date     DATE,
  departure_date   DATE,
  room             TEXT,
  status           TEXT,
  similarity_score REAL
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  IF p_name IS NULL OR trim(p_name) = '' THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    g.id,
    g.name,
    g.phone,
    g.arrival_date,
    g.departure_date,
    g.room,
    g.status,
    similarity(g.name, trim(p_name))::REAL AS similarity_score
  FROM public.guests g
  WHERE g.name IS NOT NULL
    AND trim(g.name) <> ''
    AND (p_arrival_date IS NULL OR g.arrival_date = p_arrival_date)
    AND similarity(g.name, trim(p_name)) > 0.3
  ORDER BY similarity(g.name, trim(p_name)) DESC
  LIMIT 15;
END;
$$;

COMMENT ON FUNCTION public.match_guest_fuzzy(TEXT, DATE) IS
  'Smart Paste fuzzy name lookup — returns guests with pg_trgm similarity > 0.3, optional arrival_date filter.';

GRANT EXECUTE ON FUNCTION public.match_guest_fuzzy(TEXT, DATE) TO authenticated;

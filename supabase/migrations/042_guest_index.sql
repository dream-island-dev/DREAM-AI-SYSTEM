-- Migration 042: Guest index for group booking support
-- Problem: (phone, arrival_date) was UNIQUE, so a travel agency booking 9 suites
--          under one phone number would collapse all 9 rows into 1 on upsert.
-- Solution: add guest_index (1-based counter per booking) and extend the
--           unique constraint to (phone, arrival_date, guest_index).
--
-- Existing solo guests automatically get guest_index = 1 (DEFAULT).

-- ── Step 1: Add column ────────────────────────────────────────────────────────
ALTER TABLE public.guests
  ADD COLUMN IF NOT EXISTS guest_index SMALLINT NOT NULL DEFAULT 1;

-- ── Step 2: Drop the old (phone, arrival_date) unique constraint ──────────────
-- We discover the constraint name dynamically to be robust against migration
-- history variations.
DO $$
DECLARE
  _cname TEXT;
BEGIN
  SELECT tc.constraint_name INTO _cname
  FROM information_schema.table_constraints tc
  JOIN (
    SELECT constraint_name,
           array_agg(column_name::TEXT ORDER BY column_name) AS cols
    FROM   information_schema.key_column_usage
    WHERE  table_schema = 'public' AND table_name = 'guests'
    GROUP  BY constraint_name
  ) kcu ON tc.constraint_name = kcu.constraint_name
  WHERE  tc.table_schema    = 'public'
    AND  tc.table_name      = 'guests'
    AND  tc.constraint_type = 'UNIQUE'
    AND  kcu.cols           = ARRAY['arrival_date', 'phone']   -- alphabetical
  LIMIT 1;

  IF _cname IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.guests DROP CONSTRAINT ' || quote_ident(_cname);
    RAISE NOTICE 'Dropped old constraint: %', _cname;
  ELSE
    RAISE NOTICE 'No (phone, arrival_date) unique constraint found — skipping drop.';
  END IF;
END $$;

-- ── Step 3: Add new 3-column constraint ───────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE  table_schema    = 'public'
      AND  table_name      = 'guests'
      AND  constraint_name = 'guests_phone_arrival_guestidx_key'
  ) THEN
    ALTER TABLE public.guests
      ADD CONSTRAINT guests_phone_arrival_guestidx_key
        UNIQUE (phone, arrival_date, guest_index);
    RAISE NOTICE 'Added constraint guests_phone_arrival_guestidx_key';
  END IF;
END $$;

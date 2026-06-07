-- ================================================================
-- Migration 005: Operational data persistence
-- ----------------------------------------------------------------
-- Moves employees / shifts / service calls / checklist items out of
-- React local-state and into Supabase, so data survives refresh (F5).
--
-- Column names are intentionally camelCase (quoted) to match the
-- existing React object shapes 1:1 — the client upserts JS objects
-- directly with no field mapping layer.
--
-- IDs are BIGINT so the client's Date.now() generated ids fit.
-- RLS: any authenticated user may read & write operational data
-- (managers run day-to-day ops). Administrative RBAC lives in 003/004.
-- Safe to re-run.
-- ================================================================

-- ── Employees ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.employees (
  id          BIGINT PRIMARY KEY,
  name        TEXT,
  department  TEXT,
  role        TEXT,
  phone       TEXT,
  status      TEXT DEFAULT 'פעיל',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Shifts ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.shifts (
  id             BIGINT PRIMARY KEY,
  "employeeId"   BIGINT,
  "employeeName" TEXT,
  department     TEXT,
  date           TEXT,
  start          TEXT,
  "end"          TEXT,
  status         TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Service calls ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.service_calls (
  id           BIGINT PRIMARY KEY,
  title        TEXT,
  description  TEXT,
  priority     TEXT,
  "assignedTo" TEXT,
  status       TEXT,
  "createdAt"  TEXT,
  department   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Checklist items ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.checklist_items (
  id           BIGINT PRIMARY KEY,
  task         TEXT,
  department   TEXT,
  "assignedTo" TEXT,
  done         BOOLEAN DEFAULT FALSE,
  time         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── updated_at auto-touch trigger (shared) ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['employees','shifts','service_calls','checklist_items']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_touch_%1$s ON public.%1$s;', t);
    EXECUTE format(
      'CREATE TRIGGER trg_touch_%1$s BEFORE UPDATE ON public.%1$s
       FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();', t);
  END LOOP;
END $$;

-- ── RLS: authenticated users may read + write operational data ───────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['employees','shifts','service_calls','checklist_items']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);

    EXECUTE format('DROP POLICY IF EXISTS "%1$s_read"  ON public.%1$s;', t);
    EXECUTE format('DROP POLICY IF EXISTS "%1$s_write" ON public.%1$s;', t);

    -- read: any authenticated user
    EXECUTE format(
      'CREATE POLICY "%1$s_read" ON public.%1$s
       FOR SELECT USING (auth.role() = ''authenticated'');', t);

    -- write (insert/update/delete): any authenticated user
    EXECUTE format(
      'CREATE POLICY "%1$s_write" ON public.%1$s
       FOR ALL USING (auth.role() = ''authenticated'')
       WITH CHECK (auth.role() = ''authenticated'');', t);
  END LOOP;
END $$;

-- ================================================================
-- END OF MIGRATION 005
-- ================================================================

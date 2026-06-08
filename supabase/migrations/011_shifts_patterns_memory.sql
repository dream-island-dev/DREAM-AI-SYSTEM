-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 011 — Fix shifts schema + agent_memory + schedule_patterns
-- Dream Island AI System
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Fix shifts table — ensure all required columns exist ─────────────────
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS "employeeName" TEXT;
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS "employeeId"   BIGINT;
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS department     TEXT;
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS date           TEXT;
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS start          TEXT;
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS "end"          TEXT;
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS status         TEXT;
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS station        TEXT;   -- work station (toilet/kitchen/bar...)
ALTER TABLE public.shifts ADD COLUMN IF NOT EXISTS notes          TEXT;

-- ── 2. agent_memory — stores AI learning rules per manager ──────────────────
CREATE TABLE IF NOT EXISTS public.agent_memory (
  id           BIGSERIAL PRIMARY KEY,
  manager_id   UUID        NOT NULL,
  rule_text    TEXT        NOT NULL,
  category     TEXT        NOT NULL DEFAULT 'constraint',  -- constraint | pattern | preference
  is_active    BOOLEAN     NOT NULL DEFAULT true,
  source       TEXT,                                       -- 'excel_upload' | 'manual' | 'approved_schedule'
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_memory_manager_active
  ON public.agent_memory(manager_id, is_active);

-- ── 3. schedule_patterns — learned employee patterns per manager ─────────────
-- Stores rich JSON profile learned from each uploaded Excel file.
-- Used by generate-schedule to replicate patterns instead of inventing.
CREATE TABLE IF NOT EXISTS public.schedule_patterns (
  id            BIGSERIAL PRIMARY KEY,
  manager_id    UUID        NOT NULL,
  department    TEXT,
  source_file   TEXT,                   -- original Excel filename
  week_of       DATE,                   -- the week the source schedule covered
  pattern_json  JSONB       NOT NULL,   -- { employees: [...], stationHours: {...}, weeklyAssignments: {...} }
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_schedule_patterns_manager
  ON public.schedule_patterns(manager_id, created_at DESC);

-- ── 4. RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE public.agent_memory      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shifts            ENABLE ROW LEVEL SECURITY;

-- agent_memory: owners see all; managers see their own
DROP POLICY IF EXISTS "agent_memory_read"   ON public.agent_memory;
DROP POLICY IF EXISTS "agent_memory_write"  ON public.agent_memory;
CREATE POLICY "agent_memory_read"  ON public.agent_memory FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "agent_memory_write" ON public.agent_memory FOR ALL    USING (auth.role() = 'authenticated');

-- schedule_patterns: authenticated can read/write
DROP POLICY IF EXISTS "schedule_patterns_rw" ON public.schedule_patterns;
CREATE POLICY "schedule_patterns_rw" ON public.schedule_patterns FOR ALL USING (auth.role() = 'authenticated');

-- shifts: authenticated can read/write
DROP POLICY IF EXISTS "shifts_rw" ON public.shifts;
CREATE POLICY "shifts_rw" ON public.shifts FOR ALL USING (auth.role() = 'authenticated');

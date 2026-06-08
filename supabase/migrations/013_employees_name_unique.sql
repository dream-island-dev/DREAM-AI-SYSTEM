-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 013 — Employees name unique constraint
-- Enables upsert-on-conflict-name in ShiftGenerator employee sync.
-- ═══════════════════════════════════════════════════════════════════════════

-- Remove any duplicate names first (keep lowest id)
DELETE FROM public.employees a
  USING public.employees b
  WHERE a.id > b.id AND a.name = b.name;

-- Add unique constraint (idempotent)
ALTER TABLE public.employees
  DROP CONSTRAINT IF EXISTS employees_name_unique;

ALTER TABLE public.employees
  ADD CONSTRAINT employees_name_unique UNIQUE (name);

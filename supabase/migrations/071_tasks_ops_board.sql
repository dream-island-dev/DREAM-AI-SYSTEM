-- =============================================================================
-- 071_tasks_ops_board.sql
-- Unify "Tasks" + "Service Calls" into one Operations & Maintenance Board.
--
-- WHY:
--   TaskBoard.js (real `tasks` table) and the "Service Calls" screen in
--   App.js (real `service_calls` table, migration 005 — confirmed NOT mock,
--   correcting an earlier mischaracterization) were two separate boards for
--   the same kind of work. `tasks` is the survivor: it already has photos,
--   priority, department, RLS. This migration (1) extends it with the
--   columns needed for a 3-state claim/done flow + per-category SLA tracking
--   + WhatsApp-staff-report attribution, and (2) migrates every existing
--   `service_calls` row into it so retiring the old screen loses zero data
--   (CLAUDE.md §0.1 — ZERO DATA LOSS).
-- =============================================================================

-- ── 1. status gains 'in_progress' (the "🙋‍♂️ אני מטפל" claim state) ──────────
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_status_check;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_status_check
  CHECK (status IN ('open', 'in_progress', 'done'));

-- ── 2. New columns ────────────────────────────────────────────────────────────
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS sla_category        TEXT,                 -- 'pest_control' | 'guest_amenities' | 'maintenance' | NULL (uncategorized)
  ADD COLUMN IF NOT EXISTS sla_deadline         TIMESTAMPTZ,          -- created_at + SLA_THRESHOLDS[sla_category] minutes
  ADD COLUMN IF NOT EXISTS escalated_at         TIMESTAMPTZ,          -- set by sla-escalation-cron once breached — idempotency marker, same convention as guest_alerts.escalated_at (migration 066)
  ADD COLUMN IF NOT EXISTS claimed_by           UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS claimed_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS source               TEXT NOT NULL DEFAULT 'manual'
                              CHECK (source IN ('manual', 'whatsapp_staff', 'legacy_service_call')),
  ADD COLUMN IF NOT EXISTS reporter_profile_id  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reporter_raw_text    TEXT;                 -- original staff WhatsApp message, kept for audit/debugging

CREATE INDEX IF NOT EXISTS idx_tasks_sla_scan
  ON public.tasks (status, escalated_at, sla_deadline)
  WHERE status != 'done' AND escalated_at IS NULL;

COMMENT ON COLUMN public.tasks.source IS 'manual = created via the in-app New Task form. whatsapp_staff = parsed from a relay-forwarded WhatsApp group report (staff-ops-webhook). legacy_service_call = one-time backfill from the retired service_calls table (migration 071).';
COMMENT ON COLUMN public.tasks.sla_deadline IS 'created_at + per-category SLA_THRESHOLDS minutes (10/15/30, see staff-ops-webhook + sla-escalation-cron). NULL for rows with no sla_category (manual tasks, legacy rows, photo-only-uncategorized reports).';

-- ── 3. Data migration: service_calls → tasks (ZERO DATA LOSS) ───────────────
-- Guarded so re-running this migration never double-inserts.
INSERT INTO public.tasks
  (room_number, department, description, priority, status, created_at, source)
SELECT
  NULL,
  COALESCE(sc.department, 'תפעול'),
  TRIM(
    COALESCE(sc.title, '') ||
    CASE WHEN COALESCE(sc.title, '') <> '' AND COALESCE(sc.description, '') <> '' THEN ': ' ELSE '' END ||
    COALESCE(sc.description, '') ||
    CASE WHEN COALESCE(sc.assigned_to, '') <> '' THEN ' [שובץ ל: ' || sc.assigned_to || ']' ELSE '' END
  ),
  CASE sc.priority
    WHEN 'דחופה'  THEN 'urgent'
    WHEN 'גבוהה'  THEN 'urgent'
    WHEN 'בינונית' THEN 'normal'
    WHEN 'נמוכה'  THEN 'low'
    ELSE 'normal'
  END,
  CASE sc.status
    WHEN 'פתוח'  THEN 'open'
    WHEN 'בטיפול' THEN 'in_progress'
    WHEN 'טופל'  THEN 'done'
    ELSE 'open'
  END,
  sc.created_at,
  'legacy_service_call'
FROM public.service_calls sc
WHERE NOT EXISTS (SELECT 1 FROM public.tasks t WHERE t.source = 'legacy_service_call');

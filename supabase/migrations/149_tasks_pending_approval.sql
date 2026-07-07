-- =============================================================================
-- 149_tasks_pending_approval.sql
-- Human-in-the-Loop approval gate for operational_field_ops guest requests.
--
-- Today, a guest's in-room physical request (towels/water/maintenance) that
-- matches the operational_field_ops allowlist auto-dispatches straight to the
-- foreign-worker Whapi ops group with zero human review (whatsapp-webhook's
-- routeGuestRequestToOpsGroup). This widens tasks.status with a new initial
-- stage — 'pending_approval' — so the bot can propose a task without
-- authority to actually post it; a staff member reviews (and can edit) the
-- description in OperationsBoard.js before tapping Approve, which is what
-- flips status -> 'open' and triggers the real Whapi dispatch (extended
-- notify-manual-task). 'rejected' is the terminal false-positive state —
-- kept, never deleted (Zero Data Loss, CLAUDE.md §0.1).
--
-- Scope: only tasks with source='guest_request' from the operational_field_ops
-- route use 'pending_approval' going forward. Every other source continues
-- inserting directly as 'open', unchanged.
-- =============================================================================

ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_status_check;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_status_check
  CHECK (status IN ('pending_approval', 'open', 'in_progress', 'done', 'rejected'));

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS reviewed_by      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dispatched_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_tasks_pending_approval
  ON public.tasks (created_at DESC)
  WHERE status = 'pending_approval';

COMMENT ON COLUMN public.tasks.status IS
  'pending_approval = guest_request awaiting staff review (HITL gate) — not yet dispatched to Whapi. open/in_progress/done = normal lifecycle, unchanged. rejected = staff dismissed as false positive (audit trail kept, never deleted — Zero Data Loss).';

COMMENT ON COLUMN public.tasks.reviewed_by IS
  'profiles.id of the staff member who approved or rejected a pending_approval task. NULL for tasks that never went through the approval gate.';

COMMENT ON COLUMN public.tasks.reviewed_at IS
  'Timestamp of the approve/reject decision. NULL for tasks that never went through the approval gate.';

COMMENT ON COLUMN public.tasks.dispatched_at IS
  'When an approved task''s Whapi card actually went out. sla_deadline is computed from THIS timestamp, not created_at — the completion SLA measures time-to-complete from when the task became actionable, not from the original guest message (which can predate approval by an unbounded, human-controlled amount of time).';

COMMENT ON COLUMN public.tasks.rejection_reason IS
  'Optional free-text note captured when staff rejects a pending_approval task as a false positive.';

-- ── Inline self-test — constraint must accept the two new values ───────────
DO $$
DECLARE
  v_def TEXT;
BEGIN
  SELECT pg_get_constraintdef(c.oid)
    INTO v_def
  FROM pg_constraint c
  JOIN pg_class t ON c.conrelid = t.oid
  WHERE t.relname = 'tasks'
    AND c.conname = 'tasks_status_check';

  IF v_def IS NULL THEN
    RAISE EXCEPTION '149_self_test: tasks_status_check constraint missing';
  END IF;

  IF v_def NOT LIKE '%pending_approval%' THEN
    RAISE EXCEPTION '149_self_test: pending_approval not in CHECK — got: %', v_def;
  END IF;

  IF v_def NOT LIKE '%rejected%' THEN
    RAISE EXCEPTION '149_self_test: rejected not in CHECK — got: %', v_def;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tasks' AND column_name = 'dispatched_at'
  ) THEN
    RAISE EXCEPTION '149_self_test: tasks.dispatched_at column missing';
  END IF;
END $$;

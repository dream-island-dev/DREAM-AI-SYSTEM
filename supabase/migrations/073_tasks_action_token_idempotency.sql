-- =============================================================================
-- 073_tasks_action_token_idempotency.sql
-- Sprint 2 (XOS Core) — Same-Group Interactive Workflow support on `tasks`.
--
-- LEAN BY DESIGN (Mike-approved): exactly TWO new columns, both load-bearing.
--   • action_token      — random secret embedded in the Accept/Complete callback
--                         URLs. task-action Edge Function rejects any request
--                         whose token doesn't match the row → blocks forged or
--                         guessed-id callbacks (and the WhatsApp link-preview
--                         crawler, which can't know the token).
--   • source_message_id — the inbound Whapi message id. UNIQUE (partial) so a
--                         Whapi webhook re-delivery can never open a duplicate
--                         ticket for the same staff message (idempotency).
--
-- DELIBERATELY NOT ADDED (reuse existing columns — keep the table lean):
--   • task_status  → reuse `status` (open/in_progress/done, migration 071).
--   • assigned_to  → reuse `claimed_by`/`claimed_at` + `resolved_by`/`resolved_at`
--                    (migrations 015/071), resolved from the whitelist actor's
--                    profiles.phone (migration 070).
--   • check_in_date / number_of_nights / check_out_date → moved OUT of tasks
--                    scope to Sprint 3 (guests/bookings), per Mike's decision.
-- =============================================================================

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS action_token       TEXT,
  ADD COLUMN IF NOT EXISTS source_message_id  TEXT;

-- One ticket per inbound WhatsApp message. Partial unique index so the many
-- existing/legacy/manual rows (source_message_id IS NULL) never collide.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_source_message_id
  ON public.tasks (source_message_id)
  WHERE source_message_id IS NOT NULL;

COMMENT ON COLUMN public.tasks.action_token IS
  'Random per-task secret embedded in the Accept/Complete callback URLs (task-action Edge Function). Guards against forged / guessed-id callbacks and link-preview crawler auto-fires.';
COMMENT ON COLUMN public.tasks.source_message_id IS
  'Inbound Whapi message id that created this task. UNIQUE (partial) — prevents duplicate tickets when Whapi re-delivers a webhook.';

-- =============================================================================
-- 175_executive_voice_assistant.sql
-- XOS Executive Voice Assistant (Eliad Co-Pilot) — Phase 2.
-- CEO-only voice/text secretary inside the Whapi Suites device pipeline.
-- Widens tasks.source for CEO-created tasks + adds an audit log for every
-- executive tool call (create_executive_task, ceo_guest_override, etc.).
-- =============================================================================

-- ── Widen tasks.source (latest baseline: migration 093) ─────────────────────
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_source_check;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_source_check CHECK (
  source IN (
    'whatsapp_staff', 'manual', 'inbox_routed', 'guest_request',
    'manual_group', 'portal_upsell', 'portal_room_service', 'portal_order',
    'voice_call', 'legacy_service_call', 'executive_voice'
  )
);

-- ── Audit log for every executive (CEO) tool call ────────────────────────────
CREATE TABLE IF NOT EXISTS public.executive_action_log (
  id          BIGSERIAL PRIMARY KEY,
  phone       TEXT NOT NULL,
  tool_name   TEXT NOT NULL,
  args_json   JSONB NOT NULL DEFAULT '{}',
  result_json JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_executive_action_log_created
  ON public.executive_action_log (created_at DESC);

ALTER TABLE public.executive_action_log ENABLE ROW LEVEL SECURITY;

-- Writes come from the Edge Function (service_role — bypasses RLS by design).
-- Reads are admin/super_admin only, same pattern as xos_ai_rules cleaner lockdown.
CREATE POLICY "executive_action_log_admin_select" ON public.executive_action_log
  FOR SELECT USING (
    auth.uid() IS NOT NULL
    AND COALESCE(public.get_true_role(), '') IN ('admin', 'super_admin')
  );

-- ── Link Eliad's profile (safe — only updates an existing row, never inserts) ─
UPDATE public.profiles
SET role = 'admin', phone = '+972505421751'
WHERE lower(email) = 'eliad.benshimol@gmail.com';

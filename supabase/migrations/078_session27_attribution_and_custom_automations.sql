-- =============================================================================
-- 078_session27_attribution_and_custom_automations.sql
-- Session 27 — three independent additions, bundled in one migration:
--
-- 1. tasks.resolved_by_phone / resolved_by_name — raw Whapi-provided identity
--    (phone + push name) captured at the moment a task is resolved, alongside
--    the existing resolved_by (profiles.id FK, migration 015). resolved_by
--    stays NULL whenever the reactor's phone has no matching profiles row —
--    these two new columns keep the WHO visible regardless (FAIL VISIBLE,
--    CLAUDE.md §0.3), mirroring the reporter_raw_text convention already used
--    for the reporting side (migration 071).
--
-- 2. tasks.source gains 'manual_group' — a staff message typed directly into
--    the ops WhatsApp group that matched the Room/חדר/סוויטה-prefix pattern
--    (whapi-webhook's Tier 0 "room_prefix" parse), distinct from the digit-dash
--    shorthand ("11- towels", stays 'whatsapp_staff') and the AI-classified
--    fallback (also 'whatsapp_staff').
--
-- 3. custom_automations / custom_automation_steps — the lightweight Linear
--    Automation Flow Builder (AutomationControlCenter.js's new "✨ אוטומציה
--    חדשה" tab). Deliberately separate from automation_stages (migration 065)
--    — that table is the rigid, already-wired-to-runtime guest-journey
--    pipeline (anchor_event/sequence_order math read live by whatsapp-cron/
--    whatsapp-send); this is a draft-stage builder for ad-hoc multi-step
--    sequences an admin can sketch out (name + trigger timing + ordered
--    Meta-template-or-free-text steps). Not read by any cron/send path yet —
--    captures the design, runtime wiring is a future step.
-- =============================================================================

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS resolved_by_phone TEXT,
  ADD COLUMN IF NOT EXISTS resolved_by_name  TEXT;

COMMENT ON COLUMN public.tasks.resolved_by_phone IS
  'Raw phone digits from the Whapi reaction/actor payload that resolved this task — set even when no profiles row matches (FAIL VISIBLE fallback for resolved_by).';
COMMENT ON COLUMN public.tasks.resolved_by_name IS
  'Raw display name (Whapi from_name, or the task-action whitelist actor name) of whoever resolved this task. Same fallback role as resolved_by_phone.';

ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_source_check;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_source_check
  CHECK (source IN ('manual', 'whatsapp_staff', 'legacy_service_call', 'inbox_routed', 'guest_request', 'manual_group'));

COMMENT ON COLUMN public.tasks.source IS
  'manual = in-app New Task form. whatsapp_staff = digit-dash shorthand or AI-classified free text in the staff ops WhatsApp group (whapi-webhook). manual_group = Room/חדר/סוויטה-prefixed manual text in the same group (whapi-webhook Tier 0 room_prefix parse, migration 078). legacy_service_call = one-time backfill (migration 071). inbox_routed = operator routed a guest WhatsApp conversation to Maintenance/Housekeeping from WhatsAppInbox.js. guest_request = a suite guest''s fulfillable ask (log_guest_request) auto-routed into the ops group (migration 077).';

-- ── Linear Automation Flow Builder (draft layer, Sprint 4.4) ────────────────
CREATE TABLE IF NOT EXISTS public.custom_automations (
  id                  BIGSERIAL    PRIMARY KEY,
  name                TEXT         NOT NULL,
  trigger_anchor_event TEXT        NOT NULL DEFAULT 'arrival_date'
                                    CHECK (trigger_anchor_event IN ('arrival_date', 'departure_date')),
  trigger_day_offset  INT          NOT NULL DEFAULT 0,
  trigger_local_time  TIME,
  is_active           BOOL         NOT NULL DEFAULT TRUE,
  created_by          UUID         REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.custom_automation_steps (
  id                BIGSERIAL    PRIMARY KEY,
  automation_id     BIGINT       NOT NULL REFERENCES public.custom_automations(id) ON DELETE CASCADE,
  step_order        INT          NOT NULL,
  step_type         TEXT         NOT NULL CHECK (step_type IN ('meta_template', 'free_text')),
  meta_template_name TEXT,
  free_text         TEXT,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT custom_automation_steps_order_key UNIQUE (automation_id, step_order)
);

COMMENT ON TABLE public.custom_automations IS
  'Draft layer for the Linear Automation Flow Builder (AutomationControlCenter.js). Captures name + trigger timing for an ad-hoc multi-step sequence. Not yet read by whatsapp-cron/whatsapp-send — runtime wiring is a future step, see migration 078 header.';
COMMENT ON TABLE public.custom_automation_steps IS
  'Ordered steps belonging to a custom_automations row — each step is either a Meta template reference (meta_template_name) or free-text content (free_text), mutually exclusive by step_type.';

CREATE INDEX IF NOT EXISTS idx_custom_automation_steps_automation ON public.custom_automation_steps (automation_id, step_order);

DROP TRIGGER IF EXISTS trg_custom_automations_updated ON public.custom_automations;
CREATE TRIGGER trg_custom_automations_updated
  BEFORE UPDATE ON public.custom_automations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.custom_automations      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_automation_steps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated users can read custom_automations"  ON public.custom_automations;
DROP POLICY IF EXISTS "authenticated users can write custom_automations" ON public.custom_automations;
CREATE POLICY "authenticated users can read custom_automations"
  ON public.custom_automations FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "authenticated users can write custom_automations"
  ON public.custom_automations FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "authenticated users can read custom_automation_steps"  ON public.custom_automation_steps;
DROP POLICY IF EXISTS "authenticated users can write custom_automation_steps" ON public.custom_automation_steps;
CREATE POLICY "authenticated users can read custom_automation_steps"
  ON public.custom_automation_steps FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "authenticated users can write custom_automation_steps"
  ON public.custom_automation_steps FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

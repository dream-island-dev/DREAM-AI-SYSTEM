-- Migration 188: per-executive scoping for learned xos_ai_rules (module='executive').
-- Problem: Mike's QA-directed rules ("explain technically when I ask") and Eliad's
-- CEO-directed rules ("don't show me arrival-time breakdowns in reports") shared one
-- unscoped bucket — see docs/active_sprint.md audit. NULL = shared/unscoped (Graceful
-- Fallback: every pre-existing rule keeps applying to both, nothing silently disappears).
ALTER TABLE public.xos_ai_rules
  ADD COLUMN IF NOT EXISTS owner_phone TEXT;

COMMENT ON COLUMN public.xos_ai_rules.owner_phone IS
  'Bare-digit phone of the executive this rule is private to (module=executive only). NULL = shared/unscoped, visible to every executive.';

CREATE INDEX IF NOT EXISTS idx_xos_ai_rules_owner_phone
  ON public.xos_ai_rules (module, owner_phone);

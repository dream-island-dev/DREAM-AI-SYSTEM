-- =============================================================================
-- 103_xos_ai_rules.sql
-- Unified AI Learning Mechanism — Phase 1
-- Stores human-taught rules per module (chat, routing, etc.) for future
-- injection into AI pipelines. Write surface: AILearningButton.jsx.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.xos_ai_rules (
  id         BIGSERIAL    PRIMARY KEY,
  module     TEXT         NOT NULL,
  rule_text  TEXT         NOT NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT xos_ai_rules_module_not_blank CHECK (char_length(trim(module)) > 0),
  CONSTRAINT xos_ai_rules_rule_text_not_blank CHECK (char_length(trim(rule_text)) > 0)
);

COMMENT ON TABLE public.xos_ai_rules IS
  'Human-taught AI rules per module. Phase 1: capture only; runtime injection is a future phase.';

COMMENT ON COLUMN public.xos_ai_rules.module IS
  'Logical consumer key, e.g. chat, routing, import_mapping. Free text — no enum lock-in.';

CREATE INDEX IF NOT EXISTS idx_xos_ai_rules_module_created
  ON public.xos_ai_rules (module, created_at DESC);

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE public.xos_ai_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "xos_ai_rules_authed_select" ON public.xos_ai_rules
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "xos_ai_rules_authed_insert" ON public.xos_ai_rules
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Cleaners: UI-hidden only today — enforce at DB layer (migration 087 pattern).
CREATE POLICY "cleaner_lockdown_xos_ai_rules" ON public.xos_ai_rules
  AS RESTRICTIVE FOR ALL
  USING (COALESCE(public.get_true_role(), '') <> 'cleaner')
  WITH CHECK (COALESCE(public.get_true_role(), '') <> 'cleaner');

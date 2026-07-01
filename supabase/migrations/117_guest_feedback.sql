-- Migration 117: Guest Feedback & Sentiment Dashboard — dedicated storage for
-- holistic stay/service reflections, separate from the operational Requests/
-- Ops boards (tasks/guest_alerts). Mirrors upsell_items/guest_orders'
-- RLS + realtime convention (migration 093).
--
-- Design decisions:
--   • guest_id nullable, ON DELETE SET NULL — a deleted guest must never
--     cascade-delete feedback history (ZERO DATA LOSS, CLAUDE.md §0.1).
--   • phone stored directly (not just via guest_id join) — same resilience
--     pattern as guest_alerts.phone, readable even if guest_id is null.
--   • status ('open'/'archived') instead of a boolean — mirrors spa_staging/
--     voucher_reconciliation_results' two-status convention, not a delete.
--   • No DELETE policy — feedback is retention-relevant history, same rule
--     as voucher_reconciliation_results / guest_orders.
--   • source distinguishes free-text capture (whatsapp-webhook's reflection
--     classifier) from the existing post-stay Yes/No buttons and from the
--     severe-complaint kill-switch (which keeps its own existing rules AND
--     logs here per explicit product requirement).

CREATE TABLE IF NOT EXISTS public.guest_feedback (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_id      BIGINT      REFERENCES public.guests(id) ON DELETE SET NULL,
  phone         TEXT        NOT NULL,
  sentiment     TEXT        NOT NULL CHECK (sentiment IN ('positive', 'negative', 'neutral')),
  feedback_text TEXT        NOT NULL,
  source        TEXT        NOT NULL DEFAULT 'freeform_reflection'
                  CHECK (source IN ('freeform_reflection', 'post_stay_button', 'severe_complaint')),
  status        TEXT        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'archived')),
  resolved_by   UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolved_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.guest_feedback ENABLE ROW LEVEL SECURITY;

-- Authenticated staff: full CRUD (service-role writes from whatsapp-webhook bypass RLS)
CREATE POLICY "guest_feedback_auth_all"
  ON public.guest_feedback FOR ALL
  USING (auth.uid() IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_guest_feedback_sentiment ON public.guest_feedback (sentiment, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_guest_feedback_status    ON public.guest_feedback (status);
CREATE INDEX IF NOT EXISTS idx_guest_feedback_guest_id  ON public.guest_feedback (guest_id);

-- Realtime — GuestFeedbackTabs.js subscribes so new reviews/complaints appear live.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'guest_feedback'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.guest_feedback;
  END IF;
END $$;

-- whatsapp_conversations.intent — widen again (same fix as migration 116) to
-- cover the new "guest_feedback" tag the reflection-capture path writes.
DO $$
DECLARE
  v_conname TEXT;
BEGIN
  SELECT c.conname INTO v_conname
  FROM pg_constraint c
  JOIN pg_class t      ON t.oid = c.conrelid
  JOIN pg_attribute a  ON a.attrelid = t.oid
  WHERE t.relname = 'whatsapp_conversations'
    AND c.contype = 'c'
    AND a.attname = 'intent'
    AND a.attnum = ANY (c.conkey)
  LIMIT 1;

  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.whatsapp_conversations DROP CONSTRAINT %I', v_conname);
  END IF;
END $$;

ALTER TABLE public.whatsapp_conversations
  ADD CONSTRAINT whatsapp_conversations_intent_check
  CHECK (
    intent IS NULL OR intent IN (
      'complaint', 'upsell', 'faq', 'fallback',
      'severe_complaint', 'sensitive_stay_change_request', 'sensitive_financial_request',
      'date_change_request', 'arrival_time_update',
      'administrative_in_house_request', 'operational_in_house_request',
      'button_reply', 'confirmation', 'received',
      'guest_feedback'
    )
  );

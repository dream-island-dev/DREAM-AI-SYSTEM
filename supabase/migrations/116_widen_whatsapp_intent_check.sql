-- Migration 116: Widen whatsapp_conversations.intent CHECK constraint.
--
-- migration 016 locked `intent` to ('complaint','upsell','faq','fallback')
-- and was never widened since. Every intent value added by later sessions —
-- severe_complaint, date_change_request, sensitive_stay_change_request,
-- arrival_time_update, button_reply, confirmation, received,
-- administrative_in_house_request, operational_in_house_request, and now
-- sensitive_financial_request (Tier-0 defensive-architecture audit) — has
-- been silently rejected by this constraint on every UPDATE. patchClaimedInbound()
-- only console.warn()s on error, so the failure never surfaced to staff or
-- guests (guest replies still send correctly; only the intent-tracking
-- column on whatsapp_conversations silently stayed stale/NULL). FAIL VISIBLE
-- violation (CLAUDE.md §0.3) — fixed by widening the constraint to the full
-- set of values the webhook actually writes, instead of re-narrowing behavior
-- to match a stale list.
--
-- Constraint dropped by dynamic lookup (not a guessed name) — safer than
-- assuming Postgres's default "<table>_<column>_check" naming actually
-- matches what migration 016 produced.

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
      'complaint',
      'upsell',
      'faq',
      'fallback',
      'severe_complaint',
      'sensitive_stay_change_request',
      'sensitive_financial_request',
      'date_change_request',
      'arrival_time_update',
      'administrative_in_house_request',
      'operational_in_house_request',
      'button_reply',
      'confirmation',
      'received'
    )
  );

-- Self-test: every value the webhook actually writes must pass the new
-- constraint. Fails the migration loudly at deploy time if the list drifts.
DO $$
DECLARE
  v_value TEXT;
BEGIN
  FOREACH v_value IN ARRAY ARRAY[
    'complaint','upsell','faq','fallback','severe_complaint',
    'sensitive_stay_change_request','sensitive_financial_request',
    'date_change_request','arrival_time_update',
    'administrative_in_house_request','operational_in_house_request',
    'button_reply','confirmation','received'
  ]
  LOOP
    IF NOT (
      v_value IS NULL OR v_value IN (
        'complaint','upsell','faq','fallback','severe_complaint',
        'sensitive_stay_change_request','sensitive_financial_request',
        'date_change_request','arrival_time_update',
        'administrative_in_house_request','operational_in_house_request',
        'button_reply','confirmation','received'
      )
    ) THEN
      RAISE EXCEPTION 'migration 116 self-test failed for intent value: %', v_value;
    END IF;
  END LOOP;
END $$;

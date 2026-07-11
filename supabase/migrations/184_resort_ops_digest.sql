-- Migration 184: Resort Ops Digest — room_ready_at (per-stay precision) + resort_digest_log (idempotency + audit)
-- Phase 1 of the Resort Ops Digest feature (daily/weekly/monthly Hebrew summary to Eliad via Whapi Suites device).
-- Mirrors the existing digest pattern: orit_agent_digest_log (migration 155) + manager-morning-digest.

-- ── 1. guests.room_ready_at — exact timestamp of the room_ready_notified flip ──
-- room_ready_notified (migration 119) is boolean-only; the digest needs the actual
-- moment the guest's room became ready to compare against checkin_time. Set by
-- _shared/suiteRoomReady.ts syncGuestRoomReadyAggregate() at the same instant it
-- flips room_ready_notified to true (Phase 2 code change — this migration only
-- adds the column). Known limitation: for multi-suite group stays this reflects
-- when ALL linked suite_rooms became ready, not a single suite — accepted proxy,
-- same class of known gap as spa_room_aliases (docs/active_sprint.md).
ALTER TABLE public.guests
  ADD COLUMN IF NOT EXISTS room_ready_at TIMESTAMPTZ;

COMMENT ON COLUMN public.guests.room_ready_at IS
  'Timestamp when room_ready_notified flipped to true (set alongside it in syncGuestRoomReadyAggregate). NULL if never notified. For multi-suite stays reflects when ALL linked suite_rooms were ready, not a single suite.';

-- ── 2. resort_digest_log — idempotency + audit trail for resort-digest-cron ──
CREATE TABLE IF NOT EXISTS public.resort_digest_log (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  period        TEXT        NOT NULL CHECK (period IN ('daily', 'weekly', 'monthly')),
  period_date   DATE        NOT NULL,
  body_sent     TEXT        NOT NULL,
  wa_message_id TEXT,
  sent_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (period, period_date)
);

ALTER TABLE public.resort_digest_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY resort_digest_log_select ON public.resort_digest_log
  FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);

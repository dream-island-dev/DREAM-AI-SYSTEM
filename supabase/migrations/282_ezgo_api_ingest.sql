-- EZGO API webhook staging — raw JSON payloads from EZGO push (POST).
-- Phase 1: store only; map to guests after schema is known (ezgo-webhook).

CREATE TABLE IF NOT EXISTS public.ezgo_api_ingest (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  raw_payload      JSONB       NOT NULL,
  headers          JSONB       NOT NULL DEFAULT '{}',
  content_type     TEXT,
  event_type       TEXT,
  external_id      TEXT,
  idempotency_key  TEXT,
  status           TEXT        NOT NULL DEFAULT 'staged'
                   CHECK (status IN ('staged', 'parsed', 'failed', 'ignored')),
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ezgo_api_ingest_received
  ON public.ezgo_api_ingest (received_at DESC);

CREATE INDEX IF NOT EXISTS idx_ezgo_api_ingest_status_received
  ON public.ezgo_api_ingest (status, received_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ezgo_api_ingest_external_id
  ON public.ezgo_api_ingest (external_id)
  WHERE external_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ezgo_api_ingest_idempotency_key
  ON public.ezgo_api_ingest (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE public.ezgo_api_ingest ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ezgo_api_ingest_select ON public.ezgo_api_ingest;
CREATE POLICY ezgo_api_ingest_select ON public.ezgo_api_ingest
  FOR SELECT TO authenticated
  USING (public.is_ezgo_mail_staff());

DROP POLICY IF EXISTS ezgo_api_ingest_update ON public.ezgo_api_ingest;
CREATE POLICY ezgo_api_ingest_update ON public.ezgo_api_ingest
  FOR UPDATE TO authenticated
  USING (public.is_ezgo_mail_staff())
  WITH CHECK (public.is_ezgo_mail_staff());

COMMENT ON TABLE public.ezgo_api_ingest IS
  'Inbound EZGO API push (POST JSON) — staging only until mapped to guests; written by ezgo-webhook Edge Function.';

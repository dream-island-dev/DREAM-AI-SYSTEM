-- EZGO mail ingest queue — operational reports (Doc1) from dedicated inbox.
-- Separate from orit_agent_threads (customer service).

CREATE TABLE IF NOT EXISTS public.ezgo_mail_ingest (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  external_message_id TEXT        NOT NULL,
  from_email          TEXT        NOT NULL DEFAULT '',
  from_name           TEXT,
  subject             TEXT        NOT NULL DEFAULT '',
  received_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  report_type         TEXT        NOT NULL DEFAULT 'unknown'
                      CHECK (report_type IN ('doc1_html', 'doc1_tsv', 'doc1_excel', 'doc2_arrivals', 'spa_activities', 'unknown')),
  parse_status        TEXT        NOT NULL DEFAULT 'pending'
                      CHECK (parse_status IN ('pending', 'parsed', 'failed', 'skipped')),
  parse_error         TEXT,
  report_date_ymd     DATE,
  line_count          INT         NOT NULL DEFAULT 0,
  pending_count       INT         NOT NULL DEFAULT 0,
  applied_count       INT         NOT NULL DEFAULT 0,
  body_preview        TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (external_message_id)
);

CREATE INDEX IF NOT EXISTS idx_ezgo_mail_ingest_status_received
  ON public.ezgo_mail_ingest (parse_status, received_at DESC);

CREATE TABLE IF NOT EXISTS public.ezgo_mail_import_lines (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  ingest_id           UUID        NOT NULL REFERENCES public.ezgo_mail_ingest(id) ON DELETE CASCADE,
  line_index          INT         NOT NULL,
  parsed_json         JSONB       NOT NULL DEFAULT '{}',
  match_guest_id      BIGINT      REFERENCES public.guests(id) ON DELETE SET NULL,
  match_method        TEXT
                      CHECK (match_method IS NULL OR match_method IN ('order', 'phone', 'fuzzy', 'manual', 'none')),
  match_confidence    REAL,
  match_label         TEXT,
  action              TEXT        NOT NULL DEFAULT 'enrich'
                      CHECK (action IN ('enrich', 'create', 'skip', 'conflict', 'no_match')),
  proposed_patch      JSONB       NOT NULL DEFAULT '{}',
  status              TEXT        NOT NULL DEFAULT 'pending_review'
                      CHECK (status IN ('pending_review', 'approved', 'applied', 'rejected', 'skipped')),
  applied_at          TIMESTAMPTZ,
  reject_reason       TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (ingest_id, line_index)
);

CREATE INDEX IF NOT EXISTS idx_ezgo_mail_import_lines_ingest_status
  ON public.ezgo_mail_import_lines (ingest_id, status, line_index);

DROP TRIGGER IF EXISTS trg_ezgo_mail_ingest_updated ON public.ezgo_mail_ingest;
CREATE TRIGGER trg_ezgo_mail_ingest_updated
  BEFORE UPDATE ON public.ezgo_mail_ingest
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_ezgo_mail_import_lines_updated ON public.ezgo_mail_import_lines;
CREATE TRIGGER trg_ezgo_mail_import_lines_updated
  BEFORE UPDATE ON public.ezgo_mail_import_lines
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.ezgo_mail_ingest ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ezgo_mail_import_lines ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_ezgo_mail_staff()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role IN ('super_admin', 'admin', 'manager', 'staff')
  );
$$;

DROP POLICY IF EXISTS ezgo_mail_ingest_select ON public.ezgo_mail_ingest;
CREATE POLICY ezgo_mail_ingest_select ON public.ezgo_mail_ingest
  FOR SELECT TO authenticated
  USING (public.is_ezgo_mail_staff());

DROP POLICY IF EXISTS ezgo_mail_ingest_update ON public.ezgo_mail_ingest;
CREATE POLICY ezgo_mail_ingest_update ON public.ezgo_mail_ingest
  FOR UPDATE TO authenticated
  USING (public.is_ezgo_mail_staff())
  WITH CHECK (public.is_ezgo_mail_staff());

DROP POLICY IF EXISTS ezgo_mail_import_lines_select ON public.ezgo_mail_import_lines;
CREATE POLICY ezgo_mail_import_lines_select ON public.ezgo_mail_import_lines
  FOR SELECT TO authenticated
  USING (public.is_ezgo_mail_staff());

DROP POLICY IF EXISTS ezgo_mail_import_lines_update ON public.ezgo_mail_import_lines;
CREATE POLICY ezgo_mail_import_lines_update ON public.ezgo_mail_import_lines
  FOR UPDATE TO authenticated
  USING (public.is_ezgo_mail_staff())
  WITH CHECK (public.is_ezgo_mail_staff());

COMMENT ON TABLE public.ezgo_mail_ingest IS
  'Inbound EZGO report emails (Doc1/Doc2) — one row per message-id; parsed by ezgo-mail-sync.';
COMMENT ON TABLE public.ezgo_mail_import_lines IS
  'Per-guest lines extracted from ezgo_mail_ingest — staff approve before guests table UPDATE.';

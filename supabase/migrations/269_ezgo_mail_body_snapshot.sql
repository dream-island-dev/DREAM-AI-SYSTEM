-- 269: Store mail body snapshot for safe reparse without losing ingest on IMAP miss.

ALTER TABLE public.ezgo_mail_ingest
  ADD COLUMN IF NOT EXISTS body_html TEXT,
  ADD COLUMN IF NOT EXISTS body_text TEXT;

COMMENT ON COLUMN public.ezgo_mail_ingest.body_html IS
  'Parsed HTML body snapshot — used by reparse when IMAP fetch misses.';
COMMENT ON COLUMN public.ezgo_mail_ingest.body_text IS
  'Plain-text body snapshot — reparse fallback.';

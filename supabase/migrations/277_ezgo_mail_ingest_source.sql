-- 277: Track how each EZGO mail ingest row arrived — IMAP scan (auto/manual button)
-- vs manual .eml upload — so staff can see in the UI which ones actually synced
-- automatically vs which had to be uploaded by hand (see EzgoMailSyncPanel).

ALTER TABLE public.ezgo_mail_ingest
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'imap_scan'
  CHECK (source IN ('imap_scan', 'manual_eml'));

COMMENT ON COLUMN public.ezgo_mail_ingest.source IS
  'imap_scan = found via IMAP search (cron or manual "סרוק מייל"/"סריקה מלאה"); manual_eml = uploaded via "העלה .eml" because the scan missed it.';

-- 309_wa_inbox_media_storage_close_anon.sql
-- Overnight hardening (2026-08-20), part 5 -- found via the same live
-- pg_policy sweep as 308.
--
-- storage.objects policies wa_inbox_media_read / wa_inbox_media_insert had
-- USING/CHECK = (bucket_id = 'wa_inbox_media') only -- no auth requirement
-- at all. Anyone holding the public anon key could fetch a guest's WhatsApp
-- photo/voice-note by path (path includes phone number + wa message id,
-- e.g. guest/<phone>/<msg_id>.<ext> -- not listable, but not access
-- controlled either), and could upload arbitrary files into the bucket.
--
-- persistGuestWaMedia() (_shared/metaMedia.ts) -- the only writer -- runs
-- inside whatsapp-webhook/whapi-webhook using their service-role client, so
-- it doesn't need the anon/public insert grant. The only reader is the
-- logged-in Inbox UI (WhatsAppInbox.js), which already carries the staff
-- member's session -- narrowing SELECT to authenticated does not break it.

DROP POLICY IF EXISTS "wa_inbox_media_read" ON storage.objects;
CREATE POLICY "wa_inbox_media_read" ON storage.objects
  FOR SELECT
  TO authenticated
  USING (bucket_id = 'wa_inbox_media');

DROP POLICY IF EXISTS "wa_inbox_media_insert" ON storage.objects;
CREATE POLICY "wa_inbox_media_insert" ON storage.objects
  FOR INSERT
  TO service_role
  WITH CHECK (bucket_id = 'wa_inbox_media');

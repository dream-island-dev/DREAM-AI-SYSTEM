-- Migration 153: Guest WhatsApp media in Inbox (session 138 — image MVP).
-- Stores downloaded image bytes in wa_inbox_media bucket; staff sees <img> in thread.

-- ── 1. Conversation row media metadata ─────────────────────────────────────
ALTER TABLE public.whatsapp_conversations
  ADD COLUMN IF NOT EXISTS message_type TEXT NOT NULL DEFAULT 'text',
  ADD COLUMN IF NOT EXISTS media_url TEXT,
  ADD COLUMN IF NOT EXISTS media_mime TEXT,
  ADD COLUMN IF NOT EXISTS media_caption TEXT;

ALTER TABLE public.whatsapp_conversations
  DROP CONSTRAINT IF EXISTS whatsapp_conversations_message_type_check;

ALTER TABLE public.whatsapp_conversations
  ADD CONSTRAINT whatsapp_conversations_message_type_check
  CHECK (message_type IN ('text', 'image', 'video', 'audio', 'document', 'sticker'));

COMMENT ON COLUMN public.whatsapp_conversations.message_type IS
  'Inbound/outbound payload kind — image rows carry media_url for Inbox preview.';
COMMENT ON COLUMN public.whatsapp_conversations.media_url IS
  'Public Supabase Storage URL (wa_inbox_media) — persisted on webhook receipt; Meta URLs expire.';
COMMENT ON COLUMN public.whatsapp_conversations.media_caption IS
  'Guest caption on image/video when provided by Meta.';

-- ── 2. intent — media_received (log-only inbound images) ───────────────────
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
      'guest_feedback',
      'courtesy_ack', 'check_in_policy_faq', 'balloon_room_request', 'stage_2_pay',
      'guest_reaction',
      'media_received'
    )
  );

-- ── 3. Storage bucket (public read — staff Inbox renders <img src>) ─────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'wa_inbox_media',
  'wa_inbox_media',
  true,
  10485760,
  ARRAY['image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif']
)
ON CONFLICT (id) DO UPDATE
  SET public = true,
      file_size_limit = 10485760;

DROP POLICY IF EXISTS wa_inbox_media_read   ON storage.objects;
DROP POLICY IF EXISTS wa_inbox_media_insert ON storage.objects;

CREATE POLICY wa_inbox_media_read ON storage.objects
  FOR SELECT USING (bucket_id = 'wa_inbox_media');

-- Webhook uploads via service_role (bypasses RLS); policy kept for manual ops.
CREATE POLICY wa_inbox_media_insert ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'wa_inbox_media');

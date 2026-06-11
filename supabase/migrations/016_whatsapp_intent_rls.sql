-- ================================================================
-- Migration 016: WhatsApp conversations — intent column + RLS repair
--
-- ROOT CAUSE FIX:
--   The whatsapp-webhook Edge Function inserts an `intent` column
--   ('complaint' | 'upsell' | 'faq' | 'fallback') but migration 010
--   never added that column.  Every INSERT from the webhook failed
--   silently → the inbox table stayed empty.
--
-- This migration:
--   A) Adds the missing `intent` column (idempotent).
--   B) Re-declares the SELECT RLS policy using the correct modern
--      predicate (auth.uid() IS NOT NULL) which works for both
--      authenticated Supabase sessions and service-role calls.
--   C) Adds an INSERT policy for authenticated users so the frontend
--      can manually inject messages if needed in future.
-- ================================================================

-- ── A. Add `intent` column ────────────────────────────────────────
ALTER TABLE public.whatsapp_conversations
  ADD COLUMN IF NOT EXISTS intent TEXT
  CHECK (intent IN ('complaint','upsell','faq','fallback') OR intent IS NULL);

CREATE INDEX IF NOT EXISTS idx_wa_conv_intent
  ON public.whatsapp_conversations (intent)
  WHERE intent IS NOT NULL;

-- ── B. Re-declare RLS policies (drop old ones first) ────────────────
-- The old wa_conv_read used auth.role() = 'authenticated' which can
-- fail when the JWT is verified but auth.role() hasn't propagated.
-- auth.uid() IS NOT NULL is the correct modern guard.

DROP POLICY IF EXISTS wa_conv_read  ON public.whatsapp_conversations;
DROP POLICY IF EXISTS wa_conv_write ON public.whatsapp_conversations;

-- Any logged-in manager/admin can read all conversations
CREATE POLICY wa_conv_read ON public.whatsapp_conversations
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Edge Functions (service role) can write — bypass RLS via service key
-- Also allow authenticated users to write so future manual-reply
-- feature (from the inbox UI) can insert outbound rows directly.
CREATE POLICY wa_conv_write ON public.whatsapp_conversations
  FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL          -- logged-in user (manual reply)
    OR auth.role() = 'service_role' -- Edge Function service key
  );

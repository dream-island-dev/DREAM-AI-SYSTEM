-- ================================================================
-- Migration 076: whatsapp_conversations — add UPDATE RLS policy
--
-- ROOT CAUSE (Session 24, Sprint 1.2):
--   whatsapp_conversations had only SELECT (auth) and INSERT (auth/service)
--   policies — migrations 010 + 016 never created an UPDATE policy. With RLS
--   enabled and no UPDATE policy, ANY client UPDATE silently matches 0 rows
--   (Postgres RLS filters them out without raising an error).
--
--   Effect: WhatsAppInbox.js's "✓ סמן כטופל" (dismissHumanRequest) ran
--   `UPDATE whatsapp_conversations SET human_requested = false ...` which
--   changed nothing in the DB. The optimistic local clear made the red
--   "🔴 מבקש מענה אנושי" badge disappear momentarily, but on the next
--   fetchAll/refresh the unchanged rows re-hydrated the badge — exactly the
--   "fails to clear permanently / reappears on refresh" symptom.
--
-- FIX: add an UPDATE policy for authenticated users (and service role).
-- Mirrors the open authenticated-write model already used on `guests`
-- (migration 028), scoped to this single inbox-operator mutation.
--
-- Safe to re-run (idempotent DROP IF EXISTS).
-- ================================================================

DROP POLICY IF EXISTS wa_conv_update ON public.whatsapp_conversations;
CREATE POLICY wa_conv_update ON public.whatsapp_conversations
  FOR UPDATE
  USING      (auth.uid() IS NOT NULL OR auth.role() = 'service_role')
  WITH CHECK (auth.uid() IS NOT NULL OR auth.role() = 'service_role');

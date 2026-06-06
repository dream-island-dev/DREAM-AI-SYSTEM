-- ================================================================
-- Migration 001: chat_history table
-- Stateful conversation storage — persists across refreshes.
-- Run in: Supabase Dashboard → SQL Editor
-- ================================================================

CREATE TABLE IF NOT EXISTS public.chat_history (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- Client-generated session ID stored in localStorage
  session_id  TEXT        NOT NULL,
  -- Which agent profile this conversation belongs to
  agent_id    TEXT        NOT NULL,
  -- Which manager (can be mock ID or Supabase user UUID)
  manager_id  TEXT        NOT NULL,
  role        TEXT        NOT NULL CHECK (role IN ('user', 'assistant')),
  content     TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fast lookup: all messages for a session, chronological
CREATE INDEX IF NOT EXISTS idx_chat_history_session
  ON public.chat_history (session_id, created_at ASC);

-- Fast lookup: all sessions for a manager
CREATE INDEX IF NOT EXISTS idx_chat_history_manager
  ON public.chat_history (manager_id, created_at DESC);

-- Open RLS: no Supabase Auth required (mock-auth compatible)
ALTER TABLE public.chat_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "chat_history_open" ON public.chat_history FOR ALL USING (true);

-- ================================================================
-- Helpful view: last message per session (for session list UI)
-- ================================================================
CREATE OR REPLACE VIEW public.chat_sessions_summary AS
SELECT DISTINCT ON (session_id)
  session_id,
  agent_id,
  manager_id,
  content   AS last_message,
  role      AS last_role,
  created_at AS last_at
FROM public.chat_history
ORDER BY session_id, created_at DESC;

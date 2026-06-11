-- Migration 021: Add missing columns to agent_memory
-- CRITICAL BUG FIX: process-knowledge was inserting department + source_file_name
-- but these columns never existed, so every upload silently failed at DB insert.
-- KnowledgeUploader.js was also selecting source_file_name which didn't exist.

ALTER TABLE public.agent_memory
  ADD COLUMN IF NOT EXISTS department       TEXT,
  ADD COLUMN IF NOT EXISTS source_file_name TEXT,
  ADD COLUMN IF NOT EXISTS source_type      TEXT DEFAULT 'file'; -- 'file' | 'manual'

-- Index to help group/filter by source file in the UI
CREATE INDEX IF NOT EXISTS idx_agent_memory_manager_source
  ON public.agent_memory (manager_id, source_file_name)
  WHERE is_active = TRUE;

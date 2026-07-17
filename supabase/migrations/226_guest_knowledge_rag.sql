-- Guest knowledge RAG chunks (keyword sync today; pgvector-ready for embeddings later)

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS public.guest_knowledge_chunks (
  id          BIGSERIAL PRIMARY KEY,
  chunk_text  TEXT NOT NULL,
  source      TEXT NOT NULL DEFAULT 'knowledge_base',
  chunk_index INT NOT NULL DEFAULT 0,
  embedding   vector(768),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS guest_knowledge_chunks_source_idx
  ON public.guest_knowledge_chunks (source);

ALTER TABLE public.guest_knowledge_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY guest_knowledge_chunks_service_role ON public.guest_knowledge_chunks
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY guest_knowledge_chunks_authenticated_read ON public.guest_knowledge_chunks
  FOR SELECT TO authenticated USING (true);

COMMENT ON TABLE public.guest_knowledge_chunks IS
  'Chunked bot_settings.knowledge_base for RAG retrieval; embedding optional.';

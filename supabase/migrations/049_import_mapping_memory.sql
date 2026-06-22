-- =============================================================================
-- 049_import_mapping_memory.sql
-- Resilient Import Agent — remembers an admin-approved column mapping so the
-- next upload of the same file format skips the AI call and pre-fills the
-- review screen instantly. The review screen ALWAYS still shows and ALWAYS
-- still requires approval, even for a remembered format — this table only
-- saves a round-trip to Gemini, it never skips the human gate (a source
-- system could quietly rename one column and a silent auto-apply would
-- defeat the whole point of having a review step).
--
-- header_signature = sorted, joined header list (not a hash — exact string
-- match is sufficient here and avoids needing a hash function client-side).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.import_mapping_memory (
  id                BIGSERIAL    PRIMARY KEY,
  schema_key        TEXT         NOT NULL,   -- e.g. "suite_arrivals" — matches suggest-import-mapping's SCHEMAS registry key
  header_signature  TEXT         NOT NULL,   -- sorted headers joined with U+241F, e.g. "Group_Id␟cPrice␟dtCheckIn␟..."
  approved_mapping  JSONB        NOT NULL,   -- { targetField: sourceHeader | null, ... }
  created_by        UUID         REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  last_used_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT import_mapping_memory_key UNIQUE (schema_key, header_signature)
);

CREATE INDEX IF NOT EXISTS idx_import_mapping_memory_lookup
  ON public.import_mapping_memory (schema_key, header_signature);

ALTER TABLE public.import_mapping_memory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated users can read import_mapping_memory"  ON public.import_mapping_memory;
DROP POLICY IF EXISTS "authenticated users can write import_mapping_memory" ON public.import_mapping_memory;

CREATE POLICY "authenticated users can read import_mapping_memory"
  ON public.import_mapping_memory FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "authenticated users can write import_mapping_memory"
  ON public.import_mapping_memory FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.import_mapping_memory IS
  'Resilient Import Agent — remembers approved column mappings per file-header signature so re-uploads of the same format skip the AI call. Review screen still always shows; this never bypasses human approval.';

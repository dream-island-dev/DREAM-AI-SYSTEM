-- =============================================================================
-- 090_inventory_module.sql
-- Inventory Smart-Intake Module — replaces the "agent" tab. AgentQuestionnaire/
-- AgentChat and agent_profiles/agent_memory/agent_learning_logs are left
-- completely untouched by this migration — owner's explicit choice to orphan
-- that feature (same treatment as Chat.js / generate-schedule) rather than
-- delete real conversation/feedback history.
--
-- Four new tables:
--   inventory_items        — catalog per storage location. par_level is read
--                            out of the manager's existing Excel formula during
--                            one-time template onboarding (InventoryImportPanel.js)
--                            — never a value anyone has to type into a new field.
--   inventory_portal_links — the no-login magic-link credential per location,
--                            same security model as guests.portal_token
--                            (migration 083): the token itself IS the auth, not
--                            a guessable id. "צור קישור חדש" deactivates the old
--                            row and inserts a fresh one — history preserved.
--   inventory_submissions  — one row per daily employee submit. Nothing here
--                            is "live" until a manager approves it — mirrors
--                            this app's existing un-reviewed-data convention
--                            (SpaStagingPanel / RequestsBoard).
--   inventory_counts       — line items per submission. restock_suggested is
--                            computed server-side (inventory-portal-submit)
--                            from inventory_items.par_level — never trusted
--                            from the client.
--
-- RLS: authenticated read/write throughout (small cooperative team convention,
-- same as tasks/guests/room_status/suite_rooms). The only writer of
-- submissions/counts from OUTSIDE an authenticated session is the service-role
-- Edge Function (inventory-portal-submit), which bypasses RLS entirely — same
-- pattern as guest-portal-ops-request writing into tasks.
-- =============================================================================

-- ── Table: inventory_items ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.inventory_items (
  id                BIGSERIAL    PRIMARY KEY,
  location_name     TEXT         NOT NULL,    -- free text, e.g. "מחסן ראשי" — not tied to the staff-department enum
  item_name         TEXT         NOT NULL,
  unit              TEXT,                     -- "יח'", "בקבוקים", "סטים"...
  category          TEXT,                     -- "טקסטיל", "אמבטיה"...
  par_level         NUMERIC,                  -- target stock level — read from the source file's formula, nullable until known
  source_note       TEXT,                     -- human-readable provenance, e.g. "מתוך נוסחה בקובץ: =60-D2" (FAIL VISIBLE — never a silent black-box number)
  source_file_name  TEXT,
  is_active         BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ  DEFAULT NOW(),
  created_by        UUID         REFERENCES auth.users(id),
  CONSTRAINT inventory_items_location_item_key UNIQUE (location_name, item_name)
);

COMMENT ON COLUMN public.inventory_items.par_level IS
  'Target stock level. Extracted from the manager''s existing Excel formula during one-time template onboarding (InventoryImportPanel.js) and confirmed/edited by a human in the review grid before saving — never silently assumed, never a brand-new manual-entry field.';
COMMENT ON COLUMN public.inventory_items.source_note IS
  'Plain-language provenance of par_level (e.g. the formula it was read from), so the number is auditable rather than a black box.';

ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "inventory_items_authed_select" ON public.inventory_items
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "inventory_items_authed_all" ON public.inventory_items
  FOR ALL USING (auth.uid() IS NOT NULL);

-- ── Table: inventory_portal_links ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.inventory_portal_links (
  id             BIGSERIAL    PRIMARY KEY,
  token          UUID         NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  location_name  TEXT         NOT NULL,
  is_active      BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ  DEFAULT NOW(),
  created_by     UUID         REFERENCES auth.users(id)
);

COMMENT ON COLUMN public.inventory_portal_links.token IS
  'Opaque random magic-link credential for the public daily-inventory portal (InventoryPortal.js, /inv/:token) — same security model as guests.portal_token (migration 083): the token itself IS the auth, not a guessable id.';
COMMENT ON COLUMN public.inventory_portal_links.is_active IS
  '"צור קישור חדש" deactivates the old row (set false) and inserts a fresh one — rotation preserves history instead of mutating the token in place.';

ALTER TABLE public.inventory_portal_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "inventory_portal_links_authed_select" ON public.inventory_portal_links
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "inventory_portal_links_authed_all" ON public.inventory_portal_links
  FOR ALL USING (auth.uid() IS NOT NULL);

-- ── Table: inventory_submissions ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.inventory_submissions (
  id             BIGSERIAL    PRIMARY KEY,
  location_name  TEXT         NOT NULL,
  status         TEXT         NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by    UUID         REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at    TIMESTAMPTZ,
  review_note    TEXT,
  submitted_at   TIMESTAMPTZ  DEFAULT NOW()
);

COMMENT ON COLUMN public.inventory_submissions.status IS
  'pending = employee submitted, awaiting manager review. Nothing is "live" until approved — mirrors this app''s existing un-reviewed-data convention (SpaStagingPanel / RequestsBoard).';

ALTER TABLE public.inventory_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "inventory_submissions_authed_select" ON public.inventory_submissions
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "inventory_submissions_authed_all" ON public.inventory_submissions
  FOR ALL USING (auth.uid() IS NOT NULL);

-- ── Table: inventory_counts ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.inventory_counts (
  id                 BIGSERIAL    PRIMARY KEY,
  submission_id      BIGINT       NOT NULL REFERENCES public.inventory_submissions(id) ON DELETE CASCADE,
  item_id            BIGINT       REFERENCES public.inventory_items(id) ON DELETE SET NULL,
  counted_quantity   NUMERIC      NOT NULL,
  restock_suggested  NUMERIC,                 -- par_level - counted_quantity, computed server-side at submit time
  created_at         TIMESTAMPTZ  DEFAULT NOW()
);

COMMENT ON COLUMN public.inventory_counts.restock_suggested IS
  'Computed server-side (inventory-portal-submit Edge Function) from inventory_items.par_level at the moment of submission — never trusted from the client, NULL when the item has no par_level yet.';

ALTER TABLE public.inventory_counts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "inventory_counts_authed_select" ON public.inventory_counts
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "inventory_counts_authed_all" ON public.inventory_counts
  FOR ALL USING (auth.uid() IS NOT NULL);

-- ── RPC: upsert_inventory_items ─────────────────────────────────────────────
-- Commits the AI-mapped + human-confirmed review-grid rows into inventory_items.
-- Mirrors sync_suite_arrivals' (migration 046) convention: one PL/pgSQL
-- transaction, RAISE NOTICE per row for diagnostics, rollback-on-error.
--
-- Called from InventoryImportPanel.js via: supabase.rpc('upsert_inventory_items', { payload })
--
-- Payload shape:
-- {
--   "items": [
--     { locationName, itemName, unit, category, parLevel, sourceNote, sourceFileName }
--   ]
-- }
--
-- Returns: { ok, upserted, skipped }
CREATE OR REPLACE FUNCTION public.upsert_inventory_items(payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  it             JSONB;
  v_location     TEXT;
  v_item_name    TEXT;
  upsert_count   INT := 0;
  skip_count     INT := 0;
BEGIN
  RAISE NOTICE '[upsert_inventory_items] ── START ── items=%',
    jsonb_array_length(COALESCE(payload->'items', '[]'::jsonb));

  FOR it IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'items', '[]'::jsonb)) LOOP
    v_location  := it->>'locationName';
    v_item_name := it->>'itemName';

    IF v_location IS NULL OR v_location = '' OR v_item_name IS NULL OR v_item_name = '' THEN
      RAISE NOTICE '[upsert_inventory_items] SKIP — missing location/item name  location=%, item=%', v_location, v_item_name;
      skip_count := skip_count + 1;
      CONTINUE;
    END IF;

    RAISE NOTICE '[upsert_inventory_items] UPSERT  location=%, item=%, par=%',
      v_location, v_item_name, it->>'parLevel';

    INSERT INTO public.inventory_items (
      location_name, item_name, unit, category, par_level, source_note, source_file_name
    )
    VALUES (
      v_location, v_item_name,
      NULLIF(it->>'unit', ''), NULLIF(it->>'category', ''),
      NULLIF(it->>'parLevel', '')::NUMERIC,
      NULLIF(it->>'sourceNote', ''), NULLIF(it->>'sourceFileName', '')
    )
    ON CONFLICT (location_name, item_name) DO UPDATE SET
      unit              = EXCLUDED.unit,
      category          = EXCLUDED.category,
      par_level         = COALESCE(EXCLUDED.par_level, public.inventory_items.par_level),
      source_note       = COALESCE(EXCLUDED.source_note, public.inventory_items.source_note),
      source_file_name  = EXCLUDED.source_file_name,
      is_active         = TRUE;

    upsert_count := upsert_count + 1;
  END LOOP;

  RAISE NOTICE '[upsert_inventory_items] ── COMPLETE ── upserted=%, skipped=% ──', upsert_count, skip_count;

  RETURN jsonb_build_object(
    'ok',       TRUE,
    'upserted', upsert_count,
    'skipped',  skip_count
  );

EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '[upsert_inventory_items] ── ROLLBACK — % ──', SQLERRM;
  RAISE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_inventory_items(JSONB) TO authenticated;

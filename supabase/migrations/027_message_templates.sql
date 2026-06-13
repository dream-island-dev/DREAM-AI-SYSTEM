-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 027: message_templates — מעקב תבניות WhatsApp
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS message_templates (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text        NOT NULL UNIQUE,
  category     text        NOT NULL DEFAULT 'MARKETING'
    CHECK (category IN ('MARKETING','UTILITY','AUTHENTICATION')),
  language     text        NOT NULL DEFAULT 'he',
  body         text        NOT NULL,
  header       text,
  footer       text,
  meta_status  text        NOT NULL DEFAULT 'pending_approval'
    CHECK (meta_status IN ('pending_approval','approved','rejected','in_review')),
  meta_id      text,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  approved_at  timestamptz,
  is_active    boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS message_templates_status_idx ON message_templates(meta_status);

CREATE OR REPLACE FUNCTION set_updated_at_tpl()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS message_templates_updated_at ON message_templates;
CREATE TRIGGER message_templates_updated_at
  BEFORE UPDATE ON message_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_tpl();

ALTER TABLE message_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff_all_message_templates" ON message_templates
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN ('super_admin','admin','manager')
    )
  );

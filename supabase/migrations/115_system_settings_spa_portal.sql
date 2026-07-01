-- 115_system_settings_spa_portal.sql
-- Guest portal spa-request master toggle (enable_spa_request_button).

CREATE TABLE IF NOT EXISTS public.system_settings (
  key         TEXT        PRIMARY KEY,
  value_bool  BOOLEAN,
  value_text  TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.system_settings IS
  'Global feature toggles — read by Edge Functions (service role).';

INSERT INTO public.system_settings (key, value_bool)
VALUES ('enable_spa_request_button', true)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY system_settings_read ON public.system_settings
  FOR SELECT TO authenticated USING (true);

CREATE POLICY system_settings_write ON public.system_settings
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'super_admin', 'manager')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'super_admin', 'manager')
    )
  );

COMMENT ON COLUMN public.tasks.whapi_message_id IS
  'Whapi task card message id — primary reaction target (bot_message_id).';

COMMENT ON COLUMN public.tasks.source_message_id IS
  'Original staff trigger message id — reaction fallback (original_trigger_message_id).';

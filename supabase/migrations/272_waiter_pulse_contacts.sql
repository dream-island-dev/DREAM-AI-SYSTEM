-- Waiter pulse contact roster — separate from guests (no automation pipeline).

CREATE TABLE IF NOT EXISTS public.waiter_pulse_contacts (
  id          BIGSERIAL    PRIMARY KEY,
  name        TEXT,
  phone       TEXT         NOT NULL,
  is_active   BOOLEAN      NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT waiter_pulse_contacts_phone_unique UNIQUE (phone)
);

COMMENT ON TABLE public.waiter_pulse_contacts IS
  'Restaurant waiter roster for one-off survey link dispatch via Whapi. Not linked to guests — zero automation.';

CREATE INDEX IF NOT EXISTS idx_waiter_pulse_contacts_active
  ON public.waiter_pulse_contacts (is_active)
  WHERE is_active = true;

ALTER TABLE public.waiter_pulse_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY waiter_pulse_contacts_authed_rw ON public.waiter_pulse_contacts
  FOR ALL
  USING     (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- Initial roster (seed once; UI can edit thereafter).
INSERT INTO public.waiter_pulse_contacts (name, phone) VALUES
  ('אופק יצחק', '+972528599962'),
  ('', '+972533067778'),
  ('ליאור לוי', '+972533382689'),
  ('ליאור אוזן', '+972534227897'),
  ('עופרי', '+972538246468'),
  ('יאיר ונטורה', '+972538750144'),
  ('לינוי כהן', '+972543401906'),
  ('ליאל רזניקובסקי', '+972543837129'),
  ('אגם', '+972549098878'),
  ('טל שלמה', '+972549790980'),
  ('שני ואסה', '+972549820155'),
  ('ליאן תאיר חזן', '+972556619707'),
  ('עידו', '+972584441843'),
  ('ביזאווית', '+972585887757'),
  ('עדי גואטה', '+972503372230'),
  ('אגם כהן', '+972504201213'),
  ('יהלי הרוש', '+972505070646'),
  ('אליה', '+972505222614'),
  ('אלון', '+972507110109'),
  ('רועי הגבי', '+972507676057'),
  ('זיו', '+972507827403'),
  ('זיו ממו', '+972508499927'),
  ('עינב', '+972508686034'),
  ('בן סורנסן', '+972523822828'),
  ('מתן אוחנה', '+972524453676'),
  ('אלעד בן הרוש', '+972525266077'),
  ('יובל פרץ', '+972526077597'),
  ('אביה גואטה', '+972528095910'),
  ('נועה אזולאי', '+972528188459'),
  ('', '+972506070247'),
  ('', '+972508165672'),
  ('', '+972508499926'),
  ('', '+972535297690'),
  ('', '+972528070651'),
  ('', '+972506822514'),
  ('', '+972549788829'),
  ('', '+972527996120'),
  ('', '+972556887388'),
  ('', '+972506543024'),
  ('', '+972532725183')
ON CONFLICT (phone) DO NOTHING;

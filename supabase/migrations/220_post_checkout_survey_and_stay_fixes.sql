-- 220: Suite post-checkout survey queue (housekeeping Co trigger), checked_out_at,
-- checkout_fb survey script, day-pass departure backfill.

ALTER TABLE public.guests
  ADD COLUMN IF NOT EXISTS checked_out_at TIMESTAMPTZ;

-- Day-pass guests missing departure_date → same-day visit (arrival = departure).
UPDATE public.guests
SET departure_date = arrival_date
WHERE room_type IN ('day_guest', 'premium_day_guest')
  AND arrival_date IS NOT NULL
  AND departure_date IS NULL;

CREATE TABLE IF NOT EXISTS public.post_checkout_survey_queue (
  id          BIGSERIAL PRIMARY KEY,
  guest_id    BIGINT NOT NULL REFERENCES public.guests(id) ON DELETE CASCADE,
  room_id     TEXT,
  source      TEXT NOT NULL DEFAULT 'housekeeping_wa',
  send_after  TIMESTAMPTZ NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'sent', 'failed', 'cancelled')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at     TIMESTAMPTZ,
  error_text  TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS post_checkout_survey_queue_one_pending
  ON public.post_checkout_survey_queue (guest_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS post_checkout_survey_queue_due
  ON public.post_checkout_survey_queue (send_after)
  WHERE status = 'pending';

INSERT INTO public.bot_config (config_key, config_value, category, label)
VALUES (
  'post_checkout_survey_delay_minutes',
  '15',
  'automation',
  'דקות המתנה אחרי צ׳ק-אאוט מקבוצת חדרנות לפני סקר משוב סוויטות'
)
ON CONFLICT (config_key) DO UPDATE
  SET config_value = EXCLUDED.config_value,
      label = EXCLUDED.label;

ALTER TABLE public.post_checkout_survey_queue ENABLE ROW LEVEL SECURITY;

-- Stage 5 suites — portal survey copy (Whapi / Meta session).
UPDATE public.bot_scripts
SET message_text = E'{{GUEST_NAME}}, הדרים איילנד כבר מתגעגע! 🌴
נשמח שתדרגו את החוויה שלכם בריזורט🙏🏽
{{portal_url}}#survey',
    display_name = 'סקר משוב אחרי צ׳ק-אאוט (סוויטות)',
    is_active = true
WHERE script_key = 'checkout_fb';

UPDATE public.automation_stages
SET session_message_script_key = COALESCE(session_message_script_key, 'checkout_fb'),
    display_name = 'Stage 5 — סקר משוב אחרי צ׳ק-אאוט (סוויטות) ⭐'
WHERE stage_key = 'checkout_fb';

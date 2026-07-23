-- Hebrew display names for waiter_pulse_contacts (fixes English seed if 272 already ran).

UPDATE public.waiter_pulse_contacts SET name = 'אופק יצחק', updated_at = now() WHERE phone = '+972528599962';
UPDATE public.waiter_pulse_contacts SET name = 'ליאל רזניקובסקי', updated_at = now() WHERE phone = '+972543837129';
UPDATE public.waiter_pulse_contacts SET name = 'שני ואסה', updated_at = now() WHERE phone = '+972549820155';
UPDATE public.waiter_pulse_contacts SET name = 'עידו', updated_at = now() WHERE phone = '+972584441843';
UPDATE public.waiter_pulse_contacts SET name = 'ביזאווית', updated_at = now() WHERE phone = '+972585887757';
UPDATE public.waiter_pulse_contacts SET name = 'רועי הגבי', updated_at = now() WHERE phone = '+972507676057';
UPDATE public.waiter_pulse_contacts SET name = 'זיו ממו', updated_at = now() WHERE phone = '+972508499927';
UPDATE public.waiter_pulse_contacts SET name = 'בן סורנסן', updated_at = now() WHERE phone = '+972523822828';
UPDATE public.waiter_pulse_contacts SET name = 'אלעד בן הרוש', updated_at = now() WHERE phone = '+972525266077';

-- Legacy English spellings (case-insensitive) → Hebrew
UPDATE public.waiter_pulse_contacts SET name = 'אופק יצחק', updated_at = now()
  WHERE lower(name) IN ('ofek izhak', 'ofek');
UPDATE public.waiter_pulse_contacts SET name = 'ליאל רזניקובסקי', updated_at = now()
  WHERE lower(name) IN ('liel reznikovski', 'liel');
UPDATE public.waiter_pulse_contacts SET name = 'שני ואסה', updated_at = now()
  WHERE lower(name) IN ('shani vasa', 'shani');
UPDATE public.waiter_pulse_contacts SET name = 'עידו', updated_at = now()
  WHERE lower(name) IN ('ido');
UPDATE public.waiter_pulse_contacts SET name = 'ביזאווית', updated_at = now()
  WHERE lower(name) IN ('bizawit');
UPDATE public.waiter_pulse_contacts SET name = 'רועי הגבי', updated_at = now()
  WHERE lower(name) IN ('roei hagbi', 'roei');
UPDATE public.waiter_pulse_contacts SET name = 'זיו ממו', updated_at = now()
  WHERE lower(name) IN ('ziv mamo', 'ziv');
UPDATE public.waiter_pulse_contacts SET name = 'בן סורנסן', updated_at = now()
  WHERE lower(name) LIKE 'ben s%rensen%' OR lower(name) = 'ben';
UPDATE public.waiter_pulse_contacts SET name = 'אלעד בן הרוש', updated_at = now()
  WHERE lower(name) IN ('elad ben harosh', 'elad');

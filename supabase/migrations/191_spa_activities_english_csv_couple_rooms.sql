-- 191_spa_activities_english_csv_couple_rooms.sql
-- Smart Spa Board — unblock real Ezgo English machine-CSV imports:
--   1. Seed missing room aliases seen in production CSV
--      ("סוויטת אבניו 2/3/4", "טרקלין -חדר זוגי")
--   2. Couple rooms may hold TWO overlapping appointments (one per therapist
--      — Ezgo exports a separate line per attendant). Single rooms keep the
--      hard no-overlap GiST. Capacity-2 for couple rooms enforced by trigger.
--
-- Locked decision (Mike, 2026-07-12): two appointment rows per couple slot,
-- not a collapsed single row with a secondary therapist note.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Missing aliases from the real "פעילות ספא" English CSV
-- ─────────────────────────────────────────────────────────────────────────
INSERT INTO public.spa_room_aliases (ezgo_name, room_id)
SELECT alias, r.id
FROM (VALUES
  ('סוויטת אבניו 2',      'אבניו 2'),
  ('סוויטת אבניו 3',      'אבניו 3'),
  ('סוויטת אבניו 4',      'אבניו 4'),
  ('טרקלין -חדר זוגי',    'טרקלין')
) AS seed(alias, room_name)
JOIN public.spa_rooms r ON r.name = seed.room_name
ON CONFLICT (ezgo_name) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Denormalize room_type onto appointments so GiST WHERE can filter
--    single-room-only (EXCLUDE cannot JOIN spa_rooms).
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public.spa_appointments
  ADD COLUMN IF NOT EXISTS room_type TEXT
    CHECK (room_type IS NULL OR room_type IN ('couple', 'single'));

UPDATE public.spa_appointments a
SET room_type = r.room_type
FROM public.spa_rooms r
WHERE a.room_id = r.id
  AND (a.room_type IS DISTINCT FROM r.room_type);

CREATE OR REPLACE FUNCTION public.spa_appointments_sync_room_type()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  SELECT room_type INTO NEW.room_type
  FROM public.spa_rooms
  WHERE id = NEW.room_id;
  IF NEW.room_type IS NULL THEN
    RAISE EXCEPTION 'spa_appointments: room_id % has no spa_rooms.room_type', NEW.room_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_spa_appointments_sync_room_type ON public.spa_appointments;
CREATE TRIGGER trg_spa_appointments_sync_room_type
  BEFORE INSERT OR UPDATE OF room_id ON public.spa_appointments
  FOR EACH ROW
  EXECUTE FUNCTION public.spa_appointments_sync_room_type();

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Replace blanket room-overlap GiST with single-room-only exclusion
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public.spa_appointments
  DROP CONSTRAINT IF EXISTS spa_appointments_room_no_overlap;

ALTER TABLE public.spa_appointments
  ADD CONSTRAINT spa_appointments_single_room_no_overlap
  EXCLUDE USING gist (room_id WITH =, appointment_range WITH &&)
  WHERE (status <> 'cancelled' AND room_type = 'single');

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Couple rooms: max 2 overlapping non-cancelled appointments
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.spa_appointments_couple_capacity_check()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  overlap_count INT;
BEGIN
  IF NEW.status = 'cancelled' THEN
    RETURN NEW;
  END IF;
  IF COALESCE(NEW.room_type, '') <> 'couple' THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*)::INT INTO overlap_count
  FROM public.spa_appointments a
  WHERE a.room_id = NEW.room_id
    AND a.status <> 'cancelled'
    AND (TG_OP = 'INSERT' OR a.id IS DISTINCT FROM NEW.id)
    AND a.appointment_range && tsrange(
      (NEW.appointment_date + NEW.start_time)::timestamp,
      (NEW.appointment_date + NEW.end_time)::timestamp,
      '[)'
    );

  IF overlap_count >= 2 THEN
    RAISE EXCEPTION 'spa_appointments_couple_capacity: room_id % already has 2 overlapping appointments', NEW.room_id
      USING ERRCODE = 'exclusion_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_spa_appointments_couple_capacity ON public.spa_appointments;
CREATE TRIGGER trg_spa_appointments_couple_capacity
  BEFORE INSERT OR UPDATE OF room_id, appointment_date, start_time, end_time, status
  ON public.spa_appointments
  FOR EACH ROW
  EXECUTE FUNCTION public.spa_appointments_couple_capacity_check();

COMMENT ON COLUMN public.spa_appointments.room_type IS
  'Denormalized from spa_rooms.room_type — enables single-room-only GiST exclusion while couple rooms allow up to 2 overlapping appointments (one per therapist).';

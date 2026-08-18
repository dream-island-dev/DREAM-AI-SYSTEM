-- 302_spa_avenue_5_room.sql
-- EZGO spa-ops CSV uses "סוויטות אבניו 5" / "סוויטת אבניו 5" (~196 active rows in Aug 2026 dump).
-- Physical 5th couple suite was missing from spa_rooms (1–4 only).

INSERT INTO public.spa_rooms (name, room_type, display_order)
VALUES ('אבניו 5', 'couple', 8)
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.spa_room_aliases (ezgo_name, room_id)
SELECT alias, r.id
FROM (VALUES
  ('אבניו 5',          'אבניו 5'),
  ('סוויטת אבניו 5',   'אבניו 5'),
  ('סוויטות אבניו 5',  'אבניו 5')
) AS seed(alias, room_name)
JOIN public.spa_rooms r ON r.name = seed.room_name
ON CONFLICT (ezgo_name) DO NOTHING;

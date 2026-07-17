-- Migration 225 — missing_departure_date alerts + routing seed + backfill

INSERT INTO public.routing_config (intent_type, destination_board, enable_sla, label) VALUES
  ('alert_missing_departure_date', 'requests', TRUE, 'חסר תאריך עזיבה')
ON CONFLICT (intent_type) DO NOTHING;

INSERT INTO public.guest_alerts (guest_id, phone, alert_type, message, resolved, created_at)
SELECT
  g.id,
  g.phone,
  'missing_departure_date',
  '⚠️ חסר תאריך עזיבה ל' || COALESCE(NULLIF(TRIM(g.name), ''), 'אורח') || ' — יש להשלים בדחיפות (משפיע על אוטומציות ו-checkout)',
  FALSE,
  NOW()
FROM public.guests g
WHERE g.departure_date IS NULL
  AND g.arrival_date IS NOT NULL
  AND g.status NOT IN ('cancelled', 'checked_out')
  AND COALESCE(g.room_type, '') NOT IN ('day_guest', 'premium_day_guest')
  AND NOT EXISTS (
    SELECT 1 FROM public.guest_alerts ga
    WHERE ga.guest_id = g.id
      AND ga.alert_type = 'missing_departure_date'
      AND ga.resolved = FALSE
  );

-- Migration 158: Move misrouted guest requests from Operations Board → Requests Board.
-- Backfills guest_alerts from open portal_room_service tasks and קבלה/בקשות
-- guest_request admin duplicates; closes migrated tasks (Zero Data Loss — tasks
-- stay in DB as done, not deleted).

-- routing_config row for new alert_type used by guest-portal-ops-request
INSERT INTO public.routing_config (intent_type, destination_board, enable_sla, label) VALUES
  ('alert_portal_room_service', 'requests', FALSE, 'שירות חדרים (פורטל → לוח בקשות)')
ON CONFLICT (intent_type) DO NOTHING;

-- ── 1. Portal room-service tasks → guest_alerts ─────────────────────────────
INSERT INTO public.guest_alerts (guest_id, phone, alert_type, message, resolved, created_at)
SELECT
  t.guest_id,
  g.phone,
  'portal_room_service',
  COALESCE(NULLIF(TRIM(t.description), ''), 'הזמנת שירות לחדר (פורטל)'),
  false,
  t.created_at
FROM public.tasks t
JOIN public.guests g ON g.id = t.guest_id
WHERE t.source = 'portal_room_service'
  AND t.status IN ('open', 'in_progress', 'pending_approval')
  AND g.phone IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.guest_alerts ga
    WHERE ga.guest_id = t.guest_id
      AND ga.alert_type = 'portal_room_service'
      AND ga.message = COALESCE(NULLIF(TRIM(t.description), ''), 'הזמנת שירות לחדר (פורטל)')
  );

UPDATE public.tasks
SET
  status      = 'done',
  resolved_at = NOW()
WHERE source = 'portal_room_service'
  AND status IN ('open', 'in_progress', 'pending_approval');

-- ── 2. Admin/reception guest_request duplicates → guest_alerts ────────────
INSERT INTO public.guest_alerts (guest_id, phone, alert_type, message, resolved, created_at)
SELECT
  t.guest_id,
  g.phone,
  CASE
    WHEN t.description ILIKE '%כספית%' OR t.description ILIKE '%חיוב%' THEN 'financial_issue'
    WHEN t.description ILIKE '%שינוי שהות%' OR t.description ILIKE '%צק-אאוט%' THEN 'date_change_request'
    WHEN t.description ILIKE '%ספא%' OR t.description ILIKE '%טיפול%' THEN 'request'
    ELSE 'request'
  END,
  COALESCE(NULLIF(TRIM(t.reporter_raw_text), ''), NULLIF(TRIM(t.description), ''), 'בקשת אורח'),
  false,
  t.created_at
FROM public.tasks t
JOIN public.guests g ON g.id = t.guest_id
WHERE t.source = 'guest_request'
  AND t.department = 'קבלה/בקשות'
  AND t.status IN ('open', 'in_progress', 'pending_approval')
  AND g.phone IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.guest_alerts ga
    WHERE ga.guest_id = t.guest_id
      AND ga.message = COALESCE(NULLIF(TRIM(t.reporter_raw_text), ''), NULLIF(TRIM(t.description), ''), 'בקשת אורח')
      AND ga.created_at BETWEEN t.created_at - INTERVAL '2 hours' AND t.created_at + INTERVAL '2 hours'
  );

UPDATE public.tasks
SET
  status      = 'done',
  resolved_at = NOW()
WHERE source = 'guest_request'
  AND department = 'קבלה/בקשות'
  AND status IN ('open', 'in_progress', 'pending_approval');

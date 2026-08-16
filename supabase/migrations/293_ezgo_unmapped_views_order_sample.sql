-- 293_ezgo_unmapped_views_order_sample.sql
-- EZGO live API sync — Phase 1 UI follow-up. Adds a sample OrderId to each
-- unmapped-code view row so staff mapping a code from the panel can cross-
-- check it against a real order in EZGO's own admin if they're unsure,
-- instead of mapping blind.

CREATE OR REPLACE VIEW public.ezgo_worker_ids_seen
WITH (security_invoker = true) AS
SELECT
  ezgo_worker_id,
  COUNT(*)::int AS event_count,
  MAX(created_at) AS last_seen_at,
  (array_agg(order_id ORDER BY created_at DESC))[1] AS sample_order_id
FROM (
  SELECT
    created_at,
    raw_payload->>'OrderId' AS order_id,
    (((raw_payload->>'Value')::jsonb)->'Timing'->'Worker'->>'WorkerId')::int AS ezgo_worker_id
  FROM public.ezgo_api_ingest
  WHERE raw_payload->>'Entity' = 'Activities'
    AND raw_payload->>'Value' IS NOT NULL
) sub
WHERE ezgo_worker_id IS NOT NULL
GROUP BY ezgo_worker_id;

CREATE OR REPLACE VIEW public.ezgo_room_ids_seen
WITH (security_invoker = true) AS
SELECT
  ezgo_room_id,
  COUNT(*)::int AS event_count,
  MAX(created_at) AS last_seen_at,
  (array_agg(order_id ORDER BY created_at DESC))[1] AS sample_order_id
FROM (
  SELECT
    created_at,
    raw_payload->>'OrderId' AS order_id,
    (((raw_payload->>'Value')::jsonb)->'Room'->>'RoomId')::int AS ezgo_room_id
  FROM public.ezgo_api_ingest
  WHERE raw_payload->>'Entity' = 'Reservations'
    AND raw_payload->>'Value' IS NOT NULL
) sub
WHERE ezgo_room_id IS NOT NULL AND ezgo_room_id != 0
GROUP BY ezgo_room_id;

COMMENT ON VIEW public.ezgo_worker_ids_seen IS
  'Distinct EZGO Activities.Timing.Worker.WorkerId values observed live, with counts + a sample OrderId — feeds the therapist-mapping panel. Not anti-joined against spa_therapists.ezgo_worker_id here; the panel filters already-mapped ids client-side.';
COMMENT ON VIEW public.ezgo_room_ids_seen IS
  'Distinct EZGO Reservations.Room.RoomId values observed live (excluding 0 = not yet assigned), with counts + a sample OrderId — feeds the suite-room-mapping panel. Not anti-joined against ezgo_suite_room_map here; the panel filters already-mapped ids client-side.';

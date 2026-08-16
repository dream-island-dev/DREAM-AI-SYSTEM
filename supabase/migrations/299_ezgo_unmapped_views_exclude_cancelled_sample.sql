-- 299_ezgo_unmapped_views_exclude_cancelled_sample.sql
-- EZGO live API sync — room/worker mapping sample fix (Mike, 2026-08-16):
-- order #280156 showed up as the sample OrderId for RoomId 27, but its
-- LATEST Orders.Status is 0 (cancelled) — confirmed live: Status=1 at
-- 09:58:10, then Status=0 at 09:58:37, same order. A cancelled order is
-- useless as a cross-check sample (nothing to compare against in EZGO's
-- live view, no guests row exists for it either) and actively misleading.
--
-- sample_order_id now prefers the most recent event whose order's LATEST
-- Orders.Status is 1 (active); falls back to the most recent event overall
-- only when no active order ever referenced this code (better than showing
-- nothing).

CREATE OR REPLACE VIEW public.ezgo_worker_ids_seen
WITH (security_invoker = true) AS
WITH order_latest_status AS (
  SELECT DISTINCT ON (raw_payload->>'OrderId')
    raw_payload->>'OrderId' AS order_id,
    (((raw_payload->>'Value')::jsonb)->'Order'->>'Status') AS latest_status
  FROM public.ezgo_api_ingest
  WHERE raw_payload->>'Entity' = 'Orders'
  ORDER BY raw_payload->>'OrderId', created_at DESC
),
events AS (
  SELECT
    created_at,
    raw_payload->>'OrderId' AS order_id,
    (((raw_payload->>'Value')::jsonb)->'Timing'->'Worker'->>'WorkerId')::int AS ezgo_worker_id
  FROM public.ezgo_api_ingest
  WHERE raw_payload->>'Entity' = 'Activities'
    AND raw_payload->>'Value' IS NOT NULL
)
SELECT
  ezgo_worker_id,
  COUNT(*)::int AS event_count,
  MAX(e.created_at) AS last_seen_at,
  COALESCE(
    (array_agg(e.order_id ORDER BY e.created_at DESC) FILTER (WHERE ols.latest_status = '1'))[1],
    (array_agg(e.order_id ORDER BY e.created_at DESC))[1]
  ) AS sample_order_id
FROM events e
LEFT JOIN order_latest_status ols ON ols.order_id = e.order_id
WHERE ezgo_worker_id IS NOT NULL
GROUP BY ezgo_worker_id;

CREATE OR REPLACE VIEW public.ezgo_room_ids_seen
WITH (security_invoker = true) AS
WITH order_latest_status AS (
  SELECT DISTINCT ON (raw_payload->>'OrderId')
    raw_payload->>'OrderId' AS order_id,
    (((raw_payload->>'Value')::jsonb)->'Order'->>'Status') AS latest_status
  FROM public.ezgo_api_ingest
  WHERE raw_payload->>'Entity' = 'Orders'
  ORDER BY raw_payload->>'OrderId', created_at DESC
),
events AS (
  SELECT
    created_at,
    raw_payload->>'OrderId' AS order_id,
    (((raw_payload->>'Value')::jsonb)->'Room'->>'RoomId')::int AS ezgo_room_id
  FROM public.ezgo_api_ingest
  WHERE raw_payload->>'Entity' = 'Reservations'
    AND raw_payload->>'Value' IS NOT NULL
)
SELECT
  ezgo_room_id,
  COUNT(*)::int AS event_count,
  MAX(e.created_at) AS last_seen_at,
  COALESCE(
    (array_agg(e.order_id ORDER BY e.created_at DESC) FILTER (WHERE ols.latest_status = '1'))[1],
    (array_agg(e.order_id ORDER BY e.created_at DESC))[1]
  ) AS sample_order_id
FROM events e
LEFT JOIN order_latest_status ols ON ols.order_id = e.order_id
WHERE ezgo_room_id IS NOT NULL AND ezgo_room_id != 0
GROUP BY ezgo_room_id;

COMMENT ON VIEW public.ezgo_worker_ids_seen IS
  'Distinct EZGO Activities.Timing.Worker.WorkerId values observed live, with counts + a sample OrderId (prefers an order whose LATEST Orders.Status is active, never a cancelled one) — feeds the therapist-mapping panel.';
COMMENT ON VIEW public.ezgo_room_ids_seen IS
  'Distinct EZGO Reservations.Room.RoomId values observed live (excluding 0 = not yet assigned), with counts + a sample OrderId (prefers an order whose LATEST Orders.Status is active, never a cancelled one) — feeds the suite-room-mapping panel.';

-- 300_ezgo_room_map_staff_verified.sql
-- (Renumbered from Cursor's WIP 298_ezgo_room_map_staff_verified.sql — 298
-- was already taken by 298_ezgo_client_id_cross_order_merge.sql on main.
-- Content merged with 299_ezgo_unmapped_views_exclude_cancelled_sample.sql,
-- which was applied to the live DB (as timestamp version 20260816142740)
-- AFTER this WIP was written and would otherwise have been silently
-- reverted by this file's CREATE OR REPLACE VIEW.)
--
-- RoomId mapping must be FAIL VISIBLE: auto_bootstrap is not proof.
-- Prefer a single-room sample order in ezgo_room_ids_seen so staff never
-- map from an order that has two suites — and prefer a non-cancelled order
-- (999's fix) over a cancelled one, since a cancelled order has nothing to
-- cross-check in EZGO's live view.
--
-- Also adds a hard DB-level guard that RoomId=0 (EZGO's "not yet assigned"
-- sentinel) can never be written to ezgo_suite_room_map — previously only
-- enforced by the panel only ever offering ids from ezgo_room_ids_seen
-- (which already excludes 0). The new manual "add mapping" row lets staff
-- free-type a RoomId, so this needs a real constraint, not just client-side
-- validation.

ALTER TABLE public.ezgo_suite_room_map
  DROP CONSTRAINT IF EXISTS ezgo_suite_room_map_matched_via_check;

ALTER TABLE public.ezgo_suite_room_map
  ADD CONSTRAINT ezgo_suite_room_map_matched_via_check
  CHECK (matched_via IN ('auto_bootstrap', 'manual', 'csv_verified', 'staff_verified'));

COMMENT ON COLUMN public.ezgo_suite_room_map.matched_via IS
  'csv_verified = EZGO arrivals CSV (highest). staff_verified = staff confirmed in EZGO room catalog, a 1-room order, or typed directly from EZGO''s own room list. auto_bootstrap = inferred from our DB (untrusted until confirmed). manual = panel pick not yet confirmed.';

ALTER TABLE public.ezgo_suite_room_map
  DROP CONSTRAINT IF EXISTS ezgo_suite_room_map_room_id_nonzero;

ALTER TABLE public.ezgo_suite_room_map
  ADD CONSTRAINT ezgo_suite_room_map_room_id_nonzero
  CHECK (ezgo_room_id <> 0);

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
valid AS (
  SELECT
    created_at,
    raw_payload->>'OrderId' AS order_id,
    (((raw_payload->>'Value')::jsonb)->'Room'->>'RoomId')::int AS ezgo_room_id
  FROM public.ezgo_api_ingest
  WHERE raw_payload->>'Entity' = 'Reservations'
    AND raw_payload->>'Value' IS NOT NULL
    AND (((raw_payload->>'Value')::jsonb)->'Room'->>'RoomId')::int IS NOT NULL
    AND (((raw_payload->>'Value')::jsonb)->'Room'->>'RoomId')::int <> 0
),
order_room_counts AS (
  SELECT order_id, COUNT(DISTINCT ezgo_room_id)::int AS room_count
  FROM valid
  GROUP BY order_id
),
picked AS (
  SELECT DISTINCT ON (v.ezgo_room_id)
    v.ezgo_room_id,
    v.order_id AS sample_order_id,
    c.room_count AS sample_order_room_count
  FROM valid v
  JOIN order_room_counts c ON c.order_id = v.order_id
  LEFT JOIN order_latest_status ols ON ols.order_id = v.order_id
  ORDER BY v.ezgo_room_id,
    CASE WHEN ols.latest_status = '1' THEN 0 ELSE 1 END,
    CASE WHEN c.room_count = 1 THEN 0 ELSE 1 END,
    v.created_at DESC
)
SELECT
  v.ezgo_room_id,
  COUNT(*)::int AS event_count,
  MAX(v.created_at) AS last_seen_at,
  p.sample_order_id,
  p.sample_order_room_count
FROM valid v
JOIN picked p ON p.ezgo_room_id = v.ezgo_room_id
GROUP BY v.ezgo_room_id, p.sample_order_id, p.sample_order_room_count;

COMMENT ON VIEW public.ezgo_room_ids_seen IS
  'Distinct EZGO RoomId values (excluding 0), with counts + a sample OrderId (prefers an order whose LATEST Orders.Status is active over a cancelled one, then prefers a single-room order over a multi-room one) + sample_order_room_count so the panel can warn staff never to map from a multi-room order.';

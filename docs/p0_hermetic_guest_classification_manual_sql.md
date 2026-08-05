# P0 2026-08-05 — Hermetic guest classification: manual SQL reference

> **Read-only reference for Mike.** These queries are for manually inspecting/
> fixing existing split-brain data in prod. **Do not run the UPDATE/DELETE
> statements without reviewing the SELECT output first.** The same fixes are
> now also available in-app: DataSyncPage → **📥 ייבוא דוחות** tab → the red
> "🚨 תיקון אצווה — סוויטה מסווגת בטעות כבילוי יומי" panel at the top
> (`SuiteRoomTypeBulkFixPanel.js`). Prefer the UI — it goes through the same
> guard code (`src/utils/guestSegmentGuard.js`) and logs nothing extra; use
> the raw SQL below only if the UI is unavailable or you need to inspect
something the UI doesn't surface.

## Background

A guest whose `room` is a real physical suite (one of the 26 names in
`src/data/suiteRegistry.js`'s `SUITE_REGISTRY`) should never have
`room_type` set to `day_guest` or `premium_day_guest` — that combination is
"split-brain": the guest shows up as a day-pass visitor everywhere the app
reads `room_type` (spa upsell audience, automation routing, ACC Live Queue)
while actually being a checked-in suite guest. See `CLAUDE.md`'s P0 section
and `src/utils/guestSegmentGuard.js` for the code-level fix (prevention going
forward). This doc is only for cleaning up rows created **before** that fix
shipped.

## 1. Identify split-brain rows (room is a real suite, room_type says day-pass)

```sql
SELECT id, name, phone, room, room_type, status, arrival_date, departure_date
FROM public.guests
WHERE room_type IN ('day_guest', 'premium_day_guest')
  AND room IN (
    'ג׳ספר 1','ג׳ספר 2','ג׳ספר 3','ג׳ספר 4','ג׳ספר 5','ג׳ספר 6',
    'אוניקס 7','אמטיסט 8','אמטיסט 9','אמטיסט 10','אמטיסט 11','אוניקס 12',
    'רובי 13','רובי 14','רובי 15','רובי 16',
    'אמרלד 17','אמרלד 18','אמרלד 19','אמרלד 20',
    'אקווה מרין 21','אקווה מרין 22','אקווה מרין 23',
    'אקווה מרין 24','אקווה מרין 25','אקווה מרין 26'
  )
ORDER BY arrival_date DESC;
```

If this list doesn't match what the in-app panel shows, the panel is more
trustworthy — it uses `isCanonicalSuiteRoom()`, which also tolerates geresh
(׳) character variants that a raw string `IN (...)` list can miss.

### Fix — flip room_type to 'suite' (never touches room/status/checked_in)

```sql
UPDATE public.guests
SET room_type = 'suite'
WHERE id IN (/* paste the ids you reviewed above, comma-separated */);
```

## 2. Identify duplicate profile pairs (same phone, overlapping stay)

Phone is stored two ways in this table's history — `+972...` and bare
`972...` — so compare on digits only:

```sql
WITH normalized AS (
  SELECT id, name, phone, room, room_type, status, arrival_date, departure_date,
         regexp_replace(phone, '[^0-9]', '', 'g') AS phone_digits
  FROM public.guests
  WHERE phone IS NOT NULL
    AND arrival_date IS NOT NULL
    AND status <> 'cancelled'
)
SELECT a.id AS id_a, a.name AS name_a, a.room AS room_a, a.room_type AS room_type_a,
       a.arrival_date AS arrival_a, a.departure_date AS departure_a,
       b.id AS id_b, b.name AS name_b, b.room AS room_b, b.room_type AS room_type_b,
       b.arrival_date AS arrival_b, b.departure_date AS departure_b
FROM normalized a
JOIN normalized b
  ON a.phone_digits = b.phone_digits
 AND a.id < b.id
 AND a.arrival_date <= COALESCE(b.departure_date, b.arrival_date)
 AND b.arrival_date <= COALESCE(a.departure_date, a.arrival_date)
ORDER BY a.arrival_date DESC;
```

### Fix — review each pair, keep the correct row, delete the other

**Never `DELETE FROM guests` directly** — always go through the
`delete_guest_profile` RPC (migration 141) so pending `scheduled_tasks` for
that guest get cancelled first, not orphaned:

```sql
SELECT public.delete_guest_profile(<id_to_remove>);
```

Or just use the "🗑 מחק פרופיל זה" button in the UI panel's duplicate-pairs
section, which calls the same RPC.

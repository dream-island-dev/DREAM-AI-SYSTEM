# XOS — Open Tasks (live queue)

> **Every session:** read this file before coding.  
> Mike adds rows here (or asks the agent to). Done rows move to **Done** with a date.  
> `docs/active_sprint.md` is historical; **this file is the current work queue.**

Last updated: 2026-08-20

---

## Freeze (do not break live spa upsell drain)

**Staff-scheduled Meta spa upsell** (תומכות חינוך / ~656 day-pass, 2026-08-23 arrival) is draining via `whatsapp-cron` → `dispatchDueSpaUpsellScheduledTasks` (`scheduled_tasks` `stage_key=spa_upsell_daypass`).

Until Mike confirms the pending tab is empty:

| Do | Do not |
|---|---|
| Docs / this file | `npx supabase functions deploy whatsapp-cron` / `whatsapp-send` / `spaUpsellSchedule` |
| Local `npm start` | Change cron send delay, mark-dispatched, or stage_key |
| Frontend-only work **uncommitted** | `git add -A` (unrelated WIP in the tree) |

Leaving the laptop / home internet off does **not** stop the drain (server-side).

---

## Live vs not live (this thread + known leftovers)

| Item | Live production? | Notes |
|---|---|---|
| Spa accept phrases («רוצה לתאם», «נשמח לתאם», «כן רוצה»; reject «לא רוצה») | **Yes** (2026-08-20) | `whatsapp-webhook` + `whapi-webhook` deployed. Source: `_shared/automationSchedule.ts`. May still be **uncommitted**. |
| Sticky progress banner on Spa Upsell Hub | **No** | Not coded. |
| «Select next 50/80» | **No** | Not coded. |
| Owner DM price = Meta template price (280 vs 300) | **No** | DM parses `bot_scripts.spa_upsell_daypass`. Guest got Meta `spa_upsell_daypass1` (280). Workaround until code: edit script to 280. |
| Auth guard `assertAuthenticatedStaff` (6 functions) | **No** | Changelog 2026-08-20: written, tests pass, **not deployed, not committed**. Deploy only when Mike says — not during spa freeze. |
| Unrelated local diffs (Doc2, forecast, guest bot, migrations 290/303, etc.) | Mixed | Do not treat as this queue. Do not `git add -A`. |

---

## Queue (do after freeze, unless marked docs-only)

### T1 — Spa Upsell Hub: sticky progress banner
- **Status:** pending (code after freeze)
- **Why:** Create 656 profiles / parse / schedule looked frozen (button text only, no `142/656`).
- **Where:** `src/components/SpaUpsellHub.js`; create loop `src/utils/daypassGuestCreate.js` needs a progress callback.
- **Do not touch:** cron / `whatsapp-send`.

### T2 — Spa Upsell Hub: «select next 50 / 80»
- **Status:** pending (code after freeze)
- **Why:** Only select-all or per-row checkboxes.
- **Where:** `SpaUpsellHub.js` selection bar.

### T3 — Spa accept owner DM price matches sent offer
- **Status:** pending (code after freeze; **do not deploy webhooks during drain**)
- **Symptom:** Mike DM `מעוניין/ת בטיפול ספא (300₪/45 דק׳)` while guest Meta copy is **280₪**.
- **Root:** `resolveSpaUpsellPricing` reads `bot_scripts.spa_upsell_daypass` (`spaUpsellPricing.ts` → `guestAlertWhapiNotify.ts`). Meta body is live `spa_upsell_daypass1`.
- **Interim:** staff can set `bot_scripts.spa_upsell_daypass` to 280 (next DMs only).
- **Proper fix (later):** price from the channel that actually sent (Meta live body / `wa_template_name` on the send), not Whapi script when Dream Bot was used.
- **Deploy later:** `whatsapp-webhook` `whapi-webhook` (same as accept path).

### T4 — EZGO room / profile change → XOS (15 ↔ 16 swap)
- **Status:** done (code 2026-08-20) — **not deployed** until Mike says תעלה (`ezgo-mail-sync` + frontend)
- **Shipped:** same-booking Doc2 snapshot overwrites suite `arrival_date`/`departure_date`; canonical suite never becomes day-guest from `iNights=0`; after all Doc2 lines of an ingest, `suite_rooms` = rooms in that report (`reconcileDoc2GuestRoomsToReport`). 10+11 stay; 15→16 prunes 15.

### T5 — EZGO API live sync (pending room + day-pass)
- **Status:** done (code 2026-08-20) — **not deployed** (spa freeze; `ezgo-guest-sync` only)
- **Shipped:** RoomId=0 creates suite profile waiting for assignment; later Reservations + historical Orders lookup fills room; Rooms:[] creates muted `day_guest`; room prune per OrderId (`reconcileGuestRoomsForOrder`). Check-in/out still housekeeping WA only. Each cron tick restages up to 200 parked **suite** ingest rows (`failed` + Reservations / Order.Rooms>0). Day-pass `order_no_room_grace_expired` stays parked (no 1000-profile flood).

---

## How to add a task (Mike or agent)

One row: **id, title, status** (`pending` / `frozen` / `done`), **blocker**, **files**.  
Agent: append here in the same session Mike asked — do not rely on chat memory.

---

## Done (this thread)

| When | What |
|---|---|
| 2026-08-20 | HK check-in salvage (parser + GuestsPage Hold). Deploy: `whapi-webhook` + frontend. |
| 2026-08-20 | Paste list for Sunday spa upsell generated; 656 day-pass profiles created; staff scheduled Meta send. |

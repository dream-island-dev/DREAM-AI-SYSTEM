# XOS — Active Sprint Status
> Last updated: 2026-07-08 (session 143 — audit fixes: Shabbat template bypass on manual morning dispatch, checkout_fb_daypass editor lock, live template names below corrected per migration 102 rename).
> Full session history → `CLAUDE.md` §10 + `claude_history.md`.
> **Agent workflow** → `docs/xos_agent_playbook.md`

---

## 🟢 In Progress — P0/P1/P2 Incident + Inbox Sprint (session 125)

| Phase | Target | Status |
|---|---|---|
| P0-A | Suite vs day-pass routing guard (`_shared/suiteNames.ts`, effective classification everywhere + ⚠ conflict badges) | ✅ deployed session 125 |
| P0-B | WhatsApp reactions FAIL VISIBLE in Inbox (webhook `reaction` branch, log-only) | ✅ deployed session 125 |
| P1-C | Inbox real-time verify — migration 107 publication ✓ applied, LIVE indicator ✓ exists, live reception proven (inbound answered in 5s post-deploy) | ✅ verified session 125 |
| P1-D | Roster sort «פעילות» (Mike's call — unread pinning removed), `mergeThreadRows` additive-only (force-refresh no longer drops newest messages on long threads), scroll preserved on unrelated roster merges | ✅ deployed session 125 |
| P2-E | Guest name click (GuestsPage/GuestDashboard) → DREAM BOT chat; 👤 icon keeps profile pane | ✅ deployed session 125 |
| P2-F | duplicate_blocked toasts — AICopilot + SuitesDashboard (ACC already covered) | ✅ deployed session 125 |
| P2-G | Portal-link + Stage-2 buttons now preload editable draft (human-in-the-loop, preloadRoomReadyMessage pattern) — no direct dispatch | ✅ deployed session 125 |
| P2-H | Check-in date filter (sessionStorage) ↔ Inbox roster chips (היום↔בריזורט, מחר↔מחר) | ✅ deployed session 125 |

**Post-deploy QA (Mike):** run the conflict-audit SQL (CLAUDE.md session 125) for today's arrivals; send a real ❤️ reaction to a bot message → readable line in DREAM BOT שיחות.

---

## 🟢 In Progress — Staff UI Upgrade (Mike session 74)

**Goal:** Premium scannable staff UI ("Wow") — visual only, no logic/Hebrew label changes.

| Phase | Target | Status |
|---|---|---|
| 0 | `App.js` design tokens + utility classes | ✅ committed `b450b65` |
| 1 | `WhatsAppInbox.js` roster + CTAs | ✅ committed `b450b65` — Vercel deploy |
| 2a | `Dashboard` KPI cards (`App.js`) | 🟡 מקומי — KPI + dash-grid tokens, tablet 2×2 |
| 2b | `OperationsBoard.js` TaskCards + chips | ✅ session 124 — SLA+💬 שיחה+dept icons+touch targets |
| 3 | `HousekeepingTabletView.js` + AICopilot verify | Pending |
| 4 | `App.js` mobile shell + `GuestsPage.js` | 🟡 חלקי — ResortPulseBar responsive; GuestsPage unchanged |
| 5 | Real phone QA on Vercel (390px routes) | Pending |
| **124** | Resort Pulse + Cmd+K + Journey timeline + ACC day preview | ✅ מקומי — 107 tests, build נקי |

**Dual-surface:** every phase = desktop polish + mobile checklist (390/768px) before deploy.  
**Kickoff:** full prompt in `docs/xos_agent_playbook.md` §11, then `start phase 0`

---

## System Status: PRODUCTION ✅

Core WhatsApp pipeline live. `CRON_ENABLED=true`, `AUTOMATION_ENABLED=true`.
pg_cron "wa-cron" (*/15min) active. SLA escalation (*/1min) active.

---

## 🔴 Blocked — Action Required (Mike)

### 1. Meta Template Approvals
> ⚠️ Template names below corrected 2026-07-08 to what the live code actually routes to
> (migration 102 renamed the morning pair; night_before routes to its own suites pair —
> `dream_checkin_reminder_v2` now serves only day-pass `night_before_daypass` / day-pass `pre_arrival_2d`).
> Verify approval status of THESE names in Meta Business Manager, not the old ones.

| Template | Trigger | Status |
|---|---|---|
| `night_before_suites` / `night_before_suites_shabbat` | night_before (T-1, suites) | Verify in Meta |
| `suite_welcome_morning` / `suite_welcome_morning_shabbat` | morning_suite + morning_welcome (arrival day) | Verify in Meta |
| `dream_room_ready1` | AICopilot room-ready handoff (outside 24h window) | Verify in Meta |

**Resolution:** Approve in Meta Business Manager → then run:
```sql
UPDATE automation_stages SET is_active=true
WHERE stage_key IN ('night_before','morning_suite','morning_welcome');
```

### 2. Voucher Reconciliation — Live Click-Through Required
- `VoucherReconciliationHub.js` built + `npm run build` clean
- **Never verified by human** (demo login blocked in dev env)
- **Action:** Mike — verify "התאמת שוברים" route with real production login
- Run a real import against actual EasyGo + provider files to validate migration 092

### 3. Inventory Admin UI — Live Click-Through Required
- `InventoryHub.js` 3 sub-tabs never click-tested (same dev login blocker)
- **Action:** Mike — verify "ניהול מלאי" route with real production login

---

## ✅ Active Automation Pipeline

| Stage key | Template | Trigger timing | Status |
|---|---|---|---|
| `pre_arrival_2d` | `dream_arrival_confirmation` | T-2 days | ✅ Active |
| `mid_stay` | `dream_mid_stay_check` | Day 2 of stay | ✅ Active |
| `checkout_fb` | `dream_checkout_feedback` | Day after departure | ✅ Active |
| `stage_2_arrival` | `dream_payment_and_workshops` | Arrival day | ✅ Active |
| `night_before` | `night_before_suites` (weekday) / `night_before_suites_shabbat` (Shabbat) | T-1 day | 🔴 Disabled (last known — verify live) |
| `morning_suite` | `suite_welcome_morning` (weekday) / `suite_welcome_morning_shabbat` (Shabbat) | Arrival morning | 🔴 Disabled (last known — verify live) |
| `morning_welcome` | `suite_welcome_morning` (weekday) / `suite_welcome_morning_shabbat` (Shabbat) | Arrival morning | 🔴 Disabled (last known — verify live) |

**Verify live state (Supabase SQL Editor):**
```sql
SELECT stage_key, is_active, meta_template_name, applies_to, local_time
FROM automation_stages ORDER BY sequence_order;
```

---

## 📋 Next Development Priorities

### P1 — Voice AI Phone Receptionist
**Status:** Architecture approved, zero code written.
**Blocked on 3 owner decisions:**
1. Platform: Vapi vs Retell — gated on live Hebrew STT/TTS test (NOT price/features)
2. PBX: does hotel's PBX support warm transfer to an external number?
3. Safe field list: what can `lookup_guest` return to an unauthenticated caller?

**Planned components (when unblocked):**
- New Edge Function: `voice-ai-webhook` (Twilio callbacks + tool-calls)
- New table: `voice_call_logs` (audit, same role as `whatsapp_conversations`)
- Tools: `lookup_guest`, `get_room_status`, `create_task` (→ `tasks.source='voice_call'`)
- No new whapi/group path needed — existing ops board handles task display

### P2 — CSS Variable Drift Cleanup
~150 hardcoded hex values outside the 3 documented guest-palette exceptions.
Worst offenders: `BroadcastDashboard.js` (~63), `ArrivalImportPanel.js` (~44), `AutomationControlCenter.js` (~44).
**Fix:** introduce `--error`, `--whatsapp-green` semantic aliases in `:root`.

### P3 — AutomationControlCenter Tablet Layout
`@media (max-width: 640px)` only resizes tab buttons — form/stage-card grids still overflow 768–1024px.

### P4 — Orphan Cleanup (low priority)
- Delete `Chat.js` (confirmed orphan — not imported anywhere)
- Delete `AgentChat.js` / `AgentQuestionnaire.js` after owner confirmation
- Formally retire `generate-schedule` Edge Function (no frontend caller)

---

## ✅ Completed This Cycle (Sessions 52–57)

| Session | Work |
|---|---|
| 57 | **XOS Command Center Overhaul.** (1) `automation-queue` now emits `room_type` per queue item. (2) `whatsapp-send` BRANCH D: Day Pass Safety Gate — `room_type='day_guest'` + trigger ∉ `{pre_arrival_2d, checkout_fb}` → `{ ok:false, reason:"day_pass_stage_gate" }`, logged, never silently skipped. (3) `AutomationControlCenter.js` Queue tab: inner segment tabs [🏨 סוויטות / ☀️ יום-כיף], checkbox column + Select All header, sticky action bar, `handleBulkDispatch()` loop using exact same `whatsapp-send` call as cron (300ms throttle, idempotency + gate respected server-side), `DispatchSummaryModal` (sent/skipped/blocked/failed). `npm run build` clean; both Edge Functions deployed. |
| 56 (prev) | Fully deterministic template routing: `morning_suite`/`morning_welcome` fast-path (Shabbat→`dream_welcome_morning_shabbat`, weekday→`dream_welcome_morning`), {{2}}/{{3}} removed, safety fallback. AutomationControlCenter auto-fill panel replaced with routing info panel. `whatsapp-send` deployed. |
| 52 | `RESORT_UI_MANIFEST.md` created; 7 automated repair patches: 6× Fail Visible fixes (AdminPanel, WhatsAppInbox, AutomationControlCenter, InventoryImportPanel) + 3× tablet layout fixes (RoomBoard, HousekeepingTabletView, AICopilot) |
| 53 | Real-time Meta template sync buttons added to WhatsAppInbox + BroadcastDashboard; `get-wa-templates` pagination bug fixed (templates now fetched across all pages, status filter moved server-side) |
| 54 | `voucher_numbers_match()` bugfix (migration 092) — separator stripping before truncate_4; 8 inline self-tests in migration + 5-scenario E2E test SQL (`supabase/tests/`) |
| 55 | Meta IMAGE header fix — `TEMPLATE_IMAGE_HEADERS` map in `whatsapp-send` + `whatsapp-webhook`; `dream_suite_reminder` now sends correctly |
| 56 | Master template variable sync — `morning_suite`/`morning_welcome` now inject `{{2}}`/`{{3}}` (entry/check-in times via `resolveDayTimings()`); `PORTAL_BUTTON_TRIGGERS` expanded to all 3 morning triggers; `resolveNightBeforeTimes()` Shabbat fallback (warn + default times instead of throw) |

---

## Known Open Items (Non-Sprint)

| Item | Notes |
|---|---|
| `sanitizeReply()` generic placeholder safety net | No regex catches unreplaced `{{...}}` — risk if new placeholder added to bot script without matching `resolvePlaceholders()` entry. Mitigation: add `.replace(/\{\{[^}]+\}\}/g, "")` at end of `sanitizeReply()`. |
| `log_guest_request` tool-calling | Deployed to Gemini+Claude, never tested live with real WA message |
| Whapi live test (session 22 items) | Voice transcription, guest-request routing, 👍 reaction-to-done — none tested with real phone |
| `bot_config` RLS (migration 089) | Fixed: now requires `auth.uid() IS NOT NULL`; anon access removed |
| `notification_log` race condition (migration 088) | Fixed: UNIQUE INDEX now `WHERE status IN ('sent','simulated')` only |

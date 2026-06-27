# XOS — Active Sprint Status
> Last updated: 2026-06-27 (session 56). Current goals, blockers, and next priorities.
> Full session history → `CLAUDE.md` §10 + `claude_history.md`.

---

## System Status: PRODUCTION ✅

Core WhatsApp pipeline live. `CRON_ENABLED=true`, `AUTOMATION_ENABLED=true`.
pg_cron "wa-cron" (*/15min) active. SLA escalation (*/1min) active.

---

## 🔴 Blocked — Action Required (Mike)

### 1. Meta Template Approvals
| Template | Trigger | Status |
|---|---|---|
| `dream_checkin_reminder_v2` | night_before (T-1) | PENDING |
| `dream_welcome_morning` | morning_suite + morning_welcome (arrival day) | PENDING |
| `dream_room_ready` | AICopilot room-ready handoff | PENDING |

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
| `night_before` | `dream_checkin_reminder_v2` | T-1 day | 🔴 Disabled (PENDING) |
| `morning_suite` | `dream_welcome_morning` (weekday) / `dream_welcome_morning_shabbat` (Shabbat) | Arrival morning | 🔴 Disabled (PENDING — `dream_welcome_morning_shabbat` required) |
| `morning_welcome` | `dream_welcome_morning` (weekday) / `dream_welcome_morning_shabbat` (Shabbat) | Arrival morning | 🔴 Disabled (PENDING — `dream_welcome_morning_shabbat` required) |

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

## ✅ Completed This Cycle (Sessions 52–56)

| Session | Work |
|---|---|
| 57 | Fully deterministic template routing: `morning_suite`/`morning_welcome` fast-path (Shabbat→`dream_welcome_morning_shabbat`, weekday→`dream_welcome_morning`), {{2}}/{{3}} removed, safety fallback. AutomationControlCenter auto-fill panel replaced with routing info panel. `whatsapp-send` deployed. |
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

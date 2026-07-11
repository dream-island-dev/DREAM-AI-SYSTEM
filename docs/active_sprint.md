# XOS — Active Sprint Status
> Last updated: 2026-07-11 (ETA→Requests Board + assistant-voiced digest — **deploying**).

---

## 🟡 Deploying — ETA board + Eliad assistant digest (2026-07-11)

| Piece | Detail |
|---|---|
| ETA | `arrival_time` + `guest_alerts.arrival_eta` («🕐 שעת הגעה») — board/profile only |
| Eliad digest | Personal-assistant Hebrew voice + «תזכרי ש…» learn bridge (migration 187) |

---

## ✅ Deployed — Guest bot prompt-leak + ETA miss (2026-07-11)

Symptom (Suites / Whapi Inbox): guest «מתכננת להגיע לקראת 13:00…» got a reply that quoted system rules (`"תמיד בצורה טבעית…". - Yes. * "לעולם אל תציג את`) instead of a concierge answer.

| Root cause | Fix |
|---|---|
| Whapi LLM path had a weak `_sanitizeGuestReply` (only ``` / THOUGHT) — Meta's firewall never ran | Shared `_shared/guestBotSanitize.ts` — COT strip + Hebrew prompt-regurgitation detect; empty → handoff |
| Gemini priming (`הבנת…ענה כן`) continued as a rules quiz | Stronger priming + anti-quote rule in prompt suffixes |
| ETA classifier missed `מתכננת להגיע` / `לקראת` → fell through to LLM | `ARRIVAL_TIME_UPDATE_RE` + `לקראת` in hourWord |

Deployed: `whapi-webhook` + `whatsapp-webhook`. **Mike:** הודעת ETA בסגנון «מתכננת להגיע לקראת 13:00» → תשובת Record-Only; אם LLM בכל זאת דולף → משפט הפניה לצוות (לא ציטוט כללים).

---

## ✅ Deployed — Executive voice delivery (2026-07-11)

Symptom: voice to personal assistant → reply in Inbox, nothing on WhatsApp.

| Fix | Detail |
|---|---|
| `deliverExecutiveDmReply` | Prefer `chat_id`, retry, phone fallback, FAIL VISIBLE on fail |
| Unclaimed Whapi retry | Re-run executive only if no successful outbound yet |
| Gemini timeout | 8s → 15s for tool rounds after transcription |

Deployed: `whapi-webhook`. **Mike:** send a voice note to מכשיר הסוויטות — expect reply on WhatsApp; if fail, Inbox shows `⚠ שליחה נכשלה`.

---

## ✅ Deployed — Whapi «קח שיחה» mute (2026-07-11)

Symptom: Claim/mute works on Dream Bot (Meta); Suites device (Whapi) bot keeps replying.

| Root cause | Fix |
|---|---|
| `syncInboxContactWithGuestMap` / `reconcileMessageWithGuestMap` copied Meta `guests.claimed_by` onto Whapi threads | Per-channel resolve via `guest_channel_claims` + `whapiClaimsReadyRef` |
| Claim without `guestId` created a stub; webhook muted the real guest id | Phone lookup before stub; stamp `guest_id` on local rows |
| LLM path omitted `staffMuted` on final send (defense-in-depth) | `sendGuestDmReply(..., staffMuted)` |

Deployed: `whapi-webhook` + frontend push to `main`.

---

## ✅ Deployed — Whapi Inbox timeout UX (2026-07-11)

Symptom: Inbox red error `whapi_timeout: …within 25s` on Suites (Whapi) replies; delivery may already have succeeded.

| Change | File |
|---|---|
| Timeout 25s→45s | `_shared/whapiSend.ts` |
| Hebrew «לא ודאי…למנוע כפילות» | `inboxSendErrors.js` + `WhatsAppInbox.js` |

Deployed: `whatsapp-send` + 11 Whapi consumers + frontend push.

---

## 🟢 In Progress — Hybrid unanswered-guest escalation (2026-07-11)

Problem: Inbox red-dot (`human_requested`) + HITL `pending_approval` with no reception action left guests waiting forever — SLA cron only watched `status='open'`.

| Path | Trigger | Action |
|---|---|---|
| HARD | `tasks` `pending_approval` + `guest_request` ≥7 min | auto `notify-manual-task` → ops Whapi + ping Mike/Eliad/Adir |
| SOFT | Inbox `human_requested` non-ops (spa/date/finance/handoff) ≥20 min | Meta ping Adir only — **no** ops card; `handoff_escalated_at` |

Code: `_shared/handoffEscalation.ts` (+6 tests), `sla-escalation-cron`, migration **186**. Kill switch still `SLA_ESCALATION_ENABLED=true`.

| Phase | Status |
|---|---|
| Code + tests | ✅ done |
| Cherry-pick Claude gemini-1.5 fix onto `main` | ✅ done + pushed |
| `db push` migration 186 | ✅ pushed |
| `functions deploy sla-escalation-cron` | ✅ deployed |
| Push `main` (Vercel BotSettings + docs) | ✅ pushed |
| Redeploy Claude funcs from `main` | ✅ process-knowledge / suggest-import-mapping / whatsapp-webhook / whapi-webhook |

---

## ✅ Shipped — Resort Ops Digest (2026-07-11)

Daily/weekly/monthly Hebrew ops summary to Eliad (CEO) via the Whapi Suites device — arrivals by checkin-time bucket, room-ready timing (FAIL VISIBLE ⚠ when never marked), staff requests per suite, anomaly flags (≥3 same-category requests/suite/period).

| Phase | Target | Status |
|---|---|---|
| 0 | Diagnostic — schema confirmed, `room_ready_at` gap + anomaly threshold (3) + cadence confirmed with Mike | ✅ done |
| 1 | Migration 184 — `guests.room_ready_at`, `resort_digest_log` | ✅ pushed |
| 2 | `_shared/resortDigestStats.ts` — pure aggregation, 21 tests | ✅ done |
| 3 | `resort-digest-cron` function + manual `?period=daily` verify (idempotency confirmed) | ✅ deployed |
| 4 | Migration 185 — 3 `pg_cron` schedules (daily 07:00 IL / weekly Sun 07:00 / monthly 1st 07:00) | ✅ pushed, confirmed active |

Side fix (Mike asked to "handle system health" mid-session): live testing found `room_ready_at` was never actually written anywhere — fixed 4 call sites across `suiteRoomReady.ts`/`whatsapp-send`/`whatsapp-cron` (incl. nulling it on auto-checkout so a reused guest row never inherits a stale prior-stay timestamp). Also fixed 2 unrelated pre-existing `deno check` failures (`automationSchedule.ts:1068` TS1016, `executiveAssistant.ts`+`fieldOpsTranslation.ts` TS2352) — full detail in `docs/changelog.md`.

**Smart-analytics follow-up (same day):** executive headline (✅/⚠️ one-liner), SLA compliance % from `tasks.sla_deadline` (unused until now), percentages + avg delay minutes. Live test at real volume (152 weekly arrivals) exposed a 150+ line wall-of-text problem — fixed with worst-first capped lists (`formatCappedList`, max 5/section + "+N more"). 35 tests pass. **Note:** Eliad's first 2 test messages today (daily 07-10, weekly 07-04–07-10) predate this fix — only the monthly (2026-06) test reflects the final polished format.

**Known limitations (not fixed, flagged transparently):** cron times are static UTC like every other cron here — drifts ~1h in Israel winter (no DST auto-adjust). `tasks.room_number` ("8") vs `guests.room` ("אמטיסט 8") aren't the same string format — human-readable in the digest text but not cross-matched.

---

## 🟢 In Progress — DREAM BOT Inbox Mobile UX (2026-07-11)

| Phase | Target | Status |
|---|---|---|
| 0 | Diagnostic — triple chrome, roster scroll, back-nav, FAB overlap, handoff gaps | ✅ done |
| 1 | `App.js` — collapse topbar/PulseBar on Inbox mobile (list slim, thread hidden) | ✅ deployed |
| 2 | `WhatsAppInbox.js` — compact roster header, collapsible filters, swipe threshold, FABs hide on thread | ✅ deployed |
| 3 | Android/browser back closes thread (pushState/popstate); roster scroll preserved | ✅ deployed |
| 3C | mobile-bar "💬 צ'אט" tab + unread badge | Optional — not approved, not built |
| H | webhook per-message `catch` (`whatsapp-webhook/index.ts:4555`) never replies to guest / sets `human_requested` on uncaught exception | ⚠️ Open — needs Mike's approval before touching webhook |

**Mike:** verify on a real phone (Android back gesture especially) — dev-env click-through wasn't possible (no login creds for the agent).

---

## 🟢 In Progress — Smart Spa Board: Full Ezgo Activities Sync (2026-07-11)

Goal: import the FULL daily Ezgo "פעילויות" report (not suite-only), match rows to `guests` Golden Profile, write-through `spa_date`/`spa_time`/`guest_profile.spa` so the WhatsApp bot can reference the treatment, and never silently drop an unmatched row.

| Phase | Target | Status |
|---|---|---|
| 0 | Schema — `spa_appointments` +ezgo_line_id/phone_snapshot/treatment_type, `spa_room_aliases`, `spa_import_unmatched` (migration 178) | ✅ pushed |
| 1 | Shared pure parser (`src/utils/ezgoSpaActivitiesParser.js`) | ✅ done — 25 tests |
| 2 | Upsert engine + guest write-through + `guest_profile.spa` context (`src/utils/spaActivitiesSyncEngine.js`) | ✅ done — 41 tests, external Plan-agent review (4 real bugs fixed), migration 179 pushed |
| 3 | SpaBoard Excel import UI + unmatched panel + summary toast | ✅ shipped `ce1257b` |
| 3b | Staff UX — board colors + staff notes (quick-edit on card click) | ✅ code + migration 180 |
| 4 | `spa-schedule-webhook` upgraded to shared engine, `filter=all` default | Pending |
| 5 | Bot context enrichment (`buildGuestStageContext` spa line → room/therapist/type) | Pending |

**Known blocker seeded, not fully resolved:** room alias "ג'קוזי 1" has no confirmed mapping in `spa_room_aliases` — Mike didn't know which physical room and asked not to guess. Will surface as `spa_import_unmatched` (`reason='room_unmapped'`) on first real import; resolve via SpaBoard unmatched panel once Phase 3 ships.

---

## 🟢 In Progress — Smart Spa Board: Activities auto-create day_guest + hour agenda + dual entry (2026-07-11)

Follow-up sprint on top of the Full Ezgo Activities Sync above (locked decisions confirmed with Mike: room="Premium Day 1" for auto-created day_guest, couple/group cell on one phone = one profile + `couple_shared_phone` flag, never a guessed second guest).

| Phase | Target | Status |
|---|---|---|
| 0 | Plan — engine signature/summary changes, agenda sketch, Data Sync mount point, test matrix, risks | ✅ done |
| 1 | Engine: guest auto-create (`guests_created`), `not_in_file` count, `meal_time_set` (explicit-only, never overwrites) | ✅ done — 9 orchestrator tests + 6 `extractSpaMealTime` tests, external Plan-agent review (1 real bug fixed: auto-create gate only checked phone truthiness, not phone shape — added `PLAUSIBLE_ISRAELI_PHONE_RE` guard) |
| 2 | UI: `ActivitiesImportZone` extracted to `src/components/spa/ActivitiesImportZone.js` (shared by SpaBoard + DataSyncPage); SpaBoard default view = hourly agenda, room-columns now secondary "לפי חדרים" tab; toast shows all new counts in both mount points | ✅ done |
| 3 | Verify — full suite 269/269, `npm run build` clean, docs updated | ✅ done |

**Not deployed** — local-only, awaiting Mike's `כן`/`תעלה`.

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
| P2-I | Inbox «נקרא» button + read-cursor key fix (migration 181 `inbox_channel`) | ✅ deployed `6a067e9` |

**Post-deploy QA (Mike):** run the conflict-audit SQL (CLAUDE.md session 125) for today's arrivals; send a real ❤️ reaction to a bot message → readable line in DREAM BOT שיחות. After P2-I deploy: mark unread → F5 → must stay out of «לא נקרא».

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

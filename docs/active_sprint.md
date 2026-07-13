# XOS — Active Sprint Status
> Last updated: 2026-07-13 (Survey staff preview + label editor — built, awaiting visual QA).

---

## ✅ Deployed — Guest survey preview + dynamic categories + suites CTA (2026-07-13)

| Piece | Detail |
|---|---|
| Migration 197 | Seeds `bot_config.guest_survey_ui` JSON |
| Migration 198 | `ratings` jsonb + nullable legacy cols; `suites_cta_shown` |
| Feedback → 📊 סקרים | Preview + editor: add/remove categories (1–12), suites CTA label/URL |
| Thank-you (portal) | Positive avg → CTA to dream-island.co.il/suites; low score → no suites link (+ Google CTA unchanged when positive) |
| Functions | `guest-portal-data`, `guest-portal-survey` |

**Deployed:** `db push` 197+198; `guest-portal-data` + `guest-portal-survey`; frontend `main`.

**Mike QA live:** ACC/Feedback → סקרים → עריכה/תצוגה; submit positive survey on day-pass+spa portal → suites CTA.

---

---

## ✅ Deployed — P0: Independent Suites/Day-pass channel control + survey dedupe + 1-10 scale (2026-07-13)

Follow-up to the SOS session below — Mike locked: ACC gets 2 independent cohort selectors instead of one global flag, plus a live-audit finding that the survey backend was already deployed without Mike's `כן`.

| Piece | Detail |
|---|---|
| Migration 196 | `bot_config` rows `guest_suites_channel` (whapi\|meta, default meta) + `guest_daypass_channel` (off\|whapi\|meta, default off); widens `guest_surveys`' 6 category CHECK constraints 1-5→1-10 (194 already live on remote, can't edit in place) |
| `_shared/guestWhapiRouting.ts` | `primeGuestChannelConfig()` (module-level sync cache, reuses `guestBotSettings.ts`'s cached KV fetch) wired into 7 real consumers; `shouldRouteGuestOutboundViaWhapiSuites` now cohort-aware; `isStageEffectivelyActive` hard-blocks day-pass when channel="off" even if is_active=true (real OFF, not just no-Whapi) — manual Override unaffected |
| `AutomationControlCenter.js` | 2 new dropdowns in the Pulse card (🏨 ערוץ סוויטות, ☀️ ערוץ יום-כיף), writes `bot_config` directly (admin/super_admin RLS — non-admin gets a Hebrew FAIL VISIBLE toast) |
| `automationSchedule.ts` | `checkout_fb_daypass` skipped (`superseded_by_survey`) for spa-cohort day-pass guests — they get `survey_invite_daypass` instead, no double post-visit touch |
| `guest-portal-survey` + `GuestPortal.js` | Category scale 1-5→1-10 (Mike Q1): `GOOGLE_CTA_MIN_AVG_CATEGORY` 4.0→8.0, `NEGATIVE_CATEGORY_MAX` 2→4 (both stay 80%/40% proportionally), `RatingRow` UI `max={10}` |
| **Live audit finding** | `guest_surveys`/`guest-portal-survey`/`guest-portal-data`/`resort-digest-cron` were ALREADY deployed to prod this morning (08:03 UTC) despite this doc saying "awaiting כן" — `notification_log` showed 123 failed `spa_warmup_daypass` + 4 failed `survey_invite_daypass` attempts today (is_active=false didn't block them — confirms the bug this session fixes), all failed on the Whapi SOS ban / missing Meta template, zero guests actually received anything |
| Tests | guestWhapiRouting.test.ts rewritten (29 pass), automationSchedule.test.ts +3 (46 total), 331/331 jest, `deno check` delta-clean (7 functions, verified against HEAD worktree baseline), `npm run build` clean |

**Deployed:** migration 196 `db push`; functions `automation-queue`, `guest-portal-spa-request`, `guest-portal-survey`, `whapi-webhook`, `whatsapp-cron`, `whatsapp-send`, `whatsapp-webhook` (`--no-verify-jwt`); frontend push `main`.

**Mike QA:** ACC Pulse — 2 dropdowns at defaults (Suites=DreamBot, Day-pass=Off); Day-pass Off must keep `spa_warmup`/`survey_invite` out of Live Queue even if `is_active=true`; flip Day-pass→Whapi on a test guest to re-enable; spa-cohort day-pass shows `checkout_fb_daypass` as `superseded_by_survey`.

---

## ✅ Deployed — P0: Whapi Suites device banned → SOS Meta/Dream Bot dual-path (2026-07-13)

Incident: WhatsApp restricted the Suites device (~17h, suspected automated-message/spam) and the Whapi channel itself showed `QR`/disconnected. All Suites-device Whapi traffic (guest automation + housekeeping-group observer) became unreliable or dead.

**Root cause found (see forensics below) — already fixed and deployed separately, before this SOS work started.** SOS is the emergency lever for the remaining ban window, not the root-cause fix.

| Piece | Detail |
|---|---|
| `_shared/guestWhapiRouting.ts` | New `isWhapiGuestSosActive()` reads `WHAPI_GUEST_SOS_META`. Folded directly into `isGuestWhapiSuitesEnabled()` (returns `false` when SOS active regardless of `GUEST_WHAPI_SUITES_ENABLED`) — every one of that function's ~10 callers (incl. `room_ready`, which reads it directly rather than through `shouldRouteGuestOutboundViaWhapiSuites`) falls back to Meta automatically, zero per-caller edits. `isMetaGuestTemplateAllowed()` auto-true during SOS (no need to also flip `ALLOW_META_GUEST_TEMPLATES`). New `whapiDisabledReasonHe()` gives FAIL VISIBLE Hebrew text that distinguishes "SOS active" from "feature never turned on". |
| `whatsapp-send` / `whapi-webhook` | The 3 `whapi_disabled` error sites + the Whapi-DM auto-reply "reason" code now surface SOS distinctly (`sos_active`). |
| `automation-queue` | `systemStatus.whapiGuestSosActive` exposed (same pattern as `cronEnabled`/`automationEnabled`). |
| ACC (`AutomationControlCenter.js`) | 🚨 red/orange banner in the Pulse card when SOS is active — Hebrew, explains housekeeping-group is NOT covered. |
| Tests | 14 new Deno tests (SOS × flag matrix, incl. the room_ready direct-read path and the Whapi-DM auto-reply silencing) — 23/23 pass. `deno check` delta-clean (39/66 pre-existing errors on `whatsapp-send`/`whapi-webhook` unchanged before/after — systemic esm.sh SupabaseClient version mismatch, not from this change). |
| NOT covered by SOS | Housekeeping-group observer (`N✅`/`N צ'ק אין`/`Co N`) is INBOUND on the same banned device — no Meta substitute. Stays broken until the device itself is unbanned + reconnected, regardless of this flag. |
| Cleanup | Deleted `supabase/functions/debug-whapi-diag` (temporary, self-documented for deletion after diagnosis). |

**Enable SOS (during ban):** `npx supabase secrets set WHAPI_GUEST_SOS_META=true`
**Disable SOS (ban over + device reconnected):** `npx supabase secrets unset WHAPI_GUEST_SOS_META`

**Forensics — why the ban likely happened:** queried `notification_log` on the linked prod DB. Between **05:17–08:32 UTC today**, `morning_welcome` alone fired **493 failed attempts across 40 distinct guests** (~every 15 min per guest for 3+ hours — the retry-storm pattern, not a single misbehaving guest). `morning_suite` added 131 more across 8 guests going back to 07-11. Cross-checked against deployed-function timestamps: `whatsapp-cron` (which carries the retry-storm fix, commit `46155bd`, see entry below) was last deployed **08:38:20 UTC** — i.e. the storm ran the entire window on the OLD unprotected code and stopped almost immediately once the fix rolled out. That fix is confirmed live; no further code change needed for the storm itself. A narrower follow-up (Phase C `automationClaim` wiring for `night_before`/`morning_suite`/`morning_welcome`/`room_ready`/`stage_2_arrival` — 6 dispatch blocks, not the 4 originally scoped) is intentionally deferred to a separate, calmer session — it guards a different, rarer failure mode (concurrent overlapping cron ticks) and was not the cause of tonight's ban.

**Mike QA:** enable SOS → force `room_ready` / any Override stage → guest receives via Meta Dream Bot, Inbox shows `[META]` not `[WHAPI]`, ACC Pulse shows the 🚨 banner → disable SOS after device reconnects → same test shows `[WHAPI]` again.

---

## ✅ Deployed — room_ready always Whapi when Suites flag on (2026-07-13)

Regression: after Whapi-first, «חדר מוכן» could still hit Meta `dream_room_ready1` when `guests.room` was empty/stale (AICopilot/housekeeping already had the suite `roomId`). Meta path failed → guest got no message. Housekeeping N✅ → ממתין לאישור sync was fine.

| Piece | Detail |
|---|---|
| `whatsapp-send` room_ready | `useWhapiForRoomReady = isGuestWhapiSuitesEnabled()` — Whapi + `room_ready_reminder` only; no Meta when flag on |
| ACC | `WHAPI_UNSUPPORTED_STAGES` emptied (was stale `room_ready`) |
| Inbox | Whapi threads draft `room_ready_reminder`, not Meta body |

**Deploy:** `npx supabase functions deploy whatsapp-send --no-verify-jwt` + frontend push. No migration.

**Mike QA:** N✅ בקבוצת צ'ק אין → פעמון AICopilot → אשר → אורח מקבל Whapi (מכשיר סוויטות), לא Meta.

---

## ✅ Deployed — Automation retry-storm fix: cooldown/exhausted latch + claim-before-send (2026-07-13)

Live incident: Stage 3 Shabbat morning script re-sent to «אוחיון רויטל» every ~15m by `whatsapp-cron`. Root cause + full Phase B/C design in the session plan; Mike locked **B then C**.

| Piece | Detail |
|---|---|
| Phase B — `_shared/automationRetryGate.ts` | Pure `evaluateRetryGate`: `cooldown` (30min) after 1 timeout/failed/blocked_by_meta, `exhausted` after 4, per (guest, stage_key). Wired into `checkEligibility` — the one gate `whatsapp-cron` + `automation-queue` already share, so every trigger is covered with no per-trigger duplication. Also gates the separate `stage_2_arrival` reconcile pass (event_immediate stages skip the main due-loop). |
| Phase B — ACC + admin visibility | Live Queue `retryGate` field + `⏳ בהמתנה` / `🛑 מוצה` / `🔄 בתהליך שליחה` badges (Override still sends, Disable-Don't-Hide). `notifyAdminIfDispatchFailed` now also alerts on `timeout` (was silently excluded — the reason nobody caught this sooner). |
| Phase C — migration 195 | Partial unique index on `notification_log(guest_id, trigger_type) WHERE status='processing'` — reuses the already-reserved but previously-unused `'processing'` status. |
| Phase C — `_shared/automationClaim.ts` | `claimDispatchAttempt`/`finalizeDispatchAttempt` — claim before send, one row per attempt, 5min stale-claim reclaim, `force` bypass. Wired into `whatsapp-send`'s generic BRANCH D path this session (`pre_arrival_2d`, `mid_stay(+daypass)`, `checkout_fb(+daypass)`, `spa_warmup_daypass`, `survey_invite_daypass`, `night_before_daypass`). |
| Explicit follow-up (not this session) | Same helper, wire into the remaining special-cased fast paths: `night_before`, `morning_suite`/`morning_welcome` (turns out to be 3 separate dispatch blocks — day-pass Meta fast-path, Whapi/force session block, Shabbat template block), `room_ready`, `stage_2_arrival`'s own dispatch (its reconcile-queue side is already covered). Confirmed 2026-07-13 (P0 SOS session) still missing — this is Phase B (this entry) that stopped the ban-causing storm, not Phase C; deferred as a tracked follow-up rather than rushed mid-incident, see P0 entry above for the forensic timeline proving Phase B alone was sufficient. |
| Tests | 61 new/updated Deno tests pass. `deno check` delta-clean (whatsapp-send +1 error — pre-existing loose-`guestId` typing pattern, already present twice in the same file, not a new class of issue). `npm run build` clean. |

**Deployed:** migration 195 pushed; `whatsapp-cron`, `automation-queue`, `whatsapp-send` (`--no-verify-jwt`); frontend pushed to `main` (`46155bd`).

**Mike QA after deploy:** force a Whapi timeout on a test guest → `notification_log` gets `timeout` → ACC shows `⏳ בהמתנה` within the same tick → no re-fire for 30min → after 4 attempts shows `🛑 מוצה` → manual Override still sends regardless.

---

## 🟡 Ready to deploy — Spa Board therapist sticky-room hard gate + Move Guest + יישור יום (2026-07-13)

Follow-up on migration 193's advisory roster (this round adds no migration — pure client logic + a single-row UPDATE).

| Piece | Detail |
|---|---|
| `src/utils/spaStickyRoom.js` (new, 11 jest tests) | `inferHomeRoomByTherapist` (earliest non-cancelled appt/therapist/day), `resolveHomeRoomMap` (existing `spa_shift_roster` row always wins), `planAlignDay` (roster seed-upserts + room moves). Pure — no Supabase. |
| `AssignModal` | Hard sticky gate on save: therapist has a home room ≠ selected room → Hebrew FAIL VISIBLE, blocked unless «חריג — שבץ בכל זאת» Override checkbox is ticked. Save button never hidden/disabled by this. |
| `MoveGuestModal` (new) | Primary fix path — single `UPDATE spa_appointments SET room_id=…` (+ optional therapist reassign). No RPC needed: one row can't trip the therapist-overlap exclusion mid-statement the way migration 177's two-row swap could. Defaults target room to the appointment's therapist's home room; therapist stays put unless staff opts in. |
| «🧭 יישור יום» toolbar button | Seeds missing roster rows (additive INSERT only — never deletes/overwrites a row staff already set), then attempts a room move per out-of-home appointment. 23P01/exclusion_violation per row → FAIL VISIBLE blocked list with inline «➡️ העבר אורח» retry. Never touches EZGO line ids, never cancels. |
| `SwapTherapistModal` (🔄) | Demoted — title/tooltip now read "(חריג)", point at Move Guest as the default. |
| Tests | 331/331 jest (11 new), `npm run build` clean. No migration, no Edge Functions touched. |

**Not deployed** — awaiting Mike's `כן`/`תעלה`. Frontend-only deploy (git push `main`).

**Mike QA to run:** therapist with 2+ rooms today → «יישור יום» moves what it can + lists blockers; try assigning that therapist to a different room in AssignModal without ticking Override → blocked in Hebrew; tick Override → saves; «➡️ העבר אורח» on a room-columns card moves the guest, therapist stays; couple room still allows 2 overlapping appointments; 🔄 still works as the exception path.

---

## 🟡 Ready to deploy — Guest Experience Survey (Portal) + Spa warm-up (2026-07-13)

MVP audience: day-pass + spa-that-day guests. Full plan/execute/verify in this session.

| Piece | Detail |
|---|---|
| DB | Migration 194 — `guest_surveys` table, `guests` flags, 2 `automation_stages` rows, `bot_scripts` seeds, widened `anchor_event`/`guest_feedback.source` CHECKs |
| `automationSchedule.ts` | New `anchor_event='spa_time'` (spa_date+spa_time combined instant) — `spa_warmup_daypass` = spa_time−75min; eligibility gate requires spa that day for both new stages |
| `guest-portal-survey` (new) | Score validation, positive gate (overall≥8 & avg categories≥4.0) → Google CTA, negative → `guest_feedback` mirror row |
| `GuestPortal.js` | `SurveySection` — server-gated (`guest.survey_eligible`), mounted in both DayUseView + SuiteView (no-op for suites until eligibility flag extends) |
| `WhatsAppInbox.js` | Day-pass+spa cohort split into its own "☀️ ספא יום" tab, excluded from default roster (mirrors "departed" pattern) |
| `GuestFeedbackTabs.js` | New "📊 סקרים" sub-tab, deep-link `?page=feedback_dashboard&tab=surveys` |
| `resort-digest-cron` | Optional survey stats section (additive) |
| Tests | 320/320 jest, 38/38 + 36/36 Deno (automationSchedule + resortDigestStats), `deno check` delta-clean on all touched functions, `npm run build` clean |

**Not deployed** — awaiting Mike's `כן`/`תעלה`. See QA checklist in this session's reply for what to click-test first.

---

## ✅ Deployed — Day-pass → Whapi (2026-07-12)

Cron was hammering Meta `dream_checkin_reminder_v2` for day-pass guests (e.g. חזיזה) every 15m → admin alerts. Suites already on Whapi; day-pass was excluded.

| Piece | Detail |
|---|---|
| `_shared/guestWhapiRouting.ts` | `shouldRouteGuestOutboundViaWhapiSuites` = suite **or** day-pass when flag on |
| `whatsapp-send` | Skip Meta morning day-pass fast-path when Whapi eligible |
| Tests | 11/11 Deno |

**Deployed:** `whatsapp-send`, `whatsapp-cron`, `automation-queue`, `whatsapp-webhook`, `whapi-webhook`, `guest-portal-spa-request`.

**Mike QA:** אורח יום-כיף (3540 חזיזה) — cron הבא / Override `night_before_daypass` → Whapi session, לא Meta; `msg_pre_arrival_sent=true`; אין התראת אדמין חוזרת.

---

## ✅ Deployed — dream_room_ready1 param trim (2026-07-12)

`room_ready` Meta template path no longer sends 2 body vars when Meta expects 1 (`#132000`).

| Piece | Detail |
|---|---|
| `_shared/metaTemplateVars.ts` | `resolveExpectedBodyParamCount` + `fitVarsToExpectedCount` |
| `whatsapp-send` | chokepoint in `sendViaTemplate`; `TWO_PARAM_ROOM_TEMPLATES` in `ensureTemplateBodyVars` |
| Tests | 6/6 Deno (`metaTemplateVars.test.ts`) |

**Deployed:** `whatsapp-send --no-verify-jwt` from desktop (cloud lacked token). `GUEST_WHAPI_SUITES_ENABLED` present in secrets. Suite guests → Whapi free-text; Meta trim = safety net only.

**Mike QA:** «חדר מוכן» לסוויטה → Whapi טקסט חופשי עם שם סוויטה. Meta guest מחוץ ל-24ש׳ → בלי #132000, רק שם אורח בתבנית.

**Optional product follow-up:** re-submit `dream_room_ready1` in Meta Business Manager with `{{2}}`=suite name if room must appear in template text.

---

## ✅ Ready — Doc 2 international phones (2026-07-12)

Foreign guest numbers in suite CSV / grid edit now normalize to E.164 and sync (WhatsApp can deliver). IL path unchanged. Bare local digits without country code still rejected.

| Piece | Detail |
|---|---|
| `normalizeWhatsAppPhone` | `ezgoParser.js` — `+` / `00` / bare 11–15 digit CC |
| Wire-in | `extractGuestDetails` columns + `normalizeGuestPhoneEdit` |
| Tests | 33 `ezgoParser` + ArrivalImport / guestImportIntelligence |

**Deploy:** frontend only (`npm run build` → push `main`). No migration / functions.

**Mike QA:** Doc 2 row with `+44…` or `+1…` → appears in grid → sync → automation can send.

---

## ✅ Deployed — Housekeeping WA check-out (2026-07-12)

`Co 23` / `24 co` in «צ'ק אין צ'ק אאוט» → same observer path as check-in.

| Piece | Detail |
|---|---|
| `housekeepingWaParse` | `parseHousekeepingCheckOutRoomNumbers` (prefix/suffix Co + Hebrew) |
| `housekeepingCheckOutSignal.ts` | guest `checked_out` + `room_status` לניקיון; departing today/overdue only |
| migration 192 | `housekeeping_wa_events.event_type` allows `check_out` |
| `whapi-webhook` | Wired into existing housekeeping sweep + Hebrew ack |

Deployed: `db push` (191+192), `whapi-webhook --no-verify-jwt`.

**Mike QA:** בקבוצה «צ'ק אין צ'ק אאוט» — `Co 23` או `24 co` על חדר עם אורח שעוזב היום → ack ✅ + סטטוס אורח `checked_out` + חדר לניקיון.

---

## ✅ Deployed — Tier-0 callback / human-request shared brain (2026-07-12)

Guest «אשמח שתחזרו אלי שנקבע» was getting LLM «תוכלו ליצור קשר» (inverted). Fix: shared detector + ack in `_shared/guestBotHandoff.ts`; Meta skips LLM on faq/fallback; Whapi Tier-0 before LLM. Complaint/upsell unchanged.

| Piece | Detail |
|---|---|
| `_shared/guestBotHandoff.ts` | `detectGuestHumanRequest`, `GUEST_CALLBACK_ACK_SENTENCE`, `buildGuestHumanRequestReply` |
| `whatsapp-webhook` / `whapi-webhook` | Same brain; Inbox `human_requested` type preserved (`call`/`chat`) |
| Tests | 6 Deno — incident phrase + chat + FAQ negative |

Deploy: `whatsapp-webhook`, `whapi-webhook` (`--no-verify-jwt`). No migration / no frontend.

---

## ✅ Deployed — Hebrew + deep-link Requests group cards (2026-07-12)

| Piece | Detail |
|---|---|
| `_shared/guestAlertWhapiNotify.ts` | Hebrew headlines, no HE→EN translate, Inbox + Requests Board deep links |
| `sla-escalation-cron` | Same Hebrew + URL pattern for guest_alerts SLA DMs |
| Tests | 5/5 Deno (`guestAlertWhapiNotify.test.ts`) |

Deployed: `whatsapp-webhook`, `whapi-webhook`, `inbox-route-request`, `guest-portal-upsell`, `guest-portal-spa-request`, `guest-portal-ops-request`, `sla-escalation-cron`. No migration / no frontend.

**Mike QA:** נתב בקשה מהתיבה / פורטל → קבוצת «בקשות אורחים» בעברית + לינק «שיחה» פותח Inbox אחרי לוגין.

---

## ✅ Deployed — Suite journey decoupled from Meta template approval (2026-07-12)

`automation_stages.is_active` (Meta-template-approved flag) was silently blocking Whapi-eligible suite guests too — `night_before`/`morning_suite` paused pending Meta clearance meant the Suites-device journey never fired for them either, in cron AND in ACC's Live Queue.

| Piece | Detail |
|---|---|
| `_shared/guestWhapiRouting.ts` | `isStageEffectivelyActive(stage, guest)` — paused stage still fires for Whapi-eligible suite guests; Meta guests unaffected |
| `whatsapp-cron`, `automation-queue`, `whatsapp-send` | All 3 now use the same shared gate instead of independent `is_active` filters |
| Tests | 9 new, 43/43 total pass |

Deployed: `whatsapp-send`, `whatsapp-cron`, `automation-queue`, `whapi-webhook`, `whatsapp-webhook`, `guest-portal-spa-request`, `main` (`700fbda`). No migration.

**Mike QA:** if `night_before`/`morning_suite` are `is_active=false` live, Whapi-eligible suite guests should now start receiving Stage 2.5/Stage 3 automatically — worth a spot-check on tonight's cron run or tomorrow's arrivals. Check current value: `SELECT stage_key, is_active FROM automation_stages WHERE stage_key IN ('night_before','morning_suite');`

---

## ✅ Deployed — Stage 1 Whapi arrival-confirm CTA safety net (2026-07-12)

Design Mode picked approach 1 (CTA text hotfix) over Whapi interactive buttons — Whapi's own docs flag button-send as "not stable," zero button-parse infra exists in `whapi-webhook`, and compat with the session-paired Suites device is unconfirmed.

| Piece | Detail |
|---|---|
| `_shared/arrivalConfirmation.ts` | `ensureArrivalConfirmationCta()` — defends the "כן, מגיעים!" typed-reply CTA on Whapi Stage 1 (no buttons there, unlike Meta); no-op when already present (confirmed live migration-100 seed text has it) |
| `whatsapp-send` | Wired scoped to `pre_arrival_2d` + Whapi channel only — Meta template path untouched |
| `AutomationControlCenter.js` | Bulk dispatch summary modal now separates `timeout` ("⏳ לא ודאי אם הגיעו") from real `failed` — Live Queue badge already had this, modal didn't |
| Tests | 7 new Deno tests, `deno check` delta-clean (37 pre-existing errors, unchanged), `npm run build` clean |

Deployed: `whatsapp-send`, `whapi-webhook`, `whatsapp-webhook`, `whatsapp-cron` (all 4 consume the changed `_shared/arrivalConfirmation.ts`), frontend push to `main` (`d67ecd6`). No migration needed — root-cause fix (migration 189) was already live.

**Mike QA:** תור «פספס מועד» ל-Whapi (ACC) → «📱 שגר» → אורח מקבל הודעה עם «כן, מגיעים!» → כתיבת אותו משפט חוזר → Stage 2 נשלח מיד באותו thread. הודעת «לא, שינוי בתאריך» לא אמורה לאשר. Meta ללא שינוי — כפתור «כן, מגיעים!» עדיין עובד כרגיל.

---

## ✅ Deployed — Sprint B: Inbox composer emoji picker (2026-07-12)

Goal: staff desktop has no native phone emoji keyboard — add a picker next to the Inbox reply composer.

| Piece | Detail |
|---|---|
| `src/utils/emojiPickerData.js` | Curated 40-emoji list, no new dependency |
| `WhatsAppInbox.js` | 😊 button next to ⚡ quick-replies; popup reuses the same bottom-sheet/desktop-panel pattern; `insertEmojiAtCursor` splices into the reply textarea at caret position, stays open for multiple picks |

**SECONDARY deferred:** bubble long-press → WhatsApp reaction via Meta/Whapi API. Phase-1 research found zero existing reaction-send infra (`_shared/whapiSend.ts` has no PUT reaction; Meta side has no reaction POST either) — full second feature, not a small add-on. Mike confirmed: split to its own future sprint.

Deployed: frontend `main` only — no Edge Function / migration touched.

**Mike QA (not yet click-tested by the agent — no login creds in this sandbox):** `wa_inbox` → open a thread → 😊 button next to ⚡ → panel opens → tap an emoji → lands in composer at cursor. Mobile: F12 → 390px, panel should open as a bottom sheet, no overlap with `mobile-bar`.

---

## ✅ Deployed — Stage 1 missed-window catch-up (2026-07-12)

**Problem:** Late EZGO import after T-2 → Stage 1 vanished (`date_passed`) while Stage 2 sat on «ממתין לאישור הגעה» forever (guest never got the confirm ask).

| Piece | Detail |
|---|---|
| `automationSchedule` | `pre_arrival_2d` past window + arrival ≥ today → `missed_window` (not `date_passed`); `dueNow=false` so cron does not auto-spam |
| `automation-queue` | `missed_window` visible in Live Queue |
| ACC | Badge «⚠ פספס מועד», «שלח», suite channel chip «מכשיר סוויטות», suite Send → `whapi_session` |

Deployed: `automation-queue` + frontend `main` (`57ff36d`).

**Mike QA:** מחר בתור חי — אורחי סוויטה בלי Stage 1 → שורה כתומה + סימון מרובה → «📱 שגר דרך מכשיר הסוויטות».

---

## ✅ Deployed — Sprint A: suite guests via Whapi + from_me DM mirror (2026-07-12)

Goal: suite-guest DMs never silently default to Meta, and messages sent from the physical Suites phone show up in the Inbox.

| Piece | Detail |
|---|---|
| `guest-portal-spa-request` | Now routes via `shouldRouteGuestOutboundViaWhapiSuites(guest)` through `whatsapp-send inbox_reply` (single call, inherits confirmed-fail→Meta / timeout→hard-stop). Also fixed a Zero-Data-Loss gap: the old raw-Whapi fallback never logged to the Inbox. |
| `whapi-webhook` | New `mirrorWhapiOutboundDm()` — `from_me` 1:1 messages (physical Suites phone) now log into the Inbox instead of being ignored. Phone resolved from `chat_id`, deduped on `wa_message_id`, empty-text media gets a placeholder. |
| Audit | All 13 guest-facing send call sites checked — only the spa-request portal DM'd the guest directly via Meta-first; everything else already staff/group-only. |

Deployed: `guest-portal-spa-request`, `whapi-webhook`. No db/frontend changes this round.

**Open follow-up (flagged, not built):** 1:1 reactions (both `from_me` and guest-inbound) are still dropped as `not_a_group_reaction` — no parity yet with Meta's session-128 guest-reaction chip. **Also unverified:** whether Whapi's webhook-echo `msg.id` for a from_me event equals the `wamid` returned at send time (the dedup assumption) — needs confirming on the first live device-sent test message.

**Mike — QA to run:**
1. Send a text from the physical Suites phone to a suite guest → should appear in Inbox within seconds, `[WHAPI]` tag, no duplicate.
2. Spa request from a suite guest's portal → ack arrives on the Suites number, Inbox thread shows `whapi` not `meta`.
3. Same from a day-pass guest → unchanged, still Meta.

---

## ✅ Deployed — ETA board + Eliad assistant digest (2026-07-11)

| Piece | Detail |
|---|---|
| ETA | `arrival_time` + `guest_alerts.arrival_eta` («🕐 שעת הגעה») — board/profile only |
| Eliad digest | Personal-assistant Hebrew + learn bridge (migration 187) |

Deployed: db 187, `whapi-webhook`, `whatsapp-webhook`, `resort-digest-cron`, frontend `main`.

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
| 1 | Shared pure parser (`src/utils/ezgoSpaActivitiesParser.js`) | ✅ done — Hebrew + English CSV |
| 2 | Upsert engine + guest write-through + `guest_profile.spa` context (`src/utils/spaActivitiesSyncEngine.js`) | ✅ done |
| 3 | SpaBoard Excel import UI + unmatched panel + summary toast | ✅ shipped |
| 3b | Staff UX — board colors + staff notes (quick-edit on card click) | ✅ code + migration 180 |
| 3c | English machine-CSV + couple dual-row + missing aliases (migration 191) | ✅ deployed (db 191 earlier; frontend `cacc05d`) |
| 3d | CSV בע"מ repair + Golden Profile name match + «נקה הכל» unmatched | ✅ deployed frontend `cacc05d` (2026-07-12) |
| 4 | `spa-schedule-webhook` upgraded to shared engine, `filter=all` default | Pending |
| 5 | Bot context enrichment (`buildGuestStageContext` spa line → room/therapist/type) | Pending |

**2026-07-12 fix (3c):** Ezgo English CSV (`tmStart`/`sTel`/`iAddsLineId`…) now imports. Cancelled lines skipped+counted. Couple rooms = 2 overlapping appointments (one per therapist). Aliases: `סוויטת אבניו 2/3/4`, `טרקלין -חדר זוגי`. Still unmapped by design: `ג'קוזי 1`.

**2026-07-12 fix (3d):** Real `תפעול ספא 13.7.csv` exposed three luxury-sync gaps — (1) unescaped `בע"מ` quotes made SheetJS drop ~half the rows (ZERO DATA LOSS); `repairEzgoCsvText` before parse recovers full day (~226 active / ~49 cancelled); (2) Excel serial / locale dates + numeric phones normalized; (3) `limor (לימור סולומון)` now matches Golden Profile via `group_label` / Hebrew paren person name, not Latin nickname alone; auto-create day_guest uses Hebrew display name. SpaBoard unmatched panel: «✕ נקה הכל» bulk dismiss. Validated live against Mike's 13.7 file (77 spa unit tests).

**Mike QA after deploy:** לוח ספא → אם יש באנר אדום ישן לחץ «נקה הכל» → בחר תאריך 13/07 (או השאר — הקובץ דורס מ-`dtDate`) → «📊 ייבוא דוח פעילויות» → גרור `תפעול ספא 13.7.csv` → toast עם נוצרו/מבוטלים; אורחים קיימים מקבלים `spa_date`/`spa_time`/`guest_profile.spa`; אג'נדה מציגה שני מטפלים בחדר זוגי.

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

# XOS Agent Playbook — Smart Dev Environment
> **Living document.** Mike + every Cursor agent reads this with `CLAUDE.md` and `docs/active_sprint.md`.
> Last updated: 2026-07-07 (session 130+ — playbook + UI upgrade strategy + token-efficient workflow + Advanced Prompt Engineering Rules).
>
> **When you learn something new that works** → add a bullet here + 1 line in `docs/changelog.md` + refresh `CLAUDE.md` §13 if architecture changed.

---

## 1. What This File Is

| File | Role |
|---|---|
| `CLAUDE.md` | Architecture truth, DB, Edge Functions, session history |
| `docs/active_sprint.md` | Current blockers + priorities |
| `RESORT_UI_MANIFEST.md` | UI/UX philosophy + tab readiness |
| **`docs/xos_agent_playbook.md`** | **How to work with Mike + how agents should behave** |

This playbook captures **process knowledge** that is not code — communication, phases, corrected assumptions, and copy-paste prompts.

---

## 2. Co-Pilot Model (Mike ↔ Agent)

Mike is a learning developer. The agent is **Lead Architect + executor**.

| Mike does | Agent does |
|---|---|
| Describes goal in **short English** (or one Hebrew line + English task) | Reads `CLAUDE.md`, `active_sprint.md`, this playbook **before acting** |
| Approves with `yes` / `כן` / `תעלה` / `yes deploy` | Runs `npm run build`, commit, push, db push, functions deploy |
| Gives one-line feedback | Small atomic diffs only — never full-file dumps |
| Works on **desktop** for visual tasks | Uses `npm start` + DevTools mobile emulation |

**Agent replies to Mike:** Hebrew, simple, max ~15 lines unless he asks for detail.
**Agent writes code/docs/commits:** English.
**Honesty Rule:** If context is lost, token limits are hit, or you simply don't know the answer, explicitly state "אני לא יודע" instead of hallucinating or guessing.

### 2.1 Mike Approval Loop (MANDATORY — how agent must behave)

Mike works on **desktop with `npm start` running**. He must **see** every change in the browser before approving.

**Agent MUST follow this loop — never skip steps:**

DO    → one small visual change (one phase step or one file chunk)

SAY   → Hebrew, short: what changed + exactly where to look in browser

WAIT  → do NOT start next change until Mike replies

BUILD → npm run build only before commit (not after every tiny edit)

PUSH  → only after Mike says yes deploy / תעלה — NEVER push without approval


**After each code edit, agent tells Mike:**

| Tell Mike | Example |
|---|---|
| URL | `http://localhost:3000` |
| Screen | e.g. "פתח DREAM BOT" / "תפעול ואחזקה" |
| What to look for | e.g. "ריווח בין שורות ברשימת שיחות" |
| Mobile (if touched) | "לחץ F12 → 390px width" |
| Question | **"נראה טוב? כתוב כן להמשך"** |

**Mike only needs 4 words (Hebrew or English):**

| Mike writes | Agent does |
|---|---|
| `כן` / `yes` / `המשך` / `continue` | Next small change or next phase step |
| `לא` / `fix: …` / `תקן: …` | Fix what Mike describes, then loop again |
| `עצור` / `stop` | Stop, summarize state |
| `תעלה` / `yes deploy` | commit + push (+ db/functions if needed) |

**Agent must NOT:**
- Do Phase 1 while Mike hasn't approved Phase 0 visually
- `git push` without explicit `תעלה` / `yes deploy`
- Dump long code in chat — Mike looks at **browser**, not code

**First message of session (if Mike sent kickoff prompt):**
1. Confirm `npm start` + git hash
2. Post Phase 0 diagnostic only — **no code**
3. Wait for `start phase 0` or `כן`
4. After first code edit → tell Mike where to look → **wait**

---

## 3. Token-Efficient Communication

### 3.1 Language split
- **Chat → agent:** English, short, imperative.
- **App UI in code:** Hebrew — **never change labels** unless Mike explicitly asks.
- **Agent → Mike:** Hebrew, plain language.

### 3.2 Do not repeat what's in repo docs
Use `@` references instead of re-explaining the project:

@CLAUDE.md @docs/active_sprint.md @docs/xos_agent_playbook.md
Task: [one line]
Constraints: visual only | no Hebrew label changes


### 3.3 Approval vocabulary (saves tokens)

| Mike says | Agent does |
|---|---|
| `yes` / `כן` / `תעלה` / `yes deploy` | Full deploy per checklist |
| `frontend only` | git push only (no db/functions) |
| `continue phase N` | Next UI/code phase |
| `stop` | No deploy, summarize only |

### 3.4 Standard task envelope (copy-paste)

@CLAUDE.md @docs/xos_agent_playbook.md
Scope: [file or phase]
Goal: [one line]
Constraints: [visual only | bugfix | no logic change]
Deliver: small diff + deploy checklist + offer deploy


---

## 4. Development Environment — Desktop First

### 4.1 Why desktop (not phone) for UI work
- `npm start` → instant hot reload at `http://localhost:3000`
- Phone requires `git push` → Vercel wait ~1–2 min per iteration
- Chrome DevTools device toolbar (`Ctrl+Shift+M`) simulates mobile without a physical device

### 4.2 Required viewports after any UI change
| Width | Simulates |
|---|---|
| 390px | Phone |
| 768px | Tablet / mobile-bar breakpoint |
| 1280px+ | DeX / large tablet (`App.js` has DeX media queries) |

### 4.3 Dual-surface rule (desktop Wow + mobile comfort)
**Build on desktop. Ship for both.** Every UI phase has two acceptance gates:

| Surface | Goal | How we verify |
|---|---|---|
| **Desktop** (1280px+) | Premium, spacious, scannable KPIs | DevTools wide + DeX breakpoint |
| **Mobile** (≤768px) | Thumb-safe, no overlap, keyboard OK | DevTools 390px + 768px **after each phase** |
| **Real phone** | Touch + scroll + keyboard in production | Once per phase batch on Vercel URL |

**Not optional:** Agent posts a **Mobile Checklist** (pass/fail per item) at the end of every UI phase before offering deploy.

### 4.4 Mobile comfort standards (staff)
- **Hit target:** min 44px staff / 48px comfort / 72px kiosk (cleaners) — use tokens from Phase 0.
- **Thumb zone:** primary CTAs bottom-weighted on phone where possible (Inbox send, task actions).
- **No overlap:** content `padding-bottom` clears `.mobile-bar` (~80px); floating widgets (AICopilot, alerts) above bar.
- **RTL:** badges `white-space: nowrap` or controlled wrap — no clipped Hebrew.
- **Keyboard:** reply inputs not hidden when mobile keyboard opens (Inbox `minHeight:0` pattern — preserve it).
- **Disable don't hide:** same on mobile — muted buttons with `title`, never `display:none` on actions.

### 4.5 Mobile-critical staff routes (priority order)
1. `wa_inbox` — receptionists on phone
2. `ops_board` — task claim/done on the move
3. `guests` — check-in Slot 1/2
4. `housekeeping_tablet` — cleaner kiosk
5. `App.js` shell — `mobile-bar` (5 items) + hamburger drawer + `main` padding

Guest surfaces (`/portal`, `/inv`) = **out of scope** for this pass.

### 4.6 Real phone
Use for **phase sign-off** on Vercel after push — not every color tweak during `npm start`.

### 4.7 Production URLs
- Frontend: `https://dream-ai-system.vercel.app` (auto from `main`)
- Supabase: `bunohsdggxyyzruubvcd`

---

## 5. UI Upgrade Program — "Staff Wow Effect"

Approved strategy (session 73–74). **Execute in order. Do not skip Phase 0.**

### 5.1 Design invariants (non-negotiable)
- CSS variables: `--ivory`, `--gold`, `--black`, `--card-bg`, `--border` — no new random hex.
- **Disable, Don't Hide** — buttons stay visible; use muted + `title` when invalid.
- **FAIL VISIBLE** — errors shown, not swallowed.
- Staff UX = **scannable + fast**, not heavy animation (see `RESORT_UI_MANIFEST.md` §1.2).
- **No Hebrew label/copy changes** unless Mike explicitly requests.

### 5.2 Corrected file map (common mistakes)

| Prompt said | Reality |
|---|---|
| KPI: Departments / Open Tasks / Checklist | **`Dashboard` in `App.js`** (~lines 1166–1204), `.stat-card` / `.stat-grid` |
| Same KPIs on OperationsBoard | **Wrong** — Ops board has filter chips + `TaskCard` list, not KPI grid |
| "שגר עכשיו" in Inbox | **Wrong** — it's in `AutomationControlCenter.js`; Inbox has `🚀 שלח משימה` |
| OperationsBoard "table rows" | **Wrong** — vertical `TaskCard` cards, not HTML `<table>` |
| AICopilot vs mobile-bar overlap | **Already fixed** session 52 — verify only unless regression |

### 5.3 Phase plan (desktop + mobile per phase)

| Phase | Target | Desktop | Mobile (same phase) |
|---|---|---|---|
| **0** | `App.js` `:root` + global CSS | Tokens + utility classes | `--hit-target-*`, `--safe-bottom-nav`, mobile `@media` touch rules |
| **1** | `WhatsAppInbox.js` | Roster polish, CTAs | Swipe row 48px, reply bar above keyboard, badge nowrap, `isMobile` targets |
| **2a** | `App.js` `Dashboard` | Luxury `.stat-card` | `stat-grid` 2-col at 768px, readable values |
| **2b** | `OperationsBoard.js` | TaskCard breathing room | Full-width cards, chip wrap, claim/done buttons ≥48px |
| **3** | `HousekeepingTabletView.js` | — | 72px fat-finger + jacuzzi tokens (kiosk-first) |
| **3v** | `AICopilot.js` | — | Verify `bottom:88px` ≤768px; no overlap with bar |
| **4** | `App.js` shell + `GuestsPage.js` | Sidebar/hamburger polish | `mobile-bar` tap targets, drawer width, `guests` check-in on 390px |
| **5** | Real device QA | — | Mike signs off on `dream-ai-system.vercel.app` at 390px for routes 1–5 |

**After each phase:** agent posts Desktop OK + **Mobile Checklist** (§5.7) before `continue`.

### 5.4 Optional Phase 6 (later)
- `AutomationControlCenter.js` — tablet 768–1024px overflow (known gap in manifest §3.2)
- `BroadcastDashboard.js` — hex cleanup

### 5.5 Mobile Checklist template (agent fills every phase)

Phase N — Mobile @ 390px / 768px
[ ] No horizontal scroll on primary content
[ ] Primary CTA ≥44px tap height
[ ] Bottom content not hidden under mobile-bar
[ ] Floating widgets (AICopilot) clear of mobile-bar
[ ] Hebrew badges readable, not clipped
[ ] Disabled actions still visible (muted + title)
[ ] npm run build clean


### 5.6 Out of scope for staff UI pass
- `GuestPortal.js`, `PhotoTour.js` — separate guest palette by design
- `InventoryPortal.js` — staff tool, hardcoded hex OK per manifest

### 5.7 Desktop session kickoff prompt (Mike copy-paste — FULL)

See Mike's latest message or §11 — full handoff block maintained in playbook updates.

### 5.8 Phase kickoff prompt (short)

@CLAUDE.md @RESORT_UI_MANIFEST.md @docs/xos_agent_playbook.md
@src/App.js

XOS staff UI — Phase 0 only: design tokens + utility classes in App.js.
CSS vars only. No logic. No Hebrew label changes.
Diagnostic summary of lines to touch BEFORE editing.
Then atomic diff. npm run build. Deploy checklist. Offer deploy.


---

## 6. Mandatory Agent Workflow (every code session)

1. Read `CLAUDE.md` + `docs/active_sprint.md` + this file.
2. **Plan & Chain of Thought:** For complex logic, split the task into 3 phases (Plan, Execute, Verify) and explain your reasoning step-by-step *before* writing code to avoid logic errors.
3. Read target files before editing. Base code strictly on existing examples; do not reinvent the wheel.
4. **Execute:** Atomic diffs only. Be mindful of context window limits — avoid massive single-shot refactors that cause context loss.
5. **Self-Verify:** Before presenting to Mike, verify the code against constraints (assume another AI model will review your work).
6. `npm run build` before commit when `src/` changed.
7. End with **Deploy Checklist** (only layers touched).
8. **Offer** autonomous deploy; run on `yes` / `כן` / `תעלה`.
9. Update `docs/changelog.md` (1 line) + `CLAUDE.md` header if state changed.
10. If process improved → update **this playbook** §9.

### Deploy checklist template

| Layer | When | Command |
|---|---|---|
| Frontend | `src/` or `public/` changed | `git add …` → `git commit -m "…"` → `git push origin main` |
| DB | new `supabase/migrations/*.sql` | `npx supabase db push` |
| Functions | `supabase/functions/` or `_shared/` changed | `npx supabase functions deploy <name> --no-verify-jwt` |

---

## 7. XOS Rules Agents Must Not Break

- `needs_callback` / `human_requested` = **UI alerts only** — never mute bot/cron/webhooks.
- Record-only ETA → `arrival_time` + auto-reply only — no staff alerts/tasks.
- Suite management routing → `120363429859248777@g.us` + English translation for staff cards.
- Never touch `.env`.
- Never modify Hebrew UI strings unless Mike explicitly asks.
- `.maybeSingle()` not `.single()` on Supabase reads.
- **Strict Code Constraints:** Do NOT add unrequested code comments. Do NOT rename existing functions unless explicitly instructed.

---

## 8. Prompt Templates (copy-paste for Mike)

### UI phase
@docs/xos_agent_playbook.md @src/App.js
Phase [N]: [description]. Visual only. Summary first, then code.


### Bug
@CLAUDE.md
Bug: [what] on [screen/route]
Expected: [one line]
Minimal fix. Explain your reasoning step-by-step (Chain of Thought), verify constraints, then provide code.
Deploy checklist.


### New feature
@CLAUDE.md @docs/active_sprint.md
Feature: [one line]
Check DNA principles §0. Fail visible. Offer phased plan (Plan, Execute, Verify) before big code.


### Deploy only
yes deploy


### Short reply mode
Reply: Hebrew, max 15 lines.


---

## 9. Living Document — Auto-Improve Protocol

When any session discovers a **durable lesson**, the closing agent MUST:

1. Add a dated bullet to **§10 Learnings Log** below.
2. Add 1 line to `docs/changelog.md`.
3. If it changes how agents work → update §2–§8 in this file.
4. If it changes architecture → update `CLAUDE.md`.
5. If sprint priority changed → update `docs/active_sprint.md`.

**Do not** let knowledge live only in chat — chat is lost; files persist.

---

## 10. Learnings Log

### 2026-07-07 — Session 130 (Group remark occupants import)
- **שורש:** `sync_suite_arrivals` Tier-2 (order יחיד → עדכון אורח) דרס אורח-קבוצה שני באותה הזמנה — רק האחרון נשאר ב-DB (עיריית/הערות).
- **תיקון migration 147:** Tier-2 לא מתאים כש-`name`+`phone` שונים מאורח יחיד קיים על אותה הזמנה; INSERT נפרד לכל דייר מהערות.
- **`automation_muted` one-way:** ייבוא עם `automationMuted=true` מדליק mute (INSERT+UPDATE); לא מכבה unmute ידני של צוות.
- **Frontend:** `_getSyncProfileIndices` משתמש ב-`mergedCandidates[i].guestPhone` כ-fallback.

### 2026-07-07 — Session 129 (Import enrich mode)
- **`enrichOnly` ב-RPC** — `sync_suite_arrivals` (migration 146): פרופיל קיים מקבל רק שדות ריקים; INSERT חדש במלואו. `enrichOnly=false` = התנהגות 144 (ייבוא מלא).
- **UI** — מצב Doc 2 ברירת-מחדל «השלמת פרופיל»; עמודת «הבדל מול DB» ל-⚠ (שם/חדר/תאריך); `buildEnrichGuestPatch` לספא/ארוחה אחרי RPC.

### 2026-07-06 — Session 128 (Inbox guest emoji reactions)
- **Meta `type:"reaction"` ≠ טקסט מהאורח** — webhook יוצר שורת log סינתטית; ב-Inbox חייב `intent=guest_reaction` + chip UI (לא בועה inbound לבנה).
- **Snippet lookup דורש `wa_message_id` על outbound** — רוב השורות היו `null`; `_shared/metaWamid.ts` + שמירת wamid ב-`inbox_reply`/broadcast/pipeline. הודעות ישנות: fallback ל-outbound אחרון לאותו טלפון.
- **Unread** — reactions לא נספרות ב-`countUnreadInbound` (לא בקשת מענה).

### 2026-07-05 — Session 124 (Unified Ops UI + ACC day preview)
- **Resort Pulse = client projection** — `computeResortPulse` משתמש ב-`classifyInboxRosterSegment` (אותו מקור כמו Inbox) כדי שלא יהיו מונים סותרים בין Pulse לרשימת שיחות.
- **ACC day simulator** — `automation-queue` מקבל `POST { previewAt }` ומחזיר `systemStatus.previewAt`; אותו `resolveStageSchedule` כמו cron — לא סימולציה נפרדת בפרונט.
- **Journey timeline** — `buildGuestJourneyFromFlags` (msg_* ב-guests) + `mergeQueueIntoJourney` (skipReason מ-queue) ב-`GuestContextDrawer` — שני מקורות, UI אחד.
- **Cmd+K** — `openDreamBotChat` חייב לאפשר פתיחת Inbox בלי `phone` (ניווט בלבד).

### 2026-07-05 — Session 123 (checkout_fb sent to future guest — lifecycle gate)
- **שורש:** `checkout_fb` (תבנית «השערים נסגרו…») נשען רק על `departure_date`+`day_offset` — בלי לוודא ש-`arrival_date` עבר, שהאורח צ'ק-אין, או שתאריכי שהות תקינים. פרופיל עם `departure_date` שגוי (או לפני `arrival_date`) יכול לקבל שלב 5 לפני ההגעה.
- **תיקון:** `_shared/pipelineLifecycle.ts` — `assertPipelineLifecycleForTrigger`: post-stay דורש `arrival_date ≤ היום`, `departure_date < היום`, סטטוס לא `pending`/`expected`; in-stay/morning חסומים לעתידיים; `invalid_stay_dates` כשעזיבה לפני הגעה. `checkEligibility`+`whatsapp-send` BRANCH D+cron `loadGuestByIdForPipeline` (מאפשר `checked_out` רק ל-post-stay).
- **QA:** בדוק אורח עתידי עם תאריך עזיבה שגוי ב-ACC Queue — שלב 5 צריך `skipReason=guest_not_arrived` / `invalid_stay_dates`, לא «מוכן לשליחה».

### 2026-07-05 — Session 122 (Guest delete → full system sync)
- **מחיקת אורח = hard DELETE דרך RPC בלבד** — `delete_guest_profile` (141) מבטל `scheduled_tasks` pending ואז `DELETE guests`; `GuestDashboard`/`GuestsPage` לא קוראים יותר `.delete()` ישיר.
- **Inbox stale «מחר»** — `groupByPhone`+`inboxMemoryCache` שמרו `arrivalDate` אחרי מחיקה; תיקון: `syncInboxContactWithGuestMap`+`classifyInboxContactSegment` (בלי `guestId` → `no_date`, לא «מחר»); realtime DELETE מנקה cache.
- **שליחה ללא אורח** — `guestOutboundGuard.ts`: חסום `cancelled`/`checked_out`/מחוק; `inbox_reply` דורש שורת guests פעילה; webhook Stage2+LLM auto-reply מדולגים; cron re-check לפני dispatch.
- **REPLICA IDENTITY FULL** על `guests` (142) — `payload.old.phone` ב-DELETE ל-Inbox realtime.

### 2026-07-04 — Session 109 (guest_request → Whapi ops card completeness)
- **Whapi card without suite = `guests.room` null** at intercept time — fix: `_shared/guestRoomResolve.ts` falls back to `suite_rooms` by phone + `resolveSuiteFromEzgoFields`; best-effort backfill `guests.room`. Card uses `Room אמטיסט 8 - …`, never bare `Room —`.
- **guest_request tasks had no SLA** — now `sla_category` + `sla_deadline` (15m amenities / 30m maintenance), same buckets as `whapi-webhook` staff reports; `sla-escalation-cron` picks them up.
- **Dept split:** amenities/HK → `משק`; maintenance → `תפעול` via `resolveGuestOpsDepartment()`.
- **Tier-0 + LLM dispatch** expanded: `isGuestEligibleForInHouseOpsDispatch` = checked_in OR on-property arrival day (`expected`/`room_ready`/`pending`), not only post-15:00 `checked_in`. Future-guest `guest_alerts` block skips when eligible.

### 2026-07-04 — Session 108 (Shabbat arrival hours — entry always 12:00)
- **כניסה למתחם = 12:00 תמיד** (חול + שבת). **קבלת חדרים/סוויטות** = 15:00 חול / 18:00 שבת בלבד.
- `applySaturdayCheckInTimeOverride` היה ממיר 12:00→15:00 בשבת (באג שגרם להודעת בוקר עם כניסה 15:00) — עכשיו רק 15:00→18:00 לצ׳ק-אין.
- migration 128 מתקן `bot_config.night_before_entry_time_shabbat` מ-15:00 ל-12:00 (טעות migration 126).

### 2026-07-04 — Session 102b (Stage 3 morning Shabbat routing)
- **Same rule as Stage 2.5:** autonomous `morning_suite`/`morning_welcome` → `suite_welcome_morning` / `suite_welcome_morning_shabbat` Meta templates only. No `stage_3_morning` session hijack on open 24h window. Day-pass `morning_welcome` aligned. Shabbat template failure → session script + `applySaturdayCheckInTimeOverride`, **not** weekday Meta (15:00 leak).

### 2026-07-04 — Session 102 (Stage 2.5 Shabbat routing)
- **Autonomous night_before must never hijack to session text on open 24h window.** Cron/default → `night_before_suites` / `night_before_suites_shabbat` Meta templates (times baked in). Session `bot_scripts` only on manual `force` / `force_channel=session_message`. Open window + weekday script = 12:00/15:00 leak on Saturday arrivals.

### 2026-07-04 — Session 101 (EZGO remark identity gate)
- **sRemark is NOT always the guest name.** Only when the same `sClientFullName` appears on 2+ rows in one import file (municipal/group bookings) does `aggregateGuestProfiles` set `coordNameDuplicated` and pull name+phone from remarks. Solo rows use column name + `sTel1` only — ops phrases in remarks (birthday, meal notes) must never become `guestName`.

### 2026-06-30 — Session 74b (dual-surface UI)
- **Desktop Wow + Mobile comfort:** same phase, two acceptance gates — DevTools 390/768/1280 every phase + Mobile Checklist before deploy.
- **Phase 4 added:** App.js mobile shell (`mobile-bar`, hamburger) + `GuestsPage.js` check-in on phone.
- **Phase 5:** real phone sign-off on Vercel per phase batch.

### 2026-06-30 — Session 74 (workflow + UI strategy)
- **Desktop-first for dev speed:** `npm start` + DevTools; real phone = phase sign-off on Vercel.
- **Token split:** Mike → agent in English; agent → Mike in Hebrew; UI stays Hebrew in code.
- **UI prompt corrections:** Dashboard KPIs ≠ OperationsBoard; "שגר עכשיו" ≠ Inbox; OpsBoard uses TaskCards not tables; AICopilot overlap already fixed s52.
- **Phase 0 required:** WhatsAppInbox has ~222 hardcoded hex — add App.js tokens before component polish.
- **Staff "Wow" ≠ decoration:** RESORT_UI_MANIFEST — certainty, speed, scannable badges; soft shadows OK, heavy motion not.
- **Co-Pilot deploy:** Mike approves with `yes`/`כן`/`תעלה` — agent runs full deploy, not just a command table.

### 2026-06-30 — Prior sessions (reference only)
- AI rules edit/delete in BotSettings (migration 112).
- Ops Board tasks Realtime (migration 111).
- In-room context override + burst dedup in webhook.
- Record-only ETA, receptionist RBAC, needs_callback decoupled from bot.
- See `CLAUDE.md` §10 for full history.

---

## 12. Mike Quick Card (print this — 4 commands only)

┌─────────────────────────────────────────────────────────┐
│  npm start רץ → פתח localhost:3000                      │
│                                                         │
│  הסוכן שינה משהו → אתה מסתכל בדפדפן → כותב:            │
│                                                         │
│    כן          = המשך לשלב הבא                          │
│    תקן: …      = משהו לא נראה טוב                       │
│    עצור        = תעצור                                  │
│    תעלה        = דחוף לפרודקשן (Vercel)                 │
│                                                         │
│  אחרי תעלה → בדוק בטלפון → כן / תקן: …                  │
└─────────────────────────────────────────────────────────┘


First message to agent (once per session):
@docs/xos_agent_playbook.md
npm start running. show me each change in browser before next step.
start phase 0


---

## 11. Desktop Session Kickoff — ONE MESSAGE (Mike copy-paste this entire block)

@CLAUDE.md @docs/active_sprint.md @docs/xos_agent_playbook.md @RESORT_UI_MANIFEST.md
@src/App.js @.cursorrules

XOS Co-Pilot — EXECUTE UI upgrade (Mike approval workflow)
You are the same architect as cloud sessions. Read all @ files first.

Mike's workflow (NON-NEGOTIABLE — this is how we worked before and Mike loved it)
Make ONE small visual change (or complete one clear step).

Tell Mike in Hebrew (short):

Open http://localhost:3000

Which screen/tab to click (Hebrew nav name)

Exactly what should look different

Mobile: F12 → 390px if relevant

STOP and WAIT. Do NOT make the next change until Mike replies.

Mike approves with: כן / yes / המשך

Only when a phase batch is done AND Mike is happy → ask:
"לבצע commit + push לפרודקשן?"

Push ONLY when Mike says: כן / yes / תעלה / yes deploy

Never push silently. Never skip the "where to look" step.

Mike does NOT read code. Mike looks at the browser (npm start is running).

What we planned (execute in order)
GOAL: Staff UI — desktop "Wow" + mobile comfort. Visual only.

Phase 0: App.js — design tokens + utility classes + mobile hit-target vars
Phase 1: WhatsAppInbox.js — roster, badges, CTAs (+ mobile swipe/reply bar)
Phase 2a: Dashboard KPI cards (App.js ~1166-1204) — NOT OperationsBoard
Phase 2b: OperationsBoard.js — TaskCards + filter chips (not a table)
Phase 3: HousekeepingTabletView.js 72px buttons + verify AICopilot vs mobile-bar
Phase 4: App.js mobile-bar/hamburger + GuestsPage.js on phone
Phase 5: Mike tests on phone at dream-ai-system.vercel.app after deploy

Rules: CSS variables only, Disable-Don't-Hide, no Hebrew label changes, no logic, no .env
After each phase: Mobile Checklist (playbook §5.5) + npm run build before commit

Your FIRST reply (Hebrew, max 12 lines)
Confirm git commit hash after pull

Confirm npm start assumption

Phase 0 diagnostic — list App.js lines you will touch

Ask: "להתחיל שינוי ראשון?" — wait for כן

Do NOT write code in the first reply unless Mike already said כן below.

Mike says now:
כן — התחל Phase 0. אחרי כל שינוי תראה לי בדפדפן ותחכה לאישור לפני commit/push.
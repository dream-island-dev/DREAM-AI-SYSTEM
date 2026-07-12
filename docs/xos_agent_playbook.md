# XOS Agent Playbook — Smart Dev Environment
> **Living document.** Mike + every Cursor agent reads this with `CLAUDE.md` and `docs/active_sprint.md`.
> Last updated: 2026-07-07 (session 131b — playbook + UI upgrade strategy + token-efficient workflow + Advanced Prompt Engineering Rules + external-verify/reset-on-drift + Design Mode/reuse-first/exact-match QA/no-autopilot).
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
1b. **Design Mode (new feature / architecturally unclear task only — skip for small bugfixes):** Do NOT write code yet. Present **3 distinct approaches** (not 3 variations of the same idea) with trade-offs — reuse-existing vs. new-table, sync vs. async, etc. Justify each briefly. Wait for Mike to pick one (or merge ideas) before any code is written. This is the step that catches "the agent quietly chose an architecture Mike wouldn't have picked" before it's baked into a diff.
2. **Plan & Chain of Thought:** For complex logic, split the task into 3 phases (Plan, Execute, Verify) and explain your reasoning step-by-step *before* writing code to avoid logic errors.
3. Read target files before editing. **Search for an existing function/util/`_shared/` helper first — reuse beats reinventing.** Only write a new function when nothing existing fits; do not create a near-duplicate of something that already does 90% of the job. Base code strictly on existing examples.
4. **Execute:** Atomic diffs only. Be mindful of context window limits — avoid massive single-shot refactors that cause context loss. Small focused diffs, not sprawling changes Mike can't read in one pass.
5. **Self-Verify — exact match, not "close enough":** Before presenting to Mike, re-read his original request line-by-line against what you actually built. Flag explicitly if you simplified, skipped, or substituted something because it was easier — do not silently ship the easier version and call it done.
5b. **External Verify (high-stakes only):** For risky/complex changes (migrations, payment/automation logic, RLS), do not trust self-check alone — a model grading its own work tends to say "looks good." Spawn a `Plan` agent (fresh context, no prior bias) to re-read the diff and challenge it before deploy, exactly like session 132's approval-gate design.
6. `npm run build` before commit when `src/` changed.
7. End with **Deploy Checklist** (only layers touched).
8. **Offer** autonomous deploy; run on `yes` / `כן` / `תעלה`.
9. Update `docs/changelog.md` (1 line) + `CLAUDE.md` header if state changed.
10. If process improved → update **this playbook** §9.

### 6.1 Reset-on-Drift Protocol
If the agent starts inventing unrequested changes, contradicting its own prior statements, or "fixing" things Mike didn't ask about — **stop immediately, do not try to patch it within the same context.** Tell Mike plainly ("איבדתי הקשר / נראה שאני סוטה מהמשימה — כדאי לפתוח שיחה חדשה") and let him start a fresh session. Fighting drift inside a already-confused context window compounds errors instead of fixing them.

### 6.2 QA / Edge Cases
- **Mike names the critical edge cases** for features he cares about (payment, automation gates, guest data) — the agent does not guess which ones matter most.
- The agent implements tests/checks for exactly those cases, then confirms explicitly which ones were covered — not a vague "should work now."
- **Self-review is weak on logic bugs at this codebase's size** (same reason as §6 step 5b) — a model checking its own multi-file change is prone to missing the interaction it just introduced. Treat self-review as a first pass, not the final gate, on anything touching automation/payment/RLS.

### Deploy checklist template

| Layer | When | Command |
|---|---|---|
| Frontend | `src/` or `public/` changed | `git add …` → `git commit -m "…"` → `git push origin main` |
| DB | new `supabase/migrations/*.sql` | `npx supabase db push` |
| Functions | `supabase/functions/` or `_shared/` changed | `npx supabase functions deploy <name> --no-verify-jwt` |

---

## 7. XOS Rules Agents Must Not Break

- `needs_callback` / `human_requested` = **UI alerts only** — never mute bot/cron/webhooks.
- Record-only ETA → `arrival_time` + auto-reply; also `guest_alerts.arrival_eta` for Requests Board (no ops tasks / needs_callback / red-dot).
- Suite management routing → `120363429859248777@g.us` + English translation for staff cards.
- Never touch `.env`.
- Never modify Hebrew UI strings unless Mike explicitly asks.
- `.maybeSingle()` not `.single()` on Supabase reads.
- **Strict Code Constraints:** Do NOT add unrequested code comments. Do NOT rename existing functions unless explicitly instructed.
- **No Auto-Piloting:** the agent never runs `git commit`/`git push`, `db push`, or `functions deploy` without Mike's explicit approval word (§2.1/§12) — this is absolute, not a suggestion. Local, non-mutating commands (`npm run build`, reading files, `npm test`) do not require approval. Only one phase/part of a plan is worked on at a time — finish it, show Mike, wait — never run ahead into the next part unprompted.

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

### 2026-07-12 — «בקשות אורחים» group ≠ English field-ops
- **Symptom:** Whapi guest-request pings were English ("GUEST REQUEST… Please check the Requests Board") with no way to open the chat.
- **Root:** `guestAlertWhapiNotify` reused field-ops card style + `translateTextForFieldOps` (HE→EN). That group is Hebrew reception.
- **Fix pattern:** Hebrew headlines (match RequestsBoard labels), keep stored message language, deep-link via existing `?page=wa_inbox&phone=` / `?page=requests_board`. Never HE→EN-translate staff-facing reception groups.

### 2026-07-12 — Stage 1 late-import deadlock (date_passed hide)
- **Symptom:** Tomorrow suite arrivals showed Stage 2 «ממתין לאישור הגעה» with no Stage 1 row and no Send — guests synced after T-2 never got the confirm ask.
- **Root:** `resolveStageSchedule` returned `date_passed` for past day_offset windows; `automation-queue` treated it as `PERMANENT_SKIP` and omitted the row. Stage 2 correctly waits forever with nothing to unlock it.
- **Fix pattern:** distinguish permanent past (`date_passed`, arrival already over) from catch-up (`missed_window`, arrival still today/future, `dueNow=false`); surface catch-up in Live Queue for manual/Whapi bulk. Never hide a still-actionable pipeline stage behind a permanent skip.

### 2026-07-12 — Ezgo Spa Activities: English machine CSV ≠ Hebrew UI export
- **Symptom:** Dropping the real "פעילות ספא….csv" into Spa Board would fail every row (`no_time_range` / no phone / no room).
- **Root:** Parser was built for Hebrew UI headers (`תזמון`/`פעילות`/`טלפון`). Production export is English machine CSV (`tmStart`/`sActivityDesc`/`sTel`/`iAddsLineId`). Also: `iAddsLineId` is shared by both therapists on a couple booking; blanket room GiST forbade 2 overlapping appointments in couple rooms; aliases missing `סוויטת אבניו 2/3/4` and `טרקלין -חדר זוגי`.
- **Fix pattern:** canonicalize English → Hebrew keys in the parser; `ezgo_line_id = iAddsLineId_sRowNum`; skip `iLineStatus=0` with a visible count; couple rooms = max 2 overlapping (single rooms keep hard GiST); seed aliases from the first real file, never guess (`ג'קוזי 1` still unmapped). Prefer file `dtDate` over the UI date picker when unanimous.

### 2026-07-12 — Autonomous audit found uncommitted work-in-progress first
- **Lesson:** before starting a fresh audit/fix pass, always run `git status`/`git diff --stat` first — a prior session's fully-tested, documented fix (departure-assist grounding, 22/22 tests, changelog entry already written as "not deployed") was sitting uncommitted. Verifying and shipping that is higher-value than re-auditing the same ground from scratch.
- **`.single()` audit pattern:** grep for `.single()` across webhook files is a fast, cheap first pass for the hard CLAUDE.md rule — found one real instance (`whapi-webhook` group-task insert) that PostgREST would surface as an error object (not a JS throw) on an RLS select-back gap, so it wasn't crashing visibly but was silently mislabeling a created task as a failure.
- **Sanitize-firewall parity checks by grep count are misleading** — `sanitizeGuestBotReply` grepped 0 hits in `whapi-webhook/index.ts` but is actually enforced via `generateGuestChatReply` in `_shared/guestBotLlm.ts`, which every Whapi guest-DM LLM reply routes through. Always trace the actual call chain, not just occurrence counts, before flagging a parity gap.

### 2026-07-11 — ETA on Requests Board (not Eliad push)
- **Product:** Captured ETA → `guests.arrival_time` + `guest_alerts` (`arrival_eta` / «🕐 שעת הגעה»). Profile chip synced. No ops task / needs_callback / Inbox red-dot.
- **Eliad reports:** Resort digest voiced as personal assistant; digest-relevant learned rules appended; footer invites «תזכרי ש…».

### 2026-07-11 — ETA «רשמתי לפניי» without DB write
- **Symptom:** Guest «מתכננות להגיע ב-12:00» got exact Record-Only reply; `arrival_time` stayed empty.
- **Root:** Tier-0 regex covered `מתכננת`/`מתכננים` but not feminine plural `מתכננות` or `להגיע ב-HH:MM` — LLM fell through and parroted the canned phrase. Also: `בסביבות N` needed `\s*` before digit; DATE_CHANGE used `תאריכ` and never matched final-kaf `תאריך`.
- **Fix pattern:** gender-complete forms + `להגיע ב[-–]?\d` + hourWord spaces; never trust LLM copy as proof of persist. Morning roster = GuestsPage ETA board only (no Whapi push to Eliad).

### 2026-07-11 — Whapi guest bot prompt leak (rules quiz)
- **Symptom:** Suites DM replied with quoted system rules + `Yes` instead of Hebrew concierge copy.
- **Root:** (1) Meta had `sanitizeReply`; Whapi `guestBotLlm` only checked ```/THOUGHT — Hebrew instruction regurgitation passed; (2) Gemini priming `הבנת…ענה כן` can continue as a rules quiz; (3) ETA Tier-0 missed `מתכננת להגיע`/`לקראת` so the message hit the LLM.
- **Fix pattern:** one shared `_shared/guestBotSanitize.ts` on both channels; empty/leak → handoff; never assume Meta firewall covers Whapi.

### 2026-07-11 — Executive voice: Inbox reply ≠ WhatsApp delivery
- **Symptom:** Voice note to Mike/Eliad personal assistant → answer visible in XOS Inbox, nothing on WhatsApp.
- **Root:** (1) outbound logged even when `sendWhapiText` threw; (2) slow voice+LLM → Whapi webhook retry → `claimed:false` skipped executive handler.
- **Fix pattern:** dedicated `deliverExecutiveDmReply` (chat_id first, retry, FAIL VISIBLE); on unclaimed retry re-enter executive path only if no successful outbound yet (`wa_message_id` not null).

### 2026-07-11 — Whapi «קח שיחה» mute broken by Meta claim leak
- **Symptom:** Claim mute works on Dream Bot; Suites (Whapi) bot keeps auto-replying after 🙋.
- **Root:** Inbox guest-map sync (`syncInboxContactWithGuestMap` / `reconcileMessageWithGuestMap`) always wrote `guests.claimed_by` onto every contact — Whapi badge lied (Meta ✓ / wiped Whapi claim). Separately, claim without `guestId` could INSERT a stub while `whapi-webhook` mute-checks the real guest via `resolveGuestByInboundPhone`.
- **Fix pattern:** Whapi claim UI state only from `guest_channel_claims` (ready flag so empty Map doesn't wipe); phone lookup before stub; never copy Meta `claimed_by` onto `inbox_channel=whapi`.

### 2026-07-11 — Whapi Inbox `timeout_no_response` ≠ failed send
- **Symptom:** Red Inbox error `whapi_timeout: …within 25s — message may have still been delivered` on Suites-device replies; staff tempted to resend.
- **Root:** Whapi gate sometimes exceeds the AbortSignal window after WhatsApp already accepted the message. Code correctly refuses Meta fallback on timeout (duplicate risk).
- **Fix pattern:** raise Whapi outbound timeout (45s); UI must say Hebrew «לא ודאי…בדקו לפני שליחה חוזרת», never dump English provider strings as a hard failure.

### 2026-07-11 — HITL `pending_approval` had no SLA clock
- **Symptom:** Guest room ask → red Inbox dot + Ops `pending_approval` task; reception ignores both → guest waits forever.
- **Root:** `sla-escalation-cron` only scanned `tasks.status='open'`. HITL gate never flipped → unassigned SLA never fired. Soft handoffs (`human_requested` only) had zero escalation path.
- **Fix pattern:** reuse `notify-manual-task` for auto-approve (don't duplicate Whapi card logic); split HARD (ops, 7 min, page management) vs SOFT (reception ping only, 20 min, never open field ops). Kill switch still `SLA_ESCALATION_ENABLED`.

### 2026-07-11 — CRA `npm start` OOM (Windows + Node 24)
- **Symptom:** `FATAL ERROR: invalid table size` / heap OOM ~900MB during webpack compile; `npm run build` often still OK.
- **False lead:** raising `NODE_OPTIONS=--max-old-space-size=4096` in PowerShell — on Windows the flag frequently never reaches the `react-scripts` child.
- **Fix:** put the flag on the Node that runs webpack: `node --max-old-space-size=8192 node_modules/react-scripts/bin/react-scripts.js start` in `package.json`. Optionally `.env.development` → `GENERATE_SOURCEMAP=false` to cut peak heap in dev.
- **Do not** blame feature diffs first when build is clean and only `start` OOMs.

### 2026-07-08 — Session 144b (Inbox ghost outbound — Stage 2 + fetchAll race)
- **שורש 1:** `whatsapp-send` `stage_2_arrival` fast-path שלח ל-Meta + `notification_log` אבל **לא** `whatsapp_conversations` — cron reconcile / pipeline fallback בלתי-נראה ב-Inbox.
- **שורש 2:** `intent='arrival_confirmed'` נחסם ב-CHECK עד migration 157 — Meta הצליח, INSERT נכשל בשקט (`insertGuestOutboundIfNotMuted` רק `console.error`).
- **שורש 3 (פרונט):** `fetchAll` החליף את `allMsgsRef` במקום `mergeThreadRows` — שורה שהגיעה ב-Realtime באמצע fetch נמחקה עד רענון ידני.
- **תיקון:** conv log ב-whatsapp-send; retry `intent=null` על 23514; `fetchAll` additive; Realtime INSERT → תמיד `fetchSince`; migration 160 backfill מ-`notification_log`.

### 2026-07-07 — Session 131b (Anti-laziness hygiene — Design Mode, reuse-first, exact-match QA, no-autopilot)
- **Design Mode (§6 step 1b):** new/architecturally-unclear tasks now require 3 distinct proposed approaches, no code, before Mike picks one — catches the agent silently locking in an architecture Mike wouldn't have chosen.
- **Reuse-first (§6 step 3):** explicit instruction to search existing `_shared/`/utils before writing a new function — prevents near-duplicate helpers accumulating.
- **Exact-match self-verify (§6 step 5):** re-read Mike's original request line-by-line vs. what was built; flag any place a shortcut was taken because it was easier, don't ship the easier version silently.
- **§6.2 QA:** Mike names critical edge cases explicitly (not the agent guessing); self-review treated as first pass only on automation/payment/RLS work, per the "student grading their own exam" problem.
- **§7 No Auto-Piloting:** made explicit as a hard rule (was already true in practice via §2.1 Approval Loop) — no git/db/functions commands without Mike's explicit yes; local read-only commands (build/test) don't need approval; one phase at a time, never run ahead.

### 2026-07-07 — Session 131 (Prompt-engineering hygiene — external verify + reset-on-drift)
- **Most of the "role/task/constraints/examples/verify" formula was already in §6** — no need to duplicate. Two real gaps closed: (1) self-verification bias — a model checking its own diff tends to approve it; added §6 step 5b (spawn a `Plan` agent for high-stakes changes instead of self-check only). (2) drift handling — added §6.1: when the agent starts hallucinating/touching unrequested files, stop and ask Mike to open a fresh session rather than trying to self-correct mid-drift.
- **Not added (already covered elsewhere):** role framing → CLAUDE.md's fixed architect persona + per-skill agent types; Chain-of-Thought for logic bugs → already §6 step 2; constraints/examples → already §5.1 + §6 step 3.

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
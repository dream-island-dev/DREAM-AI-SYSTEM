# XOS Agent Playbook — Smart Dev Environment
> **Living document.** Mike + every Cursor agent reads this with `CLAUDE.md` and `docs/active_sprint.md`.
> Last updated: 2026-06-30 (session 74 — playbook + UI upgrade strategy + token-efficient workflow).
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

---

## 3. Token-Efficient Communication

### 3.1 Language split
- **Chat → agent:** English, short, imperative.
- **App UI in code:** Hebrew — **never change labels** unless Mike explicitly asks.
- **Agent → Mike:** Hebrew, plain language.

### 3.2 Do not repeat what's in repo docs
Use `@` references instead of re-explaining the project:

```
@CLAUDE.md @docs/active_sprint.md @docs/xos_agent_playbook.md
Task: [one line]
Constraints: visual only | no Hebrew label changes
```

### 3.3 Approval vocabulary (saves tokens)

| Mike says | Agent does |
|---|---|
| `yes` / `כן` / `תעלה` / `yes deploy` | Full deploy per checklist |
| `frontend only` | git push only (no db/functions) |
| `continue phase N` | Next UI/code phase |
| `stop` | No deploy, summarize only |

### 3.4 Standard task envelope (copy-paste)

```
@CLAUDE.md @docs/xos_agent_playbook.md
Scope: [file or phase]
Goal: [one line]
Constraints: [visual only | bugfix | no logic change]
Deliver: small diff + deploy checklist + offer deploy
```

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

### 4.3 Real phone
Use only for **final** touch/scroll/keyboard check — not every color tweak.

### 4.4 Production URLs
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

### 5.3 Phase plan

| Phase | Target | What changes |
|---|---|---|
| **0** | `App.js` `:root` + global CSS | Semantic tokens (`--shadow-soft`, `--border-subtle`, `--status-*`, hit-target sizes) + utility classes: `.staff-kpi-card`, `.inbox-roster-row`, `.ops-task-card`, `.hk-fat-btn` |
| **1** | `WhatsAppInbox.js` | Roster spacing/borders; badge nowrap; primary CTAs (reply, שלח משימה, macros); migrate hex → vars incrementally (~222 hex today) |
| **2a** | `App.js` `Dashboard` | Luxury KPI cards on `.stat-card` |
| **2b** | `OperationsBoard.js` | Filter chips touch targets; `TaskCard` padding; unified `.badge-*` |
| **3** | `HousekeepingTabletView.js` | `minHeight` 60→72px on pipeline + jacuzzi buttons; tokenize jacuzzi colors |
| **3 verify** | `AICopilot.js` | Confirm `bottom: 88px` at ≤768px — fix only if broken |

### 5.4 Optional Phase 4 (not started)
- `GuestsPage.js` — check-in pipeline UI
- `AutomationControlCenter.js` — if "שגר עכשיו" styling needed

### 5.5 Out of scope for staff UI pass
- `GuestPortal.js`, `PhotoTour.js` — separate guest palette by design
- `InventoryPortal.js` — staff tool, hardcoded hex OK per manifest

### 5.6 Phase kickoff prompt (English — give to desktop agent)

```
@CLAUDE.md @RESORT_UI_MANIFEST.md @docs/xos_agent_playbook.md
@src/App.js

XOS staff UI — Phase 0 only: design tokens + utility classes in App.js.
CSS vars only. No logic. No Hebrew label changes.
Diagnostic summary of lines to touch BEFORE editing.
Then atomic diff. npm run build. Deploy checklist. Offer deploy.
```

---

## 6. Mandatory Agent Workflow (every code session)

1. Read `CLAUDE.md` + `docs/active_sprint.md` + this file.
2. Read target files before editing.
3. Atomic diffs only.
4. `npm run build` before commit when `src/` changed.
5. End with **Deploy Checklist** (only layers touched).
6. **Offer** autonomous deploy; run on `yes` / `כן` / `תעלה`.
7. Update `docs/changelog.md` (1 line) + `CLAUDE.md` header if state changed.
8. If process improved → update **this playbook** §9.

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

---

## 8. Prompt Templates (copy-paste for Mike)

### UI phase
```
@docs/xos_agent_playbook.md @src/App.js
Phase [N]: [description]. Visual only. Summary first, then code.
```

### Bug
```
@CLAUDE.md
Bug: [what] on [screen/route]
Expected: [one line]
Minimal fix. Deploy checklist.
```

### New feature
```
@CLAUDE.md @docs/active_sprint.md
Feature: [one line]
Check DNA principles §0. Fail visible. Offer phased plan before big code.
```

### Deploy only
```
yes deploy
```

### Short reply mode
```
Reply: Hebrew, max 15 lines.
```

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

### 2026-06-30 — Session 74 (workflow + UI strategy)
- **Desktop-first for UI:** `npm start` + DevTools beats phone iteration; phone = final QA only.
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

## 11. Current Recommended Next Action

**Start UI Phase 0** on desktop with `npm start`, unless Mike picks another priority from `docs/active_sprint.md` (Meta templates PENDING, voucher/inventory click-through).

Mike command to begin:
```
start phase 0
```

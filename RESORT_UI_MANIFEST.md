# RESORT_UI_MANIFEST.md — Dream Island AI System
> Source of truth for UI/UX design philosophy and tab readiness ahead of Go-Live.
> Companion to [`CLAUDE.md`](CLAUDE.md) (architecture/history) — this file governs **design intent**, that one governs **implementation history**. Keep both in sync: when a tab's readiness changes, update the row here too.
> Last audited: 2026-06-26 (Go-Live sanity check). **Updated same day** — 7 of the findings below were fixed in an automated repair pass; see §3 for what's resolved vs. still open, and CLAUDE.md session 52 for the file-by-file change log.

---

## 1. Design Philosophy

### 1.1 Absolute Separation: UI vs UX
UI and UX are reviewed and approved as **separate concerns**, never bundled into one "looks fine" sign-off:

| | UI (visuals) | UX (journey/architecture) |
|---|---|---|
| Concerns | Color, spacing, typography, iconography, motion | Navigation flow, information architecture, decision logic, error recovery |
| Source of truth | CSS variables in `:root` (`--gold`, `--ivory`, `--black`, `--border`, `--gold-dark` — see §11 of CLAUDE.md) | The 5 DNA principles in CLAUDE.md §0 (Zero Data Loss, Disable-Don't-Hide, Fail Visible, Universal Architecture, Single Source of Truth) |
| Who can approve in isolation | A palette/spacing tweak that doesn't touch logic | A flow change that doesn't touch color/spacing |
| Anti-pattern | Hardcoding a hex value because "it's just this one button" | Hiding a disabled action instead of explaining why it's disabled |

A feature is not "done" because it renders correctly — it is done when **both** layers pass review independently. A beautiful screen with a silent failure path is a UX defect, not a UI win. A perfectly-architected flow with hardcoded colors that drift from the brand palette is a UI defect, not a UX pass.

### 1.2 Staff UX Psychology — Certainty, Speed, Silence, Alert
The internal dashboard is a **tool for people under time pressure**, not a marketing surface. Every staff-facing screen is held to:

- **Certainty over ambiguity.** A staff member should never have to guess whether an action succeeded. State is always visible: pending / in progress / done / failed — never an unmarked void.
- **Speed over polish.** Fewer clicks, fat-finger-safe targets on tablets (housekeeping, room board), no animation that delays perceiving state.
- **Zero background noise.** No decorative motion, no idle polling spinners, no notification fatigue. If nothing needs attention, the screen says nothing.
- **Immediate visual escalation.** Color is a signal, not decoration: 🔴 red = urgent/breached SLA, 🟡 yellow/orange = in progress or approaching deadline, 🟢 green = resolved/clear. This is implemented today via `badge-red`/`badge-orange`/`badge-green` classes and the SLA-breach pulse animation on `OperationsBoard.js` — any new staff screen must reuse this vocabulary, not invent a new one.
- **Fail Visible, always.** (CLAUDE.md §0.3) An error state is itself a piece of UX, not an edge case to clean up later. "It silently did nothing" is the single worst staff-facing outcome in this system.

### 1.3 Guest UX Psychology — Effortless, Pampering, Frictionless
Guest-facing surfaces (`GuestPortal.js` + `PhotoTour.js` at `/portal/:token`, the WhatsApp concierge bot) are held to the opposite register:

- **Effortless.** No login, no app install, no form longer than necessary. The guest portal is a magic-link (`portal_token`), not a username/password flow.
- **Pampering, not transactional.** Copy is warm and human ("like a human host," per the `LUXURY_CONCIERGE_PERSONA_SUFFIX` system-prompt suffix) — never a robotic ticketing tone, never raw system internals (`{{PLACEHOLDER}}`, status codes, DB jargon) leaking into guest-visible text.
- **Frictionless escalation.** When a guest needs a human, the handoff message is warm and specific, not "an agent will contact you." Automated messages stop the instant `needs_callback=true` is set (Zero-Spam Policy, CLAUDE.md Core Business Logic §1).
- **Never show a price, always show a link.** (Standing rule — no `₪` amounts in bot copy or templates.)
- **Visually distinct palette by design.** `GuestPortal.js`/`PhotoTour.js` intentionally use a separate "XOS" palette (`#0f172a`/`#09090b`/`#D4AF37`) rather than the internal `--gold`/`--ivory` tokens — this is a deliberate UI decision (resort-brand luxury feel for guests) layered on top of a UX principle (guest experience ≠ staff tool), not a convention violation. `InventoryPortal.js` (`/inv/:token`) is the one exception that looks like a guest portal but isn't — it's a **staff** no-login tool (inventory counts from a phone) and correctly reuses internal hex values, not the guest palette.

---

## 2. Tab Directory — Readiness Checklist

Legend: ✅ Live & staff-verified · 🟡 Live but has a known gap (see §3) · 🔵 Built, not yet visually verified by a human · 📝 Planned, no code · ⚪ Orphaned (code intact, intentionally disconnected)

### Core Operations
| Tab (route id) | Component | Status | Notes |
|---|---|---|---|
| `dashboard` | `Dashboard` | ✅ | |
| `shifts` | `ShiftScheduleTab` | ✅ | |
| `checklist` | `ChecklistPage` | ✅ | |
| `employees` | `EmployeesPage` | ✅ | |
| `ops_board` / `tasks` / `calls` | `OperationsBoard` | ✅ | SLA escalation cron live, kanban Red/Yellow/Green vocabulary canonical here |
| `vip_guests` | `GuestDashboard` | ✅ | "ניהול אורחים" — pipeline view, not to be confused with `guests` |
| `broadcast` | `BroadcastDashboard` | ✅ | |
| `wa_inbox` | `WhatsAppInbox` | ✅ | "Operations Control Room" — heaviest-extended component in the app |
| `guests` | `GuestsPage` | ✅ | "צ'ק-אין" — Slot 1/Slot 2 pipeline UI |
| `room_board` | `RoomBoard` | ✅ | Manager 6-status board. Stat-row grid's tablet layout gap fixed — see §3.2 |
| `housekeeping_tablet` | `HousekeepingTabletView` | ✅ | Full-screen kiosk for `cleaner` role. Stat grid's tablet-safety gap fixed — see §3.2 |
| `requests_board` | `RequestsBoard` | ✅ | |
| `scheduler` | `ShiftGenerator` | ✅ | Local-only, no Edge Function round-trip |
| `agent` (icon 📦 "ניהול מלאי") | `InventoryHub` → Import/Links/ApprovalQueue | 🔵 | Backend + portal (`/inv/:token`) verified end-to-end live; the 3 admin sub-tabs were never click-tested by Claude (demo login blocked) |
| `spa_staging` | `SpaStagingPanel` | ✅ | Deep-link only — nav item removed deliberately (decluttering), route still live |
| `suites` | `SuitesDashboard` | ✅ | Deep-link only — same as above |

### Bot, Automation & Admin
| Tab (route id) | Component | Status | Notes |
|---|---|---|---|
| `admin` | `AdminPanel` | ✅ | Stats/chats tab silent-failure spots fixed — see §3.1 |
| `bot_config` | `BotConfigPanel` | ✅ | |
| `bot_settings` | `BotSettings` | ✅ | |
| `bot_scripts` | `BotScriptEditor` | ✅ | |
| `automation_center` | `AutomationControlCenter` | 🟡 | Meta-template fetch failure fixed (now a toast); form-grid tablet media query still incomplete — see §3.2 |
| `data_sync` | `DataSyncPage` | ✅ | Thin wrapper around `ArrivalImportPanel` |
| `portal_settings` | `PortalSettingsPanel` | ✅ | |
| `cms_security` | `CMSGate` → `CMSSecurityPanel` | ✅ | Second-factor (AAL2) gate, independent of `guardPage` |
| `voucher_reconciliation` | `VoucherReconciliationHub` → Import/ExceptionsBoard | 🔵 | Built this session-cycle, `npm run build` clean, **never clicked through by a human or by Claude** (demo login blocked in dev) — Mike must verify live before this graduates to ✅ |
| `users_mgmt` | `UserManagement` | ✅ | super_admin only |

### Guest-Facing (separate palette by design — §1.3)
| Surface | Component | Status | Notes |
|---|---|---|---|
| `/portal/:token` | `GuestPortal` + `PhotoTour` | ✅ | Pre-arrival magic-link portal |
| `/inv/:token` | `InventoryPortal` | ✅ | Staff no-login tool, NOT a guest surface despite the URL shape |
| WhatsApp bot | `whatsapp-webhook` + `bot_scripts`/`bot_settings` | 🟡 | Core pipeline live; 2 of 6 Meta templates still PENDING approval (`night_before`, `morning_suite`/`morning_welcome` auto-disabled until approved) |

### Orphaned (intentionally disconnected, not deleted)
| Item | Status | Notes |
|---|---|---|
| `Chat.js` | ⚪ | Orphan, awaiting deletion decision |
| `AgentChat.js` / `AgentQuestionnaire.js` | ⚪ | Replaced by `InventoryHub` on the `agent` route; kept intact per owner decision (session 47) |
| `generate-schedule` Edge Function | ⚪ | Deployed, never wired to any frontend caller |

### Planned, Not Built
| Item | Status | Notes |
|---|---|---|
| Voice AI Phone Receptionist (Vapi/Retell) | 📝 | Architecture approved at high level only — blocked on 3 owner decisions (platform choice gated on live Hebrew STT/TTS test, PBX call-transfer capability, safe-field allowlist for `lookup_guest`). Zero code written. |

---

## 3. Live Diagnostic Findings (2026-06-26 Go-Live Scan)

These are concrete, file-and-line findings from the pre-launch sanity scan. Treat this as a working backlog — strike through or move to CLAUDE.md history once fixed, don't let it silently go stale.

### 3.1 Missing / Weak Error States (violates Fail Visible, CLAUDE.md §0.3)
- ✅ **Fixed** `AutomationControlCenter.js` `fetchMetaTemplates` — now calls the component's existing `showToast("err", ...)` instead of `console.warn`.
- ✅ **Fixed** `WhatsAppInbox.js` template fetch effect — both calls in the `Promise.all` now check `error` and throw into a single `tmplLoadError` state, rendered as a distinct red banner instead of falling through to the generic "no approved templates" empty state.
- ✅ **Fixed** `WhatsAppInbox.js` `handleSendTemplateAudience` — added the same `failures`-array + summary-banner pattern already used by the free-text bulk-send path (`bulkFailures`); per-recipient failures (both thrown exceptions and clean `{error}`/`!data.ok` responses, which previously weren't tracked at all) now show in a `tmplBulkFailures` banner after the send completes.
- ✅ **Fixed** `AdminPanel.js` StatsTab — catch block now captures `e.message` into a dedicated `error` state and renders a red banner; the existing `!supabase` "לא מחובר" message is no longer the only possible explanation shown for a failed fetch.
- ✅ **Fixed** `AdminPanel.js` ChatsTab — `.then(({ data }))` now also destructures `error` and renders a red banner instead of silently leaving `rows` empty (which read identically to "no chats yet").
- ✅ **Fixed** `InventoryImportPanel.js` — mapping-memory save failure now calls `showToast("err", ...)` with text clarifying the current import isn't affected, instead of `console.warn`-only.

### 3.2 Tablet/Responsive Layout Risks
- ✅ **Fixed** `RoomBoard.js:416` — stat row changed from hardcoded `repeat(5, 1fr)` to `repeat(auto-fit, minmax(120px, 1fr))`. Bonus: this also fixed a desktop bug — `STATUSES` has 6 entries, so the fixed 5-column grid was already wrapping the 6th tile onto its own row even at full width.
- ✅ **Fixed** `HousekeepingTabletView.js:287` — same fix, `repeat(auto-fit, minmax(150px, 1fr))` (wider minmax to fit the bilingual HE/EN labels).
- ✅ **Fixed** `AICopilot.js` — default (undragged) anchor now bumps `bottom` from `24px` to `88px` under a `window.innerWidth <= 768` check (with a resize listener), clearing App.js's `.mobile-bar`. A user-dragged position is left untouched at any width — they already placed it deliberately.
- ⚠️ **Still open** `AutomationControlCenter.js` (~line 769) — existing `@media (max-width: 640px)` only resizes tab buttons, not the form/stage-card grid layouts underneath — those can still overflow between 768–1024px. Out of scope for the repair pass that closed the items above (explicitly deferred, not missed).

### 3.3 CSS-Variable Convention Drift (CLAUDE.md §8)
Hardcoded hex colors outside the three documented guest-palette exceptions (`GuestPortal.js`, `PhotoTour.js`, `InventoryPortal.js`):
- Worst offenders: `BroadcastDashboard.js` (~63 occurrences, including a hardcoded WhatsApp-brand green `#075E54`/`#128C7E`), `ArrivalImportPanel.js` (~44), `AutomationControlCenter.js` (~44), `AgentQuestionnaire.js` (repeated `#C0392B` red).
- Risk: not a functional bug, but a design-system erosion risk — these colors won't move if `--gold`/brand tokens are ever retuned, and they're invisible to a future "just change the palette" request.
- Suggested fix (not yet applied): introduce semantic aliases (`--error`, `--whatsapp-green`) in `:root` and point these call sites at them, rather than auditing color-by-color.

### 3.4 Console-Warning / Deprecated-Pattern Scan
Clean. No missing `key` props, no array-index keys, no deprecated lifecycle methods (`componentWillMount`, `findDOMNode`), no function-component `defaultProps` (which warns under React 19) found across the densest list-rendering components (`OperationsBoard.js`, `WhatsAppInbox.js`, `RequestsBoard.js`, `GuestsPage.js`, `GuestDashboard.js`).

---

## 4. How to Keep This Manifest Honest
- Update the readiness table the same session a tab's status actually changes — not retroactively.
- A tab only earns ✅ after a **human** (Mike, or staff) has clicked through it live — Claude verifying `npm run build` is clean is necessary, not sufficient (see `voucher_reconciliation` and the `agent` admin sub-tabs, both 🔵 for exactly this reason).
- When a §3 finding is fixed, move it out of "Live Diagnostic Findings" into CLAUDE.md's session history (that file owns the historical narrative; this file owns current state).

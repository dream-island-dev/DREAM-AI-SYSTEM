# XOS — Dream Island AI System: Architecture Reference
> **Condensed technical English.** Source of truth for AI context. Full historical narrative: `CLAUDE.md` (root).
> Last synced: 2026-06-27 (session 56).

---

## Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Frontend | React 19, CRA (react-scripts 5) | Hebrew RTL SPA, no router — pages via `useState` in `App.js` |
| Styling | CSS-in-JS (App.js template string) | Tokens: `--gold`, `--black`, `--ivory`, `--border`, `--gold-dark` |
| Backend | Supabase Edge Functions (Deno/TypeScript) | 8+ functions deployed; project ref `bunohsdggxyyzruubvcd` |
| Database | Supabase PostgreSQL 15 + RLS | Row Level Security on every table |
| AI Primary | Gemini 2.0 Flash / 2.5 Flash | `GEMINI_API_KEY` in Supabase Secrets |
| AI Fallback | Claude Sonnet 4.6 | `ANTHROPIC_API_KEY` in Supabase Secrets (restricted — limited model names return 404) |
| WhatsApp Staff | Whapi.cloud | Group messaging (Meta Cloud API does not support groups) |
| WhatsApp Guest | Meta Cloud API | `META_WHATSAPP_TOKEN` rotates ~60 days |
| Auth | Google OAuth → Supabase Auth JWT | MFA (TOTP/AAL2) for CMS routes via CMSGate |
| Push | Web Push VAPID | `VAPID_PRIVATE_KEY` in Supabase Secrets ONLY |
| Hosting | Vercel | Auto-deploy from GitHub `main` |
| Font | Heebo (Hebrew body) + Playfair Display (titles) | |

**Live URL:** `https://dream-ai-system.vercel.app`
**Supabase region:** eu-central-1 (Frankfurt)

---

## Integrations

| Service | Purpose | Secret |
|---|---|---|
| Meta Cloud API | Guest WhatsApp (templates + webhook) | `META_WHATSAPP_TOKEN`, `META_PHONE_NUMBER_ID` |
| Whapi.cloud | Staff group WhatsApp (ops cards, reactions) | `WHAPI_TOKEN`, `WHAPI_GROUP_ID` |
| Google STT | Voice transcription (whapi-webhook voice messages) | via `GEMINI_API_KEY` (Gemini multimodal, not Google STT) |
| pg_cron | Scheduled automation jobs | Managed via Supabase SQL |

---

## Core Routing (App.js — no React Router)

`useState activePage` → component swap via switch statement.
Public routes checked in `index.js` BEFORE App renders:
- `/portal/:token` → `<GuestPortal token>` (guest magic-link portal)
- `/inv/:token` → `<InventoryPortal token>` (staff no-login inventory)

---

## AI Routing Logic

```
WhatsApp button tap  → HARDCODED routing in Edge Function ONLY → NEVER to LLM
Free-text message    → intent classification → Gemini (+ system prompt from bot_settings)
All pipeline sends   → sendViaTemplate() always — even within 24h window (conservative)
inbox_reply          → checks wa_window_expires_at BEFORE calling Meta
```

**AI engines (whatsapp-webhook):**
- Gemini 2.0 Flash (primary, webhook concierge)
- Claude Sonnet 4.6 (fallback, auto-failover logged to `ai_failover_events`)

---

## Role Model

| Role | Access |
|---|---|
| `super_admin` | `tzalamnadlan@gmail.com` — full system, UserManagement |
| `admin` | `promote7il@gmail.com` — AdminPanel, BotConfig, BotSettings |
| `manager` | Dept management, ops board, no admin panels |
| `receptionist` | Standard staff access |
| `cleaner` | `HousekeepingTabletView` only; RLS blocks all other tables (migration 087) |

---

## Edge Functions (all deployed with `--no-verify-jwt`)

| Function | Purpose | Auth |
|---|---|---|
| `whatsapp-webhook` | Inbound WA + AI concierge, button routing | no-verify-jwt |
| `whatsapp-send` | Outbound WA templated sends (pipeline + broadcast) | no-verify-jwt |
| `whatsapp-cron` | pg_cron */15min automation pipeline | no-verify-jwt |
| `whapi-webhook` | Inbound staff group messages (Whapi.cloud) + voice transcription | no-verify-jwt |
| `task-action` | Accept/Complete/Bump task callbacks (token-auth) | no-verify-jwt |
| `sla-escalation-cron` | pg_cron */1min SLA breach alerts (ops + guest) | no-verify-jwt |
| `suggest-replies` | On-demand AI inbox suggestions (Gemini→Claude) | no-verify-jwt |
| `suggest-import-mapping` | Column mapping AI for CSV/Excel (Gemini→Claude) | no-verify-jwt |
| `reconcile-vouchers` | Voucher reconciliation engine — requires Bearer JWT | user JWT |
| `guest-portal-data` | Public guest portal data (service-role, safe fields) | no-verify-jwt |
| `guest-portal-upsell` | Guest upsell → `guest_alerts` | no-verify-jwt |
| `guest-portal-ops-request` | Guest room service → `tasks` | no-verify-jwt |
| `inventory-portal-data` | Inventory portal data (token + is_active) | no-verify-jwt |
| `inventory-portal-submit` | Inventory count submission | no-verify-jwt |
| `automation-queue` | Read-only queue projection | no-verify-jwt |
| `automation-history` | Read-only send history | no-verify-jwt |
| `push-notify` | Web Push VAPID | no-verify-jwt |
| `chat` | Manager AI chat (Gemini→Claude) | user JWT |
| `generate-agent-profile` | AI agent profile generation | user JWT |
| `process-knowledge` | Document → `agent_memory` ingestion (Gemini multimodal) | user JWT |
| `notify-manual-task` | ⚠️ ORPHAN — `generate-schedule` caller disconnected | — |

---

## Key DB Tables

| Table | Purpose | Phone format |
|---|---|---|
| `guests` | Golden Profile — single source of truth for guest state | `+972XXXXXXXXX` (E.164) |
| `bookings` | EZGO import records | `972XXXXXXXXX` (no +) |
| `whatsapp_conversations` | WA inbox thread state | `+972XXXXXXXXX` |
| `tasks` | Ops board (status: open/in_progress/done) | — |
| `automation_stages` | Single source for WA pipeline timing + content | — |
| `notification_log` | Send dedup (UNIQUE on guest+trigger WHERE sent/simulated) | — |
| `room_status` | Housekeeping pipeline (6 statuses, separate from guests.status) | — |
| `bot_config` | Bot key-value config (5-min module cache) | — |
| `bot_settings` | AI system_prompt + preferred_model (row id=1) | — |
| `bot_scripts` | Per-trigger message scripts (editable via BotScriptEditor) | — |
| `voucher_providers` | Voucher provider registry + match_mode (exact/truncate_4) | — |
| `voucher_reconciliation_results` | Reconciliation results — NO DELETE policy (financial data) | — |
| `inventory_items` | Inventory catalog per location | — |
| `guest_alerts` | Bot-generated alerts for staff review | — |

**Phone format rule (CRITICAL):**
- `guests.phone` = `"+972XXXXXXXXX"` — always with `+`
- `bookings.phone` = `"972XXXXXXXXX"` — always WITHOUT `+`
- Meta webhook `from` = `"972XXXXXXXXX"` — webhook adds `+` before guests lookup

---

## Component Map (src/components/)

| Component | Route | Notes |
|---|---|---|
| `WhatsAppInbox.js` | `wa_inbox` | "Operations Control Room" — heaviest component |
| `OperationsBoard.js` | `ops_board` / `tasks` | Tasks kanban + SLA pulse |
| `GuestDashboard.js` | `vip_guests` | Pipeline tactical view |
| `GuestsPage.js` | `guests` | Check-in Slot1/Slot2 UI |
| `AutomationControlCenter.js` | `automation_center` | 5 sub-tabs: Timeline/Queue/History/Templates/Builder |
| `BroadcastDashboard.js` | `broadcast` | WA template broadcasts |
| `RoomBoard.js` | `room_board` | 6-status housekeeping manager view |
| `HousekeepingTabletView.js` | `housekeeping_tablet` | Cleaner kiosk, bilingual HE/EN |
| `AICopilot.js` | (global widget) | Room-ready approval floating bell |
| `InventoryHub.js` | `agent` (📦) | Import / Links / ApprovalQueue sub-tabs |
| `VoucherReconciliationHub.js` | `voucher_reconciliation` | Import + ExceptionsBoard sub-tabs |
| `GuestPortal.js` | `/portal/:token` | Public magic-link portal (XOS palette) |
| `InventoryPortal.js` | `/inv/:token` | Staff no-login inventory (internal palette) |
| `CMSGate.js` | wraps `cms_security` | AAL2 (TOTP) second factor gate |
| `ArrivalImportPanel.js` | within `ops_board` + `data_sync` | Sole import surface in the app |

**Orphaned (not deleted, intentionally disconnected):**
- `Chat.js` — awaiting deletion decision
- `AgentChat.js` / `AgentQuestionnaire.js` — replaced by InventoryHub
- `generate-schedule` Edge Function — deployed, no frontend caller

---

## Security Red Lines

```
❌ ANTHROPIC_API_KEY → NEVER in REACT_APP_* variables
❌ VAPID_PRIVATE_KEY → NEVER in frontend or git
❌ META tokens       → NEVER in chat messages or git; rotate immediately if exposed
❌ .single()         → NEVER use — always .maybeSingle() (throws on null)
❌ fetch() raw       → NEVER to Edge Functions — use supabase.functions.invoke() only
❌ RLS changes       → always verify existing access not broken before applying
✅ Webhook POST auth → Meta: X-Hub-Signature-256 + META_APP_SECRET; Whapi: X-Whapi-Secret + WHAPI_WEBHOOK_SECRET (configure header via Whapi PATCH /settings)
```

**Always:** HTTP 200 from every Edge Function — errors in `{ ok: false, error: "..." }` body.

---

## Build & Deploy

```bash
npm run build                                              # must output "Compiled successfully."
npx supabase functions deploy NAME --no-verify-jwt        # deploy single function
npx supabase db push                                      # apply pending migrations
```

**Migrations:** `supabase/migrations/001–092_*.sql` all applied ✅
**Next migration number:** 093

---

## DNA Principles (non-negotiable, from CLAUDE.md §0)

1. **Zero Data Loss** — no row silently dropped; failed rows shown with reason
2. **Disable, Don't Hide** — buttons always visible; disabled with `title` explaining why
3. **Fail Visible** — unknown DB values shown as ⚠, never silently mapped to a default
4. **Universal Architecture** — EditableGrid wraps all tabular data; no per-feature table
5. **Single Source of Truth** — `guests` table is the golden profile; no parallel status tables

> A feature that violates any of these is **incomplete**, even if `npm run build` passes.

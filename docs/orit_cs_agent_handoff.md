# Orit CS Agent — Handoff for Claude Code

## Goal
Make **👑 סוכן שירות לקוחות** (`OritCustomerServicePanel.js`) show live emails for Orit. OAuth to M365 is **DONE**. Backend has data. UI still shows «תיבת הסוכן לא נמצאה» for Mike.

## Ground truth (verified 2026-07-15)
- **Supabase project:** `bunohsdggxyyzruubvcd`
- **Mailbox:** 1 row `a89bd84c-85e5-4791-a21a-b5bcb8619549`
  - `owner_email`: `orit@dream-island.co.il`
  - `email_address`: `orit@triobcom.onmicrosoft.com`
  - `connection_status`: `active`, OAuth token present
- **Threads:** 3 live (`is_demo=false`) already in `orit_agent_threads`
- **Secrets set:** `MICROSOFT_*`, `MANAGER_MAIL_ENABLED=true`, `ORIT_MAIL_SETUP_KEY`
- **Forward:** local `dream-island.co.il` → M365 (Avi)

## Architecture
```
Guest email → dream-island.co.il → Forward → orit@triobcom.onmicrosoft.com
  → Graph API (manager-mail-sync cron every 10m) → XOS UI
```

## Key files
| File | Role |
|------|------|
| `src/components/OritCustomerServicePanel.js` | UI — should call `orit-cs-bootstrap` |
| `supabase/functions/orit-cs-bootstrap/index.ts` | Service-role loader (mailbox + threads) |
| `supabase/functions/manager-mail-sync/index.ts` | Graph ingest |
| `supabase/functions/manager-mail-oauth/index.ts` | OAuth + one-click `?key=orit-dream-365-connect` |
| `supabase/migrations/208-211` | Graph provider, merge dup mailboxes, RLS, RPC |

## Likely root cause
1. **Vercel serving stale bundle** — user sees old error text without `orit-cs-bootstrap` path
2. **RLS** blocked direct `orit_agent_mailbox` SELECT from browser (fixed via bootstrap but frontend may not be live)
3. **Race:** `loadThreads()` via RLS cleared threads after bootstrap (fixed in latest commit — verify deployed)

## Acceptance criteria
1. Login as `tzalamnadlan@gmail.com` or `mikeka13@gmail.com` or `orit@dream.io`
2. Open `orit_cs_agent` — see **✅ תיבת מייל מסונכרנת** + ≥1 real thread
3. «סנכרן עכשיו» returns synced count
4. No «תיבת הסוכן לא נמצאה»

## Debug steps
```bash
npx supabase db query --linked -o json "SELECT id, connection_status, email_address FROM orit_agent_mailbox;"
npx supabase functions deploy orit-cs-bootstrap --no-verify-jwt
npm run build && git push origin main
```
In browser DevTools → Network: confirm call to `/functions/v1/orit-cs-bootstrap` returns `{ok:true, mailbox, threads}`.

## OAuth link (already used successfully)
`https://bunohsdggxyyzruubvcd.supabase.co/functions/v1/manager-mail-oauth?key=orit-dream-365-connect`

## Do NOT redo
- Azure redirect URI, Admin consent, Forward — all done
- Do not create second mailbox row

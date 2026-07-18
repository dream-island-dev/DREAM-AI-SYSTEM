# Claude Code — Independent QA Audit Prompt
## Guest Bot Reliability Sprint (2026-07-18)

Copy everything below the line into Claude Code **before deploy**.

---

```
@CLAUDE.md @docs/xos_agent_playbook.md

Role: Independent Senior QA & Code Reviewer for XOS (Dream Island).
Task: Full pre-deploy audit of the **Guest Bot Reliability Sprint** — uncommitted branch changes on `main` (not yet pushed).

## Production incidents this sprint fixes (7)

| # | Issue | Expected fix |
|---|--------|--------------|
| 1 | Whapi prompt leak + premature facility review on incomplete praise (e.g. ", הבריכה") | `guestBotSanitize` leak patterns; `guestFacilityReview` incomplete guard; Whapi tier-0 order = facility → reflection (Meta parity) |
| 2 | Housekeeping `ציק אין` not recognized | `housekeepingWaParse` normalizes `ציק`→`צק` (TS + JS mirror) |
| 3 | Missing `checked_out` in AddGuestModal | New status option + `checked_out_at` / `room_ready_*` reset on save |
| 4 | Survey card red when overall=3 but spa=1 | `GuestFeedbackTabs` — green badge from overall; orange border + category warning chip |
| 5 | Ice request — bot says forwarded but no ops task | `קרח`/`ice` in amenity allowlist; `createGuestOpsTaskWithInstantAmenityDispatch` → `notify-manual-task` (amenities only, NOT maintenance/cleaning HITL) |
| 6 | Dining reply truncated mid-sentence (`ובין`) | `isReplyObviouslyTruncated` + `resolveTruncatedReplyFallback` + dining Tier-0 |
| 7 | Meal-cancel reply truncated mid-word (`שתצטר`) | Same truncation guard + `isMealDeclineOrApology` Tier-0 |

## Files changed (review ALL)

**New:**
- `supabase/functions/_shared/guestReflection.ts`

**Edge / shared:**
- `supabase/functions/_shared/automationSchedule.ts` (+ `.test.ts`)
- `supabase/functions/_shared/createGuestOpsTask.ts`
- `supabase/functions/_shared/guestBotLlm.ts`
- `supabase/functions/_shared/guestBotSanitize.ts` (+ `.test.ts`)
- `supabase/functions/_shared/guestFacilityReview.ts` (+ `.test.ts`)
- `supabase/functions/_shared/housekeepingWaParse.ts`
- `supabase/functions/whapi-webhook/index.ts`
- `supabase/functions/whatsapp-webhook/index.ts`

**Frontend:**
- `src/components/AddGuestModal.js`
- `src/components/GuestFeedbackTabs.js`
- `src/utils/checkInPolicyFaq.js` (+ `.test.js`) — mirror of truncation/dining helpers
- `src/utils/guestSurveyUi.js` (+ `.test.js`)
- `src/utils/housekeepingWaParse.js` (+ `.test.js`)
- `src/utils/opsRequestIsolation.test.js`

**Docs:** `CLAUDE.md`, `docs/changelog.md`

Run: `git diff` on the above paths (include untracked `guestReflection.ts`).

## Architecture decisions to validate

1. **Instant dispatch scope:** Only `isInstantAmenityOpsDispatch()` (ice, towels, water…) auto-calls `notify-manual-task`. Maintenance/cleaning MUST stay `pending_approval` HITL.
2. **Truncation fallback priority:** `resolveTruncatedReplyFallback` — **guest intent first** (dining question → `buildDiningReply`) before reply-shape heuristics, because dining truncations share "ימי חול / שבתות וחגים" tokens with check-in copy.
3. **Whapi/Meta parity:** Tier-0 order on Whapi DM path: dining → meal-decline → **facility review → reflection** (not reflection before facility).
4. **Silence Rule:** `needs_callback` / `human_requested` must NOT block tier-0, cron, or instant amenity dispatch.
5. **Record-Only ETA:** unchanged — no ops tasks from arrival time.
6. **Survey gate unchanged:** `SURVEY_POSITIVE_OVERALL_MIN = 2` — UI-only fix for badge color, not backend club logic.
7. **No duplicate helpers:** `guestReflection.ts` extracted once; mirrors in `checkInPolicyFaq.js` stay in sync with `automationSchedule.ts`.

## Tests to run (report pass/fail)

```bash
# Sprint Jest (must pass)
npm test -- --testPathPattern="checkInPolicyFaq|opsRequestIsolation|housekeepingWaParse|guestSurveyUi" --watchAll=false

# Deno shared (sprint tests must pass)
cd supabase/functions/_shared
deno test --no-check --allow-env automationSchedule.test.ts guestFacilityReview.test.ts guestBotSanitize.test.ts

# Frontend build
npm run build
```

**Known pre-existing failures (NOT introduced by this sprint — note but do not block on):**
- Jest: `spaActivitiesSyncEngine.test.js` — `supabase.rpc is not a function` (mock gap)
- Deno: `resolveEffectiveGuestStatus: departure-day auto checkout still fires at 11:00` — behavior/test drift pre-dating sprint

## Manual QA checklist (code-review equivalent)

- [ ] Whapi: incomplete facility praise `, הבריכה` does NOT log `guest_feedback` or short-circuit to reflection
- [ ] Whapi: `אפשר עוד קרח` creates task AND invokes `notify-manual-task` without waiting for Ops Board approval
- [ ] Whapi: `יש תקלה במזגן` still creates `pending_approval` only (no instant dispatch)
- [ ] Meta + Whapi: dining question gets full `buildDiningReply` via Tier-0 OR truncation fallback
- [ ] Meta + Whapi: truncated dining reply with guest dining intent does NOT return check-in policy copy
- [ ] Housekeeping group: `4 ציק אין` and `4,5\nציק אין` parse as check-in rooms
- [ ] AddGuestModal: `checked_out` sets `checked_out_at` and clears `room_ready_*`
- [ ] GuestFeedbackTabs: overall=3 + spa=1 → green overall badge + orange warning, NOT all-red card
- [ ] `guestBotLlm.ts`: `llmTruncated` flag triggers engine failover before sanitize/send
- [ ] No `.single()` introduced on Supabase reads in changed files

## Output format (strict)

### P0 flaws
For each flaw: `file:line` — one-line description — suggested fix.

If none: reply exactly **`PASSED QA`**.

### Non-blocking notes
Optional improvements (P1/P2) — max 5 bullets.

Do NOT propose unrelated refactors. Do NOT suggest deploy commands unless PASSED QA.
```

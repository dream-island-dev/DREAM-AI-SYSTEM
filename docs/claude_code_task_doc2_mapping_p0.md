# P0 — Claude Code Task: Doc 2 Import Broken (Mapping Approve Disabled)

> **Owner handoff from Cursor session 2026-07-16.** Mike reports: Doc 2 upload still slow, stuck on «אשר מיפוי והמשך» (button greyed / unusable). Used to load in ~1 second with no AI.

## Symptom (Mike)

- Upload **Doc 2 — כניסות אורחים** (`ArrivalImportPanel.js`)
- Sees mapping review screen (sometimes Claude/Gemini message)
- **Cannot click** «✓ אשר מיפוי והמשך» — button disabled (`canApprove === false`)
- Cannot create guest profiles from import grid → `sync_suite_arrivals` never reached

## Expected behavior (ground truth)

**Standard EZGO Suites CSV** with columns `iOrderId`, `sTel1`, `sRemark`, `sClientFullName`, `sSubItemName`, `sRoomName`, `iResLineId`:

1. `detectEzgoArrivalsPreset()` in `src/utils/importMapper.js` — **no AI, no review screen**
2. `aggregateGuestProfiles()` → editable grid immediately
3. Staff clicks **סנכרן** → `sync_suite_arrivals` RPC

Review + `suggest-import-mapping` Edge Function is **only** for unknown header shapes.

## Root causes already identified (partial fixes on main)

| Issue | Fix attempted | Commit |
|---|---|---|
| Mapping review buried under paste textareas | Moved panel under Doc 2 dropzone | `cda94df` |
| Preset not auto-applied; AI gate added | Auto-apply preset/memory | `b77a102` |
| Stale `import_mapping_memory` blocked preset | Preset before DB; `isMappingUsable()` | `9603cae` |
| Excel BOM/spaces on headers | `normalizeImportRows` | `b77a102` |
| `useEffect` reset manual mapping edits | Removed from MappingReviewPanel | `b77a102` |
| Header row not row 0 in Excel | `matrixRowsFromHeaderScan()` | **pending deploy this session** |

**Mike still broken after `9603cae`** → likely one of:

1. **File header shape not matching preset** (need Mike's first header row)
2. **Excel title rows** before real headers (fix in progress)
3. **AI mapping missing hard fields** `orderNumber` + `resLineId` → `MappingReviewPanel.js` line 110-111 disables approve
4. **UI**: sticky button / overlay still blocking clicks (less likely)

## Key files

| File | Role |
|---|---|
| `src/components/ArrivalImportPanel.js` | `handleDoc2` (~1517), `_applyDoc2Mapping` (~1476), mapping flow |
| `src/components/MappingReviewPanel.js` | `canApprove`, disabled approve button |
| `src/utils/importMapper.js` | `detectEzgoArrivalsPreset`, `matrixRowsFromHeaderScan`, presets |
| `src/utils/ezgoParser.js` | `aggregateGuestProfiles` — needs valid `columnMapping` |
| `supabase/functions/suggest-import-mapping/index.ts` | AI fallback (Gemini→Claude) — **should not run for EZGO CSV** |

## Approve button disabled when

```javascript
// MappingReviewPanel.js
const missingHard = rows.filter(r => r.required === "hard" && !r.sourceHeader);
const canApprove  = missingHard.length === 0;
// hard = orderNumber, resLineId
```

**Debug:** Log on review mount: `headers`, `aiSuggestion?.mapping`, `missingHard`, `aiSuggestion?.engine`.

## Repro steps for Claude Code

1. `npm start` → סנכרון נתונים → Doc 2 upload Mike's daily EZGO file
2. If mapping screen appears: inspect which engine (`preset` / `memory` / `gemini` / `claude`)
3. Check if `detectEzgoArrivalsPreset(Object.keys(rows[0]))` returns non-null in DevTools
4. If null: print first 3 raw matrix rows from Excel parse — find real header row

## Recommended fix direction

### A. Nuclear restore (preferred for Mike)

For any file where `detectEzgoArrivalsPreset` OR `detectSuiteArrivalsPreset` matches (after header scan):

- **Never show MappingReviewPanel**
- **Never call** `suggest-import-mapping`
- Load grid synchronously; toast profile count

### B. If preset fails

- Show **FAIL VISIBLE** banner: detected headers list + which required columns missing
- Offer: «העלה לדוח הזמנות מפורט» if `isDetailedReservationFormat`

### C. Review screen safety net

If review shown with `engine=preset` and mapping usable → **auto-call** `handleMappingApprove` on mount (no human gate for known formats).

### D. Clear bad memory

Optional: delete `import_mapping_memory` rows where `approved_mapping` lacks `orderNumber`+`resLineId` for `schema_key=suite_arrivals`.

## Tests to add/run

```bash
npm test -- --testPathPattern="importMapper|ArrivalImport|ezgoParser" --watchAll=false
```

Add fixture: Excel matrix with 2 title rows then EZGO headers → `matrixRowsFromHeaderScan` returns profiles.

## QA checklist (Mike)

- [ ] Doc 2 EZGO CSV → grid in <2s, no mapping screen
- [ ] Stats bar shows N פרופילים
- [ ] סנכרן creates guests in DB
- [ ] No Claude/Gemini in UI for standard file

## Deploy

Frontend only: `npm run build` → commit → push `main` (Vercel auto)

---

## Paste-ready prompt for Claude Code

```
P0: Fix Doc 2 (ArrivalImportPanel) — Mike cannot approve mapping; import used to be instant without AI.

Read docs/claude_code_task_doc2_mapping_p0.md and CLAUDE.md §0 (Zero Data Loss).

Goal: Standard EZGO arrivals CSV (iOrderId/sRemark/…) must skip MappingReviewPanel entirely and load grid in ~1 second like before Resilient Import Agent gate.

Investigate why detectEzgoArrivalsPreset fails on Mike's file (likely Excel header not on row 0). Implement matrixRowsFromHeaderScan if not deployed; add FAIL VISIBLE headers debug; ensure canApprove never blocks known presets.

Files: ArrivalImportPanel.js, importMapper.js, MappingReviewPanel.js, ezgoParser.js.

Run importMapper + ArrivalImport tests. Do not deploy without Mike approval unless he says תעלה.
```

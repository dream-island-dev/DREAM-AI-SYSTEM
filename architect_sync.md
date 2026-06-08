# Dream Island AI System — Architect Sync Log

## Shift Generator V2 — Client Parsing, Employee Upsert, Draft Mode, Learning Loop
**Date:** 2026-06-09

### Summary
Full upgrade of the AI Shift Generator pipeline:

- **Client-Side Parsing (Task 1):** `.xlsx` parsed in-browser via `xlsx` lib inside `parsePast()`. Only clean JSON (`rows[]`) is sent to the Edge Function — no binary file upload.

- **Employee Upsert Before Generation (Task 2):** `persistConfirmedEmployees()` refactored to `upsert` on `employees.name` (unique constraint added via migration 013). Fires before `supabase.functions.invoke`. Employee list refreshed from DB after upsert.

- **Draft Mode — No Auto-Save (Task 3):** Edge Function returns schedule JSON only (`{ ok, schedule, engine, mode }`) — zero DB writes. Frontend stores response in `draftShifts` state. `shifts` table INSERT only on explicit "אשר ושמור" approval click (`approve()`).

- **Few-Shot Learning Loop (Task 4):** In CREATIVE mode (no past Excel provided), Edge Function queries `shifts` table for last 14 days of approved shifts for the same department. Injects up to 60 rows into `buildCreativePrompt()` under section `PAST SUCCESSFUL TEMPLATES`. Instruction: "Replicate patterns — pairings, distributions, gap times."

- **Local Duplicate Engine (Task 0 / preserved):** `duplicateScheduleLocally()` intact. When `employeeProfiles` present, schedule is generated locally (zero AI, zero cost) by shifting `dayIndex` relative to new `weekStart`. No AI call occurs.

### Modified Files
- `supabase/functions/generate-schedule/index.ts` — few-shot query + `buildCreativePrompt` signature + single Supabase client init
- `src/components/ShiftGenerator.js` — `schedule→draftShifts`, upsert employees, engine label map, draft UX
- `supabase/migrations/013_employees_name_unique.sql` — UNIQUE constraint on `employees.name`
- `architect_sync.md` — this file

### DB Changes (migration 013)
```sql
ALTER TABLE public.employees ADD CONSTRAINT employees_name_unique UNIQUE (name);
```

### Edge Function Routes (generate-schedule)
| Condition | Path | AI Used |
|---|---|---|
| `employeeProfiles.length > 0` | `duplicateScheduleLocally()` | ❌ None |
| No profiles + past shifts in DB | `buildCreativePrompt()` + few-shot | ✅ Gemini → Anthropic |
| No profiles + no past shifts | `buildCreativePrompt()` (no few-shot) | ✅ Gemini → Anthropic |

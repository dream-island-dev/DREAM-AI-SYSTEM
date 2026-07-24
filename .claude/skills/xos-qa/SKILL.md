---
name: xos-qa
description: Run independent XOS QA on current branch changes before deploy. Invokes qa-gate checklist — automation rules, Silence Rule, Record-Only ETA, Shabbat, deno tests on _shared.
disable-model-invocation: true
---

# /xos-qa — Independent QA Gate

Invoke the **qa-gate** subagent (or act as qa-gate if unavailable).

## Steps
1. Read `CLAUDE.md` and `docs/xos_agent_playbook.md` §8.3.
2. Run `git diff` on branch changes (committed + uncommitted).
3. If `_shared/` touched: `deno test --no-check --allow-env supabase/functions/_shared/*.test.ts`
4. Apply §8.3 checklist strictly.
5. Output P0 table or **`PASSED QA`**.

Do not write or fix code. Read-only audit only.

---
name: xos-ux
description: Run independent holistic UX/product audit — IA, Disable-Don't-Hide, FAIL VISIBLE, cross-screen consistency, mobile/desktop spot-check. NOT a security scan (/xos-security) and NOT git-diff backend QA (/xos-qa).
disable-model-invocation: true
---

# /xos-ux — Product/UX Audit Gate

Invoke the **ux-auditor** subagent (or act as ux-auditor if unavailable).

## Steps
1. Read `RESORT_UI_MANIFEST.md` + `docs/staff_ui_ux_audit_2026-08-02.md` + relevant CLAUDE.md sections.
2. Read broadly across screens touched this phase (or full sweep if weekly).
3. Apply the checklist: DNA compliance, cross-screen consistency, mobile/desktop spot-check, automation-rule surfacing, regression vs top-10 findings.
4. Output P0/P1/P2 table or **`PASSED UX AUDIT`**.

Do not write or fix code. Do not touch RESORT_UI_MANIFEST.md. Read-only audit only.

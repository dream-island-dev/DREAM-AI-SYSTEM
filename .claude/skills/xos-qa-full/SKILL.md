---
name: xos-qa-full
description: Full pre-launch/weekly sweep — runs qa-gate, ux-auditor, and security-sentinel in sequence. Use before a major תעלה or the weekly health scan, not for routine per-commit checks.
disable-model-invocation: true
---

# /xos-qa-full — Combined Gate Sweep

1. Invoke qa-gate (`/xos-qa` checklist).
2. Invoke ux-auditor (`/xos-ux` checklist).
3. Invoke security-sentinel (`/xos-security` checklist).
4. Summarize: PASSED QA / PASSED UX AUDIT / SECURITY PASSED, or the combined blocker list.

Read-only. Do not fix anything unless Mike explicitly asks after seeing all three reports.

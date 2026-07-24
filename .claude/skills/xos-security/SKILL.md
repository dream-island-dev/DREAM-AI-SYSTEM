---
name: xos-security
description: Security audit before XOS backend deploy. Invokes security-sentinel — secrets, webhook auth, RLS, PII, Whapi velocity, no .env exposure.
disable-model-invocation: true
---

# /xos-security — Security Gate

Invoke the **security-sentinel** subagent (or act as security-sentinel if unavailable).

## Steps
1. Run `git diff` on changes touching `supabase/functions/`, `supabase/migrations/`, or webhooks.
2. Apply security-sentinel checklist (secrets, auth, RLS, PII, velocity queue).
3. Output severity table.
4. End with **`SECURITY PASSED`** or list deploy blockers.

Do not write or fix code unless Mike explicitly asks after review.

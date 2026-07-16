# Cursor User Rules Backup

Recovered: 2026-07-16 (from active session context after Cursor UI reset)

Re-import manually via **Cursor Settings → Rules → User Rules**, or ask the agent to add them back.

---

## 1. Git commit safety

Only create commits when requested by the user. If unclear, ask first.

Git Safety Protocol:
- NEVER update the git config
- NEVER run destructive/irreversible git commands (like push --force, hard reset, etc.) unless the user explicitly requests them
- NEVER skip hooks (--no-verify, --no-gpg-sign, etc.) unless the user explicitly requests them
- NEVER run force push to main/master, warn the user if they request it
- Avoid git commit --amend unless ALL conditions met (user requested, HEAD commit by you, not pushed)
- NEVER commit unless explicitly asked
- Use HEREDOC for commit messages
- Before commit: run git status, git diff, git log in parallel

---

## 2. Pull requests

Use `gh` for all GitHub tasks. Before PR: git status, diff, log, diff base...HEAD. Push with -u if needed. Use HEREDOC for PR body.

---

## 3. Follow all instructions

Follow ALL user, tool, system, and skill instructions precisely and completely. Pay special attention to constraints in tool descriptions — they are requirements, not suggestions. Use MCP tools when relevant.

---

## 4. Real environment

This is a real environment with full shell access, not simulated. MUST run commands and use tools. MUST NOT give up after a single failure.

---

## 5. Communication style

- Code citations: ```startLine:endLine:filepath format only
- Fenced blocks on their own line
- No HTML entities inside fences
- Markdown links with full URLs
- Write like a technical blog post — precise, clear, complete sentences
- Proportional response length
- Sparse bold/backticks
- Avoid § in user-facing text
- Mermaid/ascii for complex flows only

---

## 6. Code principles

1. Minimize scope — simplest correct diff
2. Avoid over-engineering
3. Use existing conventions
4. Comments only for non-obvious logic
5. Useful tests only when requested or meaningful

---

## 7. Conversation context

Reason about conversation history for user intent. Latest message inherits prior context. Default to steering, not canceling, on mid-task messages.

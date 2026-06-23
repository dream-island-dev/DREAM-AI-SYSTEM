# Dream Island AI System — Developer Guide

## Quick Start

```bash
npm start
```

This runs the app in development mode. Open [http://localhost:3000](http://localhost:3000) in your browser.

## Build

```bash
npm run build
```

Produces an optimized production build in the `build/` folder.

## Environment Variables

Environment variables are referenced in:

- **Frontend secrets** — Not exposed to React (no `REACT_APP_*` prefix):
  - Supabase keys are loaded from `.env` and consumed only in `src/supabaseClient.js`
  - `.env.local` is listed in `.gitignore` — never commit it

- **Edge Function secrets** — Stored in Supabase Secrets dashboard:
  - `GEMINI_API_KEY`
  - `ANTHROPIC_API_KEY`
  - `META_WHATSAPP_TOKEN`
  - `VAPID_PRIVATE_KEY` (push notifications, never in git)

- **Local development** — Copy `.env.example` (if provided) to `.env.local` and fill in your keys

## Architecture

- **Frontend:** React 19 CRA, no router — pages rendered via `useState` in `App.js`
- **Backend:** Supabase PostgreSQL + Edge Functions (Deno/TypeScript)
- **AI:** Gemini 2.5 Flash (primary), Claude Sonnet 4.6 (fallback)
- **Language:** Hebrew RTL

See `CLAUDE.md` for full architecture details.

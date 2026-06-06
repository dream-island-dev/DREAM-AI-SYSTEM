# Dream Island AI System — Full System Context for AI Models

> Feed this document to any AI model to give it complete context about the project.
> Last updated: 2026-06-06

---

## 1. WHAT THIS SYSTEM IS

**Dream Island Resort Management System** is a Hebrew-language, RTL web application for managing a luxury hotel (Dream Island Resort). It serves two purposes simultaneously:

1. **Operational management** — shifts, service calls, checklists, employee management (currently mock data, migrating to Supabase)
2. **Multi-Agent AI platform** — each department manager gets a personalized AI agent that learns their working style, remembers conversations, and can access department files on Google Drive

The system is live at: `https://dream-ai-system.vercel.app`

---

## 2. TECHNICAL STACK

| Layer | Technology | Notes |
|-------|-----------|-------|
| Frontend | React 19, Create React App | Single SPA, Hebrew RTL, no routing library — pages rendered via `useState` |
| Styling | CSS-in-JS (template string in App.js) | Custom properties: `--gold`, `--black`, `--ivory`, `--border`, etc. |
| Backend | Supabase Edge Functions (Deno/TypeScript) | Deployed to `bunohsdggxyyzruubvcd.supabase.co` |
| Database | Supabase (PostgreSQL 15) | With RLS policies |
| AI Engine | Anthropic Claude (`claude-sonnet-4-6`) | Called from Edge Functions, never from browser |
| Hosting | Vercel | Auto-deploys from GitHub `main` branch |
| Google Drive | Apps Script Bridge | `Code.gs` deployed as Web App, searched via REST |
| Auth | Hybrid — mock users (dev) + Google OAuth via Supabase | Transitioning to full Supabase Auth |
| Repository | `github.com/dream-island-dev/DREAM-AI-SYSTEM` | |

---

## 3. FILE STRUCTURE

```
DREAM-AI-SYSTEM/
├── public/
│   └── index.html                    # title: "Dream Island — מערכת ניהול", lang="he" dir="rtl"
├── src/
│   ├── App.js                        # Main app — all pages, mock data, CSS, routing
│   ├── Chat.js                       # Legacy chat (orphaned, not imported)
│   ├── googleAuth.js                 # Google Identity Services loader
│   ├── index.js                      # React root mount
│   ├── styles.css                    # Minimal (real styles in App.js)
│   ├── supabaseClient.js             # Supabase client + localStorage helpers
│   ├── utils/
│   │   └── admin.js                  # isAdminUser(), loadDepartments(), saveDepartments()
│   ├── components/
│   │   ├── AdminPanel.js             # Admin-only management UI (stats, depts, chats, users)
│   │   ├── AgentChat.js              # Chat interface with DB history + Drive indicator + feedback
│   │   └── AgentQuestionnaire.js     # Manager onboarding form (11 fields from Code.gs)
│   └── data/
│       └── demoAgentProfile.js       # Pre-built DreamBot demo profile + opening suggestions
├── supabase/
│   ├── schema.sql                    # Full DB schema (run first)
│   ├── migrations/
│   │   ├── 001_chat_history.sql      # chat_history table + open RLS
│   │   └── 002_admin_setup.sql       # Admin role trigger + RLS overrides
│   └── functions/
│       ├── chat/index.ts             # Main Edge Function: history + RAG + Claude + DB save
│       └── generate-agent-profile/   # Generates system prompt from questionnaire via Claude
│           └── index.ts
└── .env.example                      # All required environment variables documented
```

**External files (not in this repo):**
- `C:\Users\mikek\Documents\dream island\google-apps-script\Code.gs` — Apps Script for questionnaire storage + Drive search
- `C:\Users\mikek\Documents\dream sestem\App.tsx` — Alternative version with Supabase Auth

---

## 4. ENVIRONMENT VARIABLES

```bash
# Frontend (baked in at build time, visible to browser)
REACT_APP_SUPABASE_URL=https://bunohsdggxyyzruubvcd.supabase.co
REACT_APP_SUPABASE_ANON_KEY=eyJhbGci...   # public anon key, safe to expose
REACT_APP_GOOGLE_CLIENT_ID=XXX.apps.googleusercontent.com
REACT_APP_BACKEND_URL=                    # empty — using Supabase Edge Functions

# Supabase Secrets (server-only, set via: supabase secrets set KEY=value)
ANTHROPIC_API_KEY=sk-ant-...              # NEVER in REACT_APP_*
APPS_SCRIPT_URL=https://script.google.com/macros/s/XXX/exec
```

---

## 5. DATABASE SCHEMA

### Core Tables

```sql
-- User profiles (extends Supabase Auth)
profiles (
  id UUID PK → auth.users,
  name TEXT, role TEXT ('admin'|'manager'),
  department TEXT, avatar_text TEXT, email TEXT,
  created_at, updated_at TIMESTAMPTZ
)

-- One AI agent profile per manager
agent_profiles (
  id UUID PK,
  manager_id UUID → profiles (UNIQUE),
  department TEXT, display_name TEXT,
  system_prompt TEXT,              -- full LLM system prompt, built from questionnaire
  personality_traits JSONB,        -- { communication_style, response_length, proactivity }
  drive_folder_url TEXT,           -- Google Drive folder for RAG
  is_active BOOLEAN,
  questionnaire_id UUID → questionnaire_responses
)

-- Raw questionnaire answers (used to regenerate system_prompt)
questionnaire_responses (
  id UUID PK,
  manager_id UUID → profiles,
  department TEXT,
  responses JSONB,                 -- { name, role, repetitive, questions, sources,
                                   --   tools, dream, tone, email, phone, notes }
  drive_folder_url TEXT,
  agent_profile_id UUID → agent_profiles
)

-- Stateful chat history (survives page refresh)
chat_history (
  id UUID PK,
  session_id TEXT,                 -- localStorage key: session_{agentId}_{timestamp}
  agent_id TEXT,                   -- agent profile ID
  manager_id TEXT,                 -- user ID (can be mock or Supabase UUID)
  role TEXT ('user'|'assistant'),
  content TEXT,
  created_at TIMESTAMPTZ
)
INDEX: (session_id, created_at ASC)

-- Full conversation history (for Supabase Auth users)
conversation_history (
  id UUID PK,
  agent_profile_id UUID → agent_profiles,
  manager_id UUID → profiles,
  session_id TEXT,
  role TEXT ('user'|'assistant'|'system'),
  content TEXT, tokens_used INTEGER,
  created_at TIMESTAMPTZ
)

-- Feedback and corrections → injected as few-shot examples
agent_learning_logs (
  id UUID PK,
  agent_profile_id UUID → agent_profiles,
  manager_id UUID → profiles,
  conversation_message_id UUID → conversation_history,
  original_response TEXT,          -- what Claude said
  correction TEXT,                 -- what manager wanted instead
  rating SMALLINT (1-5),
  feedback_type TEXT ('correction'|'rating'|'note'),
  is_injected BOOLEAN DEFAULT FALSE
)

-- Operational tables (currently mock data in React state)
employees (id, name, department, role, phone, status, created_by)
shifts (id, employee_id, employee_name, department, date, start_time, end_time, status, created_by)
service_calls (id, title, description, priority, department, assigned_to, status, created_by)
checklist_tasks (id, task, department, assigned_to, done, completed_at, task_date, created_by)
```

### RLS Model
- **Regular users**: see only their own rows (via `auth.uid() = manager_id`)
- **Admin**: overrides all policies via `get_my_role() = 'admin'` check
- **Mock-auth compatibility**: `chat_history` has `FOR ALL USING (true)` — open for non-Supabase-Auth users
- **Key function**: `get_my_role()` is SECURITY DEFINER to avoid infinite recursion in `profiles` self-referencing policies

### Admin Setup
- Email `promote7il@gmail.com` is auto-promoted to `role='admin'` by the `handle_new_auth_user()` trigger
- Function `promote_to_admin(email)` promotes existing users manually

---

## 6. AUTHENTICATION

### Current state (hybrid)
```
Login screen shows two paths:
  Path 1: Mock users (demo only)
    - eliad / 1234  → role: 'admin'
    - shira@dreamisland.com / 1234  → role: 'manager', department: 'קבלה'
    - yossi@dreamisland.com / 1234  → role: 'manager', department: 'מסעדה'

  Path 2: Google OAuth
    - Uses Supabase Auth (signInWithOAuth provider: 'google')
    - On success: sessionUserToAppUser() maps Supabase user to app user object
    - promote7il@gmail.com → auto-assigned admin role via DB trigger
```

### User object shape (in React state)
```javascript
{
  id: string,          // mock: integer | Supabase: UUID
  name: string,
  role: 'admin' | 'manager',
  email: string,
  avatar: string,      // 2-character initials
  avatarUrl?: string,  // Google profile photo URL
  department?: string, // for manager role
  idToken?: string,    // Google JWT (legacy)
}
```

### Admin detection
```javascript
// src/utils/admin.js
isAdminUser(user) → user.role === 'admin' || user.email === 'promote7il@gmail.com'
```

---

## 7. THE MULTI-AGENT SYSTEM

### How an agent is created

```
Manager opens "🤖 הסוכן שלי" in sidebar
  ↓
AgentQuestionnaire (11 fields matching Code.gs schema):
  name, role, repetitive, questions, sources,
  tools, dream, tone, email, phone, notes
  ↓
buildSystemPrompt(form) → structured Hebrew system prompt
  ↓
Profile saved to localStorage: agent_profile_{userId}
  + questionnaire saved to localStorage: questionnaire_{userId}
  ↓
AgentChat component renders with active profile
```

**OR:** Click "⚡ טען דמו מיידי" → loads `buildDemoProfile()` from `demoAgentProfile.js`
  - DreamBot: knows all 6 departments, protocols, KPIs, staff names

### Agent profile structure
```javascript
{
  id: "profile_{userId}_{timestamp}",
  manager_id: userId,
  department: "קבלה" | "ניקיון" | etc.,
  display_name: "סוכן של [name]",
  system_prompt: "# זהות הסוכן\nאתה...",  // full LLM instruction
  drive_folder_url: "https://drive.google.com/...",
  personality_traits: { communication_style: "concise" },
  is_active: true,
  is_demo: true | false,
}
```

### System prompt structure
```
# זהות הסוכן        ← who the agent is
# תפקיד וסמכות      ← manager's role
# משימות חוזרות     ← recurring tasks (from questionnaire)
# שאלות מהצוות      ← common team questions
# מקורות מידע       ← information sources
# כלים ומערכות      ← tools used
# החזון             ← manager's vision/dream
# סגנון מענה        ← formal | friendly | concise | detailed
# כללי עבודה        ← always Hebrew, cite names, ask one focused question
```

---

## 8. CHAT FLOW (STATEFUL)

```
User types message → AgentChat.send()
  ↓
Reads from localStorage:
  - sessionId: getOrCreateSessionId(agentProfile.id)
    key: "session_id_{agentId}" → "session_{agentId}_{timestamp}"
  - learningLogs: getLocalCorrections(agentProfile.id) → last 5 corrections
  ↓
POST to: ${SUPABASE_URL}/functions/v1/chat
Body: {
  message,        ← just the current message (NOT full history)
  sessionId,      ← DB lookup key
  managerId,
  agentProfile: { id, systemPrompt, department, displayName, driveUrl },
  learningLogs:  [{ original_response, correction }]
}
  ↓
Edge Function: supabase/functions/chat/index.ts
  Step 1: Load last 10 messages from chat_history WHERE session_id = ?
  Step 2: Google Drive RAG (if driveUrl + APPS_SCRIPT_URL set):
            GET {APPS_SCRIPT_URL}?action=search&folder={driveUrl}&query={message}
            → returns [{ name, snippet }] from matching Drive files
  Step 3: Build system prompt:
            base system prompt
            + Drive context (if found)
            + learning log corrections (few-shot examples)
  Step 4: Build messages array:
            [...history from DB, { role: "user", content: message }]
  Step 5: Call Claude (claude-sonnet-4-6, max_tokens: 2048)
  Step 6: INSERT both messages into chat_history
  Step 7: Return { ok: true, reply, driveUsed, historyCount }
  ↓
AgentChat receives reply → renders message bubble
  ↓
After each assistant message: show 👍 / 👎 buttons
  👍 → saveLearningLog({ feedback_type: 'rating', rating: 5 })
  👎 → show correction textarea
       → saveLearningLog({ feedback_type: 'correction', correction: text })
       → stored in localStorage: learning_logs_{agentId}
       → injected in NEXT conversation as few-shot examples
```

### Session persistence
```javascript
// Created on first chat, persisted in localStorage
localStorage.key: "session_id_{agentProfile.id}"
value: "session_{agentId}_{timestamp}"

// On mount: load history from Supabase
const hist = await supabase
  .from('chat_history')
  .select('role, content, created_at')
  .eq('session_id', sessionId)
  .order('created_at', { ascending: true })
  .limit(30)

// New conversation button: resets session_id → new localStorage key
```

---

## 9. GOOGLE DRIVE RAG

### How it works
```
Manager's Drive folder URL stored in agent_profile.drive_folder_url
  ↓
On every chat message, Edge Function calls Apps Script:
  GET https://script.google.com/macros/s/XXX/exec
    ?action=search
    &folder=https://drive.google.com/drive/folders/ABC
    &query=user's message (first 200 chars)
  ↓
Apps Script (Code.gs) — searchDriveFolder_():
  1. Extract folder ID from URL
  2. folder.searchFiles(`fullText contains '${query}' and trashed = false`)
  3. For Google Docs: DocumentApp.openById().getBody().getText()
     For Sheets: getDataRange().getValues() → joined rows
     For plain text: getBlob().getDataAsString()
  4. Extract 600-char snippet around query match
  5. Return max 3 results: [{ name, snippet }]
  ↓
Edge Function injects into system prompt:
  "## מסמכים רלוונטיים מ-Google Drive המחלקתי
   **📄 [filename]**
   [snippet text]"
  ↓
Claude sees Drive content as part of its context
```

### Why Drive was failing (before fix)
- No Google API credentials in Edge Function
- `drive_folder_url` was stored but never read
- `Code.gs` only handled POST (questionnaire) — no `?action=search` endpoint
- Google Drive API requires server-side OAuth — cannot be called from browser

### Current limitation
- PDF files not supported (require Drive API v3 with binary download)
- Files must be shared with the Apps Script's Google account
- Apps Script has 6-second timeout — slow for large folders

---

## 10. ADMIN PANEL

Access: Only for `promote7il@gmail.com` (or any `role='admin'` user)
Navigation: 👑 ניהול מערכת in sidebar (only visible to admin)

### Tabs
| Tab | Content |
|-----|---------|
| 📊 סטטיסטיקות | Total messages/sessions/agents from Supabase, system status |
| 🏢 מחלקות | Add/delete departments. Stored in `localStorage['di_departments']`. Takes effect on next page load. Default: קבלה, ניקיון, מסעדה, תחזוקה, ביטחון, ספא |
| 💬 שיחות | All chat_history records from Supabase, grouped by session_id, expandable |
| 👥 משתמשים | Supabase profiles table + mock users list |

### Department management note
Departments are read from `localStorage['di_departments']` on every page load via `loadDepartments()`. Changes in AdminPanel call `saveDepartments()` + suggest reload. This avoids prop-drilling through all page components.

---

## 11. NAVIGATION & PAGES

```javascript
// Pages (rendered conditionally, no router)
"dashboard"  → Dashboard component (stats, active shifts, recent calls)
"shifts"     → ShiftsPage (table + add modal)
"calls"      → CallsPage (Kanban: פתוח → בטיפול → טופל)
"checklist"  → ChecklistPage (grouped by department, toggle done)
"employees"  → EmployeesPage (cards grid + add modal)
"agent"      → if !agentProfile: AgentQuestionnaire
               else: AgentChat
"admin"      → AdminPanel (isAdmin only)

// Mobile nav (bottom bar, shown on < 768px):
dashboard, shifts, calls, checklist, agent
```

---

## 12. DEPARTMENTS

Default list (editable by admin):
`["קבלה", "ניקיון", "מסעדה", "תחזוקה", "ביטחון", "ספא"]`

**DreamBot demo knowledge per department:**
- **קבלה**: Check-in 14:00, check-out 11:00, late checkout policy, VIP rooms 301/302/401
- **ניקיון**: Room cleaning 09:00-13:00, pool check 07:30+15:00, turndown VIP only 19:00
- **מסעדה**: Breakfast 07:00-10:30, lunch 12:30-15:00, dinner 19:00-22:30, kosher
- **תחזוקה**: Normal call < 1hr, urgent < 15min, emergency immediate. On-call: Alon Shapira
- **ביטחון**: 24/7 guard, 18 cameras, 30-day retention, back entrance locked 23:00-06:00
- **ספא**: Reservations only, cancel 4hr before, therapist: Noa Ben David

---

## 13. KNOWN ISSUES & LIMITATIONS

| Issue | Status | Notes |
|-------|--------|-------|
| Mock data in operational tables | By design | Shifts/calls/checklist/employees reset on refresh |
| No Supabase Auth for mock users | By design | eliad/shira/yossi use mock auth, not Supabase |
| Drive RAG requires Apps Script deployment | Manual step | Apps Script URL must be set as Supabase secret |
| PDF files not supported in Drive search | Known gap | Would need Drive API v3 + service account |
| DEPARTMENTS not reactive | Known gap | Requires page reload after admin edit |
| agent_learning_logs in localStorage | Works | Not yet synced to Supabase for mock auth users |
| Chat.js file | Orphaned | Not imported anywhere, legacy file |

---

## 14. KEY CONSTANTS & PATTERNS

```javascript
// Admin email (client-side detection)
ADMIN_EMAIL = "promote7il@gmail.com"

// localStorage keys
`agent_profile_${userId}`          // agent profile JSON
`questionnaire_${userId}`          // questionnaire responses
`session_id_${agentId}`            // current chat session ID
`learning_logs_${agentId}`         // correction logs array (max 50)
`di_departments`                   // custom departments array

// Supabase project
URL:  https://bunohsdggxyyzruubvcd.supabase.co
Ref:  bunohsdggxyyzruubvcd
Region: eu-central-1 (Frankfurt)
Plan: Free (Nano compute)

// Edge Functions deployed
chat                    → /functions/v1/chat
generate-agent-profile  → /functions/v1/generate-agent-profile (not actively used)

// GitHub repo
https://github.com/dream-island-dev/DREAM-AI-SYSTEM

// Live URL
https://dream-ai-system.vercel.app
```

---

## 15. BRAND & UI CONVENTIONS

```css
/* Color palette */
--gold:       #C9A96E   /* primary accent */
--gold-dark:  #A8843A
--gold-light: #E8C98A
--black:      #1A1A1A
--ivory:      #F5F0E8   /* page background */
--sidebar-bg: #0F0F0F   /* dark sidebar */
--border:     #E0D5C5
--card-bg:    #FFFFFF

/* Typography */
font-family: 'Heebo', sans-serif     /* Hebrew body text */
font-family: 'Playfair Display', serif /* titles */

/* Direction */
direction: rtl  /* Hebrew right-to-left */
text-align: right

/* Status colors */
badge-green  → active / done
badge-red    → urgent / open
badge-orange → in progress
badge-blue   → future / info
badge-gold   → admin / special
```

---

## 16. DEPLOYMENT PIPELINE

```
Developer edits code locally
  ↓
git push origin main
  ↓
Vercel detects push → runs: npm run build (react-scripts build)
  ↓
Build output deployed to CDN
  ↓
https://dream-ai-system.vercel.app updated (< 2 min)

For Edge Functions:
supabase functions deploy chat --no-verify-jwt
  (runs from local machine with SUPABASE_ACCESS_TOKEN)
```

---

## 17. WHAT'S NEXT (PLANNED)

1. **Replace mock auth** with full Supabase Auth (email/password + Google) for all users
2. **Connect operational tables** — replace initialEmployees/Shifts/Calls/Checklists with Supabase queries
3. **Apps Script deployment** — deploy updated Code.gs to enable Drive RAG
4. **Set APPS_SCRIPT_URL secret** — `supabase secrets set APPS_SCRIPT_URL="..."`
5. **Run SQL migrations** — 001_chat_history + 002_admin_setup in Supabase SQL Editor
6. **PDF support** in Drive search via Google Drive API v3 + service account
7. **Real-time updates** — Supabase Realtime for live shift/call updates across managers

---

*This document reflects the state of the system as of 2026-06-06.*
*Project: Dream Island Resort Management — Mike Kapach (promote7il@gmail.com)*

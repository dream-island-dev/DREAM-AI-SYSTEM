# ARCHITECT SYNC — Dream Island XOS
**עודכן:** 2026-06-09

---

## STACK

| שכבה | פרטים |
|---|---|
| **Frontend** | React 19.0.0 · CRA (react-scripts 5.0.0) · Hebrew RTL SPA · deployed on **Vercel** |
| **Backend** | Supabase project: `bunohsdggxyyzruubvcd` (dream-island) · PostgreSQL 15+ · RLS enabled |
| **Edge Functions** | Deno · 8 functions (ר׳ להלן) |
| **Auth** | Google OAuth (`signInWithIdToken`) → Supabase Auth JWT |
| **AI Primary** | Gemini (כל הפונקציות) — key: `GEMINI_API_KEY` ב-Supabase Secrets |
| **AI Fallback** | Claude Sonnet 4.6 ב-`chat` בלבד — ⚠️ ANTHROPIC_API_KEY מוגבל, מחזיר 404 |
| **WhatsApp** | Meta Cloud API — `META_WHATSAPP_TOKEN` + `META_PHONE_NUMBER_ID` ב-Supabase Secrets |
| **Push** | Web Push VAPID — `VAPID_PRIVATE_KEY` ב-Supabase Secrets (לעולם לא בגיט) |

### Dependencies עיקריים (package.json)
```
@supabase/supabase-js  ^2.45.0
react / react-dom      ^19.0.0
xlsx                   ^0.18.5   ← ShiftGenerator Excel parsing
mammoth                ^1.12.0   ← KnowledgeUploader DOCX→text
ajv                    ^8.17.1
```

---

## מבנה תיקיות

```
DREAM-AI-SYSTEM/
├── src/
│   ├── App.js                          # ראוטר ראשי, Google Auth, global state (~2100 שורות)
│   ├── Chat.js                         # legacy chat wrapper
│   ├── index.js                        # CRA entry point  ⚠️ uncommitted changes
│   ├── styles.css                      # global RTL styles  ⚠️ uncommitted changes
│   ├── supabaseClient.js               # supabase init, loadAgentProfile
│   ├── googleAuth.js                   # initGoogleSignIn helper
│   ├── components/
│   │   ├── ShiftGenerator.js           # 1253 שורות — מחולל משמרות AI
│   │   ├── BroadcastDashboard.js       # 762  — WhatsApp broadcasts
│   │   ├── GuestDashboard.js           # 679  — ניהול אורחים
│   │   ├── UserManagement.js           # 492  — ניהול עובדים/משתמשים
│   │   ├── AgentChat.js                # 477  — ממשק שיחה עם AI
│   │   ├── AdminPanel.js               # 436  — לוח בקרה אדמין
│   │   ├── DataUpload.js               # 433  — העלאת קבצים
│   │   ├── WhatsAppInbox.js            # 414  — תיבת דואר WhatsApp נכנס
│   │   ├── AgentQuestionnaire.js       # 406  — שאלון הגדרת סוכן
│   │   ├── KnowledgeUploader.js        # 404  — העלאת מסמכי ידע לסוכן
│   │   └── GuestsPage.js              # 149  — רשימת אורחים
│   ├── data/demoAgentProfile.js        # demo suggestions + profile fallback
│   └── utils/
│       ├── admin.js                    # isAdminUser, isSuperAdmin, loadDepartments
│       └── pushNotifications.js        # getPushState, subscribe/unsubscribe
├── supabase/
│   ├── schema.sql                      # full DB schema
│   ├── migrations/
│   │   └── 013_employees_name_unique.sql  # UNIQUE(name) on employees
│   └── functions/
│       ├── chat/index.ts               # agent chat — Gemini 2.5→Claude fallback
│       ├── generate-schedule/index.ts  # v5 — Gemini 2.0, Anthropic removed
│       ├── generate-agent-profile/index.ts  # Gemini 2.5 only (Anthropic removed today)
│       ├── process-knowledge/index.ts  # Gemini 1.5 multimodal RAG ingestion
│       ├── push-notify/index.ts        # Web Push VAPID
│       ├── whatsapp-send/index.ts      # v5 — Meta Cloud API dispatcher
│       ├── whatsapp-cron/index.ts      # pg_cron ~15min scheduled triggers
│       └── whatsapp-webhook/index.ts   # v2 — incoming WA + AI concierge  ⚠️ uncommitted rewrite
├── public/
│   └── service-worker.js              # PWA push notification listener
├── architect_sync.md                  # ← this file
├── REFINEMENT_PLAN.md                 # ⚠️ untracked
└── .vercel/project.json               # Vercel project binding
```

---

## DB TABLES

| טבלה | מי משתמש | תיאור |
|---|---|---|
| `profiles` | App.js, כל הפונקציות | משתמשים — extends Supabase Auth users |
| `employees` | ShiftGenerator, UserManagement | עובדי המלון, FK: `created_by → profiles.id` |
| `shifts` | ShiftGenerator, App.js | משמרות — DATE/TIME, FK: `employee_id` |
| `guests` | GuestDashboard, BroadcastDashboard, webhook | אורחי מלון + מועד הגעה/עזיבה |
| `agent_profiles` | AgentChat, AgentQuestionnaire | פרופיל סוכן AI אחד למנהל (UNIQUE manager_id) |
| `agent_memory` | chat fn, generate-schedule fn, KnowledgeUploader | כללי עבודה שנחלצו מהמסמכים |
| `agent_learning_logs` | AgentChat | משוב + תיקונים של מנהל (few-shot injection) |
| `chat_history` | AgentChat, chat fn | היסטוריית שיחה per session_id |
| `schedule_patterns` | generate-schedule fn | דפוסי Excel שנלמדו (post-generate) |
| `push_subscriptions` | pushNotifications.js | Web Push endpoints per user |
| `notification_log` | whatsapp-send fn | dedup — מונע שליחת WhatsApp כפולה |
| `whatsapp_conversations` | WhatsAppInbox, webhook | שיחות WA נכנסות |
| `guest_alerts` | webhook | דגלי alert מהבוט לתשומת לב מנהל |
| `questionnaire_responses` | AgentQuestionnaire | תשובות שאלון הגדרת סוכן |

---

## COMPONENTS

### `App.js` — ראוטר ראשי (~2100 שורות)
- Google OAuth → `supabase.auth.signInWithIdToken` → JWT
- State: `currentUser`, `activeTab`, global employees/shifts
- Routing: `activeTab` switch → מציג component נכון
- ⚠️ עדיין מכיל `MOCK_USERS` + `initialEmployees` (legacy, לא בשימוש אקטיבי)

### `ShiftGenerator.js` (1253 שורות) — מחולל משמרות AI
**שלב 1 — פרסור Excel (4 schemas):**
| Schema | תיאור | דוגמה |
|---|---|---|
| `employee-cols` | ✅ **NEW** פורמט לידור — עובדים = עמודות, תאריכים = שורות | 07.06.25 סידור לידור |
| `station-rows` | תחנות = שורות, שמות עובדים בתאים | טבלת תחנות |
| `employee-rows` | עובדים = שורות, ימים = עמודות | טבלה קלאסית |
| `shift-rows` | כל שורה = משמרת נפרדת | CSV-style |

**שלב 2:**
- PATH A (מיידי): `duplicateScheduleLocally()` — אפס API, <10ms, כשיש `employeeProfiles`
- PATH B (AI): `supabase.functions.invoke("generate-schedule")` — רק כשאין פרופילים

**DB sync:** `persistConfirmedEmployees()` — upsert employees עם `created_by: user?.id`

### `BroadcastDashboard.js` (762 שורות)
- פילטר אורחים לפי תאריך/דגלים + שליחת WhatsApp
- ⚠️ כפתור ירוק "שלח להגעות מחר" → `dream_arrival_tomorrow` template — **לא קיים ב-Meta**

### `AgentChat.js` (477 שורות)
- `supabase.functions.invoke("chat")` ← תוקן מ-raw fetch (401 fix)
- session_id ב-localStorage + history מ-DB
- Feedback 👍/תיקון → `agent_learning_logs`

### `WhatsAppInbox.js` (414 שורות)
- Realtime `whatsapp_conversations` + ack/mark-as-read

### `KnowledgeUploader.js` (404 שורות)
- PDF/DOCX/TXT → `supabase.functions.invoke("process-knowledge")` → `agent_memory`

### `AgentQuestionnaire.js` (406 שורות)
- `supabase.functions.invoke("generate-agent-profile")` → יוצר `agent_profiles` row

---

## EDGE FUNCTIONS

### `chat` — שיחת מנהל עם סוכן AI
- **מקבל:** `{ message, sessionId, managerId, agentProfile, learningLogs }`
- **מחזיר:** `{ ok, reply, engine, driveUsed, historyCount }`
- **AI:** Gemini 2.5 Flash → Claude Sonnet 4.6 fallback ⚠️
- **RAG:** Google Drive via `APPS_SCRIPT_URL`
- **DB read:** `chat_history`, `agent_memory` · **DB write:** `chat_history`
- **⚠️ לא deployed בגרסה עם 401-fix**

### `generate-schedule` v5 — מחולל סידור AI
- **מקבל:** `{ pastShifts, employees, constraints, weekStart, department, managerId, employeeProfiles }`
- **מחזיר:** `{ ok, schedule[], engine, mode }`
- **ניתוב:** profiles → `duplicateScheduleLocally()` (אפס AI) · no profiles → Gemini few-shot
- **AI:** Gemini 2.0 Flash בלבד
- **⚠️ לא deployed — ריצה גרסה ישנה עם Anthropic**

### `generate-agent-profile` — יצירת פרופיל סוכן
- **מקבל:** `{ responses, department, jobTitle, managerName, driveFolderUrl }` + Authorization JWT
- **מחזיר:** `{ ok, engine, agentProfile }`
- **AI:** Gemini 2.5 Flash בלבד (Anthropic הוסר)
- **⚠️ לא deployed**

### `process-knowledge` — עיבוד מסמכי ידע
- **מקבל:** קובץ + managerId + agentProfileId
- **AI:** Gemini 1.5 Flash multimodal
- **DB write:** `agent_memory`

### `push-notify` — Web Push
- **מקבל:** `{ userId?, department?, title, body, url }`
- **פרוטוקול:** VAPID ישיר ב-Deno Web Crypto
- **⚠️ TODO:** RFC 8291 aesgcm payload encryption

### `whatsapp-send` v5 — שליחת WhatsApp
- **Triggers:** `night_before`, `morning_of`, `checkout_reminder`, `manual`, `broadcast`
- **dedup:** `notification_log`
- **⚠️ META_WHATSAPP_TOKEN** פג כל ~60 יום

### `whatsapp-cron` — טריגרים מתוזמנים
- pg_cron כל ~15 דקות → בודק `guests` עם הגעה מחר → קורא `whatsapp-send`

### `whatsapp-webhook` v2 — בוט AI
- Meta webhook POST endpoint
- **AI:** Gemini 2.0 Flash — תשובות אוטומטיות לאורחים
- **DB write:** `whatsapp_conversations`, `guest_alerts`
- **⚠️ uncommitted rewrite (367 שורות חדשות, unstaged)**

---

## STATE נוכחי

### ✅ עובד
| פיצ׳ר | הערות |
|---|---|
| Google Auth + Supabase JWT | |
| ShiftGenerator employee-cols schema | תוקן היום — פורמט לידור נזהה |
| ShiftGenerator PATH A local duplicate | אפס API, מיידי |
| WhatsApp send/receive | אחרי חידוש TOKEN ידני |
| Agent Chat | אחרי תיקון 401 |
| BroadcastDashboard (ללא כפתור ירוק) | |
| Push Notifications | |
| KnowledgeUploader → agent_memory | |

### ⚠️ דורש פעולה ידנית

| בעיה | פתרון |
|---|---|
| 3 Edge Functions לא deployed | `npx supabase functions deploy <name> --project-ref bunohsdggxyyzruubvcd --no-verify-jwt` |
| `dream_arrival_tomorrow` template חסר | ליצור ב-Meta Business Manager + אישור 24-48ש׳ |
| `whatsapp-webhook` uncommitted rewrite | `git add + git commit` |
| `src/index.js` + `src/styles.css` uncommitted | `git add + git commit` |

### ❌ שבור
| | |
|---|---|
| ShiftGenerator PATH B (AI) | Edge Function ישנה deployed — קוראת Anthropic → 404 |
| כפתור "שלח להגעות מחר" | Template לא קיים ב-Meta |

---

## DEPLOY COMMANDS

```bash
# Login (פעם אחת):
npx supabase login

# Deploy functions (project ref: bunohsdggxyyzruubvcd):
npx supabase functions deploy generate-schedule      --project-ref bunohsdggxyyzruubvcd --no-verify-jwt
npx supabase functions deploy generate-agent-profile --project-ref bunohsdggxyyzruubvcd --no-verify-jwt
npx supabase functions deploy chat                   --project-ref bunohsdggxyyzruubvcd --no-verify-jwt
npx supabase functions deploy whatsapp-webhook       --project-ref bunohsdggxyyzruubvcd --no-verify-jwt
```

---

## SECRETS נדרשים ב-Supabase

```
GEMINI_API_KEY              # כל AI  ← primary
ANTHROPIC_API_KEY           # chat fallback בלבד  ⚠️ מוגבל
META_WHATSAPP_TOKEN         # פג ~60 יום — לחדש מ-Meta Developer Portal
META_PHONE_NUMBER_ID        # מספר הטלפון העסקי
META_BUSINESS_ACCOUNT_ID    # WABA ID
APPS_SCRIPT_URL             # Google Drive RAG bridge
VAPID_PRIVATE_KEY           # Web Push — לעולם לא בגיט
WHATSAPP_VERIFY_TOKEN       # webhook verification
```

---

## RED LINES אדריכליות

- **AI — מנהלים בלבד** — אין גישה לAI לעובדים
- **RLS על כל טבלה** — `manager_id = auth.uid()` + admin override
- **upsert על `name`** לעובדים (migration 013) — לא על id
- **WhatsApp = Meta Cloud API בלבד** — לא Twilio, לא API אחר
- **`ANTHROPIC_API_KEY` לעולם לא ב-`REACT_APP_*`** — browser exposure אסור
- **`VAPID_PRIVATE_KEY` לעולם לא בגיט** — Supabase Secrets בלבד
- **Meta tokens לעולם לא ב-chat/git** — rotate מיד אם נחשפו
- **HTTP 200 תמיד** מ-Edge Functions — שגיאות ב-`{ ok: false, error: "..." }`
- **Design:** `#1B3A32` ירוק · `#C9A25A` זהב · `#F7F4EC` שנהב · RTL
- **super_admin:** `tzalamnadlan@gmail.com` · **admin:** `promote7il@gmail.com`

# CLAUDE.md — Dream Island AI System
> קובץ זה נקרא אוטומטית בכל שיחה. הוא מקור-האמת שלך. קרא אותו לפני כל פעולה.
> **עדכון אחרון:** 2026-06-18 (Golden Guest Profile + suite_rooms + SuitesDashboard deployed)

---

## 1. מה המערכת הזאת

**Dream Island Resort Management System** — אפליקציית ניהול מלון יוקרה בעברית, RTL.

שני שימושים במקביל:
1. **ניהול תפעולי** — משמרות, קריאות שירות, צ'קליסטים, עובדים, אורחים
2. **פלטפורמת AI** — בוט וואטסאפ לאורחים (Dream Concierge) + סוכן AI לכל מנהל מחלקה

**בעל המערכת:** Mike Kapach  
**Live URL:** `https://dream-ai-system.vercel.app`  
**Supabase project:** `bunohsdggxyyzruubvcd` (Frankfurt / eu-central-1)

---

## 2. סטאק טכני — מציאות נוכחית

| שכבה | טכנולוגיה | הערות חשובות |
|---|---|---|
| Frontend | React 19 · CRA (react-scripts 5) | SPA יחיד, Hebrew RTL, **ללא ספריית ניתוב** — דפים מרונדרים דרך `useState` ב-App.js |
| Styling | CSS-in-JS (template string ב-App.js) | `--gold`, `--black`, `--ivory`, `--border`, `--gold-dark` |
| Backend | Supabase Edge Functions (Deno/TypeScript) | 8 functions פרוסות |
| Database | Supabase PostgreSQL 15 + RLS | כל טבלה עם Row Level Security |
| AI Primary | **Gemini 2.0 Flash / 2.5 Flash** | `GEMINI_API_KEY` ב-Supabase Secrets |
| AI Fallback | Claude Sonnet 4.6 | `chat` function בלבד — ⚠️ `ANTHROPIC_API_KEY` מוגבל, רוב model names מחזירים 404 |
| WhatsApp | Meta Cloud API | `META_WHATSAPP_TOKEN` פג כל ~60 יום |
| Auth | Google OAuth → Supabase Auth JWT | + mock users לפיתוח |
| Push | Web Push VAPID | `VAPID_PRIVATE_KEY` ב-Supabase Secrets בלבד |
| Hosting | Vercel | auto-deploy מ-GitHub `main` |
| Font | Heebo (Hebrew) + Playfair Display (titles) | |

### Dependencies (package.json)
```json
"@supabase/supabase-js": "^2.45.0"
"react": "^19.0.0"
"react-dom": "^19.0.0"
"react-scripts": "^5.0.0"
"xlsx": "^0.18.5"        ← ShiftGenerator — Excel parsing
"mammoth": "^1.12.0"     ← KnowledgeUploader — DOCX→text
"ajv": "^8.17.1"
```

---

## 3. מפת קבצים — מה קיים בפועל

```
DREAM-AI-SYSTEM/
├── src/
│   ├── App.js                    ★ ראוטר ראשי, Auth, global state (104KB — הקובץ הכי גדול)
│   ├── Chat.js                   ⚠️ ORPHAN 3.9KB — לא מיובא בשום מקום, ממתין למחיקה
│   ├── supabaseClient.js         2.8KB — Supabase client + loadAgentProfile + saveLearningLog
│   ├── googleAuth.js             1.5KB — initGoogleSignIn helper
│   ├── index.js                  1.4KB — CRA entry point
│   ├── styles.css                162B  — minimal (real styles ב-App.js)
│   ├── utils/
│   │   ├── admin.js              2.2KB — isAdminUser(), isSuperAdmin(), loadDepartments()
│   │   ├── pushNotifications.js  3.3KB — getPushState, subscribe/unsubscribe
│   │   └── ezgoParser.js         ★ NEW — IL mobile regex + extractGuestDetails + aggregateGuestProfiles
│   │                                Pure transform — zero Supabase calls. Called from DataUpload Tab 1.
│   ├── data/
│   │   └── demoAgentProfile.js   9.1KB — DreamBot demo profile + opening suggestions
│   └── components/
│       ├── ShiftGenerator.js     58KB  מחולל משמרות — LOCAL ONLY, אין קריאת Edge Function
│       ├── BroadcastDashboard.js 37KB  שידור WhatsApp — תבניות מ-DB (message_templates)
│       ├── GuestDashboard.js     31KB  pipeline אורחים
│       ├── UserManagement.js     21KB  ניהול משתמשים
│       ├── AgentChat.js          22KB  שיחה עם סוכן AI
│       ├── AgentQuestionnaire.js 19KB  שאלון הגדרת סוכן
│       ├── WhatsAppInbox.js      18KB  תיבת שיחות WA + bot toggle
│       ├── AdminPanel.js         18KB  לוח בקרה admin
│       ├── DataUpload.js         ★ EZGO+Spa merger — מייבא הגעות EZGO + CSV ספא,
│       │                            מחבר לפי שם → כותב ל-bookings (treatment_time, treatment_type)
│       │                            phone format: sanitizePhone() → E.164 לguests,
│       │                            normalizePhoneBookings() → 972XXXXXXXXX (ללא +) לbookings
│       ├── TaskBoard.js          18KB  לוח משימות
│       ├── KnowledgeUploader.js  17KB  העלאת מסמכי ידע → agent_memory
│       ├── BotConfigPanel.js     13KB  הגדרות Smart Concierge (bot_config table)
│       ├── GuestsPage.js         9.6KB רשימת אורחים + badge toggle
│       ├── SuitesDashboard.js    ★ NEW — per-room grid from suite_rooms, grouped by order_number
│       └── BotSettings.js        ★ מוח הבוט — system_prompt + knowledge_base
│                                    חשוב: משפיע רק על תשובות free-text (Gemini)
│                                    לא משפיע על לחיצות כפתור (hardcoded routing)
├── supabase/
│   ├── migrations/
│   │   ├── 001–027_*.sql        applied ✅
│   │   ├── 028_guests_rls_open_to_all_auth.sql  applied ✅
│   │   ├── 029_room_status.sql                  applied ✅
│   │   ├── 030_guests_pipeline_flags.sql         applied ✅
│   │   ├── 031_treatment_time.sql               applied ✅ — bookings table עם treatment_time/type
│   │   ├── 032_bot_scripts.sql                  applied ✅
│   │   ├── 033_guests_window_tracking.sql        applied ✅
│   │   ├── 034_bot_sales_directives.sql          applied ✅
│   │   ├── 035_spa_staging.sql                  applied ✅ — spa_staging staging table
│   │   ├── 036_room_cleaning_timer.sql           applied ✅
│   │   ├── 037_bot_scripts_calibration.sql       applied ✅
│   │   ├── 038_cleaner_role.sql                 applied ✅
│   │   ├── 039_arrivals_import.sql              applied ✅ — room_count + status לbookings
│   │   ├── 040_upsell_interest.sql              applied ✅
│   │   ├── 041_suite_name.sql                   applied ✅
│   │   ├── 042_guest_index.sql                  applied ✅
│   │   └── 043_guests_status_pending.sql         applied ✅ — הוסיף 'pending' לstatus check
│   └── functions/
│       ├── chat/                deployed ✅ — Gemini 2.5→Claude fallback
│       ├── generate-schedule/   deployed ✅ ⚠️ ORPHAN — frontend לא קורא אותה
│       ├── generate-agent-profile/ deployed ✅
│       ├── process-knowledge/   deployed ✅
│       ├── push-notify/         deployed ✅
│       ├── whatsapp-send/       deployed ✅ — תומך ב-inbox_reply trigger
│       ├── whatsapp-cron/       deployed ✅ — pg_cron job "wa-cron" פעיל (*/15) ⚠️ KILL SWITCH ON
│       └── whatsapp-webhook/    ★ deployed ✅ v3 — ראה §6 לתיאור מלא
└── public/
    └── service-worker.js        PWA push listener
```

---

## 4. ניתוב ב-App.js

```javascript
// ניווט דרך setActivePage() — אין React Router
switch (activePage) {
  "dashboard"    → Dashboard
  "shifts"       → ShiftsPage
  "calls"        → CallsPage
  "checklist"    → ChecklistPage
  "employees"    → EmployeesPage
  "vip_guests"   → GuestDashboard
  "broadcast"    → BroadcastDashboard
  "wa_inbox"     → WhatsAppInbox
  "guests"       → GuestsPage
  "scheduler"    → ShiftGenerator
  "upload"       → DataUpload
  "suites"       → SuitesDashboard  ★ NEW — per-room grid from suite_rooms table
  "tasks"        → TaskBoard
  "bot_config"   → BotConfigPanel   (admin only — guardPage)
  "bot_settings" → BotSettings      (admin only — guardPage) ★ NEW
  "agent"        → AgentQuestionnaire / AgentChat
  "admin"        → AdminPanel       (admin only)
  "users_mgmt"   → UserManagement   (super_admin only)
}
```

---

## 5. טבלות DB — מצב נוכחי

| טבלה | תיאור | RLS |
|---|---|---|
| `profiles` | משתמשים — extends Supabase Auth | `auth.uid() = id` |
| `employees` | עובדי מלון | `created_by = auth.uid()` |
| `shifts` | משמרות | `created_by = auth.uid()` |
| `guests` | אורחי מלון — phone בפורמט E.164 (`+972XXXXXXXXX`) | כל authenticated קורא/כותב |
| `bookings` | ★ הגעות מיובאות מEZGO — phone בפורמט `972XXXXXXXXX` (ללא `+`) | authenticated |
| `spa_staging` | שלב ביניים לייבוא ספא — ממתין לאישור מנהל | authenticated |
| `agent_profiles` | פרופיל AI אחד למנהל | `manager_id = auth.uid()` |
| `agent_memory` | ידע שנחלץ מקבצים | `manager_id = auth.uid()` |
| `chat_history` | היסטוריית שיחה per session_id | open (mock auth compat) |
| `whatsapp_conversations` | שיחות WA נכנסות/יוצאות | `auth.uid() IS NOT NULL` |
| `guest_alerts` | דגלי alert מהבוט | authenticated |
| `bot_config` | הגדרות בוט שורה-שורה (key-value) | admin write |
| `bot_settings` | system_prompt + knowledge_base (id=1) — משפיע על Gemini בלבד | `auth.uid() IS NOT NULL` |
| `message_templates` | תבניות שידור עם sort_order | `auth.uid() IS NOT NULL` |
| `bot_scripts` | סקריפטים מותאמים לכל trigger_event | authenticated |
| `tasks` | משימות צוות | open to authenticated |
| `suite_rooms` | ★ NEW — חדר לכל שורה מ-EZGO Suites CSV. key: `(order_number, res_line_id)`. מקור: DataUpload Tab 1 | authenticated |
| `notification_log` | dedup שליחות WA | service role |
| `schedule_patterns` | דפוסי Excel שנלמדו | |
| `push_subscriptions` | Web Push endpoints | `user_id = auth.uid()` |

### פורמטי טלפון — חיוני להבנה
```
guests.phone    = "+972501234567"   ← E.164, עם + (sanitizePhone בDataUpload)
bookings.phone  = "972501234567"    ← ללא +  (normalizePhoneBookings בDataUpload)
Meta sends from = "972501234567"    ← ללא +  (webhook מוסיף + בעצמו)

⚠️ כשמחפשים bookings מה-webhook — phone.slice(1) כדי להסיר את ה-+
⚠️ לעולם אל תחפש bookings עם phone שמכיל + — הבדיקה תחזיר ריק
```

### עמודות חשובות ב-`bookings`
```
phone          TEXT  — 972XXXXXXXXX (ללא +)
arrival_date   DATE
treatment_time TEXT  — שעת טיפול ספא ("14:00") — נכתב מDataUpload Tab 1 EZGO merge
treatment_type TEXT  — סוג טיפול ("ספא בואטסו" וכו')
status         TEXT  — 'pending' | 'expected' | 'room_ready' | 'checked_in'
```

### עמודות חשובות ב-`guests`
```
phone               TEXT  — +972XXXXXXXXX (E.164)
needs_callback      BOOL  — true = thread הועבר לידי אדם, הבוט שותק
requires_attention  BOOL  — badge אדום בדאשבורד
arrival_confirmed   BOOL  — האורח אישר הגעה
status              TEXT  — 'pending' | 'expected' | 'room_ready' | 'checked_in'
spa_time            TEXT  — שעת ספא ("14:00") — כותב: DataUpload Tab 2 (דוח יומי מקיף)
                            ★ זו העמודה שהwebhook קורא להצגת שעת ספא בהודעת אישור
order_number        TEXT  — מזהה הזמנה מPMS ("266932") — כותב: DataUpload Tab 2
treatment_count     INT   — סה"כ חריצי ספא שהוזמנו — כותב: DataUpload Tab 2

── Flag Guards (whatsapp-send כותב TRUE אחרי שליחה, cron בודק לפני שליחה) ──
msg_pre_arrival_2d_sent   BOOL — pre_arrival_2d (T-2)
msg_pre_arrival_sent      BOOL — night_before (T-1)
msg_morning_suite_sent    BOOL — morning_suite (ביום ההגעה לסוויטות)
msg_morning_welcome_sent  BOOL — morning_welcome (ביום ההגעה לרגילים)
msg_post_checkin_sent     BOOL — butler_1h (שעה אחרי צ'ק-אין)
msg_mid_stay_sent         BOOL — mid_stay (יום שני)
msg_checkout_fb_sent      BOOL — checkout_fb (יום אחרי עזיבה)
```

---

## 6. Edge Functions — תיאור מהיר

### `whatsapp-webhook` v3 — ★ FULLY OVERHAULED (Jun 17 2026)

#### ארכיטקטורת ניתוב — עיקרון יסוד שחייב להישמר
```
לחיצת כפתור (interactive/button_reply)
  → HARDCODED routing בEdge Function בלבד
  → אסור לשלוח ל-Gemini/LLM

הודעת טקסט חופשי
  → intent classification → Gemini (+ system prompt מbot_settings)
  → LLM מטפל בשאלות, מידע, שיחה

bot_settings.system_prompt = AI persona בלבד
  → לא שולט על ניתוב כפתורים, לא על arrival flow
```

#### פייפליין עיבוד הודעה (סדר מדויק)
```
1. Raw payload dump (console.log — לdiagnostics)
2. Parse Meta envelope → msgArr
3. Per message:
   a. DIAGNOSTIC log: type, from, msgId
   b. Extract text/buttonTitle/buttonId לפי msg.type:
      - "text"        → msg.text.body
      - "interactive" → msg.interactive.button_reply.{title, id}
      - אחר           → continue (skip)
   c. Dedup check (whatsapp_conversations.wa_message_id)
   d. Guest lookup (guests table, by phone with +)
   e. DIAGNOSTIC pre-flight log: guestId, needs_callback, isButton
   f. needs_callback gate (ראה פירוט)
   g. Button router (אם isButtonReply)
   h. Text confirmation detection (CONFIRMATION_RE)
   i. Date-change detection (DATE_CHANGE_RE)
   j. Intent classification → Gemini/Claude
```

#### `needs_callback` Gate — Human Handoff
```typescript
// אם guest.needs_callback === true → הבוט שותק (message מתועד, לא נשלחת תשובה)
// OVERRIDE יוצאים מכלל זה:
//   - לחיצת כפתור "כן,מגיעים!" → מנקה needs_callback, ממשיך לbutton router
//   - הקלדת טקסט שמתאים לCONFIRMATION_RE → מנקה needs_callback, ממשיך
// ⚠️ לאפס needs_callback ידנית ב-GuestsPage כשסיימת לטפל באורח
```

#### Button Router — כל הכפתורים הידועים
| כפתור | פעולה |
|---|---|
| "כן,מגיעים!" | `arrival_confirmed=true` → קריאת `guests.spa_time` → תשובה חמה |
| "לא,שינוי בתאריך" | `needs_callback=true`, `requires_attention=true` → handoff message מדויק |
| "ספא/טיפולים" | שליחת `SPA_MENU` כטקסט חופשי |
| "דברו איתי/מענה אנושי" | `needs_callback=true` → "נחזור אליך" |
| "היה מושלם!/מושלמת" | שליחת Google Review URL |
| "יש מקום לשיפור" | `requires_attention=true` → בקשת משוב |
| "נשמע מושלם/שריינו מקום" | `upsell_interest=true` בbookings → צוות ספא |
| "פחות מתאים" | decline graceful |
| כל אחר | generic reply — שום כפתור לא שותק |

#### `spa_time` — מקור האמת לתצוגה בbotה
```
webhook קורא: guests.spa_time (שדה TEXT)
מי כותב: DataUpload Tab 2 → UPDATE guests SET spa_time=? WHERE phone=?
אם NULL: הודעת אישור הגעה לא מזכירה ספא בכלל (Condition B)
אם קיים: "🕐 הטיפול שלך בספא: HH:MM" מוצג (Condition A)

⚠️ lookupSpaTime() שהוזכר בתיעוד קודם — לא קיים בקוד בפועל. לא ממומש.
```

#### Arrival Confirmation Reply — IF/ELSE חיוני
```
יש treatment_time:
  ✅ ברכה חמה + "🕐 הטיפול שלך בספא: [type] בשעה [time]" + workshops link
  ✅ closing: "על הצ׳ק-אין, החדר, הספא"

אין treatment_time (null):
  ✅ ברכה חמה + workshops link בלבד
  ❌ אפס אזכורים של "ספא", "טיפול", "null"
  ✅ closing: "על הצ׳ק-אין, החדר" (ללא הספא)
```

#### LLM Fixes
- **Gemini thought leak**: `rawParts.find(p => !p.thought && typeof p.text === "string")` — מדלג על `thought:true` parts
- **sanitizeReply()**: מנקה `[תבנית:...]` ותגיות פנימיות לפני שליחה לאורח
- **System prompt**: כולל כלל מפורש נגד echo של תגיות פנימיות

#### Caches (module-level, 5 דקות TTL)
- `_configCache` — bot_config table
- `_botSettingsCache` — bot_settings (id=1)
- `_scriptsCache` — bot_scripts table

#### Handoff Message המדויק לdate-change
```
"העברתי את בקשתך לצוות הסוויטות שלנו (אדיר ואפק), והם יצרו איתך קשר בהקדם. 🙏"
```
⚠️ לא לשנות את הנוסח — זה מה שסוכם עם הצוות.

---

### `whatsapp-send` — שליחת WA
- Triggers: `night_before`, `morning_of`, `broadcast`, `manual`, `inbox_reply`
- `inbox_reply` → `{phone, message}` ישיר, ללא guestId

### `generate-schedule` ⚠️ ORPHAN
- **פרוס אבל לא מחובר** — ShiftGenerator קורא `duplicateScheduleLocally()` בלבד

### `whatsapp-cron` — KILL SWITCH ACTIVE
- pg_cron job **"wa-cron"** (jobid: 2) — `*/15 * * * *`, active: TRUE
- לעצור ב-SQL: `SELECT cron.unschedule('wa-cron');` (לא 'whatsapp-triggers' — זה שגוי)
- **KILL SWITCH:** `CRON_ENABLED` env var לא מוגדר → whatsapp-cron מחזיר `{halted: true}` מיידית
- להפעיל מחדש: Set `CRON_ENABLED=true` בSupabase Secrets → Edge Functions
- ⚠️ לפני הפעלה מחדש: הוסף flag guards לnight_before, morning_welcome, morning_suite, butler_1h בcron

---

## 7. AUTH — מי יכול מה

```javascript
// super_admin (בעלים)
SUPER_ADMIN_EMAIL = "tzalamnadlan@gmail.com"   // גישה לכל + UserManagement

// admin
ADMIN_EMAILS = ["promote7il@gmail.com"]        // גישה ל-AdminPanel, BotConfig, BotSettings

// manager — מנהל מחלקה
// לא רואה: AdminPanel, UserManagement, BotConfigPanel, BotSettings

// guardPage pattern (App.js):
guardPage(["admin", "super_admin"], <Component />)
// בודק user.role ואז email-based fallback דרך isAdminUser() / isSuperAdminUser()
```

### מחלקות ברירת מחדל (src/utils/admin.js — מקור האמת)
```javascript
DEFAULT_DEPARTMENTS = ["תפעול", "משק", "קבלה", "ספא", 'מזמ"ש (F&B)', "הנהלה"]
// נשמרות ב-localStorage key: "di_departments"
// ניתנות לעריכה ב-AdminPanel → נטענות ב-App load דרך loadDepartments()
// ⚠️ לא ריאקטיביות — שינוי דורש רענון דף
```

### supabaseClient.js — פונקציות עזר
```javascript
// ייצוא מ-src/supabaseClient.js:
export const supabase               // client או null אם env vars חסרים
export const isSupabaseConfigured   // Boolean — בדוק לפני כל קריאה לDB

export async function loadAgentProfile(userId)     // Supabase → localStorage fallback
export async function saveAgentProfile(profile)    // upsert ב-agent_profiles
export function getLocalCorrections(agentId, n=5)  // last N corrections מ-localStorage
export function appendLocalLearningLog(entry)      // localStorage בלבד
export async function saveLearningLog(log)         // Supabase → localStorage fallback

// localStorage keys:
`agent_profile_${userId}`    // פרופיל סוכן JSON
`learning_logs_${agentId}`   // מערך תיקונים (max 50)
`session_id_${agentId}`      // session ID נוכחי
`di_departments`             // מחלקות מותאמות
```

---

## 8. קונבנציות קוד — חובה לפעול לפיהן

### עברית ו-RTL
- **כל טקסט UI בעברית** — תוויות, כפתורים, הודעות שגיאה
- `direction: rtl`, `text-align: right` תמיד
- Heebo לגוף, Playfair Display לכותרות

### CSS
- **CSS Variables בלבד** — `var(--gold)`, `var(--text-muted)`, `var(--card-bg)` וכו'
- **לא להוסיף צבעים hardcoded** — אם צבע לא קיים ב-`:root`, תאם עם הפלטה
- Hover states — ב-JS עם `useState(null)` לtracking ID (אין CSS Modules)

### קומפוננטים
- `className="card"`, `className="card-header"`, `className="btn btn-primary"` וכו' — classes קיימות ב-App.js CSS
- Toast pattern: `useState(null)` → `setTimeout(null, 3500)`
- Supabase calls: תמיד `.maybeSingle()` לא `.single()` (לא throws על null)
- Edge Functions: תמיד `supabase.functions.invoke()` — לא `fetch` גולמי

### TypeScript בEdge Functions
- TypeScript casts: `(data as Record<string, unknown>).field`
- Error handling: `(e as Error).message`
- תמיד `--no-verify-jwt` בdeploy

### בניה
- **לפני כל commit: `npm run build`** — חייב `Compiled successfully.` ללא warnings
- No unused vars — ESLint יתקע build

---

## 9. קווים אדומים — אסור בהחלט

```
❌ ANTHROPIC_API_KEY לעולם לא ב-REACT_APP_* variables
❌ VAPID_PRIVATE_KEY לעולם לא בפרונטאנד או ב-git
❌ META tokens/credentials לעולם לא בהודעות chat או ב-git
❌ לא להשתמש ב-.single() — משתמשים ב-.maybeSingle()
❌ לא לכתוב fetch() גולמי לEdge Functions — supabase.functions.invoke() בלבד
❌ לא לשנות RLS policies בלי לוודא שלא שוברים גישה קיימת
```

---

## 10. מצב פתוח — דברים שעדיין חסרים

| פריט | מה חסר | רמת דחיפות |
|---|---|---|
| `Chat.js` | קובץ orphan, ממתין למחיקה | נמוך |
| `generate-schedule` | פרוס אבל לא מחובר לפרונטאנד | בינוני |
| Meta Webhook URL | לא מוגדר ב-Meta Business Manager → WhatsApp → Configuration | גבוה |
| `dream_arrival_tomorrow` WA template | לא קיים ב-Meta (כפתור ירוק בשידור שבור) | גבוה |
| ShiftGenerator Gemini "creative mode" | תוכנן, לא מומש — חיבור לgenerate-schedule אם רוצים | בינוני |
| Arrival flow — ייצוב בייצור | הבוט עובד בקוד, טרם אומת E2E בייצור עם לחיצת כפתור אמיתי | גבוה |

### מה הושלם בסשן Jun 18 2026 (session 5 — Golden Guest Profile complete)
- ✅ **Migration 046** — `suite_rooms` table (unique: order_number+res_line_id) + `sync_suite_arrivals` RPC
- ✅ **sync_suite_arrivals RPC** — ACID dual-write: guests + suite_rooms + bookings בטרנזקציה אחת
  - RAISE NOTICE logs לכל שלב (נראים ב-Supabase Dashboard → Logs → Postgres)
  - EXCEPTION WHEN OTHERS THEN RAISE → rollback אוטומטי של הכל
  - לא מחליף: status, spa_time, needs_callback (שדות בוט חיים)
- ✅ **handleEzgoSync** — מזהה Suite CSV (guestPhone בשדה) vs Excel ישן; מנתב בהתאם
  - Suite CSV → supabase.rpc('sync_suite_arrivals') עם payload מלוג
  - Excel grouped → legacy bookings+guests upsert (ללא שינוי)
- ✅ **SuitesDashboard.js** — גריד חדרים מ-suite_rooms, מקובץ לפי order_number
  - badge "פרטי"/"קואורד׳" על כל כרטיס חדר
  - לחיצה על טלפון → clipboard copy
  - פילטר לפי תאריך הגעה
- ✅ **App.js** — route "suites" + nav item 🛏️ (manager-only)
- ✅ **ezgoParser.js preview table** — badge מקור, ספירת טלפונים אישיים, שורות ירוקות

### מה הושלם בסשן Jun 18 2026 (session 2)
- ✅ **Golden Guest Profile** — `parseComprehensiveReport()` פרסר ספר הזמנות יומי (grouped Excel)
- ✅ **DataUpload Tab 2** — מחליף Spa CSV uploader בפרסר דוח יומי מקיף:
  - Auto-detect: grouped Excel (18.6.26.xlsx) vs CSV ישן (sTel/tmStart)
  - Upsert-or-insert: UPDATE לאורחים קיימים (לא מחליף room/suite), INSERT לאורחי ספא יומיים
  - תצוגה מקדימה מלאה: שם, טלפון, הזמנה #, שעת ספא, ספירת טיפולים
- ✅ **Migration 045** — `order_number TEXT`, `treatment_count INT` לטבלת guests
- ✅ **Cron Flag Guards (Option B)** — cron מוגן מפני ghost-triggers:
  - SELECT כולל את כל 7 ה-flags
  - night_before checks `!msg_pre_arrival_sent`
  - morning_welcome checks `!msg_morning_welcome_sent`
  - morning_suite checks `!msg_morning_suite_sent`
  - butler_1h checks `!msg_post_checkin_sent` ← קריטי ביותר (חזר כל 15 דק' בלי flag!)
- ✅ **whatsapp-cron deployed** לSupabase

### מה הושלם בסשן Jun 17 2026
- ✅ Interactive button parser (`msg.type === 'interactive'`)
- ✅ `needs_callback` Human Handoff gate + arrival confirmation override
- ✅ Gemini `thought:true` leak fix + `sanitizeReply()`
- ✅ Arrival reply IF/ELSE — עם ספא / ללא ספא (zero mentions) — קורא guests.spa_time
- ✅ Migrations 028–043 documented
- ✅ Jun 18 2026: automation audit — pg_cron job "wa-cron" מאומת, kill switches פעילים
- ✅ Jun 18 2026: .single() → .maybeSingle() בwebhook (שורה 1311)
- ✅ Jun 18 2026: CLAUDE.md מתוקן: spa_time=עמודה אמיתית בguests, lookupSpaTime=לא קיים
- ✅ Phone format documented (`guests` vs `bookings` vs Meta)

---

## 11. פלטת עיצוב

```css
--gold:        #C9A96E    /* primary accent */
--gold-dark:   #A8843A
--gold-light:  #E8C98A
--black:       #1A1A1A
--ivory:       #F5F0E8    /* page background */
--sidebar-bg:  #0F0F0F    /* dark sidebar */
--border:      #E0D5C5
--card-bg:     #FFFFFF
--text-muted:  (defined in App.js CSS)

/* Status badges */
badge-green  → active / done / checked_in
badge-red    → urgent / open
badge-orange → in progress / warning
badge-blue   → future / info
badge-gold   → admin / VIP
```

---

## 12. פקודות שימושיות

```bash
# Build ובדיקה
npm run build

# Deploy edge function (החלף NAME בשם הפונקציה)
npx supabase functions deploy NAME --no-verify-jwt

# Push migrations
npx supabase db push

# Login (פעם אחת)
npx supabase login
```

---

## 13. כיצד לעבוד עם הפרויקט הזה

**לפני כל עריכה:**
1. קרא את הקובץ הרלוונטי (`Read tool`) — גם אם חשבת שאתה זוכר
2. בדוק שה-`old_string` שלך ייחודי בקובץ לפני Edit
3. אחרי כל שינוי ב-JS — הרץ `npm run build` ואמת `Compiled successfully.`

**בשיחה:**
- אם משהו נראה "תוכנן אבל לא בוצע" — בדוק את קיום הקוד בפועל לפני שאתה מדווח שהוא עובד
- אם יש doubt על DB schema — קרא migration files, לא מזיכרון
- אם שינוי דורש migration חדש — צור קובץ SQL ב-`supabase/migrations/` ורוץ `supabase db push`

---

*מסמך זה מחליף: `SYSTEM_CONTEXT.md`, `REFINEMENT_PLAN.md`, `architect_sync.md` לצרכי AI context.*
*לתיעוד אנושי מפורט — ראה את אותם קבצים.*

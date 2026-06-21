# CLAUDE.md — Dream Island AI System
> קובץ זה נקרא אוטומטית בכל שיחה. הוא מקור-האמת שלך. קרא אותו לפני כל פעולה.
> **עדכון אחרון:** 2026-06-21 (session 15 — תוקנה קיטוע תשובות AI, נוסף Dynamic Model Routing (`bot_settings.preferred_model`), תוקן gate שגוי שחסם לכידת `guest_notes` לאורחים שלא אישרו הגעה, ונוסף console.log פנימי ל-`resolvePlaceholders()` לאיתור spa_time)

---

## 0. חזון הפרויקט ועקרונות יסוד — Project Vision & Core Principles

> המערכת עוברת מ"אוסף פיצ'רים בודדים" ל-**Unified Operational System** — מרכז תפעולי אחד למלון. כל פיצ'ר חדש נמדד מול חמשת העקרונות הבאים לפני שהוא נחשב גמור — לא משנה כמה "הוא עובד".

### DNA — חמשת העקרונות שאינם מתפשרים

1. **ZERO DATA LOSS**
   אסור להשמיט שורה בשקט בייבוא — כל שורה שהועלתה = אורח VIP. שורה שלא ניתן לעבד מוצגת כ"שגויה" עם הסבר; היא לעולם לא נעלמת מהתצוגה בלי עקבות.
   *תבנית קיימת:* `ezgoParser.js` — `aggregateGuestProfiles` משתמש ב-row-index key (לא phone-key) בדיוק כדי שאף שורה לא תיבלע ע"י דה-דופליקציה (hotfix 3.3/3.4).

2. **INTELLIGENT UI — Disable, Don't Hide**
   כפתורי פעולה תפעוליים **לעולם לא נעלמים**. אם פעולה לא חוקית כרגע — הכפתור נשאר גלוי, מנוטרל (greyed out), עם `title` שמסביר למה ומה לעשות כדי לאפשר אותו.
   *תבנית קיימת:* `GuestsPage.js` — לוגיקת Slot 1 / Slot 2 בעמודת "פעולות" (חדר מוכן / צ'ק-אין). זה ה-pattern להעתיק לכל לוח תפעולי עתידי — **לא** switch בלעדי על שם status מדויק.

3. **FAIL VISIBLE**
   לעולם לא להסוות ערך DB לא-צפוי מתחת ל-fallback "תקין-מראה". אם `status` או שדה אחר מכיל ערך לא מוכר — הצג אותו כ-⚠ גלוי בUI, אל תמפה אותו לערך ברירת-מחדל שמסתיר את הבעיה מהצוות.
   *תבנית קיימת:* `GuestsPage.js` — `STATUS_META[g.status] ?? { label: "⚠ " + g.status, ... }` (לא fallback שקט ל-"ממתין").

4. **UNIVERSAL ARCHITECTURE**
   להפסיק לכתוב לוגיקת ייבוא/טבלה נפרדת לכל סוג דאטה (סוויטות, ספא, משמרות עתידיות). הכיוון: "Universal Editable Grid" — קומפוננטה אחת שמקבלת schema (עמודות, validation, key) ומספקת ייבוא + תצוגה + ערוך לכל מקור דאטה.
   *תבנית קיימת:* `EditableGrid.js` — מומש בsession 7, בשימוש ע"י `ArrivalImportPanel.js` (פרופיל suites + פרופיל shifts). כל מקור דאטה עתידי (משמרות, ציוד וכו') אמור לעטוף את הלוגיקה הספציפית שלו ב-EditableGrid הזה, לא לכתוב טבלה משלו.

5. **SINGLE SOURCE OF TRUTH**
   טבלת `guests` היא הפרופיל המוזהב (Golden Profile). כל לשונית בUI קוראת/כותבת אליה. טבלאות אחרות (`suite_rooms`, `bookings`) הן נתוני תמיכה (room/booking metadata) — **לא** מקור סטטוס מקבילי. אם שתי לשוניות מציגות "סטטוס אורח" שונה זה מזה — זה באג, לא feature.
   *תבנית קיימת:* `SuitesDashboard.js` קורא סטטוס חי מ-`guests` (לא ממציא סטטוס מקבילי ב-`suite_rooms`).

⚠️ **פיצ'ר שמפר אחד מהעקרונות האלה נחשב incomplete — גם אם ה-build עובר נקי.**

---

## CORE BUSINESS LOGIC & GUEST UX GUARDRAILS
> נוסף session 12 — שלושה כללי-יסוד לכל קוד שנוגע בשליחת הודעות לאורח (cron, broadcast, webhook reply). לכל כלל יש סטטוס אכיפה אמיתי שנבדק מול הקוד הקיים — לא הנחה. עקרון FAIL VISIBLE (§0.3) חל גם כאן: לא לסמן ✅ אלא אם נקרא הקוד ואומת.

1. **Zero-Spam Policy** — לעולם לא לשלוח broadcast/הודעה אוטומטית אם `needs_callback = true` או שהאורח מבוטל.
   ✅ **סטטוס נוכחי — אכיפה מלאה על כל 7 ה-triggers + cancelled status.** `whatsapp-cron/index.ts` מדלג על אורחים מבוטלים (`if (g.status === 'cancelled') continue;`) ובודק `!g.needs_callback` על כל trigger אוטומטי: `pre_arrival_2d`, `night_before`, `morning_welcome`, `morning_suite`, `mid_stay`, `checkout_fb`, `butler_1h` (session 13 — Jun 20/21 2026). אורח עם `needs_callback=true` **או** `status='cancelled'` **לא יקבל שום הודעה אוטומטית**.
   ✅ **"status = cancelled" — נוסף בsession 13 (migration 051).** `guests.status` כולל כעת: `pending`/`expected`/`room_ready`/`checked_in`/`cancelled`. מנהלים יכולים לסמן אורח כמבוטל דרך AddGuestModal (אופציה "❌ מבוטל" בdropdown הסטטוס) — שימושי לno-shows, החזרים כספיים, או הזמנות שממתינות לשינוי תאריך.

2. **Graceful Fallback** — אם דאטה דינמי (כמו `spa_time`) חסר, להסיר את הplaceholder בניקיון. לעולם לא לשלוח `{{VARS}}` גולמי לאורח.
   ✅ **אכוף לסט הplaceholders המוכר.** `resolvePlaceholders()` (`whatsapp-webhook/index.ts:124-156`) — `{{SPA_LINE}}`/`{{OPTIONAL_SPA_TEXT}}` הופכים ל-`""` כש-`spaTime` חסר; `{{SPA_TIME}}` הלגאסי מוחק את כל המשפט המכיל אותו (regex) במקום להציג ריק/גולמי.
   ⚠️ **אין רשת-ביטחון גנרית.** `sanitizeReply()` (שורה 716) מנקה רק תגיות מרובעות (`[תבנית:...]`) — **אין** regex כוללני שמסיר כל `{{...}}` שנשאר לא-מטופל. אם ייערך script חדש ב-BotScriptEditor עם placeholder שלא קיים ב-`resolvePlaceholders()` (למשל טעות הקלדה, או placeholder חדש שלא נוסף לקוד), הוא יישלח גולמי לאורח בלי שיתפס. **המלצה לסשן עתידי:** להוסיף שורת `.replace(/\{\{[^}]+\}\}/g, "")` בסוף `sanitizeReply()` כרשת ביטחון אחרונה.

3. **Template Awareness** — הודעות מעבר לחלון 24h של Meta חייבות תבנית מאושרת מראש.
   ℹ️ **אכוף-by-design לכל שליחה אוטומטית.** כל ה-triggers הפרואקטיביים (`PIPELINE_TEMPLATE` map + `payment_and_workshops` + `broadcast`, כולם ב-`whatsapp-send/index.ts`) עוברים תמיד דרך `sendViaTemplate` — בלי תלות אם זה בתוך/מעבר ל-24h, פשוט תמיד תבנית. זה שמרני יותר מהדרישה, לא רק תואם לה.
   ⚠️ **לא נבדק אקטיבית בתשובות מנהל (`inbox_reply`).** מענה חופשי של מנהל מ-`WhatsAppInbox.js` (trigger `inbox_reply`) שולח free-text דרך `sendViaMeta` ללא בדיקת "מתי ההודעה האחרונה מהאורח" — אם המנהל עונה מעבר ל-24h, ה-Meta API עצמו ידחה את השליחה (לא raw send שמתעלם מהכלל), אבל המערכת לא מזהירה את המנהל *לפני* השליחה, רק נכשלת אחרי. ⚠️ זה גם תלוי בתיקון session 11 (status:200 + error מפורט) כדי שהמנהל בכלל יראה למה זה נכשל.

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
| AI Fallback | Claude Sonnet 4.6 | ★ session 15: כעת גם default engine אפשרי ב-webhook (`bot_settings.preferred_model`) — לא רק `chat` function. ⚠️ `ANTHROPIC_API_KEY` מוגבל, רוב model names מחזירים 404 — סיכון לא-נפתר, ראה §10 session 15 |
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
│   │   └── ezgoParser.js         IL mobile regex + extractGuestDetails + aggregateGuestProfiles
│   │                                Pure transform — zero Supabase calls. Called from ArrivalImportPanel.js.
│   ├── data/
│   │   ├── demoAgentProfile.js   9.1KB — DreamBot demo profile + opening suggestions
│   │   └── suiteRegistry.js      ★ NEW (session 7) — SUITE_REGISTRY (26 real suites, canonical
│   │                                names) + SUITE_SECTIONS (brand groupings). Single source for
│   │                                every "assign a room" dropdown: ArrivalImportPanel, GuestsPage,
│   │                                RoomBoard, AICopilot.
│   └── components/
│       ├── ShiftGenerator.js     58KB  מחולל משמרות — LOCAL ONLY, אין קריאת Edge Function
│       ├── BroadcastDashboard.js 37KB  שידור WhatsApp — תבניות מ-DB (message_templates)
│       ├── GuestDashboard.js     ★ "ניהול אורחים" (vip_guests route) — pipeline tactical view
│       │                            (כולם / בילוי יומי / לינה). שונה מ-GuestsPage ("צ'ק-אין")!
│       │                            ⚠️ שני קומפוננטות שונות מנהלות אורחים — לא לבלבל בשיחה.
│       │                            session 12: "הוסף אורח" עובר עכשיו דרך AddGuestModal המשותף
│       │                            (לא טופס מקומי מקוצר) — כך שגם אורח שנוסף מכאן מקבל spa_time.
│       ├── UserManagement.js     21KB  ניהול משתמשים
│       ├── AgentChat.js          22KB  שיחה עם סוכן AI
│       ├── AgentQuestionnaire.js 19KB  שאלון הגדרת סוכן
│       ├── WhatsAppInbox.js      18KB  תיבת שיחות WA + bot toggle
│       ├── AdminPanel.js         18KB  לוח בקרה admin
│       ├── ArrivalImportPanel.js ★ NEW (session 7) — Unified Import Hub, היחיד באפליקציה.
│       │                            מורכב מתוך TaskBoard בלבד. 2 פרופילים:
│       │                            "suites" — Suite CSV (+ Daily Report אופציונלי) → EditableGrid
│       │                              (dropdown חדר מ-SUITE_REGISTRY) → sync_suite_arrivals RPC
│       │                            "shifts" — כל Excel → EditableGrid → ייצוא חזרה (ללא DB write)
│       │                            DataUpload.js + DataHub.js נמחקו (session 7) — מוזגו לתוכו.
│       ├── EditableGrid.js       ★ NEW (session 7) — Universal Editable Grid (עקרון #4, §0).
│       │                            exports EditableGrid + BulkEditBar + exportToExcel.
│       │                            column-driven, לא יודע כלום על suites/shifts/guests —
│       │                            כל מקור דאטה עתידי עוטף אותו, לא כותב טבלה משלו.
│       ├── TaskBoard.js          18KB  לוח משימות + ArrivalImportPanel מורכב כאן (managers בלבד)
│       ├── KnowledgeUploader.js  17KB  העלאת מסמכי ידע → agent_memory
│       ├── BotConfigPanel.js     13KB  הגדרות Smart Concierge (bot_config table)
│       ├── BotScriptEditor.js    ★ עורך bot_scripts — message_text + ai_system_prompt + is_active
│       │                            per trigger_event. תומך {{GUEST_NAME}}/{{SPA_TIME}}/{{WORKSHOP_URL}}.
│       │                            נקרא ע"י whatsapp-webhook + whatsapp-send. ראה §10 Phase 6 Audit.
│       ├── GuestsPage.js         "צ'ק-אין" (guests route) — Slot 1/Slot 2 check-in pipeline UI.
│       │                            שונה מ-GuestDashboard ("ניהול אורחים")!
│       │                            session 12: טופס ההוספה/עריכה המלא חולץ ל-AddGuestModal.js.
│       ├── AddGuestModal.js      ★ NEW (session 12) — Universal Add/Edit Guest modal (עקרון #5,
│       │                            §0). שדות: name/phone(חדש בלבד)/arrival_date/spa_time/
│       │                            treatment_count/order_number/room(SUITE_REGISTRY)/status/
│       │                            requires_attention/needs_callback. כותב/קורא guests ישירות
│       │                            (insert חדש / update קיים). בשימוש ע"י GuestsPage.js +
│       │                            GuestDashboard.js — single source of truth לטופס אורח,
│       │                            כך ש-spa_time לא יחסר יותר לאורח שנוסף מ-GuestDashboard.
│       ├── SuitesDashboard.js    "פירוט חדרים" (suites route) — per-room grid מ-suite_rooms,
│       │                            סטטוס חי מ-guests. ⚠️ לא להתבלבל עם RoomBoard ("לוח סוויטות")!
│       │                            session 12: route עדיין קיים אך הוסר מה-Sidebar nav (לא נגיש
│       │                            יותר ל-UI רגיל — ראה §4).
│       ├── RoomBoard.js          ★ קיוסק ניקיון לתפקיד cleaner (+ ניהול דרך "room_board" route).
│       │                            סטטוסים: תפוס/פנוי/לניקיון/בניקיון/ממתין לאישור/תחזוקה —
│       │                            pipeline נפרד לחלוטין מ-guests.status. מקור: room_status table.
│       │                            timer ניקיון חי, מודאל אישור, "ממתין לאישור" = מנוטרל ע"י AICopilot.
│       ├── AICopilot.js          ★ widget צף (פעמון 🔔, bottom-left) לכל manager/admin מחובר.
│       │                            עוקב realtime אחרי room_status='ממתין לאישור' → מציג guest+spa_time
│       │                            → "✓ אשר ושלח הודעה" שולח WhatsApp + מסמן room_status='פנוי'
│       │                            + guests.status='checked_in'. session 7: נבדק שגיאת WA לא נבלעת.
│       ├── SpaStagingPanel.js    "לוח ספא — אישור" (spa_staging route) — triage נפרד ל-spa_staging
│       │                            table: matched/suspicious/no_booking + quick-add. מוזן ע"י
│       │                            email-import-webhook + spa-schedule-webhook (אוטומציה חיצונית —
│       │                            כנראה Make.com). הוחלט בsession 7: נשאר standalone, לא מוזג.
│       │                            session 12: route עדיין קיים אך הוסר מה-Sidebar nav (ראה §4).
│       └── BotSettings.js        ★ מוח הבוט — system_prompt + knowledge_base
│                                    חשוב: משפיע רק על תשובות free-text (Gemini)
│                                    לא משפיע על לחיצות כפתור (hardcoded routing)
├── supabase/
│   ├── migrations/
│   │   ├── 001–027_*.sql        applied ✅
│   │   ├── 028_guests_rls_open_to_all_auth.sql  applied ✅
│   │   ├── 029_room_status.sql                  applied ✅ — room_status table (housekeeping pipeline, RoomBoard)
│   │   ├── 030_guests_pipeline_flags.sql         applied ✅
│   │   ├── 031_treatment_time.sql               applied ✅ — bookings table עם treatment_time/type
│   │   ├── 032_bot_scripts.sql                  applied ✅
│   │   ├── 033_guests_window_tracking.sql        applied ✅
│   │   ├── 034_bot_sales_directives.sql          applied ✅
│   │   ├── 035_spa_staging.sql                  applied ✅ — spa_staging staging table
│   │   ├── 036_room_cleaning_timer.sql           applied ✅
│   │   ├── 037_bot_scripts_calibration.sql       applied ✅
│   │   ├── 038_cleaner_role.sql                 applied ✅ — profiles.role + 'cleaner'
│   │   ├── 039_arrivals_import.sql              applied ✅ — room_count + status לbookings
│   │   ├── 040_upsell_interest.sql              applied ✅
│   │   ├── 041_suite_name.sql                   applied ✅
│   │   ├── 042_guest_index.sql                  applied ✅
│   │   ├── 043_guests_status_pending.sql         applied ✅ — הוסיף 'pending' לstatus check
│   │   ├── 044_guests_spa_time.sql              applied ✅
│   │   ├── 045_golden_guest_profile.sql          applied ✅ — order_number, treatment_count
│   │   ├── 046_suite_rooms.sql                  applied ✅ — suite_rooms table + sync_suite_arrivals RPC
│   │   ├── 047_sync_suite_arrivals_room_denorm.sql  applied ✅ — מרחיב את הRPC לכתוב גם guests.room.
│   │   └── 048_bot_scripts_missing_seeds.sql     applied ✅ — 8 script_key חדשים (fallback_reply,
│   │                                spa_menu, callback_reply, positive/negative_feedback_reply,
│   │                                upsell_accepted/decline_reply, generic_button_reply). ראה §10 session 8.
│   └── functions/
│       ├── chat/                deployed ✅ — Gemini 2.5→Claude fallback
│       ├── generate-schedule/   deployed ✅ ⚠️ ORPHAN — frontend לא קורא אותה
│       ├── generate-agent-profile/ deployed ✅
│       ├── process-knowledge/   deployed ✅
│       ├── push-notify/         deployed ✅
│       ├── whatsapp-send/       deployed ✅ — תומך ב-inbox_reply trigger
│       ├── whatsapp-cron/       deployed ✅ — pg_cron job "wa-cron" פעיל (*/15) ⚠️ KILL SWITCH ON
│       ├── whatsapp-webhook/    ★ deployed ✅ v3 — ראה §6 לתיאור מלא
│       ├── room-clean-notify/   ★ גילוי session 7 — שולח whatsapp-send trigger="room_ready" כשחדר
│       │                            הופך פנוי. נקרא רק מ-RoomBoard's retry button (waState="failed") —
│       │                            לא קורה אוטומטית בפועל; AICopilot הוא המסלול הפעיל ל-room-ready WA.
│       ├── spa-schedule-webhook/ ★ גילוי session 7 — מזין spa_staging מאוטומציה חיצונית
│       └── email-import-webhook/ ★ גילוי session 7 — מזין spa_staging ממייל (כנראה Make.com)
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
  "vip_guests"   → GuestDashboard   // "ניהול אורחים" — pipeline tactical view
  "broadcast"    → BroadcastDashboard
  "wa_inbox"     → WhatsAppInbox
  "guests"       → GuestsPage       // "צ'ק-אין" — Slot 1/Slot 2 check-in UI. ≠ vip_guests!
  "scheduler"    → ShiftGenerator
  "suites"       → SuitesDashboard  // "פירוט חדרים" — per-room grid from suite_rooms. ≠ room_board!
                                    // ⚠️ session 12: route עדיין קיים ב-switch, אבל ה-Sidebar nav item
                                    // הוסר (decluttering) — לא נגיש יותר דרך ה-UI הרגיל, ראה deep-link בלבד
  "room_board"   → RoomBoard        // ★ "לוח סוויטות" — housekeeping kiosk (room_status table)
  "spa_staging"  → SpaStagingPanel  // "לוח ספא — אישור" — standalone, fed by external email/PDF automation
                                    // ⚠️ session 12: כמו "suites" — route קיים, Sidebar nav item הוסר
  "tasks"        → TaskBoard        // ArrivalImportPanel (sole import surface) mounted here
  "bot_config"   → BotConfigPanel   (admin only — guardPage)
  "bot_settings" → BotSettings      (admin only — guardPage)
  "bot_scripts"  → BotScriptEditor  (admin only) // ✏️ session 8 correction: IS in Sidebar nav
                                    // (App.js:1114-1121, admin-only section, "📝 סקריפטי הבוט")
                                    // — earlier docs claiming it was nav-hidden were wrong
  "agent"        → AgentQuestionnaire / AgentChat
  "admin"        → AdminPanel       (admin only)
  "users_mgmt"   → UserManagement   (super_admin only)
}
// ★ session 7: "upload" (DataUpload) ו-"data_hub" (DataHub) הוסרו — מוזגו ל-ArrivalImportPanel.
// AICopilot מורכב גלובלית (לא דרך activePage) לכל user שאינו cleaner — ראה App.js:~2618.
// תפקיד "cleaner": מקבל מסך מלא RoomBoard בלבד (ללא Sidebar) — ראה App.js:~2325.
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
| `bot_settings` | system_prompt + knowledge_base + ★ session 15: `preferred_model` (id=1) — משפיע על כל קריאת AI ב-webhook | `auth.uid() IS NOT NULL` |
| `message_templates` | תבניות שידור עם sort_order | `auth.uid() IS NOT NULL` |
| `bot_scripts` | סקריפטים מותאמים לכל trigger_event | authenticated |
| `tasks` | משימות צוות | open to authenticated |
| `suite_rooms` | חדר לכל שורה מ-EZGO Suites CSV. key: `(order_number, res_line_id)`. מקור: `ArrivalImportPanel.js` (sole import surface) | authenticated |
| `room_status` | ★ גילוי session 7 — pipeline ניקיון נפרד (תפוס/פנוי/לניקיון/בניקיון/ממתין לאישור/תחזוקה). key: `room_id` = שם סוויטה מ-`SUITE_REGISTRY`. נצרך ע"י RoomBoard.js + AICopilot.js | authenticated |
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
room                TEXT  — ★ session 7: כתוב ע"י (1) ArrivalImportPanel's editable grid דרך
                            sync_suite_arrivals RPC (migration 047, "roomDisplay" field — applied ✅)
                            ו-(2) GuestsPage edit modal. ערך = string מ-SUITE_REGISTRY
                            או "Premium Day 1"/"Premium Day 2". GuestsPage עדיין fallback-ת ל-
                            roomByPhone (suite_rooms) לרשומות ישנות שיובאו לפני migration 047.
needs_callback      BOOL  — true = thread הועבר לידי אדם, הבוט שותק
requires_attention  BOOL  — badge אדום בדאשבורד
attention_reason    TEXT  — ★ session 15 (migration 057): "date_change" | "human_callback" | NULL
                            (capture/generic). נכתב ע"י webhook's button router + DATE_CHANGE_RE,
                            נקרא ע"י GuestAttentionBadge.js (משותף ל-GuestsPage+GuestDashboard) כדי
                            להציג 🗓️/📞/🔴 מובחנים במקום נקודה אדומה גנרית אחת לכל הסיבות.
arrival_confirmed   BOOL  — האורח אישר הגעה
status              TEXT  — 'pending' | 'expected' | 'room_ready' | 'checked_in'
                            ⚠️ pipeline תפעולי בלבד — לא לבלבל עם room_status.status (ניקיון)
spa_time            TEXT  — שעת ספא ("14:00") — כותב: ArrivalImportPanel (Doc 1/grid)
                            ★ זו העמודה שהwebhook קורא להצגת שעת ספא בהודעת אישור
order_number        TEXT  — מזהה הזמנה מPMS ("266932") — כותב: ArrivalImportPanel
treatment_count     INT   — סה"כ חריצי ספא שהוזמנו — כותב: ArrivalImportPanel

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
      - "interactive" → msg.interactive.button_reply.{title, id} — free-standing interactive button messages
      - "button"      → msg.button.{text, payload} — ★ session 9: Quick Reply tap on a TEMPLATE message
                         (every broadcast/pipeline send today uses sendTemplate/sendViaTemplate, so THIS
                         is the real-world shape for "כן,מגיעים!"/"לא,שינוי בתאריך" in production — not
                         "interactive"). Was UNHANDLED before session 9 → fell into the catch-all skip
                         below → bot was completely silent on every template button tap. Fixed: now maps
                         into the same buttonTitle/buttonId/isButtonReply variables, so all downstream
                         routing (needs_callback override, button router, bot_scripts lookup) is unchanged.
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
| "לא,שינוי בתאריך" | `needs_callback=true`, `requires_attention=true` + ★ session 10: `human_requested=true, human_request_type="date_change"` על שורת ה-inbound ב-`whatsapp_conversations` (אותו מנגנון בדיוק כמו DATE_CHANGE_RE בטקסט חופשי) → handoff message מדויק |
| "ספא/טיפולים" | שליחת `SPA_MENU` כטקסט חופשי |
| "דברו איתי/מענה אנושי" | `needs_callback=true` + ★ session 10: `human_requested=true, human_request_type="callback"` (תוקן יחד עם date_change — אותו פער) → "נחזור אליך" |
| "היה מושלם!/מושלמת" | שליחת Google Review URL |
| "יש מקום לשיפור" | `requires_attention=true` → בקשת משוב |
| "נשמע מושלם/שריינו מקום" | `upsell_interest=true` בbookings → צוות ספא |
| "פחות מתאים" | decline graceful |
| כל אחר | generic reply — שום כפתור לא שותק |

⚠️ **`human_requested`/`human_request_type`** הם עמודות על `whatsapp_conversations` (per-message, migration 020) — **לא** `guests.needs_callback`. `WhatsAppInbox.js`'s "🔴 מבקש מענה אנושי" קורא רק את `human_requested` על השורה. עד session 10 רק הנתיב של טקסט חופשי (DATE_CHANGE_RE) כתב את זה — לחיצת כפתור הזינה את `guests` נכון אבל לא סימנה את השורה ב-inbox, אז הדגל האדום לא הופיע למרות שה-state התפעולי היה תקין.

★ **session 10:** ה-inbound log הגנרי לכל הכפתורים (שורה אחת, לפני ה-if/else) הוסר ממנו `[כפתור: ]` prefix — נשמר רק טקסט הכפתור הגולמי, כדי שה-Live Chat יראה הודעת משתמש טבעית. **לא** שונה ב-`guest_alerts` (alert log פנימי לצוות, לא ה-chat UI).

#### `spa_time` — מקור האמת לתצוגה בbotה
```
webhook קורא: guests.spa_time (שדה TEXT)
מי כותב: DataUpload Tab 2 → UPDATE guests SET spa_time=? WHERE phone=?
אם NULL: הודעת אישור הגעה לא מזכירה ספא בכלל (Condition B)
אם קיים: "🕐 הטיפול שלך בספא: HH:MM" מוצג (Condition A)

⚠️ lookupSpaTime() שהוזכר בתיעוד קודם — לא קיים בקוד בפועל. לא ממומש.
```

★ **session 10 — דווח כ"spa_time לא מוצג למרות שמוגדר".** קראתי את כל השרשרת (SELECT כולל spa_time ✅, `extractGuestDetails`/חילוץ ✅, `resolvePlaceholders` ✅) — לא נמצא באג בלוגיקה עצמה. שתי תוספות הגנתיות בלי לנחש מה השורש המדויק:
1. `resolvePlaceholders()` — כל regex placeholder הפך tolerant לרווחים פנימיים וcase (`{{\s*OPTIONAL_SPA_TEXT\s*}}/gi` וכו') — מגן מפני type ב-BotScriptEditor כמו `{{ optional_spa_text }}`.
2. נוסף `console.log` דיאגנוסטי בשתי נקודות הקריאה ל-`resolvePlaceholders` (כפתור + טקסט חופשי) שמדפיס את `spa_time` הממשי + אם הסקריפט השמור מכיל בכלל `{{OPTIONAL_SPA_TEXT}}`/`{{SPA_LINE}}` — אם זה יקרה שוב, לוגי הפונקציה (Supabase Dashboard → Functions → Logs) ייתנו תשובה חד-משמעית: ערך guests.spa_time שגוי/null, או placeholder syntax לא תואם בטקסט השמור.

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

#### Meta send timeout → status "failed" vs "timeout" (session 9 fix)
```
לפני session 9: כל timeout/abort בקריאת fetch ל-Meta נתפס כ-"failed" זהה לדחייה
                ממשית מ-Meta. תוצאה אמיתית בפרודקשן: broadcast הציג "נכשלו: 2"
                כששתי ההודעות בכל זאת הגיעו לטלפון — Meta הגיב לאט מ-15 שניות,
                ה-AbortSignal ניתק את החיבור, אבל ההודעה כבר נשלחה בפועל בצד Meta.

אחרי session 9: sendViaMeta/sendViaTemplate (whatsapp-send) + sendReply/sendTemplate
                (whatsapp-webhook) — timeout הועלה ל-25s, ותקלת timeout/AbortError
                מסומנת בנפרד כ-"timeout_no_response" (לא "failed"). הקריאה ל-
                whatsapp-send מחזירה status:"timeout" (ok:false, אבל לא "failed") —
                BroadcastDashboard.js מציג "לא ודאי" כקטגוריה שלישית, נפרדת מ-
                "נכשלו" (עקרון FAIL VISIBLE — §0.3: לא להציג ערך לא-ידוע כ"נכשל"
                בביטחון מזויף).
✅ session 11 — תוקן (היה "פתוח" בsession 9): GUEST_FLAG[trigger] עכשיו נכתב רק
   כש-status הוא "sent"/"simulated" — לא עוד "failed"/"timeout". בנוסף, בדיקת
   ה-idempotency ב-BRANCH D (notification_log existence check) משתמשת כעת ב-
   `.in("status", ["sent","simulated"])` במקום סתם "יש שורה כלשהי" — שורת "failed"
   קודמת **לא** חוסמת ניסיון חזרה בcron הבא. (status="timeout" עצמו לא נכתב היה
   בכלל לפני session 11 — ראה למטה.)
```

#### notification_log.status CHECK constraint widened (migration 050, session 11)
```
migration 006 הגדירה CHECK (status IN ('sent','simulated','failed')) — בלי 'timeout'.
session 9 הוסיפה status:"timeout" בקוד בלי לעדכן את ה-constraint → כל insert עם
status='timeout' נכשל בשקט (ה-insert לא נבדק ל-error) — השורה פשוט לא נכתבה.
migration 050 הרחיבה את ה-constraint ל-('sent','simulated','failed','timeout').
```

#### `.single()` → `.maybeSingle()` + always-HTTP-200 (session 11 fix)
```
שלושת ה-guest lookups ב-whatsapp-send (BRANCH B/D/E) השתמשו ב-.single() —
מפר את הקו האדום ב-§9. תוקן לכולם ל-.maybeSingle() + הודעת שגיאה מפורטת
(כוללת guestId/שם) במקום "guest_not_found" גנרי.

★ ממצא חשוב יותר: ה-outer catch (סוף הפונקציה) החזיר status:400 — היחיד בכל
הקודבייס שלא עוקב אחר הקונבנציה "Always HTTP 200, error בbody" (chat,
get-wa-templates, suggest-import-mapping כולם 200). תוצאה: supabase-js תמיד
זרק את ה-wrapper הגנרי "Edge Function returned a non-2xx status code" —
ה-data.error המפורט בפועל אף פעם לא הגיע ל-frontend. תוקן ל-200 — עכשיו
BroadcastDashboard.js יציג את הסיבה האמיתית (guest_not_found/guest_no_phone/וכו').
```

### `generate-schedule` ⚠️ ORPHAN
- **פרוס אבל לא מחובר** — ShiftGenerator קורא `duplicateScheduleLocally()` בלבד

### `whatsapp-cron` — KILL SWITCH ACTIVE
- pg_cron job **"wa-cron"** (jobid: 2) — `*/15 * * * *`, active: TRUE
- לעצור ב-SQL: `SELECT cron.unschedule('wa-cron');` (לא 'whatsapp-triggers' — זה שגוי)
- **KILL SWITCH:** `CRON_ENABLED` env var לא מוגדר → whatsapp-cron מחזיר `{halted: true}` מיידית — **עדיין כך כיום (session 10)**
- להפעיל מחדש: Set `CRON_ENABLED=true` בSupabase Secrets → Edge Functions
- ✅ תוקן תיעוד (session 10): השורה הקודמת כאן טענה ש"צריך להוסיף flag guards לפני הפעלה מחדש" — שגוי. נקרא הקוד בפועל (`whatsapp-cron/index.ts`): flag guards (`!msg_pre_arrival_sent`/`!msg_morning_welcome_sent`/`!msg_morning_suite_sent`/`!msg_post_checkin_sent`/`!msg_mid_stay_sent`/`!msg_checkout_fb_sent`) **כולם קיימים כבר** — נוספו בsession 2, ראה היסטוריה למטה. אין פעולה נדרשת כאן מעבר להגדרת `CRON_ENABLED=true`.
- ★ **session 10 — נמצא תוך אימות:** `morning_welcome`/`morning_suite` **לא** תלויים ב-`guests.arrival_confirmed` בכלל — התנאי היחיד הוא `arrival_date === today` + `room_type` + flag guard.
- ✅ **session 11 — תוקן:** נוסף `!g.needs_callback` לשני התנאים (`morning_welcome` + `morning_suite`, ששניהם שולחים `dream_welcome_morning`) — אורח עם `needs_callback=true` (למשל לחץ "לא,שינוי בתאריך") כבר **לא** מקבל את הודעת "בוקר ההגעה". `needs_callback` נוסף ל-SELECT של ה-cron. החלטת Mike מאומתת.

---

## 7. AUTH — מי יכול מה

```javascript
// super_admin (בעלים)
SUPER_ADMIN_EMAIL = "tzalamnadlan@gmail.com"   // גישה לכל + UserManagement

// admin
ADMIN_EMAILS = ["promote7il@gmail.com"]        // גישה ל-AdminPanel, BotConfig, BotSettings

// manager — מנהל מחלקה
// לא רואה: AdminPanel, UserManagement, BotConfigPanel, BotSettings

// cleaner — ★ גילוי session 7 (migration 038). תפקיד נפרד, לא admin/manager/staff.
// user.role === "cleaner" → מסך מלא RoomBoard, ללא Sidebar (App.js:~2325).
// משובץ ע"י AdminPanel → UserManagement (לא אוטומטי).

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

## 10. סטטוס חי ומפת דרכים — Live Status & Roadmap
> זו "מסך המצב" החי של הפרויקט — עדכן בסוף כל סשן עבודה. עקרון FAIL VISIBLE (§0) חל גם על תהליך העבודה עצמו, לא רק על קוד.

### ✅ הושלם ומאומת

| תחום | סטטוס | הערה |
|---|---|---|
| ייבוא נתונים יומי (Sprint 3) | Completed & committed | 28/28 שורות נטענות ע"י row-index key ב-`ezgoParser.js`; group extraction מ-sRemark; שני מסמכים independent uploads |
| Golden Guest Profile + suite_rooms sync | Completed & committed | `sync_suite_arrivals` RPC — ACID dual-write guests+suite_rooms+bookings |
| UI/UX צ'ק-אין — "Disable, Don't Hide" | ✅ Completed & committed (302803c), pushed ל-main | `GuestsPage.js` + `SuitesDashboard.js` — ממתין ל-QA חי שלך בפרודקשן (Vercel auto-deploy מ-main) |
| webhook status bug (STEP 1) | ✅ Fixed, committed, pushed, **ופרוס בפועל** | שתי כתיבות `status: "Approved"`/`"Human_intervention_required"` הוסרו מ-`whatsapp-webhook/index.ts` (session 7, בנתיב לחיצת כפתור). `arrival_confirmed`/`needs_callback`+`requires_attention` הם המקור היחיד למצב הזה כעת. |
| webhook status bug — נתיב שני (session 8) | ✅ Fixed, deployed | סשן 7 תיקן רק את נתיב לחיצת הכפתור (שורה 976). שורה 1160 (אישור הגעה ע"י **הקלדת** "כן" ולא לחיצת כפתור) עדיין כתבה `status: "Approved"` — ערך לא חוקי מול ה-CHECK constraint. הוסר, נשאר רק `arrival_confirmed: true`. נפרס ב-`supabase functions deploy whatsapp-webhook`. |
| Phase 6 Bot Brain seed completion | ✅ Completed, applied, deployed | migration 048 — 7 script_key חדשים שהwebhook כבר קרא אך לא היו ניתנים לעריכה (`fallback_reply`, `spa_menu`, `callback_reply`, `positive_feedback_reply`, `negative_feedback_reply`, `upsell_accepted_reply`, `upsell_decline_reply`) + 8. `generic_button_reply` שלא היה אפילו DB lookup עבורו (נוסף קוד + seed). כל הטקסטים הוזרעו זהים למחרוזות hardcoded הקיימות — אין שינוי התנהגות, רק נפתחה אפשרות עריכה. ראה §10 session 8. |
| איחוד ייבוא נתונים ל-Task Board | ✅ Completed & committed (302803c), pushed ל-main | `DataUpload.js` + `DataHub.js` נמחקו. `ArrivalImportPanel.js` (בתוך TaskBoard) הוא משטח הייבוא היחיד באפליקציה — ראה §3. |
| Universal Editable Grid (עקרון #4) | ✅ מומש לראשונה, committed | `EditableGrid.js` — חולץ מ-DataHub, בשימוש ב-ArrivalImportPanel (suites + shifts profiles) |
| guests.room denormalization | ✅ Completed — migration 047 applied לDB החי | sync_suite_arrivals RPC כותב guests.room ישירות (לא רק suite_rooms) |
| GuestsPage room dropdown | ✅ Completed | עובר מ-suite_rooms-derived ל-SUITE_REGISTRY ישיר — מבטל כפילויות, "Premium Day 1/2" קבועים |
| AICopilot WhatsApp send — fail visible | ✅ Completed | `handleApprove` בודק את `{error}` מ-`whatsapp-send` invoke; בכשל — toast שגיאה, ה-alert לא נעלם, room_status/guests.status לא מתקדמים |
| Sidebar decluttering (session 12) | ✅ Completed, committed (2c7b15d), pushed ל-main | "פירוט חדרים" (`suites`) ו"לוח ספא — אישור" (`spa_staging`) הוסרו מ-`allNavItems` ב-`App.js`'s `Sidebar`. ה-route+component עדיין קיימים (deep-link בלבד) — ראה §4. |
| Universal AddGuestModal (עקרון #5, session 12) | ✅ Completed, committed (2c7b15d), pushed ל-main | `AddGuestModal.js` חולץ מ-GuestsPage.js (כל השדות, כולל `spa_time`/`treatment_count`/`order_number`) ומוזרק גם ל-GuestDashboard.js, שהחליף את הטופס המקוצר שלו (`AddGuestForm`) שלא היה לו `spa_time` — סוגר את פער ה-Single Source of Truth שתואר ב-Phase 6/§0.5. |
| AddGuestModal — `room_type` + `departure_date` (session 12 follow-up) | ✅ Completed | שדות שחסרו מהאיחוד הראשוני נוספו, עם validation שתאריך עזיבה לא לפני תאריך הגעה. |
| webhook optional-placeholder regression (session 14) | ✅ Fixed, deployed | Cline שינה את `{{OPTIONAL_SPA_TEXT}}`/`{{SPA_LINE}}` ממשפט-משנה אופציונלי למשפט קשיח שתמיד מוחזר — בסתירה ל-docstring. הוחזר לחוזה המתועד. |
| `.catch()` על Postgrest builder — "שגיאת שליחת אוטומציה" (session 14) | ✅ Fixed, deployed | באג ישן (commit a2e0cef, 15 ביוני) שנחשף ע"י תיקון session 11 (HTTP 200 + הודעת שגיאה מפורטת). 6 מופעים תוקנו ב-whatsapp-send + whatsapp-webhook. |
| Onboarding Loop — trigger חסר על auth.users (session 14) | ✅ Fixed, deployed | `handle_new_auth_user()` הוגדרה 4 פעמים אך אף migration לא חיברה אותה ל-`auth.users`. migration 052 מוסיפה את ה-CREATE TRIGGER + backfill. `DepartmentOnboardingModal` עבר ל-upsert + banner שגיאה גלוי. `loadUserWithProfile`'s `.single()` → `.maybeSingle()`. |
| תשובות AI קטועות מיד-משפט (session 15) | ✅ Fixed, deployed | `askGemini`'s `maxOutputTokens` 400→1000; הוסרה הוראת-קיצור hardcoded ("2–4 משפטים בלבד") שנספחה לכל קריאה (`askGemini` + `callClaude`) אחרי הפרסונה המוגדרת ע"י Mike — סתרה אותה ישירות. `callClaude`'s `max_tokens` 800→1000 לעקביות. |
| Dynamic Model Routing — `bot_settings.preferred_model` (session 15) | ✅ Fixed, deployed | migration 055 מוסיפה את העמודה. `resolveModelRoute()` חדש ב-webhook ממפה ערך ל-engine; `askGemini()` מקבל `modelOrder?` אופציונלי. ⚠️ **דיפולט = "claude"** לפי בחירה מפורשת של Mike, חרף הסיכון המתועד (`ANTHROPIC_API_KEY` מוגבל — ראה §2) — ה-safety net (failover לengine השני בכשל) נשאר פעיל בשני הכיוונים, כך שכשל לא יוצר שקט מלא לאורח. |

### 🟡 חלקי / דורש אימות

| תחום | סטטוס | הערה |
|---|---|---|
| WhatsApp Automation — שכבת שליחה | חלקי | `AUTOMATION_ENABLED=true` הוגדר ב-Secrets → משפיע **רק** על `whatsapp-send` (שליחות יזומות: room_ready, payment_and_workshops; inbox_reply תמיד פטור). ⚠️ **לא** משפיע על ה-cron התקופתי — `whatsapp-cron` חסום בנפרד ע"י kill switch עצמאי (`CRON_ENABLED`, עדיין לא מוגדר). night_before/morning_welcome/morning_suite/butler_1h **לא ישלחו** עד שגם הוא יופעל. |
| תבניות Meta מאושרות | לאמת | שמות נוכחיים בקוד (`whatsapp-send/index.ts:57-61`): `dream_arrival_confirmation` (T-2), `dream_checkin_reminder_v2` (T-1/night_before), `dream_welcome_morning` (יום הגעה — suite+standard). יש לאמת מול Meta Business Manager לפני הפעלת ה-cron. ⚠️ **שינוי טקסט עונתי** (session 11): כל שינוי בגוף הודעה של תבנית מאושרת (למשל "השמש בחוץ" → ניסוח חורפי ל-`dream_welcome_morning`) **דורש אישור Meta מחדש** — התבנית פעילה *מחוץ* לחלון 24 השעות, אז אי אפשר לסמוך על free-text. אל תניחו שהשינוי חי עד שהסטטוס ב-"📋 ניהול תבניות" חוזר ל-APPROVED. ראה הערה זהה ב-`whatsapp-send/index.ts` מעל `PIPELINE_TEMPLATE`. |
| SpaStagingPanel automation | ★ גילוי session 7 | מוזן ע"י `email-import-webhook` + `spa-schedule-webhook` — לא ברור באיזו פלטפורמת אוטומציה חיצונית (סביר Make.com) השרשור עצמו רץ. לא נחקר השרשור החיצוני, רק נקודות הקצה ב-Supabase. |

### מפת דרכים — השלבים הבאים

1. ~~STEP 1: webhook status fix~~ ✅ Done, committed, pushed, deployed — ראה טבלה לעיל.
2. ~~STEP 2a: Push migration 047~~ ✅ Done — applied לDB החי ב-session 7.
3. ~~STEP 2b: Deploy whatsapp-webhook~~ ✅ Done — `supabase functions deploy whatsapp-webhook --no-verify-jwt` הורץ ב-session 7.
4. **STEP 2c:** בדיקת E2E מלאה של webhook עם לחיצת כפתור אמיתית בפרודקשן (QA חי — באחריות Mike) — כל הקוד פרוס, נשאר רק QA אנושי.
5. ~~STEP 3: Universal Editable Grid~~ ✅ Done — `EditableGrid.js` מומש, ראה טבלה לעיל.
6. **STEP 4:** הפעלת `CRON_ENABLED` — רק אחרי אימות שלוש תבניות ה-Meta ו-QA מלא ל-STEP 2c.

### 🤖 Phase 6 — Bot Brain Audit (session 7, seed gap closed session 8)

**1. איפה הסקריפטים/חוקים/ידע מאוחסנים?**

שלוש טבלאות DB, כולן עם admin UI קיים:
- `bot_config` (migration 015) — key-value: persona, knowledge (שעות, WiFi, שירותים), templates, rules. נערך ב-`BotConfigPanel.js`.
- `bot_settings` (migration 018) — שורה יחידה (id=1): `system_prompt` + `knowledge_base`, מוזרק לכל קריאת Gemini. נערך ב-`BotSettings.js`.
- `bot_scripts` (migration 032 + 048) — שורה per `script_key` (לא רק per trigger_event — כל הודעה קונקרטית = שורה נפרדת). `trigger_event` ערכים: `arrival_confirmed`, `morning_of`, `ongoing`, `complaint`, `upsell`, `fallback`, `button_reply`. `message_text` עם placeholders (`{{GUEST_NAME}}`, `{{SPA_LINE}}`/`{{OPTIONAL_SPA_TEXT}}`/`{{SPA_TIME}}`, `{{WORKSHOP_URL}}`, `{{GOOGLE_REVIEW_URL}}`) + `ai_system_prompt` + `is_active`. נערך ב-**`BotScriptEditor.js`**. session 8: כל 8 ה-`script_key`-ים שהwebhook קורא יש להם כעת שורה (ראה טבלה למטה).

כל השלוש נקראות ב-runtime ע"י `whatsapp-webhook` + `whatsapp-send` (cache 5 דקות, module-level).

**2. מה מוסתר ולא ניתן לערוך דרך ה-admin UI?**

- `FALLBACK_SYSTEM_PROMPT` (`whatsapp-webhook/index.ts:58`) — hardcoded, אבל **כבר fallback אחרון בלבד**: הקוד עושה `cfg["bot_personality"] ?? FALLBACK_SYSTEM_PROMPT` (שורה 216) — כל עוד `bot_config.bot_personality` קיים (וזה מאוכלס ע"י migration 015), הfallback הזה לא מופעל בפועל.
- ✅ **session 8 — נסגר.** `FALLBACK_REPLY` (`whatsapp-webhook/index.ts:395-397`) ועוד 6 script_key נוספים (`spa_menu`, `callback_reply`, `positive_feedback_reply`, `negative_feedback_reply`, `upsell_accepted_reply`, `upsell_decline_reply`) היו עם DB lookup אבל בלי שורה לערוך — וכפתור אחד (unmatched/generic) לא ניסה אפילו לקרוא מה-DB. migration 048 הזריעה את כל 8 השורות (טקסט זהה להardcoded הקיים — אין שינוי התנהגות), ושורת קוד אחת נוספה ל-unmatched-button כדי שתקרא מה-DB. כל script_key שwebhook קורא — ניתן לעריכה כעת.
- Regex patterns (COMPLAINT_PATTERNS, UPSELL_PATTERNS, HUMAN_CALL_PATTERNS, DATE_CHANGE_RE) — hardcoded בכוונה. אלו לוגיקת **זיהוי כוונה**, לא טקסט תשובה — הזזה ל-DB תדרוש UI לעריכת regex, לא מומלץ.
- ⚠️ צימוד שביר: `whatsapp-webhook/index.ts:282-286` בודק substring ("איזה כיף", "בוקר אור") בהיסטוריית שיחה כדי לדעת אם stage מסוים נשלח כבר. אם תערוך/י את הטקסט של `stage_2_arrival`/`stage_3_morning` ב-BotScriptEditor כך שלא יכיל את אחת המחרוזות האלה — הבדיקה הזו תפסיק לעבוד בשקט (לא תזהה ששלב נשלח). FAIL VISIBLE לא חל כאן עדיין — לא נגעתי בקוד הזה בsession 7, רק מתעד.

**3. ארכיטקטורה לסשן הבא — ניהול סקריפטים מה-Admin Dashboard:**

לא היה צריך לבנות מערכת חדשה — `BotScriptEditor.js` + `bot_scripts` **כבר עושים את זה**, וsession 8 השלים את ה-seed (ראה למעלה). מה שנשאר אופציונלי:
- שקול UI חדש בתוך BotScriptEditor (או panel נפרד) לעריכת ה-regex patterns כ"keyword lists" ניתנים לעריכה (לא raw regex) — אם רוצים שליטה על זיהוי כוונה בלי redeploy. לא בוצע — feature נפרד וגדול יותר.
- אין צורך במיגרציה נוספת — הסכמה הקיימת (`message_text`, `ai_system_prompt`, `is_active`, `trigger_event`) מספיקה לכל script_key עתידי.

### פריטים פתוחים אחרים

| פריט | מה חסר | רמת דחיפות |
|---|---|---|
| `Chat.js` | קובץ orphan, ממתין למחיקה | נמוך |
| `generate-schedule` | פרוס אבל לא מחובר לפרונטאנד | בינוני |
| Meta Webhook URL | לא מוגדר ב-Meta Business Manager → WhatsApp → Configuration | גבוה |
| `whatsapp-cron` (`CRON_ENABLED`) | קיל-סוויץ' נפרד, לא מוגדר — ראה STEP 4 | גבוה |
| ShiftGenerator Gemini "creative mode" | תוכנן, לא מומש — חיבור לgenerate-schedule אם רוצים | בינוני |
| Regex intent patterns (COMPLAINT/UPSELL/HUMAN_CALL/DATE_CHANGE) | hardcoded בכוונה — UI לעריכת keyword-lists לא בוצע, ראה Phase 6 Audit §3 | נמוך |
| Resilient Import Agent — **מושהה באמצע** (session 9) | `suggest-import-mapping` Edge Function + `import_mapping_memory` table (migration 049) **פרוסים בפועל** ב-Supabase, אבל שינויי הפרונטאנד (`ArrivalImportPanel.js`, `MappingReviewPanel.js`, `importMapper.js`, פרמטריזציית `ezgoParser.js`) **לא commit-ים, לא pushed** — קיימים רק ב-working tree המקומי. יש גם debug-branch זמני (`if (debug)`) ב-`suggest-import-mapping/index.ts` שצריך להסיר לפני שמחליטים שזה "מוכן". המשך/סגור בסשן נפרד. | בינוני |

---

### היסטוריית סשנים

#### session 15 — Jun 21 2026 (Truncated AI replies fix + Dynamic Model Routing + guest_notes capture gate + spa_time debug)
> הקשר: Mike עיצב פרסונת AI עברית עשירה ופרמיומית מחדש ב-BotSettings, אבל הבוט המשיך לקטוע תשובות באמצע מילה ("אנו שמ..."). בנפרד, Mike רצה ארכיטקטורת ניתוב מודלים גמישה (Gemini/Claude) לבדיקות A/B ואופטימיזציית עלות. בהמשך אותו סשן, Live QA חשפה ששמירת "guest_notes" אוטומטית לא קרתה בפועל, ושעת ספא עדיין לא הופיעה בתשובות.

- 🐛→✅ **קיטוע תשובות AI נמצא ותוקן:** שני גורמים מצטברים. (1) `askGemini()`'s `generationConfig.maxOutputTokens` היה `400` — תקרה פיזית לפלט. (2) הוראת-קיצור hardcoded **בעברית** (לא אנגלית כמו ש-Mike חשד) נספחה לכל קריאה *אחרי* הפרסונה המוגדרת: `"(ענה בעברית, 2–4 משפטים, נימה פרמיום)"` ב-`askGemini`'s per-turn suffix, ו-`"ענה תמיד בעברית. 2–4 משפטים בלבד. נימה פרמיום."` ב-`callClaude`'s system suffix — שתיהן **סתרו ישירות** את הפרסונה העשירה החדשה. תוקן: `maxOutputTokens`→1000, שתי ההוראות קוצרו ל-"ענה בעברית" בלבד (שמירה על שומר-שפה, הסרת מגבלת המשפטים). `callClaude`'s `max_tokens` הועלה 800→1000 לעקביות (אותו pipeline fallback). `sanitizeReply()` נבדק ונמצא נקי — לא חותך טקסט, רק מסיר תגיות `[תבנית:...]`.
- ✅ **אומת (לא תוקן — לא היה צריך):** סדר עדיפות `finalSystemPrompt` (`bot_settings.system_prompt` > `bot_scripts.ongoing_concierge` > `buildSystemPrompt(bot_config)`) כבר נכון לפני הסשן — הפרסונה החדשה של Mike כבר זוכה לעדיפות מלאה. אומת ע"י קריאת קוד, לא ניחוש.
- 🏗️ **Dynamic Model Routing — נוסף בהסכמה מפורשת, חרף סיכון מתועד:** `bot_settings.preferred_model` (migration 055, TEXT, ללא CHECK — תוקף נבדק בקוד מול `GEMINI_MODELS`/`CLAUDE_MODEL`, לא ב-DB, כי הרשימה משתנה בזמן). `resolveModelRoute()` חדש ב-webhook ממפה את הערך ל-`{engine, geminiOrder}`: ערך = שם מודל Gemini ידוע → אותו מודל מנסה ראשון, שאר השרשרת `GEMINI_MODELS` נשארת fallback (לא מוחלפת — שומר על חוסן 404 קיים). ערך `"claude"` → Claude מנוסה ראשון. ריק/לא-מוכר → **דיפולט ל-"claude"**, לפי בחירה מפורשת של Mike — **לא** ההמלצה שלי (Gemini-first היה ה-default הבטוח יותר נוכח `ANTHROPIC_API_KEY` המתועד כ"מוגבל, רוב model names מחזירים 404" ב-§2). ⚠️ **דגל סיכון פתוח:** אם המגבלה הזו עדיין נכונה היום, Claude כdefault גלובלי (לא רק fallback-on-error כמו עד היום) עלול לפגוע בכל תשובה, לא רק במקרה קיצון. **ה-safety net ממתן את הסיכון אך לא מבטל אותו:** קריאת ה-engine הנבחר עטופה ב-try/catch סימטרי — כשל ב-Claude נופל אוטומטית ל-`askGemini(GEMINI_MODELS)` (ולהפך) לפני ה-FALLBACK_REPLY הסטטי, כך שאף הודעת אורח לא נשארת בלי מענה. נוסף `console.info("[webhook] model route: engine=... preferred=...")` לצד ה-log הקיים של `prompt source` — נדרש כדי לדעת בכלל איזה engine טיפל באיזו הודעה לצורך הערכת A/B test.
- ⚠️ **לא בוצע (מחוץ לסקופ הסשן):** אין שדה UI ב-`BotSettings.js` לעריכת `preferred_model` עדיין — קביעה דורשת SQL/Supabase Studio ישיר עד שתיווסף בקרת טופס. ערכים תקפים כרגע: `"claude"`, או אחד מ-`GEMINI_MODELS` (`gemini-2.0-flash-lite`, `gemini-2.0-flash`, `gemini-2.5-flash`, `gemini-1.5-flash`).
- ⏸ **לא בוצע (ממתין לאישור נפרד):** תוכנית תיקון ה-dedup ב-`WhatsAppInbox.js` (טלפונים בפורמט מעורב `+972.../972...` יוצרים thread כפול בLive Chat) אושרה עקרונית באותו סשן אך **לא יושמה** — ממתינה לסשן הבא.
- 🐛→✅ **"guest_notes לא נשמר" — לוגיקת הלכידה כבר הייתה קיימת בקוד (כתיבה לא-מתועדת מסשן קודם), הבאג היה gate שגוי, לא לוגיקה חסרה:** Mike דיווח ש-"רוצה בלונים ליום הולדת" קיבל תשובה יפה מהבוט אבל לא נשמר לשום מקום. נמצא: בלוק לכידה (`whatsapp-webhook/index.ts`, ליד שליחת התשובה) כן קיים וכן פרוס, אבל מוגן ב-`guest?.arrival_confirmed === true` — אורח שלא אישר הגעה עדיין (התרחיש הנפוץ ביותר לבקשה מוקדמת!) נופל בשקט. `classifyIntent()` אומת: "בלונים ליום הולדת" מסווג כ-`"faq"` (לא תואם complaint/upsell patterns), כך שה-gate היחיד שחסם היה `arrival_confirmed`. **תוקן:** הוסר התנאי הזה לחלוטין — נשאר רק `guestId` + `intent∈{faq,fallback}`. נמנעה בכוונה בנייה כפולה של מנגנון לכידה שני (היה יוצר כתיבות כפולות) — תוקן ה-gate הקיים בלבד.
- ✅ **הוראת "אשר לאורח שנשמר" — נוספה בשתי שכבות, לא רק בקוד:** Mike בקש להוסיף ל-system prompt "CRITICAL: אם האורח מעלה בקשה... אשר לו שזה נשמר... ובאופן שקט הבטח שהמערכת לוכדת זאת." הניסוח המקורי שונה במכוון: ל-AI אין יכולת "להבטיח לכידה" — הלכידה היא קוד דטרמיניסטי שרץ ללא תלות בתשובת ה-AI; ה-AI יכול רק *לאשר בתשובה* שזה נרשם (אמירה נכונה כעת, אחרי תיקון ה-gate). נוסף לשתי שכבות: (1) `buildSystemPrompt()`'s "הנחיות חשובות" (סעיף 10 חדש) + `FALLBACK_SYSTEM_PROMPT` — קוד, מגרסה לגרסה. (2) **migration 056** — UPDATE אידמפוטנטי (guard ע"י `NOT LIKE`) שמצרף (לא מחליף) את אותה הנחיה ל-`bot_settings.system_prompt` **החי** — חיוני כי `finalSystemPrompt` מעדיף את השורה הזו ב-DB על פני קוד (ראה session 15 לעיל); תיקון קוד בלבד לא היה משפיע על הבוט הפעיל בפועל.
- 🔍 **spa_time עדיין חסר — אומת שהקוד מוצא את הערך, נוסף console.log פנימי לפי בקשת Mike:** `guests` SELECT כולל `spa_time` (שורה קיימת), ויש כבר דיאגנוסטיקה ענפה מסשן 10 בשתי נקודות הקריאה (`🩺 resolvePlaceholders input` + אזהרה אם ל-script אין placeholder ספא בכלל). נוסף `console.log` **בתוך** `resolvePlaceholders()` עצמה (לא רק בנקודות הקריאה) שמדפיס את `spaTime`/`spaLine`/`optionalSpaText` המחושבים, לפי בקשה מפורשת. **לא אובחן עוד באג קוד** — אם הספא עדיין לא מופיע, הסיבה היא או (א) `guests.spa_time` ריק בפועל ל-DB record הספציפי שנבדק, או (ב) הטקסט השמור ב-`bot_scripts.stage_2_arrival` לא מכיל אף אחד מ-`{{SPA_LINE}}`/`{{OPTIONAL_SPA_TEXT}}`/`{{SPA_TIME}}` — שני המקרים יופיעו עכשיו בבירור בלוגי הפונקציה (Supabase Dashboard → Functions → Logs).
- ✅ `npx supabase db push` (migrations 055 + 056 applied) + `npx supabase functions deploy whatsapp-webhook --no-verify-jwt` (שלוש פעמים בסה"כ בסשן — קיטוע, routing, guest_notes+spa debug) — הכל פרוס בייצור.
- 🐛→✅ **המשך אותו סשן — Live QA חזרה עם שני ממצאים נוספים.** (1) **guest_notes "כהה" ל-UI:** הלכידה ב-DB עבדה (אושר בצילום מסך), אבל `WhatsAppInbox.js` מעולם לא קרא/הציג `guest_notes` — ה-`guests(name)` embedded select בשתי נקודות הקריאה (`fetchAll`/`fetchSince`) לא כלל את העמודה. תוקן: `guests(name, guest_notes)` + `normalise()` + `groupByPhone()` (עדכון "last-write-wins" ל-`guestNotes` בלבד — בכוונה **לא** אותה לוגיקת "first-row-wins" כמו `guestName`, כי guest_notes הוא append-only וצומח עם הזמן; "last wins" משקף את התוכן הטרי ביותר). נוסף banner "📝 הערות אורח" גלוי מתחת לכותרת ה-thread, מוצג אוטומטית כשנכנסים לשיחה — לא דורש קליק נוסף.
- 🐛→✅ **(2) spa_time "ghost data" — בדיקה חוזרת אישרה ששתי הנחות הבדיקה הקודמות (SELECT + מיפוי `{{SPA_TIME}}` case-insensitive) כבר היו תקינות — לא נמצא שם באג. נמצא באג אמיתי שונה:** `buildGuestStageContext()` (הconteext שמוזרק ל-AI לכל תשובת free-text) **מעולם לא כלל `spa_time`** — נבדק ע"י קריאת הפונקציה במלואה. כך, אורח ששואל על שעת הספא בשיחה חופשית (לא דרך לחיצת "כן,מגיעים!" המבוססת `resolvePlaceholders`) — ה-AI פשוט לא ידע את הערך, גם אם הוא קיים ותקין ב-DB. זו דליפת מידע נפרדת לחלוטין מנתיב ה-template, שדיבוג-template לבדו לעולם לא היה תופס. תוקן: `spaTime` נוסף ל-`buildGuestStageContext()`'s parts array.
- ✅ **נוסף, בכוונה מצומצם (לא "כל אובייקט guest"):** `console.log("[webhook] Found Spa Time: ...")` + `console.log("[webhook] Guest Notes: ...")` נוספו ללוג ה-pre-flight הקיים (רץ על כל הודעה, לא רק faq/fallback). **במכוון לא** בוצע דאמפ מלא של אובייקט ה-guest (כבקשת Mike) — session 14 כבר הסיר דיוק כזה בגלל PII-noise (`payment_amount`/`payment_link_url`/שם מלא נחשפים בכל הודעה). הוסבר ל-Mike במקום לבצע בעיניים עצומות.
- ✅ `npm run build` נקי (רק האזהרה הקיימת `ShiftsPage`) + `npx supabase functions deploy whatsapp-webhook --no-verify-jwt` (פעם רביעית בסשן). ⚠️ **שינוי `WhatsAppInbox.js` עדיין לא committed/pushed** — Vercel auto-deploy מ-`main` לא יקרה עד commit+push מפורש. ניסיון verification בדפדפן (preview) נכשל בחסם login — `handleLogin` מנסה Supabase Auth אמיתי לפני fallback ל-MOCK_USERS (`isSupabaseConfigured===true` בסביבת הפיתוח המקומית), ואין credentials אמיתיים זמינים לבדיקה. אומת רק build נקי, לא render חי של ה-banner.
- 🐛→✅ **המשך אותו סשן — "Database Sync & Status UI/UX" — נמצא ותוקן באג production אמיתי, ונדחה תיקון אחד שהיה חוזר על באג שתוקן פעמיים.** Mike דיווח שסטטוס "לא מתעדכן" כשאורח כותב "כן". **דחיתי במכוון** את הבקשה הליטרלית לכתוב `status: "Confirmed Arrival"` — זה בדיוק הבאג שהוסר פעמיים (sessions 7+8) כי `"Confirmed Arrival"` לא ערך חוקי מול ה-CHECK constraint; `arrival_confirmed` (בוליאני) + מעבר `pending→expected` הקיימים **כבר** מייצגים את זה נכון. **הבאג האמיתי שנמצא:** ה-fallback של אישור-בהקלדה (לא לחיצת כפתור) היה מותנה ב-`guest?.msg_pre_arrival_2d_sent` — דגל שנכתב רק ע"י תזכורת ה-T-2 האוטומטית של `whatsapp-cron`, וה-cron הזה **חסום קבוע** (`CRON_ENABLED` לא הוגדר, ראה §6) במשך כל הפרויקט. כך, הקלדת "כן" (לעומת לחיצת כפתור תבנית, שעבדה נכון כל הזמן) הייתה תמיד dead code בפרודקשן. **תוקן:** ה-guard הוחלף ל-lifecycle-based (`status !== "checked_in" && status !== "cancelled"`) במקום תלות בדגל cron מנותק. נוסף גם error-logging ל-3 קריאות `.update()` של אישור-הגעה שלא נבדקו בעבר (FAIL VISIBLE).
- ✅ **migration 057 — `guests.attention_reason`.** "שינוי בתאריך" ו"דברו איתי" קרסו לאותם 2 flags גנריים בדיוק (`needs_callback`+`requires_attention`) ללא שום דרך להבחין ביניהם בדאשבורד. נוסף עמודה (`"date_change"`/`"human_callback"`/NULL) שנכתבת ע"י webhook's button router + `DATE_CHANGE_RE`, ומנוקה (`null`) כש"מסומן כטופל" או כשנלכד guest_notes גנרי. **תוקן במקום משותף אחד** — `GuestAttentionBadge.js` (כבר שימש את שני הדאשבורדים) — כך ש-🗓️/📞/🔴 מובחנים מופיעים אוטומטית בשני המקומות, בלי כפילות קוד.
- ✅ **`GuestDashboard.js` הגיע לפריטה (parity) עם `GuestsPage.js`:** היה חסר **כל** סימן ל-`arrival_confirmed`/`status`/`spa_time` — בנוי כל-כולו על ציר אחר (`msg_*_sent` pipeline flags). נוסף: badge "✓ אישר הגעה", `StatusBadge` (קומפוננטה חדשה, קוראת מ-`STATUS_META` המשותף), ושדה "💆 ספא HH:MM". **תוקן גם ה-SELECT** — `fetchGuests()` לא כלל בכלל `attention_reason`/`arrival_confirmed`/`spa_time` בשאילתה; ה-UI החדש היה מציג `undefined` עד שהשדות נוספו ל-`.select()`.
- ✅ **`STATUS_META` חולץ למקור משותף** — `src/utils/guestStatusMeta.js` (היה מוגדר כפול-בכוח ב-2 קבצים). נוסף גם `cancelled: "❌ מבוטל"` שהיה חסר (migration 051 הוסיפה את הערך אבל לא עודכן מעולם ה-label map — אורח מבוטל הוצג עם ⚠ מפחיד).
- ✅ נוסף שדה "💆 ספא HH:MM" לכותרת ה-thread ב-`WhatsAppInbox.js` (לצד banner ההערות שנוסף קודם) — לפי בקשת Mike ל"שדה ויזואלי ברור לשעת ספא בתצוגת ה-thread".
- ✅ `npm run build` נקי (רק האזהרה הקיימת) + `npx supabase db push` (migration 057) + `npx supabase functions deploy whatsapp-webhook --no-verify-jwt` — backend פרוס.
- ✅ **commit `b6e3501` + `git push` ל-main** — כל עבודת הסשן (status sync, attention_reason, GuestDashboard parity, spa_time, model routing, request-ack) הגיעה ל-Vercel. **הוצא בכוונה מה-commit** (נשאר untracked כמו שהיה): `ArrivalImportPanel.js`, `ezgoParser.js`, `MappingReviewPanel.js`, `importMapper.js`, `suggest-import-mapping/`, migration 049 — כל אלו ה-Resilient Import Agent שהושהה במכוון ב-session 9 ויש לו debug-branch לא-מוסר; `.claude/` ו-`README_DEV.md` גם הושארו untracked (לא חלק מהבקשה).
- ✅ **"Combined Spa Fix" — שני חלקים, שניהם בוצעו:**
  1. **Force Data Usage (שיחה חופשית):** נוסף כלל מפורש לשלוש השכבות — `FALLBACK_SYSTEM_PROMPT`, `buildSystemPrompt()`'s "הנחיות חשובות" (קוד), **ו-migration 058** (UPDATE אידמפוטנטי ל-`bot_settings.system_prompt` החי — קריטי, כי `finalSystemPrompt` מעדיף את שורת ה-DB על פני קוד, אותו דפוס כמו migration 056). הכלל מבהיר: כלל ה"הפנה לקבלה אם לא בטוח" חל **רק** כשהפרט באמת לא מופיע ב"פרטי האורח הנוכחי" שמוזרק לפרומפט (`buildGuestStageContext()`, שכבר תוקן בסיבוב הקודם להכיל spa_time) — לא כשהמודל "לא בטוח לגמרי" אבל הערך כן לפניו.
  2. **Template Injection (Stage 2):** `resolvePlaceholders()` מקבל safety net אחרון — אם `spaTime` קיים אבל הסקריפט השמור ב-`bot_scripts` לא מכיל אף placeholder מוכר (`{{SPA_LINE}}`/`{{OPTIONAL_SPA_TEXT}}`/`{{SPA_TIME}}`), הפונקציה **מצרפת בעצמה** משפט קשיח: `"הטיפול שלכם בספא מוזמן לשעה HH:MM."` — מובטח שהערך יופיע, בלי תלות בזכירת admin להוסיף placeholder נכון. גדור כך שלא יוצר כפילות אם הסקריפט כבר השתמש בplaceholder תקין.
- ✅ `npm run build` נקי + `npx supabase db push` (migration 058) + `npx supabase functions deploy whatsapp-webhook --no-verify-jwt` — פרוס.
- ✅ **Requests Board (guest_alerts) — מומש ופרוס.** `whatsapp-webhook` הורחב: ה-gate הקיים שכותב `guest_notes` לכל הודעת faq/fallback כותב כעת **גם** ל-`guest_alerts` (`alert_type:"request"`) — באותו IIFE-safe pattern כמו ה-date_change insert. `src/components/RequestsBoard.js` (חדש) — דף חדש, route `requests_board`, Sidebar "📋 לוח בקשות" (manager+). קורא `guest_alerts` join ל-`guests` (name/room), ממוין unresolved-first. "✓ סמן כטופל" פותח modal עם שדה הערת-טיפול אופציונלי (`resolution_notes`) — audit trail מלא לפי בקשת Mike. **אין מיגרציה** — `guest_alerts` (migration 012) כבר היה קיים עם כל העמודות הדרושות, רק לא נקרא משום קומפוננטה.
- 🔁 **"3 critical gaps" — שני מתוך שלושה היו כבר מתוקנים ופרוסים מהסיבוב הקודם, אומת מול הקוד החי ולא תוקן בשנית:** (1) spa_time force-injection ב-`resolvePlaceholders()` — קיים, אומת. (2) typed-"כן" guard — כבר lifecycle-based, לא `msg_pre_arrival_2d_sent`. **לא** הוסר ה-`!guest?.arrival_confirmed` guard כמבוקש במפורש ("the user's input כן is the only guard I need") — הסרתו הייתה גורמת לבוט לשלוח שוב את הודעת ה"מגיעים!🎉"+ספא בכל פעם שאורח שכבר אישר אומר עוד מילת-אישור ("בסדר"/"אוקיי") — spam, לא תיקון. **גם לא** נכתב `status:"אישר הגעה"` — עדיין מפר את ה-CHECK constraint, בדיוק הבאג שהוסר פעמיים (sessions 7+8). נוסף `status`/`arrival_confirmed` ללוג ה-pre-flight הקיים (רץ על כל הודעה) כראיה קשה לדיווח עתידי, כדי שלא נצטרך לנחש שוב.
- ✅ **(3) "קואורד׳" → "עסקי" (תוקן, ב-SuitesDashboard.js בלבד).** `phone_source` (`suite_rooms`, נכתב ע"י `ezgoParser.js`) הוא בפועל "individual"|"coordinator" בלבד — אבל הקוד הישן עשה בדיקה בינארית (`=== "individual" ? "פרטי" : "קואורד׳"`) שהייתה ממסכת גם ערך `null`/לא-צפוי כ"קואורד׳" באופן מטעה. תוקן ל-3-way עם FAIL VISIBLE fallback ל-"אחר". ⚠️ **לא תוקן** התווית הזהה ב-`ArrivalImportPanel.js`/`importMapper.js` (גריד תצוגה מקדימה בזמן ייבוא) — חלק מה-Resilient Import Agent שהושהה במכוון ב-session 9 עם diff לא-קשור ולא-committed; לגעת בקובץ ההוא יערב עבודה מושהית בקומיט הזה. אם Mike רוצה את התווית הזו מתוקנת גם שם — דורש החלטה נפרדת אם "להעיר" את הפיצ'ר המושהה או לעשות partial-stage.
- ✅ `npm run build` נקי + `npx supabase functions deploy whatsapp-webhook --no-verify-jwt` — פרוס.
- 🐛→✅ **שורש אמיתי אחד שהסביר את שלושת התסמינים (status/spa_time/guest_alerts) — נמצא ע"י Mike בבדיקה חיה.** אורח נוסף ל-DB עם `guests.phone` בפורמט מקומי (`0506842439`) במקום E.164 (`+972...`). ה-webhook חיפש אורח לפי פורמט יחיד בלבד (`+972...`) — `guestId` חזר `null`, וכל שלוש הפעולות (status update, spa_time read, guest_alerts insert) נכשלו בשקט כי לא היה guestId לעבוד איתו. **תוקן בנקודה אחת:** ה-lookup עכשיו מנסה את כל הוריאציות הסבירות (`+972...`/`972...`/`0...`) באמצעות `.in("phone", phoneVariants)` במקום `.eq("phone", phone)` — לא תלוי בניחוש איזה פורמט שמור בפועל. נוספו אזהרות מפורשות (button + typed paths) כש-isArrivalConfirm/CONFIRMATION_RE תואם אבל guestId עדיין null — כדי שדיווח עתידי דומה יהיה מבוסס-ראיה, לא ניחוש.
- ✅ `guest_alerts` (request) insert error הועלה מ-`console.warn` ל-`console.error` לפי בקשת Mike — "screaming in the logs".
- ✅ **WhatsAppInbox.js — `normalizePhone()`.** התת-באג המקביל בצד הפרונט (thread מפוצל): נוסף helper שמאחד `+972.../972.../0...` לפורמט קנוני יחיד (`972XXXXXXXXX`), מוזרק בנקודה אחת (`normalise()`) כך שכל הקיבוץ/active-thread-matching/שליחה יורשים את הפורמט המאוחד אוטומטית.
- ✅ **Sprint 2 — RequestsAlertWidget.js (Realtime לדאשבורד הבקשות).** widget צף חדש (🔔📋, bottom-right — לא חופף ל-AICopilot שב-bottom-left), מורכב גלובלית ב-App.js לצד AICopilot. נרשם ל-`postgres_changes` על `guest_alerts` (INSERT→ספירה+toast, UPDATE resolved false→true→הפחתת ספירה). קליק מנווט ל-`requests_board`. **migration 059** — הוסיף `guest_alerts` ל-`supabase_realtime` publication (guarded, idempotent) — בלי זה ה-subscription היה נכשל בשקט (אפס events, אפס שגיאה).
- ✅ `npm run build` נקי + `npx supabase functions deploy whatsapp-webhook --no-verify-jwt` (פעם שנייה בסשן) + `npx supabase db push` (migration 059) — הכל פרוס.
- ✅ **תיקון קוסמטי — `{{SPA_TIME}}` הלגאסי הציב רק את הערך הגולמי (למשל "15:00") בלי משפט מסביב.** תוקן להציב משפט מלא: "הטיפול שלכם בספא מתואם לשעה HH:MM" (ללא נקודה — מוחדר inline בתוך טקסט שהאדמין כתב). אותה ניסוח גם ב-force-injection fallback (היה "מוזמן לשעה", הוחלף ל"מתואם לשעה" לעקביות) — שם נשארה נקודה בסוף, כי זה משפט עצמאי שמתחבר בסוף ההודעה, לא inline substitution.
- ✅ `npm run build` נקי + `npx supabase functions deploy whatsapp-webhook --no-verify-jwt` (פעם שלישית בסשן) — פרוס.

#### session 14 — Jun 21 2026 (Cline regression audit — webhook contract fix, .catch() bug, onboarding loop root cause)
> הקשר: Mike עשה כמה שינויים עם Cline (כלי AI אחר) כדי לתקן באג "spa_time חסר מהודעות". Cline דיווח "✅ פרוס" אבל גם "הוחזר לגרסה מקורית" עבור חלק מהקבצים — נדרש audit מלא להבין מה באמת רץ בפרודקשן לפני שמתקנים עוד דברים.

- 🔍 **Audit מסקנה:** `whatsapp-send/index.ts` ו-`whatsapp-cron/index.ts` היו **נקיים** — אין uncommitted diff, וה-deploy timestamp האחרון של כל אחד תואם בדיוק לקומיט האחרון שנגע בו (session 11 / session 13 בהתאמה). ה-`SPA_TIME_FIX_SUMMARY.md` שCline השאיר (תיאר שינויים ב-cron SELECT + send PIPELINE_VARS) **לא שיקף מצב אמיתי** — הקובץ נמחק. רק `whatsapp-webhook/index.ts` היה עם שינוי לא-committed, וכבר היה פרוס (v70).
- 🐛→✅ **רגרסיה ב-webhook נמצאה ותוקנה:** Cline שינה את `{{OPTIONAL_SPA_TEXT}}`/`{{SPA_LINE}}` ב-`resolvePlaceholders()` ממשפט-משנה אופציונלי (ריק כשאין ספא, "זורם" בתוך משפט שהמנהל כתב) למשפט שלם שמוחזר תמיד — **בסתירה ל-docstring של הפונקציה עצמה** שעדיין תיאר את ההתנהגות הישנה. תוקן בחזרה לחוזה המתועד; `buildSpaSentence()` נשאר רק לנתיב ה-fallback הקשיח (כשאין שורת DB לסקריפט). גם שוחזר משפט שאבד בטעות מ-`FALLBACK_SYSTEM_PROMPT`, וצומצם לוג דיאגנוסטי כפול שדמפ את כל אובייקט האורח (PII-noise) ללוג קיים אחד.
- ✅ **`BotScriptEditor.js` תוקן (תיעוד, לא קוד):** ההערה שתיארה `{{SPA_TIME}}` כ-"מ-bookings.treatment_time" הייתה שגויה כבר כמה sessions — המקור האמיתי הוא `guests.spa_time`. נוסף גם תיעוד ל-`{{SPA_LINE}}`/`{{OPTIONAL_SPA_TEXT}}` שלא הוזכרו כלל בבאנר ה-UI — מנהל שעורך את שלב 2 רואה כעת את כל ה-placeholders הזמינים, כולל ההבדל בין "מוחק משפט שלם" ל"משפט-משנה אופציונלי".
- 🐛→✅ **שורש "שגיאה בשליחת אוטומציה" (popup אדום, "Send to all") נמצא ותוקן — לא קשור ל-Cline בכלל:** `שגיאה: supabase.from(...).insert(...).catch is not a function`. ה-Postgrest query builder הוא PromiseLike (מימש `.then()` בלבד) ולא Promise מלא — שרשור `.catch()` ישירות עליו זורק TypeError במקום לבלוע את השגיאה. **באג קיים מאז commit a2e0cef (15 ביוני)** — לא משהו שCline הכניס. ה-WhatsApp עצמו תמיד הגיע בהצלחה; ה-throw קרה בצעד הלוגינג הלא-קריטי ("רשום ל-whatsapp_conversations") *אחרי* השליחה. **למה זה "נראה חדש":** session 11 (שלי) שינה את ה-outer catch של whatsapp-send מ-HTTP 400 גנרי ל-200+הודעת שגיאה מפורטת — וזה מה שחשף את הטקסט המדויק של ה-TypeError לפרונטאנד בפעם הראשונה. תוקן 6 מופעים (2 ב-`whatsapp-send`, 4 ב-`whatsapp-webhook`) ל-try/catch תקין (כולל IIFE ל-2 מקרי fire-and-forget). פרוס: שני ה-functions.
- 🐛→✅ **שורש "Onboarding Loop" נמצא ותוקן (לא קשור ל-BotScriptEditor כמו שחשבנו בהתחלה):** `handle_new_auth_user()` הוגדרה מחדש 4 פעמים (migrations 002/003/004/014) אבל **אף migration לא הכילה את ה-`CREATE TRIGGER` שמחבר אותה בפועל ל-`auth.users`** — נבדק עם `grep` על כל תיקיית migrations, אין שום `CREATE TRIGGER ... ON auth.users` בהיסטוריה. תוצאה: משתמש חדש ב-Supabase Auth (כמו "אפק") לא קיבל שורת `profiles` בכלל. `DepartmentOnboardingModal.handleSave` עשה `UPDATE profiles WHERE id=?` על שורה שלא קיימת — Postgres מחזיר 0 שורות שהשתנו, **לא שגיאה** — אז הפרונטאנד חשב שהשמירה הצליחה. בכל F5, `loadUserWithProfile()` לא מצא שורה (שוב), `user.department` נשאר ריק, ומודאל הonboarding חזר — לופ אינסופי.
  **תוקן:** migration 052 — `CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users` (idempotent) + backfill לכל `auth.users` שעדיין חסרה לו שורת profiles. `DepartmentOnboardingModal.handleSave` — `update()`→`upsert()` (הגנה כפולה, גם אם התריגר ייכשל שוב בעתיד), נוסף banner שגיאה גלוי במודאל (לפני כן: `console.error` בלבד, אפס פידבק למשתמש). `loadUserWithProfile` — `.single()`→`.maybeSingle()` (קו אדום §9 שהוחמץ בעבר). `role` הושאר בכוונה מחוץ ל-upsert payload — DB default על insert, נשאר ללא שינוי על conflict, תואם להערה הקיימת "DB trigger + admin promote manages role".
- ✅ `npm run build` נקי (פעמיים, אחרי כל קבוצת תיקונים) — רק האזהרה הקיימת מראש (`ShiftsPage`).
- ✅ פרוס: `whatsapp-webhook` (פעמיים), `whatsapp-send`. `supabase db push` — migration 052 applied.
- ✅ נמחק קובץ זבל מתאונת טרמינל (`"upabase functions deploy whatsapp-webhook --no-verify-jwt"` — הכיל בפועל dump של git diff, לא היה קובץ קוד) + 2 קבצי test payload זמניים + `SPA_TIME_FIX_SUMMARY.md` (הוחלף ע"י הערך הזה).
- ⚠️ **שיעור מהסשן:** "האוטומציה הפסיקה לעבוד אחרי ש-Cline נגע בקוד" לא תמיד אומר שCline שבר אותה — שני מתוך שלוש התלונות (`.catch()` + onboarding loop) היו באגים ישנים שקדמו ל-Cline לחלוטין, רק *נחשפו* עכשיו. לפני שמתקנים "מה ש-AI אחר שינה" — קודם לוודא בפועל מה רץ היום (git diff + deploy timestamps + audit עצמאי), לא להניח מהסיכום שה-AI הקודם כתב על עצמו.

#### session 12 — Jun 20 2026 (UI cleanup — sidebar declutter + Universal AddGuestModal)
- ✅ **Sidebar decluttering:** הוסרו שתי שורות מ-`allNavItems` ב-`App.js`'s `Sidebar` component — `{ id: "suites", ... }` ("פירוט חדרים") ו-`{ id: "spa_staging", ... }` ("לוח ספא — אישור"). ה-routes עצמם (ב-switch הראשי) וה-components (`SuitesDashboard.js`, `SpaStagingPanel.js`) **לא** נמחקו — לפי בקשת Mike, רק unhook מהניווט הפעיל. אם צריך גישה ל-deep-link בעתיד, אפשר עדיין לנווט אליהם פרוגרמטית (`setActivePage("suites")` וכו') — הם פשוט לא נגישים יותר מה-Sidebar.
- ✅ **Universal AddGuestModal — תוקן פער Single Source of Truth (עקרון #5, §0):** היו שני טפסי "הוסף אורח" שונים — `GuestsPage.js` (המלא: name/phone/arrival_date/**spa_time**/treatment_count/order_number/room/status/requires_attention/needs_callback) ו-`GuestDashboard.js` (`AddGuestForm` מקומי, מקוצר — בלי `spa_time` בכלל). תוצאה בפועל: אורח שנוסף ידנית דרך GuestDashboard לא קיבל הודעות ספא אוטומטיות כי `spa_time` נשאר NULL — שום קוד לא דיווח על זה (לא "FAIL VISIBLE", פשוט שדה חסר בשקט).
- ✅ נוצר `src/components/AddGuestModal.js` — חולץ במדויק מטופס ה-edit/add modal הקיים ב-`GuestsPage.js` (אותה JSX, אותה לוגיקת insert/update ל-`guests`, כולל ה-dropdown חדר מבוסס `SUITE_REGISTRY`/`SUITE_SECTIONS`). מקבל `guest` (`{}`=חדש, `{id,...}`=עריכה), `onClose`, `onSaved(savedRow)`, `showToast(type,msg)` — Component עצמו מבצע את כתיבת ה-Supabase (insert או update), לא רק UI.
- ✅ `GuestsPage.js` — `editForm`/`editSaving`/`handleSaveEdit` הוסרו; ה-modal הענק (170+ שורות JSX) הוחלף ב-`<AddGuestModal guest={editGuest} onClose={...} onSaved={handleGuestSaved} showToast={showToast} />`. התנהגות זהה ב-100% לקודם (אומת ע"י diff לוגי, לא רק "זה נראה דומה").
- ✅ `GuestDashboard.js` — `AddGuestForm` (הטופס המקוצר), `fmtPhone`, `handleAddGuest`, `showAdd`, `addBusy` הוסרו לחלוטין; הוחלפו ב-`addingGuest` state + `<AddGuestModal>` עם `handleGuestSaved` (merge+sort לפי arrival_date/name, תואם ל-sort הקודם). ⚠️ **שינוי התנהגות מכוון:** אורח שנוסף מ-GuestDashboard כיום לא מקבל `room_type`/`departure_date` (שדות שהיו בטופס הישן ולא קיימים בטופס המאוחד) — `room_type` יישאר `null` עד שינוקה/ימופה ע"י ייבוא; זה תוצר ישיר של איחוד לטופס אחד לפי בקשת Mike, לא באג.
- ✅ `npm run build` — Compiled with warnings (אזהרה אחת קיימת מראש ולא קשורה: `ShiftsPage` unused ב-App.js, מתועדת כבר מ-session 8). גודל ה-bundle בפועל **קטן** ב-842B אחרי האיחוד (קוד כפול הוסר).
- ✅ commit `2c7b15d` + `git push` ל-main (Vercel auto-deploy). **לא** הוכלל ב-commit הזה: עבודת ה-Resilient Import Agent הממתינה (`ArrivalImportPanel.js`/`ezgoParser.js`/`MappingReviewPanel.js`/`importMapper.js` וכו') — נשארת מושהית ב-working tree, ראה "פריטים פתוחים" למעלה. לא בוצע QA חי בדפדפן בסשן זה (אין session דפדפן מחובר) — Mike: לבדוק ב-Vercel preview ש-"➕ הוסף אורח" עובד גם ב-GuestDashboard וגם ב-GuestsPage, ושה-Sidebar אכן לא מציג את שתי הלשוניות שהוסרו.

#### session 11 — Jun 20 2026 (Pipeline polish — cron safeguard, non-2xx root cause, retry-safe failures, Pipeline Monitor design)
- ✅ **תוקן (Mike's explicit decision):** `whatsapp-cron/index.ts` — נוסף `!g.needs_callback` ל-`morning_welcome`+`morning_suite` (שניהם שולחים `dream_welcome_morning`). אורח עם needs_callback פתוח (למשל "לא,שינוי בתאריך") לא יקבל "בוקר טוב, מחכים לך!" יותר. `needs_callback` נוסף ל-SELECT.
- 🐛→✅ **שורש "non-2xx" נמצא ותוקן:** הקריאה ל-`whatsapp-send` בבדיקה ידנית של `dream_welcome_morning` חזרה עם "Edge Function returned a non-2xx status code" — ה-wrapper הגנרי של supabase-js. נקרא הקוד המלא: ה-outer catch ב-`whatsapp-send/index.ts` היה היחיד בכל הקודבייס שמחזיר `status:400` במקום 200 — כל שאר הפונקציות (chat, get-wa-templates, suggest-import-mapping) עוקבות אחר הקונבנציה המתועדת "Always 200, error בbody". בגלל זה ה-frontend אף פעם לא ראה את הסיבה האמיתית (guest_not_found/guest_no_phone/וכו') — רק את ה-wrapper. תוקן ל-200. **לא** נמצא באג ספציפי ל-`{{1}}`/template variables — מנגנון ה-sanitizeTemplateVars/sendViaTemplate תקין מבחינה לוגית; חוסר var פשוט גורם לדחיית Meta (status:"failed" רגיל, לא throw).
- ✅ **תוקן יחד (קו אדום §9):** שלושת ה-`.single()` ב-`whatsapp-send` (BRANCH B/D/E) → `.maybeSingle()` + הודעות שגיאה מפורטות.
- 🐛→✅ **תוקן (היה "פתוח" מsession 9):** `GUEST_FLAG[trigger]` נכתב כעת רק על `status:"sent"/"simulated"`, ובדיקת idempotency ב-BRANCH D משתמשת ב-`.in("status",["sent","simulated"])` במקום "קיימת שורה כלשהי" — שורת "failed" קודמת לא חוסמת retry יותר.
- ✅ **migration 050** — `notification_log.status` CHECK constraint הורחב ל-`('sent','simulated','failed','timeout')`. נמצא תוך כך: status="timeout" (שנוסף בקוד בsession 9) **נכשל בשקט** בכל insert מאז, כי ה-constraint הישן לא הכיר אותו — השורות פשוט לא נכתבו. ה-Pipeline Monitor (להלן) תלוי בתיקון הזה כדי לראות timeouts בכלל.
- ✅ נוספה הערה מבנית ב-`whatsapp-send/index.ts` (מעל `PIPELINE_TEMPLATE`) + כאן ב-CLAUDE.md: שינוי טקסט עונתי לתבנית מאושרת דורש אישור Meta מחדש לפני שהוא "חי".
- 📐 **Pipeline Monitor — עיצוב query logic** (לא מומש UI עדיין, לפי בקשת Mike "next session"): שלוש שאלות — (1) אורחים שמגיעים היום (`guests` WHERE arrival_date=today), (2) הודעות בוקר שנשלחו בהצלחה היום (`notification_log` WHERE trigger_type IN (morning_welcome,morning_suite) AND status='sent' AND sent_at>=today), (3) שליחות שנכשלו/timeout שדורשות fallback ידני (אותו filter עם status IN (failed,timeout), join ל-guests). ⚠️ קריטי: **לא** להשתמש ב-`guests.msg_morning_welcome_sent`/`msg_morning_suite_sent` כ"נשלח בהצלחה" — אחרי תיקון session 11 הדגל אמנם נכון יותר (רק success), אבל `notification_log.status` נשאר מקור האמת התפעולי המדויק ביותר (תומך במספר ניסיונות/retries).
- ✅ `supabase db push` (migration 050) + `supabase functions deploy whatsapp-send --no-verify-jwt` + `supabase functions deploy whatsapp-cron --no-verify-jwt` — שלושתם פרוסים בייצור.

#### session 10 — Jun 20 2026 (Live E2E follow-up — human-request flag, chat UI cleanup, placeholder hardening, cron audit)
- ✅ **אומת בהצלחה:** session 9's button-type fix עבד בפרודקשן — לחיצת "כן,מגיעים!" נתפסה ושלחה את התשובה המוגדרת מ-`bot_scripts`. דיווח חי ראשון על button routing שעובד מקצה לקצה.
- ✅→🐛 **תוקן:** "לא,שינוי בתאריך" עדכן את `guests.needs_callback`/`requires_attention` נכון, אבל **לא** סימן את שורת ה-inbound ב-`whatsapp_conversations` עם `human_requested`/`human_request_type` — ולכן "🔴 מבקש מענה אנושי" ב-`WhatsAppInbox.js` (שקורא רק `human_requested`, לא `guests.needs_callback`) לא הופיע. אותו פער קיים גם בכפתור "דברו איתי" — תוקן יחד, אותה שורת קוד. ה-state התפעולי (guests) היה תקין כל הזמן; רק הסימון ל-UI חסר.
- ✅ **תוקן:** הוסר `[כפתור: ]` prefix משני ה-inserts ל-`whatsapp_conversations` (button router הגנרי + needs_callback-silenced log) — נשמר רק טקסט הכפתור הגולמי. `guest_alerts` (alert log פנימי לצוות) **לא** שונה — היקף שונה, לא Live Chat UI.
- 🔍 **נחקר ולא נמצא קוד שגוי:** "spa_time לא מוצג" — קראתי SELECT + extraction + `resolvePlaceholders` במלואם, כולם תקינים. הוספו: (1) regex tolerance לרווחים/casing בכל placeholder ב-`resolvePlaceholders` (הגנה, לא ניחוש), (2) `console.log` דיאגנוסטי בשתי נקודות הקריאה שמדפיס spa_time + אם הסקריפט מכיל את ה-placeholder בכלל — אם זה יקרה שוב, הלוגים ייתנו תשובה מדויקת בלי ניחוש נוסף.
- 🔍 **אומת:** `whatsapp-cron/index.ts` נקרא במלואו — `morning_welcome`/`morning_suite` תלויים רק ב-`arrival_date`+`room_type`+flag guard, **לא** ב-`arrival_confirmed`. ה-cron **עדיין halted** ע"י `CRON_ENABLED` (לא הוגדר) — לא קשור לתיקוני session 9/10. תוקן תיעוד שגוי שטען ש"חסרים flag guards" — הם קיימים מאז session 2.
- ✅ `supabase functions deploy whatsapp-webhook --no-verify-jwt` — פרוס בייצור.

#### session 9 — Jun 20 2026 (Live bug hunt — button router silent + false "failed" reports)
- 🐛→✅ **באג קריטי נמצא ותוקן:** `whatsapp-webhook/index.ts`'s message-type switch טיפל רק ב-`"text"` ו-`"interactive"`. לחיצה על כפתור Quick Reply בתוך הודעת **template** (כל broadcast/pipeline send היום עובר ב-`sendTemplate`/`sendViaTemplate`) מגיעה מ-Meta כ-`msg.type:"button"` — עם shape **שונה** (`{button:{text,payload}}`, לא `{interactive:{button_reply:{title,id}}}`). זה נפל ל-`else` הכוללני ונדלג בשקט — הבוט היה שותק לחלוטין בלחיצה על "כן,מגיעים!"/"לא,שינוי בתאריך". **לא** היה key mismatch ב-`bot_scripts` כמו שחשדנו בהתחלה — `scripts["stage_2_arrival"]` תמיד היה נכון. תוקן: ענף `msg.type === "button"` חדש שממפה ל-`buttonTitle`/`buttonId`/`isButtonReply` הקיימים — שום קוד downstream (button router, needs_callback override, bot_scripts lookup) לא השתנה.
- 🐛→✅ **באג קריטי שני נמצא ותוקן:** "נכשלו: 2" שהוצג ב-`BroadcastDashboard.js` כששתי ההודעות בכל זאת הגיעו לטלפון. שורש: `sendViaTemplate`/`sendViaMeta` (whatsapp-send) ו-`sendTemplate`/`sendReply` (whatsapp-webhook) תפסו **כל** כשל fetch ל-Meta (כולל timeout/AbortError על `AbortSignal.timeout(15000)`) כ-"failed" זהה לדחייה ממשית — בזמן ש-timeout פירושו "לא ידוע אם Meta עיבדה את הבקשה", לא "Meta דחתה". תוקן: timeout הועלה ל-25s, ו-timeout מסומן בנפרד כ-`"timeout_no_response"` → `status:"timeout"` (לא `"failed"`) → `BroadcastDashboard.js` מציג "לא ודאי" כקטגוריה שלישית נפרדת מ-"נכשלו" (`handleBroadcast`, `sendToOne`, `handleQuickSendTomorrow` כולם עודכנו).
- ✅ אומת מול הקוד (לא ניחוש): `resolvePlaceholders()`'s `{{SPA_TIME}}`/`{{OPTIONAL_SPA_TEXT}}`/`{{SPA_LINE}}` handling — והsource `guests.spa_time` ב-SELECT — כבר נכונים. "שעת ספא חסרה" (bug #3 שדווח) צריכה לעבוד אוטומטית כש-bug #2 (כפתור שותק) מתוקן; אם עדיין חסרה אחרי הפריסה — לבדוק אם ל-guest הבדיקה הספציפי יש בכלל `spa_time` בDB (נתון, לא קוד).
- ⚠️ נמצא ולא תוקן בsession 9 (מחוץ לסקופ): `GUEST_FLAG`/`notification_log` ב-BRANCH D נכתבים גם בכשל/timeout — מסמן הודעת pipeline שלא אושרה כ"נשלחה" לצורך idempotency. **✅ תוקן בsession 11** — ראה שם.
- ✅ `npm run build` — Compiled (אזהרה אחת קיימת מראש, לא קשורה).
- ✅ `supabase functions deploy whatsapp-webhook --no-verify-jwt` + `supabase functions deploy whatsapp-send --no-verify-jwt` — שניהם פרוסים בייצור. שינויי `BroadcastDashboard.js` (פרונטאנד) **לא** commit-ים/pushed עדיין.
- ⏸ Resilient Import Agent (AI-driven column mapping, suite CSV import) — הושהה באמצע העבודה לבקשת Mike כדי לטפל בבאגים הקריטיים האלה. ראה "פריטים פתוחים" — Edge Function + migration פרוסים, פרונטאנד לא.

#### session 8 — Jun 20 2026 (Phase 6 seed completion + second status-bug fix)
- ✅ אומת מול הקוד החי (לא מהזיכרון/CLAUDE.md): webhook קורא 8 `script_key` שונים מ-`bot_scripts`, רק 4 היו עם שורת seed (`stage_2_arrival`, `ongoing_concierge`, `complaint_reply`, `upsell_reply` — migrations 032/037). הפער היה גדול יותר מהתיעוד הקודם ("רק fallback_reply חסר").
- ✅ Migration 048 — הזריעה 8 שורות חדשות: `fallback_reply`, `spa_menu`, `callback_reply`, `positive_feedback_reply`, `negative_feedback_reply`, `upsell_accepted_reply`, `upsell_decline_reply`, `generic_button_reply`. כל הטקסטים הם copy-paste מדויק מהמחרוזות hardcoded הקיימות — אין שינוי התנהגות, רק נפתחה עריכה.
- ✅ Code patch ב-`whatsapp-webhook/index.ts`: (1) נתיב "כפתור לא מזוהה" (שורה ~1141) לא ניסה אפילו לקרוא מה-DB — נוסף lookup ל-`generic_button_reply`. (2) `positive_feedback_reply` עודכן לפענוח placeholder `{{GOOGLE_REVIEW_URL}}` (לא הוחלף לערך קבוע — ה-URL מגיע מ-secret חי, לא ניחוש).
- 🐛 התגלה ותוקן: שורה 1160 (אישור הגעה ע"י **הקלדת** "כן", לא לחיצת כפתור) עדיין כתבה `status: "Approved"` — בדיוק הבאג שSTEP 1 (session 7) חשב שתוקן במלואו, אבל זה תיקן רק את נתיב הכפתור (שורה 976). הוסר.
- ✅ תיקון תיעוד: CLAUDE.md §3/§4 טענו ש-`bot_scripts` route לא ב-Sidebar nav — שגוי. נמצא ב-`App.js:1114-1121`, סקשן אדמין, כפתור "📝 סקריפטי הבוט" — תוקן.
- ✅ `npm run build` — Compiled (אזהרה אחת קיימת מראש, לא קשורה: `ShiftsPage` unused ב-App.js — לא טופלה, מחוץ לסקופ).
- ✅ `npx supabase db push` (migration 048 applied) + `npx supabase functions deploy whatsapp-webhook --no-verify-jwt` — שניהם פרוסים בייצור.
- ⚠️ לא בוצע QA חי בדפדפן (אין session דפדפן מחובר בסשן הזה) — Mike: כנס ל-BotScriptEditor ואמת ש-8 השורות החדשות מופיעות ועריכה שלהן נכנסת לתוקף.

#### session 7 — Jun 20 2026 (איחוד ייבוא + Universal Grid + תיקון webhook + Bot Brain Audit)
- ✅ הוחל תיקון STEP 1 שסוכם בsession 6: שתי כתיבות `status` שגויות הוסרו מ-whatsapp-webhook
- ✅ אובחן: 4 משטחי ייבוא חיים בפועל (DataHub/ArrivalImportPanel/DataUpload/SpaStagingPanel), כותבים ל-3 שדות "חדר" שונים (guests.room/guests.suite_name/suite_rooms.room_name) — שורש הבאג "חדר לא משויך"
- ✅ הוחלט (אישור Mike): "Super Component" אחד — backend מ-ArrivalImportPanel + UX מ-DataHub — בתוך TaskBoard בלבד; SpaStagingPanel נשאר standalone (תלות אוטומציה חיצונית, לא נמוג)
- ✅ `EditableGrid.js` חולץ מ-DataHub — מימוש ראשון לעקרון #4 Universal Architecture
- ✅ `ArrivalImportPanel.js` נכתב מחדש — suites profile (grid עם dropdown SUITE_REGISTRY) + shifts profile (מ-DataHub)
- ✅ Migration 047 — sync_suite_arrivals RPC כותב guests.room ישירות (roomDisplay field) — applied לDB החי
- ✅ `DataUpload.js` + `DataHub.js` נמחקו; routes+nav items+imports הוסרו מ-App.js/GuestDashboard.js
- ✅ GuestsPage room dropdown → SUITE_REGISTRY ישיר (לא suite_rooms-derived) — מבטל כפילויות
- ✅ AICopilot.handleApprove מתוקן — שגיאת WA invoke לא נבלעת, room/guest status לא מתקדמים בכשל
- ✅ גילוי ותיעוד: RoomBoard.js, AICopilot.js, BotScriptEditor.js, DataHub.js(נמחק), SpaStagingPanel.js, room_status table, cleaner role, suiteRegistry.js, email-import-webhook, spa-schedule-webhook, room-clean-notify
- ✅ אובחן (לא באג): "ג'ספר 3 — ממתין לאישור" הוא RoomBoard עובד כמתוכנן (housekeeping approval pending), לא דליפת סטטוס WhatsApp
- ✅ Phase 6 Bot Brain Audit — ראה למעלה
- ✅ commit `302803c` + `git push` ל-main (Vercel auto-deploy) + `supabase db push` (migration 047 live) + `supabase functions deploy whatsapp-webhook` — כל שכבות הקוד פרוסות בפועל

#### session 6 — Jun 20 2026 (Disable/Don't Hide UI + CLAUDE.md overhaul)
- ✅ אבחון "fail closed" anti-pattern: כפתורי פעולה נעלמו לאורחי status='pending' (וכל ערך לא-מוכר) ב-GuestsPage — switch בלעדי על מחרוזת status מדויקת
- ✅ עיצוב לוגיקת Slot 1/Slot 2 — כפתורים תמיד מוצגים; disabled+tooltip כשחדר לא משובץ (אלא אם אורח יומי — Premium Day); never hidden
- ✅ `STATUS_META` fallback מתוקן — ערך לא מוכר מוצג כ-⚠ גלוי, לא מוסווה כ"ממתין"
- ✅ עמודות "חדר"/"סוג" ב-GuestsPage נשלפות גם מ-`suite_rooms` (לא רק `guests.room`) — אורחי סוויטות מיובאים רואים את החדר שלהם
- ✅ SuitesDashboard מציג סטטוס צ'ק-אין חי מ-`guests` על כל כרטיס חדר (קריאה שנייה ל-DB אחרי טעינת suite_rooms)
- 🔴 התגלה (לא תוקן עדיין): webhook כותב ערכי `status` לא-חוקיים שמפרים את ה-CHECK constraint — ראה §10 STEP 1
- ✅ CLAUDE.md: נוסף §0 חזון+עקרונות יסוד, §10 שוחזר ל-Live Status & Roadmap

#### מה הושלם בסשן Jun 18 2026 (session 5 — Golden Guest Profile complete)
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

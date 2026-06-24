# CLAUDE.md — Dream Island AI System
> קובץ זה נקרא אוטומטית בכל שיחה. הוא מקור-האמת שלך. קרא אותו לפני כל פעולה.
> **עדכון אחרון:** 2026-06-24 (session 25 — 24-Hour Interaction Window Guard על `inbox_reply` + fallback ב-BRANCH D, "📜 מה נשלח" history tab חדש, ניתוק שדות תשלום מ-status ב-`AddGuestModal`. פירוט בתחתית §10 ובהיסטוריה המלאה ב-`claude_history.md`).
>
> 📚 **היסטוריית הסשנים המלאה (sessions 2–24) הועברה ל-[`claude_history.md`](claude_history.md)** כדי לשמור את הקובץ הזה קליל. שום מידע לא נמחק — רק הופרד. הקובץ הזה מחזיק את **רפרנס הארכיטקטורה החי** (§0–§13); הקובץ ההוא מחזיק את הנרטיב ההיסטורי. כשצריך הקשר מפורט על באג/החלטה ישנה — קרא שם.
>
> ⚠️ **ריבוי כלים על אותו repo:** זוהו בעבר עריכות מקבילות מ-Cline/סשנים אחרים על אותם קבצים (קוד שהופיע בלי שנכתב, כותרות שהוחלפו מתחת לרגליים). אם תיתקל בקוד לא-מוכר — בדוק `git diff` לפני שתניח שהכל מהסשן הנוכחי. מומלץ לא להריץ שני כלים על אותו repo במקביל.

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
   ✅ **session 25 — נסגר.** `inbox_reply` (BRANCH C, `whatsapp-send/index.ts`) בודק כעת `guests.wa_window_expires_at` *לפני* קריאת Meta — אם החלון סגור, מחזיר `{ok:false, status:"window_closed", error:"..."}` עברי וברור בלי לנסות לשלוח כלל (אותה תוצאה ש-Meta הייתה כופה בכל מקרה, רק מהר וברור יותר, FAIL VISIBLE §0.3). נאכף רק כש-`phone` תואם guest קיים — מספר לא-מוכר (אין שורת guest) שומר על ההתנהגות הקודמת. `WhatsAppInbox.js`'s שלושת נקודות הקריאה (bulk/handleSendFree/sendManualReply) כבר מציגות את `data.error` הגולמי, כך שההודעה החדשה עוברת כמו שהיא; ה-bulk loop גם קיבל סיכום כשלים גלוי (`bulkFailures`) במקום לבלוע שגיאות בשקט.

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
│       ├── OperationsBoard.js    ★ session 21 — "תפעול ואחזקה" (ops_board route, ⚠️ "tasks"/"calls"
│       │                            deep-link aliases). מאחד את TaskBoard.js הישן (נמחק) + מסך
│       │                            "Service Calls" הישן ב-App.js (CallsPage, נמחק — היה אמיתי,
│       │                            DB-backed דרך service_calls table, migration 005 — לא mock כפי
│       │                            שתואר בטעות בתחילת session 21, ראה שם). 3 סטטוסים open/
│       │                            in_progress/done, badge SLA אדום מתפעם (sla-breach-pulse keyframe,
│       │                            בהשראת wa-pulse) על פריט שעבר sla_deadline, כפתורי "🙋‍♂️ אני מטפל"/
│       │                            "✅ בוצע" — אותו מנגנון בדיוק שכפתורי הוואטסאפ של staff-ops-webhook
│       │                            משתמשים בו. ArrivalImportPanel מורכב כאן (managers בלבד), בדיוק
│       │                            כמו ב-TaskBoard.js הישן.
│       ├── AiFailoverWidget.js   ★ session 21 — banner צף עליון, realtime על ai_failover_events.
│       │                            לא widget של "תור עבודה" כמו RequestsAlertWidget — מתריע על
│       │                            אירוע auto-failover (Claude↔Gemini) ונעלם לבד אחרי 10 שניות.
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
│       │                            treatment_count/order_number/payment_amount/payment_link_url/
│       │                            room(SUITE_REGISTRY)/status/requires_attention/needs_callback.
│       │                            כותב/קורא guests ישירות (insert חדש / update קיים). בשימוש
│       │                            ע"י GuestsPage.js + GuestDashboard.js — single source of truth
│       │                            לטופס אורח, כך ש-spa_time לא יחסר יותר לאורח שנוסף מ-GuestDashboard.
│       │                            ★ session 25: payment_amount/payment_link_url נוספו כשדות
│       │                            תמיד-גלויים, לא מותנים ב-status/arrival_confirmed — לפני כן
│       │                            הדרך היחידה למלא אותם הייתה ה-popup הנפרד ב-GuestsPage.js
│       │                            ("💳 תשלום"), שעצמו מוצג רק אחרי arrival_confirmed=true, כך
│       │                            שלא ניתן היה להזין מחיר/קישור מוקדם — בדיוק כשStage 2 Pay
│       │                            (אוטומטי, אירוע-מיידי) עלול לירות ולמצוא אותם ריקים.
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
│       ├── BotSettings.js        ★ מוח הבוט — system_prompt + knowledge_base
│       │                            חשוב: משפיע רק על תשובות free-text (Gemini)
│       │                            לא משפיע על לחיצות כפתור (hardcoded routing)
│       ├── AutomationControlCenter.js ★ "בקרת אוטומציה" (automation_center route, admin-only) —
│       │                            backfilled into docs session 20 (בנה מחוץ לתהליך התיעוד הרגיל,
│       │                            ראה session 19/20). 3 sub-tabs: מסע האורח (Timeline — קורא/כותב
│       │                            automation_stages חי, session 20: כל כרטיס שלב מורחב מציג כעת
│       │                            Live Message Preview — bubble מומלא בדוגמת placeholder לתבנית
│       │                            סשן חופשית, או body text מאומת ל-Meta template, ראה §6), תור חי +
│       │                            מוניטור (Queue — read-only, קורא automation-queue function),
│       │                            תבניות Meta (מורכב TemplateManagerPanel.js).
│       └── TemplateManagerPanel.js ★ ניהול תבניות WhatsApp מאושרות מ-Meta — סונכרן/נוצר/preview.
│                                    מיוצא session 20: STATUS_META (היה module-private) — משותף עם
│                                    AutomationControlCenter.js's Meta template preview box.
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
│   │   ├── 048_bot_scripts_missing_seeds.sql     applied ✅ — 8 script_key חדשים (fallback_reply,
│   │   │                            spa_menu, callback_reply, positive/negative_feedback_reply,
│   │   │                            upsell_accepted/decline_reply, generic_button_reply). ראה §10 session 8.
│   │   ├── 049–064_*.sql        applied ✅ — ראה §10 sessions 9–18 לפירוט (Resilient Import Agent,
│   │   │                            Stage-2-Pay precursors, system-prompt fixes וכו')
│   │   ├── 065_automation_stages.sql            applied ✅ — automation_stages table, single source
│   │   │                            of truth ל-timing+content routing (קודם פזור ב-3 מקומות). ראה §6.
│   │   ├── 066_guest_alerts_escalation.sql       applied ✅
│   │   ├── 067_stage_2_pay.sql                   applied ✅ — stage_2_pay row + bot_scripts seed +
│   │   │                            chronology fix (night_before sequence_order 150→220)
│   │   ├── 068_stage_2_pay_buttons.sql           applied ✅ — interactive_buttons (Meta cta_url
│   │   │                            payment button) + {{SPA_LINE}} ל-stage_2_payment_reply
│   │   ├── 069_remove_dead_template_keys.sql     applied ✅ — מחק 4 שורות bot_config category=
│   │                                'templates' (template_night_before/checkin_welcome/midstay_
│   │                                checkin/before_checkout) — מתות, audit session 20 אישר 0 קוד
│   │                                שקורא אותן. ראה §10 session 20.
│   │   ├── 070_profiles_phone.sql · 071_tasks_ops_board.sql · 072_ai_failover_events.sql  applied ✅ (session 21)
│   │   ├── 073_tasks_action_token_idempotency.sql  applied ✅ — ★ session 22 (XOS Sprint 2):
│   │                                tasks.action_token (סוד ל-URL של Accept/Complete) + source_message_id
│   │                                (UNIQUE partial — ticket אחד לכל הודעת Whapi, idempotency). ראה §10 session 22.
│   │   ├── 074_sla_escalation_1min.sql  applied ✅ — ★ session 22: pg_cron 'sla-escalation' → */1min
│   │   │                            (היה */5) + grandfather baseline (escalated_at=NOW() לכל task פתוח קיים
│   │   │                            כדי לא לפוצץ את הקבוצה רטרואקטיבית בהפעלה). ראה §6/§10 session 22.
│   │   └── 075_inbox_push_name_and_routed_tasks.sql  applied ✅ — ★ session 23: `whatsapp_conversations.
│   │                                push_name` (Meta contacts[].profile.name, Smart Identity Resolution
│   │                                fallback) + `tasks.source` CHECK widened with `'inbox_routed'`
│   │                                (WhatsAppInbox.js's "Route to Maintenance/Housekeeping" quick action).
│   │                                ראה §10 session 23.
│   └── functions/
│       ├── chat/                deployed ✅ — Gemini 2.5→Claude fallback
│       ├── generate-schedule/   deployed ✅ ⚠️ ORPHAN — frontend לא קורא אותה
│       ├── generate-agent-profile/ deployed ✅
│       ├── process-knowledge/   deployed ✅
│       ├── push-notify/         deployed ✅
│       ├── whatsapp-send/       deployed ✅ — תומך ב-inbox_reply trigger. ★ session 25: 24-Hour
│       │                            Interaction Window Guard — (1) inbox_reply בודק guests.
│       │                            wa_window_expires_at *לפני* קריאת Meta ומחזיר status:
│       │                            "window_closed" מיידי במקום לתת ל-Meta לדחות בלי הקשר; (2)
│       │                            BRANCH D (pipeline hybrid) — אם sendInteractiveButtons נכשל,
│       │                            fallback אוטומטי ל-sendViaTemplate באותה קריאה כך ששלב מתוזמן
│       │                            לא נשאר בלי הודעה בכלל. ראה §10 session 25 + isWindowOpen() helper.
│       ├── whatsapp-cron/       deployed ✅ — pg_cron job "wa-cron" פעיל (*/15) ⚠️ KILL SWITCH ON.
│       │                            session 20 audit: קורא automation_stages חי (לא hardcoded map) —
│       │                            לא מערכת מקבילה ל-automation-queue, ראה session 20 להלן.
│       ├── automation-queue/    ★ session 20 backfill — read-only projection (guests × automation_
│       │                            stages × notification_log) ל-Queue tab של AutomationControlCenter.
│       │                            אינה שולחת הודעות בעצמה — אך ורק תצוגה מקדימה.
│       ├── automation-history/  ★ NEW (session 25) — read-only היסטוריית ביצוע ("📜 מה נשלח" tab)
│       │                            לAutomationControlCenter. פרויקציה שטוחה מעל notification_log
│       │                            (הטבלה הקיימת היחידה, כבר מתעדת כל שליחה במערכת — מתוזמנת או
│       │                            ידנית) join עם guests(name) + automation_stages(display_name).
│       │                            "מועד מתוכנן" מחושב לוקלית (לא מ-resolveStageSchedule המשותף —
│       │                            ה-eligibility gate שלו מחזיר scheduledFor:null ברגע ש-guest_flag_
│       │                            column=true, בדיוק המקרה "כבר נשלח" שהטאב הזה קיים כדי להציג).
│       │                            אינה שולחת הודעות, אינה כותבת DB.
│       ├── whatsapp-webhook/    ★ deployed ✅ v3 — ראה §6 לתיאור מלא
│       ├── room-clean-notify/   ★ גילוי session 7 — שולח whatsapp-send trigger="room_ready" כשחדר
│       │                            הופך פנוי. נקרא רק מ-RoomBoard's retry button (waState="failed") —
│       │                            לא קורה אוטומטית בפועל; AICopilot הוא המסלול הפעיל ל-room-ready WA.
│       ├── spa-schedule-webhook/ ★ גילוי session 7 — מזין spa_staging מאוטומציה חיצונית
│       ├── email-import-webhook/ ★ גילוי session 7 — מזין spa_staging ממייל (כנראה Make.com)
│       ├── sla-escalation-cron/  ★ session 21, ה-ops branch שוכתב session 22 — pg_cron */1min
│       │                            (migration 074), ✅ KILL SWITCH SLA_ESCALATION_ENABLED=true (הופעל
│       │                            session 22). סוקר guest_alerts (סף 10 דק' → Adir, SLA_GUEST_ALERT_PHONE,
│       │                            Meta — ללא שינוי) + tasks: session 22 STRICT 7-min UNASSIGNED
│       │                            (status='open' past created_at+SLA_UNASSIGNED_MINUTES=7, לא sla_deadline)
│       │                            → 🚨 ל-Whapi ops group (SLA_ALERT_GROUP_ID→WHAPI_GROUP_ID), לא Meta;
│       │                            mark-escalated רק בהצלחה (retry-on-fail). שניהם push-notify ל"הנהלה".
│       ├── staff-ops-webhook/    ⚠️ session 22: הוחלף ע"י whapi-webhook (יציאה משירות אחרי אימות). NEW session 21 — קולט דיווחי צוות שהועברו מ-relay חיצוני
│                                    (Make.com/bridge — Mike בונה את זה בנפרד; Meta Business API
│                                    אינו תומך בקבוצות וואטסאפ כלל, לא קריאה ולא כתיבה). regex
│                                    `/^(\d+)\s*-\s*([\s\S]+)$/` (0 טוקנים) לדיווח מבני ("11- towels")
│                                    + keyword category guess; Claude (tool-calling, לא Gemini) רק
│                                    לטקסט חופשי שלא תאם את ה-regex. תמונה בלי טקסט = "Photo Only —
│                                    Uncategorized", אפס קריאות AI. מעלה ל-task_images/ops/ (bucket
│                                    קיים). שולח כפתורי "🙋‍♂️ אני מטפל"/"✅ בוצע" חזרה ל-reporter
│                                    (1:1 בלבד — לא לקבוצה) — best-effort, תלוי בחלון 24ש' פתוח מול
│                                    אותו מספר; הלוח הפנימי הוא הנתיב האמין, הוואטסאפ בונוס.
│       ├── whapi-webhook/        ★ NEW session 22 (XOS Sprint 1+2) — webhook נכנס מ-Whapi (whapi.cloud,
│       │                            ספק שתומך בקבוצות, שלא כמו Meta). מסנן from_me/לא-קבוצה → dedup לפי
│       │                            source_message_id (לפני ה-LLM) → intent classification (Tier 0 regex
│       │                            "11- towels"/"ROOM 14 ..." 0-token, Tier 1 Claude forced-tool
│       │                            task-vs-chitchat) → chitchat = שקט מוחלט, task = insert ל-tasks +
│       │                            כרטיס אנגלי לקבוצה דרך _shared/whapiSend.ts (no_link_preview).
│       │                            **מחליף את staff-ops-webhook.** Secrets: WHAPI_TOKEN (+WHAPI_GROUP_ID
│       │                            אופציונלי ל-group-lock) — ⚠️ עדיין לא מוגדרים, ראה §10 session 22.
│       └── task-action/          ★ NEW session 22 (XOS Sprint 2) — callback ל-Accept/Complete בכרטיס.
│                                    GET = interstitial HTML (0 mutation — מה שה-crawler רואה) עם כפתורי
│                                    Lidor/Adir/Osnat ("Confirm action as"); POST (tap אמיתי, crawler-safe)
│                                    = מאמת action_token + actor → מעדכן status + claimed_by/resolved_by
│                                    (resolve מ-profiles.phone) → echo אנגלי לקבוצה (WHAPI_GROUP_ID).
│                                    deployed --no-verify-jwt (ה-token הוא ה-auth).
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
  "ops_board"    → OperationsBoard  // ★ session 21 — "תפעול ואחזקה", ArrivalImportPanel (sole import
                                    // surface) mounted here. "tasks"/"calls" = deep-link aliases,
                                    // same component (TaskBoard.js + the old CallsPage both deleted).
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
| `profiles` | משתמשים — extends Supabase Auth + ★ session 21: `phone` (E.164, unique-where-not-null) — מזהה צוות בעבור staff-ops-webhook | `auth.uid() = id` |
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
| `bot_settings` | system_prompt + knowledge_base + `preferred_model` (id=1) — ★ session 21: ערך חי כעת `gemini-2.0-flash-lite` (היה Claude מ-session 15) — toggle ב-BotSettings.js | `auth.uid() IS NOT NULL` |
| `message_templates` | תבניות שידור עם sort_order | `auth.uid() IS NOT NULL` |
| `bot_scripts` | סקריפטים מותאמים לכל trigger_event | authenticated |
| `tasks` | ★ session 21: "תפעול ואחזקה" — `status` עכשיו `open`/`in_progress`/`done` (היה רק open/done), + `sla_category`/`sla_deadline`/`escalated_at`/`claimed_by`/`claimed_at`/`source`/`reporter_profile_id`/`reporter_raw_text`. `source='legacy_service_call'` = backfill חד-פעמי מ-`service_calls` (migration 071) + ★ session 22 (migration 073): `action_token` (סוד ל-URL של כפתורי Accept/Complete) + `source_message_id` (UNIQUE partial, webhook idempotency) | open to authenticated |
| `ai_failover_events` | ★ session 21 — לוג כל auto-failover Claude↔Gemini בwebhook, נצרך ע"י AiFailoverWidget.js (realtime) | authenticated read, service-role write |
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
payment_amount      NUMERIC — סכום לתשלום (₪) — migration 023. ★ session 25: כעת שדה תמיד-גלוי
                            ב-AddGuestModal (לא רק ב-popup הנפרד "💳 תשלום" ב-GuestsPage שמוצג רק
                            אחרי arrival_confirmed). נקרא ע"י sendStage2PayReply (whatsapp-webhook)
                            כש-Stage 2 Pay יורה אוטומטית, וע"י BRANCH E (payment_and_workshops) ב-whatsapp-send.
payment_link_url    TEXT  — קישור תשלום — migration 023. אותה הערה כמו payment_amount למעלה.

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
| `log_guest_request` tool-calling (session 17) | פרוס, לא נבדק חי | מומש ל-Gemini+Claude, `guest_alerts` הפך לselective (ראה session 17 למטה). Deploy+build עברו נקי, אבל **לא נשלחה הודעת WhatsApp אמיתית** לאימות שהמודל בפועל קורא לכלי ושה-Requests Board מציג שורה נכונה. שלח/י הודעת בדיקה עם בקשה ספציפית (יין/פרחים) לפני שסומכים על זה בפרודקשן. |

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
| **Whapi live test** (session 22) | ✅ הושלם בסשן: `WHAPI_TOKEN`+`WHAPI_GROUP_ID` (`120363320093485583@g.us`) הוגדרו ואומתו (Whapi `/health`=AUTH, channel מחובר), webhook ה-channel הופנה (`PATCH /settings`) ל-`…/functions/v1/whapi-webhook` (events: messages; webhook ה-Make.com הוסר — clean cut). **נשאר רק:** מבחן חי בקבוצה ע"י Mike (`ROOM 14 towels` → כרטיס → Accept/Complete). `staff-ops-webhook` + ה-relay של Make.com מתים כעת (אין input) — להסיר רשמית אחרי אימות. | נמוך |
| `SLA_ESCALATION_ENABLED` | ✅ הופעל session 22 (`=true`). sla-escalation-cron רץ */1min: ops = strict 7-min unassigned → Whapi group (grandfather baseline ב-migration 074 מנע blast רטרואקטיבי על backlog), guest_alerts = 10-min → Adir (Meta). ⚠️ ההפעלה הדליקה גם את escalation ה-guest_alerts (לא בוצע לו grandfather) — guest alerts ישנים שלא נפתרו עלולים להתריע ל-Adir. | — |
| Resilient Import Agent — **מושהה באמצע** (session 9) | `suggest-import-mapping` Edge Function + `import_mapping_memory` table (migration 049) **פרוסים בפועל** ב-Supabase, אבל שינויי הפרונטאנד (`ArrivalImportPanel.js`, `MappingReviewPanel.js`, `importMapper.js`, פרמטריזציית `ezgoParser.js`) **לא commit-ים, לא pushed** — קיימים רק ב-working tree המקומי. יש גם debug-branch זמני (`if (debug)`) ב-`suggest-import-mapping/index.ts` שצריך להסיר לפני שמחליטים שזה "מוכן". המשך/סגור בסשן נפרד. | בינוני |

---

### היסטוריית סשנים

> 📚 **הנרטיב המלא סשן-אחר-סשן (sessions 2–23) הועבר ל-[`claude_history.md`](claude_history.md)** — שום מידע לא אבד, רק הופרד מהקובץ הפעיל הזה כדי לחסוך טוקנים. קרא שם כשצריך הקשר היסטורי מפורט על באג/החלטה ספציפית. למטה נשמרת רק הערת-הסיום של הסשן הנוכחי.

#### session 24 — Jun 24 2026 (Prompt-Leak Firewall + Mobile badge fix)
> הקשר: דירקטיבת "STRICT SPRINT MODE" — שני ספרינטים מבודדים: (1) firewall לדליפת chain-of-thought אנגלי מ-Guest Concierge, (2) תיקון badge/overlay שחוסם את ה-chat במובייל. **Bot 2 (Whapi/staff) לא נגעתי בו בכלל** — סקופ מפורש.

- ✅ **Sprint 1 — Prompt-Leak Firewall (`whatsapp-webhook/index.ts` בלבד).** הורחב `sanitizeReply()`'s `COT_CUE` regex לכסות את ביטויי הדליפה שדווחו חיים: "According to the instructions…", "category should be…" (המודל "חושב בקול" על ארגומנט ה-`category` של כלי `log_guest_request`), "Let's break down…". נוסף כלל אנטי-דליפה עברי ל-`FALLBACK_SYSTEM_PROMPT` + `buildSystemPrompt()` (כלל 9). **ממצא מרכזי:** אין פרומפט אנגלי hardcoded שצריך "להסיר" כפי שהדירקטיבה הניחה — כל נתיב הפרומפט כבר עברי ו-DB-driven (`finalSystemPrompt` מעדיף `bot_settings.system_prompt` החי), וגם `TOOL_USAGE_INSTRUCTIONS` כתוב בעברית. הערובה האמיתית היא ה-firewall ב-`sendReply()` (chokepoint יחיד לכל reply יוצא, עם empty-guard שמחליף לשורת עברית בטוחה אם הכל נחתך) — זה כבר היה במקום מסשן קודם (uncommitted), והסשן הזה חיזק את ה-COT detection וקיבע אותו. ⚠️ הכלל ב-FALLBACK/buildSystemPrompt משפיע רק על נתיבי ה-fallback (קוד) — הנתיב החי הוא ה-DB; אם רוצים לדכא את הדליפה גם במקור החי צריך migration שמוסיף שורה ל-`bot_settings.system_prompt` (כמו 056/058/062/064). פרוס בייצור (`functions deploy whatsapp-webhook`).
- ✅ **Sprint 2 — Mobile badge fix (`RequestsAlertWidget.js`).** ה-FAB של "לוח בקשות" (📋) חסם את ה-composer של ה-WhatsApp inbox במובייל (default `bottom:24/right:24` ישב מעל כפתור השליחה ב-~360px). תוקן בגישת "Both": (1) anchor ברירת-מחדל מודע-מובייל (`bottom:96/right:16` ב-`<768px`, מנקה את ה-composer), (2) wrapper הניתן לגרירה ב-pointer events (סף 6px ל-tap-vs-drag כדי שלחיצה רגילה עדיין מנווטת ללוח), המיקום נשמר ל-`localStorage` (`requestsWidgetPos`). desktop ללא שינוי. **לא נגעתי** ב-`AICopilot.js` (bottom-left, widget realtime מורכב — סיכון גבוה) ולא בלוגיקת `AiFailoverWidget.js` (banner top-center, כבר transient + יש כפתור סגירה). build נקי (רק אזהרת `ShiftsPage` הקיימת).
- ⚠️ **לא אומת חזותית חי** — אותו קיר Supabase Auth מקומי מ-sessions 19–23 (קרדנציאלס דמו על המסך נכשלים). אומת build נקי + deploy מצליח (Deno type-check עבר) בלבד.
- ⚠️ **לא נגעתי / מחוץ לסקופ (נשאר ב-working tree):** `whatsapp-send/index.ts` (שינוי broadcast/`MANUAL_TRIGGERS` kill-switch מסשן "24" אחר, uncommitted — **לא** commit-תי אותו, לא שלי), והקבצים ה-untracked (`.claude/claude_bot.py`, `DREAM_CONCIERGE_SYSTEM_PROMPT.txt`, `migration 076`).
- ✅ **CLAUDE.md token cleanup:** היסטוריית הסשנים (sessions 2–23, ~310 שורות) + ה-blockquote הנפוח בראש הקובץ הועברו ל-`claude_history.md` (archive, **לא** מחיקה). רפרנס הארכיטקטורה (§0–§13) נשאר כאן בכוונה — הוא ידע פעיל, לא היסטוריה.

#### session 25 — Jun 24 2026 (24h Window Guard + Automation History + Payment field decoupling)
> הקשר: דירקטיבת "STRICT SPRINT MODE" — שלושה ספרינטים: (1) 24-Hour Interaction Window Guard לאוטומציה, (2) "📜 מה נשלח" history tab, (3) ניתוק שדות תשלום מ-status. **לפני מימוש — נחקר הקוד הקיים לעומק** כדי לא לבנות מחדש מה שכבר קיים (ראה ממצא מרכזי בכל ספרינט).

- ✅ **Sprint 1 — 24-Hour Interaction Window Guard.** ממצא מרכזי: המנגנון ה"היברידי" (session message בתוך חלון 24ש׳ / Meta template מחוצה לו) **כבר קיים ופעיל** מ-Phase 4 (`automation_stages.node_type='hybrid'` + `whatsapp-send`'s BRANCH D + ה-UI ב-AutomationControlCenter's Timeline tab לעריכת `session_message_script_key`) — אין צורך לבנות אותו מאפס. הפער האמיתי, המתועד כבר ב-§CORE BUSINESS LOGIC point 3 כ-⚠️ פתוח: **`inbox_reply` (BRANCH C) שלח free-text בלי לבדוק את החלון כלל** — אם מנהל ענה אחרי 24ש׳, Meta דחה את השליחה אחרי שניסינו, בלי אזהרה מוקדמת. תוקן: נוסף `isWindowOpen()` helper (`whatsapp-send/index.ts`) + בדיקה לפני קריאת Meta ב-BRANCH C — מחזיר `{ok:false, status:"window_closed", error:"..."}` עברי וברור ללא ניסיון שליחה כלל (נאכף רק כש-`phone` תואם guest קיים). בנוסף, חוסן BRANCH D: אם `sendInteractiveButtons` (נתיב session message) נכשל, fallback אוטומטי בתוך אותה קריאה ל-`sendViaTemplate` — כך ששלב מתוזמן (Stage 1/1.5/2/3/5) לא נשאר בלי הודעה כלל בגלל כשל חד-פעמי בנתיב הראשון; הכשל מתועד ב-`notification_log.payload.sessionMessageFailureNote` גם אם ה-fallback הצליח (FAIL VISIBLE). `WhatsAppInbox.js`: שלושת נקודות הקריאה ל-`inbox_reply` (bulk/handleSendFree/sendManualReply) כבר מציגות `data.error` גולמי — ההודעה החדשה עוברת ללא שינוי קוד נוסף; ה-bulk loop קיבל גם `bulkFailures` state + סיכום כשלים גלוי בסוף הריצה (לפני כן בלע שגיאות פר-נמען בשקט לחלוטין). פרוס בייצור (`functions deploy whatsapp-send`).
- ✅ **Sprint 2 — "📜 מה נשלח" history tab.** ממצא מרכזי: `notification_log` כבר מתעד כל שליחה במערכת (status/payload/sent_at) — לא נדרש שינוי schema. נוסף Edge Function חדש `automation-history` (read-only, אינו שולח/כותב) שמצרף `notification_log` × `guests(name)` × `automation_stages(display_name)`, ומחשב "מועד מתוכנן" עם פונקציית תאריכים מקומית **שכפולה בכוונה** מ-`_shared/automationSchedule.ts` (לא import) — כי ה-eligibility gate של `resolveStageSchedule` המשותף מחזיר `scheduledFor:null` ברגע ש-`guest_flag_column=true`, בדיוק המקרה "כבר נשלח" שהטאב הזה קיים כדי להציג. טאב חדש ב-`AutomationControlCenter.js` (`subTab==="history"`) בסטיילינג תואם לטאב "תור חי" הקיים. פרוס בייצור (`functions deploy automation-history`).
- ✅ **Sprint 3 — ניתוק שדות תשלום מ-status.** ממצא מרכזי: `payment_amount`/`payment_link_url` (migration 023) היו קיימים ב-DB אבל **לא** ב-`AddGuestModal.js` בכלל — הדרך היחידה למלא אותם הייתה popup נפרד ב-`GuestsPage.js` ("💳 תשלום") שמוצג רק אחרי `g.arrival_confirmed===true`. נוספו כשני שדות תמיד-גלויים ב-`AddGuestModal.js` (לא מותנים ב-status/arrival_confirmed) — מנהל יכול למלא אותם מרגע יצירת/עריכת אורח, כך ש-Stage 2 Pay (אירוע-מיידי, יורה כש-arrival_confirmed הופך true) ימצא אותם כבר ממולאים בלי תלות ב-popup הנפרד. ה-popup ב-GuestsPage.js נשאר כפי שהוא ללא שינוי — ממשיך לעבוד כ-fallback (אם השדות עדיין ריקים, נפתח אוטומטית; אם מולאו מראש ב-AddGuestModal, הכפתור שולח ישירות).
- ⚠️ **לא אומת חזותית חי** — אותו קיר Supabase Auth מקומי מ-sessions 19–24. אומת build נקי (`npm run build`, רק אזהרת `ShiftsPage` הקיימת) + שני `functions deploy` הצליחו (Deno type-check עבר) בלבד.
- ℹ️ **קומיט משולב:** ה-commit של הסשן הזה כולל גם את תיקון `MANUAL_TRIGGERS`/kill-switch ב-`whatsapp-send/index.ts` שנשאר uncommitted מ-session 24 (תועד שם כ"לא שלי" אך כתיקון שלם ומתועד, לא WIP) — שני הסשנים נגעו באותו קובץ; הקבצים ה-untracked האחרים (`.claude/claude_bot.py`, `DREAM_CONCIERGE_SYSTEM_PROMPT.txt`, `migration 076`) **לא** נכללו — מחוץ לסקופ, לא נבדקו.

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

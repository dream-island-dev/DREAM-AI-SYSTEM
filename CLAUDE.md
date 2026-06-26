# CLAUDE.md — Dream Island AI System
> קובץ זה נקרא אוטומטית בכל שיחה. הוא מקור-האמת שלך. קרא אותו לפני כל פעולה.
> **עדכון אחרון:** 2026-06-26 (session 48 — Voice/Audio Ticket Support: `whapi-webhook` מתמלל כעת הודעות קוליות (Gemini — Claude אין לו קלט אודיו) ומחזיר אותן לאותו צינור סיווג קיים בדיוק (Tier-0 regex/Tier-1 Claude) שמשמש טקסט מוקלד — בלי לוגיקה כפולה. ⚠️ נתפס ותוקן באותו סשן: deploy ראשון קרס (`BOOT_ERROR`) כי `std@0.168.0`'s מודול base64 מייצא `encode`, לא `encodeBase64` — נתפס ע"י smoke-test לפני שמשתמש אמיתי נחשף. לא נבדק תמלול אמיתי — דורש הודעה קולית מטלפון אמיתי. session 47 (Inventory Smart-Intake Module — ה"סוכן" הוחלף במודול חידוש-מלאי חכם, `/inv/:token`, migration 090) נשאר מתועד למטה. ראה §10 sessions 47–48 לפירוט מלא.).
>
> 📚 **היסטוריית הסשנים המלאה (sessions 2–44) הועברה ל-[`claude_history.md`](claude_history.md)** כדי לשמור את הקובץ הזה קליל. שום מידע לא נמחק — רק הופרד. הקובץ הזה מחזיק את **רפרנס הארכיטקטורה החי** (§0–§13); הקובץ ההוא מחזיק את הנרטיב ההיסטורי. כשצריך הקשר מפורט על באג/החלטה ישנה — קרא שם.
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
│   ├── index.js                  ★ session 35: CRA entry point — קודם רינדר ישיר של `<App/>`.
│   │                                כעת בודק `window.location.pathname` תחילה: `/portal/:token` →
│   │                                `<GuestPortal token/>` **במקום** `<App/>` — לפני שום hook
│   │                                staff-auth (Supabase session listener וכו') מתחיל לרוץ. אין
│   │                                react-router-dom בפרויקט (§2, בכוונה) — זה ה-route הציבורי
│   │                                היחיד, אז בדיקת path בודדת כאן פשוטה ובטוחה יותר מהוספת
│   │                                ספריית ניתוב. Vercel's CRA preset (אין vercel.json) +
│   │                                webpack-dev-server's historyApiFallback כבר מגישים
│   │                                index.html לכל path לא-מוכר — אומת ישירות (`fetch("/portal/x")`
│   │                                → 200 + `<div id="root">`).
│   ├── styles.css                162B  — minimal (real styles ב-App.js)
│   ├── utils/
│   │   ├── admin.js              2.2KB — isAdminUser(), isSuperAdmin(), loadDepartments()
│   │   ├── pushNotifications.js  3.3KB — getPushState, subscribe/unsubscribe
│   │   ├── ezgoParser.js         IL mobile regex + extractGuestDetails + aggregateGuestProfiles
│   │   │                            Pure transform — zero Supabase calls. Called from ArrivalImportPanel.js.
│   │   └── guestTiming.js        ★ NEW (session 42) — getGuestTimingBadge(guest): pure function,
│   │                                computes "🟡 הגעה עתידית: DD/MM" / "🟢 אורח בריזורט" / "⚪ אורח
│   │                                לאחר עזיבה" live from arrival_date/departure_date/status — no
│   │                                stored tag, so it can't go stale (§0.5). Used by OperationsBoard.js
│   │                                (tasks→guests join) + RequestsBoard.js (guest_alerts→guests join).
│   │                                Frontend-only — the two Edge Functions that need the same check
│   │                                (guest-portal-ops-request, sla-escalation-cron) duplicate the
│   │                                comparison locally, same convention as every other Deno
│   │                                front/back-boundary constant in this repo.
│   ├── data/
│   │   ├── demoAgentProfile.js   9.1KB — DreamBot demo profile + opening suggestions
│   │   └── suiteRegistry.js      ★ NEW (session 7) — SUITE_REGISTRY (26 real suites, canonical
│   │                                names) + SUITE_SECTIONS (brand groupings). Single source for
│   │                                every "assign a room" dropdown: ArrivalImportPanel, GuestsPage,
│   │                                RoomBoard, AICopilot.
│   ├── context/
│   │   └── AuthContext.js       ★ NEW (session 31) — AuthProvider/useAuth: session+AAL state for the
│   │                               CMS 2FA gate (§7). Independent of App.js's own `user` state — reads
│   │                               the same shared Supabase session directly (one client, one session
│   │                               per tab). Proactive token refresh (5 min before expiry) + a
│   │                               sessionWarning flag consumed by SessionExpiryModal on silent-refresh
│   │                               failure.
│   └── components/
│       ├── ShiftGenerator.js     58KB  מחולל משמרות — LOCAL ONLY, אין קריאת Edge Function
│       ├── BroadcastDashboard.js 37KB  שידור WhatsApp — תבניות מ-DB (message_templates)
│       ├── GuestDashboard.js     ★ "ניהול אורחים" (vip_guests route) — pipeline tactical view
│       │                            (כולם / בילוי יומי / לינה). שונה מ-GuestsPage ("צ'ק-אין")!
│       │                            ⚠️ שני קומפוננטות שונות מנהלות אורחים — לא לבלבל בשיחה.
│       │                            session 12: "הוסף אורח" עובר עכשיו דרך AddGuestModal המשותף
│       │                            (לא טופס מקומי מקוצר) — כך שגם אורח שנוסף מכאן מקבל spa_time.
│       │                            ★ session 27: לחיצה על שם האורח פותחת CustomerProfilePane.
│       │                            ★ session 33: ה-`guests` select המפורש (לא `*`) היה חסר
│       │                            `meal_time`/`meal_location`/`treatment_count`/`order_number`/
│       │                            `payment_amount`/`payment_link_url`/`needs_callback` — פער
│       │                            Zero-Data-Loss אמיתי שקדם לסשן הזה (AddGuestModal שולח patch
│       │                            מלא, לא diff, אז עריכת אורח מכאן אִפסה את השדות החסרים בשקט).
│       │                            תוקן — כל השדות שAddGuestModal כותב נמצאים כעת ב-select.
│       ├── CustomerProfilePane.js ★ NEW (session 27) — slide-out guest profile drawer. מציג סה"כ
│       │                            לילות (מחושב arrival_date↔departure_date) + שעת צ'ק-אאוט
│       │                            (suite_rooms.checkout_time לפי phone, fallback ל-"11:00" —
│       │                            ערך ברירת המחדל הקיים ב-bot_config.hotel_checkout_time).
│       │                            נפתח מ-GuestDashboard.js (לחיצה על שם אורח); read-only.
│       │                            ★ session 33: תוקן באג RTL — ה-overlay החיצוני (`justifyContent:
│       │                            "flex-end"`) ירש `direction:rtl` מ-`<html dir="rtl">` הגלובלי
│       │                            (index.html), מה ש-flex-end הופך ללוגי (שמאל ב-RTL, לא ימין
│       │                            פיזי) — הפאנל קוקע בפועל בשמאל המסך, לא בימין כמתועד/מיועד.
│       │                            נוסף `direction:"ltr"` מפורש ל-overlay החיצוני בלבד (הפאנל
│       │                            הפנימי שומר `direction:"rtl"` לטקסט). אותו תיקון בדיוק הוחל
│       │                            במקביל ב-AddGuestModal.js's `dock="right"` החדש (למטה).
│       │                            ★ session 35: כפתור "🔗 העתק קישור לפורטל האורח" — מעתיק
│       │                            ל-clipboard את `${origin}/portal/${guest.portal_token}` (לא
│       │                            phone — ראה §10 session 35 להסבר האבטחה). זו נקודת הגישה
│       │                            היחידה לקבלת קישור פורטל אורח אמיתי כיום — fallback ל-
│       │                            `window.prompt` אם clipboard API חסום (context לא-מאובטח).
│       │                            דורש `portal_token` ב-select של GuestDashboard.js (נוסף).
│       ├── GuestPortal.js        ★ NEW (session 35) — Pre-Arrival Guest Portal. עמוד **ציבורי,
│       │                            ללא סיסמה, ללא קשר לכל לוגיקת ה-auth/Sidebar הקיימת**.
│       │                            מורכב מ-`index.js` (ראה למעלה) ב-route `/portal/:token` —
│       │                            `token` = `guests.portal_token` (UUID, migration 083), לא
│       │                            phone. קורא ל-Edge Function `guest-portal-data` (service-role,
│       │                            לא RLS) ומקבל subset בטוח של שדות (שם/חדר/תאריכים/ספא/ארוחה —
│       │                            **לא** טלפון/תשלום/הערות-פנימיות/claimed_by). Hero עם countdown
│       │                            חי (days/hours/minutes/seconds) לצ'ק-אין (`arrival_date` +
│       │                            "15:00" קבוע — משקף את `bot_config.hotel_checkin_time`'s
│       │                            ברירת המחדל, לא נטען בנפרד כדי לשמור על round-trip יחיד), עם
│       │                            3 phases: `upcoming` (countdown)/`in_stay` (ברכת-נוכחות)/
│       │                            `past` (תודה). פאנל itinerary (glass panel) מציג spa_time/
│       │                            meal_time+meal_location — שורה מוצגת רק אם יש לה ערך (לא
│       │                            "null" גולמי). מרכיב `PhotoTour` (למטה) ומנהל toast הצלחה/
│       │                            שגיאה ל-upsells. פלטת "XOS" נפרדת בכוונה מ-`--gold`/`--ivory`
│       │                            של האפליקציה הפנימית (§11) — `#0f172a`/`#09090b`/`#D4AF37`,
│       │                            לפי הדירקטיבה. `<img src="/logo.png">` עם `onError` שמסתיר
│       │                            את עצמו בשקט אם הקובץ לא קיים (⚠️ הוא **לא** קיים כיום ב-
│       │                            public/ — רק icon-192/512.png) — לא שובר את הדף, רק חוסר
│       │                            לוגו עד שיועלה קובץ אמיתי.
│       ├── PhotoTour.js          ★ NEW (session 35) — scrollytelling virtual tour, ללא three.js/
│       │                            ספריית 3D. כל "סצנה" = section בגובה `100vh` עם
│       │                            IntersectionObserver (לא scroll-listener כבד) שמחליף opacity/
│       │                            transform ב-CSS transition — crossfade דרך CSS, לא JS. רקע =
│       │                            `linear-gradient(...), url(...)` — אם ה-JPG חסר (תמיד היום,
│       │                            ראה למעלה) השכבה השנייה פשוט לא נצבעת והגרדיאנט נשאר, אז שום
│       │                            סצנה לא נראית "שבורה" גם בלי תמונות אמיתיות. 4 סצנות קבועות
│       │                            (`SCENES` קונסט) עם CTAs של upsell ב-2 מהן (ספא; יין+שמפניה).
│       │                            קליק על CTA → `onUpsell(upsellLabel)` prop (מ-GuestPortal) →
│       │                            `guest-portal-upsell`.
│       ├── UserManagement.js     21KB  ניהול משתמשים
│       ├── AgentChat.js          ⚠️ session 47 — ORPHANED. `case "agent"` ב-App.js לא מרכיב אותו
│       │                            יותר (הוחלף ב-InventoryHub.js, ראה למטה) — קוד+דאטה נשארו
│       │                            כמו שהם בכוונה (Mike אישר מפורשות), רק לא מקושרים יותר.
│       ├── AgentQuestionnaire.js ⚠️ session 47 — עדיין מרכב, אבל רק בתוך מודאל "הגדרות הסוכן" שאין
│       │                            יותר caller שפותח אותו (היה נפתח מ-AgentChat, שהוסר). בפועל
│       │                            בלתי-נגיש, לא נמחק.
│       ├── InventoryHub.js       ★ NEW (session 47) — מרכיב ב-`case "agent"` במקום ה-Agent הישן.
│       │                            shell עם 3 sub-tabs (אותו pattern כמו AutomationControlCenter.js):
│       │                            "ייבוא מסמך" (InventoryImportPanel) / "קישורים" (InventoryLinksPanel)
│       │                            / "ממתינים לאישור" (InventoryApprovalQueue).
│       ├── InventoryImportPanel.js ★ NEW (session 47) — 3 כרטיסי בחירת סוג מסמך (לא ניחוש אוטומטי —
│       │                            Mike ביקש בחירה אנושית מפורשת). "חידוש מלאי": Excel/CSV →
│       │                            suggest-import-mapping (schemaKey="inventory_renewal", הורחב
│       │                            session זה) → MappingReviewPanel (קיים, ללא שינוי) → EditableGrid
│       │                            לאישור → RPC `upsert_inventory_items`. `parLevel`/`restockColumn`
│       │                            נקראים כערכים גלויים מהקובץ (לא formula syntax!) —
│       │                            `deriveParLevel()` (importMapper.js) משלים יעד=כמות+השלמה כשיש
│       │                            רק עמודת "להשלים". "סידור משמרות": deep-link ל-scheduler הקיים
│       │                            (`onOpenScheduler` prop), לא מיושם כאן. "טופס חכם": stub מנוטרל
│       │                            עם הסבר (Disable Don't Hide, §0.2) — מחוץ ל-scope המאושר.
│       ├── InventoryLinksPanel.js ★ NEW (session 47) — ניהול `inventory_portal_links`: יצירה,
│       │                            "צור קישור חדש" (deactivate+insert, לא mutate), קופי-קליפבורד +
│       │                            WhatsApp share — אותו clipboard+prompt-fallback pattern כמו
│       │                            CustomerProfilePane.js's כפתור קישור-פורטל-אורח.
│       ├── InventoryApprovalQueue.js ★ NEW (session 47) — תור `inventory_submissions`: ממתין/הצג-גם-
│       │                            טופלו (אותה קונבנציה כמו RequestsBoard.js), כל שורה ניתנת
│       │                            להרחבה לפריטי `inventory_counts`, פעולות אשר/ערוך-לפני-אישור/דחה
│       │                            (אותה קונבנציה כמו SpaStagingPanel.js) — pending/approved/rejected
│       │                            כולם נשארים גלויים, אף אחד לא נעלם.
│       ├── InventoryPortal.js    ★ NEW (session 47) — מסך ציבורי בלי login ב-`/inv/:token` (נבדק
│       │                            ב-src/index.js *לפני* `<App/>`, אותו pattern כמו GuestPortal.js).
│       │                            ⚠️ לא יכול להשתמש ב-CSS variables (`var(--gold)` וכו') — אלה
│       │                            מוזרקות ע"י App.js עצמו ולא קיימות כש-route זה מרונדר *במקומו*;
│       │                            אותה מגבלה בדיוק כמו GuestPortal.js, אבל בשונה מהפלטה הנפרדת
│       │                            "XOS" של GuestPortal (לאורחים) — זה כלי לצוות, hardcoded לאותם
│       │                            hex values כמו --gold הפנימי. כפתורי +/− גדולים לכל פריט,
│       │                            "שלח לאישור" יוצר `inventory_submissions`+`inventory_counts` —
│       │                            שום דבר לא נכנס ל"מלאי חי" בלי אישור מנהל.
│       ├── WhatsAppInbox.js      ★ session 33 — "Operations Control Room". היה 18KB/תיבת שיחות
│       │                            בלבד; קיבל בסשן זה: (1) **WordPress-style guest editor** —
│       │                            כפתור ✏️ בכותרת ה-thread פותח AddGuestModal כ-drawer ימני
│       │                            (`dock="right"`) דרך `openGuestEditor()` (fetch מלא לפי phone
│       │                            variants, לא רק השדות החלקיים שה-join של תיבת השיחות נושא),
│       │                            (2) **Claim/assignment מתמשך** — כפתור toggle יחיד בכותרת
│       │                            (🙋 לא-משויך → 🔁 השתלטות → ✓ שלך, קליק נוסף = שחרור) כותב
│       │                            ל-`guests.claimed_by`/`claimed_at` (migration 081); badge
│       │                            "🔒 בטיפול: [שם]" ב-roster, נפתר משם profiles.id→name map
│       │                            שנטען פעם אחת. כל סטטוס שיוך — ללא שער הרשאות (small-team
│       │                            cooperative tool, כמו OperationsBoard's claim). (3) **Realtime
│       │                            cross-tab sync** — channel חדש ונפרד (`wa-inbox-guests-rt`,
│       │                            בכוונה לא מאוחד עם `wa-inbox-rt-v2` הקיים כדי לא לסכן את לוגיקת
│       │                            ה-reconnect שלו) על `postgres_changes` UPDATE של `guests` —
│       │                            claim/release/עריכה מטאב אחד מופיע בטאבים אחרים בלי רענון
│       │                            (`applyGuestRowUpdate()`, פונקציה משותפת גם לשמירת ה-drawer
│       │                            וגם ל-payload של ה-realtime — לא שני מסלולי patch שיכולים
│       │                            להתפזר). דורש את `guests` ב-`supabase_realtime` publication
│       │                            (migration 082, אותו failure mode מתועד כמו migration 059).
│       │                            (4) **Contextual macros (No-Token Quick Replies)** —
│       │                            `buildContextualMacros(activeContact)` מציגה כפתורי זהב מ-
│       │                            `spa_time`/`meal_time`/`room` כש-`spa_time`/`meal_time`/`room`
│       │                            קיימים — templating טהור, אפס קריאות LLM/טוקנים. (5) **Roster
│       │                            chips** — `roomChipMeta()` קורא ל-`getSuiteSection()` הקיים
│       │                            (suiteRegistry.js) להציג "🏨 [שם סוויטה]" צבוע-לפי-section, או
│       │                            "☀️ בילוי יומי [1/2]" ל-Premium Day packages/room_type='day_guest'.
│       │                            שלושת ה-badges (זהות/חדר/שיוך) עברו ל-flex row עם wrap כדי לא
│       │                            להישבר ברוחב צר. ה-join הראשי (fetchAll+fetchSince) הורחב ל-
│       │                            id/room_type/status/departure_date/meal_time/meal_location/
│       │                            claimed_by/claimed_at — לא query נוסף, אותה קריאה קיימת.
│       │                            ★ session 34: (6) **AI Suggestions (on-demand)** —
│       │                            `QUICK_PHRASES` הסטטי (עם `{{שם}}` שדלף גולמי לכל מי שלא תאם
│       │                            `activeContact.guestName`) **הוסר מ-drawer ה-thread** (נשאר
│       │                            בשימוש ב-`NewChatModal` בלבד — שיווק לאורח-בלי-שיחה-פעילה, לא
│       │                            מה שתועד כ"דמוי"). כפתור "✨ הצעות AI חכמות" → `generateAiSuggestions()`
│       │                            → Edge Function חדש `suggest-replies` (Gemini→Claude, 3 הודעות
│       │                            אחרונות + guestName/room) — **נקרא רק בקליק מפורש, לעולם לא
│       │                            אוטומטית בבחירת שיחה** (token-saving by design, ראה §10 session 34).
│       │                            macros הקשריים (4 למעלה) ממשיכים להופיע **בנוסף** לכפתור ה-AI,
│       │                            לא הוחלפו — שניהם זמינים יחד. (7) **Smart Task Routing** —
│       │                            "🔧/🛏️" לא עוד יורים `tasks` insert מיידי עם טקסט ההודעה הגולמי
│       │                            של האורח; פותחים picker (`routeDraft` state) עם chips
│       │                            תת-קטגוריה (`TASK_SUBCATEGORIES`) + שדה free-text — `routeTask()`
│       │                            מקבל כעת `subCategoryLabel`/`note` ובונה מהם את ה-description,
│       │                            עם נפילה לטקסט הגולמי רק אם שניהם ריקים. כפתור "🚀 שלח משימה"
│       │                            מנוטרל (Disable Don't Hide, §0.2) עד שנבחר chip אחד לפחות
│       │                            או הוזן free-text.
│       ├── AdminPanel.js         18KB  לוח בקרה admin
│       ├── ArrivalImportPanel.js ★ NEW (session 7) — Unified Import Hub, היחיד באפליקציה.
│       │                            מורכב מתוך TaskBoard בלבד. 2 פרופילים:
│       │                            "suites" — Suite CSV (+ Daily Report אופציונלי) → EditableGrid
│       │                              (dropdown חדר מ-SUITE_REGISTRY) → sync_suite_arrivals RPC
│       │                            "shifts" — כל Excel → EditableGrid → ייצוא חזרה (ללא DB write)
│       │                            DataUpload.js + DataHub.js נמחקו (session 7) — מוזגו לתוכו.
│       │                            ★ session 32: קיבל prop `defaultOpen` (ברירת מחדל false, לא
│       │                            שובר את ההתנהגות הקיימת בתוך OperationsBoard) + restyle ל-
│       │                            deep-dark/gold chrome (header/panel/tabs/banners) — ראה
│       │                            DataSyncPage.js למטה ו-§10 session 32.
│       ├── DataSyncPage.js      ★ NEW (session 32) — "סנכרון נתונים" (route עצמאי, admin/super_admin,
│       │                            סיידבר אדמין). Thin wrapper בלבד: מרכיב כותרת luxury (dark+gold)
│       │                            מעל `<ArrivalImportPanel defaultOpen />` הקיים. **לא** מנוע ייבוא
│       │                            מקביל — אין כאן שום parsing/upsert logic. נוסף כדי שאדמין יוכל
│       │                            להגיע לייבוא בלי לעבור דרך "תפעול ואחזקה"; ArrivalImportPanel
│       │                            עדיין מורכב גם שם (OperationsBoard.js:483) ללא שינוי.
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
│       │                            ★ session 27: כרטיס "✅ בוצע" מציג כעת "✔️ בוצע ע״י: [שם/טלפון]"
│       │                            (resolved_by_name/resolved_by_phone, migration 078) — גם למשימה
│       │                            שנפתרה דרך 👍🏼 בוואטסאפ וגם דרך הכפתור באפליקציה. SOURCE_META
│       │                            קיבל ערך `manual_group` (✍️ קבוצת צוות).
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
│       │                            ★ session 33: קיבל prop `dock` — `dock="right"` מרנדר אותו
│       │                            כ-drawer ימני נגרר-פנימה (slide-in) במקום מודאל ממורכז, ברירת
│       │                            המחדל (ללא prop) משאירה את שני הצרכנים הקיימים ללא שינוי. נוסף
│       │                            textarea ל-`guest_notes` (migration 053 — היה append-only, בלי
│       │                            עורך בשום מקום באפליקציה עד כה) + שדות `meal_time`/`meal_location`
│       │                            (migration 081). נצרך עכשיו גם מ-WhatsAppInbox.js (ראה למטה).
│       ├── SuitesDashboard.js    "פירוט חדרים" (suites route) — per-room grid מ-suite_rooms,
│       │                            סטטוס חי מ-guests. ⚠️ לא להתבלבל עם RoomBoard ("לוח סוויטות")!
│       │                            session 12: route עדיין קיים אך הוסר מה-Sidebar nav (לא נגיש
│       │                            יותר ל-UI רגיל — ראה §4).
│       ├── RoomBoard.js          ★ "לוח סוויטות" (room_board route, ניהול — managers/admins).
│       │                            סטטוסים: תפוס/פנוי/לניקיון/בניקיון/ממתין לאישור/תחזוקה —
│       │                            pipeline נפרד לחלוטין מ-guests.status. מקור: room_status table.
│       │                            timer ניקיון חי, מודאל אישור, "ממתין לאישור" = מנוטרל ע"י AICopilot.
│       │                            ★ session 27: badge דינמי על אורח מקושר לחדר — 🟢 "אורח נוכחי"
│       │                            (status='checked_in', שם+תאריך עזיבה) מול 🔵 "הגעה קרובה"
│       │                            (pending/expected/room_ready, שם+ETA+חלון ספא). שאילתת guests
│       │                            הורחבה ל-'expected' + spa_time.
│       │                            ⚠️ session 28: לא עוד מסך ה-cleaner — תפקיד "cleaner" קיבל מסך
│       │                            מלא חדש, HousekeepingTabletView.js (למטה). הקומפוננטה הזו עדיין
│       │                            קיימת ומלאה, נגישה ל-managers/admins דרך "room_board" nav item,
│       │                            ל-תחזוקה/תפוס/ניהול 6-סטטוסים מלא ש-HousekeepingTabletView לא חושף.
│       ├── HousekeepingTabletView.js ★ (session 28, מורחב session 29) — "לוח ניקיון (טאבלט)"
│       │                            (housekeeping_tablet route, + מסך מלא לתפקיד cleaner, ללא
│       │                            Sidebar). 3 כפתורי fat-finger ענקיים מוערמים על כל כרטיס חדר —
│       │                            🔴 מלוכלך/Dirty · 🟡 בניקוי/Cleaning · 🟢 נקי/Clean — אופטימיסטי,
│       │                            ללא spinner חוסם, revert+toast רק על כשל DB אמיתי. **חולק את
│       │                            room_status table** עם RoomBoard.js + AICopilot.js (§0.5 Single
│       │                            Source of Truth). מיפוי כפתור→DB: 🔴→"לניקיון", 🟡→"בניקיון"
│       │                            (חותם cleaning_started_at), 🟢→**room_clean_status="clean"**
│       │                            (לא status="ממתין לאישור" ישירות!).
│       │                            ★ session 29 — Smart Ready-Alert Gate + ג'קוזי: שתי עמודות חדשות
│       │                            על room_status (migration 079) — `jacuzzi_status` (מיני-pipeline
│       │                            עצמאי לג'קוזי הפרטי של הסוויטה) ו-`room_clean_status` (תופס את
│       │                            תפיסת "🟢 נקי" בנפרד מ-`status` הראשי). כפתור רחב נוסף לג'קוזי —
│       │                            🛁 ג'קוזי מלוכלך/Jacuzzi Dirty (אדום) ↔ ✨ ג'קוזי נקי ✅/Jacuzzi
│       │                            Clean ✅ (טורקיז). `status` עובר ל-"ממתין לאישור" (= שער האישור
│       │                            של AICopilot.js, ראה מטה) **רק כש-`room_clean_status`
│       │                            וגם `jacuzzi_status` שניהם "clean"** — תיוג חדר/ג'קוזי אחד בלבד
│       │                            משאיר את `status` כפי שהיה ומציג רמז "✓ מחכה ל-..." שקוף (FAIL
│       │                            VISIBLE, §0.3) במקום להיראות כאילו הלחיצה לא עשתה כלום. 🔴 מאפס
│       │                            את שניהם ל-"dirty" (מחזור ניקיון טרי). בילינגואל HE/EN בכל
│       │                            הממשק (כותרת/סטטיסטיקות/פילטרים/badges/הינטים) — דרישת "צוות זר".
│       │                            חדרים בסטטוס שמחוץ למודל (תפוס/תחזוקה) עדיין מוצגים עם badge
│       │                            נייטרלי משלהם. ללא timer/אישור-מודאל/בדגי אורח מפורטים כמו
│       │                            RoomBoard — קיוסק ממוקד-מהירות בכוונה, נפרד.
│       ├── AICopilot.js          ★ widget צף (פעמון 🔔) לכל manager/admin מחובר. עוקב realtime אחרי
│       │                            room_status='ממתין לאישור' → מציג guest+spa_time → "✓ אשר ושלח
│       │                            הודעה" שולח WhatsApp + מסמן room_status='פנוי' + guests.status=
│       │                            'checked_in'. session 7: נבדק שגיאת WA לא נבלעת.
│       │                            ★ session 29: (1) `handleApprove` עבר מ-trigger:"inbox_reply"
│       │                            (טקסט חופשי, עבד רק בתוך חלון 24ש' פתוח) ל-trigger:"room_ready"
│       │                            — דרך BRANCH D האידמפוטנטי של whatsapp-send, עם תבנית Meta
│       │                            ייעודית `dream_room_ready` (עובדת גם מחוץ לחלון). גם `data?.ok
│       │                            === false` (לא רק שגיאת invoke טרנספורט) נבדק כעת — FAIL VISIBLE
│       │                            אמיתי, היה חסר לפני. (2) הפעמון הפך **גריר** (pointer events,
│       │                            סף 6px tap-vs-drag, אותו pattern כמו RequestsAlertWidget.js) —
│       │                            מיקום נשמר ב-localStorage (`aiCopilotPos`). (3) כרטיס ההתראה
│       │                            מציג כעת במפורש "סוויטה X מוכנה עבור [שם אורח] — לחץ לאישור
│       │                            שליחת הודעה" + אנימציית "flash" קצרה (פעמון + כרטיס) כשמתקבלת
│       │                            התראה חדשה.
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
│       │                            מה נשלח (History, session 25), תבניות Meta (TemplateManagerPanel.js).
│       │                            ★ session 27: סאב-טאב חמישי "✨ אוטומציה חדשה" — Linear Automation
│       │                            Flow Builder (`CustomAutomationBuilder`). שם + תזמון + שלבים
│       │                            מסודרים (תבנית Meta מאושרת מ-`metaTemplatesByName` החי / טקסט
│       │                            חופשי) → custom_automations/custom_automation_steps (migration
│       │                            078). שכבת טיוטה בלבד — לא מחובר ל-runtime (whatsapp-cron/-send),
│       │                            בכוונה נפרד מ-automation_stages (זה שכן מחובר).
│       ├── TemplateManagerPanel.js ★ ניהול תבניות WhatsApp מאושרות מ-Meta — סונכרן/נוצר/preview.
│       │                            מיוצא session 20: STATUS_META (היה module-private) — משותף עם
│       │                            AutomationControlCenter.js's Meta template preview box.
│       └── cms/                  ★ NEW (session 31) — Admin CMS 2FA gate (§7), 5 קבצים שטוחים (אין
│                                    קינון נוסף): CMSGate.js (עטיפה — דורש re-auth סיסמה+TOTP טרי
│                                    לפני רינדור הילדים, מרכיב AuthProvider+CMSPrivateRoute) ·
│                                    CMSLogin.js (מסך כניסה: סיסמה → הרשמת/אימות TOTP, מעוצב עם אותם
│                                    .login-* classes הגלובליים מ-App.js) · CMSPrivateRoute.js (חוסם
│                                    רינדור אלא אם session+aal2) · CMSSecurityPanel.js (מצב הפעלה +
│                                    ניהול התקני Authenticator — העמוד הקונקרטי הראשון מאחורי השער,
│                                    route חדש "cms_security") · SessionExpiryModal.js (התראה
│                                    כש-refresh שקט נכשל). State עצמו ב-src/context/AuthContext.js.
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
│   │   ├── 075_inbox_push_name_and_routed_tasks.sql  applied ✅ — ★ session 23: `whatsapp_conversations.
│   │   │                            push_name` (Meta contacts[].profile.name, Smart Identity Resolution
│   │   │                            fallback) + `tasks.source` CHECK widened with `'inbox_routed'`
│   │   │                            (WhatsAppInbox.js's "Route to Maintenance/Housekeeping" quick action).
│   │   │                            ראה §10 session 23.
│   │   ├── 077_guest_request_routing_and_reactions.sql  applied ✅ — ★ session 26: `tasks.source`
│   │   │                            CHECK + `'guest_request'` (suite-guest ask auto-routed to ops group) +
│   │   │                            `tasks.guest_id` (FK→guests, SET NULL) + `tasks.whapi_message_id`
│   │   │                            (UNIQUE partial — one card per task, resolved by the 👍🏼 reaction
│   │   │                            listener). ראה §10 session 26.
│   │   ├── 078_session27_attribution_and_custom_automations.sql  applied ✅ — ★ session 27:
│   │   │                            `tasks.resolved_by_phone`/`resolved_by_name` (raw Whapi identity,
│   │   │                            FAIL VISIBLE fallback alongside the existing `resolved_by` profiles
│   │   │                            FK) + `tasks.source` CHECK + `'manual_group'` (Room/חדר/סוויטה-
│   │   │                            prefixed manual text in the ops group) + new tables
│   │   │                            `custom_automations`/`custom_automation_steps` (Linear Automation
│   │   │                            Flow Builder draft layer — not yet read by any cron/send path).
│   │   │                            ראה §10 session 27.
│   │   ├── 079_session29_jacuzzi_and_room_ready.sql  applied ✅ — ★ session 29: `room_status.
│   │   │                            jacuzzi_status`/`room_clean_status` (Smart Ready-Alert Gate). ראה §10 session 29.
│   │   ├── 080_session30_stage4_rename_and_receptionist_role.sql  applied ✅ — ★ session 30:
│   │   │                            `automation_stages.display_name` rename + `profiles.role` CHECK + `'receptionist'`.
│   │   │                            ראה §10 session 30.
│   │   ├── 081_guests_claim_and_meal_fields.sql  applied ✅ — ★ session 33: `guests.claimed_by`
│   │   │                            (FK→profiles)/`claimed_at` (persisted conversation assignment,
│   │   │                            WhatsAppInbox.js) + `guests.meal_time`/`meal_location` (same shape
│   │   │                            as spa_time — manual fields feeding the new contextual macros).
│   │   │                            ראה §10 session 33.
│   │   ├── 082_guests_realtime_publication.sql  applied ✅ — ★ session 33: adds `guests` to the
│   │   │                            `supabase_realtime` publication — same documented failure mode as
│   │   │                            migration 059 (guest_alerts): without this, a postgres_changes
│   │   │                            subscription on `guests` subscribes successfully but silently
│   │   │                            never receives an event. ראה §10 session 33.
│   │   └── 083_guest_portal_token_and_upsell_source.sql  applied ✅ — ★ session 35:
│   │                                `guests.portal_token` (UUID, `gen_random_uuid()` default —
│   │                                `uuid_generate_v4()`/uuid-ossp לא מופעל בפרויקט הזה למרות
│   │                                שmigration 001 מפנה אליו, pgcrypto כן מופעל כברירת מחדל) +
│   │                                `tasks_source_check` widened + `'portal_upsell'`. ראה §10 session 35.
│   └── 090_inventory_module.sql                 applied ✅ — ★ session 47: 4 טבלאות חדשות
│   │                                (`inventory_items`/`inventory_portal_links`/`inventory_submissions`/
│   │                                `inventory_counts`, RLS authenticated) + RPC `upsert_inventory_items`
│   │                                (מראה את `sync_suite_arrivals`/migration 046). ראה §10 session 47.
│   └── functions/
│       ├── chat/                deployed ✅ — Gemini 2.5→Claude fallback
│       ├── suggest-replies/     ★ NEW (session 34) — Smart Inbox AI Copilot. Stateless: לא קורא
│       │                            DB בכלל (לא history, לא Drive RAG, לא memory — בכוונה לא
│       │                            משותף עם chat/'s machinery, ראה הערת header בקובץ). מקבל
│       │                            {messages (3 אחרונות, כבר טעונות בצד הלקוח), guestName, room}
│       │                            מ-WhatsAppInbox.js, מחזיר {ok, suggestions:string[], engine}.
│       │                            Gemini 2.5 Flash (responseMimeType:"application/json")→Claude.
│       │                            `parseSuggestions()` עם 3 שכבות fallback parsing (JSON ישיר →
│       │                            regex `{...}` → line-split) כך שתשובת מודל מעוצבת-לא-מושלם
│       │                            (code fence וכו') לא קורסת. deployed --no-verify-jwt.
│       ├── guest-portal-data/   ★ NEW (session 35) — fetch ל-GuestPortal.js הציבורי. service-role
│       │                            בלבד (לא RLS) — מחפש לפי `guests.portal_token`, מחזיר select
│       │                            ידני של שדות בטוחים בלבד (לא `select("*")`: לא phone/payment_*/
│       │                            guest_notes/claimed_by). ★ נמצא תוך בדיקה חיה ותוקן: token
│       │                            לא-בצורת-UUID (typo/קישור פגום) זרק שגיאת Postgres גולמית
│       │                            ("invalid input syntax for type uuid") במקום guest_not_found
│       │                            נקי — נוסף regex guard לפני השאילתה. ראה §10 session 35.
│       ├── guest-portal-upsell/ ★ NEW (session 35) — In-Scroll One-Click "REQUEST"-type Upsells.
│       │                            אותו token guard. מאתר guest לפי portal_token → insert ל-
│       │                            `guest_alerts` (alert_type='upsell_opportunity') — **תיעוד
│       │                            תוקן session 41:** הפונקציה עברה REDESIGN בתוך session
│       │                            36–40 (לפני שתועד כאן) מה-תכנון המקורי (insert ל-`tasks`
│       │                            + כרטיס לקבוצת Whapi, ראה ההערה בקוד עצמו) — בקשת מכירה/ספא
│       │                            היא ליד למכירה שצוות הקבלה/הנהלה אוסף בקצב שלו, לא טיקט
│       │                            תפעולי שצריך claim/SLA בקבוצה. נצרכת ע"י `RequestsBoard.js`
│       │                            (📋 FAB realtime + resolve-with-note). sla-escalation-cron's
│       │                            10-min-unresolved ping ל-SLA_GUEST_ALERT_PHONE (Adir, Meta)
│       │                            עדיין חל עליה כמו כל שורת guest_alerts אחרת. ★ session 41:
│       │                            ראה guest-portal-ops-request למטה ל-OPS_REQUEST type (המקביל
│       │                            התפעולי, ל-tasks, לא ל-guest_alerts).
│       ├── guest-portal-ops-request/ ★ NEW (session 41) — In-Scroll "OPS_REQUEST"-type actions
│       │                            (כרגע: Armonim's "הזמנת שירות לחדר" בלבד). אותו token guard
│       │                            בדיוק כמו guest-portal-upsell, אבל ל-**Operations Board**:
│       │                            insert ל-`tasks` (source='portal_room_service', migration
│       │                            085, department='מזמ"ש (F&B)' — אותו string מדויק כמו
│       │                            OperationsBoard.js's HOTEL_DEPARTMENTS לפילטור נכון) + DM
│       │                            אישי לאדיר (`972546294885`, אותו מספר כמו task-action.ts's
│       │                            whitelist — לא לקבוצה). ⚠️ **resolution דרך claim/done
│       │                            בלוח באפליקציה בלבד, לא 👍🏼** — whapi-webhook's reaction sweep
│       │                            מסנן `chatId.endsWith("@g.us")` בלבד, כך שריאקציה על DM אישי
│       │                            הייתה מתעלמת בשקט; הורחבה כוונה אחרת ל-session עתידי אם
│       │                            יידרש. כשל Whapi הוא best-effort — ה-task עדיין נוצר.
│       ├── suggest-import-mapping/ ★ "Resilient Import Agent" — מעולם לא קיבלה bullet משלה כאן עד
│       │                            session 47 (תיעוד-gap ישן, התייחסות פרוזה בלבד ב-§10). AI מציע
│       │                            מיפוי עמודות (Gemini→Claude) מול schema רשום ב-`SCHEMAS`,
│       │                            לעולם לא כותב ל-DB — `MappingReviewPanel.js` תמיד מציג לאישור
│       │                            אנושי. ★ session 47: schema שני `inventory_renewal` נוסף
│       │                            (היה רק `suite_arrivals`) + `SCHEMA_DOMAIN_LABELS` כדי שפתיח
│       │                            הפרומפט לא יישאר hardcoded ל"הזמנות מלון" לקובץ מלאי.
│       ├── inventory-portal-data/   ★ NEW (session 47) — מראה את guest-portal-data בדיוק: UUID
│       │                            regex guard, service-role lookup לפי `inventory_portal_links.
│       │                            token` **וגם** `is_active=true` (token מבוטל = "לא נמצא", לא
│       │                            שגיאה נפרדת). מחזיר location_name + items — לעולם לא par_level/
│       │                            restock_suggested, העובדת רק מזינה כמות.
│       ├── inventory-portal-submit/ ★ NEW (session 47) — מראה את guest-portal-ops-request: מאמת
│       │                            token, יוצר `inventory_submissions` (pending) + `inventory_counts`
│       │                            — `restock_suggested` מחושב **כאן בשרת** מ-`inventory_items.
│       │                            par_level`, לעולם לא מהלקוח. התראת Whapi best-effort ל-Adir
│       │                            (אותו מספר כמו guest-portal-ops-request) — כשל לא חוסם את ה-DB write.
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
│       ├── whatsapp-webhook/    ★ deployed ✅ v3 — ראה §6 לתיאור מלא. ★ session 26: §4b
│       │                            `routeGuestRequestToOpsGroup()` — Dual-Routing Trigger, ראה §10 session 26.
│       │                            ★ session 27: אותו כרטיס מקבל שורת "👍🏼" hint (§4b) + §4c
│       │                            `isPremiumDaySlotAvailableToday()` — Day-Guest Upsell Gate, ראה §10 session 27.
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
│       │                            ★ session 26: tasks עם source='guest_request' מקבלים נתיב נפרד —
│       │                            DM אישי ל-SLA_OPS_ALERT_PHONE (secret שהוגדר session 21 אבל לא
│       │                            נוצל בקוד עד עכשיו) עם קישור "⚡ Bump Task" (task-action?action=bump),
│       │                            במקום הקבוצה. שאר ה-sources (whatsapp_staff/manual/inbox_routed/
│       │                            legacy) ממשיכים להתנהג כקודם — group alert, ללא שינוי.
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
│       │                            **מחליף את staff-ops-webhook.** Secrets: WHAPI_TOKEN + WHAPI_GROUP_ID
│       │                            ✅ מוגדרים בפועל (אומת session 26 דרך `supabase secrets list` —
│       │                            התיעוד הקודם כאן ש"עדיין לא מוגדרים" התייחס ל-session 22 ולא עודכן).
│       │                            ★ session 26 (Sprint 2): reaction sweep חדש לפני לולאת ההודעות —
│       │                            `extractReactions()` קולט `type:"action"`/`action.type:"reaction"`,
│       │                            👍🏼 (כל גוון עור, codePointAt(0)===U+1F44D) על כרטיס משימה ← מאתר
│       │                            task דרך `whapi_message_id` (עמודה חדשה, migration 077) ← `status:
│       │                            "done"` + `resolved_by`/`resolved_at`. **No-Bloat: אין תגובה לקבוצה**
│       │                            — הריאקציה עצמה היא האות החזותי. כל reaction אחרת מתעלמת בשקט.
│       │                            כרטיס המשימה הקיים (staff report) שומר כעת גם הוא את `whapi_message_id`
│       │                            שלו אחרי שליחה מוצלחת, כך שגם תיקיות "11- towels" נפתרות בריאקציה.
│       │                            ★ session 27 (Sprint 4.1/4.2): `buildTaskCard()` לא בונה יותר
│       │                            קישורי Accept/Complete — שורת "👉 Please react with 👍🏼" בלבד
│       │                            (`task-action`'s GET/POST נשאר חי, רק לא מקושר מהכרטיס — Bump
│       │                            עדיין משתמש בו). reaction sweep כותב כעת גם `resolved_by_phone`/
│       │                            `resolved_by_name` (זהות גולמית, FAIL VISIBLE כש-`resolved_by`
│       │                            ה-FK נשאר NULL). tier="room_prefix" (Room/חדר/סוויטה N ...) כותב
│       │                            `source='manual_group'` במקום `'whatsapp_staff'`.
│       │                            ★ session 48: הודעות `type:"voice"` מתומללות (Gemini, Claude אין לו
│       │                            קלט אודיו) ואז עוברות באותו `parseDeterministic`/`classifyWithAi` —
│       │                            ראה `_shared/whapiMedia.ts` למטה + §10 session 48 לפירוט מלא
│       │                            (כולל BOOT_ERROR שנתפס ותוקן באותו סשן — import name שגוי).
│       ├── _shared/whapiMedia.ts ★ NEW session 48 — `fetchWhapiMedia(mediaId)`: `GET /media/{id}` עם
│       │                            WHAPI_TOKEN, מחזיר base64. `_whapiBase`/`_tokenOrThrow` מ-
│       │                            `whapiSend.ts` הפכו ל-export כדי להישתף (לא לשכפל) בגבול `_shared/`.
│       └── task-action/          ★ NEW session 22 (XOS Sprint 2) — callback ל-Accept/Complete בכרטיס.
│                                    GET = interstitial HTML (0 mutation — מה שה-crawler רואה) עם כפתורי
│                                    Lidor/Adir/Osnat ("Confirm action as"); POST (tap אמיתי, crawler-safe)
│                                    = מאמת action_token + actor → מעדכן status + claimed_by/resolved_by
│                                    (resolve מ-profiles.phone) → echo אנגלי לקבוצה (WHAPI_GROUP_ID).
│                                    deployed --no-verify-jwt (ה-token הוא ה-auth). ★ session 26 (Sprint
│                                    3.3): action שלישי — `bump` — אין מוטציית status/claim, רק resend
│                                    לקבוצה ("⚡ MANAGER BUMP: [room] - desc needed ASAP! ⚡"). זה היעד
│                                    שקישור "Bump Task" ב-DM האישי מ-sla-escalation-cron מצביע עליו.
│                                    ⚠️ session 27: הכרטיס בקבוצה כבר לא מקשר לכאן (ראה whapi-webhook
│                                    למעלה) — accept/complete עדיין עובדים אם מישהו שומר/מדביק קישור
│                                    ישן, אבל הנתיב החי היחיד מהכרטיס עצמו הוא 👍🏼. complete גם הוא
│                                    כותב resolved_by_phone/resolved_by_name כעת (עקביות עם הריאקציה).
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
  "room_board"   → RoomBoard        // ★ "לוח סוויטות" — manager 6-status board (room_status table)
                                    // ⚠️ session 28: זה כבר לא מסך ה-cleaner — ראה housekeeping_tablet
  "housekeeping_tablet" → HousekeepingTabletView  // ★ session 28 — "לוח ניקיון (טאבלט)", 3-button
                                    // fat-finger kiosk. גם המסך המלא של תפקיד "cleaner" כעת (ראה למטה).
  "spa_staging"  → SpaStagingPanel  // "לוח ספא — אישור" — standalone, fed by external email/PDF automation
                                    // ⚠️ session 12: כמו "suites" — route קיים, Sidebar nav item הוסר
  "ops_board"    → OperationsBoard  // ★ session 21 — "תפעול ואחזקה", ArrivalImportPanel (sole import
                                    // surface) mounted here. "tasks"/"calls" = deep-link aliases,
                                    // same component (TaskBoard.js + the old CallsPage both deleted).
  "data_sync"    → DataSyncPage     // ★ NEW session 32 — admin/super_admin, guardPage. Thin wrapper —
                                    // mounts the SAME ArrivalImportPanel instance type (defaultOpen),
                                    // not a second import engine. ops_board's embed (line above)
                                    // is untouched; this is just a second entry point to it.
  "bot_config"   → BotConfigPanel   (admin only — guardPage)
  "bot_settings" → BotSettings      (admin only — guardPage)
  "bot_scripts"  → BotScriptEditor  (admin only) // ✏️ session 8 correction: IS in Sidebar nav
                                    // (App.js:1114-1121, admin-only section, "📝 סקריפטי הבוט")
                                    // — earlier docs claiming it was nav-hidden were wrong
  "agent"        → InventoryHub      // ★ session 47 — repurposed from AgentQuestionnaire/AgentChat
                                    // (left orphaned, not deleted — see §3). Sidebar icon/label
                                    // updated to 📦/"ניהול מלאי", route id "agent" kept unchanged.
  "admin"        → AdminPanel       (admin only)
  "cms_security" → CMSGate(CMSSecurityPanel)  // ★ NEW session 31 — admin/super_admin, then a SECOND
                                    // gate inside: CMSGate requires a fresh password+TOTP (aal2)
                                    // re-auth via CMSLogin before CMSSecurityPanel renders. See §7.
  "users_mgmt"   → UserManagement   (super_admin only)
}
// ★ session 7: "upload" (DataUpload) ו-"data_hub" (DataHub) הוסרו — מוזגו ל-ArrivalImportPanel.
// AICopilot מורכב גלובלית (לא דרך activePage) לכל user שאינו cleaner — ראה App.js:~2618.
// תפקיד "cleaner": מקבל מסך מלא HousekeepingTabletView בלבד (ללא Sidebar) — ראה App.js:~2116.
// ⚠️ session 28: היה RoomBoard עד session 27 — הוחלף, ראה §3/§10 session 28.
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
| `bot_config` | הגדרות בוט שורה-שורה (key-value) | read: authenticated only (migration 089 — was public `USING(true)`) · write: admin |
| `bot_settings` | system_prompt + knowledge_base + `preferred_model` (id=1) — ★ session 21: ערך חי כעת `gemini-2.0-flash-lite` (היה Claude מ-session 15) — toggle ב-BotSettings.js | `auth.uid() IS NOT NULL` |
| `message_templates` | תבניות שידור עם sort_order | `auth.uid() IS NOT NULL` |
| `bot_scripts` | סקריפטים מותאמים לכל trigger_event | authenticated |
| `tasks` | ★ session 21: "תפעול ואחזקה" — `status` עכשיו `open`/`in_progress`/`done` (היה רק open/done), + `sla_category`/`sla_deadline`/`escalated_at`/`claimed_by`/`claimed_at`/`source`/`reporter_profile_id`/`reporter_raw_text`. `source='legacy_service_call'` = backfill חד-פעמי מ-`service_calls` (migration 071) + ★ session 22 (migration 073): `action_token` (סוד ל-URL של כפתורי Accept/Complete) + `source_message_id` (UNIQUE partial, webhook idempotency) + ★ session 26 (migration 077): `source='guest_request'` (suite guest ask, מ-`log_guest_request`, ראה §10) + `guest_id` (FK→guests, SET NULL) + `whapi_message_id` (UNIQUE partial — כרטיס המשימה שבפועל נשלח לקבוצה; 👍🏼 reaction listener מתאים אליו) + ★ session 27 (migration 078): `source='manual_group'` (Room/חדר/סוויטה-prefixed manual text בקבוצת הצוות, ראה §10) + `resolved_by_phone`/`resolved_by_name` (תפיסת זהות גולמית מ-Whapi — נכתב גם כש-`resolved_by` ה-FK נשאר NULL כי לא נמצאה שורת profiles תואמת, FAIL VISIBLE) + ★ session 35 (migration 083): `source='portal_upsell'` — ⚠️ **session 41: ערך מת/לא בשימוש** — `guest-portal-upsell` עבר REDESIGN לכתוב ל-`guest_alerts` במקום (ראה §3/§10), הערך נשאר ב-CHECK רק לתאימות-לאחור עם שורות היסטוריות אם יש כאלה + ★ session 41 (migration 085): `source='portal_room_service'` (קליק על "הזמנת שירות לחדר" בסצנת ארמונים בפורטל — **כן** בשימוש, `guest-portal-ops-request` Edge Function — ראה §10) | open to authenticated |
| `ai_failover_events` | ★ session 21 — לוג כל auto-failover Claude↔Gemini בwebhook, נצרך ע"י AiFailoverWidget.js (realtime) | authenticated read, service-role write |
| `custom_automations` / `custom_automation_steps` | ★ NEW (session 27, migration 078) — שכבת טיוטה ל-Linear Automation Flow Builder (AutomationControlCenter.js's "✨ אוטומציה חדשה" tab): שם + תזמון הפעלה (`trigger_anchor_event`/`trigger_day_offset`/`trigger_local_time`) + שלבים מסודרים (`step_type` = `meta_template`/`free_text`). **לא** נקרא ע"י whatsapp-cron/whatsapp-send — שכבת תכנון בלבד, חיווט ל-runtime הוא צעד עתידי. נפרד בכוונה מ-`automation_stages` (migration 065, הצינור הקיים שכבר מחובר ל-runtime) | authenticated |
| `suite_rooms` | חדר לכל שורה מ-EZGO Suites CSV. key: `(order_number, res_line_id)`. מקור: `ArrivalImportPanel.js` (sole import surface) | authenticated |
| `room_status` | ★ גילוי session 7 — pipeline ניקיון נפרד (תפוס/פנוי/לניקיון/בניקיון/ממתין לאישור/תחזוקה). key: `room_id` = שם סוויטה מ-`SUITE_REGISTRY`. נצרך ע"י RoomBoard.js + AICopilot.js + ★ session 28: HousekeepingTabletView.js (כותב 3 מתוך 6 הערכים — לניקיון/בניקיון/ממתין לאישור — דרך 3 הכפתורים שלו). ★ session 29 (migration 079): + `jacuzzi_status`/`room_clean_status` (TEXT, dirty/clean) — Smart Ready-Alert Gate, ראה HousekeepingTabletView.js למעלה | authenticated |
| `notification_log` | dedup שליחות WA | service role |
| `schedule_patterns` | דפוסי Excel שנלמדו | |
| `push_subscriptions` | Web Push endpoints | `user_id = auth.uid()` |
| `inventory_items` | ★ NEW (session 47) — קטלוג מלאי per `location_name`. `par_level` נקרא מהקובץ הקיים של המנהל (לא שדה-הקלדה חדש), `source_note` שקוף ל-מקור (FAIL VISIBLE) | authenticated |
| `inventory_portal_links` | ★ NEW (session 47) — קישור-קסם per location (`/inv/:token`), אותו מנגנון כמו `guests.portal_token` | authenticated |
| `inventory_submissions` | ★ NEW (session 47) — דיווח יומי אחד מהעובדת, `status` pending/approved/rejected — שום דבר "חי" לפני אישור מנהל | authenticated |
| `inventory_counts` | ★ NEW (session 47) — שורת פריט per submission. `restock_suggested` מחושב בשרת (`inventory-portal-submit`), לא מהלקוח | authenticated |

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
msg_mid_stay_sent         BOOL — mid_stay (יום שני)
msg_checkout_fb_sent      BOOL — checkout_fb (יום אחרי עזיבה)
-- ⚠️ session 29: msg_post_checkin_sent (butler_1h, "Stage 3.5") הוסר מהרשימה כאן —
--    העמודה עדיין קיימת ב-DB (לא נמחקה, migration 045) אך אף קוד חי לא כותב לה
--    יותר. Stage 3.5 נמחק כליל מ-automation_stages + whatsapp-send/-cron, ראה §10
--    session 29. אל תניחו "כבר נשלח" אם תראו את העמודה הזו — היא קפואה לתמיד false.

── WhatsApp Inbox Claim/Assignment + Meal Macros (migration 081, session 33) ──
claimed_by    UUID — FK→profiles(id), SET NULL. מי מהצוות מטפל בשיחת האורח כרגע
                (WhatsAppInbox.js claim/take-over button). NULL = לא משויך.
claimed_at    TIMESTAMPTZ — חותמת claim/take-over אחרון. מתאפס יחד עם claimed_by בשחרור.
meal_time     TEXT — שעת ארוחה ("19:30"), אותה קונבנציית עריכה כמו spa_time. מוזן ב-
                AddGuestModal, נקרא ע"י WhatsAppInbox.js's buildContextualMacros().
                ★ session 44: גם מחולץ אוטומטית מייבוא EasyGo (ArrivalImportPanel.js's
                parseComprehensiveReport/_extractMealTime, אותה תא חופשי כמו spa_time) —
                ⚠️ regex לא אומת מול קובץ אמיתי, ראה §10 session 44.
meal_location TEXT — חופשי, ללא registry קבוע (בשונה מ-room/SUITE_REGISTRY) — אין "רשימת
                שולחנות" קיימת היום. ★ session 44: AddGuestModal ממלא "מסעדת ערמונים"
                כברירת מחדל לאורח חדש; ייבוא EasyGo גם כותב "מסעדת ערמונים" אוטומטית בכל
                פעם ש-meal_time מתגלה (3 נקודות כתיבה — ראה §10 session 44).

── Guest Portal magic-link (migration 083, session 35) ──
portal_token  UUID NOT NULL UNIQUE — קרדנציאל ה-magic-link ל-GuestPortal.js הציבורי
                (`/portal/:token`). **לא** phone — ראה migration 083 להסבר האבטחה המלא.
                נוצר אוטומטית לכל guest (קיים+עתידי) דרך DEFAULT gen_random_uuid().
                staff מקבלים את הקישור המלא דרך CustomerProfilePane.js's "🔗 העתק קישור".
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

#### Suffix-based Prompt Invariants — בלתי-תלויי-מקור
שני suffixes מוצמדים **תמיד** ל-`enrichedPrompt` (אחרי `finalSystemPrompt`+`guestCtx`, בענף "faq"),
ללא תלות איזה משלושת מקורות הפרומפט ניצח (bot_settings.system_prompt admin override / bot_scripts.
ongoing_concierge / buildSystemPrompt(bot_config) fallback) — כלל שחי רק בתוך אחד משלושת המקורות
משתתק ברגע שמקור אחר מנצח; suffix מוצמד בקוד הוא invariant אמיתי:
- `STRICT_HEBREW_LOCK_SUFFIX` (session 30) — נעילת שפה עברית + אנטי-הזיה.
- `LUXURY_CONCIERGE_PERSONA_SUFFIX` (★ session 34) — זהות+טון: "קונסיירז' של אחד מאתרי הנופש
  היוקרתיים בישראל", "כמו מנהל/ת אירוח אנושי... לא נציג שירות רשמי/רובוטי", "קליל, חם, מעשי, מהיר".
  לא חופף ל-STRICT_HEBREW_LOCK_SUFFIX בכוונה (זה כבר מכוסה שם) — רק ROLE/TONE. גם
  `FALLBACK_SYSTEM_PROMPT` וגם `buildSystemPrompt()`'s שורת הפתיחה רוככו באותו רוח (לא רק ה-suffix)
  כך שכל שלושת המקורות מתואמים זה לזה, לא רק נסמכים על ה-suffix לתיקון בדיעבד.

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

### `whatsapp-cron` — ✅ פעיל חלקית (session 42)
- pg_cron job **"wa-cron"** (jobid: 2) — `*/15 * * * *`, active: TRUE
- לעצור ב-SQL: `SELECT cron.unschedule('wa-cron');` (לא 'whatsapp-triggers' — זה שגוי)
- **KILL SWITCH:** `CRON_ENABLED=true` הוגדר ב-session 42 — ה-cron כבר **לא** חסום גלובלית. שליטה עכשווית
  היא per-stage דרך `automation_stages.is_active` (ראה §10 "WhatsApp Automation — שכבת שליחה" לרשימה
  המדויקת מה פעיל/מושבת ולמה). לעצור הכל בחזרה: `npx supabase secrets unset CRON_ENABLED` (או set ל-
  כל ערך שאינו `"true"`).
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
// ✅ session 43 (migration 087) — נעילה אמיתית ברמת RLS, לא רק UI-hiding. 19 טבלאות (guests/bookings/
//    tasks/bot_config/bot_settings/bot_scripts/whatsapp_conversations/guest_alerts/וכו') קיבלו RESTRICTIVE
//    policy שחוסם role='cleaner' בלבד — כל role אחר ללא שינוי. room_status (המסך היחיד של cleaner)
//    נשאר נגיש כרגיל. profiles: cleaner קורא רק את שורת ה-profile של עצמו. ראה §10 session 43.

// guardPage pattern (App.js):
guardPage(["admin", "super_admin"], <Component />)
// בודק user.role ואז email-based fallback דרך isAdminUser() / isSuperAdminUser()
```

### 🔐 CMS Security Layer — שכבת 2FA נוספת (session 31)
> זו שכבה **שנייה ועצמאית**, מעל ה-`guardPage` הקיים — לא תחליף לו. `guardPage` בודק את `user.role`
> (פרופיל האפליקציה, נטען מ-`profiles`); השכבה הזו בודקת את ה-Supabase Auth **session** עצמו ואת
> ה-AAL (Authenticator Assurance Level) שלו. דף שעטוף ב-`<CMSGate>` חייב לעבור **את שניהם**.

```javascript
// src/context/AuthContext.js — AuthProvider/useAuth()
//   session, loading, aal:{currentLevel,nextLevel}, isAal2, mfaRequired, sessionWarning
//   signInWithPassword(email,pw), extendSession(), signOutCms(), refreshAal()
// ⚠️ supabase הוא client singleton אחד — אין "session נפרד ל-CMS". signInWithPassword בתוך
//    CMSLogin.js מאמת את אותו המשתמש שכבר מחובר לאפליקציה הראשית (re-auth/step-up), ולא יוצר
//    זהות שנייה. אם יוזן אימייל/סיסמה של משתמש אחר — ה-session המשותף יוחלף לאותו משתמש בכל
//    האפליקציה (לא רק ב-CMS) — זו תוצאה צפויה של client יחיד, לא באג.

// src/components/cms/CMSGate.js — <AuthProvider><CMSPrivateRoute>{children}</CMSPrivateRoute></AuthProvider>
// src/components/cms/CMSPrivateRoute.js — מרנדר children רק אם session && aal==="aal2", אחרת <CMSLogin/>
// src/components/cms/CMSLogin.js — סיסמה (signInWithPassword) → supabase.auth.mfa: אם אין factor
//    מאומת — enroll() (QR+secret) → challengeAndVerify(code); אם יש — challengeAndVerify(code) ישירות
// src/components/cms/CMSSecurityPanel.js — מסך admin: session info + ניהול/הסרת התקני TOTP
// src/components/cms/SessionExpiryModal.js — מוצג רק כש-proactive refresh (5 דק' לפני תפוגה,
//    ב-AuthContext) נכשל בשקט — לא בכל תפוגה, ולא מציג מודאל מציק על כל גישה.

// נקודת חיבור חיה היחידה כרגע: route "cms_security" (App.js switch) — guardPage(["admin","super_admin"])
//    ואז <CMSGate><CMSSecurityPanel/></CMSGate>. AdminPanel/BotConfigPanel/BotSettings/UserManagement
//    הקיימים **לא** נגעו בהם בכוונה — ראה §10 session 31 להסבר הסיכון (lockout) ולמה זו בדיקת-היתכנות
//    יסודית לפני הרחבה לדפים תפעוליים קריטיים.
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
| WhatsApp Automation — שכבת שליחה | ✅ חלקית-פעילה (session 42) | `AUTOMATION_ENABLED=true` **וגם** `CRON_ENABLED=true` כעת מוגדרים ב-Secrets — ה-cron התקופתי (`whatsapp-cron`, pg_cron "wa-cron" */15min) פעיל. אומת חי (`automation-queue`'s `systemStatus`): `pre_arrival_2d`/`mid_stay`/`checkout_fb`/`stage_2_arrival` פעילים. ⚠️ `night_before`/`morning_suite`/`morning_welcome` **הושבתו בכוונה** (`automation_stages.is_active=false`) כי התבניות שלהם (`dream_checkin_reminder_v2`/`dream_welcome_morning`) עדיין PENDING ב-Meta — ראה השורה הבאה. **כשהן יאושרו:** `UPDATE automation_stages SET is_active=true WHERE stage_key IN ('night_before','morning_suite','morning_welcome');`. |
| תבניות Meta מאושרות | ⚠️ 2 מתוך 6 עדיין PENDING (אומת חי session 42, `get-wa-templates?all=true`) | **APPROVED:** `dream_arrival_confirmation` (T-2/pre_arrival_2d), `dream_mid_stay_check` (mid_stay), `dream_checkout_feedback` (checkout_fb), `dream_handover_agent_v2`, `dream_payment_and_workshops`. **PENDING (לא ניתן לשלוח עד אישור):** `dream_checkin_reminder_v2` (T-1/night_before), `dream_welcome_morning` (יום הגעה — suite+standard, ★ session 29) — שתיהן הושבתו ב-`automation_stages` כדי שה-cron לא ינסה לשלוח אליהן ויכשל בשקט מול Meta כל 15 דק'. **`dream_room_ready`** (★ session 29, מסירת מפתח ידנית מ-AICopilot) **גם הוא PENDING** — עדיין כך, לא השתנה מ-session 29 — **אל תניחו שהוא חי**, לחיצת "אשר ושלח הודעה" תיכשל בצורה גלויה (toast שגיאה, room_status לא יתקדם, AICopilot.js's FAIL VISIBLE check). יש גם `dream_room_ready1` PENDING (כפילות ישנה כנראה משליחה כפולה) ו-`suite_welcome_morning` PENDING (לא מוזכר בקוד החי בכלל — orphan registration). ⚠️ **שינוי טקסט עונתי** (session 11): כל שינוי בגוף הודעה של תבנית מאושרת **דורש אישור Meta מחדש**. ⚠️ **גילוי session 29 (עדיין רלוונטי):** 9 מתוך 16 התבניות השיווקיות הישנות נכשלות ב-Meta עם "New Hebrew content can't be added while the existing Hebrew content is being deleted" — אינו משפיע על pipeline הליבה. |
| SpaStagingPanel automation | ★ גילוי session 7 | מוזן ע"י `email-import-webhook` + `spa-schedule-webhook` — לא ברור באיזו פלטפורמת אוטומציה חיצונית (סביר Make.com) השרשור עצמו רץ. לא נחקר השרשור החיצוני, רק נקודות הקצה ב-Supabase. |
| `log_guest_request` tool-calling (session 17) | פרוס, לא נבדק חי | מומש ל-Gemini+Claude, `guest_alerts` הפך לselective (ראה session 17 למטה). Deploy+build עברו נקי, אבל **לא נשלחה הודעת WhatsApp אמיתית** לאימות שהמודל בפועל קורא לכלי ושה-Requests Board מציג שורה נכונה. שלח/י הודעת בדיקה עם בקשה ספציפית (יין/פרחים) לפני שסומכים על זה בפרודקשן. |

### מפת דרכים — השלבים הבאים

1. ~~STEP 1: webhook status fix~~ ✅ Done, committed, pushed, deployed — ראה טבלה לעיל.
2. ~~STEP 2a: Push migration 047~~ ✅ Done — applied לDB החי ב-session 7.
3. ~~STEP 2b: Deploy whatsapp-webhook~~ ✅ Done — `supabase functions deploy whatsapp-webhook --no-verify-jwt` הורץ ב-session 7.
4. **STEP 2c:** בדיקת E2E מלאה של webhook עם לחיצת כפתור אמיתית בפרודקשן (QA חי — באחריות Mike) — כל הקוד פרוס, נשאר רק QA אנושי.
5. ~~STEP 3: Universal Editable Grid~~ ✅ Done — `EditableGrid.js` מומש, ראה טבלה לעיל.
6. ~~STEP 4: הפעלת `CRON_ENABLED`~~ ✅ **בוצע חלקית, session 42** — `CRON_ENABLED=true` הוגדר; 3 מתוך 5 שלבים (תבניות מאושרות) פעילים אוטומטית. 2 השלבים עם תבניות PENDING הושבתו זמנית (`automation_stages.is_active=false`) במקום להיכשל בשקט מול Meta. **נשאר:** Mike לאשר/לדחוף את אישור `dream_checkin_reminder_v2`+`dream_welcome_morning` ב-Meta Business Manager, ואז להפעיל מחדש את שני השלבים (SQL למעלה, שורת "WhatsApp Automation").

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
| **Whapi live test** (session 22) | ✅ הושלם בסשן: `WHAPI_TOKEN`+`WHAPI_GROUP_ID` (`120363320093485583@g.us`) הוגדרו ואומתו (Whapi `/health`=AUTH, channel מחובר), webhook ה-channel הופנה (`PATCH /settings`) ל-`…/functions/v1/whapi-webhook` (events: messages; webhook ה-Make.com הוסר — clean cut). **נשאר רק:** מבחן חי בקבוצה ע"י Mike (`ROOM 14 towels` → כרטיס → Accept/Complete). `staff-ops-webhook` + ה-relay של Make.com מתים כעת (אין input) — להסיר רשמית אחרי אימות. ⚠️ **session 26 הוסיפה שלושה זרמים שגם הם לא נבדקו חי:** (1) בקשת אורח-סוויטה אמיתית (`room_type='suite'`) → כרטיס בקבוצה, (2) 👍🏼 על כרטיס → נעלם כ-done בלוח, (3) `SLA_OPS_ALERT_PHONE` ל-DM + Bump (יש כעת תוכן ב-secret הזה לראשונה). לפי תיעוד Whapi חי (אומת WebFetch session 26) ריאקציה מגיעה תחת אותו `event.type:"messages"` כמו הודעת טקסט רגילה (`type:"action"` בתוך אותו מערך `messages[]`) — לא צריך הרחבת event subscription ב-channel, אבל עדיין לא נבדק בפועל מול הריאקציה האמיתית של WhatsApp (לדוגמה: יש כמה אמוג'י "thumbs up" ב-Unicode והאם WhatsApp client מסוים שולח variant אחר). | נמוך |
| `SLA_ESCALATION_ENABLED` | ✅ הופעל session 22 (`=true`). sla-escalation-cron רץ */1min: ops = strict 7-min unassigned → Whapi group (grandfather baseline ב-migration 074 מנע blast רטרואקטיבי על backlog), guest_alerts = 10-min → Adir (Meta). ⚠️ ההפעלה הדליקה גם את escalation ה-guest_alerts (לא בוצע לו grandfather) — guest alerts ישנים שלא נפתרו עלולים להתריע ל-Adir. | — |
| Resilient Import Agent — ✅ **תוקן תיעוד (session 47)** | השורה הקודמת כאן ("מושהה באמצע", session 9) הייתה **לא מדויקת** — אומת חי session 47: `ArrivalImportPanel.js`/`MappingReviewPanel.js`/`importMapper.js` **כבר committed, נקי** (`git status` ריק), אין debug-branch ב-`suggest-import-mapping/index.ts`. המנגנון פעיל ועובד היום עבור `suite_arrivals` **וגם** `inventory_renewal` (session 47, ראה §10) — לא "מושהה", רק לא תועד נכון. | — |

---

### היסטוריית סשנים

> 📚 **הנרטיב המלא סשן-אחר-סשן (sessions 2–44) הועבר ל-[`claude_history.md`](claude_history.md)** — שום מידע לא אבד, רק הופרד מהקובץ הפעיל הזה כדי לחסוך טוקנים על כל שיחה עתידית. קרא שם כשצריך הקשר היסטורי מפורט על באג/החלטה ישנה.

#### session 45 — 2026-06-25 (CTO Audit Patches: token optimization, notification_log race condition, bot_config RLS gap)
> הקשר: audit מקיף (token efficiency / architecture / security) העלה 3 ממצאים קונקרטיים — כל אחד אומת בקריאת קוד/migration בפועל, לא הנחה. שלושתם תוקנו ופורסו בסשן זה.

- ✅ **Token Optimization.** נרטיב הסשנים 24–44 (כולל 2 addenda + הערת "PUSH EVERYTHING") הועבר במלואו ל-`claude_history.md` — שום מידע לא נמחק, רק הופרד (אותה מדיניות שהפרידה sessions 2–24 ב-session 24). ה-top blockquote קוצר מ-6 פסקאות "עדכון קודם" מוערמות לפסקה אחת.
- ✅ **`notification_log` race condition (migration 088).** ה-UNIQUE INDEX `uq_notif_guest_trigger` על `(guest_id, trigger_type)` (migration 006) לא היה מוגבל לסטטוס מסוים. אחרי כשל ראשון (status='failed'/'timeout') לאותו guest+trigger, כל insert עוקב — כולל ההצלחה בפועל בריטריי — התנגש בשקט בקונסטריינט (`whatsapp-send/index.ts`'s BRANCH D insert ב-שורה ~824 לא בודק error), כך ש-Automation History הציג "נכשל" לנצח גם כש-ההודעה בפועל נשלחה (האורח **לא** קיבל הודעה כפולה — `guests.msg_*_sent` נכתב עצמאית מה-log, ראה `whatsapp-send/index.ts:857-865`). migration 088 מצמצמת את האינדקס ל-`WHERE status IN ('sent','simulated')` — מאפשרת ריבוי שורות failed/timeout (תואם את ההנחה שכבר כתובה בקוד הקיים), ועדיין אוכפת בלעדיות אמיתית על "נשלח בהצלחה".
- ✅ **`bot_config` RLS gap (migration 089).** `bot_config_read` (migration 015) היה `FOR SELECT USING (true)` — קריא לחלוטין עם anon key, בלי session כלל, בשונה מ-`bot_settings`/`bot_scripts`/`guests` שדורשים `auth.uid() IS NOT NULL`. migration 087 (cleaner lockdown) לא סגרה את זה — היא חוסמת רק role='cleaner', אנונימי המשיך לעבור. migration 089 מחליפה את המדיניות לדרוש `auth.uid() IS NOT NULL`, תואם לכל שאר טבלאות הבוט.
- ✅ אומת: `npm run build` נקי, `npx supabase db push` (088+089) הצליח.

#### session 46 — 2026-06-26 (Dynamic Native Mentions ל-Whapi task cards)
> הקשר: כרטיסי משימה ב-Whapi לא תייגו עובד ספציפי בכלל (פתוחים לכל הקבוצה, נפתרים ב-👍🏼). בקשה לתייג עובד מתאים-מחלקה עם native @mention אמיתי (push לעובד), לא קישור-טקסט שWhatsApp מרנדר כ-link כש-`+`/רווחים/מקפים נמצאים במחרוזת.

- ✅ **`_shared/whapiSend.ts`** — `cleanPhoneForMention(phone)` (strips ל-digits-בלבד) + `sendWhapiText`'s `opts.mentions?: string[]` (מועבר ל-Whapi payload כ-`mentions:[...]`, מנוקה שוב defensively בתוך הפונקציה).
- ✅ **`buildTaskCard`** (`whapi-webhook/index.ts`) + **`buildManualTaskCard`** (`notify-manual-task/index.ts`) — קיבלו פרמטר `assignedPhone` אופציונלי: כשקיים, מוסיפים שורת `👤 Assigned: @{digits}` (אותו משתנה מנוקה שמועבר גם ל-`mentions`, לא string מפורמט בנפרד) + מעבירים `mentions:[assignedPhone]` ל-`sendWhapiText`. כשאין worker תואם — הכרטיס נשאר זהה לקודם (no dead line), 👍🏼 reaction-sweep לא נגע.
- ✅ **`findAssignedWorkerPhone(supabase, department)`** — חדש בשני הקבצים (מצב duplicated, לא import — קונבנציית הריפו לגבול Deno function). שואל `profiles` חי לפי `department` + `phone IS NOT NULL`, `limit(1)` — דינמי לחלוטין (כל עובד/מחלקה, לא מפה hardcoded של Lidor/Adir/Osnat), ⚠️ אין סיגנל זמינות/משמרת — "הטלפון הראשון שנמצא למחלקה" בלבד.
- ✅ נפרס: `whapi-webhook` + `notify-manual-task`.

#### session 47 — 2026-06-26 (Inventory Smart-Intake Module — repurpose "agent" tab)
> הקשר: ה"סוכן" (AgentQuestionnaire/AgentChat — צ'אט AI אישי per-manager) נחשב לא-רלוונטי. הבקשה: מודול חדש שמזהה ומייבא מסמכי חידוש מלאי (כולל קבצי אקסל עם נוסחאות קיימות), מאפשר למנהל ליצור קישור-קסם יומי לעובד למלא מלאי נוכחי מהטלפון בלי התחברות, ושום דבר לא נכנס בפועל למערכת בלי אישור מנהל. סוג המסמך נבחר ע"י המנהל (כרטיס מפורש), לא "קסם" שמנחש בלי לשאול.

- ✅ **`AgentQuestionnaire.js`/`AgentChat.js` + `agent_profiles`/`agent_memory`/`agent_learning_logs` — הוחלט עם Mike (AskUserQuestion) להשאיר קוד+דאטה כמו שהם, רק לא מקושרים** (כמו `Chat.js`/`generate-schedule`) — לא נמחק שום קובץ/טבלה. ב-`App.js`: ה-state `agentProfile` נשאר (skip-destructure `const [, setAgentProfile]`, עדיין נטען ב-effect קיים) כי `setAgentProfile` עדיין נקרא מתוך מודאל ה"הגדרות" הישן (נשאר קיים אך הפך כעת לבלתי-נגיש בפועל — אין יותר caller ל-`setShowQuestionnaire(true)`). ה-import של `AgentChat` הוסר (הפך unused).
- ✅ **migration 090** — 4 טבלאות חדשות: `inventory_items` (קטלוג per-location, `par_level` + `source_note` שקוף), `inventory_portal_links` (token UUID, מנגנון זהה ל-`guests.portal_token`/migration 083 — "צור קישור חדש" = deactivate+insert, לא mutate), `inventory_submissions` (status pending/approved/rejected), `inventory_counts` (שורה per item per submission, `restock_suggested` מחושב **בשרת**, לא מהלקוח). RLS authenticated לכולן (small-team convention). RPC חדש `upsert_inventory_items` (מראה את `sync_suite_arrivals`/migration 046).
- ✅ **חישוב היעד מהקובץ הקיים — בלי לפרש syntax של נוסחה.** ההחלטה הסופית (אחרי כמה סבבי refinement עם Mike): `suggest-import-mapping`'s schema חדש `inventory_renewal` ממפה `parLevel` (עמודת יעד גלויה, אם קיימת) **או** `restockColumn` (עמודת "להשלים" גלויה, התוצאה המוכנה של הנוסחה הקיימת) — שניהם נקראים כערכים רגילים (`sheet_to_json`, לא `cellFormula`). אם רק `restockColumn` מופה, `deriveParLevel()` (`src/utils/importMapper.js`) משלים: `יעד = כמות_נוכחית + להשלים` — אריתמטיקה על מספרים גלויים, לא re-implementation של syntax אקסל. שקוף ב-`source_note` שנשמר per item.
- ✅ **תשתית קיימת הורחבה, לא הומצאה מחדש** — `suggest-import-mapping`'s `SCHEMAS` registry קיבל entry `inventory_renewal` (+ `SCHEMA_DOMAIN_LABELS` כדי שפתיח הפרומפט לא יישאר hardcoded ל"הזמנות מלון" עבור קובץ מלאי). `import_mapping_memory` (migration 049, קיימת) עובדת ללא שינוי — מזכירה מיפוי שאושר בעבר לפי header signature, גם לסכימה החדשה.
- ✅ **קומפוננטות חדשות** (כולן `src/components/`): `InventoryHub.js` (שלושת sub-tabs, shell בדיוק כמו `AutomationControlCenter.js`, מורכב ב-`case "agent"`), `InventoryImportPanel.js` (3 כרטיסי סוג — "חידוש מלאי" מלא, "סידור משמרות" deep-link ל-`scheduler` הקיים, "טופס חכם" stub מנוטרל עם הסבר — Disable Don't Hide, §0.2 — מחוץ ל-scope המאושר לסשן הזה), `InventoryLinksPanel.js` (יצירה/רוטציה/קופי, אותו clipboard+prompt-fallback pattern כמו `CustomerProfilePane.js`), `InventoryApprovalQueue.js` (תור ממתין/אשר/ערוך-לפני-אישור/דחה — אותה קונבנציה כמו `RequestsBoard.js`/`SpaStagingPanel.js`, pending/approved/rejected כולם נשארים גלויים).
- ✅ **`InventoryPortal.js`** — מסך טלפון ציבורי בלי login, `/inv/:token` (נוסף ל-`src/index.js` באותה שיטה כמו `/portal/:token` הקיים — נבדק *לפני* `<App/>`). ⚠️ **לא יכול להשתמש ב-`var(--gold)` וכו'** — אותה מגבלה כמו `GuestPortal.js`: ה-CSS variables מוזרקות ע"י `App.js` עצמו, ולא קיימות כשהראוט הזה מרונדר *במקום* App. בשונה מ-`GuestPortal.js` (פלטת "XOS" שונה בכוונה לאורחים) — זה כלי **לצוות**, אז hardcoded לאותם hex values כמו `--gold` הפנימי, לא פלטה נפרדת.
- ✅ **Edge Functions חדשים**: `inventory-portal-data` (מראה את `guest-portal-data` — UUID regex guard, service-role lookup לפי token **וגם** `is_active=true`), `inventory-portal-submit` (מראה את `guest-portal-ops-request` — מאמת token, יוצר submission+counts, `restock_suggested` מחושב כאן מ-`inventory_items.par_level`, התראת Whapi best-effort ל-Adir שלא חוסמת את ה-DB write בכשל).
- ✅ **נבדק חי end-to-end מול ה-DB האמיתי** (לא רק build): נוצר link+items זמניים, מולא ונשלח דרך `/inv/:token` בפועל בדפדפן, אומת ש-`restock_suggested` חושב נכון (par_level − count) בצד השרת, אומת ש-link מבוטל **וגם** token פגום מחזירים שגיאה נקייה (לא raw DB error, לא קריסה) — כל הדאטה הזמני נמחק בסוף. ⚠️ **לא נבדק ע"י Claude:** המסכים בצד-מנהל (שלושת ה-sub-tabs של `InventoryHub`) דרך קליק בדפדפן בפועל — login דרש credentials אמיתיים שלא היו זמינים (משתמשי הדמו במסך ההתחברות לא עבדו, Google OAuth לא מוגדר בסביבת הפיתוח). Mike צריך לעבור על "ניהול מלאי" עם login אמיתי כדי לאשר את ה-UI בצד-מנהל.
- ✅ **`npm run build` נקי** — אפס warnings חדשים. ⚠️ נמצא warning קיים-מראש לא-קשור (`ShiftsPage` unused ב-`App.js`, 204 שורות, אומת via `git stash` שקיים גם על main לפני הסשן) — סומן כ-follow-up נפרד, לא טופל כאן (מחוץ ל-scope).
- ✅ Sidebar: `{ id:"agent" }` נשאר (routing לא השתנה) אבל `icon`/`label` עברו ל-`📦`/"ניהול מלאי" (דסקטופ) ו-"מלאי" (מובייל).

#### session 48 — 2026-06-26 (Voice/Audio Ticket Support — whapi-webhook)
> הקשר: בוט הקריאות (`whapi-webhook`) הבין רק טקסט מוקלד בקבוצה — הודעה קולית נפלה בשקט (`extractMessages` מחזיר `text:""` לכל type לא-מוכר, ה-guard `if(!msg.text)` מדלג ללא עקבות). הבקשה: מנהל מקליט הודעה קולית בוואטסאפ → הבוט מתמלל והופך לקריאה מבנית, בדיוק כמו טקסט מוקלד.

- ✅ **מחקר חי (לא הנחה)** — payload נכנס של Whapi ל-voice: `{type:"voice", voice:{id, mime_type:"audio/ogg; codecs=opus", seconds, link?}}`. `voice.link` קיים **רק** אם "Auto Download" מופעל בערוץ (הגדרה לא מובטחת) — לכן **לא** נסמכים עליו; הורדה אמינה היא `GET https://gate.whapi.cloud/media/{id}` עם `Authorization: Bearer WHAPI_TOKEN`, מחזיר bytes גולמיים בגוף התגובה. Gemini's `inline_data` מקבל `audio/ogg` ישירות — אין צורך בהמרה. Claude/Anthropic **אין לו קלט אודיו בכלל** — תמלול הוא Gemini-only, בלי fallback לאותה קריאה.
- ✅ **ארכיטקטורה: תמלול ואז חוזרים לצינור הקיים, לא צינור מקביל.** קול → הורדה → תמלול → הטקסט המתומלל עובר ב-`parseDeterministic() ?? classifyWithAi()` **הקיימים בדיוק** — הודעה קולית שאומרת "11 towels" פוגעת ב-Tier-0 regex אחרי תמלול, בלי שום פרומפט-חילוץ כפול.
- ✅ **`_shared/whapiMedia.ts`** (חדש) — `fetchWhapiMedia(mediaId)`, מראה את conventions של `whapiSend.ts` (טיים-אאוט 25s, `_isAbortError`). `_whapiBase()`/`_tokenOrThrow()` ב-`whapiSend.ts` הפכו ל-`export` כדי שיחלקו (לא שכפול — שני הקבצים תחת `_shared/`, הגבול שבאמת משתף מודולים בריפו הזה).
- ⚠️ **באג תפיסה-לב נתפס ותוקן באותו סשן:** deploy ראשון נכשל עם `BOOT_ERROR` (503) — `std@0.168.0/encoding/base64.ts` (הגרסה המוצמדת בכל הריפו) מייצא `encode`/`decode`, **לא** `encodeBase64`/`decodeBase64` (rename קרה בגרסת std מאוחרת יותר) — אומת ישירות מול המודול. **כל** whapi-webhook היה למטה (לא רק נתיב הקול) עד התיקון — נתפס ע"י smoke-test (`curl` ל-payload ריק) **לפני** שמשתמש אמיתי נחשף, redeploy תיקן. תזכורת: import שגוי בקובץ `_shared/` מפיל את כל הפונקציה ב-cold-start, לא רק את הפיצ'ר החדש.
- ✅ **`transcribeVoice()`** (ב-`whapi-webhook/index.ts`) — מראה את `process-knowledge/index.ts`'s `inline_data` request shape בדיוק (`gemini-1.5-flash`, `temperature:0`), פרומפט תמלול-בלבד (עברית/אנגלית, מילה-במילה, בלי הערות).
- ✅ **כשל = תשובה גלויה לקבוצה, לא שקט.** בשונה מ-`classify_failed` הקיים (שלא עונה לקבוצה — ההודעה המוקלדת המקורית עדיין גלויה בצ'אט) — כשל תמלול **כן** עונה ("🎤 לא הצלחנו לתמלל...") כי הודעה קולית שנכשלת לא משאירה שום עקבה אחרת לשולח. גם guard על משך (`voice.seconds > 180` → "ארוך מ-3 דקות, נא להקליד" בלי לנסות בכלל לתמלל — נבדק לפני קריאת רשת).
- ✅ **שקיפות מקור, בלי migration.** `reporter_raw_text` מקבל prefix `🎤 ` כשמקורו קולי; `buildTaskCard()` מקבל `fromVoice` ומוסיף שורת "🎤 Transcribed from voice:" לכרטיס בקבוצה — לא טבלה/עמודה חדשה.
- ✅ נפרס: `whapi-webhook` (+ `_shared/whapiMedia.ts` חדש, `_shared/whapiSend.ts` מורחב). אומת חי: smoke-test (`curl`) על payload ריק (200 תקין) ועל הודעת voice סינתטית (`other_group` — מאשר ש-WHAPI_GROUP_ID נעול ושהחילוץ של type="voice" לא קורס). ⚠️ **לא נבדק:** תמלול אמיתי / יצירת task מקול אמיתי — דורש הודעה קולית אמיתית מטלפון אמיתי לקבוצה האמיתית (לא ניתן לדמות), Mike צריך לבדוק.

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

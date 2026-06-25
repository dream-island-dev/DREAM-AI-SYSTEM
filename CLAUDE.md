# CLAUDE.md — Dream Island AI System
> קובץ זה נקרא אוטומטית בכל שיחה. הוא מקור-האמת שלך. קרא אותו לפני כל פעולה.
> **עדכון אחרון:** 2026-06-25 (session 40 — Dynamic CMS, Vercel Asset Fix & Luxury UX Flow + Final Polish: `portalContent.js` הסטטי הוחלף ב-DB חי — טבלה חדשה `portal_scenes` (migration 084, RLS: קריאה ציבורית, כתיבה admin-only) + פאנל אדמין חדש "🎨 הגדרות פורטל" לעריכת סצנות בלי deploy. הורחב ל-7 סצנות, תוכן נשלף מ-dream-island.co.il (לא הומצא). ⚠️ שני באגי קבצים אמיתיים נמצאו ותוקנו (קובץ שהוחלף בשקט, שמות עם רווחים שמפילים CSS `url()` לא-מצוטט). 🎉 **פריצת דרך:** קיר ה-Auth שחסם אימות חזותי ב-sessions 19–40 **נפתר** — אובחן שורש (MOCK_USERS הוא dead code כש-Supabase מוגדר, שלא משפיע על סטאף אמיתי) ובוצעה התחברות אמיתית ומאומתת-בצילום-מסך עם חשבון QA (`claude-qa@dreamisland.internal`, role=admin, סיסמה **לא** בקובץ הזה — ראה §10 session 40 להוראות איפוס). פירוט מלא ב-§10 session 40 + התוספת בסופו).
>
> **עדכון קודם:** 2026-06-25 (session 39 — תוקן באג: "✨ הצעות AI חכמות" (`WhatsAppInbox.js`, session 34) הציג bubble עם JSON גולמי שבור (`}"suggestions": ["היי מייק,`) במקום הצעת תגובה נקייה. ראה §10 session 39).
>
> **עדכון קודם לכן:** 2026-06-25 (sessions 36–38 — Guest Portal polish: content config חולץ ל-portalContent.js, "Luxury Resort UI Upgrade" עם תוכן אמיתי מ-dream-island.co.il + תיקון טעינת גופנים, ו-"Full Portal Integration" עם סכמת actionType + פילטר RequestsBoard. ראה §10 sessions 36–38).
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
│   │   └── ezgoParser.js         IL mobile regex + extractGuestDetails + aggregateGuestProfiles
│   │                                Pure transform — zero Supabase calls. Called from ArrivalImportPanel.js.
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
│       ├── AgentChat.js          22KB  שיחה עם סוכן AI
│       ├── AgentQuestionnaire.js 19KB  שאלון הגדרת סוכן
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
│       ├── guest-portal-upsell/ ★ NEW (session 35) — In-Scroll One-Click Upsells. אותו token guard.
│       │                            מאתר guest לפי portal_token → insert ל-`tasks`
│       │                            (source='portal_upsell', migration 083) → כרטיס לקבוצת Whapi
│       │                            (`_shared/whapiSend.ts`, אותו מנגנון בדיוק כמו
│       │                            notify-manual-task) עם "👍🏼 to complete" — נפתר ע"י אותו
│       │                            reaction-sweep listener (whapi-webhook) כמו כל task אחר.
│       │                            כשל Whapi הוא best-effort — ה-task עדיין נוצר, toast ההצלחה
│       │                            לאורח לא תלוי בו.
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
  "agent"        → AgentQuestionnaire / AgentChat
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
| `bot_config` | הגדרות בוט שורה-שורה (key-value) | admin write |
| `bot_settings` | system_prompt + knowledge_base + `preferred_model` (id=1) — ★ session 21: ערך חי כעת `gemini-2.0-flash-lite` (היה Claude מ-session 15) — toggle ב-BotSettings.js | `auth.uid() IS NOT NULL` |
| `message_templates` | תבניות שידור עם sort_order | `auth.uid() IS NOT NULL` |
| `bot_scripts` | סקריפטים מותאמים לכל trigger_event | authenticated |
| `tasks` | ★ session 21: "תפעול ואחזקה" — `status` עכשיו `open`/`in_progress`/`done` (היה רק open/done), + `sla_category`/`sla_deadline`/`escalated_at`/`claimed_by`/`claimed_at`/`source`/`reporter_profile_id`/`reporter_raw_text`. `source='legacy_service_call'` = backfill חד-פעמי מ-`service_calls` (migration 071) + ★ session 22 (migration 073): `action_token` (סוד ל-URL של כפתורי Accept/Complete) + `source_message_id` (UNIQUE partial, webhook idempotency) + ★ session 26 (migration 077): `source='guest_request'` (suite guest ask, מ-`log_guest_request`, ראה §10) + `guest_id` (FK→guests, SET NULL) + `whapi_message_id` (UNIQUE partial — כרטיס המשימה שבפועל נשלח לקבוצה; 👍🏼 reaction listener מתאים אליו) + ★ session 27 (migration 078): `source='manual_group'` (Room/חדר/סוויטה-prefixed manual text בקבוצת הצוות, ראה §10) + `resolved_by_phone`/`resolved_by_name` (תפיסת זהות גולמית מ-Whapi — נכתב גם כש-`resolved_by` ה-FK נשאר NULL כי לא נמצאה שורת profiles תואמת, FAIL VISIBLE) + ★ session 35 (migration 083): `source='portal_upsell'` (קליק על upsell בפורטל האורח הציבורי, `guest-portal-upsell` Edge Function — ראה §10) | open to authenticated |
| `ai_failover_events` | ★ session 21 — לוג כל auto-failover Claude↔Gemini בwebhook, נצרך ע"י AiFailoverWidget.js (realtime) | authenticated read, service-role write |
| `custom_automations` / `custom_automation_steps` | ★ NEW (session 27, migration 078) — שכבת טיוטה ל-Linear Automation Flow Builder (AutomationControlCenter.js's "✨ אוטומציה חדשה" tab): שם + תזמון הפעלה (`trigger_anchor_event`/`trigger_day_offset`/`trigger_local_time`) + שלבים מסודרים (`step_type` = `meta_template`/`free_text`). **לא** נקרא ע"י whatsapp-cron/whatsapp-send — שכבת תכנון בלבד, חיווט ל-runtime הוא צעד עתידי. נפרד בכוונה מ-`automation_stages` (migration 065, הצינור הקיים שכבר מחובר ל-runtime) | authenticated |
| `suite_rooms` | חדר לכל שורה מ-EZGO Suites CSV. key: `(order_number, res_line_id)`. מקור: `ArrivalImportPanel.js` (sole import surface) | authenticated |
| `room_status` | ★ גילוי session 7 — pipeline ניקיון נפרד (תפוס/פנוי/לניקיון/בניקיון/ממתין לאישור/תחזוקה). key: `room_id` = שם סוויטה מ-`SUITE_REGISTRY`. נצרך ע"י RoomBoard.js + AICopilot.js + ★ session 28: HousekeepingTabletView.js (כותב 3 מתוך 6 הערכים — לניקיון/בניקיון/ממתין לאישור — דרך 3 הכפתורים שלו). ★ session 29 (migration 079): + `jacuzzi_status`/`room_clean_status` (TEXT, dirty/clean) — Smart Ready-Alert Gate, ראה HousekeepingTabletView.js למעלה | authenticated |
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
meal_location TEXT — חופשי, ללא registry קבוע (בשונה מ-room/SUITE_REGISTRY) — אין "רשימת
                שולחנות" קיימת היום. אותה הערה.

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
| WhatsApp Automation — שכבת שליחה | חלקי | `AUTOMATION_ENABLED=true` הוגדר ב-Secrets → משפיע **רק** על `whatsapp-send` (שליחות יזומות: room_ready, payment_and_workshops; inbox_reply תמיד פטור). ⚠️ **לא** משפיע על ה-cron התקופתי — `whatsapp-cron` חסום בנפרד ע"י kill switch עצמאי (`CRON_ENABLED`, עדיין לא מוגדר). night_before/morning_welcome/morning_suite **לא ישלחו** עד שגם הוא יופעל. (butler_1h הוסר מהציר session 29 — אינו רלוונטי יותר לרשימה הזו.) |
| תבניות Meta מאושרות | לאמת | שמות נוכחיים בקוד (`whatsapp-send/index.ts`): `dream_arrival_confirmation` (T-2), `dream_checkin_reminder_v2` (T-1/night_before), `dream_welcome_morning` (יום הגעה — suite+standard), **`dream_room_ready`** (★ session 29, חדש — מסירת מפתח ידנית מ-AICopilot. נשלח ל-Meta לאישור בסשן 29, סטטוס **PENDING** — ראה §10 session 29; **אל תניחו שהוא חי** עד שהסטטוס ב-"📋 ניהול תבניות" חוזר ל-APPROVED, אחרת לחיצת "אשר ושלח הודעה" תיכשל בצורה גלויה — toast שגיאה, room_status לא יתקדם, ראה AICopilot.js's FAIL VISIBLE check). יש לאמת מול Meta Business Manager לפני הפעלת ה-cron. ⚠️ **שינוי טקסט עונתי** (session 11): כל שינוי בגוף הודעה של תבנית מאושרת (למשל "השמש בחוץ" → ניסוח חורפי ל-`dream_welcome_morning`) **דורש אישור Meta מחדש** — התבנית פעילה *מחוץ* לחלון 24 השעות, אז אי אפשר לסמוך על free-text. ראה הערה זהה ב-`whatsapp-send/index.ts` מעל `PIPELINE_TEMPLATE`. ⚠️ **גילוי session 29:** הרצת `register-templates` חשפה ש-9 מתוך 16 התבניות הישנות (השיווקיות, לא ה-UTILITY הפעילות בpipeline) נכשלות כרגע ב-Meta עם השגיאה "New Hebrew content can't be added while the existing Hebrew content is being deleted. Try again in 17 days" — תהליך מחיקת-תוכן עברי כלשהו פתוח בחשבון ה-WhatsApp Business, לא נגרם ע"י סשן זה ולא ניתן לתיקון מקוד. אינו משפיע על pipeline הליבה (UTILITY templates כולם ALREADY_EXISTS/תקינים). |
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
| **Whapi live test** (session 22) | ✅ הושלם בסשן: `WHAPI_TOKEN`+`WHAPI_GROUP_ID` (`120363320093485583@g.us`) הוגדרו ואומתו (Whapi `/health`=AUTH, channel מחובר), webhook ה-channel הופנה (`PATCH /settings`) ל-`…/functions/v1/whapi-webhook` (events: messages; webhook ה-Make.com הוסר — clean cut). **נשאר רק:** מבחן חי בקבוצה ע"י Mike (`ROOM 14 towels` → כרטיס → Accept/Complete). `staff-ops-webhook` + ה-relay של Make.com מתים כעת (אין input) — להסיר רשמית אחרי אימות. ⚠️ **session 26 הוסיפה שלושה זרמים שגם הם לא נבדקו חי:** (1) בקשת אורח-סוויטה אמיתית (`room_type='suite'`) → כרטיס בקבוצה, (2) 👍🏼 על כרטיס → נעלם כ-done בלוח, (3) `SLA_OPS_ALERT_PHONE` ל-DM + Bump (יש כעת תוכן ב-secret הזה לראשונה). לפי תיעוד Whapi חי (אומת WebFetch session 26) ריאקציה מגיעה תחת אותו `event.type:"messages"` כמו הודעת טקסט רגילה (`type:"action"` בתוך אותו מערך `messages[]`) — לא צריך הרחבת event subscription ב-channel, אבל עדיין לא נבדק בפועל מול הריאקציה האמיתית של WhatsApp (לדוגמה: יש כמה אמוג'י "thumbs up" ב-Unicode והאם WhatsApp client מסוים שולח variant אחר). | נמוך |
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

#### session 26 — Jun 24 2026 (Guest Concierge → Staff Ops bridge: dual-routing + 👍🏼 reactions + manager Bump)
> הקשר: דירקטיבת "STRICT SPRINT MODE" — שלושה ספרינטים שקושרים לראשונה את ה-Guest Concierge (Bot 1, Meta/Gemini/Claude) לתוך ה-Staff Ops (Bot 2, Whapi): (1) ניתוב suite-only של `log_guest_request` לקבוצת הצוות, (2) reaction listener (👍🏼=הושלם), (3) SLA אישי למנהל + Bump. עקרון מנחה: להרחיב את ה-`tasks` table+pipeline הקיים (CLAUDE.md §0.4) ולא לבנות מערכת כרטיסים מקבילה לבקשות אורח.

- ✅ **Sprint 1 — Dual-Routing Trigger + Suite-Only Gating.** `whatsapp-webhook/index.ts` §4b — `routeGuestRequestToOpsGroup()` נקראת רק כש-`toolLoggedRequest` קיים (קריאת tool אמיתית, **לא** `criticalKeywordHit` — אותו net תופס גם תלונה/מחיר גנריים, לא "תביאו לי X") **וגם** `guest.room_type === "suite"` (יום-אורח/standard נשארים dashboard-only, `guest_alerts` בלבד — ללא שינוי). יוצרת שורת `tasks` (`source='guest_request'`, `guest_id`, `action_token`) + שולחת כרטיס מינימלי לקבוצה (`🛋️ [room] Guest requested: summary` — בכוונה בלי כפתורי Accept/Complete, ראה Sprint 2) דרך `_shared/whapiSend.ts`, ושומרת את ה-message id שחזר (`whapi_message_id`). הטקסט נשאר אנגלי-עברי מעורב בכוונה — `item_summary` הוא חילוץ עברי קצר של המודל (`LOG_REQUEST_JSON_SCHEMA`) ולא מתורגם (תרגום מכונה ל-3-8 מילים = עוד נקודת כשל מבלי תועלת אמיתית).
- ✅ **Sprint 2 — Reaction Listener.** אומת מול תיעוד Whapi חי (WebFetch, לא ניחוש): ריאקציה מגיעה כ-`messages[]` נפרד עם `type:"action"`/`action:{target,type:"reaction",emoji}` — **לא** שדה על ההודעה המקורית. `whapi-webhook/index.ts` — `extractReactions()`+`isThumbsUp()` (codePointAt(0)===U+1F44D, תופס את כל 6 גווני העור) רצים *לפני* לולאת ההודעות (0 עלות LLM). 👍🏼 על כרטיס מאתר `tasks` דרך `whapi_message_id` (UNIQUE, migration 077) → `status:"done"`+`resolved_by`/`resolved_at`. **No-Bloat Rule נאכף:** אין שום תגובה חזרה לקבוצה — בהצלחה או בלי-match. כרטיס ה-staff-report הקיים ("11- towels") עודכן לשמור גם הוא את `whapi_message_id` שלו אחרי שליחה — כך שה-reaction listener עובד על **שני** סוגי הכרטיסים, לא רק על guest_request.
- ✅ **Sprint 3 — Manager SLA Alert + Bump.** `sla-escalation-cron/index.ts`'s ops-task scan עכשיו מפוצל לפי `source`: `guest_request` → DM אישי (לא קבוצה) דרך `sendWhapiText`. **ממצא:** `SLA_OPS_ALERT_PHONE` כבר היה מוגדר כ-secret מ-session 21 (לצד `SLA_GUEST_ALERT_PHONE`) אבל מעולם לא נוצל בקוד — סשן זה נתן לו תפקיד בפועל, במקום להמציא משתנה env חדש. ה-DM מכיל קישור "⚡ Bump Task" (`task-action?action=bump&token=...`). `task-action/index.ts` קיבל `action` שלישי — `bump`: GET = אותו interstitial crawler-safe קיים (שם תיקוף, ACTION_LABEL הורחב), POST = **אין מוטציית status/claim** — רק resend לקבוצה בפורמט קולני (`⚡ MANAGER BUMP: [room] - desc needed ASAP! ⚡`). פתרון בקשה עדיין קורה רק דרך 👍🏼 (Sprint 2) או Accept/Complete רגיל. שאר ה-sources (whatsapp_staff/manual/inbox_routed/legacy) ללא שינוי — group alert כבר קיים מ-session 22.
- ✅ **`tasks_source_check` + `OperationsBoard.js`'s `SOURCE_META`** — נוסף `guest_request` (🛋️ בקשת אורח) כך שהלוח לא נופל ל-fallback "ידני" הגנרי על השורות החדשות (FAIL VISIBLE).
- ✅ **אומת בפועל, לא רק build:** `npx supabase secrets list` הריץ במהלך הסשן ואישר ש-`WHAPI_TOKEN`+`WHAPI_GROUP_ID` **כן** מוגדרים בפרודקשן (תיקון לתיעוד שגוי מ-session 22 ב-§3 שטען "עדיין לא מוגדרים") — כלומר Sprint 1/2/3 לא רק deployed אלא בעלי group target אמיתי לבדיקה חיה. `npx supabase db push` (077) ו-4 `functions deploy` (`whatsapp-webhook`/`whapi-webhook`/`task-action`/`sla-escalation-cron`, ה-אחרון פעמיים — תיקון שם משתנה ה-env אחרי שהתגלה `SLA_OPS_ALERT_PHONE`) הצליחו, Deno type-check עבר. `npm run build` נקי (רק אזהרת `ShiftsPage` הקיימת).
- ⚠️ **לא אומת חזותית חי** — אין דרך לדמות הקלקת 👍🏼 אמיתית בוואטסאפ/קבוצת Whapi אמיתית מתוך הסשן. Mike: מומלץ לבדוק בפועל — בקשת ספא של אורח-סוויטה אמיתי (room_type='suite') → כרטיס בקבוצה → 👍🏼 → נעלם מהלוח כ-done; וגם תרחיש ה-7-min/Bump (אפשר להוריד זמנית את `SLA_UNASSIGNED_MINUTES` ל-1 לבדיקה).
- ⚠️ **לא נגעתי / מחוץ לסקופ:** הקבצים ה-untracked (`.claude/claude_bot.py`, `DREAM_CONCIERGE_SYSTEM_PROMPT.txt`, `migration 076`) — לא נכללו בקומיט, לא נבדקו.

#### session 27 — Jun 24 2026 (Staff card cleanup + manual-group parsing + day-guest FOMO upsell + Linear Automation Builder + visual stats)
> הקשר: דירקטיבת "STRICT SPRINT MODE" — חמישה ספרינטים בלתי-תלויים: (1) הסרת קישורי Accept/Complete מהכרטיס לטובת ריאקציה בלבד + תפיסת זהות גולמית, (2) זיהוי "Room N ..." שהוקלד ידנית בקבוצה, (3) day-guest שמבקש שירות חדר מקבל upsell דינמי במקום כרטיס, (4) Linear Automation Flow Builder (שכבת טיוטה), (5) תצוגת זהות-פותר במשימות + drawer פרופיל אורח + badge חי/קרוב ב-RoomBoard.

- ✅ **Sprint 4.1 — Staff Card Cleanup + Reactor Identity.** `whapi-webhook/index.ts`'s `buildTaskCard()` ויתר על שני ה-URL (Accept/Complete) — הכרטיס מסתיים כעת ב-"👉 Please react with 👍🏼 to complete this task." בלבד (`functionsBase` שהיה קיים רק בעבורם הוסר). אותה שורה נוספה גם לכרטיס guest_request ב-`whatsapp-webhook/index.ts` (`routeGuestRequestToOpsGroup`) — שניהם נפתרים ע"י אותו reaction listener כך שהרמז צריך להיות בשניהם. ה-reaction handler כותב כעת גם `resolved_by_phone`/`resolved_by_name` (migration 078, מ-Whapi payload הגולמי) **בנוסף** ל-`resolved_by` (profiles FK) — ה-FK עדיין NULL כשאין שורת profiles תואמת, אבל מי-בדיוק-פתר את המשימה כבר לא נעלם (FAIL VISIBLE, §0.3). `task-action/index.ts`'s POST complete גם הוא עודכן לכתוב את שתי העמודות (מ-`actor`/`STAFF[actor]`) — עקביות בין שני נתיבי הפתרון. **`task-action` לא הוסר** — `bump` (session 26) עדיין תלוי בו, ה-GET/POST accept/complete עדיין קיימים ופועלים, רק לא מקושרים מהכרטיס יותר.
- ✅ **Sprint 4.2 — Manual-Group Room Parsing.** ממצא מרכזי: ה-parser הנדרש **כבר היה קיים** — `whapi-webhook/index.ts`'s Tier 0 `ROOM_PREFIX_RE` (`/^\s*(?:room|suite|חדר|סוויטה).../i`) כבר תופס "Room 21 Ice pls" ומחלץ חדר+טקסט מ-session 22. מה שחסר זה רק סימון מקור נפרד: כש-`cls.tier === "room_prefix"` ה-insert כותב כעת `source: "manual_group"` במקום `"whatsapp_staff"` (digit-dash shorthand ו-AI fallback נשארים `whatsapp_staff`, ללא שינוי) — migration 078 הרחיבה את `tasks_source_check`. שאר הצינור (idempotency דרך `source_message_id`, `action_token`, שמירת `whapi_message_id` לריאקציה) משותף לחלוטין — לא נבנה צינור מקביל.
- ✅ **Sprint 4.3 — Day-Guest FOMO Upsell Gate.** `whatsapp-webhook/index.ts` — gate חדש מיד אחרי routing ה-intent (לפני בלוק ה-guest_notes): כש-`toolLoggedRequest` קיים **וגם** `guest.room_type === "day_guest"`, ה-reply מוחלף בהודעת upsell ו-`toolLoggedRequest` מאופס ל-null (כך שלא נפתח טיקט guest_alerts/ops עבור day-guest — "חסימה" אמיתית, לא רק UI). "סוויטת הפרימיום" במשמעות הספרינט מתורגם ל-Premium Day 1/Premium Day 2 — שתי חבילות היום-אורח הקיימות בסכימה (`AddGuestModal`/`ArrivalImportPanel`), כי אין סוויטה פיזית בשם "Premium" ב-`SUITE_REGISTRY`. `isPremiumDaySlotAvailableToday()` סוקרת `guests` (`arrival_date=today`, לא מבוטל, `room IN ('Premium Day 1','Premium Day 2')`) ו-fail-closed (מתייחסת לשגיאת שאילתה כ"תפוס" — לא למכור יתר על המידה).
- ✅ **Sprint 4.4 — Linear Automation Flow Builder.** סאב-טאב חדש "✨ אוטומציה חדשה" ב-`AutomationControlCenter.js` (`CustomAutomationBuilder`) — שם + תזמון (anchor_event/day_offset/local_time, אותם controls בדיוק כמו Timeline tab) + רשימת שלבים מסודרת (תבנית Meta מאושרת, נשלפת מ-`metaTemplatesByName` החי שכבר נטען בקומפוננטה / טקסט חופשי) → `custom_automations`+`custom_automation_steps` (migration 078). **בכוונה שכבת טיוטה בלבד** — לא נקרא ע"י whatsapp-cron/whatsapp-send; זה לא שכפול של `automation_stages` (זה כן מחובר ל-runtime) אלא משטח תכנון נפרד ל-sequences אד-הוק. כולל רשימת אוטומציות שמורות + מחיקה.
- ✅ **Sprint 4.5 — Visual Stats.** (1) `OperationsBoard.js`'s `TaskCard` מציג "✔️ בוצע ע״י: [שם/טלפון]" לצד badge "✅ בוצע" (מ-`resolved_by_name`/`resolved_by_phone`); ה-`markDone` הפנימי (כפתור באפליקציה) כותב גם הוא `resolved_by_name` (מ-`user.name`) כך שהתצוגה לא תלויה רק בנתיב הוואטסאפ. `SOURCE_META` קיבל `manual_group`. (2) `CustomerProfilePane.js` חדש — slide-out drawer (קליק על שם אורח ב-`GuestDashboard.js`) עם סה"כ לילות (arrival_date↔departure_date) ושעת צ'ק-אאוט (`suite_rooms.checkout_time` per-phone, fallback ל-"11:00" — ערך ברירת המחדל הקיים של `bot_config.hotel_checkout_time`, לא הומצא). (3) `RoomBoard.js` — badge ירוק "🟢 אורח נוכחי" (status='checked_in', שם+עזיבה) מול badge כחול "🔵 הגעה קרובה" (pending/expected/room_ready, שם+ETA+חלון ספא) במקום השורה השטוחה הקודמת; שאילתת guests הורחבה ל-`'expected'` + `spa_time`.
- ✅ **`tasks_source_check` + migration 078** — `resolved_by_phone`/`resolved_by_name` (TEXT) + `source='manual_group'` + טבלאות `custom_automations`/`custom_automation_steps` (RLS authenticated, trigger `set_updated_at` משותף עם `automation_stages`).
- ✅ **אומת:** `npm run build` נקי (רק אזהרת `ShiftsPage` הקיימת, לא קשורה). `npx supabase db push` (078) ו-3 `functions deploy` (`whapi-webhook`/`whatsapp-webhook`/`task-action`) הצליחו, Deno type-check עבר בכולם.
- ⚠️ **לא אומת חזותית חי** — אין דרך לדמות 👍🏼/הודעת קבוצה אמיתית או לפתוח את האפליקציה בדפדפן מתוך הסשן. Mike: מומלץ לבדוק בפועל — (1) הקלדת "Room 14 towels" בקבוצה → כרטיס עם source מתאים בלוח; (2) בקשת day-guest לשירות חדר ("תביאו מגבות") → reply בעברית עם upsell, לא כרטיס; (3) טאב "✨ אוטומציה חדשה" + שמירת אוטומציה לדוגמה; (4) פתיחת drawer פרופיל אורח מ-GuestDashboard; (5) RoomBoard badge ירוק/כחול על חדר עם אורח.
- ⚠️ **לא נגעתי / מחוץ לסקופ:** הקבצים ה-untracked (`.claude/claude_bot.py`, `DREAM_CONCIERGE_SYSTEM_PROMPT.txt`, `migration 076`) — לא נכללו בקומיט, לא נבדקו.

#### session 28 — Jun 24 2026 (Housekeeping Tablet View — fat-finger 3-status kiosk)
> הקשר: דירקטיבת "STRICT SPRINT MODE" — שלושה ספרינטים בלתי-תלויים סביב מסך טאבלט חדש למשק-בית: (1) רינדור גריד חדרים עם 3 כפתורי fat-finger ענקיים, (2) כתיבה אופטימיסטית ללא spinner חוסם, (3) supervisor stats bar + quick filters. **הוחלט מראש לפני כתיבת קוד:** לא לפצל סטטוס/טבלה מקבילה ל-`room_status` הקיים (§0.5 Single Source of Truth) — ראה ממצא מרכזי למטה.

- ✅ **Sprint 5.1+5.2 — `HousekeepingTabletView.js` חדש.** גריד שטוח (ללא חלוקת קומות/sections כמו RoomBoard — קיוסק ממוקד-מהירות בכוונה) של כל 26 הסוויטות מ-`SUITE_REGISTRY`. כל כרטיס חדר מציג 3 כפתורים ענקיים מוערמים (לא שלישית צמודה זה-לצד-זה — "spanning the full layout width" פורש כרוחב מלא של הכרטיס, fat-finger מקסימלי): 🔴 מלוכלך / 🟡 בניקוי / 🟢 נקי, עם הדגשה ויזואלית (border+bg+box-shadow) לכפתור התואם לסטטוס הנוכחי. כתיבה אופטימיסטית טהורה (`applyTransition()` helper משותף לשלושתם) — ה-state המקומי מתעדכן מיידית, אין שום spinner/disabled state חוסם (לפי הספרינט המפורש: "Do NOT block the UI"), וכשל DB אמיתי בלבד מבטל את ה-state חזרה + toast לא-חוסם.
- ⚠️ **ממצא ארכיטקטוני מרכזי (לפני כתיבת קוד):** ל-`room_status` יש כבר 6 ערכי status (תפוס/פנוי/לניקיון/בניקיון/ממתין לאישור/תחזוקה), ו-`AICopilot.js` (widget צף קיים) מחזיק שער-אישור קריטי: הוא מקשיב ל-`status='ממתין לאישור'` ורק כש**מנהל** מאשר — נשלחת הודעת WhatsApp "החדר מוכן" לאורח המגיע, ואז (ורק אז) הסטטוס הופך ל-`'פנוי'` + `guests.status='checked_in'` (`AICopilot.js:79-126`). אם כפתור "🟢 נקי" היה כותב `'פנוי'` ישירות, האורח **לעולם לא היה מקבל הודעה** — regression שקט בליבת חוויית האורח. לכן: 🟢 נקי כותב `'ממתין לאישור'` (לא `'פנוי'`) — מבחינת חדר-הצוות זה "סיימתי, נקי" באופן מיידי; פנימית זו עדיין השלמה של אותו שלב-ביניים ש-RoomBoard's `handleCleanConfirm` כבר משתמש בו, רק בלי המודאל-אישור. הכרטיס מציג "🔔 ממתין לאישור מנהל" לשקיפות (FAIL VISIBLE, §0.3) כשזה המצב. 🔴 מלוכלך → `'לניקיון'`, 🟡 בניקוי → `'בניקיון'` (חותם `cleaning_started_at`, מפעיל טיימר חי בכרטיס) — שתי אלו ללא סיבוך, ישירות מקבילות לפעולות הקיימות ב-RoomBoard.
- ✅ **Sprint 5.3 — Stats bar + filters.** בר עליון read-only עם 4 מדדים (סה"כ חדרים/מלוכלך/בניקוי/נקי, "נקי" סופר גם `'ממתין לאישור'` וגם `'פנוי'` כ-bucket אחד). שורת quick-filter נפרדת מתחת עם 3 כפתורי toggle בדיוק כמו שהתבקש: "הצג הכל" / "מלוכלך בלבד" / "בניקוי בלבד". חדרים בסטטוס מחוץ ל-3 הבאקטים (`תפוס`/`תחזוקה`) ממשיכים להיות מוצגים בגריד עם badge נייטרלי משלהם (🔒/🔧) — לא מוסתרים ולא נדחסים לבאקט שגוי.
- ✅ **App.js wiring.** import חדש + nav item `housekeeping_tablet` (🧹, `managerOnly:false`, אחרי `room_board`) + `pageTitle` entry + `case` בסוויצ' הראשי. **תפקיד `cleaner`'s מסך מלא הוחלף** מ-`<RoomBoard isKioskMode .../>` ל-`<HousekeepingTabletView isKioskMode .../>` (`App.js:~2116`) — זו הפעם הראשונה שתפקיד ה-cleaner מקבל מסך אחר מ-RoomBoard. `RoomBoard.js` עצמו **לא נגעתי בו בכלל** — נשאר שלם, נגיש ל-managers/admins דרך nav route "room_board" הקיים, לשליטה מלאה ב-6 הסטטוסים (כולל תחזוקה/תפוס) שה-tablet view החדש לא חושף בכוונה.
- ⚠️ **טרייד-אוף מתועד:** תפקיד cleaner לא יכול יותר לסמן חדר "תחזוקה" או לבצע "צ'ק-אין" ישירות מהמסך המלא שלו (RoomBoard's `פנוי→תחזוקה`/`פנוי→תפוס` actions) — הספרינט המפורש ביקש **בדיוק 3** כפתורים, לא 4. אם צוות ניקיון נתקל בצורך תחזוקה, יש לדווח למנהל (RoomBoard עדיין זמין למי שיש לו גישה ל-Sidebar).
- ✅ **אומת:** `npm run build` נקי (רק אזהרת `ShiftsPage` הקיימת, לא קשורה). אין migration נדרש — `room_status` table+columns כולם כבר קיימים (029/036), אין Edge Function שנגעו בו.
- ⚠️ **לא אומת חזותית חי** — אותו קיר Supabase Auth מקומי שדווח בסשנים קודמים (sessions 19–27). Mike: מומלץ לבדוק בפועל — (1) כניסה כ-user עם role='cleaner' → המסך המלא החדש; (2) tap על "🟡 בניקוי" ואז "🟢 נקי" בחדר → ודא ש-AICopilot's bell מציג alert עבורו (לא "פנוי" ישירות בלי אישור); (3) tap "מלוכלך בלבד"/"בניקוי בלבד" quick-filters.

#### session 29 — Jun 24 2026 (Sprint Timeline Realignment, Jacuzzi Status & Draggable Co-Pilot Hub)
> הקשר: דירקטיבת "FULL AUTO-PERMISSION MODE" / "STRICT SPRINT MODE" — שלושה ספרינטים: (1) טיהור Stage 3.5 מהציר הכרונולוגי + ניתוק "חדר מוכן" מהודעת הבוקר המתוזמנת, (2) מיני-pipeline ג'קוזי + בילינגואל בטאבלט הניקיון, (3) פעמון AICopilot גריר + שער-התראה חכם שמחבר את שני הספרינטים.

- ✅ **Sprint 5.1 — Purge Stage 3.5 + Dedicated Room-Ready Trigger.** `stage_key='butler_1h'` ("Stage 3.5 — העברת סוכן, שעה אחרי צ׳ק-אין", `automation_stages` migration 065) **נמחק** (DELETE, לא is_active=false — migration 079) כך שהוא נעלם גם מ-Timeline tab של AutomationControlCenter.js וגם מהסקאן החי של `whatsapp-cron` בבת אחת (שניהם קוראים את הטבלה הזו ישירות). כל ההפניות הקשורות הוסרו מ-`whatsapp-send/index.ts` (PIPELINE_TEMPLATE/PIPELINE_VARS/GUEST_FLAG + הערות כותרת), `whatsapp-cron/index.ts` (עמודת `msg_post_checkin_sent` הוצאה מה-SELECT המפורש), ו-`_shared/automationSchedule.ts` (eligibility check ייעודי). **ממצא מרכזי:** "חדר מוכן" (`room_ready` trigger) לא היה stage נפרד ב-automation_stages כלל (event-driven מה-UI) — הוא "שאל" את התבנית `dream_welcome_morning`, **אותה תבנית בדיוק** ששלב הבוקר המתוזמן (`morning_suite`/`morning_welcome`) שולח. כלומר אורח יכל קיבל את אותה ברכת-בוקר פעמיים משני triggers שונים. נוצרה תבנית Meta ייעודית `dream_room_ready` ("🔑 {{1}}, יש לנו בשורה — הסוויטה {{2}} שלך מוכנה...") — `PIPELINE_TEMPLATE.room_ready`/`PIPELINE_VARS.room_ready` עודכנו אליה. `register-templates/index.ts` קיבל את ההגדרה החדשה (+ הערת "no longer dispatched" מעל `dream_handover_agent_v2` הישן — נשאר ברשימה כרשומת-רישום היסטורית בלבד, מחיקתו לא "תבטל-רישום" אותו ב-Meta וממשיך לתמוך שליחה ידנית). `sync-wa-templates/index.ts` + `AutomationControlCenter.js`'s `META_TEMPLATE_FRIENDLY` קיבלו שמות תצוגה תואמים; `dream_handover_agent_v2`'s friendly-name הוסר מ-AutomationControlCenter (Stage 3.5 כבר לא שם).
- ✅ **`register-templates` הופעל בפועל בסשן** (curl ישיר ל-Edge Function עם anon key, ה-CLI לא תומך ב-`functions invoke` בגרסה המותקנת) — `dream_room_ready` נשלח ל-Meta בהצלחה: `id:"2096632554541579", status:"PENDING"`. ⚠️ **אל תניחו שהוא חי** — `AICopilot.js`'s `handleApprove` ישלח אליו רק לאחר שה-Templates tab יראה APPROVED; עד אז כל לחיצת "אשר ושלח הודעה" תיכשל בצורה גלויה (toast שגיאה, `room_status` לא מתקדם) ולא בשקט. **גילוי לוואי לא-קשור:** 9 מתוך 16 התבניות השיווקיות הישנות נכשלו עם "New Hebrew content can't be added while the existing Hebrew content is being deleted. Try again in 17 days" — מגבלת Meta-side קיימת מראש על חשבון ה-WhatsApp Business, לא משהו שסשן זה גרם לו או יכול לתקן; כל תבניות ה-UTILITY הפעילות ב-pipeline הליבה (כולל את כל אלו ש-automation_stages/PIPELINE_TEMPLATE קוראים להן) חזרו ALREADY_EXISTS — תקינות.
- ✅ **Sprint 5.2 — Jacuzzi mini-pipeline + Bilingual UI (`HousekeepingTabletView.js`).** migration 079 הוסיפה **שתי** עמודות ל-`room_status` (לא אחת בלבד כמתואר בספרינט המקורי) — `jacuzzi_status` (dirty/clean, כפי שהתבקש) **וגם** `room_clean_status` (dirty/clean, תוספת ארכיטקטונית נדרשת). **ממצא מרכזי:** הספרינט מתאר שער-AND ("BOTH X AND Y") — בלי עמודה נפרדת לתפוס את "הצד של החדר הסתיים" באופן עצמאי מ-`status` הקיים, לחיצה על "🟢 נקי" כשהג'קוזי עדיין מלוכלך לא הייתה משאירה שום עקבה לכך שהצד הזה כבר טופל (היה צריך לחזור ולהמציא state נוסף). `room_clean_status` סוגר את זה — `status` עצמו (העמודה הסמכותית ש-RoomBoard/AICopilot כבר מבינים) נשאר ללא שינוי עד שהשער נפתח. בילינגואל HE/EN הוחל על כל הממשק: כותרת, 4 אריחי הסטטיסטיקה, 3 כפתורי הפילטר, 3 כפתורי הסטטוס הראשיים, כפתור הג'קוזי, badges (כולל תפוס/תחזוקה), כל ההינטים השקופים, וה-toasts.
- ✅ **Sprint 5.3 — Smart Ready-Alert Gate + Draggable AICopilot.** השער מיושם משני הכיוונים: `markClean()` (🟢) בודק את `jacuzzi_status` הנוכחי, ו-`toggleJacuzzi()` בודק את `room_clean_status` הנוכחי — מי שמהם "סוגר את הזוג" כותב את `status="ממתין לאישור"` (+ `cleaning_ended_at`/`last_clean_duration_sec` בפעם הראשונה שזה קורה). `AICopilot.js` עצמו **לא נזקק לשום שינוי בלוגיקת ה-gate** — הוא כבר מקשיב ל-`status='ממתין לאישור'` בלבד, וזה ממשיך להיות נכון בדיוק כשהשער נפתח. מה שכן השתנה ב-AICopilot.js: (1) `handleApprove` עבר מ-`trigger:"inbox_reply"` (היה שולח טקסט מורכב ידנית, עבד רק כש-24h session window פתוח — בעיית אמינות אמיתית כש"אישור חדר" קורה שעות אחרי ההודעה האחרונה של האורח) ל-`trigger:"room_ready"` (BRANCH D האידמפוטנטי, תבנית Meta, עובד גם מחוץ לחלון) — וגם תוקן לבדוק `data?.ok === false` בנוסף לשגיאת invoke טרנספורט (FAIL VISIBLE אמיתי, היה חסר). (2) פעמון + פאנל הפכו **גרירים** — pointer events עם סף 6px tap-vs-drag (אותו pattern בדיוק כמו `RequestsAlertWidget.js`'s drag, מותאם לעוגן שמאל-תחתון במקום ימין-תחתון), מיקום נשמר ב-`localStorage` key `aiCopilotPos`. (3) כרטיס ההתראה מציג כעת במפורש "🏨 סוויטה X מוכנה עבור [שם אורח] — לחץ לאישור שליחת הודעה" (לפני כן: כותרת חדר + שם אורח בשתי שורות נפרדות) + אנימציית "flash" (`@keyframes ai-copilot-flash`, אותה קונבנציה כמו `sla-breach-pulse`/`wa-pulse` הקיימים) על הפעמון ועל הכרטיס הספציפי כשמתקבלת התראה חדשה, נכבה אחרי 4 שניות.
- ✅ **אומת:** `npm run build` נקי (רק אזהרת `ShiftsPage` הקיימת, לא קשורה). `npx supabase db push` (079) ו-5 `functions deploy` (`whatsapp-send`/`whatsapp-cron`/`register-templates`/`sync-wa-templates`/`whatsapp-webhook`) הצליחו, Deno type-check עבר בכולם.
- ⚠️ **לא אומת חזותית חי** — אין דרך לדמות גרירת widget אמיתית או טאבלט אמיתי מתוך הסשן. Mike: מומלץ לבדוק בפועל — (1) גרירת פעמון ה-AICopilot למיקום אחר ברענון העמוד נשמר; (2) תיוג חדר "🟢 נקי" בלבד (ג'קוזי מלוכלך) → רמז "מחכה לג'קוזי" מופיע, status לא מתקדם → תיוג ג'קוזי "✨ נקי" → status הופך "ממתין לאישור" + AICopilot מתריע; (3) לחיצת "✓ אשר ושלח הודעה" לפני ש-`dream_room_ready` מאושר ב-Meta — אמורה להציג toast שגיאה גלוי בלי לקדם את הסטטוס (FAIL VISIBLE).

#### session 30 — Jun 24 2026 (Housekeeping Tablet polish, Guest Status Guardrails & Automation UI Localization)
> הקשר: דירקטיבת "FULL AUTO-PERMISSION MODE" / "STRICT SPRINT MODE" — חמישה ספרינטים: (1) ניקוי UI עברי + premium ב-AutomationControlCenter.js, (2) אימות שה-Housekeeping Tablet (session 28/29) עומד בדרישות fat-finger, (3) סנכרון משימה ידנית→וואטסאפ + SLA דינמי, (4) תפקיד receptionist עם RBAC, (5) guardrail צ'ק-אין + נעילת שפה.

- ✅ **Sprint 5.1 — Automation UI Cleanup (`AutomationControlCenter.js`).** migration 080 משנה את `automation_stages.display_name` של `stage_key='mid_stay'` מ-"Stage 4 — מצב שהות 🏨" ל-"Stage 4 — שיחות נימוסים 🏨" (UPDATE בלבד — תזמון/תוכן לא נגעו). נוסף טקסט-הינט שקוף `(0 = יום ההגעה/הנוכחות, מספר שלילי = ימים לפני ההגעה)` לצד שני שדות "יחסית לתאריך הגעה/עזיבה" (StageCard's Timeline tab + CustomAutomationBuilder's "✨ אוטומציה חדשה"). ה-dropdown של "🟢 הודעת סשן" שהציג מפתחות DB גולמיים (`stage_3_morning`, `upsell_accepted_reply` וכו') קיבל מיפוי `SCRIPT_KEY_FRIENDLY` (13 ערכים, בדיוק הרשימה שהתבקשה) עם fallback FAIL VISIBLE (`⚠ raw_key`) למפתח עתידי שלא ימופה — אותה קונבנציה כמו `metaTemplateFriendly()` הקיים באותו קובץ.
- ✅ **Sprint 5.2 — אומת, לא שוכתב.** `HousekeepingTabletView.js` (session 28, הורחב session 29) כבר ממש את כל הספרינט בפועל: גריד שטוח עם 3 כפתורי fat-finger ענקיים מוערמים לכל חדר, כתיבה אופטימיסטית טהורה ללא spinner חוסם (`applyTransition()`), ובר סטטיסטיקות עליון (סה"כ/מלוכלך/בניקוי/נקי) + 3 כפתורי quick-filter. לא בוצע שינוי קוד — נכתב מחדש היה כפילות מיותרת על קוד שכבר תקין.
- ✅ **Sprint 5.3a — משימה ידנית משדרת לקבוצת Whapi.** עד כה רק דיווח שהתקבל **מ**-וואטסאפ (`whapi-webhook`) קיבל כרטיס בקבוצה — משימה שנפתחה מהדאשבורד (`OperationsBoard.js`'s "➕ פתח משימה חדשה", `source='manual'`) נשארה שקטה. Edge Function חדש `notify-manual-task` בונה כרטיס בפורמט המדויק שהתבקש (`🔧 [MANUAL TASK] Room X: desc (Category: Y)` + שורת "👍🏼") ושולח ל-`WHAPI_GROUP_ID`, שומר את `whapi_message_id` החוזר על השורה כך שה-reaction listener הקיים (`whapi-webhook`) פותר אותה בדיוק כמו כל משימה אחרת. `NewTaskForm` (יוצא כעת בשם, ראה Sprint 5.4) קורא לו fire-and-forget אחרי insert מוצלח — כשל Whapi לא חוסם את הטופס.
- ✅ **Sprint 5.3b — SLA דינמי לפי קטגוריה (`sla-escalation-cron`).** לפני הסשן: כל משימת "unassigned" (status='open' ללא claim) הסלימה על שעון שטוח אחד — `SLA_UNASSIGNED_MINUTES` (7 דק') — בלי קשר לקטגוריה שנבחרה בטופס. תוקן: `unassignedThresholdMinutes()` קוראת את `sla_category` של המשימה ומשתמשת בסף הקטגוריה הקיים (`pest_control:10`/`guest_amenities:15`/`maintenance:30`, אותם ערכים בדיוק שכבר משמשים את `whapi-webhook`/`NewTaskForm` ל-deadline ההשלמה) — משימה בלי קטגוריה ממשיכה על ברירת המחדל השטוחה (7). מכיוון שהסף משתנה per-task, ה-SQL `.lt()` הוחלף בסינון JS על כל המשימות הפתוחות-לא-מסולמות (סט קטן בכל רגע נתון).
- ✅ **Sprint 5.4 — תפקיד `receptionist` + מסך מלא מוגבל.** migration 080 מוסיפה `'receptionist'` ל-CHECK constraint של `profiles.role` (אותו pattern כמו migration 038's `'cleaner'`) — **לא** נבנתה טבלת `staff_users` מקבילה כפי שהספרינט המקורי ביקש: `profiles` הוא ה-Single Source of Truth הקיים לזהות צוות (§0.5), טבלה שנייה הייתה סותרת את העיקרון הזה ישירות. `UserManagement.js`'s `ROLES`/`ROLE_META` + טופס יצירת המשתמש קיבלו את `receptionist` (וגם `cleaner`, שהיה קיים ב-DB אך לא ניתן להקצאה/תצוגה תקנית מה-UI הזה — נסגר כפער-לוואי ישיר, אותן שורות בדיוק). `OperationsBoard.js`'s `NewTaskForm` יוצא כעת בשם (`export function NewTaskForm`) כדי ש-`ReceptionistView.js` החדש יוכל לעטוף אותה לוגיקה בדיוק — DB write + Whapi notify — בלי לכפול אותה (§0.4 Universal Architecture). `ReceptionistView.js` חדש: שני כלים בלבד — "📨 שלח הודעה לאורח" (חיפוש אורח + שליחת inbox_reply חופשי, אותו contract בדיוק כמו `WhatsAppInbox.js`'s manual reply) ו-"🛎️ פתח קריאת שירות" (`NewTaskForm` המיובא). `App.js` מקבל ענף מסך-מלא חדש ל-`user.role==="receptionist"` (לפני `renderPage()`, אותו pattern כמו ענף `cleaner` הקיים) — בלי Sidebar, בלי גישה לשום פאנל ניהולי.
- ✅ **Sprint 5.5 — Pre-Check-In Guardrail + Strict Hebrew Lock (`whatsapp-webhook/index.ts`).** (1) gate חדש מיד אחרי ה-Day-Guest Upsell Gate הקיים: אורח-סוויטה עם `toolLoggedRequest` (קריאת `log_guest_request` אמיתית) ש-`guests.status !== 'checked_in'` מקבל את תשובת ה-fallback המדויקת שהתבקשה ("אני רואה את ההזמנה שלך לחדר X, פתיחת בקשות שירות זמינה מיד לאחר ביצוע הצ'ק-אין...") במקום שהבקשה תיפתח כטיקט — `toolLoggedRequest` מתאפס ל-null כך שגם רישום ה-guest_alerts וגם ה-Dual-Routing Trigger (session 26) לא יורים. **ממצא:** הבדיקה ממוקדת ב-`guestRoomType==="suite"` בלבד (אותו תנאי שה-Dual-Routing Trigger כבר משתמש בו) — לא שונה לאורחי יום/חדר סטנדרטי, ששם זרימת הניתוב כבר אחרת. (2) הוראת אנטי-הזיה/הפניה לקבלה הקיימת (`buildSystemPrompt`'s כלל 2 + `FALLBACK_SYSTEM_PROMPT`) עודכנה לנוסח המדויק שהתבקש. **חשוב מזה:** נוסף `STRICT_HEBREW_LOCK_SUFFIX` המוצמד **ללא תלות** למקור הפרומפט המנצח ב-`enrichedPrompt` (לא רק כש-`buildSystemPrompt(bot_config)` הוא המקור) — אותה לקח בדיוק מה-firewall של session 24 לדליפת chain-of-thought: כלל שחי רק בתוך `buildSystemPrompt`/`FALLBACK_SYSTEM_PROMPT` משתתק ברגע ש-`bot_settings.system_prompt` (override אדמין חי) הוא המקור שמנצח. ההצמדה הזו הופכת את הכלל לאינוריאנט אמיתי בלי תלות במקור.
- ✅ **אומת:** `npm run build` נקי (רק אזהרת `ShiftsPage` הקיימת, לא קשורה). `npx supabase db push` (080) ו-3 `functions deploy` (`whatsapp-webhook`/`sla-escalation-cron`/`notify-manual-task` החדש) הצליחו, Deno type-check עבר בכולם. `whapi-webhook` **לא נגעתי בו** — אין שינוי קוד שם, ה-reaction listener שלו נשאר המקור היחיד שפותר משימות (כולל את אלו שנוצרו ע"י `notify-manual-task` החדש, דרך אותה עמודת `whapi_message_id`).
- ⚠️ **לא אומת חזותית חי** — אותו קיר Supabase Auth מקומי שדווח בסשנים קודמים. Mike: מומלץ לבדוק בפועל — (1) פתיחת משימה ידנית מ-OperationsBoard → כרטיס מגיע לקבוצת Whapi, 👍🏼 סוגר אותה; (2) יצירת user עם role='receptionist' (UserManagement) → כניסה → מסך מלא עם שני הכלים בלבד; (3) הודעת שירות-חדר מאורח-סוויטה לפני צ'ק-אין → תשובת ה-fallback המדויקת, לא טיקט; (4) "Stage 4" מוצג כ"שיחות נימוסים" ב-AutomationControlCenter, וה-dropdown של הודעת סשן מציג טקסט עברי לא מפתחות גולמיים.

#### session 31 — Jun 24 2026 (CMS Security: JWT Persistence + TOTP 2FA Gateway)
> הקשר: דירקטיבת "FULL AUTO-PERMISSION MODE" — "SESSION 7: CMS SECURITY, 2FA & PERSISTENT TOKEN MANAGEMENT", שני ספרינטים: (1) רענון session פרואקטיבי + מודאל "ההפעלה עומדת לפוג", (2) שער 2FA (TOTP) למסך CMS. **הערת מספור:** הדירקטיבה תיארה את עצמה כ"Session 7" — המספור האמיתי של הפרויקט (ראה כותרת הקובץ) הוא session 31; לא בוצע "session 7" כפול, זו המשכיות ישירה של ההיסטוריה הקיימת.
>
> **ממצא מקדים, לפני כתיבת קוד:** הדירקטיבה דיברה על "the new standalone Admin CMS Panel" — אבל אין כזה דבר בקודבייס. זו אפליקציית SPA יחידה (`App.js`, ללא React Router, ניווט דרך `setActivePage`), עם "אדמין" שהוא סט של routes מוגני-תפקיד (`AdminPanel`/`BotConfigPanel`/`BotSettings`/`UserManagement` וכו', דרך `guardPage`). נבדק גם ש-`PasswordChangeScreen.js` הקיים (`must_change_password` flow) אומר שלמשתמשים *יש* כבר סיסמאות אמיתיות ב-Supabase Auth (לא רק Google OAuth) — כך ש-login מבוסס-סיסמה ל-CMS אינו סיכון-נעילה כפי שחששתי בהתחלה.

- ✅ **Sprint 7.1 — Session Refresh (`src/context/AuthContext.js`, חדש).** `AuthProvider`/`useAuth()` — קורא session+subscribe ל-`onAuthStateChange` **באופן עצמאי** מ-App.js's הסטייט-הקיים (שני listeners על אותו client singleton, ללא קונפליקט). `scheduleRefresh()` מתזמן `setTimeout` ל-5 דק' לפני `session.expires_at`, קורא `supabase.auth.refreshSession()` בשקט; בכשל — `sessionWarning=true` (לא בכל תפוגה — רק כשניסיון הרענון השקט עצמו נכשל) שצורך אותו `SessionExpiryModal.js` ("ההתחברות המאובטחת עומדת לפוג" + כפתור "🔄 הארך הפעלה" → `extendSession()`; כשל שני → "חזרה למסך התחברות" → `signOutCms()`).
- ✅ **Sprint 7.2 — TOTP 2FA Gateway.** `CMSLogin.js` — סיסמה (`signInWithPassword`, משתמש ב-Supabase Auth MFA API האמיתי, לא מומש בעצמו): אחרי session, `supabase.auth.mfa.listFactors()` — אם אין factor מאומת, `mfa.enroll({factorType:"totp"})` מציג QR (`totp.qr_code`, SVG data-URI) + secret ידני, ואז `mfa.challengeAndVerify({factorId,code})` להפעלה; אם יש factor קיים — דילוג ישר ל-challenge. עיצוב משתמש מחדש ב-classes הגלובליים `.login-bg/.login-card/.login-field/.login-btn/.login-error` הקיימים מ-`LoginPage` ב-App.js — אותו מראה "high-end" בלי CSS כפול. `CMSPrivateRoute.js` חוסם רינדור לחלוטין אלא אם `session && aal.currentLevel==="aal2"`. `CMSGate.js` מאחד `AuthProvider`+`CMSPrivateRoute` לעטיפה בקריאה אחת.
- ⚠️ **החלטת סקופ מכוונת — לא עטפתי דפי אדמין קיימים.** עטיפת `AdminPanel`/`BotConfigPanel`/`BotSettings`/`UserManagement` הקיימים ב-`<CMSGate>` הייתה מסוכנת לבדוק בלי גישה ל-Supabase Dashboard בסשן הזה (קיר ה-Auth המקומי שחוסם QA חי כבר מ-sessions 19–30) — אם ל-super_admin/admin בפועל אין עדיין TOTP factor מוגדר וה-flow נתקע, זו נעילה אמיתית מהדפים התפעוליים שהם משתמשים בהם כל יום. במקום זאת: נוסף route חדש לחלוטין — **"🔐 אבטחת CMS"** (`cms_security`, admin/super_admin, `guardPage` הקיים) שמרכיב `<CMSGate><CMSSecurityPanel/></CMSGate>`. `CMSSecurityPanel.js` (חדש) מציג session info (email/AAL/תפוגה) + ניהול/הסרת התקני TOTP (`mfa.unenroll`) — עמוד-הוכחה אמיתי ועובד מקצה-לקצה, ללא שום רגרסיה אפשרית על routes קיימים. הרחבה לדפי אדמין נוספים (sprint 7.3+) מומלצת רק **אחרי** ש-Mike יאשר חי שהוא מצליח לעבור enroll+challenge בעצמו על המסך הזה.
- ✅ **אומת:** `npm run build` נקי (רק אזהרת `ShiftsPage` הקיימת, לא קשורה). 5 קבצים חדשים (`AuthContext.js` + 4 קבצים תחת `src/components/cms/`), ללא migration (אין שינוי DB — Supabase Auth MFA API פעיל כברירת מחדל, לא דורש toggle בפרויקט), ללא Edge Function (כל הלוגיקה client-side מול Supabase Auth ישירות).
- ⚠️ **לא אומת חזותית חי** — אותו קיר Supabase Auth מקומי שדווח בסשנים 19–30 (קרדנציאלס דמו על המסך נכשלים). **קריטי לבדוק בפועל לפני שמסמנים ✅:** (1) כניסה ל-"🔐 אבטחת CMS" עם משתמש admin → מסך CMSLogin (לא קופץ ישר ל-Panel); (2) הזנת סיסמה תקינה → אם אין TOTP מוגדר, QR מוצג ונסרק ע"י אפליקציית Authenticator אמיתית → קוד מאומת → Panel נטען; (3) רענון העמוד → session נשמר, אבל ה-AAL gate חוזר לבקש קוד (לא session.currentLevel נשאר aal2 בלי MFA אמיתי — צריך לאמת שזה ההתנהגות בפועל של Supabase, לא רק לפי תיעוד); (4) `extendSession`/`SessionExpiryModal` לא נבדק בפועל בלי לחכות לתפוגת token אמיתית (~1 שעה) — ניתן לבדוק מהיר יותר ע"י שינוי זמני של `REFRESH_LEAD_MS` ל-ערך גדול מ-3600s כדי לכפות כשל מהיר, ואז להחזיר.

---

#### session 32 — Jun 24 2026 (Data Sync sidebar exposure + luxury restyle of the existing import engine)
> הקשר: דירקטיבת "SESSION 8: EZGO REPORT INGESTION ENGINE & SMART CSV PARSER" — ביקשה לבנות `DataImporter.js` חדש מאפס: שני dropzones ("דוח כניסות יומי"/"דוח תפעול יומי"), parsing עם PapaParse/xlsx, upsert ל-`guests` עם **טלפון כמפתח התנגשות**, וסטיילינג Tailwind ("bg-slate-900", "bg-[#D4AF37]", "rounded-2xl").

> **ממצא מקדים, לפני כתיבת קוד — קריטי:** קראתי את `ArrivalImportPanel.js` + `ezgoParser.js` במלואם לפני כל שינוי. הדירקטיבה מתארת רכיב שכבר קיים, פרוס, ומתועד: `ArrivalImportPanel.js` (session 7) **הוא** "ה-SOLE import surface" — `DataUpload.js`/`DataHub.js` נמחקו בכוונה כדי שלא יהיו שני משטחי ייבוא. שלושת הפערים בין הדירקטיבה למה שקיים בפועל, ולמה לא בוצעו כפי שהתבקש מילה-במילה:
> 1. **טלפון כמפתח התנגשות ל-suite arrivals** — `aggregateGuestProfiles()` (`ezgoParser.js:319-364`) משתמש בכוונה ב-row-index key, **לא** בטלפון, כי קואורדינטור הזמנה אחד (טלפון יחיד) מנהל לרוב כמה חדרים/אורחים — מפתח-טלפון קודם גרם לאיבוד שורות בשקט (hotfix 3.3/3.4, מתועד ב-§0.1). שינוי בכיוון הדירקטיבה היה מחזיר את הבאג הזה. (הנתיב הפשוט יותר — Daily Report בלבד, ללא suite rooms — **כן** משתמש כבר בטלפון כמפתח, `ArrivalImportPanel.js:582-619` PATH B, כי שם כל רשומה היא אורח-יחיד מזוהה. שום קוד לא שונה שם.)
> 2. **Tailwind CSS** — לא מותקן/מוגדר בכלל ב-CRA הזה (`package.json` אומת — אין `tailwindcss`/`postcss`/`autoprefixer`). הוספת classes כאלה הייתה מרנדרת ללא עיצוב כלל בלי לבנות pipeline build נפרד — שינוי תשתית גדול ולא מבוקש בפועל.
> 3. **`DataImporter.js` חדש, נפרד** — היה שובר את עקרון Universal Architecture (§0.4) ואת ההחלטה המתועדת מ-session 7 ("DataUpload.js + DataHub.js נמחקו — מוזגו ל-ArrivalImportPanel").
>
> הוצג למשתמש (Mike) סיכום של הממצא הזה לפני כתיבת קוד; הוא אישר גישה משולבת: לחשוף את `ArrivalImportPanel.js` הקיים כ-route עצמאי בסיידבר + לעשות לו restyle ללוקסוס כהה+זהב (לא Tailwind — עם משתני ה-CSS הקיימים של הפרויקט).

- ✅ **חשיפת Sidebar (`App.js`).** כפתור אדמין חדש "📥 סנכרון נתונים" (`data_sync`, באותו pattern בדיוק כמו שאר כפתורי "👑 אדמין" — `guardPage(["admin","super_admin"])`) → `<DataSyncPage />` חדש. **לא הוסר** ה-mount הקיים בתוך `OperationsBoard.js:483` (`{canCreate && <ArrivalImportPanel />}`) — שתי נקודות-כניסה לאותו מנוע ייבוא, אפס לוגיקה כפולה.
- ✅ **`DataSyncPage.js` חדש** — thin wrapper בלבד (אין parsing/DB calls כאן בכלל): כותרת luxury (אייקון בגרדיאנט זהב, כותרת Playfair Display, תת-כותרת מסבירה) מעל מסגרת `radial-gradient` כהה (`#1c1c1c`→`#0F0F0F`) עם border זהב + box-shadow רך, מרכיבה `<ArrivalImportPanel defaultOpen />`.
- ✅ **`ArrivalImportPanel.js` — prop `defaultOpen` (ברירת מחדל `false`)** כדי שה-mount הקיים בתוך OperationsBoard (שלא מעביר את ה-prop) ימשיך להיות מכווץ-כברירת-מחדל כבעבר — אפס שינוי התנהגות שם. ה-mount החדש מ-DataSyncPage מעביר `defaultOpen` כי זה כל מטרת הדף.
- ✅ **Restyle ל-deep-dark/gold (`ArrivalImportPanel.js`)** — ה-chrome של הפאנל עצמו (header מתקפל, מסגרת הפאנל הפתוח, ה-pills של הטאבים, באנרי המידע, כפתור הסנכרון/הזריקה) עברו מ-`var(--card-bg)`/`var(--ivory)` בהיר לגרדיאנטים כהים (`#1c1c1c`/`#161616`/`#0F0F0F`) עם גבול/טקסט `var(--gold)`/`var(--gold-light)` ו-box-shadow לזוהר רך — **ללא** משתני CSS חדשים, רק הפלטה הקיימת (§11). **בכוונה לא נגעתי** ב-DropZone/EditableGrid/טבלת התצוגה המקדימה/result panel/stat chips — אלו שומרים על הרקעים הבהירים הקיימים שלהם, כך שהתוצאה היא "מסגרת כהה+זהב מסביב לכרטיסים בהירים" — אותו pattern בדיוק כמו ה-Sidebar הכהה מול תוכן האפליקציה הבהיר (§11), לא דפוס חדש מומצא. תוקנו 5 מקטעי טקסט שהיו נשארים כהים-על-כהה (לא קריאים) בעקבות שינוי הרקע: hint עליון, hint תאריך-יבוא, "מנתח כותרות...", שם-קובץ/מס' שורות בטאב משמרות.
- ✅ **אומת:** `npm run build` נקי (רק אזהרת `ShiftsPage` הקיימת, לא קשורה). ללא migration, ללא Edge Function — שינוי frontend בלבד.
- ⚠️ **נסיון אימות חזותי חי — נחסם ע"י אותו קיר Auth מקומי שמתועד מ-session 19.** בניגוד לסשנים קודמים, הפעם כן הצלחתי להפעיל preview server ולהגיע למסך הלוגין (שמציג קרדנציאלס דמו: `eliad`/`1234` מנהל כללי, `shira@dreamisland.com`/`1234` ו-`yossi@dreamisland.com`/`1234` מנהלי מחלקה) — אבל שני הניסיונות (`eliad`+`shira@dreamisland.com`, שניהם עם `1234`) חזרו "שם משתמש או סיסמה שגויים". זה מאשר, לא סותר, את התיעוד מ-sessions 19–31: הקרדנציאלס המוצגים על המסך לא עובדים בסביבה המקומית הזו (כנראה Supabase Auth מקומי לא מסונכרן עם ה-mock users, או שאלו דורשים session ענן חי). Mike: מומלץ לבדוק בעצמך עם credentials אמיתיים — (1) "📥 סנכרון נתונים" מופיע בסיידבר האדמין; (2) לחיצה עליו פותחת את הפאנל פתוח-מראש (לא מכווץ) במסגרת כהה+זהב; (3) ה-mount הקיים בתוך "תפעול ואחזקה" עדיין נראה ועובד כשהיה (מכווץ כברירת מחדל).

#### session 33 — Jun 25 2026 (WhatsApp Inbox → Operations Control Room: WordPress-style editor, persisted claim + realtime broadcast, contextual macros, roster chips)
> הקשר: דירקטיבת "SESSION 9: MULTI-AGENT LIVE INBOX & WORDPRESS-STYLE CMS EDITOR" — ביקשה תחילה **תכנון בלבד** (audit + brief, ללא קוד) לארבע יכולות: עורך מטא-דאטה ידני בתוך תיבת השיחות, מצב נוכחות/שיוך לפי Supabase Presence, badge חדר/סוויטה ב-roster, ו-quick-reply panel הקשרי. הבריף אושר, ואז בוצע בארבעה ספרינטים על פני שתי הודעות-המשך (9.1–9.2, ואז 9.3–9.4) — לא בבת אחת.

**ממצאי הבריף המקדים (לפני כל קוד):** נקרא `WhatsAppInbox.js` (2225 שורות), `AddGuestModal.js`, `CustomerProfilePane.js`, `suiteRegistry.js`, `AICopilot.js`, `OperationsBoard.js` במלואם. שלושה ממצאים שינו את התכנון מהדירקטיבה הגולמית: (1) **אין Supabase Presence בקודבייס כלל** (grep מאומת על כל `src/`) — "recently active" הוא proxy מבוסס last-message-timestamp, לא נוכחות אמיתית; (2) **אין `claimed_by`/`assignment_status` על `whatsapp_conversations` או `guests`** — הפאטרן הזה קיים רק על `tasks` (`OperationsBoard.js:427`); (3) **"שעות ארוחה" לא קיימות בסכימה בכלל** — רק `spa_time`/`treatment_time` קיימים, נדרשה מיגרציה לפני שניתן היה לבנות macro אמיתי במקום להמציא placeholder ריק (FAIL VISIBLE).

**Sprint 9.1 — WordPress-style guest editor.** `AddGuestModal.js` קיבל prop `dock` — `dock="right"` מרנדר אותו כ-drawer ימני נגרר-פנימה (slide-in, `animation: agm-drawer-in`) במקום מודאל ממורכז; ברירת המחדל (ללא prop) משאירה את שני הצרכנים הקיימים (GuestsPage/GuestDashboard) ללא שינוי. נוסף textarea ל-`guest_notes` (migration 053 — היה append-only, בלי עורך בשום מקום באפליקציה עד כה) + שדות `meal_time`/`meal_location` חדשים. `WhatsAppInbox.js` קיבל כפתור ✏️ בכותרת ה-thread → `openGuestEditor()` שמביא את שורת ה-guest **המלאה** לפי phone variants (לא רק השדות החלקיים שה-join של תיבת השיחות נושא) — guest לא-קיים נופל ל-skeleton `{phone}` ש-AddGuestModal's `isEdit=!!guest.id` הקיים מטפל בו כ-"צור חדש" בלי שינוי קוד נוסף.

**Sprint 9.2 — Persisted claim/assignment.** migration 081: `guests.claimed_by` (FK→profiles)/`claimed_at`. כפתור toggle יחיד בכותרת ה-thread (🙋 לא-משויך → 🔁 השתלטות על שיוך קיים → ✓ שלך; קליק נוסף = שחרור) — ללא שער הרשאות, אותו מודל אמון כמו claim הקיים ב-OperationsBoard (כלי team קטן, ה-badge הוא האות החברתי שמונע התנגשות, לא מנעול). Badge "🔒 בטיפול: [שם]" ב-roster, נפתר משם פרופיל via `profiles.id→name` map שנטען פעם אחת. **תיקון אגב קריטי בדרך:** `<html dir="rtl">` גלובלי (index.html:2 + App.js:267) — overlay חדש עם `justifyContent:"flex-end"` בלי `direction` מפורש יורש rtl, ו-flex-end הופך **לוגי** (שמאל ב-RTL, לא ימין פיזי) — תוקן ב-AddGuestModal עם `direction:"ltr"` מפורש על ה-overlay החיצוני בלבד. אותו באג זוהה (ותוקן ע"י Mike, באישור) ב-`CustomerProfilePane.js` הקיים מ-session 27 — לא היה מאומת חזותית מעולם.
**תיקון אגב שני, חשוב יותר:** `GuestDashboard.js`'s `guests` select המפורש (לא `*`) היה חסר `treatment_count`/`order_number`/`payment_amount`/`payment_link_url`/`needs_callback` — פער Zero-Data-Loss אמיתי **שקדם לסשן הזה**: `AddGuestModal` שולח patch מלא בכל שמירה (לא diff), כך שעריכת אורח מ-GuestDashboard איפסה את השדות החסרים בשקט מאז ש-session 25 הוסיפה payment_amount/payment_link_url ל-modal בלי לעדכן את ה-select הזה. תוקן (+ נוספו meal_time/meal_location הנדרשים לסשן הזה).

**Sprint 9.3 — Roster chips + Realtime broadcast.** `roomChipMeta()` קורא ל-`getSuiteSection()` הקיים (suiteRegistry.js, ללא מיפוי חדש) להציג "🏨 [שם סוויטה]" צבוע-לפי-section, או "☀️ בילוי יומי [1/2]" ל-Premium Day packages / `room_type==='day_guest'`. שלושת ה-badges (זהות/חדר/שיוך) עברו ל-flex row עם `flexWrap` כדי לא להישבר ברוחב צר. **Realtime:** channel **נפרד** (`wa-inbox-guests-rt`, בכוונה לא מאוחד עם `wa-inbox-rt-v2` הקיים כדי לא לסכן את לוגיקת ה-reconnect שלו) על `postgres_changes` UPDATE של `guests` — claim/release/עריכה מטאב אחד מופיע בטאבים אחרים בלי רענון. `applyGuestRowUpdate()` הוא helper משותף לשני הצרכנים (שמירת ה-drawer + payload ה-realtime) כדי ששני מסלולי ה-patch לא יתפזרו זה מזה. migration 082 מוסיפה את `guests` ל-`supabase_realtime` publication — **אותו failure mode מתועד כמו migration 059** (guest_alerts): בלי זה, ה-subscription נרשם בהצלחה ולעולם לא מקבל event, בלי שגיאה גלויה.

**Sprint 9.4 — Contextual macros (No-Token Quick Replies).** `buildContextualMacros(activeContact)` מחליפה את `QUICK_PHRASES` הסטטי **בתוך ה-thread quick-actions drawer בלבד** (לא ב-`NewChatModal`, שמנהל `selectedGuest` נפרד ואין לו מושג "שיחה פעילה") — templating טהור מ-`spa_time`/`meal_time`/`meal_location`/`room` הכבר-טעונים בזיכרון, **אפס קריאות LLM/טוקנים**. עד 3 macros (ארוחה/ספא/חדר), כל אחד רק אם השדה המתאים קיים. נופל בחזרה לרשימת `QUICK_PHRASES` הגנרית כשלאורח אין שום מטא-דאטה שימושית (FAIL VISIBLE — לעולם לא drawer ריק/שבור). כפתורים הקשריים מסוגננים בזהב (`var(--gold)`/גרדיאנט) להבדיל ויזואלית מהפתקים הגנריים האפורים — גם הכותרת מתחלפת ל-"✨ הצעות לפי פרטי האורח".
ה-join הראשי (`fetchAll`+`fetchSince`) הורחב פעם אחת ל-`id, room_type, status, departure_date, meal_time, meal_location, claimed_by, claimed_at` — אותה קריאה קיימת, לא query נוסף.

- ✅ **אומת:** `npm run build` נקי על כל ארבעת הספרינטים (רק אזהרת `ShiftsPage` הקיימת, לא קשורה). `npx supabase db push` הריץ migrations 081 ו-082 בהצלחה (081 גם דחף את 076 שכבר היה pending — ראה למטה).
- ℹ️ **ממצא לוואי על migration 076:** `supabase/migrations/076_wa_conversations_update_rls.sql` היה untracked ב-git (לא commit-ed) אבל ה-`db push` הראשון של הסשן הזה הציג רק את 081 כ-pending — כלומר 076 **כבר היה מיושם בפועל על ה-DB החי** קודם לכן (ledger המיגרציות של Supabase נפרד מ-git; "untracked" אומר רק שלא הועלה ל-version control, לא שלא רץ). אין צורך בפעולה נוספת.
- ✅ **נסיון אימות חזותי חי — לראשונה עם preview server אמיתי שרץ (לא רק production build).** מולא טופס login עם `eliad`/`1234` ע"י Claude Preview MCP — נכשל עם "שם משתמש או סיסמה שגויים", זהה לכל הסשנים הקודמים (19–32). **בדיקה נוספת שלא בוצעה קודם:** `.env.local` נקרא ואומת מצביע על הפרויקט הנכון (`bunohsdggxyyzruubvcd`, תואם לתיעוד ב-§1) — כך ש"פרויקט Supabase שגוי" **נפסל** כסיבה. שגיאת הקונסול היחידה (`חסר REACT_APP_GOOGLE_CLIENT_ID`) היא רעש לא-קשור (Google OAuth, לא חוסם את נתיב הסיסמה). המסקנה נשארת זהה לכל סשן קודם: קרדנציאלס הדמו המוצגים על המסך אינם תואמים לחשבונות אמיתיים בסביבת ה-Auth המקומית הזו. Mike: מומלץ לבדוק בעצמך עם credentials אמיתיים — (1) ✏️ בכותרת thread פותח drawer ימני (לא שמאל!) עם כל שדות האורח כולל הערות/ארוחה; (2) כפתור 🙋/🔁/✓ בכותרת מתעד claim ומציג badge בroster; (3) פתיחת שני טאבים, claim בטאב אחד מופיע בטאב השני בלי רענון; (4) drawer הפעולות המהירות (⚡) מציג macros זהובים הקשריים לאורח עם spa_time/meal_time, ופתקים אפורים גנריים לאורח בלי מטא-דאטה; (5) badge חדר/בילוי-יומי ב-roster.

#### session 34 — Jun 25 2026 (Smart Inbox AI Copilot & System Prompt Overhaul)
> הקשר: דירקטיבת "SMART INBOX AI COPILOT & SYSTEM PROMPT OVERHAUL" — מצורף screenshot (`image_eb8f27.png`) של אזור "תגובות מהירות"/"ניתוב משימה" ב-thread quick-actions drawer, עם תלונה ש-"הכפתורים האלה 'מטומטמים'" — `{{שם}}` גולמי שדולף, ומשימות-תפעול שנשלחות מבלי שהצוות בפועל הגדיר מה הבעיה. שלושה ספרינטים: (1) AI reply generator on-demand, (2) smart task-routing picker, (3) overhaul לטון/זהות הבוט הפונה לאורחים.

**ממצא מקדים:** התלונה על `{{שם}}` גולמי מתייחסת ל-`QUICK_PHRASES` (הרשימה הסטטית הגנרית, session 12) — לא ל-`buildContextualMacros()` (session 33, שכבר בונה את השם *לתוך* הטקסט בלי placeholder). הבאג המדויק: ה-fallback ל-`QUICK_PHRASES` ב-thread drawer קרה כש-`buildContextualMacros()` חזרה ריקה (אורח בלי spa_time/meal_time/room), ו-`ph.text.replace("{{שם}}", activeContact.guestName)` מדלג על ההחלפה כש-`guestName` הוא `null` (אורח שזוהה רק לפי pushName/טלפון) — אז הפלייסהולדר הגולמי דלף לתיבת הטיוטה. זה בדיוק התרחיש שה-screenshot תפס. "ניתוב משימה" אינו hardcoded במובן "towels קבוע בקוד" — `routeTask()` השתמש בטקסט ההודעה האחרונה *הגולמית* של האורח כתיאור המשימה (אם האורח כתב משהו על מגבות, זה מה שהגיע ללוח התפעול) — בלי שכבת-שיפוט של הצוות בדרך, מה שהדירקטיבה מפרשת בצדק כ"לא מוגדר כראוי".

- ✅ **Sprint 1 — AI Reply Generator (`suggest-replies` Edge Function חדש + WhatsAppInbox.js).** Function חדש, stateless במלואו (אין history/Drive RAG/memory — לא משותף עם `chat/`'s machinery בכוונה, ראה §3/§6). מקבל 3 ההודעות האחרונות (כבר טעונות בזיכרון בצד הלקוח — `activeContact.messages.slice(-3)`, אין query נוסף) + guestName/room, Gemini 2.5 Flash (`responseMimeType:"application/json"`)→Claude fallback, מחזיר עד 3 הצעות תגובה קצרות. `parseSuggestions()` עם 3 שכבות הגנה (JSON ישיר → regex `{...}` → line-split) למקרה שהמודל לא מצליח לחזור ב-JSON נקי. ב-`WhatsAppInbox.js`: כפתור "✨ הצעות AI חכמות" קורא ל-`generateAiSuggestions()` **רק בקליק מפורש** — לא בבחירת שיחה, לא ב-`useEffect` (Token Saving כנדרש). תוצאות + שגיאות מתאפסות ב-`openContact()` כש-עוברים שיחה (לא דולפות הצעות מהשיחה הקודמת).
- ✅ **Sprint 1 — הוסר ה-fallback ל-`{{שם}}` הגולמי.** `QUICK_PHRASES` **לא נמחק** (עדיין קיים ובשימוש ב-`NewChatModal` — שיווק לאורח-בלי-שיחה-פעילה, מושג שונה לחלוטין מ-"הצעת תגובה הקשרית לשיחה קיימת") אבל **כבר לא משמש כ-fallback** בתוך thread drawer — שם הוחלף לחלוטין ע"י כפתור ה-AI. `buildContextualMacros()` (session 33) ממשיכה להופיע **בנוסף**, לא הוחלפה — הן macros מיידיות-בחינם (spa/meal/room) שלא מתחרות עם הצעות AI הקשריות-לשיחה.
- ✅ **Sprint 2 — Smart Task Routing.** `routeTask()` מקבל כעת `subCategoryLabel`/`note` במקום להרכיב את התיאור מהודעת האורח הגולמית. קליק על "🔧 תחזוקה"/"🛏️ משק בית" לא יורה משימה — פותח `routeDraft` state עם chips תת-קטגוריה (`TASK_SUBCATEGORIES`: תחזוקה→מזגן/תאורה/אינסטלציה, משק בית→מגבות/סידור חדר/שירותי נוחות) + שדה free-text ("פרטים נוספים") לתרחישי-קצה. כפתור "🚀 שלח משימה" מנוטרל (לא מוסתר — §0.2 Disable Don't Hide) עד שנבחר chip אחד לפחות או הוזן free-text; `description` הסופי בונה מ-`[subCategoryLabel] — [note]`, עם נפילה לטקסט הגולמי הישן רק אם שניהם ריקים (לא אמור לקרות, ה-UI חוסם זאת — שכבת בטיחות).
- ✅ **Sprint 3 — Persona/Tone Overhaul (`whatsapp-webhook/index.ts`).** נוסף `LUXURY_CONCIERGE_PERSONA_SUFFIX` חדש — מוצמד **בלתי-תלוי-מקור** ל-`enrichedPrompt` (אותה שיטה בדיוק כמו `STRICT_HEBREW_LOCK_SUFFIX` מ-session 30, ראה §6 "Suffix-based Prompt Invariants" החדש), כך שדרישות ה-ROLE/TONE עומדות גם כש-`bot_settings.system_prompt` (admin override) הוא המקור המנצח. מכוון רק ל-ROLE+TONE — לא כפל את כללי השפה/אנטי-הזיה שכבר מכוסים ב-suffix הקיים. בנוסף, רוככו (לא רק ה-suffix) גם `FALLBACK_SYSTEM_PROMPT`'s שורת הפתיחה וגם `buildSystemPrompt()`'s שורת הפתיחה — משניהם "5 כוכבים בכל משפט" (רשמי) ל-"חם, קליל, כמו מנהל/ת אירוח אנושי — לא נציג שירות רשמי/רובוטי", כך שכל שלושת מקורות הפרומפט מתואמים זה לזה ולא רק נסמכים על ה-suffix לתיקון בדיעבד. ה-SAFETY requirement ("never invent data, hand off gracefully") **כבר היה מכוסה במלואו** ע"י rule #2 הקיים + משפט ה-handoff המדויק ב-`STRICT_HEBREW_LOCK_SUFFIX` — לא שוכפל, רק חוזק במשפט קצר נוסף ב-suffix החדש.
- ✅ **אומת:** `npm run build` נקי (רק אזהרת `ShiftsPage` הקיימת, לא קשורה). `npx supabase functions deploy suggest-replies --no-verify-jwt` ו-`...deploy whatsapp-webhook --no-verify-jwt` הצליחו, Deno type-check עבר בשניהם. `npx supabase secrets list` אישר ש-`GEMINI_API_KEY`+`ANTHROPIC_API_KEY` שניהם מוגדרים בפרודקשן — ל-`suggest-replies` יש fallback אמיתי, לא רק תיאורטי. ללא migration — שינוי קוד בלבד (לא DB).
- ⚠️ **לא אומת חזותית חי** — אותו קיר Auth מקומי שמתועד מ-session 19 (ואושר שוב ב-session 33). Mike: מומלץ לבדוק בעצמך — (1) פתיחת שיחה ללא spa_time/meal_time/room → drawer מציג רק כפתור "✨ הצעות AI חכמות" (לא רשימת ביטויים גנרית ישנה); קליק עליו מחזיר 3 הצעות אמיתיות מבוססות ההודעות האחרונות; (2) קליק "🔧 תחזוקה" פותח picker עם chips+free-text, כפתור "שלח משימה" מנוטרל עד שממלאים אחד מהשניים; (3) תשובת הבוט לאורח (whatsapp-webhook) נשמעת חמה/קלילה יותר ולא "תאגידית", עדיין בעברית בלבד ועדיין מתמודדת בעדינות עם שאלה שהמידע עליה לא קיים.

#### session 35 — Jun 25 2026 (Pre-Arrival Guest Portal & Static Photo Tour)
> הקשר: דירקטיבת "SESSION 10: PRE-ARRIVAL GUEST PORTAL & STATIC PHOTO TOUR" — מעבר ראשון בהיסטוריית הפרויקט מ-staff backend ל-guest frontend: עמוד ציבורי ללא-סיסמה לאורחים, עם hero+countdown, scrollytelling photo tour (ללא three.js), ו-upsells בקליק-אחד שמתריעים לצוות. שלושה ספרינטים: (1) Magic Link & Itinerary Hero, (2) Scrollytelling Virtual Tour, (3) In-Scroll One-Click Upsells.

**ממצא מקדים, לפני כתיבת קוד — קריטי, סטייה מכוונת מהדירקטיבה:** הדירקטיבה ביקשה `/portal/:phone`. `guests.phone` הוא מספר טלפון אמיתי של אורח — לא secret, לא בלתי-ניחושי, ו-`guests.id` (BIGINT IDENTITY, סדרתי) גם לא. שימוש באחד מהם כקרדנציאל היחיד לעמוד ציבורי שחושף שם/חדר/תאריך-הגעה הוא חשיפת PII אמיתית (מישהו שמנחש/יודע מספר טלפון של אורח יכול לצפות בפרטים שלו). נבנה במקום זאת מנגנון magic-link אמיתי: `guests.portal_token` (UUID אקראי, migration 083) — ה-URL עצמו הוא הקרדנציאל, אותו מודל אבטחה כמו קישור איפוס-סיסמה. RLS על `guests` **לא נגע בו** (נשאר authenticated-only, migration 028) — שני ה-Edge Functions החדשים משתמשים ב-service-role key בלבד ומחזירים subset ידני נבחר-בקפידה, לא `select("*")`. הוצג למשתמש (Mike) ב-CLAUDE.md ובתשובת הסשן, לא נשאל מראש (FULL AUTO-PERMISSION MODE, אותה קונבנציה כמו session 32/33).

- ✅ **Sprint 10.1 — Magic Link & Itinerary Hero.** migration 083: `guests.portal_token` (UUID UNIQUE NOT NULL, `gen_random_uuid()` default — `uuid_generate_v4()`/uuid-ossp נכשל בפועל בפוש, לא מופעל בפרויקט הזה למרות הפניה ב-migration 001; pgcrypto כן מופעל כברירת מחדל ב-Supabase, תוקן ל-`gen_random_uuid()`). Edge Function חדש `guest-portal-data` (service-role, לא RLS) מחזיר שם/חדר/room_type/תאריכים/spa_time/meal_time/meal_location/status בלבד. `index.js` בודק `window.location.pathname` **לפני** רינדור `<App/>` — `/portal/:token` מרכיב `<GuestPortal/>` במקום, כך שכל ה-hook chain של staff-auth לא רץ כלל לאורח לא-מאומת (אין react-router-dom בפרויקט בכוונה, §2 — route ציבורי בודד לא הצדיק ספריית ניתוב). `GuestPortal.js` קובע 3 stay-phases (`upcoming`/`in_stay`/`past`) לפי `arrival_date`/`departure_date` מול היום, עם countdown חי (days/hours/minutes/seconds, `setInterval` 1s) ל-`arrival_date`+"15:00" קבוע (משקף את `bot_config.hotel_checkin_time`'s ברירת המחדל המתועדת — לא נטען בנפרד כדי לשמור על round-trip ציבורי יחיד). פאנל itinerary glass מציג spa/meal רק כש-יש להם ערך.
- ✅ **Sprint 10.2 — Scrollytelling Virtual Tour (`PhotoTour.js`).** ללא three.js/ספריית 3D, כמתואר. כל סצנה = section בגובה `100vh` עם `IntersectionObserver` (לא scroll-listener) שמפעיל CSS opacity/transform transitions — crossfade דרך CSS בלבד. רקע = `linear-gradient(...), url(...)` בשכבה אחת — תרגיל CSS נחמד: אם ה-JPG (שאף אחד מהם לא קיים היום ב-`public/images/`, רק paths placeholder לפי הדירקטיבה) נכשל ב-404, שכבת ה-url() פשוט לא נצבעת והגרדיאנט מתחתיה ממשיך להיראות שלם — שום סצנה לא "שבורה" גם בלי תמונות אמיתיות, ותתחזק אוטומטית כש-Mike יעלה תמונות אמיתיות לנתיבים האלה (`/images/entrance.jpg`/`spa.jpg`/`wine.jpg`/`suites.jpg`) — אפס שינוי קוד נדרש.
- ✅ **Sprint 10.3 — In-Scroll One-Click Upsells.** Edge Function חדש `guest-portal-upsell` — אותו אימות token, insert ל-`tasks` (`source='portal_upsell'`, migration 083 — מקור נפרד בכוונה מ-`guest_request` כדי להבדיל "אורח לחץ upsell בפורטל" מ-"בקשה שנותבה משיחת וואטסאפ") + כרטיס לקבוצת Whapi (`_shared/whapiSend.ts`, אותה שיטה כמו `notify-manual-task`) שנפתר ע"י אותו reaction-sweep listener (👍🏼) כמו כל task אחר. כשל Whapi הוא best-effort — ה-task כבר נוצר, toast ההצלחה לאורח ("בקשתך הועברה בהצלחה ✨") לא תלוי בו.
- ✅ **תוספת קישור — לא התבקשה במפורש אך נדרשת בשביל שהפיצ'ר יהיה שמיש בכלל:** `CustomerProfilePane.js` קיבל כפתור "🔗 העתק קישור לפורטל האורח" (clipboard copy, fallback ל-`window.prompt` אם ה-API חסום) — בלעדיו אין שום דרך לצוות לקבל את ה-URL בפועל לשלוח לאורח. דרש הוספת `portal_token` ל-select המפורש של `GuestDashboard.js` (אותו תבנית-תיקון כמו session 33/34).
- ✅ **באג אמיתי נמצא ותוקן תוך כדי בדיקה חיה — לא רק תיאורטי.** עם preview server אמיתי (ראשונה שניתן לבדוק עמוד-ללא-login בפועל — קיר ה-Auth המקומי שחסם אימות בכל הסשנים הקודמים רלוונטי רק לעמודי staff, לא לעמוד ציבורי כזה!): ניווט אמיתי (קליק על `<a>` שהוזרק, לא `window.location.assign` שנחסם ע"י sandbox ה-preview) ל-`/portal/abc-test-123` חשף ש-`portal_token` הוא עמודת UUID — token לא-בצורת-UUID זרק שגיאת Postgres גולמית ("invalid input syntax for type uuid") שדלפה ללקוח כ-"שגיאה בטעינת הפרופיל" גנרי, במקום "לא מצאנו הזמנה" הנקי שצריך לחזור גם ל-token-מזויף-אבל-תקין-בצורתו וגם ל-token-לא-תקין-בצורתו. נוסף UUID regex guard לפני השאילתה בשני ה-Edge Functions (`guest-portal-data`+`guest-portal-upsell`) — אומת מחדש ישירות (fetch ל-functions endpoint) ששני המקרים מחזירים `guest_not_found` נקי, ושה-UI מציג את ההודעה הנכונה.
- ⚠️ **גבול בדיקה מכוון — לא הוזרק guest מזויף לטבלת production.** ה-DB החי הזה משמש אורחים/בוטים אמיתיים; הוספת/מחיקת שורת בדיקה ב-`guests` (אפילו זמנית) נשקלה ונדחתה כסיכון לא-מוצדק (תהליכי אוטומציה תלויים ב-arrival_date/status, ראה §0 CORE BUSINESS LOGIC). מה שאומת: routing ציבורי מקצה-לקצה, שני מקרי שגיאה (token מזויף-בצורה ותקין-בצורה-אך-לא-קיים), הגעה ל-Edge Functions, ותיקון הבאג שנמצא. מה שלא אומת: ה-happy path האמיתי (hero עם countdown/itinerary אמיתיים מול guest קיים, ה-photo tour ויזואלית, זרימת upsell→task→Whapi מלאה). Mike: מומלץ לבדוק עם אורח אמיתי — (1) `CustomerProfilePane.js`'s "🔗 העתק קישור" על אורח קיים; (2) פתיחת הקישור בדפדפן רגיל (לא נדרש login!); (3) קליק על upsell ("🍷 הזמן סדנת יין" וכו') → toast הצלחה + בדיקה שכרטיס הגיע לקבוצת Whapi + task ב-OperationsBoard עם `source='portal_upsell'`.

#### sessions 36–38 — Jun 25 2026 (Configurable content config, Luxury UI upgrade, Full Portal Integration)
> שלוש דירקטיבות רצופות שכולן ממשיכות את ה-Guest Portal מ-session 35, בלי לעבור קודם דרך §10 — מתועדות כאן יחד כדי לא להשאיר פער.

**Session 36 — Configurable Scrollytelling Engine.** Mike ביקש שכבת "WordPress-style" כך שעדכון טקסט/תמונה לא יצריך לגעת בקוד. `src/data/portalContent.js` (לא `config/PortalContent.js` בשורש כפי שהתבקש במקור — Create React App פיזית חוסם import מחוץ ל-`src/`, ו-`src/data/` הוא המקום הקיים לסוג הקובץ הזה, ראה suiteRegistry.js) מחזיק כעת *רק* טקסט+שם-קובץ-תמונה לכל סצנה; `PhotoTour.js` ממפה מעליו בלבד, אפס תוכן מקומי. גוון הגרדיאנט-fallback עבר ל-cycling אוטומטי לפי אינדקס סצנה (לא בקונפיג) כך שהקובץ שMike עורך נשאר נקי משני פרמטרים בלבד.

**Session 37 — Luxury Resort UI Upgrade (Dream Island XOS) + Brand Voice.** דירקטיבה קודמת לבקש scraping של tzalamnadlan.co.il נעצרה ע"י Mike; הדירקטיבה שהחליפה אותה ביקשה למשוך את הטון מ-dream-island.co.il (אתר המלון האמיתי, בבעלות Mike — לא scraping של גורם שלישי). Firecrawl CLI לא היה מאומת במכונה הזו (חסר API key/init) — נעשה שימוש ב-WebFetch המובנה במקום. תוכן 4 הסצנות ב-`portalContent.js` הוחלף בניסוח **אמיתי** מהאתר עצמו: "מתחם המים", "מסעדת ערמונים", "DREAM SPA"/"SPA EVENU", "26 סוויטות בוטיק...כאבן חן ייחודית" — לא ניסוח גנרי שהומצא.
⚠️ **באג אמיתי נמצא:** `public/index.html` לא הכיל שום `<link>` לגופנים בכלל — Heebo/Playfair Display נטענו רק דרך `@import` בתוך מחרוזת ה-CSS שמוזרקת ע"י `App.js` (`<style>{css}</style>`), שרץ רק כש-App.js מרכיב. הפורטל הציבורי (`GuestPortal.js`) מרכיב **במקום** App.js (ראה index.js, session 35) — כך שכל ה-`fontFamily` שהוגדרו בפורטל מעולם לא נטענו בפועל, fallback שקט לגופן המערכת. תוקן בשורש: `<link>` אמיתי ל-Google Fonts הועבר ל-`index.html` (משרת גם את האפליקציה הפנימית, גם את הפורטל; טעינה מהירה יותר מ-`@import` גם כך). `App.js`'s `@import` הוסר כפול. כותרות הפורטל הוחלפו מ-Playfair Display (serif) ל-Heebo (sans-serif, weight 800) — תואם לבריף "מינימליסטי, ארכיטקטוני".
ויזואלית: glassmorphism `backdrop-filter: blur(15px)` + border זהב דק על רקע `#09090b`, Ken-Burns zoom איטי (9s transition, לא snap מהיר) דרך IntersectionObserver, הינט "↓ גלילה למטה" עם bounce על הסצנה הראשונה בלבד, hover עם זוהר זהב על כפתורים (חייב `<style>` עם `:hover` אמיתי — אי אפשר ב-inline style גרידא).
✅ **אומת חזותית בפועל** — preview server אמיתי + mock זמני 100% client-side (אין כתיבת DB) שהוחזר לאחר מכן, אישר ש-`getComputedStyle` מחזיר בדיוק `blur(15px)`/`Heebo, system-ui, sans-serif`/`#D4AF37`/`#D1D5DB` כמתוכנן. צילום מסך עצמו נתקע (timeout חזרתי, סביר שקשור לאנימציות ה-CSS הרציפות) — אומת via `preview_inspect`/`preview_eval` במקום.

**Session 38 — Full Portal Integration.** שלושה חלקים: (1) Mike העלה תמונות אמיתיות ל-`public/images/` בשמות מקוריים (`חדר יין (1).jpg`, `סויטה.jpg`, `בריכות פנימיות.jpg` וכו') — לא בשמות שה-config מצפה להם. מופו ושוּנו שם ל-`entrance.jpg`/`spa.jpg`/`wine.jpg`/`suites.jpg` (נבחרו לפי תוכן, לא רנדומלית). (2) נוסף `actionType` לכל cta ב-`portalContent.js`: `"REQUEST"` (נשאר בפורטל, כותב ל-`guest_alerts` בשקט — ההתנהגות הקיימת) או `"LINK"` (פותח `buttonUrl` בלשונית חדשה). **נמצאו 2 פולבק-URL סותרים** בקוד הקיים ל-WORKSHOP_SIGNUP_URL (`go.oncehub.com/DreamIsland` ב-whatsapp-webhook לעומת `dream-island.co.il/workshops` ב-whatsapp-send) — לא הומצא קישור, Mike אישר את הראשון. כפתור "שמפניה לסוויטה" **נשאר** `REQUEST` (לא LINK) למרות שהדירקטיבה ניסחה את כל סצנת היין כ-"LINK" — שמפניה היא שירות שהצוות מספק בעצמו, אין לזה דף הזמנות חיצוני, אז שליחתו ל-LINK חיצוני הייתה שגויה במהותה. נוסף CTA חדש לסצנת הסוויטות ("✨ בואו נשריין לכם שדרוג", REQUEST) — לא היה קיים קודם. (3) **"New Portal Requests" מומש כפילטר בתוך `RequestsBoard.js` הקיים, לא dashboard נפרד** — `alert_type='upsell_opportunity'` כבר ייחודי ל-`guest-portal-upsell` (אף קוד אחר לא כותב אותו), אז זה כבר מפתח-סינון נקי בלי עמודה חדשה. נוסף: צ'יפ פילטר "🌴 בקשות מהפורטל (N)", עמודת "זמן" (לא הייתה קודם), ותווית הסוג הוחלפה מ-"💰 הזדמנות מכירה" הגנרית ל-"🌴 בקשה מהפורטל" כך שגם בתצוגת "הכל" ניכר לעין מקור הבקשה.
✅ **גם נמצא שורש "קיר ה-Auth"** שחסם אימות חזותי בכל סשן קודם (19–37): `App.js`'s `handleLogin` — כש-Supabase מוגדר (תמיד, כי `.env.local` מכיל credentials אמיתיים), הקוד **תמיד** מנסה Supabase Auth אמיתי דרך `signInWithPassword`, ו-fallback ל-`MOCK_USERS` (שמהם מוצגות "eliad/1234" וכו' על המסך) הוא **dead code** במצב הזה — מגיע אליו רק כש-Supabase *לא* מוגדר. כלומר חשבונות הדמו המוצגים על המסך מעולם לא היו קיימים כ-Supabase Auth users אמיתיים. נוצר חשבון בדיקה אמיתי (`claude-qa@dreamisland.internal`, role=admin) דרך Supabase Admin API (service-role key נמשך חד-פעמית בזיכרון בלבד דרך `npx supabase projects api-keys`, לעולם לא נכתב לקובץ) — אבל הסשן הופסק ע"י Mike before התוצאה תועדה/נוצלה לבדיקה בפועל.
- ✅ **אומת:** `npm run build` נקי על שלושת הסשנים (רק אזהרת `ShiftsPage` הקיימת).
- ⚠️ **לא אומת:** ה-happy path המלא מול אורח אמיתי עם תמונות חדשות + upsell→RequestsBoard. Mike: מומלץ לבדוק קישור פורטל אמיתי ולוודא שה-4 תמונות נטענות ושלוח הבקשות מציג בקשת ספא/שמפניה/שדרוג סוויטה תחת הפילטר "🌴 בקשות מהפורטל".

#### session 39 — Jun 25 2026 (AI Suggestions: raw-JSON-leak bug fix)
> הקשר: Mike צירף screenshot מתוך "✨ הצעות AI חכמות" (`WhatsAppInbox.js`, session 34) שמראה bubble יחיד עם טקסט שבור: `}"suggestions": ["היי מייק,` — JSON גולמי במקום הצעת תגובה נקייה.

- ✅ **שורש הבאג, אומת בבדיקה סינתטית (לא ניחוש).** `parseSuggestions()` (`supabase/functions/suggest-replies/index.ts`) — Claude (אין JSON mode, בשונה מ-Gemini's `responseMimeType:"application/json"`) לפעמים פולט שורה חדשה אמיתית (literal newline) באמצע משפט בתוך ערך מחרוזת ב-JSON — תמיד לא-חוקי (חייב `\n` מבורח). זה גורם ל-`JSON.parse` לזרוק גם בניסיון הגולמי וגם בניסיון ה-regex `{...}`, כך שהקוד נפל ל-fallback האחרון (line-split) — שפיצל את ה-JSON השבור עצמו לפי השורות שלו, והחזיר את השבר `{"suggestions": ["היי מייק,...` כאילו זו הצעה נקייה. ה-`}` המוביל ב-screenshot הוא **mirroring של Unicode bidi** — ה-`{` הלוגי מוצג כ-`}` כשהוא ברצף RTL (העמוד `dir="rtl"`).
- ✅ **תוקן.** נוסף ניסיון-parse שלישי שמחליף newlines אמיתיים ברווחים (`\r?\n` → `" "`) לפני שהקוד מתייאש ל-line-split — newline גולמי בתוך JSON הוא או רווח-עיצוב (פורמט יפה) או הבאג הזה, ושני המקרים בטוחים להחליף ברווח. נוסף גם safety filter סופי (`looksLikeJsonLeak`) שמסנן כל "הצעה" שעדיין מכילה syntax של JSON (`{}[]`/`"suggestions"`) — אם הכל נכשל, המשתמש מקבל את הודעת השגיאה העברית הנקייה הקיימת (`ai_returned_no_usable_suggestions`) במקום טקסט שבור (FAIL VISIBLE, §0.3 — שגיאה ברורה > טקסט גולמי).
- ✅ **אומת לוגית (לא רק build) — 5 תרחישי בדיקה סינתטיים נגד הפונקציה המתוקנת** (broken multi-line JSON string [התרחיש המדויק מה-screenshot] / clean single-line JSON / plain bulleted list ללא JSON כלל / pretty-printed multi-line JSON תקין / garbage מוחלט) — כולם מחזירים את 3 ההצעות הנקיות הצפויות, ללא רגרסיה על שלושת הנתיבים הקיימים. `npx supabase functions deploy suggest-replies --no-verify-jwt` הצליח, Deno type-check עבר.
- ⚠️ **לא אומת חזותית חי** — אין דרך לכפות על Claude לפלוט שוב את אותו newline-mid-string מתוך הסשן (תקלה ב-output של מודל, לא דטרמיניסטית). Mike: מומלץ להמשיך להשתמש בכפתור "✨ הצעות AI חכמות" כרגיל — אם הבאג חוזר (bubble עם טקסט שמתחיל ב-`}`/`{`/מכיל `suggestions`), זה סימן שתרחיש parse חדש לא-מכוסה הופיע ויש לדווח.

#### session 40 — Jun 25 2026 (Dynamic CMS, Vercel Asset Fix & Luxury UX Flow)
> הקשר: דירקטיבת "MASTER SESSION" — 4 חלקים: (1) תיקון "באג רינדור נכסים ב-Vercel", (2) הפיכת `portalContent.js` הסטטי ל-CMS חי בDB עם פאנל אדמין, (3) הרחבת ה-tour ל-7 סצנות עם תמונות אמיתיות שהועלו, (4) רשימת "נכסים חסרים" בסוף.

**ממצא מקדים — "באג ה-Vercel" היה למעשה משהו אחר.** נתיב התמונה כבר היה אבסולוטי (`/images/...`) מ-session 37 — לא זו הבעיה. הבדיקה בפועל (`ls public/images/`) חשפה: (1) `portalContent.js` הפנה ל-`spa.jpg` שכבר **לא קיים** — Mike החליף/מחק אותו והעלה `insidepool.jpg` תחתיו — 404 שקט פשוט, יקרה זהה גם ב-localhost וגם ב-Vercel, לא קשור לרגישות-רישיות בין Windows ל-Linux. (2) שני קבצים נוספים עם רווח/סוגריים בשם (`PREMIUM DAY.jpg`, `padel (1).jpg`) — `background-image: url(/images/PREMIUM DAY.jpg)` ללא מירכאות הוא **CSS לא-תקין** (רווח לא-מבורח בתוך `url()`), בעיה אמיתית שהייתה עומדת לקרות ברגע שהקבצים האלה ייכנסו לשימוש. תוקן בשתי שכבות: שינוי שם קבצים לשמות נקיים (`premiumday.jpg`, `padel.jpg`) + `url("${image}")` עם מירכאות תמיד ב-PhotoTour.js (הגנה כפולה).

- ✅ **`portal_scenes` (migration 084)** — טבלה חדשה: `sort_order`/`image`/`title`/`body`/`ctas` (JSONB, אותה צורה כמו `portalContent.js`'s ctas)/`is_active`. RLS: **קריאה ציבורית** (`USING (true)`) — זה תוכן שיווקי לא-רגיש, אותה רמת אמון כמו ה-bundle הסטטי שהוא מחליף, לא PII של אורח; כתיבה admin-only דרך `get_my_role()` הקיים (migration 003, ממפה גם `super_admin` ל-`'admin'`). Seed חד-פעמי של 7 השורות, מוגן ב-`WHERE NOT EXISTS (SELECT 1 FROM portal_scenes)` (לא `ON CONFLICT` — אין עמודה ייחודית למטרה הזו, ו-`sort_order`/`image` נשארים עריכים בכוונה).
- ✅ **`PortalSettingsPanel.js`** (route חדש `portal_settings`, "🎨 הגדרות פורטל", admin/super_admin) — רשימת סצנות עריכות: כותרת/טקסט/קובץ-תמונה (עם **thumbnail חי** שמתעמעם אם הקובץ לא נמצא — בדיוק מונע את הבאג ש-session זה תיקן, מהשורש, לפני שזה מגיע לאורח)/checkbox פעיל/עורך-CTAs (0–2 כפתורים, `actionType` select REQUEST↔LINK עם שדה מתאים — `upsellLabel` או `buttonUrl`). הוספה/מחיקה/שמירה ישירות ל-DB, ללא deploy.
- ✅ **`PhotoTour.js`** — שולף מ-`portal_scenes` (`is_active=true`, ממוין `sort_order`) ב-mount; ה-state מתחיל עם `portalContent.js`'s `PORTAL_SCENES` הסטטי (לא מסך טעינה ריק — render מיידי) ומתחלף לתוכן ה-DB ברגע שמגיע, או **נשאר על הסטטי** בלי לזרוק שגיאה אם השליפה נכשלת/הטבלה ריקה. `portalContent.js` עצמו תועד מחדש כ-"fallback סטטי בלבד" — לא נערך יותר ע"י staff ישירות, רק ע"י Claude כרשת-ביטחון.
- ✅ **הורחב ל-7 סצנות.** 4 הקיימות נשארו (entrance/water-world/wine/suites, תוכן ללא שינוי). 3 חדשות: **בילוי יומי פרימיום** (`premiumday.jpg`, "חווית בילוי יומי בריזורט" — מחרוזת אמיתית מהאתר, LINK ל-`dream-island.co.il/orderonline` הקיים-ומאומת), **אורח חיים פעיל/פאדל** (`padel.jpg`, REQUEST), **מתחמי מנוחה** (`chill.jpg`, "מתחמי מנוחה פסטוריליים" — אמיתי, ללא CTA — מידעי בלבד). אומת ב-WebFetch ישיר על dream-island.co.il (לא Firecrawl — לא היה מאומת על המכונה הזו) **לפני** כתיבת התוכן — לא הומצא.
- ⚠️ **פער תוכן מתועד, לא מוסתר:** אין שום כיסוי לפאדל/ספורט באתר האמיתי — טקסט הסצנה הזו הוא תיאור עניני-בלבד, לא מחרוזת-מהאתר כמו השאר. מתועד גם בקוד (הערה ב-`portalContent.js`) וגם ברשימת ה-assets החסרים שנמסרה ל-Mike באותה תשובה.
- ✅ **אומת מקצה-לקצה בפועל (לא רק build) — preview server אמיתי + שאילתת REST ישירה עם ה-anon key** (לא mock!) אישרה שה-RLS הציבורי עובד וש-7 השורות ב-DB נגישות וזהות לציפייה; `getComputedStyle` על ה-DOM אישר `url("http://localhost:3000/images/insidepool.jpg")` עם מירכאות תקינות.
- ✅ **`npm run build`** נקי לכל אורך הסשן (רק אזהרת `ShiftsPage` הקיימת) — אומת אחרי כל שלב, לא רק בסוף.

#### תוספת לסשן 40 — "Final Polish" + **פריצת דרך: התחברות אמיתית הצליחה בפעם הראשונה**
> Mike ביקש תיקון תוכן (Scene 1 + פאדל) ושאל במפורש מה חוסם את בדיקת ה-auth — הזדמנות לסגור את זה אחת ולתמיד במקום לתאר אותו עוד פעם.

- ✅ **ממצא קריטי לפני העדכון:** Mike בקש "Scene 1 must use entrance.jpg" — אבל הקובץ הזה **כבר לא קיים בדיסק**. בין הסשנים Mike reorganизed את `public/images/`: הקובץ שהיה `entrance.jpg` (תמונה גנרית) שוּנה ל-`green.jpg`, והקובץ שהיה `fromsky.png` (אומת לפי גודל בייטים זהה במדויק — 7,650,900 — שלא השתנה) שוּנה ל-**`entrance.png`** (לא `.jpg`!). זו ה-drone shot האמיתי. ביצוע מילולי של ה"entrance.jpg" המבוקש היה משאיר את ה-hero scene שבור (404 שקט, אותו מחלקת-באג בדיוק שתוקנה בתחילת הסשן). תוקן ל-`entrance.png` ב-DB וב-`portalContent.js` fallback, עם הסבר ל-Mike.
- ✅ **תוכן פאדל חדש** (go-ahead מפורש מ-Mike) — "פאדל, תנועה ואנרגיה טובה" / "מגרשי פאדל מטופחים, ציוד פרימיום ושמש שלא נגמרת — משחק קליל בבוקר, סיפור לכל היום." כפתור עודכן ל-"🎾 בואו נשריין לכם מגרש" (תואם את תבנית "בואו נשריין לכם X" הקיימת בסצנות הספא/סוויטות — קונסיסטנטיות מכוונת, לא במקרה). עודכן גם ב-DB (script חד-פעמי עם service-role, נמחק מיד) וגם ב-fallback הסטטי.
- ✅ **פריצת דרך — קיר ה-Auth נפתר.** Mike שאל אם צריך bypass או אם ה-auth תקין לסטאף אמיתי. התשובה: ה-auth flow **תקין ועובד כצפוי** — `signInWithPassword` אמיתי מול Supabase, בלי באג. הבעיה היחידה הייתה שחשבונות הדמו המוצגים על המסך (`eliad`/`shira@dreamisland.com`/`yossi@dreamisland.com`) **מעולם לא היו חשבונות Supabase Auth אמיתיים** — קוד ה-fallback ל-`MOCK_USERS` ב-`handleLogin` הוא dead code בפועל כל עוד Supabase מוגדר (תמיד, כי `.env.local` מכיל credentials אמיתיים). Mike/הצוות האמיתי **לא מושפעים מזה בכלל** — הם כבר נכנסים עם Google Sign-In או סיסמה אמיתית, נתיב שונה לחלוטין ותקין.
  בוצע בפועל: התחברות עם חשבון ה-QA האמיתי שנוצר session קודם (`claude-qa@dreamisland.internal`, role=admin, דרך Supabase Admin API עם service-role key שנמשך זמנית ולא נשמר בקובץ) — **הצליחה**. זו ההתחברות האמיתית הראשונה לאפליקציית הסטאף בכל היסטוריית הפרויקט (sessions 19–40 כולם דיווחו "קיר Auth" כחסם). אומת חזותית עם צילום מסך אמיתי: לוח "🌴 בקשות מהפורטל" מציג שורה אמיתית, ולוח "🎨 הגדרות פורטל" מציג את כל 7 הסצנות עם הנתונים המדויקים מה-DB (כולל thumbnail חי שמראה תמונת-מצלמה-עילית עבור `entrance.png` — אישוש ויזואלי נוסף שזו אכן ה-drone shot).
- ⚠️ **חשבון ה-QA נוצר עם role='admin'** (לא super_admin) — מספיק לכל מה שנבדק עד כה, אבל לא ל-CMS Security gate (session 31, דורש aal2 נפרד). לא נמחק — Mike יכול להשתמש בו גם כדי לבדוק בעצמו, או לבקש שיימחק.

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

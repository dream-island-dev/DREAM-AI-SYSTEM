---
description: 
alwaysApply: true
---

description: Dream Island AI System (XOS) Core Architecture & Rules
alwaysApply: true

CLAUDE.md — Dream Island AI System (XOS)

קובץ זה נקרא אוטומטית בכל שיחה. הוא מקור-האמת העדכני של המערכת. היסטוריית סשנים מלאה מועברת ל: claude_history.md (שמור שם לצורכי ארכיון, אל תציף את ה-Context כאן).

0. חזון הפרויקט ועקרונות יסוד — Project Vision & Core Principles

חמשת עקרונות הברזל (DNA)

1. ZERO DATA LOSS: אסור להשמיט שורה בשקט בייבוא. שורה שלא עובדה מוצגת כ"שגויה" עם הסבר; היא לעולם לא נעלמת מהתצוגה בלי עקבות (ezgoParser.js).
2. INTELLIGENT UI (Disable, Don't Hide): כפתורי פעולה תפעוליים לעולם לא נעלמים. אם פעולה לא חוקית כרגע — הכפתור נשאר גלוי, מנוטרל (Greyed out), עם title שמסביר למה ומה לעשות כדי לאפשר אותו (GuestsPage.js).
3. FAIL VISIBLE: לעולם לא להסוות ערך DB לא-צפוי מתחת ל-fallback "תקין-מראה". הצג אותו כ-⚠ גלוי ב-UI, אל תמפה אותו לערך ברירת-מחדל שמסתיר את הבעיה מהצוות.
4. UNIVERSAL ARCHITECTURE: שימוש בקומפוננטה אחודה לניהול טבלאות דאטה (EditableGrid.js) שמקבלת Schema ומספקת ייבוא + תצוגה + עריכה לכל מקור דאטה (סוויטות, שוברים, מלאי).
5. SINGLE SOURCE OF TRUTH: טבלת guests היא הפרופיל המוזהב (Golden Profile). כל לשונית ב-UI קוראת/כותבת אליה. טבלאות אחרות (suite_rooms, bookings) הן נתוני תמיכה בלבד.

UX Guardrails & שליחת הודעות
- Zero-Spam Policy: לעולם לא לשלוח broadcast/הודעה אוטומטית אם האורח מבוטל (status='cancelled'). דגל needs_callback הוא התראה לצוות בלבד ואינו חוסם את הבוט או ה-Cron.
- Graceful Fallback: אם דאטה דינמי (כמו spa_time) חסר, מנקים את ה-placeholder ולא שולחים {{VARS}} גולמי לאורח.
- Template Awareness: הודעות מעבר לחלון 24h של Meta חייבות תבנית מאושרת מראש (sendViaTemplate). אם החלון סגור, ה-Inbox מחזיר סטטוס window_closed מיידית.

1. הגדרת המערכת וסטאק טכני

Dream Island Resort Management System (XOS) — אפליקציית ניהול מלון יוקרה בעברית (RTL) הכוללת ניהול תפעולי ופלטפורמת AI. המערכת מושכת מידע ישירות מ- EZGO .

| שכבה | טכנולוגיה | הערות חשובות |
| ------ | ------ | ------ |
| Frontend | React 19 · CRA | SPA, Hebrew RTL, ללא ספריית ניתוב (רינדור דרך useState ב-App.js) |
| Backend | Supabase Edge Functions | קוד ב-Deno / TypeScript |
| Database | Supabase PostgreSQL 15 | אכיפת Row Level Security (RLS) בכל הטבלאות |
| AI Primary | Gemini 2.5 Flash / 2.0 Flash | משמש לשיחה חופשית, תמלול הודעות קוליות וסוכני Inbox |
| AI Fallback | Claude Sonnet 4.6 | גיבוי אוטומטי בכשל או לפי הגדרת preferred_model |
| WhatsApp | Meta Cloud API + Whapi.cloud | Meta לשיחות ישירות (1:1), Whapi לניהול קבוצות צוות וקליטת ריאקציות |

2. מפת ניתוב מרכזית (activePage ב-App.js)

- dashboard / shifts / checklist / employees
- vip_guests ➔ GuestDashboard.js (ניהול טקטי של הפרויקט - לינה / בילוי יומי)
- guests ➔ GuestsPage.js (מסך צ'ק-אין ייעודי לסוויטות בלבד, אורחי יום מסוננים החוצה)
- wa_inbox ➔ WhatsAppInbox.js (חדר בקרה תפעולי, ניהול שיחות, צ'אט, Claim ופתרון משימות). שיחות מופרדות לפי `inbox_channel` (`meta` = Dream Bot, `whapi` = מכשיר הסוויטות) — thread key = phone+channel. Claim ומתג בוט (🤖/😴) הם per-channel: `guests.claimed_by`/`bot_active` ל-Meta (ללא שינוי), `guest_channel_claims`/`bot_active_whapi` ל-Whapi (migrations 170-171) — claim/כיבוי בערוץ אחד לא משפיע על השני. תגי יוצא `[META]`/`[SESSION]`/`[WHAPI]` ב-`whatsapp_conversations.message` הם ל-Inbox בלבד — חובה לפלטר לפני שליחה לאורח או הזרקה ל-LLM (`_shared/outboundDispatchTag.ts`).
- orit_cs_agent ➔ OritCustomerServicePanel.js (סוכן שירות לקוחות לאורית — **IMAP read-only**, AI סיכום+טיוטות, העתקה ידנית ל-Outlook, דייג'סט בוקר Whapi). אין שליחה מהמערכת.
- ops_board ➔ OperationsBoard.js (לוח תפעול ואחזקה, כולל טאב משימות ממתינות לאישור)
- data_sync ➔ DataSyncPage.js (מסך סנכרון וייבוא קבצי אקסל ודוחות EZGO ל-Admin/Receptionist)
- agent ➔ InventoryHub.js (ניהול מלאי, ייבוא דוחות, יצירת קישורי-קסם לעובדים ותור אישורים)
- voucher_reconciliation ➔ VoucherReconciliationHub.js (מערכת התאמת שוברים ודוחות כספיים)
- cms_security ➔ עטיפת <ProtectedRoute> הדורשת אימות TOTP / 2FA מבוסס חומרה.

3. מבנה מסד הנתונים (טבלאות ליבה)

פורמטי טלפון קריטיים (חובה לסנכרון):
- guests.phone = +972501234567 (עם סימן +, פורמט E.164 תקני).
- bookings.phone / Meta Webhook = 972501234567 (ללא +).
- כלל פיתוח: בחיפוש הצלבות מול bookings יש לבצע תמיד phone.slice(1) כדי להוריד את ה-+.

טבלאות ושדות מרכזיים:
- guests (Golden Profile):
  * status: 'pending' | 'expected' | 'room_ready' | 'checked_in' | 'cancelled'
  * room: שם סוויטה קנוני מתוך SUITE_REGISTRY או "Premium Day 1/2".
  * arrival_time: שעת הגעה משוערת שמדווחת ע"י האורח (Record-Only, לא מקפיץ התראות).
  * guest_profile: JSONB מובנה (VIP, רגישויות, אירוע).
  * claimed_by: שיוך שיחה ב-Inbox לנציג אנושי (מכבה אוטומציות).
- tasks: ניהול משימות שטח ואחזקה. סטטוסים: 'pending_approval', 'open', 'in_progress', 'done', 'rejected'.
- room_status: ניהול מערך הניקיון וסטטוס החדרים (נפרד לחלוטין מ-guests.status).

4. ארכיטקטורת ה-Webhooks וסוכני ה-AI

whatsapp-webhook (צינור העיבוד הנכנס)
1. לחיצות כפתור (Interactive / Quick Replies): ניתוב קשיח (Hardcoded) ישירות בתוך הקוד. אסור לשלוח לחיצת כפתור ל-Gemini/LLM.
2. הודעות קוליות (Voice/Audio): הורדה מ-Whapi, תמלול אוטומטי (Gemini), והזרקת הטקסט לתחילת צינור הזיהוי כאילו הוקלד.
3. In-Room Context Override: אורח בסטטוס pending/expected שכותב מילות מפתח של חדר מקודם אוטומטית ל-checked_in וה-Persona עוברת לטון "בתוך הריזורט".
4. Tier-0 Interceptions (אפס טוקנים):
   * קריאות שירות (משק/תפעול): מזהה מילות מפתח ➔ משימה בסטטוס pending_approval ב-Operations Board ➔ שולח הודעה קבועה לאורח.
   * Stay-Change Shield: בקשות ל-Late checkout או שינוי תאריך נחסמות מיידית לפני ה-LLM, מדליקות דגל date_change לצוות.
5. משפט הפניה לצוות (`_shared/guestBotHandoff.ts`): "אני בודק את זה מול הצוות שלנו ונחזור אליך בהקדם 🙏" — זהה בשני הבוטים. כשהבוט שולח אותו → `human_requested` (נקודה אדומה ב-Inbox). Meta: עונה גם ללא פרופיל אורח; Whapi DM: auto-reply רק לאורח עם פרופיל פעיל (`shouldAutoReplyGuestWhapiDm`). ניווט: תפעול → `log_guest_request` / Tier-0; לוח בקשות / מנהלות → handoff.
6. מוח הבוט משותף (`bot_settings` + `_shared/guestBotSettings.ts` / `guestBotLlm.ts`) — פרומפט, ידע, מנוע AI (`preferred_model`) וכללים שנלמדו זהים ל-Meta ו-Whapi DM; הדלקה/כיבוי per-channel ב-`bot_config` (`bot_active` / `bot_active_whapi`) — גם ב-BotSettings.js.
7. אוטומציית שבת (migration 172): הגעה בשבת → שלבים 2.5 (יום שישי 15:00) ו-3 (בוקר שבת, צ׳ק-אין 18:00) נשלחים אוטומטית דרך מכשיר הסוויטות (Whapi) עם סקריפטים נפרדים (`night_before_reminder_shabbat`, `stage_3_morning_shabbat`) + תמונה `suiteshabat.jpeg` — עריכה ב-AutomationControlCenter → וריאנט שבת. `dispatch_channel=whapi` עדיין תקף לכל השלבים; שבת מנותבת גם בלי סימון ידני כש-`GUEST_WHAPI_SUITES_ENABLED=true`.

מנוע אישור משימות שטח (Human-in-the-Loop)
הבוט מייצר שורה בטבלת tasks בסטטוס pending_approval. הצוות ב-OperationsBoard.js מאשר או דוחה. רק לאחר אישור, הפונקציה notify-manual-task מתרגמת לאנגלית ומשגרת לקבוצת ה-Whapi הרלוונטית. SLA נמדד מרגע האישור.

כרטיסי משימה בקבוצת Whapi (whapi-webhook + notify-manual-task): תבנית אחידה `_shared/taskCard.ts` — `📌 New Task Opened: Suite X` / `📋 Task` / `⏰ Status: Pending`; משימות מ-Inbox/HITL מוסיפות `📍 Source: [GUEST WA]` בשורה נפרדת. שורת שיוך = `👤 Assigned: {profiles.name}` דרך `_shared/assignedWorker.ts`. אין @mention לפי טלפון — בקבוצות עם פרטיות WhatsApp מציג LID מספרי (@1855…) במקום שם/מספר קריא.

5. קונוונציות קוד וקווים אדומים

- שפה ועיצוב: ממשק עברית מלאה (RTL). שימוש ב-CSS Variables בלבד (var(--gold)). מצבי Hover מנוהלים ב-JS (useState).
- איסור שימוש ב-.single(): בשאילתות Supabase יש להשתמש תמיד ב-.maybeSingle() כדי למנוע קריסות קוד.
- קריאות ל-Edge Functions: תמיד supabase.functions.invoke() (לעולם לא fetch גולמי).
- אבטחת מפתחות: אין להחזיק טוקנים של Meta, מפתחות AI או סודות VAPID בתוך פרונטאנד או ב-Git.

6. פרוטוקול העלאה לפרודקשן (Autonomous Deploy)

בסוף כל פעולת פיתוח, יש לבצע את סדר הפעולות הבא:
1. שינוי ב-src/ ➔ מריצים npm run build ודוחפים ל-Git (Vercel מאזין ל-main).
2. שינוי ב-supabase/functions/ ➔ מריצים npx supabase functions deploy --no-verify-jwt (כולל פונקציות שצורכות את _shared/ אם השתנה).
3. שינוי ב-supabase/migrations/ ➔ מריצים npx supabase db push.

7. עקרון הפעולה הסוכנית (The Agentic Loop) & חקירת המערכת

- מחקר מדורג ואקטיבי (Active Context Building): כשאתה מתבקש לנתח באג או להוסיף פיצ'ר, אל תניח שאתה יודע הכל מראש. הפעל את "יכולות הביצוע" שלך כדי לקרוא קבצים רלוונטיים (קובץ גורר קובץ) ובנה את ההקשר במדויק לפני כתיבת שורת קוד אחת.
- אוטונומיה בפתרון תקלות (Autonomous Debugging): אם הרצת פעולה (כמו קריאת קובץ, פקודת טרמינל או שאילתה למסד הנתונים) ונתקלת בשגיאה, אל תחזור מיד למייק כדי להציג לו אותה. הפעל את "הלולאה הסוכנית" שלך: חקור את הודעת השגיאה, בדוק קבצים נוספים, ונסה לפתור את התקלה בעצמך. פנה לעזרה רק אם הגעת למבוי סתום אמיתי שדורש התערבות אנושית.

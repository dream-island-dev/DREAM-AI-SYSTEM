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
| WhatsApp | Meta Cloud API + Whapi.cloud | Meta לשיחות ישירות (1:1), Whapi לניהול קבוצות צוות וקליטת ריאקציות. אורחי סוויטות: כל ה-outbound (כולל אוטומציית Stage 1+) דרך מכשיר הסוויטות כש-`GUEST_WHAPI_SUITES_ENABLED`. Stage 1 שפספס מועד T-2 (ייבוא מאוחר) מופיע בתור חי כ-`missed_window` לשיגור ידני/מכה — לא נעלם כ-`date_passed`. קבוצת «בקשות אורחים» (`guestAlertWhapiNotify`): כרטיס בעברית + לינקים ל-Inbox/לוח בקשות — בלי תרגום HE→EN (זה לקבוצות תפעול שדה בלבד). |

2. מפת ניתוב מרכזית (activePage ב-App.js)

- dashboard / shifts / checklist / employees
- vip_guests ➔ GuestDashboard.js (ניהול טקטי של הפרויקט - לינה / בילוי יומי)
- guests ➔ GuestsPage.js (מסך צ'ק-אין ייעודי לסוויטות בלבד, אורחי יום מסוננים החוצה). כולל «לוח זמני הגעה — היום» — מיון לפי `arrival_time`, ⚠ למי שעדיין לא מסר שעה.
- wa_inbox ➔ WhatsAppInbox.js (חדר בקרה תפעולי, ניהול שיחות, צ'אט, Claim ופתרון משימות). שיחות מופרדות לפי `inbox_channel` (`meta` = Dream Bot, `whapi` = מכשיר הסוויטות) — thread key = phone+channel. Claim ומתג בוט (🤖/😴) הם per-channel: `guests.claimed_by`/`bot_active` ל-Meta (ללא שינוי), `guest_channel_claims`/`bot_active_whapi` ל-Whapi (migrations 170-171) — claim/כיבוי בערוץ אחד לא משפיע על השני. **חובה:** סנכרון מפת אורחים ב-Inbox לעולם לא מעתיק `guests.claimed_by` לשיחת Whapi (רק `guest_channel_claims`); לפני stub ב-claim Whapi — חיפוש אורח קיים לפי טלפון. Unread = `inbox_read_cursors` per staff+phone+channel (migration 181); כפתור «נקרא» / פתיחת שיחה מעדכנים `last_read_at`. תגי יוצא `[META]`/`[SESSION]`/`[WHAPI]` ב-`whatsapp_conversations.message` הם ל-Inbox בלבד — חובה לפלטר לפני שליחה לאורח או הזרקה ל-LLM (`_shared/outboundDispatchTag.ts`).
- orit_cs_agent ➔ OritCustomerServicePanel.js (סוכן שירות לקוחות לאורית — **IMAP read-only**, AI סיכום+טיוטות, העתקה ידנית ל-Outlook, דייג'סט בוקר Whapi). אין שליחה מהמערכת.
- ops_board ➔ OperationsBoard.js (לוח תפעול ואחזקה, כולל טאב משימות ממתינות לאישור)
- data_sync ➔ DataSyncPage.js (מסך סנכרון וייבוא קבצי אקסל ודוחות EZGO ל-Admin/Receptionist). כולל ייבוא דוח פעילויות ספא (עברי או CSV אנגלי מ-EZGO) דרך אותו `ActivitiesImportZone` כמו לוח הספא.
- spa_board ➔ SpaBoard.js (לוח ספא חכם — אג׳נדה/חדרים, ייבוא פעילויות EZGO → `spa_appointments` + write-through ל-`guests.spa_date`/`spa_time`. חדר זוגי = עד 2 תורים חופפים, מטפל לכל שורה. `iLineStatus=0` מדולג.)
- agent ➔ InventoryHub.js (ניהול מלאי, ייבוא דוחות, יצירת קישורי-קסם לעובדים ותור אישורים)
- voucher_reconciliation ➔ VoucherReconciliationHub.js (מערכת התאמת שוברים ודוחות כספיים)
- executive_playbook ➔ ExecutivePlaybook.js (כללים שנלמדו + יומן פעולות ל-Executive Voice Assistant)
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
  * arrival_time: שעת הגעה משוערת שמדווחת ע"י האורח. נשמר ב-guests + שורת `guest_alerts` עם `alert_type='arrival_eta'` (תווית «🕐 שעת הגעה» בלוח בקשות). בלי needs_callback / משימות תפעול / נקודה אדומה. פרופיל חכם מציג «🕐 שעת הגעה HH:MM».
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
6. מוח הבוט משותף (`bot_settings` + `_shared/guestBotSettings.ts` / `guestBotLlm.ts`) — פרומפט, ידע, מנוע AI (`preferred_model`) וכללים שנלמדו זהים ל-Meta ו-Whapi DM; הדלקה/כיבוי per-channel ב-`bot_config` (`bot_active` / `bot_active_whapi`) — גם ב-BotSettings.js. **Firewall יוצא:** `_shared/guestBotSanitize.ts` (`sanitizeGuestBotReply` / `looksLikePromptLeak`) — חובה לפני שליחה לאורח בשני הערוצים; דליפת הנחיות → ריק → משפט הפניה / empty-guard.
7. אוטומציית שבת (migration 172): הגעה בשבת → שלבים 2.5 (יום שישי 15:00) ו-3 (בוקר שבת, צ׳ק-אין 18:00) נשלחים אוטומטית דרך מכשיר הסוויטות (Whapi) עם סקריפטים נפרדים (`night_before_reminder_shabbat`, `stage_3_morning_shabbat`) + תמונה `suiteshabat.jpeg` — עריכה ב-AutomationControlCenter → וריאנט שבת. `dispatch_channel=whapi` עדיין תקף לכל השלבים; שבת מנותבת גם בלי סימון ידני כש-`GUEST_WHAPI_SUITES_ENABLED=true`.
8. Executive Voice Assistant (Eliad Co-Pilot, `_shared/executiveIdentity.ts` + `_shared/executiveAssistant.ts`, נקרא מ-whapi-webhook לפני handleGuestDirectMessage): מורשים אליעד (מנכ"ל) ומייק (ארכיטקט מערכת, QA) — `KNOWN_EXECUTIVES` בקוד + fallback ל-`EXECUTIVE_PHONES`/`EXECUTIVE_PHONE` (env) ול-`profiles.phone` (migration 175 אליעד, migration 182 מייק). שליחת תשובה: `deliverExecutiveDmReply` מעדיף `chat_id` של ה-DM, retry + fallback לטלפון, FAIL VISIBLE באינבוקס אם השליחה נכשלה; retry של Whapi אחרי webhook איטי (`claimed:false`) מריץ שוב את העוזרת רק אם אין עדיין outbound עם `wa_message_id`. ExecutivePlaybook.js מציג כללים שנלמדו + יומן פעולות.
   כלים (14): מצב ריזורט/דוח מיידי (`get_resort_brief`/`get_ops_digest_now` — האחרון read-only, לא כותב `resort_digest_log`), איתור/רשימת אורחים, לוח הבקשות (`list_guest_alerts`), מצב חדרים תפעולי (`get_room_status`, טבלת `room_status` — נפרד מ-`guests.status`), משימות (`create_executive_task`/`query_open_tasks`/`update_task_status` — אישור משימה ממתינה עובר תמיד דרך `notify-manual-task`, לא flip ישיר; התאמה לא חד-משמעית = רשימת מועמדים, לא ניחוש), `set_guest_status` (**room_ready בלבד**, סוויטות בלבד, דרך אותו `whatsapp-send trigger:"room_ready"` שכפתור הקבלה משתמש בו — אין כלי קולי לצ'ק-אין/ביטול/שינוי תאריכים, הפרסונה מסרבת ומפנה למסך הניהול), שליחת הודעה לאורח/למנהלות, `ceo_guest_override`, `learn_executive_rule`. סבב כלים מותנה עד 3 (סבבים 1-2 עם כלים, סבב 3 בלי — כופה תשובה סופית אחרי שרשרת find→act; המקרה הרגיל עדיין 1-2 סבבים). כללים שנלמדו (`xos_ai_rules module='executive'`) מסוננים לפי `owner_phone` (migration 188) — `NULL` = משותף (כל כלל שנלמד לפני 188), אחרת פרטי למספר שלמד אותו; מונע דליפת כללי QA של מייק להתנהגות מול אליעד. תוכן הדוח התפעולי (`get_ops_digest_now`/`resort-digest-cron`) נשאר במתכוון לא מסונן — דוח אחד, נמען אחד, בלי קשר למי לימד את הכלל.

מנוע אישור משימות שטח (Human-in-the-Loop)
הבוט מייצר שורה בטבלת tasks בסטטוס pending_approval. הצוות ב-OperationsBoard.js מאשר או דוחה. רק לאחר אישור, הפונקציה notify-manual-task מתרגמת לאנגלית ומשגרת לקבוצת ה-Whapi הרלוונטית. SLA נמדד מרגע האישור.
Failsafe (Hybrid unanswered escalation, `_shared/handoffEscalation.ts` + `sla-escalation-cron`): אם קבלת לא אישרה תוך 7 דק׳ — ה-cron קורא לאותו `notify-manual-task` (auto-approve + שיגור לתפעול) ומעדכן את מייק/אליעד/אדיר ב-Whapi DM. בקשות רכות (ספא / שינוי תאריך / כספים / staff_handoff) לא פותחות קריאת שטח — אחרי 20 דק׳ רק פינג לקבלה (`SLA_GUEST_ALERT_PHONE`) עם `whatsapp_conversations.handoff_escalated_at` (migration 186). דורש `SLA_ESCALATION_ENABLED=true`.

כרטיסי משימה בקבוצת Whapi (whapi-webhook + notify-manual-task): תבנית אחידה `_shared/taskCard.ts` — `📌 New Task Opened: Suite X` / `📋 Task` / `⏰ Status: Pending`; תג מקור בשורה נפרדת: `guest_request` (בוט/פורטל HITL) → `[BOT]`, `inbox_routed` (ניתוב ידני מתיבה) → `[GUEST WA]`, `manual` → `[MANUAL TASK]`. אין שורת `👤 Assigned` בכרטיס (lookup לפי מחלקה היה best-effort ומטעה). בלוח: `guest_request` = «🤖 בוט · בקשת אורח».

5. קונוונציות קוד וקווים אדומים

- שפה ועיצוב: ממשק עברית מלאה (RTL). שימוש ב-CSS Variables בלבד (var(--gold)). מצבי Hover מנוהלים ב-JS (useState).
- איסור שימוש ב-.single(): בשאילתות Supabase יש להשתמש תמיד ב-.maybeSingle() כדי למנוע קריסות קוד.
- קריאות ל-Edge Functions: תמיד supabase.functions.invoke() (לעולם לא fetch גולמי).
- אבטחת מפתחות: אין להחזיק טוקנים של Meta, מפתחות AI או סודות VAPID בתוך פרונטאנד או ב-Git.
- Whapi outbound (`_shared/whapiSend.ts`): timeout 45s → `timeout_no_response` (סטטוס `timeout`, לא `failed`). Inbox מציג «לא ודאי אם הגיע» — בלי fallback אוטומטי ל-Meta (סיכון כפילות).

6. פרוטוקול העלאה לפרודקשן (Autonomous Deploy)

בסוף כל פעולת פיתוח, יש לבצע את סדר הפעולות הבא:
1. שינוי ב-src/ ➔ מריצים npm run build ודוחפים ל-Git (Vercel מאזין ל-main).
2. שינוי ב-supabase/functions/ ➔ מריצים npx supabase functions deploy --no-verify-jwt (כולל פונקציות שצורכות את _shared/ אם השתנה).
3. שינוי ב-supabase/migrations/ ➔ מריצים npx supabase db push.

7. עקרון הפעולה הסוכנית (The Agentic Loop) & חקירת המערכת

- מחקר מדורג ואקטיבי (Active Context Building): כשאתה מתבקש לנתח באג או להוסיף פיצ'ר, אל תניח שאתה יודע הכל מראש. הפעל את "יכולות הביצוע" שלך כדי לקרוא קבצים רלוונטיים (קובץ גורר קובץ) ובנה את ההקשר במדויק לפני כתיבת שורת קוד אחת.
- אוטונומיה בפתרון תקלות (Autonomous Debugging): אם הרצת פעולה (כמו קריאת קובץ, פקודת טרמינל או שאילתה למסד הנתונים) ונתקלת בשגיאה, אל תחזור מיד למייק כדי להציג לו אותה. הפעל את "הלולאה הסוכנית" שלך: חקור את הודעת השגיאה, בדוק קבצים נוספים, ונסה לפתור את התקלה בעצמך. פנה לעזרה רק אם הגעת למבוי סתום אמיתי שדורש התערבות אנושית.

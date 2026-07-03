---
description: 
alwaysApply: true
---

# CLAUDE.md — Dream Island AI System
> קובץ זה נקרא אוטומטית בכל שיחה. הוא מקור-האמת שלך. קרא אותו לפני כל פעולה.
> **עדכון אחרון:** 2026-07-03 (session 95 — **מקומי, לא deployed:** Stage 2 Pay placeholder-leak fix (split-brain bug) — `resolvePaymentPlaceholders()` (`whatsapp-webhook`) טיפל רק ב-GUEST_NAME/PAYMENT_AMOUNT/PAYMENT_LINK/WORKSHOP_URL/SPA_LINE, בלי `{{SPA_TIME}}`/`{{OPTIONAL_SPA_TEXT}}`/`{{PORTAL_LINK}}`/`{{portal_url}}` (שכן כן מטופלים ב-`resolvePlaceholders()` הרגיל של stage_2_arrival) — נוסף טיפול זהה + `payPortalLink` הוזרק לקריאה. בנוסף: `sendCtaUrlButton`/`sendInteractiveButtons` (`_shared/interactiveSend.ts`) היו שתי פונקציות השליחה היחידות שדילגו על ה-Output Leakage Wall (`sanitizeReply()`'s final `{{...}}` strip, session 88 §Layer 4) — POST-ו bodyText גולמי ישירות ל-Meta ללא שום ניקוי. נוסף `_stripUnresolvedPlaceholders()` (מקומי לקובץ, כמו `_isAbortError`) בשתיהן. `sendStage2PayReply()` עכשיו מריץ `sanitizeReply(paymentReply)` פעם אחת ל-`finalPaymentReply` יחיד שמוזרק גם ל-Meta send (`sendCtaUrlButton`/`sendReply`) וגם ל-`whatsapp_conversations` log — אותה מחרוזת בדיוק לשני הצדדים, לא עוד עותק לא-מסונן ללוג ועותק אחר לשליחה בפועל. `_shared/interactiveSend.ts` משותף גם ל-`whatsapp-send`+`staff-ops-webhook` — דורש redeploy לשלושתם. ראה §10 session 95.) (session 94 — **מקומי, לא deployed:** Guest 360° Context Drawer — `GuestContextDrawer.js` + לחיצה על שם/אווטאר ב-`WhatsAppInbox` roster; migration 123 `staff_color_label`+`internal_notes`; השתקת בוט/אוטומציה, 5 משימות אחרונות; `npm run build` נקי.) (session 93 — **deployed d2dbaec:** Saturday session-script override — `applySaturdayCheckInTimeOverride()` ב-`whatsapp-send`: כש-`usedSessionMessage` ו-`arrival_date` בשבת (`getUTCDay()===6`), מחליף `15:00`→`18:00` ב-`bot_scripts.message_text` אחרי placeholders, בלי עריכת DB.) (session 92 — **מקומי, לא deployed:** Dispatch transparency — `whatsapp-send` לוג inbox מדויק `[META]`/`[SESSION]`+footer כפתורים; fallback body מ-`message_templates`/`TEMPLATE_BODY_APPROVED` (לא bot_scripts); Whapi admin alert על `failed`/`blocked_by_meta` (`ADMIN_PHONE_NUMBER`→`SLA_GUEST_ALERT_PHONE`→972546294885); `WhatsAppInbox.js` 🔵/🟢+`[+ Interactive Buttons]` בבועות יוצאות.) (session 91b — **מקומי, לא deployed:** בקשת בלונים לחדר — `isBalloonRoomRequest`/`buildBalloonRoomRequestReply` ב-`automationSchedule.ts`; Tier-0 intercept ב-`whatsapp-webhook` → `guest_alerts` בלבד (לא tasks/Whapi תפעול); תשובה קבועה «הקבלה תעביר פרטים לנציגת הבלונים»; secret אופציונלי `BALLOON_VENDOR_PHONE` ל-heads-up Whapi.) (session 91 — **deployed 8c6d33d:** Sidebar nav — «לוח בקשות» מתחת לצ'קליסטים מעל תפעול ואחזקה.) (session 90 — **deployed 8279bf6:** Operations Channel EN translation-layer gap closure — `translateTextForFieldOps`/`containsHebrew` (`_shared/fieldOpsTranslation.ts`, כבר קיים) חוברו לשלוש נקודות דיספאץ' לקבוצת "קריאות" שעד כה שלחו `tasks.description` גולמי: `whapi-webhook`'s `buildTaskCard` (Tier-0 regex), `sla-escalation-cron`'s ops-group SLA breach card, `task-action`'s Bump+Accept/Complete echo. `tasks.description` ב-DB לא נגוע — תרגום לכרטיס Whapi בלבד. `guest-portal-ops-request` (ערוץ "requests" נפרד) נבדק ונשאר ללא שינוי בכוונה. ראה §10 session 90.) (session 89 — **מקומי, לא deployed:** Staff-claim mute sync — `refreshStaffClaimMuteFromDb` אחרי burst 1.8s + early exit; `insertGuestOutboundIfNotMuted` (אין ghost ב-Inbox); `checkEligibility`+`whatsapp-send`+`whatsapp-cron` חוסמים cron כש-`claimed_by` פעיל; `WhatsAppInbox.setClaim` FAIL VISIBLE על 0 שורות; `npm run build` נקי.) (session 88 — **מקומי, לא deployed:** Webhook Defensive Shield audit — בוצע audit מלא של `whatsapp-webhook` מול blueprint 4 שכבות (Staff Override / Defensive Shield / Hard-coded Interceptions / Output Leakage Wall). Layers 1+3+4 נמצאו **כבר ממומשים** (claimed_by mute, severe-complaint kill-switch, sensitive stay/financial shields, operational/administrative intercepts, hard-drop guard) — תועדו כאן לראשונה כי היו committed בלי כניסה בהיסטוריית הסשנים. נוסף Layer 2 בפועל: `isLowValueCourtesyMessage()` (`automationSchedule.ts`) — הודעת אמוג'י-בלבד/מילת-נימוס בודדת (תודה/הבנתי/סגור/היי/אוקי) → `handleCourtesyAck` יוצא בשקט, בלי fallback script, גם pre-burst וגם post-burst. `LOW_CONFIDENCE_HANDOFF_SENTENCE` חולצה לקבוע יחיד ומוזרקת לשני מקורות הפרומפט; כש-`reply` מה-LLM שווה למשפט הזה (=המודל הודה שאינו יודע) — נכתב `requires_attention`+`attention_reason='שאלה מורכבת לצוות'` והשליחה לאורח **מדולגת** (staff לוקח את זה מהבדג' האדום, לא הודעת "אני בודק" חוזרת). `GuestAttentionBadge.js` קיבל אייקון 🤔 לסיבה החדשה. `npm run build` נקי. ראה §10 session 88.) (session 87 — **מקומי, לא deployed:** `suiteCheckinSync.js` — סנכרון צ'ק-אין `guests.checked_in`↔`room_status.תפוס`; `GuestsPage`+`RoomBoard`+`AICopilot`; אישור+שליחה→`room_ready` בלבד; «צ'ק-אין בלי הודעה»+«סגור שער» במקום «התעלם».) (session 86 — **deployed 8abed52:** AICopilot stale «ממתין לאישור» — סינון `room_ready_notified`/`msg_room_ready_sent`; ניקוי room_status→פנוי; `whatsapp-send` `clearPendingRoomApprovalGate` אחרי room_ready.)(session 84c — **deployed 5e043d1:** Live staff tracking — migration 120 `staff_members`+`room_status.current_*_name`; `AdminPanel.js` טאב «צוות ניקיון»; `HousekeepingTabletView.js` picker+תוויות חיות.)(session 84b — **deployed 5e043d1:** `room_ready_notified` migration 119 + idempotency guard.)(session 84 — **deployed 8535cfe:** Jacuzzi ping-pong workflow — `HousekeepingTabletView.js` סטטוסים `ממתין לג'קוזי`/`מוכן לפיניש`, כפתור «קרא לג'קוזי» בבניקיון, auto-handoff בג'קוזי נקי, «סיימתי פיניש»→ממתין לאישור+push; `RoomBoard.js` FAIL VISIBLE; migration 118.)(session 83 — **מקומי, לא deployed:** `ArrivalImportPanel.js` Doc 2 «עדכון שיבוץ סוויטות בלבד» — toggle cream+gold; `_executeSuiteAssignmentOnlySync` UPDATE ל-`room` בלבד לפי `order_number` או `name`+`arrival_date`.)(session 82c — **מקומי, לא deployed:** `WhatsAppInbox` «קח שיחה» → `guests.claimed_by` משתיק בוט לאורח ב-`whatsapp-webhook` (sendReply+Stage2Pay); תיקון groupByPhone שלא איפס claim בהודעה נכנסת; באנר 🔇 ב-thread.)(session 82b — `receptionChecklistTemplate.js` 21 משימות verbatim; `ReceptionChecklist.jsx` דשבורד ילנה+איפוס 04:00 — deployed b01c74d.)(session 80 — **מקומי, לא deployed:** פורטל אורח — `system_settings.enable_spa_request_button`+`has_spa_booking` מסתירים כפתור ספא; `guest-portal-spa-request` שולח תשובת Concierge Meta; migration 115.)(session 79 — סינון הכל/עם חדרים/ללא חדרים, כפתור ייבוא דינמי לפי סגמנט, `profile_type`+`profile_batch_type` ב-sync payload; `detailedReservationParser` מסווג לפי `rooms_count`.)(session 78 — **מקומי, לא deployed:** Reception Matrix — `GuestsPage`+`guestCheckinMatrix.js` (רשימה פעילה/ארכיון «אורחים לאחר שהות», auto 15:00+checkout, `checked_out` migration 114); `ReceptionChecklist.jsx`+`reception_checklist_entries` (3 אקורדיונים, audit+04:00 shift); `whatsapp-cron` auto_checkout; `notify-manual-task` תרגום EN רק תפעול/משק; Phase 2a Dashboard נשמר.)(session 77c — **Staff UI Phase 0+1 (מקומי, לא committed):** `App.js` tokens+utilities; `WhatsAppInbox.js` roster/CTAs/reply bar — Phase 0 vars, touch ≥44px, badge nowrap, swipe 48px, sticky reply+safe-area.)(session 77 — **Unified routing matrix + 15:00 auto check-in:** `automationSchedule.ts` — `shouldAutoPromoteToCheckedIn`/`resolveEffectiveGuestStatus`/`israelYmd`; מילות מפתח תפעול מורחבות; `ADMIN_REQUESTS_DEPARTMENT=קבלה/בקשות` + `shouldInterceptAdministrativeInHouseRequest`; תשובת שטח קבועה; `CANONICAL_STAY_CHANGE_HANDOFF_MSG` (אדיר ואפק). `whatsapp-cron` — bulk `pending`/`expected`→`checked_in` אחרי 15:00. `whatsapp-webhook` — gateway זהה; ניתוב תפעול→Whapi+Gemini EN; אדמין→tasks בלבד; stay-change→tasks+guest_alerts.)(session 76b — `isSensitiveStayChangeRequest` + `CANONICAL_STAY_CHANGE_HANDOFF_MSG`; late checkout/הארכה/צק-אין מוקדם → handoff ניטרלי (אדיר ואפק), `needs_callback`+`attention_reason=date_change`; הוסר מ-UPSELL_PATTERNS; pre_send_guard אם LLM דלף.)(session 76 — **Tier-0 operational intercept:** `automationSchedule.ts` — `OPERATIONAL_IN_HOUSE_KEYWORD_PATTERN` מורחב; `shouldInterceptOperationalInHouseRequest` + `buildOperationalDispatchReply`; `whatsapp-webhook` — אורח `checked_in` + מילת מפתח חדר → `routeGuestRequestToOpsGroup` + `requires_attention`/`attention_reason` + תשובה דטרמיניסטית לפני burst/LLM, אחרי dedup `wa_message_id`.)(session 75 — **Housekeeping→Manager alert:** migration 113 `room_status`→realtime; `room-pending-approval-notify` push להנהלה כשחדר+ג'קוזי נקיים ב-`HousekeepingTabletView`; AICopilot פעמון 🔔 לאישור הודעה+צ'ק-אין.)(session 74 — **Agent Playbook:** `docs/xos_agent_playbook.md` — תקשורת חסכונית, UI phases 0–3, desktop-first, living-doc protocol; `.cursorrules` מפנה אליו.)(session 73b — **xos_ai_rules edit/delete:** migration 112 RLS UPDATE/DELETE; `BotSettings.js` כפתורי ✏️/🗑️ לכללים שנלמדו.)(session 73 — **AI Learning + anti-reasoning seal:** `BotSettings.js` מציג `xos_ai_rules` (chat/routing); `whatsapp-webhook` — הפרדת suffixes, `ANTI_REASONING_LEAK_SUFFIX` אחרון ב-`enrichedPrompt`, מגן עברית ב-`sanitizeReply`; ללא שינוי `bot_settings.system_prompt`.)(session 72 — **Ops Board tasks Realtime:** `OperationsBoard.js` — `applyTaskRowUpdate` + channel `ops-board-tasks-rt` על `tasks` INSERT/UPDATE; 👍🏼 בקבוצת Whapi מעביר ל«בוצע» בלי רענון; migration 111 `tasks`→`supabase_realtime`.)(session 71 — **In-room context override + burst dedup:** `whatsapp-webhook` — מילות מפתח בחדר (מגבות/שמפו/מים/…) על `pending`/`expected` → `checked_in` async + `IN_HOUSE_TONE_SUFFIX`/`forceInHouse` ב-`buildGuestStageContext`; insert-first `wa_message_id` claim + burst coalesce ~1.8s למניעת כפל תשובות; helpers ב-`automationSchedule.ts`.)(session 69b — **Inbox in-resort purple roster:** `WhatsAppInbox.js` + `isGuestInResortToday()` ב-`guestTiming.js` — אורחים בשהייה פעילה היום מודגשים בסגול ברשימת DREAM BOT.)(session 69 — **Inbox route → Whapi group:** `WhatsAppInbox.js` `routeTask` קורא ל-`notify-manual-task` אחרי insert (`inbox_routed`); כרטיס `[GUEST WA]` בקבוצת `WHAPI_GROUP_ID`, 👍🏼 reaction כמו משימה ידנית.)(session 68 — **Queue per-stage select-all + Meta pulse:** `AutomationControlCenter.js` — צ'יפים «בחירה מהירה לפי שלב» בכל כרטיס יום הגעה; שגר המוני `BULK_SEND_PULSE_MS=2500` כמו `whatsapp-cron`.)(session 67 — **Stage 4 check-in gate toggle:** migration 110 `require_checked_in` על `automation_stages`; מתג במסע האורח ל-`mid_stay`; `automationSchedule` מכבד את הדגל; ברירת-מחדל OFF ל-mid_stay.)(session 66c — **תור חי לפי יום הגעה + Stage 4 fix:** קיבוץ אורחים לפי `arrivalDate`; `automation-queue` — `not_checked_in` נשאר `pending`; ימים עברו מקופלים.)(session 66b — **Suite spa-only Doc 1 sync:** `ArrivalImportPanel.js` — מצב ברירת-מחדל «ספא סוויטות בלבד» מפרסר רק שורות «לאורחי הסוויטות»; סנכרון ל-`guests` לפי `order_number`+`arrival_date` (פרופיל קיים בלבד); מצב «עדכון מלא» נשאר.)(session 66 — **Import spa filter:** `ArrivalImportPanel.js` — ברירת-מחדל «רק עם ספא» + toggle «הצג את כל האורחים»; `gridRows` מלא לסנכרון, `displayGridRows` מסונן לתצוגה; sync דרך `_profileIdx`. `ezgoParser.enrichProfilesFromExcel` — fallback join לפי טלפון כש-order_number לא תואם.)(session 65 — **Queue↔Timeline sync:** `AutomationControlCenter.js` — `mergeQueueWithStages`/`isCronScheduledStage` מסנכרנים תור חי עם `automation_stages` (is_active + שמות); `scheduleQueueRefresh` אחרי `patchStage`; פעימה מפרידה שלבי cron מ-`event_immediate`.)(session 64 — **Queue tab UX:** `AutomationControlCenter.js` תור חי מסנן `sent`/`simulated`/`skipped` (היסטוריה בלבד בטאב "מה נשלח"); 🗑️ ניקוי שורות `blocked_by_meta` — UI-only דרך `dismissedAttentionKeys`, ללא שינוי backend.)(session 63 — **Autonomous Deploy Protocol:** בסוף כל סשן קוד — תמיד להציע commit+push+db push+functions deploy ולהריץ באישור Mike; §12+§13+.cursorrules.)(session 62 — **Smart Guest Profile:** `guests.guest_profile` JSONB (migration 109); `GuestProfileModal` + `guestProfileSchema.js`; `GuestAttentionBadge` → מודל מובנה (VIP/אירוע/תזונה/הגעה/ETA); `guest_notes` = לוג מערכת בלבד; inbox banner הוסר; webhook `buildGuestStageContext` קורא פרופיל.)(session 61 — **WhatsApp Inbox UX:** באנר `guest_notes` מקופל כברירת-מחדל + כפתור ✕; `minHeight:0` על אזור ההודעות תיקן חפיפה; בועות מעט גדולות יותר. ראה §3 `WhatsAppInbox.js`.)(session 60 — **Receptionist RBAC refresh** + **Record-Only ETA** + **Future Suite Management routing:** `receptionist` = full Sidebar (`auth.js` `canSeeNavItem`/`canAccessRoute`); `guests.arrival_time` (migration 108) record-only webhook path; future suite asks → `120363429859248777@g.us` + LLM Hebrew→English before Whapi. ראה §4/§6/§7.)(session 59 — **needs_callback decouple:** דגל UI בלבד, בוט+cron לא נחסמים; AddGuestModal "ממתין לטיפול צוות 🔴"; §12 Deploy checklist חובה. ראה §10 session 59.)(session 57 — **System Audit & Cleanup.** (1) Security purge: הוסרו `MOCK_USERS` array + admin bypass block מ-`App.js`, display table ו-prop מ-`AdminPanel.js`, hardcoded default password `"1234"` מ-`invite-user/index.ts` (replaced by enforced 8-char minimum). (2) Bug fix — `guest-portal-data`: PostgREST `cs` DB-level filter הוחלף בסינון JS דו-שלבי: Level 1 (scene visibility) → Level 2 (CTA visibility per kept scene) — תוקן באג שהפיל סצנות שלמות ל-day_guest במקום לסנן רק CTAs פנימיים. (3) Day-pass Stage 5 audit: `checkout_fb` כבר היה ב-`DAY_PASS_ALLOWED_TRIGGERS` ו-`DAY_PASS_ALLOWED_STAGES` — תוקן רק טקסט "שלושה שלבים בלבד" → "ארבעה שלבים" + comment בקוד. (4) Dead code: הוסר משתנה `predictedChannel` לא-בשימוש ב-`AutomationControlCenter.js` — build `Compiled successfully.` ללא warnings. ראה §10 session 57.)(session 56 — **Master template variable sync** (`dream_suite_reminder` + `dream_welcome_morning`). שלושה תיקונים ב-`whatsapp-send/index.ts`: (1) `morning_suite`/`morning_welcome` לא העבירו משתנים `{{2}}`/`{{3}}` כלל — נוסף `resolveDayTimings()` synchronous: ראשון–שישי → 12:00/15:00, שבת → 15:00/18:00, מוזרק ל-`PIPELINE_VARS` של שני הטריגרים. (2) `portalButtonParam` היה night_before בלבד — הורחב ל-`PORTAL_BUTTON_TRIGGERS = {night_before, morning_suite, morning_welcome}` כך שגם הודעות בוקר-ההגעה מזריקות את `portal_token` לכפתור ה-URL. (3) `resolveNightBeforeTimes()` זרק שגיאה כשמפתחות שבת ב-`bot_config` ריקים — הוחלף ב-warn + fallback 15:00/18:00 כך שאורח שמגיע בשבת מקבל הודעה במקום כלום. `npm run build` נקי, נפרס לפרודקשן, pushed (c75a919). ראה §10 session 56.)(session 55 — **Meta template IMAGE header fix.** `sendViaTemplate` (whatsapp-send) ו-`sendTemplate` (whatsapp-webhook) לא כללו את רכיב ה-`header` ב-components payload — Meta זרק "Format mismatch, expected IMAGE, received UNKNOWN" לכל תבנית עם Media Header כגון `dream_suite_reminder`. תיקון: `TEMPLATE_IMAGE_HEADERS` map חדש בכל פונקציה — mapping שם-תבנית → URL תמונה; אם קיים, רכיב header מוזרק ראשון לפני body/button. נפרס לפרודקשן. ראה §10 session 55. )(session 54 — **Voucher Reconciliation Engine — synthetic validation + `voucher_numbers_match()` bugfix.** Migration 092 תוקן באג בפונקציה: `truncate_4` mode השתמש ב-`left(v_easygo_norm, length-4)` שחתך 4 *תווים* אחרונים — כשיש מפריד (e.g. `'999888-4321'`) נשאר `'999888-'` (עם מקף) שלא תאם את `'999888'` של הספק. תיקון: שלב נרמול חדש `regexp_replace(..., '[^A-Z0-9]', '', 'g')` על שני הצדדים לפני הקטיעה — מיישר `'999888-4321'`→`'9998884321'`→`'999888'` ✅. 8 בדיקות inline ב-migration עצמו (`DO $$ ... $$`) אוכפות את הנכונות בזמן deploy. נוסף גם `supabase/tests/voucher_reconciliation_e2e_test.sql`: 5 תרחישים מלאים (INSERT→RPC→assert→ROLLBACK) שניתן להריץ ב-Supabase SQL Editor בכל עת. `exact` mode (Hever/Nofshonit) לא שונה — בדיקה B מוכיחה שמפריד גורם לאי-התאמה כצפוי. ראה §10 session 54 לפירוט.) (session 53 — **Real-time Meta template sync buttons** נוספו ל-`WhatsAppInbox.js` (NewChatModal) ו-`BroadcastDashboard.js`: כפתור "🔄 סנכרן תבניות" שמאפשר לסגל לרענן את רשימת התבניות המאושרות מ-Meta בלי לרענן את הדף. `fetchTemplates` חולץ ל-`useCallback` בשני הקבצים. `npm run build` נקי. committed+pushed (8251e4a). ראה §10 session 53 לפירוט.) (session 52 — **RESORT_UI_MANIFEST.md** נוצר (root) כמקור-אמת נפרד ל-UI/UX philosophy + tab-readiness checklist, ואז **automated repair pass** סגר 7 מתוך הממצאים שהוא תיעד: silent/misleading error states ב-`AdminPanel.js`(×2)/`WhatsAppInbox.js`(×2)/`AutomationControlCenter.js`/`InventoryImportPanel.js` + tablet-grid layout gaps ב-`RoomBoard.js`/`HousekeepingTabletView.js`/`AICopilot.js`. `npm run build` נקי אחרי כל קובץ. CSS-variable drift (~150 hardcoded hex) ו-`AutomationControlCenter`'s tablet media-query נשארו **בכוונה** לא-מטופלים (out of scope, לפי הנחיית Mike). ראה §10 session 52 לפירוט מלא + §0 בהמשך לסשן 51 שנשאר מתועד למטה.)
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

1. **Zero-Spam Policy** — לעולם לא לשלוח broadcast/הודעה אוטומטית אם האורח מבוטל (`status='cancelled'`).
   ✅ **סטטוס נוכחי — אכיפה על cancelled בלבד (session 59, 2026-06-28).** `checkEligibility()` ב-`_shared/automationSchedule.ts` (משמש `whatsapp-cron` + `automation-queue`) מחזיר `guest_cancelled` כש-`status='cancelled'` — אורח מבוטל לא מקבל שלבי cron. **`needs_callback` אינו חוסם יותר** — זה דגל התראה לצוות בלבד (UI: `AddGuestModal` "ממתין לטיפול צוות 🔴", `WhatsAppInbox` "🔴 מבקש מענה אנושי"); הבוט ממשיך לענות ו-cron ממשיך לשלוח. החלטת Mike session 59 — decouple UI alerts from bot logic.
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

> **עדכון session 58 (2026-06-28):** Operational Dashboard Sync. (1) `GuestDashboard.js`: נוסף `editingGuest` state + כפתור ✏️ על כל כרטיס אורח — פותח `AddGuestModal` עם האורח הקיים (פריטי-ביצוע-זהים כמו ב-`GuestsPage.js`, עקרון SINGLE SOURCE OF TRUTH §0.5). (2) `GuestsPage.js` — אכיפת Bifurcation: `displayGuests` מסונן כעת ל-`isSuite(g)` בלבד — אורחי יום (`day_guest`/`premium_day_guest`) אינם מוצגים בטבלת הצ'ק-אין (הם ב-`GuestDashboard.js` tab "בילוי יומי"). Badge "👑 סוויטות בלבד" גלוי בכותרת. (3) `GuestsPage.js` — תיקון FAIL VISIBLE (§0.3): ה-`catch { /⁎ function may not be deployed yet ⁎/ }` ה-שקט ב-`setStatus()` לאחר Room Ready הוחלף בבדיקת `data?.ok` + toast שגיאה עם הסיבה האמיתית + toast הצלחה עם שם האורח. commit `5c602b2`, pushed ל-main, Vercel auto-deploy.



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
│   │   ├── auth.js               ★ NEW (session 60) — RBAC מרכזי: getRole(), canPerform(),
│   │   │                            canSeeNavItem(), canAccessRoute(). מקור אמת ל-receptionist
│   │   │                            gates + route guards ב-App.js guardPage.
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
│       │                            ★ session 57: מקבל כעת `portalScenes` מ-`guest-portal-data`
│       │                            (כבר מסוננות server-side לפי `room_type` של האורח, ראה
│       │                            תיעוד `guest-portal-data` למטה) ומעביר אותן ל-`PhotoTour`
│       │                            כ-`scenesProp`. ניהול הסצנות והCTAs בUI — ראה `PortalSettingsPanel.js`.
│       ├── PhotoTour.js          ★ NEW (session 35) — scrollytelling virtual tour, ללא three.js/
│       │                            ספריית 3D. כל "סצנה" = section בגובה `100vh` עם
│       │                            IntersectionObserver (לא scroll-listener כבד) שמחליף opacity/
│       │                            transform ב-CSS transition — crossfade דרך CSS, לא JS. רקע =
│       │                            `linear-gradient(...), url(...)` — אם ה-JPG חסר (תמיד היום,
│       │                            ראה למעלה) השכבה השנייה פשוט לא נצבעת והגרדיאנט נשאר, אז שום
│       │                            סצנה לא נראית "שבורה" גם בלי תמונות אמיתיות.
│       │                            ★ session 57: קיבל prop `scenesProp` (מ-GuestPortal.js). כשהprop
│       │                            קיים — משתמש בסצנות המסוננות-server-side ישירות (room_type-aware,
│       │                            CTAs כבר מסוננות, ראה `guest-portal-data`). כשהprop חסר — fallback
│       │                            ל-`SCENES` קונסט סטטי (4 סצנות) לתצוגות admin/offline. קליק CTA
│       │                            → `onUpsell(upsellLabel)` prop (מ-GuestPortal) → `guest-portal-upsell`.
│       ├── PortalSettingsPanel.js ★ NEW (session 57) — Admin panel לניהול פורטל האורח. מאפשר לצוות
│       │                            לנהל `portal_scenes` (כותרת/גוף/תמונה/CTAs/`visibility_settings`/
│       │                            `sort_order`/`is_active`) ו-`upsell_items` (שם/קטגוריה/מחיר/
│       │                            `visibility_settings` — מחליף `target_audience` הישן). כל שדה
│       │                            `visibility_settings` הוא `TEXT[]` — checkboxes per room_type
│       │                            (`suite`/`day_guest`/`premium_day_guest`). שינויים נשמרים ב-DB
│       │                            ומשתקפים מיד בפורטל (server-side filtering ב-`guest-portal-data`).
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
│       │                            ★ session 66: תצוגת ייבוא סוויטות — ברירת-מחדל מסננת שורות בלי
│       │                            `spa_time` (toggle «הצג את כל האורחים»); סנכרון עדיין מייבא את כל
│       │                            `gridRows` דרך `_profileIdx` — לא רק מה שמוצג.
│       │                            ★ session 66b: Doc 1 «ספא סוויטות בלבד» — `suiteSpaOnly`+
│       │                            `strictSuiteLabel` (רק «לאורחי הסוויטות»), dedupe לפי
│       │                            `order_number`; PATH B מעדכן `guests.spa_time` לפי order_number+
│       │                            arrival_date (לא insert).
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
│       │                            ★ session 72: `applyTaskRowUpdate` + channel `ops-board-tasks-rt`
│       │                            על `tasks` INSERT/UPDATE (migration 111) — 👍🏼 בקבוצת Whapi מעביר
│       │                            ל«בוצע» בלי רענון; claim/done מקומי משתמש באותה פונקציה.
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
│       │                            הודעה" שולח WA room_ready + guests.status='room_ready' + room פנוי
│       │                            (לא checked_in — session 87). כפתורים: «צ'ק-אין בלי הודעה»,
│       │                            «סגור שער בלבד». לוגיקה משותפת: `suiteCheckinSync.js`.
│       │                            ★ session 86: לא מציג התראה אם `room_ready_notified`/`msg_room_ready_sent`;
│       │                            ניקוי stale gate (room_status→פנוי) ב-load; `whatsapp-send` מנקה gate
│       │                            אחרי שליחה/idempotent skip — realtime מסיר מהפעמון.
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
│       │                            ★ session 67: `require_checked_in` toggle on mid_stay (migration 110).
│       │                            ★ session 66c: Queue grouped by arrival day; Stage 4 `not_checked_in` stays visible.
│       │                            ★ session 65: Queue↔Timeline sync — `mergeQueueWithStages`/`isCronScheduledStage`;
│       │                            `scheduleQueueRefresh` after `patchStage`; pulse splits cron vs event_immediate.
│       │                            ★ session 64: Queue tab — `QUEUE_FINALIZED_STATUSES` מסנן sent/simulated/skipped
│       │                            מתצוגת "בתור"; 🗑️ per-row + "נקה הכל" על `blocked_by_meta` (UI dismiss בלבד).
│       │                            ★ session 68: בכל כרטיס יום הגעה — צ'יפים «בחירה מהירה לפי שלב» (סמן הכל שלב N / כל היום);
│       │                            שגר המוני `BULK_SEND_PULSE_MS=2500` (זהה ל-cron) + progress בזמן שליחה.
│       ├── TemplateManagerPanel.js ★ ניהול תבניות WhatsApp מאושרות מ-Meta — סונכרן/נוצר/preview.
│       │                            מיוצא session 20: STATUS_META (היה module-private) — משותף עם
│       │                            AutomationControlCenter.js's Meta template preview box.
│       ├── VoucherReconciliationHub.js ★ NEW (session 51) — "התאמת שוברים" (route חדש
│       │                            `voucher_reconciliation`, admin/super_admin, Sidebar אדמין).
│       │                            shell עם 2 sub-tabs (אותו pattern כמו InventoryHub.js): "ייבוא
│       │                            והתאמה" (VoucherImportPanel) / "דוח חריגים" (VoucherExceptionsBoard).
│       │                            ה-UI הראשון למנוע ה-backend שנבנה ב-session 50.
│       ├── VoucherImportPanel.js ★ NEW (session 51) — dropdown ספק (חי מ-`voucher_providers`) +
│       │                            שני drag-and-drop zones (EasyGo/ספק) → `multipart/form-data`
│       │                            אמיתי ל-Edge Function `reconcile-vouchers` החי. מטפל בשער
│       │                            `needs_mapping_review`: מציג `MappingReviewPanel` (אותה
│       │                            קומפוננטה כמו ArrivalImportPanel/InventoryImportPanel) לכל צד
│       │                            שלא פוענח, ושולח מחדש אוטומטית עם המיפוי המאושר ברגע ששני
│       │                            הצדדים אושרו. `VOUCHER_PROVIDER_SCHEMA`/`VOUCHER_EASYGO_SCHEMA`
│       │                            נוספו ל-`importMapper.js` כראי לשני schema_key החדשים
│       │                            (session 50) — רק תוויות עבריות לתצוגה, לא לוגיקת פרסור.
│       ├── VoucherExceptionsBoard.js ★ NEW (session 51) — לוח טריאז' מעל
│       │                            `voucher_reconciliation_results`. צ'יפים לפילטור לפי
│       │                            `match_status` (ברירת מחדל מדגישה `missing_in_provider` —
│       │                            הכיוון הפיננסי הקריטי, מוזמן ב-EasyGo בלי גיבוי ספק), כפתורי
│       │                            "✓ אישור/☑ טופל/✕ דחייה" כותבים `review_status` ישירות דרך
│       │                            ה-Supabase client (אותה קונבנציה כמו InventoryApprovalQueue.js).
│       │                            ⚠️ **לא נבדק חזותית ע"י Claude** — login דמו חסום בסביבת
│       │                            הפיתוח (ראה §10 session 51). Mike צריך login אמיתי לאישור.
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
│   ├── 091_voucher_reconciliation_engine.sql    applied ✅ — ★ session 49: 4 טבלאות שוברים + RPC + voucher_numbers_match().
│   ├── 092_voucher_match_fix.sql                applied ✅ — ★ session 54: bugfix truncate_4 + 8 inline self-tests.
│   ├── 093_upsell_items_and_guest_orders.sql    applied ✅ — upsell_items קטלוג + guest_orders.
│   ├── 094_night_before_daypass_and_morning_daypass.sql applied ✅ — Stage 2.5 split: night_before_daypass + morning_daypass bot_script.
│   ├── 095_upsell_items_link_url.sql            applied ✅ — upsell_items.link_url.
│   ├── 096_premium_day_guest_room_type.sql      applied ✅ — room_type CHECK + 'premium_day_guest'.
│   ├── 097_upsell_items_visibility_settings.sql applied ✅ — ★ session 57: visibility_settings TEXT[] מחליף target_audience
│   │                                (backfill מ-target_audience, vocabulary translation suite/day_use→day_guest),
│   │                                GIN index `idx_upsell_items_visibility`, inline self-test. ראה §10 session 57.
│   └── 098_portal_scenes_visibility.sql         applied ✅ — ★ session 57: portal_scenes.visibility_settings TEXT[] +
│                                   GIN index `idx_portal_scenes_visibility` + inline self-test.
│                                   Level 1 scene visibility gate (filtered in JS, not DB — see guest-portal-data §3).
│                                   Level 2 CTA visibility: per-cta `visibility` key in JSONB, no schema migration needed.
│   └── 108_guest_arrival_time.sql               applied ✅ — ★ session 60: guests.arrival_time TEXT (HH:MM ETA).
│   └── 109_guest_profile.sql                    ★ session 62: guests.guest_profile JSONB (VIP/occasion/dietary/arrival_context/staff_note).
│   └── 110_mid_stay_require_checked_in.sql      applied ✅ — ★ session 67: automation_stages.require_checked_in; mid_stay default OFF.
│   └── 111_tasks_realtime_publication.sql       ★ session 72: `tasks`→`supabase_realtime` for OperationsBoard live 👍🏼 sync.
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
│       │                            ★ session 57: Two-Level Portal Segmentation (server-authoritative).
│       │                            `upsell_items` נשלפים עם DB-level filter `visibility_settings @>
│       │                            ARRAY[guestRoomType]` (GIN index — migration 097). `portal_scenes`
│       │                            נשלפים **ללא** DB filter (כל הסצנות הפעילות), ואז מסוננות ב-JS
│       │                            בשני שלבים: **Level 1** — סינון סצנה (scene.visibility_settings
│       │                            חייב לכלול `guestRoomType`; סצנה שנחסמת = `continue`, לא נכנסת
│       │                            לתשובה כלל). **Level 2** — סינון CTA בתוך סצנה שעברה Level 1
│       │                            (cta.visibility ריק = כל האורחים, אחרת רק room_types מפורשים).
│       │                            ✅ הכיוון הזה (לא DB-level לסצנות) נכון: DB-level filter היה
│       │                            מפיל סצנות שלמות לפני שCTAs בכלל נבדקו — הbאג המקורי.
│       │                            ⚠️ אם `guestRoomType` לא ידוע/null: כל הסצנות וכל הCTAs עוברים
│       │                            (backward compat — אורח רואה יותר, לא פחות).
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
│       │                            הפרומפט לא יישאר hardcoded ל"הזמנות מלון" לקובץ מלאי. ★ session
│       │                            50: שני schema_key נוספים — `voucher_provider_report`/
│       │                            `voucher_easygo_report` (Voucher Reconciliation Engine,
│       │                            `reconcile-vouchers` למטה הוא הצרכן היחיד שלהם כרגע).
│       ├── reconcile-vouchers/      ★ NEW (session 50) — Voucher Reconciliation Engine, backend
│       │                            processing. מקבל multipart/form-data: `easygoFile`/`providerFile`
│       │                            (קבצי Excel/CSV) + `providerName` (טקסט, נגד `voucher_providers`
│       │                            הקיים) + `providerMapping`/`easygoMapping` אופציונליים (JSON,
│       │                            מיפוי שאדם כבר אישר). **שונה מכל שאר משטחי הייבוא בריפו** — כאן
│       │                            ה-Edge Function עצמו (לא הפרונטאנד) קורא/כותב `import_mapping_memory`
│       │                            ישירות (אותו אלגוריתם signature כמו `ArrivalImportPanel.js`'s
│       │                            `_headerSignature` בדיוק — `[...headers].sort().join("␟")`), כי
│       │                            אין עדיין מסך-סקירה לפיצ'ר הזה. סדר פתרון מיפוי: (1) מיפוי מפורש
│       │                            בבקשה (כבר אושר ע"י אדם) → נשמר לזיכרון, (2) זיכרון קיים לפי
│       │                            header_signature, (3) **אין** → קורא ל-`suggest-import-mapping`
│       │                            (Gemini→Claude) להצעה, ומחזיר `{ok:true, status:"needs_mapping_review",
│       │                            review:{...}}` **בלי לכתוב שום שורה ל-DB** — שער-אישור-אנושי
│       │                            (migration 049's comment: "never skips the human gate") נשמר גם
│       │                            כשאין מסך לקיים אותו עדיין. כששני הצדדים פתורים: כותב ל-
│       │                            `voucher_provider_reports`/`voucher_easygo_records` (כל צד עם
│       │                            `import_batch` UUID משלו, מיוצר כאן כדי שיועבר ישירות ל-RPC),
│       │                            עמודות לא-ממופות נשארות ב-`raw_extras` (Zero Data Loss, §0.1),
│       │                            ואז קורא ל-RPC `run_voucher_reconciliation(provider_batch,
│       │                            easygo_batch)` ומחזיר את ה-JSONB שלו ללא שינוי + ספירות שורות.
│       │                            דורש Bearer תקין (כלי צוות פנימי, **לא** פורטל ציבורי כמו
│       │                            guest-portal-data/inventory-portal-submit — לכן בשונה מהם
│       │                            *לא* מדלג על אימות). ✅ **נפרס לפרודקשן** (`--no-verify-jwt`,
│       │                            כולל `suggest-import-mapping` המעודכן). ★ session 51: UI נבנה
│       │                            (`VoucherReconciliationHub.js` למעלה) ושולח multipart אמיתי —
│       │                            ⚠️ **עדיין לא נבדק חי מול קובצי ספק/EasyGo אמיתיים** (login דמו
│       │                            חסם בדיקה חזותית ע"י Claude, ראה §10 session 51) — Mike צריך
│       │                            להריץ ייבוא אמיתי דרך ה-UI.
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
│       │                            task דרך `whapi_message_id` (migration 077) ← `status: "done"`.
│       │                            ★ session 77c: fallback — אם אין התאמה, אותה 👍 על
│       │                            `source_message_id` (הודעת הטריגר המקורית בקבוצה, migration 073).
│       │                            → `status: "done"` + `resolved_by`/`resolved_at`. **No-Bloat: אין תגובה לקבוצה**
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
│       ├── _shared/futureSuiteRoomServiceRouting.ts ★ session 60 — `SUITES_ROOM_SERVICE_GROUP_ID`
│       │                            (`120363429859248777@g.us`) + future-suite routing gate; נצרך ע"י
│       │                            guest-portal-ops-request, sla-escalation-cron, whatsapp-webhook.
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
  "data_sync"    → DataSyncPage     // ★ session 32 — admin/super_admin/receptionist (guardPage via
                                    // auth.js ROUTE_ACCESS). Thin wrapper — mounts ArrivalImportPanel
                                    // (defaultOpen), not a second import engine.
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
  "voucher_reconciliation" → VoucherReconciliationHub  // ★ session 51 — admin/super_admin/receptionist
                                    // (guardPage). "התאמת שוברים" — Voucher Reconciliation UI.
  "users_mgmt"   → UserManagement   (super_admin only)
}
// ★ session 7: "upload" (DataUpload) ו-"data_hub" (DataHub) הוסרו — מוזגו ל-ArrivalImportPanel.
// AICopilot מורכב גלובלית (לא דרך activePage) לכל user שאינו cleaner — ראה App.js:~2618.
// תפקיד "cleaner": מקבל מסך מלא HousekeepingTabletView בלבד (ללא Sidebar) — ראה App.js:~2116.
// ⚠️ session 28: היה RoomBoard עד session 27 — הוחלף, ראה §3/§10 session 28.
//
// ★ receptionist ("פקיד/ת קבלה" / "קבלה") — session 30 DB role (migration 080); ★ session 60 RBAC:
//   Full Sidebar shell (NOT the orphaned ReceptionistView.js kiosk). RBAC מקור: src/utils/auth.js.
//   ✅ גישה: כל routes של staff + wa_inbox + data_sync + voucher_reconciliation + ops_board
//      (ops_board.managerOnly=false; שלושת האחרים = receptionistOk:true ב-App.js Sidebar).
//   ❌ חסום: admin, bot_config, bot_settings, bot_scripts, automation_center, portal_settings,
//      cms_security, users_mgmt — guardPage מפנה ל-dashboard.
//   ❌ seed/clear גלובלי של נתוני דמו (AdminPanel → טאב "נתונים") — super_admin בלבד.
//   ✅ create_ops_task (OperationsBoard NewTaskForm) — receptionist כלול ב-PERMISSIONS.
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
| `tasks` | ★ session 21: "תפעול ואחזקה" — `status` עכשיו `open`/`in_progress`/`done` (היה רק open/done), + `sla_category`/`sla_deadline`/`escalated_at`/`claimed_by`/`claimed_at`/`source`/`reporter_profile_id`/`reporter_raw_text`. `source='legacy_service_call'` = backfill חד-פעמי מ-`service_calls` (migration 071) + ★ session 22 (migration 073): `action_token` (סוד ל-URL של כפתורי Accept/Complete) + `source_message_id` (UNIQUE partial, webhook idempotency) + ★ session 26 (migration 077): `source='guest_request'` (suite guest ask, מ-`log_guest_request`, ראה §10) + `guest_id` (FK→guests, SET NULL) + `whapi_message_id` (UNIQUE partial — כרטיס המשימה שבפועל נשלח לקבוצה; 👍🏼 reaction listener מתאים אליו) + ★ session 27 (migration 078): `source='manual_group'` (Room/חדר/סוויטה-prefixed manual text בקבוצת הצוות, ראה §10) + `resolved_by_phone`/`resolved_by_name` (תפיסת זהות גולמית מ-Whapi — נכתב גם כש-`resolved_by` ה-FK נשאר NULL כי לא נמצאה שורת profiles תואמת, FAIL VISIBLE) + ★ session 35 (migration 083): `source='portal_upsell'` — ⚠️ **session 41: ערך מת/לא בשימוש** — `guest-portal-upsell` עבר REDESIGN לכתוב ל-`guest_alerts` במקום (ראה §3/§10), הערך נשאר ב-CHECK רק לתאימות-לאחור עם שורות היסטוריות אם יש כאלה + ★ session 41 (migration 085): `source='portal_room_service'` (קליק על "הזמנת שירות לחדר" בסצנת ערמונים בפורטל — **כן** בשימוש, `guest-portal-ops-request` Edge Function — ראה §10) | open to authenticated |
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
| `voucher_providers` | ★ NEW (session 49, migration 091) — רישום ספקי שוברים חיצוניים (Hightech Zone/Dolce Vita/Pais Plus/Hever/Nofshonit, מזוּרעים) + `match_mode` (`exact`/`truncate_4`) — data-driven, לא hardcoded בקוד | authenticated |
| `voucher_provider_reports` | ★ NEW (session 49, migration 091) — שורות מדוח הספק (מקור האמת למה שהאורח שילם עליו בפועל). `voucher_number` nullable בכוונה — שורה לא-קריאה עדיין נכנסת ומופיעה כ-`unparseable` exception, לא נעלמת (Zero Data Loss §0.1) | authenticated |
| `voucher_easygo_records` | ★ NEW (session 49, migration 091) — שורות מ"דוח השוברים של EasyGo" (מה שהצוות בפועל הזמין). `provider_id` nullable — `run_voucher_reconciliation` מנסה כל ספק רלוונטי כשלא תויג | authenticated |
| `voucher_reconciliation_results` | ★ NEW (session 49, migration 091) — תוצאת כל השוואה: `match_status` (matched/package_mismatch/duplicate_match/missing_in_easygo/missing_in_provider/unparseable) + `review_status` נפרד (pending/approved/rejected/resolved) — אותו דגם דו-סטטוס כמו `spa_staging`. **ללא DELETE policy בכוונה** (נתון פיננסי-אדג'ייסנט) | authenticated |
| `upsell_items` | ★ NEW (session 57, migration 093+097) — קטלוג פריטי upsell לפורטל האורח (ספא, פעילויות, F&B). `visibility_settings TEXT[]` (migration 097) — מחליף `target_audience` הישן (נשמר כ-legacy column, לא נמחק). ערכים חוקיים: `'suite'`/`'day_guest'`/`'premium_day_guest'`. DB-level filter `@>` (GIN index `idx_upsell_items_visibility`) משמש ב-`guest-portal-data`. | authenticated |
| `portal_scenes` | ★ NEW (session 57, migration 098) — סצנות הscrolltelling של `PhotoTour.js`. `visibility_settings TEXT[]` — Level 1 gate (כל room_types ברירת מחדל = כולם רואים). `ctas JSONB[]` — כל CTA יכול לכלול `"visibility": ["suite"]` optional key (Level 2 gate). **מסוננות ב-JS, לא ב-DB** — ראה `guest-portal-data`. GIN index `idx_portal_scenes_visibility`. | public read (legacy + service_role on portal) |

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
needs_callback      BOOL  — true = דגל התראה לצוות (ממתין לטיפול אנושי) — **לא** מכבה את הבוט (session 59). נכתב ע"י webhook בבקשת שינוי תאריך/מענה אנושי; נמחק ע"י ✓ ב-WhatsAppInbox או ידנית ב-AddGuestModal
requires_attention  BOOL  — badge אדום בדאשבורד
attention_reason    TEXT  — ★ session 15 (migration 057): "date_change" | "human_callback" | NULL
                            (capture/generic). נכתב ע"י webhook's button router + DATE_CHANGE_RE,
                            נקרא ע"י GuestAttentionBadge.js (משותף ל-GuestsPage+GuestDashboard) כדי
                            להציג 🗓️/📞/🔴 מובחנים במקום נקודה אדומה גנרית אחת לכל הסיבות.
arrival_confirmed   BOOL  — האורח אישר הגעה
arrival_time        TEXT  — ★ migration 108: שעת הגעה משוערת (HH:MM) שאורח מדווח בוואטסאפ.
                            נכתב ע"י webhook record-only path + ניתן לעריכה ב-GuestProfileModal.
                            מלווה בשורת audit ב-guest_notes (`[timestamp] שעת הגעה: HH:MM`).
guest_profile       JSONB — ★ migration 109: פרופיל חכם מובנה (VIP, אירוע, תזונה, הקשר הגעה,
                            staff_note). נערך ב-GuestProfileModal; נקרא ע"י buildGuestStageContext.
                            **לא** לוג מערכת — זה `guest_notes` (append-only, read-only בUI).
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
   f. Button router (אם isButtonReply)
   g. Text confirmation detection (CONFIRMATION_RE)
   h. ★ Record-Only ETA extraction (migration 108) — לפני DATE_CHANGE_RE ולפני LLM:
      `isRecordOnlyArrivalTimeUpdate()` + `extractArrivalTimeFromText()` (regex HH:MM /
      "בשעה 15" / bare "15:30"). כותב `guests.arrival_time` + append ל-`guest_notes`;
      שולח `RECORD_ONLY_ARRIVAL_REPLY` עברי קבוע; `continue` — **לא** `needs_callback`,
      **לא** `guest_alerts`, **לא** `log_guest_request`, **לא** ops routing.
      `DATE_CHANGE_RE` ו-`ARRIVAL_TIME_QUESTION_RE` חוסמים false-positive.
   i. Date-change detection (DATE_CHANGE_RE)
   j. Intent classification → Gemini/Claude
```

#### Record-Only ETA — כלל עסקי (אכוף בקוד)
```
אורח שמדווח שעת הגעה ("נגיע ב-15:30", "15:30") = שמירת נתונים בלבד.
  ✅ guests.arrival_time + guest_notes audit line
  ✅ תשובת אישור עברית שקטה לאורח
  ❌ needs_callback / requires_attention / guest_alerts / tasks / Whapi staff cards
מקור: whatsapp-webhook/index.ts (שלב h בפייפליין למעלה).
log_guest_request system prompt מחריג עדכוני ETA — המודל לא אמור לפתוח טיקט על שעה בלבד.
```

#### In-Room Context Override (session 71)
```
אורח ב-status pending/expected שכותב מילות מפתח בחדר (מגבות|שמפו|מים|קפסולות|לחדר|ניקיון|נייר|סדין|חלב|קפה|… — ראה OPERATIONAL_IN_HOUSE_KEYWORD_PATTERN):
  ✅ guests.status → checked_in (async, non-blocking)
  ✅ buildGuestStageContext({ forceInHouse: true }) + IN_HOUSE_TONE_SUFFIX — אסור "נתראה בקרוב"/"כשתגיעו"
  ✅ עוקף future-guest pre-check-in routing (status כבר checked_in בזיכרון)
מקור: whatsapp-webhook + shouldApplyInRoomContextOverride() ב-_shared/automationSchedule.ts
```

#### Time-Based Auto Check-In Gateway (session 77)
```
15:00 Israel (UTC+2 fixed) on arrival day:
  ✅ whatsapp-cron — bulk UPDATE guests pending/expected → checked_in (idempotent each cron tick)
  ✅ whatsapp-webhook — resolveEffectiveGuestStatus + async DB sync on inbound after dedup
מקור: automationSchedule.ts shouldAutoPromoteToCheckedIn + whatsapp-cron/whatsapp-webhook
```

#### Tier-0 Operational In-House Intercept (session 76, matrix session 77)
```
אורח checked_in (כולל auto 15:00) + מילת מפתח תפעולית (חלב|מים|מגבות|מזגן|טלויזיה|נמלי אש|…):
  ✅ אחרי dedup wa_message_id, לפני burst/LLM — אפס טוקנים
  ✅ routeGuestRequestToOpsGroup → tasks dept=תפעול + Whapi EN card (Gemini translate)
  ✅ guests.requires_attention=true + attention_reason="בקשת X לחדר"
  ✅ תשובה קבועה: "הבקשה הועברה ישירות לצוות השטח…"
  ❌ לא נשלח לקבלה/בקשות
מקור: handleOperationalInHouseIntercept + automationSchedule.ts
```

#### Tier-0 Administrative In-House (session 77)
```
אורח checked_in + בקשת ספא/טיפול (בקשת טיפול בספא וכו'):
  ✅ tasks בלבד — department=קבלה/בקשות, ללא Whapi ops group
  ✅ תשובה ניטרלית לקבלה
מקור: handleAdministrativeInHouseIntercept + logAdministrativeRequestTask
```

#### Sensitive Stay-Change Shield (session 76b, matrix session 77)
```
הארכת שהייה / late checkout / צק-אין מוקדם / שינוי חדר:
  ✅ intercept לפני upsell ו-LLM — אסור "בשמחה רבה" או אישור משתמע
  ✅ תשובה קנונית בלבד: CANONICAL_STAY_CHANGE_HANDOFF_MSG (אדיר ואפק)
  ✅ needs_callback=true + requires_attention + attention_reason='date_change'
  ✅ tasks dept=קבלה/בקשות + guest_alerts — ללא Whapi תפעול
  ✅ pre_send_guard — אם LLM דלף בכל זאת, דורס לפני שליחה
מקור: isSensitiveStayChangeRequest + handleSensitiveStayChangeHandoff
```

#### Rapid Message Dedup / Burst Coalescing (session 71)
```
לפני LLM: INSERT inbound עם wa_message_id מיד (unique index idx_wa_conv_wa_id) — כשל 23505 = skip.
הודעות רצופות (~2s): המנהיג ממתין 1.8s, מאחד burst ל-effectiveText אחד, follower-ים מדלגים על תשובה.
```

#### Future Suite Management Routing + AI Translation
```
מודול משותף: _shared/futureSuiteRoomServiceRouting.ts
קבוצת יעד: SUITES_ROOM_SERVICE_GROUP_ID = "120363429859248777@g.us" (Suites Management Whapi group)

כש-shouldRouteFutureSuiteRoomServiceToDedicatedPhone() = true (הגעה עתידית + הקשר סוויטה/F&B):
  נתיבים: guest-portal-ops-request, sla-escalation-cron, whatsapp-webhook suite log_guest_request
  → כרטיסים לקבוצה זו (לא WHAPI_GROUP_ID הכללי / לא Adir DM).

לפני שליחת Whapi: תיאור המשימה בעברית עובר שכבת תרגום LLM (Gemini) → אנגלית מקצועית לצוות.
  אורח נשאר עברית; כרטיסי צוות באנגלית (אותו עיקרון dual-language כמו sla-escalation-cron).
  כשל תרגום → fallback לעברית המקורית + לוג; insert ל-tasks לא נחסם.
```

#### `needs_callback` — Staff Alert Flag (לא חוסם בוט, session 59)
```typescript
// needs_callback=true = דגל UI לצוות בלבד (AddGuestModal / WhatsAppInbox).
// הבוט ממשיך: button router + LLM replies רצים כרגיל.
// נכתב ע"י: "לא,שינוי בתאריך", DATE_CHANGE_RE, "דברו איתי", AddGuestModal checkbox.
// נמחק ע"י: ✓ dismiss ב-WhatsAppInbox (מנקה גם human_requested) או ידנית ב-AddGuestModal.
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
"העברתי את בקשתך לצוות הסוויטות שלנו, והם יצרו איתך קשר בהקדם. 🙏"
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
- ✅ **session 11 — תוקן (היסטורי):** נוסף `!g.needs_callback` ל-morning_welcome/morning_suite — **בוטל session 59** (needs_callback אינו חוסם cron יותר). `needs_callback` נשאר ב-SELECT של ה-cron לצורכי לוג/תצוגה בלבד.

---

## 7. AUTH — מי יכול מה

```javascript
// super_admin (בעלים)
SUPER_ADMIN_EMAIL = "tzalamnadlan@gmail.com"   // גישה לכל + UserManagement

// admin
ADMIN_EMAILS = ["promote7il@gmail.com"]        // גישה ל-AdminPanel, BotConfig, BotSettings

// manager — מנהל מחלקה
// לא רואה: AdminPanel, UserManagement, BotConfigPanel, BotSettings

// receptionist — ★ "פקיד/ת קבלה" / "קבלה" (migration 080; RBAC session 60, 2026-06-29).
// מקור אמת: src/utils/auth.js (getRole / canPerform / canSeeNavItem / canAccessRoute).
// UI: Sidebar מלא (כמו staff) — App.js canSeeNavItem(); תווית Sidebar "🛎️ פקיד/ת קבלה".
// ✅ רואה: כל nav של staff + DREAM BOT שיחות (wa_inbox) + סנכרון נתונים (data_sync) +
//    התאמת שוברים (voucher_reconciliation) + תפעול ואחזקה (ops_board) + שאר routes פתוחים.
// ✅ יכול: create_ops_task (פתיחת משימה מ-OperationsBoard).
// ❌ חסום: AdminPanel, bot_config, bot_settings, bot_scripts, automation_center,
//    portal_settings, cms_security, users_mgmt — canAccessRoute → guardPage redirect.
// ❌ seed/clear גלובלי (AdminPanel טאב "נתונים") — super_admin בלבד (canManageData).
// הקצאה: UserManagement.js → role "🛎️ פקיד/ת קבלה".
// ⚠️ ReceptionistView.js קיים אך ORPHAN — App.js לא מרנדר אותו יותר (session 60).

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
| Voucher Reconciliation UI (session 51) | בנוי, לא נבדק חזותית | `VoucherReconciliationHub.js`/`VoucherImportPanel.js`/`VoucherExceptionsBoard.js` — `npm run build` נקי, dev server עלה נקי. login דמו (`eliad`/`1234`) נדחה ("שם משתמש או סיסמה שגויים") בסביבת הפיתוח הזו — לא ניתן היה לקליק-דרך אמיתי. **Mike צריך לעבור על "התאמת שוברים" עם login אמיתי** ולוודא את כל הזרימה: העלאה → שער מיפוי (אם רלוונטי) → תוצאות → דוח חריגים → פעולות אישור/דחייה. |
| Voice AI Phone Receptionist (Sprint 3, session 51) | 📝 תכנון בלבד — אין קוד | אדריכלות אושרה ברמת-גובה (webhook חדש `voice-ai-webhook` + טבלת `voice_call_logs` + tools מוגבלים `lookup_guest`/`get_room_status`/`create_task`). **לא להתחיל לכתוב קוד** לפני ש-Mike מכריע: (1) Vapi/Retell/אחר — גייטד על בדיקת עברית STT/TTS חיה, לא מחיר/פיצ'רים, (2) האם ה-PBX של המלון תומך בהעברת שיחה פעילה למספר חיצוני, (3) רשימת השדות הבטוחים ל-`lookup_guest` (מה מתקשר לא-מאומת רשאי לשמוע על אורח/חדר). ראה §10 session 51 לפירוט המלא של התוכנית. |

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

#### session 49 — 2026-06-26 (Voucher Reconciliation Engine — schema only)
> הקשר: יוזמה חדשה של Yelena — לאשש בין "דוח השוברים של EasyGo" (מה שהצוות בפועל הזמין) לבין דוחות ספק חיצוניים (Excel/PDF, מקור האמת למה שהאורח שילם עליו בפועל) ולתפוס פערים. כלל-יסוד: טראנקציה של 4 ספרות (מתעלמים מ-4 הספרות האחרונות במספר השובר **של EasyGo בלבד**) חלה רק על Hightech Zone/Dolce Vita/Pais Plus — כל ספק אחר (Hever/Nofshonit וכו') מחייב התאמה מדויקת ומלאה. **לא נגעתי ב-`ezgoParser.js`** — צינור נפרד לגמרי.

- ✅ **migration 091** — 4 טבלאות חדשות: `voucher_providers` (רישום ספקים + `match_mode` data-driven, מזוּרע ל-5 הספקים שצוינו), `voucher_provider_reports` (שורות דוח-ספק, מקור-אמת), `voucher_easygo_records` (שורות דוח-EasyGo, מה שהוזמן), `voucher_reconciliation_results` (תוצאת כל השוואה — דגם דו-סטטוס `match_status`/`review_status` כמו `spa_staging`). RLS authenticated, **ללא DELETE policy על אף אחת מהארבע** (נתון פיננסי-אדג'ייסנט — היסטוריה לא נמחקת, ספק מבוטל ולא נמחק).
- ✅ **`voucher_numbers_match()`** — הכלל מקודד כפונקציית SQL נטו, לא קוד אפליקציה: `truncate_4` חותך **4 התווים האחרונים מצד EasyGo בלבד** ומשווה לערך הספק; כל מצב לא-מוכר נופל ל-`exact` (fail-safe, לא fail-open).
- ✅ **`run_voucher_reconciliation(provider_batch, easygo_batch)`** — RPC (מראה את `upsert_inventory_items`/`sync_suite_arrivals`) שעובר על כל השורות בשני ה-batches וכותב כל תוצאה (גם matched, לא רק exceptions) ל-`voucher_reconciliation_results` — כולל הכיוון `missing_in_provider` (הוזמן ב-EasyGo בלי גיבוי בדוח הספק) שהוא הכיוון החשוב פיננסית.
- ✅ **Dynamic Onboarding — נמנע טבלת-זיכרון כפולה.** ההנחיה המקורית ביקשה לשמור מיפוי-עמודות שנלמד ב-`agent_memory` — נבדק ונדחה: `agent_memory`'s סכמה (`manager_id`/`rule_text`/`category`) מיועדת לחוקי AI-persona, לא למיפוי עמודות מבני. הוחלט להשתמש ב-`import_mapping_memory` הקיים (migration 049, `schema_key`+`header_signature`→`approved_mapping` JSONB) עם `schema_key` חדשים (`voucher_provider_report`/`voucher_easygo_report`) — בלי טבלה נוספת.
- ⚠️ **שכבת DB בלבד — לא נבדק חי, אין עדיין Edge Function/UI.** לא נוספו entries ל-`suggest-import-mapping`'s `SCHEMAS`, לא נכתבה קומפוננטת ייבוא/לוח-בקרה, לא נבדק `run_voucher_reconciliation` מול דאטה אמיתי. נפרס ל-DB החי (`npx supabase db push`, אומת חי דרך `npx supabase migration list` — 091 מופיע בעמודות local+remote). **נשאר לסשן הבא:** Edge Function לייבוא (suggest-import-mapping schemas) + קומפוננטת UI (ייבוא + לוח-בקרה אישור חריגות) + בדיקה חיה מול קובצי ספק/EasyGo אמיתיים.
  ✅ **session 50 — חלק ראשון נסגר:** ה-Edge Function (`reconcile-vouchers`) + שני schema entries ב-`suggest-import-mapping` נכתבו. **קומפוננטת UI ובדיקה חיה נשארות פתוחות** — ראה session 50 למטה.
  ✅ **session 51 — קומפוננטת UI נכתבה** (ראה למטה) — **בדיקה חיה מול קובצי ספק/EasyGo אמיתיים נשארת הפריט היחיד הפתוח.**
- ⚠️ **edge case ידוע, לא תוקן בכוונה:** אם שתי שורות מצד הספק חולקות בטעות את אותו מספר שובר, השורה השנייה תסומן `missing_in_easygo` (השובר התואם היחיד "נצרך" כבר ע"י הראשונה) במקום קטגוריה מדויקת יותר — עדיין גלוי לבדיקה אנושית, רק מתויג בצורה לא-מושלמת. תועד, לא טופל — מקרה נדיר.

#### session 50 — 2026-06-26 (Voucher Reconciliation Engine — Edge Function)
> הקשר: session 49 בנתה את שכבת ה-DB (migration 091) בלבד. הבקשה הפעם: ה-Edge Function שמקבל את שני הקבצים בפועל (multipart), פותר את מיפוי העמודות, כותב את השורות, ומריץ את ההתאמה.

- ✅ **`reconcile-vouchers/index.ts`** (חדש) — מקבל multipart/form-data: `easygoFile`/`providerFile` + `providerName` (מאומת מול `voucher_providers` החי, case-insensitive) + `providerMapping`/`easygoMapping` אופציונליים. פרסור Excel/CSV עם `xlsx@0.18.5` (אותה גרסה בדיוק כמו `package.json`'s תלות בפרונטאנד) — אין תקדים קודם לפרסור Excel בתוך Edge Function בריפו הזה (כל מקום אחר מפרסר בדפדפן).
- ✅ **`import_mapping_memory` נקרא/נכתב ישירות מתוך Edge Function — תקדים ראשון.** עד כה הטבלה הזו (migration 049) נקראה/נכתבה אך ורק מהפרונטאנד (`ArrivalImportPanel.js`'s `_headerSignature`/lookup/upsert) — `suggest-import-mapping` עצמו מעולם לא נגע בה, רק מציע mapping. הוחלט ש-`reconcile-vouchers` יבעל את הלוגיקה הזו (signature algorithm **זהה בדיוק** ל-`_headerSignature`: `[...headers].sort().join("␟")`) כי אין עדיין מסך-סקירה לפיצ'ר הזה — מישהו חייב לשאול את הזיכרון.
- ✅ **שער-אישור-אנושי נשמר בלי מסך-סקירה.** סדר פתרון מיפוי לכל צד בנפרד: (1) מיפוי מפורש בבקשה (מניח שאדם אישר אותו — resubmission עתידי ממסך סקירה, או בדיקה ידנית) → נכתב ל-`import_mapping_memory`, (2) זיכרון קיים לפי signature, (3) שניהם חסרים → קורא ל-`suggest-import-mapping` (שקיבל 2 schema_key חדשים: `voucher_provider_report`/`voucher_easygo_report`) להצעה, ומחזיר `needs_mapping_review` **בלי לכתוב שום שורה** — migration 049's הערה המפורשת ("never skips the human gate") חלה גם כשאין UI מוכן עדיין לקיים אותה; ההחלטה הייתה לחסום ולא לכתוב mapping לא-נבדק לטבלת אישוש פיננסי, על חשבון זה שהcontract הזה לא ניתן לבדיקה מלאה עד שתיכתב קומפוננטת UI.
- ✅ **Zero Data Loss על עמודות לא-ממופות.** כל header בקובץ שלא נכלל במיפוי הסופי נשמר ב-`raw_extras` JSONB של השורה (לא נעלם) — גם תאריך/סכום שלא הצליחו להתפענח (`_unparsed_purchaseDate`/`_unparsed_arrivalDate`) נשמרים שם במקום ליפול בשקט ל-NULL בלי עקבות.
- ✅ **דורש Bearer תקין — לא פורטל ציבורי.** בשונה מ-`guest-portal-data`/`inventory-portal-submit` (פורטלים ציבוריים ללא סיסמה, service-role בלבד), זה כלי-צוות פנימי — מאמת `Authorization` מול `supabase.auth.getUser()` (אותו pattern בדיוק כמו `process-knowledge/index.ts`) לפני כל עיבוד, ומשתמש ב-`user.id` כ-`created_by` על כל שורה.
- ✅ **נפרס לפרודקשן באותו סשן** — `npx supabase functions deploy reconcile-vouchers --no-verify-jwt` וגם `suggest-import-mapping` המעודכן (שתיהן, אחרי שזוהתה תלות-זמן-ריצה בין השתיים: ללא redeploy ל-suggest-import-mapping, ה-schema_key החדשים לא היו מוכרים לה בפרודקשן). נכתב ועבר רק בדיקת תקינות סטטית מקומית (אזון סוגריים/תחביר — אין Deno CLI מותקן בסביבת הפיתוח לבדיקת `tsc`/`deno check` מלאה); ה-`supabase functions deploy` עצמו הוא אימות התחביר האמיתי הראשון (קומפילציה מצליחה ב-Deno Deploy), אבל זה **לא** אימות לוגיקה — לא נשלחה אף בקשה אמיתית לפונקציה. **נשאר לסשן הבא:** קומפוננטת UI שמרכיבה את ה-multipart request + מסך סקירת מיפוי (לתרגם `needs_mapping_review`/`proposedMapping` למסך אנושי בפועל), ובדיקה חיה מול קובצי ספק/EasyGo אמיתיים.
  ✅ **session 51 — קומפוננטת UI + מסך סקירת מיפוי נכתבו** (ראה למטה). **בדיקה חיה מול קובצי ספק/EasyGo אמיתיים נשארת הפריט היחיד הפתוח** מכל הרשימה הזו.

#### session 51 — 2026-06-26 (Sprint 1 Voucher UI + Sprint 2 verification + Sprint 3 Voice AI planning)
> הקשר: סשן "XOS High-Efficiency Sprint" עם 3 ספרינטים מוגדרים מראש על ידי Mike, כל אחד מבוצע/מאומת בנפרד עם stop-and-wait לאישור בין שלב לשלב.

- ✅ **Sprint 1 — Voucher Reconciliation UI.** שלוש קומפוננטות חדשות מול ה-backend החי מ-session 50 (ראה §3 לפירוט מלא): `VoucherReconciliationHub.js` (shell, 2 sub-tabs), `VoucherImportPanel.js` (drag-and-drop, multipart אמיתי, שער `needs_mapping_review` עם `MappingReviewPanel`), `VoucherExceptionsBoard.js` (טריאז' עם פילטור/אישור-ישיר על `review_status`). route חדש `voucher_reconciliation` (admin/super_admin) + כפתור Sidebar "🧾 התאמת שוברים". `VOUCHER_PROVIDER_SCHEMA`/`VOUCHER_EASYGO_SCHEMA` נוספו ל-`importMapper.js`.
- ✅ **אומת:** `npm run build` → `Compiled successfully.`, אפס warnings חדשים. dev server עלה נקי (`webpack compiled successfully`). ⚠️ **לא אומת חזותית ע"י Claude** — login דמו (`eliad`/`1234`) נדחה ("שם משתמש או סיסמה שגויים") בסביבת הפיתוח הזו — אותה מגבלה בדיוק כמו session 47 (Inventory Hub). Mike אישר שהוא יבדוק ידנית עם login אמיתי.
- ✅ **Sprint 2 — אומת כ"כבר קיים", לא נכתב קוד.** WhatsApp Voice/Audio Ticket Support (`whapi-webhook` + `_shared/whapiMedia.ts`) כבר מומש במלואו ב-session 48 — נבדק בקריאת קוד (`Grep` על `transcribeVoice`/`fetchWhapiMedia`/`type === "voice"`) **לפני** שנכתבה שורת קוד אחת, נמנעה כפילות עבודה. Mike אישר וסימן Sprint 2 כ-COMPLETE.
- 📝 **Sprint 3 — Voice AI Phone Receptionist (Vapi/Retell) — תוכנית ארכיטקטורה בלבד, אין קוד.** הבקשה: העברת שיחות מהקבלה לסוכן AI קולי שמדבר עם אורחים, שולף דאטה מ-Supabase, פותח משימות. תוכנית שנמסרה ל-Mike (ממתינה לאישור):
  - **גשר טלפוניה — מחוץ ל-Supabase כליל.** הקבלה מעבירה (warm/cold transfer) למספר Twilio שעומד מאחורי Vapi/Retell. אין קוד Supabase כאן.
  - **Edge Function אחד חדש, לא שניים** — `voice-ai-webhook` (מראה את `whapi-webhook`'s ניתוב-פנימי-לפי-payload-type, לא צינור מקביל): tool-calls סינכרוניים (latency-קריטי, DB-בלבד, אין קריאת LLM בלופ) + call-lifecycle events אסינכרוניים. אימות בסוד משותף (`VAPI_WEBHOOK_SECRET`) — **לא** Supabase Auth JWT (אין session לשיחת טלפון).
  - **Tools מוגבלים, לא גישת טבלה גולמית** (אותו עיקרון כמו `guest-portal-data`'s safe-field list): `lookup_guest({phone?,room?,name?})` (לעולם לא payment/notes/claimed_by), `get_room_status({room})`, `create_task(...)` → `tasks.source='voice_call'` (אותו pattern של widening CHECK כמו כל source קודם) + Whapi ops group קיים, לא נתיב חדש.
  - **טבלה חדשה אחת** — `voice_call_logs` (אותו תפקיד audit כמו `whatsapp_conversations`/`notification_log` לערוצים שלהם) — שיחה שלא זוהתה כאורח עדיין נרשמת (Zero Data Loss, §0.1).
  - ⚠️ **3 הכרעות פתוחות ל-Mike לפני שנכתב קוד כלשהו:** (1) Vapi vs Retell vs אחר — **גייטד על בדיקת עברית חיה (STT/TTS)**, לא על מחיר/פיצ'רים. (2) האם ה-PBX של המלון בכלל תומך בהעברת שיחה פעילה למספר חיצוני. (3) רשימת השדות הבטוחים ל-`lookup_guest` — מה מתקשר לא-מאומת רשאי לשמוע על אורח/חדר.
  - דיאגרמת ארכיטקטורה (telephony bridge ← outside Supabase → `voice-ai-webhook` → guests/tasks/room_status קיימים + `voice_call_logs` חדש → Whapi ops group קיים) הוצגה ויזואלית ל-Mike באותו סשן.

#### session 88 — 2026-07-02 (Webhook Defensive Shield — 4-layer synchronization audit)
> הקשר: בקשה ל"אופטימיזציה הוליסטית" של `whatsapp-webhook` מול blueprint בן 4 שכבות: (1) Absolute Staff Override, (2) Defensive Shield (fallback/spam protection), (3) System Prompt Alignment (hard-coded interceptions), (4) Output Leakage Wall. הוראה מפורשת: לממש נקי בלי לשבור לוגיקה קיימת.

- ✅ **Audit לפני קוד — 3 מתוך 4 השכבות נמצאו כבר ממומשות במלואן**, ותועדו כאן לראשונה כי נכתבו ב-commits קודמים (`8b4ca84`, `7343137`, ועוד) בלי entry תואם בהיסטוריית הסשנים (documentation debt, לא קוד חסר):
  - **Layer 1 (Staff Override):** `guests.claimed_by` נבדק מיד אחרי guest lookup (מוקדם ביותר אפשרי — לפני זה אין guestId לבדוק); `_suppressGuestRepliesStaffClaim` module-level flag מוזרק ל-`sendReply()` (chokepoint יחיד לכל טקסט לאורח בקובץ) וגם ל-`sendStage2PayReply()` בנפרד; ברגע שclaim פעיל — `botIsActive`-style `continue` חוסם גם את קריאת ה-LLM לגמרי (0 עלות טוקנים), לא רק את השליחה.
  - **Layer 3 (Hard-coded Interceptions):** `handleSevereComplaintKillSwitch` (`SEVERE_COMPLAINT_PATTERN` — נהרס/הרסתם/אכזבה/גרוע וכו') + `handleSensitiveStayChangeHandoff`/`handleSensitiveFinancialHandoff` (late checkout/הארכה/חיוב כפול — `CANONICAL_STAY_CHANGE_HANDOFF_MSG`/`CANONICAL_FINANCIAL_HANDOFF_MSG`, טקסט "העברתי את הבקשה שלך לצוות לבדיקה" — תואם מילה-במילה את מה שהתבקש) + `handleOperationalInHouseIntercept`/`handleAdministrativeInHouseIntercept` (allowlist מלא: חלב/מים/קפה/מגבות/שלט/מזגן ועוד) — כולם עוקפים LLM לגמרי, כותבים `requires_attention`/`attention_reason`, ורצים גם pre-burst וגם post-burst (fragmented multi-message asks).
  - **Layer 4 (Output Leakage Wall):** `sendReply()`'s HARD DROP guard — `` ``` `` או `THOUGHT`/`REASONING` גולמי → ההודעה **לא נשלחת בכלל** (לא רק מנוקה); `sanitizeReply()` מסיר `{{PLACEHOLDER}}` לא-פתור + חוסם תשובה לא-עברית (>12 תווים בלי עברית).
- ✅ **Layer 2 (Defensive Shield) — היה חסר, מומש בסשן זה:**
  - `isLowValueCourtesyMessage()` חדש ב-`_shared/automationSchedule.ts` — `EMOJI_ONLY_PATTERN` (הודעה שכולה אמוג'י) + `COURTESY_ONLY_PATTERN` (תודה/הבנתי/סגור/היי/אוקי וכו', ללא טקסט נוסף אחרי המילה). `handleCourtesyAck()` ב-webhook יוצא בשקט (מתעד intent="courtesy_ack" ב-`whatsapp_conversations`, לא שולח שום reply) — נבדק pre-burst וגם post-burst, לפני כל שאר ה-Tier-0 classifiers, כדי שלא לצרוך טוקנים/להישמע רובוטי על "🙏"/"תודה" בודדים.
  - **Quiet Red-Alert על FAQ בביטחון נמוך** — נמצא שהמודל כבר מקבל הוראה (בשני מקורות פרומפט: `FALLBACK_SYSTEM_PROMPT` + `STRICT_HEBREW_LOCK_SUFFIX`) לענות במשפט קבוע ומדויק כשאין לו תשובה: "אני בודק את זה מול דלפק הקבלה...". חולץ ל-קבוע יחיד `LOW_CONFIDENCE_HANDOFF_SENTENCE` (מוזרק לשני המקורות, אין יותר שכפול). בנקודת השליחה הסופית: אם `reply` שווה למשפט הזה — `guests.requires_attention=true`+`attention_reason='שאלה מורכבת לצוות'` נכתבים, וה-`sendReply()`/insert ל-`whatsapp_conversations` **מדולגים** — האורח לא מקבל את משפט ה"אני בודק" החוזר, הצוות רואה בדג' אדום ולוקח את זה במקום. הבדיקה נעשית על ה-`reply` הסופי (אחרי pre-send safety nets/upsell gates) — self-correcting: אם קוד מאוחר יותר דרס את `reply` בתשובה ספציפית יותר, הדגל נופל אוטומטית בלי flag נפרד לתחזק.
  - `GuestAttentionBadge.js` — נוסף `REASON_META["שאלה מורכבת לצוות"]` (🤔) כדי שהבדג' יציג אייקון ייעודי במקום ה-fallback הגנרי 🔴.
- ✅ `npm run build` נקי (שינוי היחיד ב-`src/` הוא `GuestAttentionBadge.js`). **⚠️ Deno CLI לא זמין בסביבת הפיתוח — לא הורץ `deno check`/deploy בפועל; נדרש `supabase functions deploy whatsapp-webhook --no-verify-jwt` לפני שהשינוי חי.** ראה §12.

#### session 95 — 2026-07-03 (Stage 2 Pay placeholder-leak — split-brain log-vs-guest bugfix)
> הקשר: Mike דיווח screenshot בו הודעת אישור-הגעה הופיעה נכון ב-inbox log (עם קישור פורטל אמיתי) אך הגיעה לאורח בפועל עם `{{SPA_TIME}}`/`{{portal_url}}` גולמיים ולא-מפוענחים. הבקשה: single source of truth — מחרוזת אחת שמוזרקת גם לשליחה בפועל וגם ללוג.

- 🔍 **Audit:** נקראו כל 18 נקודות הקריאה ל-`sendReply()` + שני נתיבי אישור-הגעה (button-tap+typed) ב-`whatsapp-webhook` — כולם כבר משתמשים במשתנה יחיד (`arrivalReply`/`textArrivalReply`) לשני הצדדים; `sendTemplate()` (הפונקציה היחידה שדומה ל-bug הזה) נמצאה **dead code** (מוגדרת, אף פעם לא נקראת). התבנית הכללית תקינה — הבאג אותר בענף ספציפי אחד.
- ✅ **`resolvePaymentPlaceholders()` (Stage 2 Pay, שורה ~357) — פער אמיתי:** טיפלה רק ב-`GUEST_NAME`/`PAYMENT_AMOUNT`/`PAYMENT_LINK`/`WORKSHOP_URL`/`SPA_LINE` — בשונה מ-`resolvePlaceholders()` (stage_2_arrival) שמטפלת גם ב-`{{SPA_TIME}}` ו-`{{PORTAL_LINK}}`/`{{portal_url}}`. סגל שעורך `stage_2_payment_reply` ב-BotScriptEditor סביר שישתמש באותו אוצר-מילים תקני (הוא מתועד לכל שאר הסקריפטים) — תוקן: אותה לוגיקת graceful-fallback (substitute כשיש ערך, strip המשפט המכיל כשאין) הועתקה, כולל `payPortalLink` חדש (`buildPortalLink(guest?.portal_token)`) שמוזרק לקריאה.
- ✅ **`_shared/interactiveSend.ts` — פער מערכתי:** `sendCtaUrlButton()`/`sendInteractiveButtons()` הן שתי פונקציות ה-Meta-send היחידות בכל הקודבייס שדילגו על ה-Output Leakage Wall (`sanitizeReply()`'s `.replace(/\{\{[^}]+\}\}/g,"")` safety net, session 88 §Layer 4) — שולחות `bodyText` גולמי ישירות ל-Meta. נוסף `_stripUnresolvedPlaceholders()` (מקומי לקובץ, כמו `_isAbortError` — אותה קונבנציה מתועדת) ומופעל בשתי הפונקציות לפני בניית ה-payload.
- ✅ **Single source of truth בפועל:** `sendStage2PayReply()` מריץ כעת `sanitizeReply(paymentReply)` **פעם אחת** ל-`finalPaymentReply` — אותה מחרוזת בדיוק מוזרקת גם ל-`sendCtaUrlButton`/`sendReply` (מה ש-Meta בפועל שולח) וגם ל-`insertGuestOutboundIfNotMuted` (מה ש-`whatsapp_conversations` מציג ב-inbox). אין יותר עותק לא-מסונן ללוג ועותק מסונן לשליחה (או ההפך).
- ⚠️ **`_shared/interactiveSend.ts` משותף ל-3 functions** — `whatsapp-webhook` + `whatsapp-send` + `staff-ops-webhook` — כל השלושה דורשים redeploy (לא רק whatsapp-webhook). Deno CLI לא זמין בסביבת הפיתוח — לא הורץ `deno check` מקומי; ה-deploy עצמו הוא אימות-התחביר הראשון.

#### session 90 — 2026-07-02 (Operations Channel — automatic Hebrew→English translation layer, gap closure)
> הקשר: `routing_config` (migration 121) ו-`_shared/fieldOpsTranslation.ts` כבר היו פרוסים ומחווטים חלקית (`notify-manual-task`, `whatsapp-webhook`'s `routeGuestRequestToOpsGroup`) — אבל שלוש נקודות דיספאץ' נוספות לקבוצת "קריאות" (operations, SLA-tracked) עדיין שלחו `tasks.description` גולמי (עברית) ישירות ל-Whapi. audit לפני קוד מצא את הפער; לא נכתבה תשתית חדשה — נעשה reuse מלא של `translateTextForFieldOps`/`containsHebrew` הקיימים, באותו pattern בדיוק כמו `notify-manual-task`.

- ✅ **`whapi-webhook/index.ts`** — `buildTaskCard()` קיבל תרגום לפני שליחה: `cls.task_description` (Tier-0 regex parse, למשל `"11- מגבות"`) עובר `translateTextForFieldOps` כש-`containsHebrew()`; Tier-1 (`classifyWithAi`) כבר כפוי לאנגלית ע"י ה-tool schema שלו, אז השורה הזו פשוט מדלגת עליו. `tasks.description` ב-DB (נכתב קודם, לא נגע בו) נשאר בשפת המקור.
- ✅ **`sla-escalation-cron/index.ts`** — כרטיס ה-SLA BREACH לקבוצת האופס (ה-branch `else` שאינו `guest_request`) מתרגם את `task.description` לפני בנייתה — אותו gate `containsHebrew`. ה-DM האישי ל-`SLA_OPS_ALERT_PHONE` (branch `guest_request`, מיועד למנהל דובר עברית ולא לקבוצת השטח) **לא נגעתי בו** — מחוץ לתחום הבקשה (dispatch לקבוצה, לא DM אישי).
- ✅ **`task-action/index.ts`** — שני המסלולים היחידים ששולחים ל-`WHAPI_GROUP_ID` (אין בקובץ הזה ניתוב per-intent): "⚡ MANAGER BUMP" ו-echo האישור אחרי Accept/Complete — שניהם מתרגמים כעת את `task.description` באותו pattern; ה-HTML interstitial (`taskBox`, מוצג בדפדפן לצוות, לא נשלח ל-Whapi) לא נגעתי בו — מחוץ לתחום.
- ✅ **`guest-portal-ops-request/index.ts` נבדק ונשאר ללא שינוי בכוונה** — מנתב ל-"requests" board (`בקשות אורחים`), לא "operations" (`קריאות`) — ערוץ נפרד לחלוטין לפי ה-Mike directive שמתועד ב-`routingConfig.ts`'s header comment; מחוץ לתחום הבקשה.
- ✅ **Zero DB change** — בשלושת הקבצים, המשתנה המתורגם הוא עותק מקומי לבניית הודעת Whapi בלבד; `tasks.description` (הנקרא ע"י `GuestsPage`/`OperationsBoard`/`WhatsAppInbox` בעברית) לא נכתב מחדש באף אחד מהם.
- ✅ **נפרס לפרודקשן** — `git push` (8279bf6) + שלושת ה-functions נפרסו בנפרד (`whapi-webhook`/`sla-escalation-cron`/`task-action`, כולם `--no-verify-jwt`), כל אחד סיים עם "Deployed Functions" נקי. Deno CLI לא זמין בסביבת הפיתוח — אין `deno check` מקומי, ה-deploy עצמו (קומפילציה מוצלחת ב-Deno Deploy) הוא אימות-התחביר הראשון. **לא נבדק חי** — מחכה לדיווח אמיתי (עברית) בקבוצת "קריאות" כדי לוודא שהכרטיס חוזר באנגלית.

#### session 67 — 2026-06-30 (Stage 4 optional check-in gate)
> הקשר: Stage 4 לא נשלח כי האורח לא ב-`checked_in` — נכון תפעולית, אבל הצוות עדיין לא מסנכרן סטטוסים.

- ✅ **migration 110** — `automation_stages.require_checked_in BOOLEAN DEFAULT true`; `mid_stay` seeded `false` (שליחה לפי תזמון בלבד עד הפעלה מחדש).
- ✅ **`automationSchedule.ts`** — `checkEligibility` מדלג על `not_checked_in` כש-`require_checked_in=false`.
- ✅ **`StageCard`** — מתג "דרוש צ׳ק-אין לפני שליחה" על שלב 4 במסע האורח.
- ✅ `npm run build` נקי.

#### session 66c — 2026-06-30 (Live Queue by arrival day + Stage 4 visibility fix)
> הקשר: תור חי לא מסודר לפי תאריך הגעה; Stage 4 (mid_stay) נעלם כי `not_checked_in` סומן `skipped` והוסתר ב-UI.

- ✅ **`automation-queue`** — `arrivalDate`/`departureDate`/`sequenceOrder` בכל שורה; `not_checked_in` וסיבות זמניות → `pending` (לא `skipped`); סינון `PERMANENT_SKIP_REASONS`.
- ✅ **`AutomationControlCenter.js`** — קיבוץ לפי יום הגעה (כרטיס יום → אורח → שלבים בסדר pipeline); תוויות עברית ל-`skipReason`; הסרת מגבלת 100 שורות; ימים עברו מקופלים.
- ✅ `npm run build` נקי.

#### session 65 — 2026-06-30 (Automation Queue ↔ Timeline sync)
> הקשר: מסע האורח הציג שלבים נכון אבל תור חי+מוניטור לא התעדכן אחרי שינויי שלבים — פער בין שני הטאבים.

- ✅ **`mergeQueueWithStages` + `isCronScheduledStage`** — תור חי מסונן לפי `automation_stages.is_active` הנוכחי (מצב Timeline) ומשתמש בשמות/שלבים עדכניים; שלבי `event_immediate` (Stage 2 Arrival/Pay) מוצגים בנפרד — לא בתור cron.
- ✅ **`scheduleQueueRefresh`** — אחרי כל `patchStage` מוצלח, רענון אוטומטי של `automation-queue` (debounce 600ms).
- ✅ **פעימת חיים** — "שלבים בתזמון cron" נפרד מ-"שלבים מיידיים (webhook)"; אזהרת core pipeline מבוססת cron בלבד.
- ✅ `npm run build` נקי.

#### session 64 — 2026-06-30 (Automation Queue tab — live filter + Meta pending dismiss)
> הקשר: תור חי הציג פריטים שכבר נשלחו; שורות `blocked_by_meta` נשארו תקועות בלי דרך לנקות מהתצוגה.

- ✅ **`AutomationControlCenter.js` Queue tab** — `QUEUE_FINALIZED_STATUSES` (`sent`/`simulated`/`skipped`) מסוננים מתצוגת "בתור" + מוני סגמנטים; היסטוריה נשארת בטאב "מה נשלח".
- ✅ **`blocked_by_meta` panel** — 🗑️ לכל שורה + "נקה הכל"; משתמש ב-`dismissedAttentionKeys` הקיים (session-only, לא כותב DB). אקורדיון "דורש טיפול" מציג רק `failed`/`timeout` (לא כפילות עם פאנלים ייעודיים).
- ✅ `npm run build` נקי.

#### session 63 — 2026-06-30 (Autonomous Deploy Protocol)
> הקשר: Mike — בסוף כל סשן להציע ולהריץ (באישור) commit+push+db+functions, לא רק טבלת פקודות.

- ✅ **`.cursorrules` + `CLAUDE.md` §12/§13** — פרוטוקול העלאה אוטונומית: checklist + הצעה מפורשת + הרצה בטרמינל באישור; `npm run build` לפני commit כש-`src/` השתנה.

#### session 62 — 2026-06-30 (Smart Guest Profile — structured JSONB + modal + AI)
> הקשר: מעבר מ-`guest_notes` גולמי ב-UI לפרופיל מובנה; אייקון אדום נשאר כנקודת כניסה; inbox נקי.

- ✅ **migration 109** — `guests.guest_profile JSONB NOT NULL DEFAULT '{}'`, GIN index `idx_guests_profile_gin`.
- ✅ **`src/data/guestProfileSchema.js`** — תגיות VIP/אירוע/תזונה/הגעה, `normalizeGuestProfile`/`serializeGuestProfile`/`formatGuestProfileForAi`.
- ✅ **`GuestProfileModal.js`** — מודל מובנה + `arrival_time` + היסטוריית מערכת מתקפלת (read-only `guest_notes`).
- ✅ **`GuestAttentionBadge.js`** — אותו אייקון 🔴/🗓️/📞, פותח `GuestProfileModal`; "שמור וסמן כטופל".
- ✅ **`AddGuestModal.js`** — הוסר עורך `guest_notes`; כפתור "📋 פרופיל אורח חכם" בעריכה.
- ✅ **`WhatsAppInbox.js`** — באנר הערות הוסר לחלוטין.
- ✅ **`whatsapp-webhook`** — `_shared/guestProfile.ts` + `buildGuestStageContext()` מזריק פרופיל (לא לוג audit).
- ✅ `npm run build` נקי.

#### session 61 — 2026-06-30 (WhatsApp Inbox — guest notes + scroll overlap fix)
> הקשר: באנר `guest_notes` הצהוב חסם את ההודעות בשיחה (append-only audit log ארוך) ולא ניתן היה לסגור אותו.

- ✅ **`WhatsAppInbox.js`** — הערות אורח מקופלות כברירת-מחדל (פס דק "לחץ להצגה"); כפתור ✕ לסגירה; `minHeight:0` על אזור ה-scroll תיקן באג flex שגרם לחפיפה; בועות הודעה מעט גדולות יותר (15px). `npm run build` נקי.

#### session 60 — 2026-06-29 (Receptionist RBAC + Record-Only ETA + Suite Management routing)
> הקשר: סנכרון תיעוד + לוגיקת בוט חיה — receptionist כתפקיד תפעולי מלא; עדכוני שעת הגעה בלי התראות צוות; בקשות סוויטה עתידיות לקבוצת ניהול עם תרגום אנגלי.

- ✅ **Receptionist RBAC (`src/utils/auth.js` + `App.js`).** `receptionist` = Sidebar מלא; `receptionistOk` על wa_inbox/data_sync/vouchers; `canAccessRoute` ל-data_sync+voucher_reconciliation; `create_ops_task` ב-OperationsBoard. חסום: admin/bot_* /automation_center/cms/users_mgmt + seed/clear גלובלי (super_admin בלבד). `ReceptionistView.js` orphan.
- ✅ **Record-Only ETA (migration 108 + `whatsapp-webhook`).** `guests.arrival_time` TEXT; regex extract → `arrival_time` + `guest_notes` audit; Hebrew ack; no needs_callback/alerts/ops.
- ✅ **Future suite routing (`_shared/futureSuiteRoomServiceRouting.ts`).** `120363429859248777@g.us`; guest-portal-ops-request + sla-escalation-cron; LLM Hebrew→English לפני Whapi על נתיב זה.

#### session 59 — 2026-06-28 (needs_callback decouple + deploy protocol)
> הקשר: Mike — `needs_callback` היה מכבה את הבוט (cron + webhook) בזמן שצוות עדיין צריך את הדגל האדום ב-UI. הופרד: דגל התראה בלבד, בוט ממשיך.

- ✅ **`_shared/automationSchedule.ts`** — הוסר `needs_callback_open` מ-`checkEligibility()` → cron שולח גם לאורחים עם `needs_callback=true` (עדיין חוסם `cancelled` + already_sent).
- ✅ **`whatsapp-webhook/index.ts`** — הוסר human-handoff gate שעשה `continue` (שתק את ה-LLM). Webhook עדיין **כותב** `needs_callback=true` על בקשות אנושיות.
- ✅ **`AddGuestModal.js`** — תווית checkbox: `"ממתין לטיפול צוות 🔴"` (הוסר "בוט שותק").
- ✅ **`CLAUDE.md` §12–§13 + `.cursorrules`** — חובת Deploy checklist בסוף כל סשן; עדכון Zero-Spam Policy + תיעוד `needs_callback`.
- ⚠️ **לא נפרס עדיין** — Mike: `git push` (frontend) + `functions deploy whatsapp-webhook whatsapp-cron automation-queue` (ראה §12).

#### session 57 — 2026-06-28 (System Audit & Cleanup — Security, Segmentation Bug, Dead Code, Docs)
> הקשר: audit מקיף לאחר סיום ה-"Manual Dispatcher, Segmentation Engine, Security Purge, Feedback Routing" sprint — ארבעה ממצאים אמיתיים, כולם תוקנו בסשן זה.

- ✅ **Security Purge.** (1) `App.js`: הוסרו `MOCK_USERS` array (42-69), ה-check block שבדק אותם לפני Supabase Auth ב-`handleLogin` (730-735), ו-JSX table שהציג credentials על מסך הlogin (792-822). (2) `AdminPanel.js`: הוסרה `mockUsers` prop + JSX table "משתמשי דמו (Mock)" מ-`UsersTab`. (3) `invite-user/index.ts`: הוסר default password `"1234"` — מוחלף באימות מפורש `password.length >= 8` עם שגיאה ברורה בכשל. כל שלושת ה-builds עברו נקיים.
- ✅ **Bug fix — scene/CTA two-level segmentation (`guest-portal-data/index.ts`).** PostgREST `cs` (array-contains) filter ב-DB-level ל-`portal_scenes` הוסר. סיבת הבאג: ה-filter הוחל לפני שCTAs נבדקו בכלל — סצנה עם `visibility_settings=['suite','day_guest']` שהייתה **אמורה** לעבור ל-day_guest נפלה בגלל CTA פנימי שהיה restricted. **תיקון**: (1) Level 1 (scene visibility) — לולאה ב-JS: אם `scene.visibility_settings` לא כולל `guestRoomType` → `continue`. (2) Level 2 (CTA visibility) — filter על `ctas[]` של כל סצנה שעברה Level 1: CTA ללא `visibility` key = כולם רואים; CTA עם `visibility` = רק room_types ברשימה. הסצנה עצמה תמיד נשלחת אם עברה Level 1 — גם אם כל CTAs סוננו. `npm run build` נקי, `npx supabase functions deploy guest-portal-data --no-verify-jwt` נפרס.
- ✅ **Day-pass Stage 5 audit.** `checkout_fb` כבר נמצא ב-`DAY_PASS_ALLOWED_TRIGGERS` (whatsapp-send) וב-`DAY_PASS_ALLOWED_STAGES` + `DAY_PASS_ALLOWED_FOR_MODAL` (AutomationControlCenter) — אין שינוי לוגי נדרש. תיקונים: (1) banner text "שלושה שלבים בלבד" → "ארבעה שלבים בלבד" (`AutomationControlCenter.js:1430`). (2) code comment ב-whatsapp-send (lines 764-768) עודכן לכלול Stage 3 (morning_welcome) שהיה חסר. committed+pushed (3585ea8).
- ✅ **Dead code removal.** `predictedChannel` — משתנה שהוקצה ב-`ManualDispatchModal` (AutomationControlCenter.js:757) מ-`item.predictedChannel` אבל לא נוצל בפונקציה (JSX משתמש ב-`q.predictedChannel` ישירות, לא ב-local var). הוסר. Build עבר עם `Compiled successfully.` ואפס warnings.
- ✅ **GIN index verification (migrations 097 + 098).** שני indexes אומתו בקריאת migration: `idx_upsell_items_visibility ON upsell_items USING GIN (visibility_settings)` (097) + `idx_portal_scenes_visibility ON portal_scenes USING GIN (visibility_settings)` (098). שניהם כוללים inline DO $$ self-tests שרצו בזמן ה-deploy ועברו.
- ✅ **CLAUDE.md עודכן** — header, GuestPortal.js/PhotoTour.js/PortalSettingsPanel.js entries, guest-portal-data (two-level), migration list (091-098), DB tables (upsell_items/portal_scenes), session history.

#### session 56 — 2026-06-27 (Master template variable sync — dream_suite_reminder + dream_welcome_morning)
> הקשר: שלושה פערים בטעינת משתנים דינמיים לתבניות WhatsApp שנשלחות אוטומטית.

- ✅ **`resolveDayTimings(arrivalDateStr)`** (פונקציה sync חדשה, לפני `PIPELINE_VARS`) — קובעת `{entryTime, checkInTime}` לפי יום השבוע של `arrival_date`: שבת (`getUTCDay()===6`) → 15:00/18:00, כל יום אחר → 12:00/15:00. מחשב מ-UTC midnight על ה-DATE column — מניעת timezone-shift (אותה קונבנציה כמו `isSpecialNightBeforeDay()`). פועל על ה-DATE string ישירות, אפס קריאות DB.
- ✅ **`PIPELINE_VARS["morning_suite"]`/`PIPELINE_VARS["morning_welcome"]`** עודכנו: מחזירים כעת `[name, entryTime, checkInTime]` ({{1}}/{{2}}/{{3}}) במקום `[name]` בלבד. שלושת המשתנים עוברים `sanitizeTemplateVars()` הקיים — {{1}} נופל ל-"אורח יקר" כבר, {{2}}/{{3}} נופלים ל-"-" אם `arrival_date` חסר (edge case שלא אמור לקרות בפרודקשן).
- ✅ **`PORTAL_BUTTON_TRIGGERS`** (Set חדש) — מחליף את ה-`trigger === "night_before"` המצומצם: `{night_before, morning_suite, morning_welcome}`. כל שלושת הטריגרים מזריקים כעת את `portal_token` כ-`buttonUrlParam` ל-`sendViaTemplate`. `undefined` (לא `""`) כשהטוקן חסר — אותה קונבנציה שמונעת שליחת כפתור עם link מת.
- ✅ **`resolveNightBeforeTimes()` — Shabbat fallback** (במקום throw): ה-`if (!entryTime || !checkInTime)` שזרק `Error` כשמפתחות `bot_config.night_before_entry_time_shabbat`/`night_before_checkin_time_shabbat` ריקים — הוחלף ב-`console.warn` + `return { entryTime: entryTime || "15:00", checkInTime: checkInTime || "18:00" }`. אורח שמגיע בשבת כשהconfig ריק מקבל את ההודעה עם שעות ברירת-המחדל במקום לא-לקבל-כלום (FAIL VISIBLE §0.3 — שגיאה שהיתה נשארת שקטה ב-Automation History כ-"failed" ועכשיו הופכת ל-warn עם הודעה מפורשת בלוגים).
- ✅ `npm run build` → `Compiled successfully.`, אפס warnings חדשים. `npx supabase functions deploy whatsapp-send --no-verify-jwt` → `Deployed Functions on project bunohsdggxyyzruubvcd: whatsapp-send`. committed (c75a919) + pushed ל-main.

#### session 55 — 2026-06-27 (Meta template IMAGE header fix — dream_suite_reminder #132012)
> הקשר: שגיאת Meta API `"header: Format mismatch, expected IMAGE, received UNKNOWN"` כשמנסים לשלוח תבנית `dream_suite_reminder` (ואחרות עם Media Header מסוג IMAGE). הסיבה: `sendViaTemplate` ו-`sendTemplate` בנו את מערך ה-`components` עם `body`/`button` בלבד — ה-`header` component נדרש ע"י Meta לכל תבנית עם IMAGE header, ובלעדיו Meta לא מצליח לזהות את סוג ה-header.

- ✅ **`TEMPLATE_IMAGE_HEADERS` map** נוסף בכל אחת משתי פונקציות השליחה (לא ב-`_shared/` — קונבנציית הריפו לדפליקציה מקומית per-function). מכיל `dream_suite_reminder: "https://tzalamnadlan.co.il/wp-content/uploads/2026/default-resort.jpg"`. כשתיווסף תבנית image-header חדשה בעתיד — מוסיפים שורה אחת לmap בכל אחד משני הקבצים.
- ✅ **`sendViaTemplate`** (`whatsapp-send/index.ts`) — בונה כעת `{ type: "header", parameters: [{ type: "image", image: { link: url } }] }` **לפני** ה-body/button אם `TEMPLATE_IMAGE_HEADERS[templateName]` קיים. ללא שינוי ב-call sites — שינוי פנימי, טיפול בנתוני תבנית.
- ✅ **`sendTemplate`** (`whatsapp-webhook/index.ts`) — אותו תיקון (map נקרא `_TEMPLATE_IMAGE_HEADERS` כדי להימנע מהתנגשות עם namespace גלובלי אפשרי בקובץ הגדול).
- ✅ נפרס: שני הfunctions לפרודקשן (`exit_code: 0`).

#### session 54 — 2026-06-27 (Voucher Reconciliation Engine — synthetic validation + voucher_numbers_match() bugfix)
> הקשר: בקשה לאמת את מנוע ה-reconciliation ע"י בדיקות סינתטיות לפני הרצה על קבצים אמיתיים. בתהליך הביקורת התגלה באג אמיתי בפונקציית ה-SQL.

- ✅ **ביקורת קוד מלאה (Phase 1, read-only לפני שנכתב קוד)** — נקראו: `migration 091`, `reconcile-vouchers/index.ts`, `VoucherImportPanel.js`, `VoucherExceptionsBoard.js`, `VoucherReconciliationHub.js`, `importMapper.js`. **ממצא מרכזי:** `voucher_numbers_match()` (migration 091 §5) השתמש ב-`left(v_easygo_norm, length(v_easygo_norm) - 4)` שחותך 4 *תווים* אחרונים — אבל כשה-EasyGo voucher מכיל מפריד (`'999888-4321'`), הקיצוץ משאיר `'999888-'` (עם מקף, 7 תווים) שלא שווה ל-`'999888'` (6 תווים) של הספק. הספציפיקציה בCLAUDE.md §10 session 49 אומרת "the last 4 DIGITS of the EasyGo voucher ID" — מפרידים צריכים להיות מנוטרלים לפני הקטיעה.
- ✅ **migration 092** (`supabase/migrations/092_voucher_match_fix.sql`) — `CREATE OR REPLACE FUNCTION voucher_numbers_match(...)` עם שלב נרמול חדש ב-`truncate_4` mode: `regexp_replace(v_easygo_norm, '[^A-Z0-9]', '', 'g')` ו-`regexp_replace(v_provider_norm, '[^A-Z0-9]', '', 'g')` על שני הצדדים לפני הקטיעה — מבטיח ש-`'999888-4321'`→alnum `'9998884321'`→truncate→`'999888'` = provider `'999888'` ✅. `exact` mode (Hever/Nofshonit) **לא שונה** — נשאר השוואה מלאה case-insensitive. Migration כולל `DO $$ ... $$` inline self-test של 8 cases שמריץ **בזמן ה-deploy עצמו** וכושל בצורה גלויה (`RAISE EXCEPTION`) אם אחד מהם נכשל — הmigration לא יכול לעבור בשקט עם פונקציה שבורה.
- ✅ **`supabase/tests/voucher_reconciliation_e2e_test.sql`** (חדש, תיקיית `supabase/tests/`) — 5 תרחישים מלאים שעוטפים הכל ב-`BEGIN`/`ROLLBACK` (אין שורות קבועות בproduction):
 - **Scenario A** (Hightech Zone / truncate_4): `'999888'` vs `'999888-4321'` → `matched` + `match_basis='truncate_4'` ✅
 - **Scenario B** (Hever / exact): `'999888'` vs `'999888-4321'` → `missing_in_easygo=1` + `missing_in_provider=1` (אי-התאמה כדין) ✅
 - **Scenario C** (package_mismatch): אותו שובר, `package_type` שונה → `package_mismatch=1` ✅
 - **Scenario D** (missing_in_provider): שורת EasyGo ללא גיבוי ספק → `missing_in_provider=1` ✅
 - **Scenario E** (unparseable): שורת ספק עם `voucher_number=NULL` → `unparseable≥1` (Zero Data Loss §0.1) ✅
- ✅ **ביקורת `VoucherExceptionsBoard.js`** — ✓ כפתורי הפעולה מוצגים ברור לשורות `pending` (3 כפתורים: אישור/טופל/דחייה). ✓ `updateReviewStatus()` מעדכן **רק** `review_status` + `reviewed_by` + `reviewed_at` — אין מחיקה, אין שינוי `match_status`/`discrepancy_note`/FK refs/`match_basis` (Zero Data Loss §0.1 מלא). ✓ שגיאת DB → `showToast("err", ...)` (FAIL VISIBLE §0.3). ✓ ערך `review_status` לא-מוכר מוצג כ-`⚠ ${r.review_status}` (FAIL VISIBLE). **אין שינויי קוד נדרשים.**
- ✅ `npm run build` נקי — אפס warnings חדשים (migration 092 + test script = שינויי SQL/test בלבד, אין שינוי JS).
- ✅ `npx supabase db push` הריץ migration 092 — self-tests עברו inline בזמן ה-push.

#### session 53 — 2026-06-27 (Real-time Meta template sync buttons — WhatsAppInbox + BroadcastDashboard)
> הקשר: רשימת התבניות המאושרות ב-Inbox template modal וב-Broadcast Module נטענה פעם אחת בלבד (on-mount), ולא הייתה דרך לרענן אותה בלי לרענן את הדף — כך שתבניות שאושרו חדש ב-Meta לא היו נראות לסגל.

- ✅ **Audit (Phase 1, קריאה בלבד לפני כל קוד)** — אומת שה-`get-wa-templates` Edge Function כבר קורא ל-Meta API חי בכל קריאה (ללא caching). אין מערך hardcoded. הבעיה: `useEffect([], [])` חד-פעמי בשני הקומפוננטות, ואין כפתור סינכרון.
- ✅ **`WhatsAppInbox.js` (NewChatModal)** — הלוגיקה הוחלפה מ-`useEffect` חד-פעמי ל-`useCallback fetchTemplates` + `useEffect([fetchTemplates])`. נוסף state `tmplSyncOk` (boolean, מתאפס אחרי 2.5s) לפידבק ויזואלי מיידי. כפתור "🔄 סנכרן תבניות" נוסף בשורה עם "📋 בחר תבנית" — disabled+spinner כשנטען (Disable Don't Hide, §0.2), "✓ עודכן" כשמצליח, error banner קיים ממשיך לפעול כרגיל בכשל (FAIL VISIBLE, §0.3).
- ✅ **`BroadcastDashboard.js`** — אותו pattern: `useCallback fetchTemplates` + `useEffect([fetchTemplates])`. כפתור "🔄 סנכרן תבניות" ליד label "בחר תבנית" בcards התבניות. בהצלחה → `showToast("ok", "✓ התבניות עודכנו בהצלחה")` (הקומפוננטה כבר מחזיקה `showToast` כ-`useCallback` יציב — נכנס כ-dependency בטוח). בכשל → `showToast("err", ...)` + `templateFetchError` banner קיים.
- ✅ **`npm run build` נקי** — `Compiled successfully.`, אפס warnings חדשים. committed (8251e4a) + pushed ל-main → Vercel auto-deploy.
- ✅ **bugfix (session 53 addendum) — `get-wa-templates` Edge Function תוקן ונפרס (f6f2a5c):** תבניות מאושרות חדשות (כגון `dream_suite_reminder`) לא הופיעו ב-UI למרות הסנכרון. שני גורמים: (1) `?status=APPROVED` ב-URL של Meta API מתמסמס — Meta יכול להחמיץ תבניות שאושרו לאחרונה; (2) פגינציה לא טופלה — `limit=50` עם `json.paging?.next` לא נעקב. **תיקון:** הוסרה פרמטר `status=APPROVED` מה-URL (תמיד מביאים הכל), הוספה פגינציה (עוקב `paging.next` עד 10 עמודים), הסינון ל-APPROVED מבוצע כעת בתוך ה-Edge Function (לא בURL) לפני החזרת התוצאה. ה-`fetchAll=true` (TemplateManagerPanel) ממשיך להחזיר כל הסטטוסים. אין שינוי בלוגיקת הפרונטאנד.

#### session 52 — 2026-06-26 (RESORT_UI_MANIFEST.md + automated repair pass)
> הקשר: Mike ביקש (כ"Senior UI/UX Resort Management Expert") מסמך מקור-אמת נפרד לפילוסופיית UI/UX + checklist מוכנוּת-לשבים, ואז סקירת תקינות גבוהה-רמה על הפרונטאנד. לאחר שהממצאים תועדו, Mike ביקש (ב"step away" אחד) repair pass אוטונומי על הממצאים, עם constraints מפורשים: לא לגעת ב-`ezgoParser.js`, לא לתקן עכשיו את ה-CSS-variable drift (~150 hardcoded hex), `npm run build` אחרי כל קובץ, commit+push בסוף.

- ✅ **`RESORT_UI_MANIFEST.md`** (root, חדש) — §1 פילוסופיית UI/UX (הפרדה מוחלטת UI↔UX, Staff UX psychology — certainty/speed/silence/Red-Yellow-Green, Guest UX psychology — effortless/pampering/frictionless), §2 Tab Directory עם סטטוס מוכנות per-route (cross-referenced מול `App.js`'s switch statement בפועל, לא מהזיכרון), §3 ממצאי הסקירה החיה, §4 self-maintenance rule. מתחזק את עצמו — ראה למטה.
- ✅ **שני Explore agents במקביל** סקרו (1) missing/weak error states מול עקרון FAIL VISIBLE (§0.3) ב-16 קומפוננטות admin/staff, (2) tablet/responsive risk + CSS-variable drift + console-warning patterns. הממצאים הגבוהים-severity אומתו ישירות (`Grep`) לפני שנכתבו ל-manifest — לא נלקחו כ-given מה-agent.
- ✅ **6 תיקוני Fail Visible (כולם build-verified בנפרד):**
  - `AdminPanel.js` StatsTab — `catch` הוסיף `error` state אמיתי (`e.message`) + banner אדום; לפני כן `stats=null` הציג "—" בכל הכרטיסים בלי שום אינדיקציה שזו כשל ולא "אין דאטה".
  - `AdminPanel.js` ChatsTab — `.then(({data}))` בודק כעת גם `error`, מציג banner במקום רשימה ריקה זהה ל"אין שיחות עדיין".
  - `WhatsAppInbox.js` — תיקון כפול: (1) `Promise.all` של template fetch (`get-wa-templates`+`message_templates`) בודק כעת `error` משני הצדדים → `tmplLoadError` state, banner נפרד מ-"לא נמצאו תבניות מאושרות" (היה אותו state בדיוק, אי אפשר היה להבדיל כשל מ-"אין תבניות"). (2) `handleSendTemplateAudience` — היה `catch (_) {}` גורף **וגם** אפס מעקב כשל ל-non-exception failures (`!data?.ok`); נוסף `tmplBulkFailures` (אותו pattern בדיוק כמו `bulkFailures` הקיים ב-free-text bulk send, session 25) שמדווח גם כשל-exception וגם תשובה-נקייה-אבל-לא-מוצלחת.
  - `AutomationControlCenter.js` `fetchMetaTemplates` — `console.warn` → `showToast("err",...)` הקיים של הקומפוננטה (אותו toast שכל שאר fetchStages/saveSessionMessage כבר משתמשים בו — לא הומצא מנגנון חדש).
  - `InventoryImportPanel.js` — מיפוי-זיכרון (`import_mapping_memory` upsert) שנכשל היה `console.warn`-בלבד; כעת `showToast("err",...)` עם טקסט שמבהיר שהייבוא הנוכחי לא נפגע (זה best-effort, לא חוסם) — רק שהייבוא הבא לא יציע את המיפוי אוטומטית.
- ✅ **3 תיקוני tablet layout (כולם build-verified בנפרד):**
  - `RoomBoard.js:416` — stat row `repeat(5, 1fr)` (ללא media query) → `repeat(auto-fit, minmax(120px, 1fr))`. **בונוס שהתגלה בדרך:** `STATUSES` מכיל 6 ערכים, לא 5 — הgrid הקשיח-ל-5-עמודות גרם לתפיסה השביעית/השישית לעבור לשורה נפרדת לבדה **גם בדסקטופ ברוחב מלא**, לא רק בטאבלט. התיקון סוגר את שתי הבעיות יחד.
  - `HousekeepingTabletView.js:287` — אותו תיקון, `repeat(auto-fit, minmax(150px, 1fr))` (minmax רחב יותר כי התוויות דו-לשוניות HE/EN ארוכות יותר).
  - `AICopilot.js` — נוסף `isNarrowViewport` state (`window.innerWidth<=768` + resize listener); ה-anchor הברירת-מחדל (לא-נגרר) מזנק מ-`bottom:24px` ל-`bottom:88px` כדי לפנות מקום מעל `.mobile-bar` הקבוע (`App.js`). מיקום שנגרר ע"י משתמש (`pos` ב-localStorage) **לא** נוגע בו — מי שגרר את הפעמון בעצמו כבר בחר מיקום מכוון, בכל רוחב מסך.
- ⚠️ **נשאר פתוח בכוונה (out of scope, לפי הנחיית Mike):** CSS-variable drift (~150 hardcoded hex, הכי בולט ב-`BroadcastDashboard.js`/`ArrivalImportPanel.js`/`AutomationControlCenter.js`) ו-`AutomationControlCenter.js`'s `@media (max-width:640px)` החסר-כיסוי לטופסי ה-stage cards. שניהם מתועדים ב-`RESORT_UI_MANIFEST.md` §3 כ-backlog פתוח.
- ✅ **`npm run build` הורץ אחרי כל קובץ בנפרד** (7 ריצות) — `Compiled successfully.` בכולן, אפס warnings חדשים.
- ⚠️ **לא אומת חזותית** — נסיון `preview_start`+login דמו (`eliad`/`1234`) חזר על אותה שגיאה המתועדת מ-session 47/51 ("שם משתמש או סיסמה שגויים") — אין login עובד בסביבת הפיתוח הזו. כל 7 התיקונים מאחורי staff login; `npm run build` נקי הוא אימות-קומפילציה, **לא** אימות-לוגיקה-חזותית. Mike צריך לקליק-דרך עם login אמיתי.
- ✅ **`RESORT_UI_MANIFEST.md` עודכן בעצמו** (לפי §4's self-maintenance rule שהוא עצמו קבע) — 7 השורות שתוקנו ב-§2/§3 עברו מ-🟡/ממצא-פתוח ל-✅/Fixed, עם הפניה לכאן.
- ✅ **קבצים שהשתנו (לא כולל commit):** `RESORT_UI_MANIFEST.md` (חדש), `CLAUDE.md`, `src/components/AdminPanel.js`, `src/components/WhatsAppInbox.js`, `src/components/AutomationControlCenter.js`, `src/components/InventoryImportPanel.js`, `src/components/RoomBoard.js`, `src/components/HousekeepingTabletView.js`, `src/components/AICopilot.js`. ⚠️ **לא נגעתי** ב-`ezgoParser.js` (כפי שנדרש) וגם לא ב-3 קבצים שהיו `modified`/untracked בריפו **לפני** הסשן הזה (`src/App.js`, `src/utils/importMapper.js`, `supabase/functions/suggest-import-mapping/index.ts`, + 4 קבצי Voucher Reconciliation מ-session 51) — אלה נשארים pending-commit כפי שהיו, לא שולבו ב-commit הזה כדי לא לערבב שתי יחידות עבודה לא-קשורות.

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

## 12. פקודות שימושיות + העלאה לפרודקשן

```bash
# ── 1. בדיקה מקומית (חובה לפני כל commit) ──
npm run build                    # חייב: Compiled successfully.

# ── 2. Git → Vercel (Frontend — React SPA) ──
git status
git add <files>
git commit -m "תיאור קצר"
git push origin main             # Vercel auto-deploy מ-main → dream-ai-system.vercel.app (~1–2 דק')

# ── 3. Supabase Edge Functions (Backend — לא עובר דרך Vercel) ──
npx supabase login               # פעם אחת
npx supabase link --project-ref bunohsdggxyyzruubvcd   # אם עדיין לא מקושר
npx supabase functions deploy <NAME> --no-verify-jwt   # החלף NAME — חזור על כל פונקציה שנגעה בסשן

# פונקציות נפוצות (רק מה ששינית — לא לפרוס הכל בלי סיבה):
# npx supabase functions deploy whatsapp-webhook --no-verify-jwt
# npx supabase functions deploy whatsapp-send --no-verify-jwt
# npx supabase functions deploy whatsapp-cron --no-verify-jwt
# ⚠️ _shared/automationSchedule.ts נארז לתוך כל function שמייבא אותו — אם שינית אותו, פרוס את כל הצרכנים (למשל whatsapp-cron + automation-queue + כל function אחר שמייבא).

# ── 4. Supabase DB (רק אם נוספה migration חדשה) ──
npx supabase db push
```

**כלל Mike:** שינוי ב-`src/` = `git push` (Vercel). שינוי ב-`supabase/functions/` = `functions deploy` נפרד. שינוי ב-`supabase/migrations/` = `db push`. שלושת השכבות **לא** מתעדכנות אוטומטית זו מזו.

### פרוטוקול העלאה אוטונומית (session 63 — חובה)

בסוף **כל** סשן ששינה קוד, הקו-פיילוט **תמיד מציע** להריץ את ההעלאה לפרודקשן בעצמו — לא רק טבלה להעתקה ידנית.

1. **הצעה מפורשת:** "רוצה שאבצע commit + push + db push + functions deploy?"
2. **כש-Mike מאשר** (`כן` / `yes` / `תעלה` / `תמיד תציע`) — להריץ בטרמינל:
   - `npm run build` (אם נגעו ב-`src/`)
   - `git add` → `git commit` → `git push origin main`
   - `npx supabase db push` (אם יש migration חדש שלא נדחף)
   - `npx supabase functions deploy <name> --no-verify-jwt` לכל function שנגעה (כולל צרכני `_shared/`)
3. **דווח תוצאה:** commit hash, push status, deploy exit code, ומה לבדוק חי ב-`dream-ai-system.vercel.app`.

⚠️ לא לדלג על `functions deploy` כש`_shared/` השתנה — כל function שמייבא את הקובץ חייב redeploy.

---

## 13. כיצד לעבוד עם הפרויקט הזה

**לפני כל עריכה:**
1. קרא `docs/xos_agent_playbook.md` (איך לעבוד עם Mike, פרומפטים, UI phases) + `CLAUDE.md` + `docs/active_sprint.md`
2. קרא את הקובץ הרלוונטי (`Read tool`) — גם אם חשבת שאתה זוכר
3. בדוק שה-`old_string` שלך ייחודי בקובץ לפני Edit
4. אחרי כל שינוי ב-JS — הרץ `npm run build` ואמת `Compiled successfully.`

**בשיחה:**
- אם משהו נראה "תוכנן אבל לא בוצע" — בדוק את קיום הקוד בפועל לפני שאתה מדווח שהוא עובד
- אם יש doubt על DB schema — קרא migration files, לא מזיכרון
- אם שינוי דורש migration חדש — צור קובץ SQL ב-`supabase/migrations/` ורוץ `supabase db push`

**אחרי כל סשן ששינה קוד — חובה (§12 + פרוטוקול session 63):**
1. **Deploy Checklist** — רק שכבות שנגעו, עם פקודות מדויקות
2. **הצעה אוטונומית** — "רוצה שאבצע את ההעלאה?" (commit + push + db + functions)
3. **באישור Mike** — להריץ את כל הפקודות בטרמינל ולדווח תוצאה
4. **אימות** — מה לבדוק בפרודקשן אחרי הפריסה (route / flow ספציפי)

אל תסיים סשן עם "מוכן" בלי checklist **ובלי** הצעת העלאה אוטונומית.

---

*מסמך זה מחליף: `SYSTEM_CONTEXT.md`, `REFINEMENT_PLAN.md`, `architect_sync.md` לצרכי AI context.*
*לתיעוד אנושי מפורט — ראה את אותם קבצים.*

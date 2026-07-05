2026-07-05 | sync_suite_arrivals hotfix (migration 135) | `v_guest_id` UUID→BIGINT — תיקון «invalid input syntax for type uuid: 3334» בסנכרון ייבוא.
2026-07-05 | import multi-room display+sync dedupe | עמודת «קבוצה»: `חדר 1 מ־2`/`חדר 2 מ־2` (לא «2 חדרים»×2); סנכרון: profile אחד לכל הזמנה+טלפון+תאריך; `room_count` לפי מספר שורות; 76 tests.
2026-07-05 | import multi-room same guest | `isSameBookingGuest` — אותה הזמנה+טלפון+תאריך: חדר שני לא ⚠ conflict; תגית «🔄 קיים · 2 חדרים»+עמודת קבוצה.
2026-07-05 | import order-aware sync (migration 134) | `sync_suite_arrivals` מתאים אורח לפי order+date+phone → order יחיד → phone+date; `buildExistingGuestsLookup`/`findExistingGuestRow`; 73 tests.
2026-07-05 | merge 544fdef deployed | push main + db push 132/133 + functions whatsapp-webhook/send/guest-portal-data; Stage 2 מיידי+spa_date מאוחדים.
2026-07-05 | spa_date sync (portal+automation+WA) | סנכרון מלא: `_shared/spaSchedule.ts` ב-webhook/send/portal-data; placeholders `{{SPA_*}}` עם תאריך+שעה; פורטל+Inbox+ייבוא EZGO ממלאים `spa_date` מ-arrival_date; migration 131_guests_spa_date.
2026-07-05 | AddGuestModal + israeliTime.js | פרופיל אורח: תאריך טיפול ספא (`spa_date`) + בוחר שעות 24ש' ישראלי (dropdown 07:00–22:00); תצוגה משולבת ב-GuestsPage/GuestDashboard/GuestContextDrawer.
2026-07-04 | ArrivalImportPanel + AutomationControlCenter + migration 132 | ייבוא opt-in: ברירת מחדל «ללא וואטסאפ»; עמודת אוטומציה בגריד; migration 132 שומר automation_muted ב-reimport; ACC תור חי — פאנל הפעלה מרוכזת לאורחים מושתקים.
2026-07-04 | whatsapp-webhook + migration 133 | Stage 2 מיידי אחרי «כן מגיעים»: webhook מתעלם מ-offset_hours בלחיצה חיה; stage_2_arrival לפני stage_2_pay; migration 133 מאפס offset_hours.
2026-07-04 | whatsapp-send + _shared/metaTemplateLog + migration 130 | Inbox WYSIWYG שלב 1 deployed: גופי תבניות מלאים (night_before_suites/_shabbat וכו') + fallback Meta API; migration 130 תיקון wa_template_name column.
2026-07-04 | whatsapp-send + whatsapp-webhook + migration 129 | אוטומציה: cron תמיד Meta template (לא bot_scripts בגלל חלון 24ש'); mid_stay ללא «בוקר טוב»+חלון 10–12; Stage 2 רק מ-bot_scripts (בלי fallback מומצא).
2026-07-04 | automationSchedule.ts + whatsapp-webhook | חיזוק מגן תשובה קטועה בשעות כניסה: `looksLikeCheckInHoursReply`+`resolveTruncatedReplyFallback` ב-sendReply chokepoint; Tier-0 מורחב; 4 בדיקות `checkInPolicyFaq.test.js`.
2026-07-04 | WhatsAppInbox.js + guestTiming.js | Inbox: unread רק כשאין מענה אחרי inbound; פילטר «אחרי עזיבה» מפריד אורחים שעזבו מהרשימה הראשית.
2026-07-04 | whatsapp-webhook + automationSchedule.ts | Tier-0 שאלות שעות כניסה/חדר (`isCheckInPolicyQuestion`+`buildCheckInPolicyReply`); מגן תשובה קטועה (`isReplyObviouslyTruncated`); Gemini מחבר כל חלקי טקסט; `buildSystemPrompt` כולל כניסה 12:00+שבת 18:00.
2026-07-04 | GuestsPage.js + App.js + BotConfigPanel.js + whatsapp-send | מובייל צ'ק-אין: כרטיסי אורח במקום טבלה שבורה; overflow גלובלי; פאנל שעות כניסה חול/שבת/חג בהגדרות בוט; resolveDayTimings מ-bot_config.
2026-07-04 | WhatsAppInbox.js | הוסר צבע סגול לשורות «בריזורט» ברשימת DREAM BOT — נשארה תגית 🟢 בריזורט בלבד.
2026-07-04 | automation-queue + AutomationControlCenter + automationSchedule | תור חי: שלב 2 (stage_2_arrival) גלוי בין שלב 1 ל-2.5 — «ממתין לאישור הגעה» לפני כן, מיידי אחרי; תיקון סינון event_immediate + awaiting_confirmation.
2026-07-04 | whatsapp-webhook + automationSchedule + guestRoomResolve | בקשות אורח (guest_request): פתרון חדר מ-guests/suite_rooms לכרטיס Whapi; SLA (15ד amenities / 30ד maintenance); פיצול משק/תפעול; Tier-0+LLM גם ביום הגעה (לא רק checked_in).
2026-07-04 | WhatsAppInbox.js + App.js | מובייל DREAM BOT: ניווט stack (רשימה או שיחה מלאה) במקום slide שבור ב-RTL; כפתור חזרה; הסתרת toolbar+תפריט תחתון בשיחה.
2026-07-04 | WhatsAppInbox.js | תיקון מובייל עברית: overflow+RTL הציג חצי ריק — clip wrapper ב-LTR, slide תמיד translateX(-50%).
2026-07-04 | WhatsAppInbox + guestTiming.js | רשימת שיחות: במקום «תואם מהמערכת» — תגית הגעה יחסית (היום/מחר/עוד יומיים/בריזורט); גם בכותרת השיחה.
2026-07-04 | WhatsAppInbox.js + whatsapp-send | כפתור 🔁 «שלח שוב הודעת הגעה (שלב 2)» בפעולות מהירות; manual_script+stage_2_arrival עם resolveStage2ArrivalPlaceholders מלא (שם/ספא/פורטל).
2026-07-04 | whatsapp-webhook | Stage 2 fix: «כן מגיעים» תמיד שולח stage_2_arrival (לא LLM/ספא) — הוסר gate על arrival_confirmed; handleStage2ArrivalConfirmation משותף; post-burst intercept.
2026-07-04 | WhatsAppInbox.js + staffDeepLink.js + App.js + index.js | Inbox: שעה מדויקת בכל בועה (תאריך+שעה אחרי היום); כפתור 📱 QR לפתיחה מהירה בטלפון; deep link ?page=wa_inbox אחרי login.
2026-07-04 | whatsapp-send + migration 128 | שעות הגעה: כניסה למתחם תמיד 12:00 (גם שבת); צ׳ק-אין 15:00 חול / 18:00 שבת; תיקון applySaturdayCheckInTimeOverride שלא הפך 12:00→15:00.
2026-07-04 | whatsapp-send + migration 126 | Stage 2.5 שבת: cron תמיד שולח night_before_suites/_shabbat (לא session בגלל חלון 24ש'); isShabbatArrivalDate מרכזי; שעות שבת 15:00/18:00 ב-bot_config.
2026-07-04 | ezgoParser.js | ייבוא Doc 2: זהות מ-sRemark רק כש-sClientFullName כפול בקובץ; שורה יחידה=עמודה בלבד (תיקון «יום הולדת» כשם).
2026-07-04 | ezgoParser + ArrivalImportPanel + detailedReservationParser | ייבוא Doc 2: שם בהערה+טלפון בעמודה; 📵 שקיפות לפני סנכרון; תיקון CSV ש"ח (24 שורות במקום 7).
2026-07-04 | ezgoParser.js + ArrivalImportPanel.js | חילוץ חכם מהערות: שם+טלפון מ-sRemark (חיתוך בחדר/שח/₪, אורח ליד טלפון ב-/+, דמה 111); ⚠ שם חשוד.
2026-07-04 | ezgoParser.js + guestImportIntelligence.js | קבוצות מוניציפליות: טלפון מזמין דמה (111) לא נכנס לפרופיל — זהות מההערות; שורות לא נחסמות כ-⛔ umbrella; automationMuted נשאר.
2026-07-03 | ArrivalImportPanel + suiteRegistry + guestImportIntelligence + migration 125 | סנכרון Doc 2 מדויק: שיוך סוויטה מ-roomName+suiteType, 🔄/⚠ בלי false conflict, room scoped ל-arrival_date.
2026-07-03 | whatsapp-send | Session scripts: `applySaturdayCheckInTimeOverride` — הגעה בשבת מחליף 15:00→18:00 בטקסט bot_scripts בזמן שליחה (ללא שינוי DB).
2026-07-03 | whatsapp-send + WhatsAppInbox.js | Dispatch transparency: לוג `[META]`/`[SESSION]`+כפתורים ב-inbox; 🔵/🟢 ב-UI; התראת Whapi לאדמין על כשל שליחה.
2026-07-02 | automationSchedule.ts + whatsapp-webhook | בקשת בלונים לחדר → לוח בקשות (guest_alerts) בלבד, לא תפעול; תשובה קבועה לקבלה+נציגת בלונים; secret אופציונלי BALLOON_VENDOR_PHONE.
2026-07-02 | automationSchedule.ts + whatsapp-webhook | Allowlist + dispatch matrix: תפעול→Whapi EN+tasks; קבלה/בקשות→tasks; שאר→לוח בקשות/KB.
2026-07-02 | whatsapp-send + migration 119 + whatsapp-cron + GuestsPage | Idempotency guard `room_ready_notified` — חסימת כפל הודעת «חדר מוכן»; איפוס ב-checked_out.
2026-07-02 | HousekeepingTabletView.js + RoomBoard.js + migration 118 | Jacuzzi ping-pong: סטטוסים ממתין לג'קוזי/מוכן לפיניש, כפתורי קרא לג'קוזי+סיימתי פיניש, מסגרת cyan+pulse.
2026-07-01 | ArrivalImportPanel.js | תיקון תצוגת גריד שיבוץ: ביטול סינון ספא, טקסט כהה, מזהה שורה ייחודי, חדר גולמי מהקובץ.
2026-07-01 | ArrivalImportPanel.js | תיקון גריד ריק במצב שיבוץ סוויטות — ביטול סינון ספא + עמודות שם/הזמנה/חדר.
2026-07-01 | ArrivalImportPanel.js | Doc 2: מצב «עדכון שיבוץ סוויטות בלבד» — UI toggle + UPDATE ממוקד ל-room בלבד (התאמה order_number/שם).
2026-07-01 | WhatsAppInbox.js + whatsapp-webhook | «קח שיחה» משתיק בוט לאורח ספציפי (guests.claimed_by); תיקון UI שאיפס claim בהודעה חדשה.
2026-07-01 | ReceptionChecklist.jsx + receptionChecklistTemplate.js | צ'קליסט: עריכה/מחיקת משימות, ניקוי שורות ישנות, שדה «מי ביצע» (שם חופשי), מעקב לפי שמות בפועל.
2026-07-01 | WhatsAppInbox.js + guestTiming.js | DREAM BOT סגול רק ל-status=checked_in; סטטוס מטבלת guests מנצח join ישן.
2026-07-01 | ReceptionChecklist + receptionChecklistTemplate | צ'קליסט קבלה: 21 משימות verbatim מהטופס הפיזי, עמודת הערות דיגיטלית, מטריצת אלונה/שיראל/אורן, איפוס 04:00.
2026-07-01 | GuestsPage.js + WhatsAppInbox.js | צ'ק-אין: מחיקה כללית לנבחרים (במקום איפוס ספא); DREAM BOT — סגול ל-checked_in מחוזק דרך מפת טלפון+סטטוס.
2026-07-01 | GuestPortal + guest-portal-data/spa-request + migration 115 + ReceptionChecklist | פורטל: הסתרת כפתור ספא כשיש spa_time / toggle גלובלי; תשובת Concierge Meta; צ'קליסט קבלה — מטריצת חתימות סיוון/שיראל/אלונה.
2026-07-01 | guest-portal-spa-request + GuestPortal + whatsapp-webhook | בקשת ספא מהפורטל: requires_attention+guest_notes, Whapi DM קנוני לאורח, LLM guard מפני קישורי ספא.
2026-07-01 | ArrivalImportPanel.js + detailedReservationParser.js | דוח מפורט: סינון עם/בלי חדרים, כפתור ייבוא דינמי (סוויטות/בילוי יומי), `profile_type`+`profile_batch_type` ב-payload.
2026-07-01 | GuestsPage + guestCheckinMatrix + migration 114 | מטריצת צ'ק-אין: רשימה פעילה (הגעה היום / checked_in במהלך שהייה), ארכיון «אורחים לאחר שהות», auto 15:00+checkout, סטטוס checked_out.
2026-07-01 | ReceptionChecklist.jsx + migration 114 | צ'קליסט קבלה יומי DB: 3 אקורדיונים, progress+date audit, operator+timestamp, reset 04:00 Israel.
2026-07-01 | notify-manual-task + whatsapp-cron | תרגום EN ל-Whapi רק למחלקות תפעול/משק; auto_checkout ב-cron לפי departure_date.
2026-07-01 | notify-manual-task + fieldOpsTranslation.ts | משימה ידנית/inbox_routed: תיאור עברית → Gemini EN לכרטיס Whapi בלבד; DB נשאר עברית. מודול משותף גם ל-guest_request ב-webhook.
2026-07-01 | App.js Dashboard (Phase 2a UI) | Luxury stat-cards: gold top accent, Playfair values, semantic stat-sub tokens; 2-col grid @768px + 390px readable sizes; urgent banner tokens.
2026-07-01 | src/App.js (Phase 0 UI) | Design tokens (:root status/spacing/shadow/hit-target) + utility classes (.u-touch-*, .u-badge-nowrap); mobile-bar safe-area; stat-card hover polish.
2026-07-01 | whatsapp-webhook + whatsapp-cron + automationSchedule.ts | Unified routing matrix: auto check-in 15:00 (cron+webhook); תפעול→Whapi+תרגום EN; קבלה/בקשות→tasks בלבד (ספא/הארכה); מגן stay-change מעודכן (אדיר ואפק).
2026-07-01 | whatsapp-webhook + automationSchedule.ts | מגן הארכת שהייה/late checkout: intercept לפני LLM/upsell, handoff ניטרלי לצוות הסוויטות, needs_callback+attention_reason=date_change.
2026-07-01 | whatsapp-webhook + automationSchedule.ts | Tier-0 operational intercept: אורח checked_in + מילות מפתח חדר → tasks (guest_request) + requires_attention בלי LLM; תשובת קונסיירז' דטרמיניסטית.
2026-07-01 | HousekeepingTabletView.js + migration 113 + room-pending-approval-notify | לוח ניקיון: כשחדר+ג'קוזי נקיים → push להנהלה + realtime על room_status לפעמון AICopilot (אישור הודעה+צ'ק-אין).
2026-06-30 | docs/xos_agent_playbook.md | §11 one-message handoff — Mike approval loop (see browser → כן → commit/push ask → תעלה).
2026-06-30 | docs/xos_agent_playbook.md | §2.1 Mike Approval Loop + §12 Quick Card — agent waits after each change; Mike uses כן/תקן/עצור/תעלה only. desktop Wow + mobile comfort per phase; Phase 4 mobile shell+GuestsPage; Phase 5 real-phone QA; §11 full desktop kickoff prompt.
2026-06-30 | docs/xos_agent_playbook.md + .cursorrules | מדריך סוכן חכם: תקשורת חסכונית בטוקנים, UI phases 0–3, desktop-first, פרוטוקול שדרוג אוטומטי של חוקים.
2026-06-30 | BotSettings.js + migration 112 | עריכה ומחיקה לכללים ב-`xos_ai_rules` (RLS UPDATE/DELETE + כפתורי ✏️/🗑️ במוח הבוט).
2026-06-30 | BotSettings.js + whatsapp-webhook | כללים מ-«למד את המערכת» מוצגים במוח הבוט; chat/routing מופרדים; `ANTI_REASONING_LEAK_SUFFIX` + מגן עברית ב-sanitizeReply.
2026-06-30 | OperationsBoard.js + migration 111 | תור חי Realtime על `tasks` — 👍🏼 בקבוצת Whapi מעביר משימה ל«בוצע» בלי רענון; `applyTaskRowUpdate` כמו Inbox.
2026-06-30 | whatsapp-webhook + automationSchedule.ts | In-room keyword override (pending/expected→checked_in + in-house AI tone); insert-first wa_message_id dedup + burst coalescing (~1.8s) למניעת כפל תשובות.
2026-06-30 | WhatsAppInbox.js + inboxAlertSounds.js | צלילי התראה: אורח סוויטה (צליל גבוה) / לא נוכח בריזורט (צליל נמוך) על הודעה נכנסת חדשה.
2026-06-30 | WhatsAppInbox.js + guestTiming.js | רשימת DREAM BOT: אורחים נוכחים בריזורט היום — רקע/שם/אווטאר סגול (`isGuestInResortToday`).
2026-06-30 | WhatsAppInbox.js + notify-manual-task | ניתוב תחזוקה/משק בית מתיבת אורח → כרטיס Whapi לקבוצת התפעול (`[GUEST WA]`); אותו מנגנון כמו לוח תפעול.
2026-06-30 | AutomationControlCenter.js | תור חי: בחירה מהירה לפי שלב בכל יום הגעה (סמן הכל שלב 4 וכו׳); שגר המוני בפעימות 2.5ש׳ (כמו cron).
2026-06-30 | migration 110 + automationSchedule + AutomationControlCenter | Stage 4 `require_checked_in` toggle (default OFF for mid_stay); cron sends without check-in when disabled.
2026-06-30 | AutomationControlCenter.js + automation-queue | תור חי לפי יום הגעה; תיקון Stage 4 (not_checked_in→pending); arrivalDate ב-API.
2026-06-30 | ArrivalImportPanel.js | Doc 1 «ספא סוויטות בלבד»: פרסור שורות «לאורחי הסוויטות» בלבד; סנכרון לפי order_number+arrival_date לפרופיל קיים; מצב מלא נשאר זמין.
2026-06-30 | ArrivalImportPanel.js + ezgoParser.js | Import grid defaults to spa-only rows with «הצג את כל האורחים» toggle; sync still uses full dataset via _profileIdx; enrichProfilesFromExcel phone fallback when order join misses.
2026-06-30 | AutomationControlCenter.js | Queue tab: exclude sent/simulated/skipped from live queue; 🗑️ per-row + clear-all dismiss for blocked_by_meta (UI-only, no backend change).
2026-06-30 | CustomerProfilePane.js | Guest drawer: guest_alerts requests + collapsible guest_notes system log under "הערות ובקשות".
2026-06-30 | CustomerProfilePane.js | Smart profile chips + red alert badge + edit modal in guest name drawer (GuestsPage + GuestDashboard).
2026-06-30 | guestProfileSchema + guestProfile.ts | Removed profile options: VVIP, shuttle_needed (kosher_strict/halal/seafood allergy already absent).
2026-06-30 | WhatsAppInbox.js | Guest notes banner collapsed by default with ✕ dismiss; minHeight:0 on message scroll fixes overlap; slightly larger bubble text for readability.
2026-06-29 | CLAUDE.md §4/§6/§7 | Doc sync: receptionist RBAC (full Sidebar + ops/inbox/vouchers/data_sync); Record-Only ETA pipeline + arrival_time; future suite routing to 120363429859248777@g.us + LLM English translation.
2026-06-29 | whatsapp-webhook/index.ts + migration 108 | Record-only arrival time: regex extract HH:MM → guests.arrival_time + guest_notes audit; fixed Hebrew reply; no needs_callback/alerts/ops routing; log_guest_request prompt excludes ETA updates.
2026-06-29 | auth.js + App.js + OperationsBoard.js | Receptionist RBAC: full sidebar (staff + wa_inbox/data_sync/vouchers/ops); admin routes still blocked; create_ops_task for receptionist.

2026-06-29 | whatsapp-send/index.ts | Stage 2.5 force override: session_message always on manual Send Now — bypass window/Shabbat/Meta routing; fail visible on missing script.

2026-06-29 | detailedReservationParser.js + ArrivalImportPanel.js | CSV quote-safe parser (RFC4180 + בע\"מ fix); .csv read as text not SheetJS — fixes raw CSV dumped into guest name.

2026-06-29 | GuestPortal.js + guest-portal-data | Secure payment CTA below itinerary (payment_url/balance/pending only); muted gold styling. Build clean.

2026-06-29 | src/components/GuestPortal.js | ItineraryPanel + DayUseView: בסיס אירוח row (🍴 meal_location) directly under spa; conditional render; meal_time row separate.

2026-06-29 | detailedReservationParser.js + PriceDiscrepancyModal.js + ArrivalImportPanel.js | Dedicated «ייבוא דוח הזמנות מפורט» import: Excel serial dates, board-basis→meal_location, dual-price conflict modal, טלפון נוסף→guest_notes, חדרים→roomsQuantity/bookings.room_count; bypasses AI mapper. Build clean.

2026-06-29 | migration 106 + db history fix + AddGuestModal + whatsapp-send + AutomationControlCenter | Resolved duplicate migration 101 (renamed guest mute to 106, db push clean); lead_source/automation_muted on guest form; Stage 2.5 Send Now forces session+image when 24h window open.

2026-06-29 | migration 101 + ezgoParser + ArrivalImportPanel + automationSchedule + whatsapp-cron/send/webhook | Advanced PMS CSV (מקור הגעה): lead_source + automation_muted on guests; מחלקת מכירות rows imported but pipeline/cron/stage_2_pay muzzled; preset mapping for 01.7.26-style exports.

2026-06-29 | whatsapp-send + interactiveSend | Stage 2.5 session images: resolveStageSessionImageUrl + sendStageSessionMessage helpers; cron/Send Now routes to session when 24h window open; image+caption via sendImageMessage with wamid assert + session_image_failed on Meta error.

2026-06-29 | whatsapp-send + whatsapp-webhook | Re-added night_before_suites/_shabbat to TEMPLATE_IMAGE_HEADER_DEFAULTS (Meta requires IMAGE header); removed from TEMPLATE_NO_HEADER block list.

2026-06-29 | whatsapp-send + interactiveSend + whatsapp-webhook | Meta payload audit: IMAGE header only for dream_suite_reminder (removed night_before_suites/_shabbat — body-only templates); session_message_image_url no longer injected into template components; sendViaMeta uses sendImageMessage with strict image.link shape + wamid assert.

2026-06-29 | whatsapp-send/index.ts | Stage 2.5 rich-media fix: sendViaMeta switches to type:image+caption when image_url present; sendViaTemplate buildTemplateComponents() validates header/body/button params; night_before session+template paths pass automation_stages.session_message_image_url.

2026-06-29 | scheduled_tasks (104) + AutomationControlCenter + whatsapp-send template_test | Smart Dispatch Override: pending schedule warning modal (Israel time), שלח עכשיו + ⚡ force send with duplication guard (cancel scheduled_tasks + Manual Override log); isolated Meta template test tab (is_test:true).

2026-06-29 | UndoSnackbar + HoldToConfirmButton + QuietHoursGate + AdminChangelogDashboard + App.js/index.js | Fail-safes: RequestsBoard 6s undo snackbar; WhatsAppInbox hold-1.5s bot toggle; quiet-hours gate (22:00–08:00 IL) on all manual WA sends; admin changelog timeline at admin_updates + /admin/updates deep link.


2026-06-29 | whatsapp-webhook/index.ts | Phase 3: fetch xos_ai_rules (chat+routing) with 5-min cache + try/catch; append learnedRulesText to finalSystemPrompt (flows to Gemini systemTurn + Claude system).

2026-06-29 | WhatsAppInbox.js + RequestsBoard.js | Phase 2: AILearningButton integrated ? module=chat (DREAM BOT header) + module=routing (Requests Board action bar).

2026-06-29 | migration 103 + AILearningButton.jsx | Unified AI Learning Phase 1: xos_ai_rules table (RLS + cleaner lockdown) + reusable capture button component (not yet integrated).

2026-06-28 | CLAUDE.md + .cursorrules | ?12??13 Deploy checklist mandatory at end of every code session; needs_callback docs synced (session 59).

2026-06-28 | src/components/AddGuestModal.js | needs_callback checkbox label: "????? ?????? ???? ??" (removed misleading "??? ????" copy).

2026-06-28 | automationSchedule.ts + whatsapp-webhook/index.ts | Decouple needs_callback from bot logic: cron eligibility no longer skips guests with open callback; webhook no longer silences LLM/button routing when needs_callback=true (UI badges unchanged).

2026-06-28 | supabase/functions/whatsapp-cron/index.ts | Queue dispatch throttling: sequential batches (size 10) with 2.5s sleep between each whatsapp-send call to avoid Meta burst rate limits.

2026-06-28 | src/components/GuestPortal.js | Removed duplicate concierge WA button from ItineraryPanel empty state ? SuiteQuickActions remains the single CTA.

2026-06-28 | supabase/migrations/099_daypass_stage4_stage5_split.sql + automationSchedule.ts + whatsapp-cron/index.ts + AutomationControlCenter.js | Stage 4 restore: migration 099 pushed to prod (was local-only); mid_stay_daypass/checkout_fb_daypass rows + is_active=true; resolveStageSchedule returns scheduledFor even when skipReason set (queue monitor visibility); CORE_PIPELINE_STAGE_KEYS registry + Pulse UI missing-stage warning; cron mid_stay eval logging.

2026-06-28 | supabase/functions/whatsapp-send/index.ts + AutomationControlCenter.js + src/utils/whatsapp.js | Stage 2.5 root fix: removed 24h free-text hijack ? cron/default always sends night_before_suites/_shabbat Meta template; session text only on manual force_channel=session_message; entry_time/check_in_time substitution in script path; frontend THREE_PARAM drift corrected.

2026-06-28 | whatsapp-cron/index.ts + whatsapp-send/index.ts | Stage 2.5 debug: cron logs active_stages + night_before eligibility; whatsapp-send logs trigger/BRANCH_D/night_before routing; fix force_meta bypass + resolvePipelineTemplateName stale DB template.

2026-06-28 | supabase/functions/_shared/metaPhone.ts + whatsapp-send/index.ts + _shared/interactiveSend.ts | Meta silent-delivery fix: sanitizeMetaRecipientPhone strips non-digits, 05?9725, applied to all Graph API `to` fields before fetch.

2026-06-28 | src/components/GuestPortal.js | SuiteQuickActions: persistent concierge WhatsApp CTA in SuiteView (CONCIERGE_WA) ? always visible even when itinerary has spa/meal data; meal_location logic untouched.

2026-06-28 | src/components/ArrivalImportPanel.js | Auto-date detection (filename DD.MM.YY + first-cell fallback) pre-fills arrival picker with FAIL VISIBLE confirmation banner; expanded _extractMealTime with HB/Half Board, Dinner, ?????, evening-range (18:00?21:30) patterns + spa-line guard.

2026-06-28 | src/components/ArrivalImportPanel.js | HTML parsing bugfix: _cellText DOM-walk converts <BR>?\n (was textContent, phone lost on suite rows); suiteSpaOnly?false (group filter by regex is enough); content-sniff HTML detection; meal_time column in spa preview table. Build clean.
2026-06-28 | src/components/ArrivalImportPanel.js | Doc 1 HTML support: parseHtmlDailyReport for EZGO .htm exports (nested table ? parseComprehensiveReport); suiteSpaOnly filter (?????? ????????/????? ??????, skip group slots); multiline order-cell phone fix; meal window regex (?- HH:MM); DropZone accepts .htm/.html. npm run build clean.

2026-06-28 | automation-queue/index.ts + src/components/AutomationControlCenter.js | Step 3 ? Blocked-by-Meta UI (Phase 2 dashboard): (1) automation-queue now includes blocked_by_meta rows in attentionRequired. (2) New orange "?? ????? ?????? Meta" accordion card in Live Queue tab ? shows guest/stage/template-name with badge-orange; explanatory banner "?????? ?????? ?????? ? ? Meta ??? ?????". (3) Queue table status badge handles blocked_by_meta ? badge-orange "?? ????? ??????". (4) History table status badge handles blocked_by_meta ? badge-orange "?? ????? ?????? Meta". (5) History tab filter chips: ??? / ? ???? / ?? ????? Meta / ? ????? ? active chip has bold border. (6) SCRIPT_KEY_FRIENDLY +3 entries for pre_arrival_2d/mid_stay/checkout_fb (migration 100 scripts). npm run build clean; automation-queue deployed.

2026-06-27 | docs/ created, .cursorrules added | System knowledge reorganized: architecture.md + active_sprint.md generated from 11 source docs; 6 stale docs archived to docs/archive/; .cursorrules workflow directives installed.
2026-06-27 | src/components/AutomationControlCenter.js | Phase 1 Live Monitor UI: "???? ?????" wrapped in collapsible accordion (auto-opens on errors, closed when clean); top-5 most-recent-first with 260px max-height + gold custom scrollbar; "? ????? ?????? ???" button dismisses all active alerts from operational view.
2026-06-27 | src/components/AutomationControlCenter.js | Auto-fill variables fix: added resolvePreviewTimings() (UTC-safe, mirrors whatsapp-send resolveDayTimings), ARRIVAL_TIME_STAGE_KEYS set, per-card previewTimings state + "? ??? ????????" button in StageCard; MetaTemplatePreviewBox now resolves {{1}}=guest name, {{2}}=entry time, {{3}}=check-in time (12:00/15:00 weekday, 15:00/18:00 Shabbat). Room/date wrong-slot mapping eliminated.
2026-06-27 | supabase/functions/whatsapp-send/index.ts + src/components/AutomationControlCenter.js | Fully deterministic template routing (session 57): (1) morning_suite/morning_welcome now have a dedicated fast-path (morningDispatch) that reads arrival_date UTC day-of-week ? Saturday?dream_welcome_morning_shabbat, else?dream_welcome_morning. Only {{1}}=name passed; entry/check-in times are baked into each template's body. Safety: Shabbat template failure retries with weekday template + console.warn. PORTAL_BUTTON_TRIGGERS emptied (both morning triggers handled in fast-path). PIPELINE_VARS simplified to [name] for safety. (2) AutomationControlCenter: ARRIVAL_TIME_STAGE_KEYS + resolvePreviewTimings + per-card auto-fill state removed; replaced with DETERMINISTIC_ROUTE_STAGE_KEYS and a read-only routing info panel showing weekday/Shabbat template names per stage. npm run build clean; whatsapp-send deployed.
2026-06-27 | src/components/AutomationControlCenter.js | Meta Fallback dropdown: replaced read-only template display in StageCard with live <select> bound to patchStage({meta_template_name}); lists all Meta templates (? APPROVED first, ? PENDING kept so current selection never silently disappears); added night_before_suites + night_before_suites_shabbat + dream_suite_reminder to META_TEMPLATE_FRIENDLY map; auto-fill/preview panels conditioned on selection.
2026-06-27 | supabase/functions/whatsapp-send/index.ts | Dream Bot Dispatch consolidation: (1) TEMPLATE_IMAGE_HEADERS extended with night_before_suites_shabbat. (2) getLastInboundTimestamp() added ? queries whatsapp_conversations for raw last-inbound ts, explicit 24h math, independent of wa_window_expires_at. (3) night_before now has a dedicated 24h compliance engine + early-return fast-path: within 24h ? free text via night_before_reminder bot_script; outside window / null ? static approved template (Saturday?night_before_suites_shabbat, else?night_before_suites) with {{1}}=name ONLY ({{2}}/{{3}} removed). Safety gate: query failure defaults to template. (4) Removed stale resolveNightBeforeTimes/nightBeforeTimes/nightBeforeError code from generic BRANCH D. (5) PORTAL_BUTTON_TRIGGERS trimmed to morning_suite+morning_welcome (night_before owns its own portalButtonParam in fast-path).

2026-06-27 session-57: Dynamic Experience Hub ? migration 093 (upsell_items+guest_orders), guest-portal-order Edge Function, conditional portal router (suite vs day_use), DB-driven Pre-Order module, pre_arrival_2d portal button for all guest types.
2026-06-28 | src/components/GuestDashboard.js + src/components/GuestsPage.js | session-58 Operational Dashboard Sync: GuestDashboard edit parity (editingGuest + pencil button); GuestsPage suite-only bifurcation filter + badge; Room Ready WA Fail Visible fix. commit 5c602b2.
2026-06-28 | src/components/GuestPortal.js + src/components/ArrivalImportPanel.js | session-62 Portal bug-hardening: (1) Timezone fix ? `today` now uses `toLocaleDateString('en-CA', {timeZone:'Asia/Jerusalem'})` instead of UTC `.toISOString().slice(0,10)` so phase/countdown never shows wrong day after midnight local. (2) ItineraryPanel (SuiteView) + DayUseView inline block ? both now always render; show concierge WhatsApp CTA fallback instead of returning null when spa_time+meal_time both absent (FAIL VISIBLE ?0.3). (3) ArrivalImportPanel PATH A post-RPC spa_time/meal_time UPDATE scoped with `.eq("arrival_date", g.arrivalDate)` to prevent cross-date pollution for repeat guests. Build: Compiled successfully.
2026-06-28 | supabase/migrations/101_room_ready_bot_script.sql + supabase/functions/whatsapp-send/index.ts + src/components/SuitesDashboard.js | session-60 Room Ready Latch & Date Guardrail: (1) Migration 101: seeds bot_scripts row 'room_ready_reminder' (free-text body for 24h-open session path; {{GUEST_NAME}}/{{ROOM_NAME}} placeholders; self-test). (2) whatsapp-send: PIPELINE_TEMPLATE["room_ready"] renamed dream_room_ready ? dream_room_ready1; new room_ready fast-path inserted before BRANCH D generic fallback ? mirrors night_before pattern: last-inbound < 24h ? free-text from room_ready_reminder script; ?24h / no history ? dream_room_ready1 template with {{1}}=name, {{2}}=room; script-missing fallback to template; full log + flag stamp + conv thread. (3) SuitesDashboard: today guardrail (r.arrival_date === today); sendingWa Set state; sendRoomReady() handler (invokes whatsapp-send trigger:room_ready + optimistic msg_room_ready_sent stamp); dispatch button per room card (Disable Don't Hide ?0.2 ? greyed+tooltip for non-today arrivals / no guest match / already sent). npm run build: Compiled with warnings (pre-existing GuestPortal.js CONCIERGE_WA, not introduced here).
2026-06-28 | supabase/migrations/100_safe_dispatch_blocked_by_meta.sql + supabase/functions/whatsapp-send/index.ts | session-59 Safe Dispatch + Automation Diagnostic Mode (Phase 1 + Phase 2 DB+Edge): (1) Migration 100: notification_log.status CHECK widened to include 'blocked_by_meta'; 3 bot_scripts free-text seeds (pre_arrival_2d/mid_stay/checkout_fb); automation_stages.session_message_script_key wired for 5 stages; inline DO$$ self-test. (2) isMetaTemplateError() helper ? detects Meta error #132001 (template pending/not found) in error string. (3) All 5 pipeline catch blocks (night_before/day_pass_morning/morning_suite+welcome session-text/morning_suite+welcome template/BRANCH D generic) updated to 3-way ternary: timeout?timeout, Meta template error?blocked_by_meta, else?failed. Guest flag NOT stamped on blocked_by_meta (cron retries until template approved). (4) New morning 24h session-text block for suite morning_suite/morning_welcome: if wa_window open AND session_message_script_key set, sends stage_3_morning free-text (stage_3_morning bot_script), logs+returns early; if script missing/empty silently falls through to Shabbat-aware template fast-path. whatsapp-send deployed.
2026-06-28 ? parseHtmlDailyReport: added TD[2] board column (HB/BB) to c2Parts + 19:00 dinner default for HB/?????-??? guests with no explicit meal time; ?????-????? lunch groups excluded (ArrivalImportPanel.js)
2026-06-28 | src/components/SuitesDashboard.js + src/components/GuestPortal.js | UI refinement: (1) SuitesDashboard ? guests SELECT now includes meal_time; ??? meal_time badge added to each room card alongside existing ?? spa_time badge. (2) GuestPortal ItineraryPanel + DayUseView ? meal ItineraryRow now displays only meal_location (or fallback "????? ?????") instead of the operational meal_time timestamp; hides row entirely when meal_time is absent. npm run build: Compiled successfully.
2026-06-28 | src/components/ArrivalImportPanel.js + src/utils/ezgoParser.js | HTML parsing gaps A-E: (A) DOM-targeted <TH> date extraction (falls back to raw-text regex); (B) handleDoc1 auto-populates arrivalDate picker + FAIL VISIBLE banner from HTML date; (C) dinnerDefaultPhones Set replaced by boardDefaults Map ? full HB/FB/BB/RO board-basis classification (HB?19:00/??? ?????, FB?19:00/???? ??????, BB?????/????? ????, RO?null); (D) meal_location:null added to parseComprehensiveReport record struct; (E) sync PATH A/B + ezgoParser.enrichProfilesFromExcel use rec.meal_location with "????? ???????" only as fallback ? board-basis location now propagates to guests table.
2026-06-28 ? session 58b: EZGO HTML smart router (trimStart BOM fix), parseHtmlDailyReport tds<2 guard (was <4, dropped all 3-col rows), strict meal labels HB???? ??????/FB??????? ???/BB??? ????? ???? (null time, no guessing), extras-only c2Parts (board/meals removed from _extractMealTime path), PATH B enrichment-only (removed INSERT branch), enrichProfilesFromExcel meal_location propagates independently of meal_time.
2026-06-28 | supabase/functions/whatsapp-send/index.ts | Zero-failure template dispatch: removed pre_arrival_2d URL-button injection (dream_arrival_confirmation is QUICK_REPLY-only); template-name-based dynamic URL whitelist; force+meta_template early path bypasses window/idempotency/day-pass gates; resolveTemplateVars/resolvePipelineTemplateName helpers; night_before script-missing falls back to template; generic BRANCH D ok now reflects send status.
2026-06-28 | supabase/functions/whatsapp-webhook/index.ts | dateChangeReply + typed date-change handoffMsg updated to Mike's new copy (availability ask before staff callback).
2026-06-28 | supabase/functions/whatsapp-webhook/index.ts | Gemini askGemini: exponential backoff (4 attempts, Retry-After aware) on 429/5xx/timeouts before next model or Claude failover ? whatsapp-send has no Gemini path.
2026-06-28 | AICopilot.js + RequestsAlertWidget.js | Draggable FAB widgets: viewport clamp on drag, resize/out-of-bounds snap to default corner + clear stale localStorage, z-index 10400.
2026-06-29 | migration 105 + _shared/paymentLinkGuard.ts + whatsapp-webhook/whatsapp-send + AutomationControlCenter | Stage 2 Pay guardrails: direct_payment_url validation, ezgo_portal_url async recovery flag, failed_missing_link/processing notification_log statuses, idempotency + 3s inline recovery, dream_payment_and_workshops button token fix.
2026-06-29 | whatsapp-send/index.ts + AutomationControlCenter.js | Stage 2.5 zero-guard: force+open window always session image+text (ignores force_channel=meta_template); queue Send Now ungated + omits force_channel for night_before.
2026-06-29 | migration 107 + WhatsAppInbox.js + whatsapp-send/index.ts | Inbox realtime (whatsapp_conversations publication) + store/display actual sent text; legacy [סקריפט]/[תבנית] rows resolved in UI with guest placeholders; fetchSince gte watermark + thread auto-scroll.
2026-06-29 | futureSuiteRoomServiceRouting.ts + guest-portal-ops-request + sla-escalation-cron | Future suite room-service alerts → Whapi group 120363429859248777@g.us (replaces 972504025317 DM).
2026-06-29 | WhatsAppInbox.js | Bulk "ניקוי כל ההתראות": confirm guard, clears human_requested + needs_callback for visible alert contacts, optimistic roster update.

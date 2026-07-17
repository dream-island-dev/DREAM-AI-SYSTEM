# QA — Whapi Failover מקצה-לקצה (למייק)

> נכתב 2026-07-17. מכסה את שלוש שכבות ה-SOS/failover של ערוץ מכשיר הסוויטות (Whapi)
> ואת נתיב ההחזרה. מקור אמת בקוד: `_shared/whapiHealth.ts`, `_shared/guestWhapiRouting.ts`
> (`isWhapiGuestSosActive`), ACC Pulse (`AutomationControlCenter.js`).

## איך זה עובד (30 שניות)

כל outbound לאורח נופל ל-Meta Dream Bot כשאחד מאלה פעיל — לפי סדר הבדיקה ב-`isWhapiGuestSosActive()`:

| שכבה | מפעיל | כיבוי |
|---|---|---|
| 1. env קטסטרופה | `npx supabase secrets set WHAPI_GUEST_SOS_META=true` | `npx supabase secrets unset WHAPI_GUEST_SOS_META` (עוקף הכל — גם «החזר ל-Whapi» ב-ACC לא יעזור עד ה-unset) |
| 2. SOS ידני | ACC → פעימת חיים → checkbox «SOS ידני (Dream Bot לכל האורחים)» → `bot_config.whapi_guest_sos_active=true` | כפתור «✅ החזר ל-Whapi» (מאפס גם את הידני) |
| 3. failover אוטומטי | `bot_config.whapi_auto_failover=true` (ברירת מחדל) **וגם** `whapi_device_healthy=false` | מתאושש לבד ברגע שה-probe רואה שוב `AUTH` |

ה-probe: כל ריצת `whatsapp-cron` (כל 15 דק׳) וגם `automation-health-cron` קוראים
`GET /health?wakeup=false` מול Whapi. **בריא = סטטוס `AUTH` בלבד** — כל דבר אחר
(`QR`, `LOGOUT`, timeout, HTTP 5xx) נכתב ל-`bot_config` כ-`whapi_device_healthy=false`.

## בדיקת מצב נוכחי (Supabase SQL Editor)

```sql
SELECT config_key, config_value FROM bot_config
WHERE config_key IN (
  'whapi_device_status', 'whapi_device_healthy', 'whapi_device_checked_at',
  'whapi_guest_sos_active', 'whapi_auto_failover',
  'guest_suites_channel', 'guest_daypass_channel'
);
```

מצב תקין צפוי: `whapi_device_status=AUTH`, `whapi_device_healthy=true`,
`whapi_guest_sos_active=false`, `whapi_auto_failover=true`.

---

## תרחיש 1 — SOS ידני + החזרה (5 דק׳, בלי לגעת במכשיר)

1. בחר אורח בדיקה (סוויטה, סטטוס פעיל, הטלפון שלך).
2. ACC → פעימת חיים → סמן «SOS ידני (Dream Bot לכל האורחים)» → מופיע באנר 🚨 SOS.
3. ACC → Override לאורח הבדיקה (למשל `night_before`) → שגר.
4. **צפוי:** ההודעה מגיעה מ-Dream Bot (Meta); ב-Inbox הבועה מתויגת `[META]`; בשיחה מאוחדת בורר «ענה דרך» נעול ל-Meta.
5. לחץ «✅ החזר ל-Whapi» → הבאנר נעלם; SQL: `whapi_guest_sos_active=false`.
6. Override נוסף לאותו אורח → **צפוי:** מגיע ממכשיר הסוויטות, `[WHAPI]` ב-Inbox.

> שים לב: שיגור חוזר בכוח לאותו אורח+שלב אחרי שליחה מוצלחת יירשם ב-Automation History
> כ-`duplicate_blocked` עם `actual_status: sent` ב-payload (התנהגות חדשה 2026-07-17) — ההודעה
> נשלחה; זה רק סימון audit של resend.

## תרחיש 2 — failover אוטומטי (מדמה מכשיר חסום)

1. ב-Whapi dashboard (panel.whapi.cloud) → עצור את ה-channel של מכשיר הסוויטות (Stop). **לא** לנתק את הטלפון מוואטסאפ — עצירת channel מספיקה וה-probe יראה סטטוס לא-`AUTH`.
2. המתן לריצת cron (עד 15 דק׳), או הרץ ידנית:
   ```
   curl -X POST https://bunohsdggxyyzruubvcd.supabase.co/functions/v1/whatsapp-cron
   ```
   (זו ריצת cron אמיתית — תשגר שלבים שבשלים לשליחה, כרגיל כל 15 דק׳.)
3. SQL: **צפוי** `whapi_device_healthy=false`, `whapi_device_status` ≠ AUTH; ב-ACC Pulse באנר SOS (אוטומטי).
4. Override לאורח הבדיקה → **צפוי:** מגיע דרך Meta `[META]`, בלי שנגעת בשום מתג.
5. הפעל את ה-channel חזרה (Start) → המתן/הרץ cron → SQL: `whapi_device_healthy=true` → Override → **צפוי:** `[WHAPI]` שוב. אין צורך בלחיצה ידנית.

## תרחיש 3 — env קטסטרופה (רק לוודא שקיים, לא חובה בכל QA)

```
npx supabase secrets set WHAPI_GUEST_SOS_META=true
```
כל אורח → Meta מיידית (כולל `room_ready`), `ALLOW_META_GUEST_TEMPLATES` נחשב true אוטומטית.
כיבוי: `npx supabase secrets unset WHAPI_GUEST_SOS_META`. **לזכור לכבות** — אחרת «החזר ל-Whapi» ב-ACC לא ישפיע.

## אימות רישום (אחרי כל תרחיש)

```sql
SELECT trigger_type, status, payload->>'channel' AS channel, sent_at
FROM notification_log
WHERE guest_id = <GUEST_ID>
ORDER BY sent_at DESC LIMIT 10;
```
`channel` צפוי: `whapi_session` במצב תקין, `meta_template`/`session_message` בזמן SOS.
אסור לראות שורת `processing` שנשארת מעבר לדקות בודדות (claim תקוע = בעיה).

## מה failover לא מכסה

- **קבוצת החדרנות «צ'ק אין צ'ק אאוט»** — inbound על אותו מכשיר; בזמן באן אמיתי `N✅`/`Co N` לא נקלטים. אין תחליף Meta.
- **דוחות אליעד / בריף אדיר / DM-ים לצוות** — נשלחים דרך Whapi גם ב-SOS (SOS מכסה אורחים בלבד).

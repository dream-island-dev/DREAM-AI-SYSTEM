# Dream Island Resort OS — BACKLOG
> נוצר: 2026-06-13 | סרוק: src/ + supabase/ + CLAUDE.md

---

## 1. פריטים פתוחים מ-CLAUDE.md ("הבא בתור")

| # | פריט | סטטוס |
|---|------|--------|
| 1.1 | Room Status Board | ✅ נוצר (`src/components/RoomStatusBoard.js`) |
| 1.2 | QR מנקות | ✅ נוצר (`src/components/CleaningQR.js`) — אך ללא שמירה ב-Supabase (ראה §3.3) |
| 1.3 | Push Notifications + אישור מנהל | ❌ לא מומש |
| 1.4 | ייבוא אורחים CSV | ⚠️ ממשק קיים ב-BookingsManager — אך נשמר רק ב-state (ראה §3.4) |

Edge Functions שמתועדות ב-CLAUDE.md כ"פרוסות" אך **לא קיימות ב-Git**:

| פונקציה | קיים ב-Git? |
|---------|------------|
| `whatsapp-send` | ❌ |
| `get-wa-templates` | ❌ |
| `register-templates` | ❌ |
| `invite-user` | ❌ |
| `morning-briefing` | ❌ |

> **סיכון:** אם ה-Supabase project יאופס — הפונקציות הללו יאבדו. יש לשחזר לגיט בהקדם.

---

## 2. TODO / FIXME / PLACEHOLDER בקוד

### 2.1 — תשלום: `generatePaymentLink()` הוא STUB קריטי

**קובץ:** `supabase/functions/whatsapp-webhook/index.ts:43`

```typescript
// TODO: החלף בקריאת API אמיתית לחברת התשלומים שלך (Cardcom / Tranzila / Meshulam)
async function generatePaymentLink(booking) {
  // PLACEHOLDER — מחזיר קישור דמו
  return `https://pay.dream-island.co.il/pay?booking=${booking.id}`;
}
```

**השפעה:** כל הזמנה שמאשר אורח מקבלת קישור תשלום מזויף.
**תלות חיצונית:** בחירה ב-Cardcom / Tranzila / Meshulam + credentials.

---

### 2.2 — תשלום: BookingsManager גם משתמש ב-placeholder

**קובץ:** `src/components/BookingsManager.js:216`

```javascript
// TODO: כשתחבר חברת תשלומים — replace עם קישור אמיתי שנוצר מה-API
const link = booking.payment_link ?? `https://pay.dream-island.co.il/pay?id=${booking.id}`;
```

**השפעה:** שליחה ידנית של קישור תשלום מ-UI גם מחזירה dummy link.

---

### 2.3 — pg_cron: `arrival-automation` לא מוגדרת כ-scheduled job

**קובץ:** `supabase/functions/arrival-automation/index.ts:9-17`

```typescript
// לוח זמנים מומלץ (להגדיר ב-Supabase SQL Editor):
// SELECT cron.schedule('arrival-automation-daily', '0 7 * * *',
//   $$SELECT net.http_post(url:='https://...supabase.co/functions/v1/arrival-automation',...)$$);
```

**סטטוס:** הפונקציה נכתבה אך **לא מוזמנת אוטומטית**. יש להריץ את ה-SQL ידנית ב-Supabase.

---

### 2.4 — Meta Webhook: לא מוגדר ב-Meta Dashboard

**קובץ:** `supabase/functions/whatsapp-webhook/index.ts:8-9`

```
// URL: https://bunohsdggxyyzruubvcd.supabase.co/functions/v1/whatsapp-webhook
// Verify Token: WHATSAPP_WEBHOOK_VERIFY_TOKEN (secret ב-Supabase)
```

**סטטוס:** הפונקציה פרוסה — אך לא רשומה כ-Webhook ב-Meta Developers Console.
**תוצאה:** אורחים שעונים "כן" ב-WhatsApp לא מקבלים טיפול.

---

### 2.5 — `submit-wa-template`: לא נפרסה עדיין

**קובץ:** `supabase/functions/submit-wa-template/index.ts:16`

```
// Deploy: npx supabase functions deploy submit-wa-template --no-verify-jwt
```

**סטטוס:** קוד קיים ב-Git אך לא פורס.

---

### 2.6 — Migration 027: לא רצה ב-Supabase

**קובץ:** `supabase/migrations/027_message_templates.sql`

```sql
CREATE TABLE IF NOT EXISTS message_templates (...);
```

**סטטוס:** קובץ קיים — אך הטבלה לא קיימת ב-Supabase עד שרצים את ה-SQL ידנית.

---

## 3. דמו / Fallback שטרם הוחלפו

### 3.1 — AgentChat במצב דמו

**קובץ:** `src/components/AgentChat.js:17,89-95`

```javascript
const USE_DEMO_MODE = !BACKEND_URL && !CHAT_EDGE_URL;
// כשדמו: מחזיר "הסוכן לא מחובר לבינה מלאכותית אמיתית"
```

**נדרש:** הגדרת `REACT_APP_CHAT_EDGE_URL` ב-`.env` שמצביע ל-Edge Function `chat`.

---

### 3.2 — BroadcastDashboard: נתוני דמו במקום Supabase

**קובץ:** `src/components/BroadcastDashboard.js:41-54,85-96`

```javascript
const DEMO = { past: [...], upcoming: [...], current: [...], vip: [...] };
// fallback אוטומטי אם Supabase לא מוגדר
```

**נדרש:** `REACT_APP_SUPABASE_URL` + `REACT_APP_SUPABASE_ANON_KEY` ב-`.env`.

---

### 3.3 — CleaningQR: משימות לא נשמרות ב-DB

**קובץ:** `src/components/CleaningQR.js:108`

```javascript
setTasks(prev => [...prev, { ...payload, id: "demo-" + Date.now() }]);
```

**בעיה:** משימות ניקיון נשמרות רק ב-React state — אובדות ברענון.
**נדרש:** טבלת `cleaning_tasks` ב-Supabase + INSERT API call.

---

### 3.4 — BookingsManager CSV Import: לא מתמיד ב-DB

**קובץ:** `src/components/BookingsManager.js:164-169`

```javascript
id: `demo-${Date.now()}-${i}`,  // local state only
```

**בעיה:** יבוא CSV מוסיף לרשימה המקומית בלבד — אין upsert ל-Supabase.
**נדרש:** Supabase upsert בטבלת `bookings` עם `onConflict: 'phone'` או `id`.

---

## 4. פיצ'רים שתוכננו אך לא מומשו

### 4.1 — לשונית "אוטומציה" ב-AgentChat

תוכנן: AgentChat יקבל tabs נוספות:
- **צ'אט** (קיים)
- **אוטומציה** — פנדינג אישורים, תשלומים תלויים, לוג יומי
- **הגעות** — רשימת הגעות של היום
- **הגדרות**

**סטטוס:** לא מומש. AgentChat מציג רק tab אחד.

---

### 4.2 — AgentQuestionnaire לא מחובר ל-`generate-agent-profile`

**קובץ:** `src/components/AgentQuestionnaire.js:155`
**קובץ:** `supabase/functions/generate-agent-profile/index.ts`

הפונקציה קיימת — אבל `AgentQuestionnaire` שומר את הפרופיל רק ב-`localStorage` ולא קורא ל-Edge Function.

---

### 4.3 — Workshop Link אינו מוגדר

**קובץ:** `supabase/functions/whatsapp-webhook/index.ts:168`

```typescript
const WORKSHOP_LINK = Deno.env.get("WORKSHOP_LINK");
if (WORKSHOP_LINK) { /* שלח הזמנה לסדנאות */ }
```

**סטטוס:** הודעת הסדנאות מוכנה — מחכה לסיפוק ה-`WORKSHOP_LINK` secret ב-Supabase.

---

### 4.4 — Google/TripAdvisor Review Link ל-`dream_post_visit`

**קובץ:** `supabase/functions/arrival-automation/index.ts`

תבנית `dream_post_visit` שולחת בקשת ביקורת — אבל אין לינק Google/TripAdvisor ב-params.
**נדרש:** להחליט על קישור סקירה ולהוסיף כ-param ב-Template.

---

### 4.5 — QR Button ב-RoomStatusBoard

תוכנן: כפתור QR שמקשר ל-CleaningQR component מתוך RoomStatusBoard (כשחדר מסומן "dirty").
**סטטוס:** לא מומש. RoomStatusBoard ו-CleaningQR רצים בנפרד בלי קשר.

---

## 5. בעיות אדריכלות / חוב טכני

### 5.1 — Type Mismatch: agentProfile vs agentProfileId

`AgentChat.js` שולח `agentProfile` (אובייקט מלא) → `chat/index.ts` מצפה ל-`agentProfileId` (מחרוזת).
**השפעה:** ייתכן שהסוכן לא מקבל את הפרופיל בצד ה-edge function.

---

### 5.2 — `REACT_APP_BACKEND_URL` (Google Apps Script) — Legacy

**קובץ:** `.env.example:15`
**סטטוס:** AgentChat עדיין מציע fallback ל-Google Apps Script. צריך לעבור לגמרי ל-Supabase Edge Functions.

---

### 5.3 — RLS חסרה על טבלאות חדשות

לפי חוקי האדריכל (CLAUDE.md סעיף 5): **"Supabase RLS על כל טבלה חדשה"**

טבלאות שנוצרו בסשנים אחרונים ללא RLS מתועדת:
- `bookings` (migration 023) — יש RLS ב-027 כ-reference
- `message_templates` (migration 027) — יש policy: `staff_all_message_templates` ✅
- `cleaning_tasks` — לא קיימת עדיין ❌
- `automation_logs` — לא ברור אם יש RLS ❌

---

## 6. סיכום עדיפויות

| עדיפות | פריט | קובץ | מחסום? |
|--------|------|------|--------|
| 🔴 CRITICAL | אינטגרציית חברת תשלומים | `whatsapp-webhook:43`, `BookingsManager:216` | כן — צלחת חיצונית |
| 🔴 CRITICAL | רישום Webhook ב-Meta Dashboard | — | כן — ידני ב-Meta |
| 🔴 CRITICAL | `submit-wa-template` — לפרוס | CLI command | לא |
| 🔴 CRITICAL | Migration 027 — להריץ ב-Supabase | SQL Editor | לא |
| 🟠 HIGH | pg_cron לתזמון `arrival-automation` | SQL Editor | לא |
| 🟠 HIGH | שחזור 5 Edge Functions חסרות לגיט | — | לא |
| 🟠 HIGH | `WORKSHOP_LINK` secret ב-Supabase | Supabase Secrets | לא |
| 🟡 MEDIUM | לשונית אוטומציה ב-AgentChat | `AgentChat.js` | לא |
| 🟡 MEDIUM | CleaningQR → Supabase persistence | `CleaningQR.js:108` | לא |
| 🟡 MEDIUM | AgentQuestionnaire → generate-agent-profile | `AgentQuestionnaire.js:155` | לא |
| 🟡 MEDIUM | BookingsManager CSV → upsert ל-Supabase | `BookingsManager.js:164` | לא |
| 🟡 MEDIUM | QR button ב-RoomStatusBoard → CleaningQR | `RoomStatusBoard.js` | לא |
| 🟢 LOW | Google Review link ב-`dream_post_visit` | `arrival-automation` | כן — לינק חיצוני |
| 🟢 LOW | מעבר מ-Google Apps Script ל-Supabase | `.env.example` | לא |
| 🟢 LOW | תיקון type mismatch `agentProfile` | `AgentChat.js` / `chat` | לא |

---

*BACKLOG.md נוצר אוטומטית — עדכן ידנית כשפריט מושלם.*

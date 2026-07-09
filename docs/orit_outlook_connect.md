# חיבור תיבת אורית — IMAP read-only (מטריו / Hosted Exchange)

מסמך למייק — אורית **לא שולחת** מהמערכת. היא מעתיקה טיוטות AI ושולחת מ-Outlook.

## מה המערכת עושה

| פעולה | איך |
|--------|-----|
| קריאת מיילים | IMAP כל 10 דק' (`orit-cs-mail-sync`) |
| סיכום + טיוטות | AI על כל פנייה חדשה |
| דייג'סט בוקר | Whatsapp ל-`profiles.phone` של אורית (06:30) |
| שליחה לאורח | **ידנית** מ-Outlook — «העתיקי» → שלחי → «שלחתי — סמני כטופל» |

## 1. פרטים ממטריו (אבי)

בקש **IMAP read-only** ל-`orit@dream-island.co.il`:

- `ORIT_IMAP_HOST` (למשל `mail.dream-island.co.il`)
- `ORIT_IMAP_PORT` (ברירת מחדל `993`)
- `ORIT_IMAP_USER` (לרוב כתובת המייל המלאה)
- `ORIT_IMAP_PASSWORD`
- האם נדרש IP whitelist (Supabase = **אין IP קבוע**)

## 2. Supabase Secrets

```bash
npx supabase secrets set MANAGER_MAIL_ENABLED=true
npx supabase secrets set MANAGER_DIGEST_ENABLED=true
npx supabase secrets set ORIT_IMAP_HOST="<host>"
npx supabase secrets set ORIT_IMAP_PORT="993"
npx supabase secrets set ORIT_IMAP_USER="orit@dream-island.co.il"
npx supabase secrets set ORIT_IMAP_PASSWORD="<password>"
```

אופציונלי: `ORIT_IMAP_TLS=false` רק אם מטריו דורשים פורט 143 ללא SSL.

```bash
npx supabase secrets list
```

## 3. DB + Deploy

```bash
npx supabase db push
npx supabase functions deploy manager-mail-sync manager-mail-analyze manager-mail-send manager-morning-digest manager-mail-auto-ack --no-verify-jwt
npm run build
```

## 4. יום העבודה של אורית

1. Login ל-XOS → **👑 סוכן שירות לקוחות**
2. פניות חדשות מופיעות אחרי סנכרון (עד 10 דק')
3. בוחרת פנייה → **✨ הצעות תשובה**
4. **📋 העתיקי** → הדבקה ב-Outlook → שליחה
5. **✅ שלחתי — סמני כטופל**

## 5. Microsoft Graph (legacy)

`manager-mail-oauth` + Graph נשארו לתאימות M365 — **לא בשימוש** במסלול מטריו.

## Kill switches

| Secret | כבוי |
|--------|------|
| `MANAGER_MAIL_ENABLED` ≠ `true` | סנכרון לא רץ |
| `MANAGER_DIGEST_ENABLED` ≠ `true` | דייג'סט בוקר מדלג |

# חיבור תיבת אורית — Microsoft Graph (M365)

אורית **לא שולחת** מהמערכת. היא מעתיקה טיוטות AI ושולחת מ-Outlook (`dream-island.co.il`).

## ארכיטקטורה

```
אורח → orit@dream-island.co.il (שרת מקומי)
              ↓ Forward (מטריו)
       orit@triobcom.onmicrosoft.com (365)
              ↓ Graph API (OAuth חד-פעמי)
            XOS סוכן
```

## מה המערכת עושה

| פעולה | איך |
|--------|-----|
| קריאת מיילים | Graph API כל 10 דק' (`orit-cs-mail-sync`) |
| סיכום + טיוטות | AI על כל פנייה חדשה |
| דייג'סט בוקר | Whatsapp ל-`profiles.phone` של אורית (06:30) |
| שליחה לאורח | **ידנית** מ-Outlook — «העתיקי» → שלחי → «שלחתי — סמני כטופל» |

## 1. Azure App (אבי)

- Redirect URI (Web): `https://bunohsdggxyyzruubvcd.supabase.co/functions/v1/manager-mail-oauth/callback`
- Logout URL — **לא נדרש**
- Admin consent: `Mail.Read`, `offline_access`, `User.Read`
- Forward: `orit@dream-island.co.il` → תיבת 365 (עם שמירת עותק)

## 2. Supabase Secrets

```bash
npx supabase secrets set MICROSOFT_CLIENT_ID="<azure>"
npx supabase secrets set MICROSOFT_TENANT_ID="<azure>"
npx supabase secrets set MICROSOFT_CLIENT_SECRET="<azure>"
npx supabase secrets set MANAGER_MAIL_ENABLED=true
npx supabase secrets set MANAGER_DIGEST_ENABLED=true
```

**אל** תגדיר `ORIT_IMAP_*` — Graph הוא המסלול הפעיל (migration 208).

## 3. Deploy

```bash
npx supabase db push
npx supabase functions deploy manager-mail-oauth manager-mail-sync manager-mail-analyze manager-mail-send manager-morning-digest manager-mail-auto-ack --no-verify-jwt
npm run build && git push origin main
```

## 4. חיבור OAuth (אורית / מייק)

1. XOS → **👑 סוכן שירות לקוחות**
2. **🔗 חברי תיבת Outlook 365**
3. התחברות ל-`orit@triobcom.onmicrosoft.com` → מסכים
4. **🔄 סנכרן עכשיו**

## 5. יום העבודה של אורית

1. פניות חדשות מופיעות אחרי סנכרון (עד 10 דק' או «סנכרן עכשיו»)
2. בוחרת פנייה → **✨ הצעות תשובה**
3. **📋 העתיקי** → Outlook → שליחה
4. **✅ שלחתי — סמני כטופל**

## Kill switches

| Secret | כבוי |
|--------|------|
| `MANAGER_MAIL_ENABLED` ≠ `true` | סנכרון לא רץ |
| `MANAGER_DIGEST_ENABLED` ≠ `true` | דייג'סט בוקר מדלג |

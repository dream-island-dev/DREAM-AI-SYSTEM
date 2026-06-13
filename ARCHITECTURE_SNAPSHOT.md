# ARCHITECTURE_SNAPSHOT — Dream Island XOS
## עודכן: 2026-06-12

---

## 1. CORE TECH STACK

| שכבה | טכנולוגיה | גרסה |
|------|-----------|-------|
| Frontend | React (CRA) | 19.0.0 |
| Build tool | react-scripts | 5.0.0 |
| Backend | Supabase | bunohsdggxyyzruubvcd (EU Frankfurt) |
| AI model | Claude | claude-opus-4-8 (chat), claude-sonnet-4-6 (profile gen) |
| WhatsApp | Meta Cloud API | DREAM ISLAND BOT, business ID 2284520934910316 |
| Deploy | Vercel (frontend) + Supabase Edge Functions |
| Auth | Google OAuth (GSI) + Supabase Auth |
| State | React hooks + localStorage fallback |
| Packages | @supabase/supabase-js ^2.45, xlsx ^0.18.5, qrcode.react ^4.2, pdfjs-dist ^3.11 |
| Design | RTL עברית, Heebo + Playfair Display, #1B3A32 + #C9A25A + #F7F4EC |

---

## 2. ROUTING & AUTH

**אין React Router** — אפליקציה single-page עם state-based navigation (לא מתועד בקוד הנוכחי בריפו, אבל קיים בפרודקשן לפי CLAUDE.md).

**Auth flow:**
1. `googleAuth.js` → Google GSI → ID Token (JWT)
2. ID Token נשלח לעמוד הבא / Edge Function לאימות
3. Supabase Auth מנהל sessions (supabaseAccessToken מועבר ל-AgentChat)
4. Edge Functions מאמתות Bearer token מול `supabase.auth.getUser()`

**מסכים ידועים (לפי CLAUDE.md, לא בריפו הנוכחי):**
- PasswordChangeScreen
- ניהול משתמשים
- WhatsApp Broadcast
- Human Takeover
- Shift Generator

**מסכים בריפו הנוכחי:**
- `AgentQuestionnaire.js` — 7-step onboarding wizard
- `AgentChat.js` — chat + feedback loop
- `Chat.js` — legacy chat (Google Apps Script backend)

---

## 3. ACTIVE SUPABASE TABLES

### טבלאות בשימוש בפועל מהקוד:

| טבלה | קבצים שמשתמשים בה | פעולות |
|------|-------------------|--------|
| `agent_profiles` | `supabaseClient.js`, `generate-agent-profile/index.ts`, `chat/index.ts` | SELECT, UPSERT |
| `agent_learning_logs` | `supabaseClient.js`, `AgentChat.js`, `chat/index.ts` | INSERT, SELECT (corrections) |
| `conversation_history` | `chat/index.ts` | INSERT |
| `questionnaire_responses` | `generate-agent-profile/index.ts` | INSERT, UPDATE |

### טבלאות ידועות מ-CLAUDE.md (לא מקושרות לקוד בריפו):
- טבלת לידים (WhatsApp leads)
- טבלת guests (אורחים)
- טבלת משמרות (shifts)
- טבלת צ'קליסטים

---

## 4. WHATSAPP ENGINE STATE

### מה עובד (לפי CLAUDE.md):
| Edge Function | סטטוס | תיאור |
|--------------|--------|-------|
| `whatsapp-send` | ✅ פרוסה | שליחת תבניות WhatsApp |
| `get-wa-templates` | ✅ פרוסה | שליפת רשימת תבניות מ-Meta |
| `register-templates` | ✅ פרוסה | רישום תבניות חדשות |
| `morning-briefing` | ✅ פרוסה | תדריך בוקר |

### מה חסר (לא קיים בריפו):
| פונקציה | סטטוס | הערה |
|---------|--------|-------|
| WhatsApp Webhook (incoming) | ❌ חסר | לא קיים — פריט 2 בסשן הזה |
| Intent detection | ❌ חסר | חלק מפריט 2 |
| Payment callback endpoint | ❌ חסר | חלק מפריט 3 |

### תבניות Meta (13 ידועות לפי CLAUDE.md):
- חלק APPROVED, חלק PENDING
- `{{1}}` = שם אורח אוטומטי
- תבנית תשלום + סדנאות — **עדיין לא קיימת / טעונה בדיקה מול Meta**

---

## 5. PENDING BLOCKERS

| בעיה | סוג | קובץ רלוונטי |
|------|-----|-------------|
| `AgentQuestionnaire` עובד ב-demo mode — לא קורא ל-`generate-agent-profile` edge function | חיבור חסר | `AgentQuestionnaire.js:155` |
| `chat` edge function משתמש ב-`agentProfileId` אבל `AgentChat` שולח `agentProfile` שלם | type mismatch | `AgentChat.js:54` vs `chat/index.ts:38` |
| קבצי WhatsApp Edge Functions (`whatsapp-send`, `get-wa-templates` וכו') לא קיימים בריפו — רק ב-Supabase | גיבוי חסר | — |
| אין RLS policies מתועדות בריפו | אבטחה | כל הטבלאות |
| `REACT_APP_BACKEND_URL` עדיין מכוון ל-Google Apps Script | legacy | `.env.example:15` |
| `supabase/migrations/` לא קיים בריפו — היסטוריית schema חסרה | תיעוד | — |
| תבנית WhatsApp לתשלום + סדנאות — לא נבדקה מול 13 התבניות המאושרות | בדיקה נדרשת | פריט 3 |

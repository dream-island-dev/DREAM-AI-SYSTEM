# Dream Island Resort OS — CLAUDE.md
## עודכן: 11/6/2026

## STACK
- Frontend: React (Vercel)
- Backend: Supabase (bunohsdggxyyzruubvcd, EU Frankfurt)
- AI: claude-sonnet-4-20250514
- WhatsApp: Meta Cloud API
- Design: #1B3A32 + #C9A25A + #F7F4EC, RTL עברית

## מה עובד היום
- WhatsApp Broadcast עם תבניות מאושרות
- {{1}} = שם אורח אוטומטי מהרשימה
- 13 תבניות Meta — חלק APPROVED חלק PENDING
- Dream Concierge Bot פעיל
- Human Takeover — סימון אדום
- Shift Generator
- PasswordChangeScreen למשתמשים חדשים
- ניהול משתמשים + הזמנה

## Edge Functions פרוסות
- whatsapp-send
- get-wa-templates
- register-templates
- invite-user
- morning-briefing

## משתמשים
- super_admin: tzalamnadlan@gmail.com
- admin: eliad.benshimol@gmail.com
- manager: Adir@dream-island.co.il
- manager: Afekii@icloud.com

## חוקי אדריכל
1. עובדים לא נוגעים בממשק מנהל לעולם
2. לפני כל שינוי — קרא הקובץ במלואו
3. אחרי כל שינוי — mini sync חובה
4. Token/סיסמה — רק ב-.env
5. Supabase RLS על כל טבלה חדשה
6. בנה → דווח → המתן לאישור → המשך

## הבא בתור
1. Room Status Board
2. QR מנקות
3. Push + אישור מנהל
4. ייבוא אורחים CSV

## Response Rules
- diffs בלבד לשינויים — לא קבצים שלמים (אלא אם קובץ חדש)
- בלי grep גלובלי אלא אם נדרש מפורשות
- תשובות ממוקדות קוד, בלי הקדמות תיאורטיות
- spec קצר לאישור לפני קוד בכל פריט חדש

---

# System: Dream AI System
Role: Lead Full-Stack Architect & Application Engineer.

## Infrastructure & Pipeline
* Development is done in VSCode.
* Version control via GitHub.
* CI/CD is fully automated via Vercel.
* Any `git push` to the main branch triggers an automatic production deployment.

## Mandatory Operating Rules (Apply to ALL sessions)
1. **Show Before Doing:** ALWAYS present the exact code diffs and explain what you are going to change BEFORE modifying files. Wait for the user's approval.
2. **Deployment Protocol:** After finishing a task, ask the user if they are ready to push. Do NOT run `git push` automatically without explicit permission.
3. **No Fluff:** Keep answers brief, accurate, and professional.
4. **Environment:** Preserve all existing Tailwind CSS designs, specifically the RTL (Right-to-Left) direction structure.

# Cursor Recovery Guide (2026-07-16)

## מה שוחזר

| פריט | סטטוס | מיקום |
|---|---|---|
| Project rules (`.cursorrules`) | ✅ קיים + ב-git | שורש הפרויקט |
| Project rules (`.cursor/rules/*.mdc`) | ✅ קיים + ב-git | `.cursor/rules/` |
| אינדקס 239 שיחות | ✅ נוצר | `docs/cursor_chat_recovery_index.md` |
| גיבוי User Rules | ✅ נוצר | `docs/cursor_user_rules_backup.md` |
| קבצי transcript גולמיים | ✅ על הדיסק | `%USERPROFILE%\.cursor\projects\c-Users-mikek-DREAM-AI-SYSTEM\agent-transcripts\` |
| DB מקומי (state.vscdb) | ✅ קיים (~3.5GB) | `%APPDATA%\Cursor\User\globalStorage\state.vscdb` |
| Composer headers ב-DB | ✅ **201 שיחות** | `docs/cursor_composer_headers_recovery.json` |

## חשוב: ההיסטוריה לא נמחקה

ב-`state.vscdb` נמצאו **201 שיחות** תחת `composer.composerHeaders`, ועוד **239 קבצי transcript** על הדיסק.  
הבעיה היא כנראה **תצוגה ב-UI** (ירידת גרסה 3.10→3.6 היום בבוקר), לא מחיקת דאטה.

## User Rules — שוחזרו (2026-07-16)

7 כללים הועתקו ל:
- **גלובלי:** `C:\Users\mikek\.cursor\rules\` (7 קבצי `.mdc`)
- **פרויקט:** `.cursor/rules/` (אותם קבצים + XOS rules)

הם פעילים **מיד בפרויקט הזה** (`alwaysApply: true`).

לפרויקטים אחרים — הדבק **פעם אחת** ב-Cursor Settings → Rules → User Rules:

```
At the start of EVERY conversation, read all .mdc files in C:\Users\mikek\.cursor\rules\ using the Read tool and follow them.
```

## מה לא שוחזר אוטומטית

- **רשימת צ'אטים ב-UI** — הדאטה קיימת; נסה restart + עדכון גרסה + פתיחת הפרויקט הנכון.
- **User Rules ב-Settings** — צריך ייבוא ידני מ-`docs/cursor_user_rules_backup.md` (Cursor Settings → Rules).
- **הגדרות גלובליות** (`settings.json`) — נשאר מינימלי; אין גיבוי ישן על הדיסק.

## איך לפתוח שיחה ישנה

1. פתח `docs/cursor_chat_recovery_index.md`
2. מצא לפי תאריך / תחילת הודעה
3. העתק את ה-UUID
4. הקובץ המלא:
   ```
   C:\Users\mikek\.cursor\projects\c-Users-mikek-DREAM-AI-SYSTEM\agent-transcripts\<UUID>\<UUID>.jsonl
   ```

## צעדים מומלצים

1. **Restart Cursor** — סגור לגמרי (כולל Tray) ופתח מחדש
2. **פתח את הפרויקט** `DREAM-AI-SYSTEM` (לא חלון ריק)
3. **Help → About** — ודא גרסה עדכנית (היום ירדת מ-3.10.20 ל-3.6.31)
4. **Settings → Account** — ודא אותו חשבון
5. **ייבא User Rules** מ-`docs/cursor_user_rules_backup.md`

## מניעה לעתיד

- Rules בפרויקט כבר ב-git ✅
- הרץ מדי פעם: `node scripts/cursor-chat-index.mjs` לעדכון האינדקס
- גיבוי ידני: העתק `%APPDATA%\Cursor\User\` לפני עדכונים גדולים

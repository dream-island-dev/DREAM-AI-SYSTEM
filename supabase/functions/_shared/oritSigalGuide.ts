// Plain Hebrew copy + voice-friendly intent for Orit ↔ Sigal WhatsApp chat.

export const SIGAL_GUIDE_ACK = [
  "שלב א׳ — מייל «קיבלנו את פנייתך»:",
  "① «תראי לי» — אראה את הנוסח",
  "② «אשרי» — אראה שוב בדיוק מה יישלח",
  "③ «כן שלחי» — רק אז נשלח לאורח/ת",
].join("\n");

export const SIGAL_GUIDE_AFTER_ACK = "אחרי שאישור הקבלה יצא — אכין לך גם מכתב תשובה מלא (שלב ב׳).";

export const SIGAL_GUIDE_FULL = [
  "שלב ב׳ — מכתב תשובה מלא:",
  "① «תשובה מלאה» — לראות את הנוסח",
  "② «אשרי» — לבדוק לפני שליחה",
  "③ «כן שלחי» — לשלוח",
].join("\n");

export const SIGAL_GUIDE_HELP = [
  "היי אורית 💜 אני סיגל — העוזרת שלך כאן.",
  "",
  SIGAL_GUIDE_ACK,
  "",
  SIGAL_GUIDE_AFTER_ACK,
  "",
  SIGAL_GUIDE_FULL,
  "",
  "בכל שלב:",
  "• «מה כתבה» — מה האורח/ת כתב/ה",
  "• «מה המצב» — איפה אנחנו עומדות",
  "• «סיימתי» — סגרנו את הנושא",
  "• «קישור» — רק אם צריך את המחשב",
  "",
  "אפשר גם להקליט לי — אני מבינה דיבור, לא רק מילים מדויקות.",
].join("\n");

export const SIGAL_GUIDE_CONFIRM = "מוכנה לשלוח? עני «כן שלחי» · לביטול — «לא»";

export type OritSigalIntent =
  | "confirm_send"
  | "cancel"
  | "show_ack"
  | "prepare_ack"
  | "show_full"
  | "show_guest"
  | "status"
  | "mark_done"
  | "help"
  | "link";

function stripForIntent(text: string): string {
  return (text || "")
    .replace(/[«»"']/g, "")
    .replace(/[.,!?…:;]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Map free text / voice transcript → command (null = not a known command). */
export function resolveOritSigalIntent(text: string): OritSigalIntent | null {
  const t = stripForIntent(text);
  if (!t) return null;

  if (/(עזרה|מה לעשות|איך .*מתקדמ|איך .*עובד|מה אפשר|פקודות|help)/.test(t)) {
    return "help";
  }

  if (/(^|\s)(סיימתי|טופל|סגרתי|הנושא נסגר|טיפלתי בזה|done)(\s|$)/.test(t)) {
    return "mark_done";
  }

  if (/(מה המצב|איפה אנחנו|מה הסטטוס|מה קורה עם|סטטוס הפנייה)/.test(t)) {
    return "status";
  }

  if (/(מה (היא|הוא|האורח|האורחת) כתב|מה כתבה|מה כתב|מה השיב|מה השיבה|מה ענה|הודעת האורח)/.test(t)) {
    return "show_guest";
  }

  if (/(תשובה\s*ה?מלאה|מכתב מלא|שלב 2|שלב ב|שלב שתיים|התשובה לאורח|המכתב לאורח)/.test(t)) {
    return "show_full";
  }

  if (/(קישור|פתחי במערכת|לינק|למחשב)/.test(t)) {
    return "link";
  }

  if (/(^|\s)(לא|בטלי|עצרי|ביטול|תעצרי|cancel|stop)(\s|$)/.test(t)) {
    return "cancel";
  }

  if (
    /^(כן(\s+שלחי)?|כן תשלחי|בסדר תשלחי|מאשרת|מאשרת שליחה|שלחי|תשלחי|אישור|יאללה שלחי|ok|yes|go)$/.test(t)
    || /(כן|מאשר|בסדר|יאללה).*(שלח|שליחה)/.test(t)
  ) {
    return "confirm_send";
  }

  if (/^אשרי$/.test(t) || /(תכיני לשליחה|להכנה לשליחה|בואי נשלח את אישור)/.test(t)) {
    return "prepare_ack";
  }

  if (
    /(תראי לי|הציגי|מה הטקסט|מה כתוב|מה במייל|תקראי לי|אישור קבלה|הטיוטה|הראי לי)/.test(t)
    && !/מלאה|מכתב מלא/.test(t)
  ) {
    return "show_ack";
  }

  return null;
}

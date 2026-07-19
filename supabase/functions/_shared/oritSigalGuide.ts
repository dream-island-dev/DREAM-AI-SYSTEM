// Plain Hebrew copy + voice-friendly intent for Orit ↔ Sigal WhatsApp chat.

/** Warm intro — daughter-assistant tone. */
export const SIGAL_INTRO_SUMMARY = [
  "אני כאן כדי לחסוך לך זמן:",
  "קוראת את המיילים, מסכמת, ומכינה טיוטות בסגנון שלך.",
  "שום דבר לא יוצא לאורח בלי שאת מאשרת.",
].join("\n");

export const SIGAL_GUIDE_ACK = [
  "לשלוח את אישור הקבלה:",
  "«תראי לי» → «כן שלחי»",
].join("\n");

export const SIGAL_GUIDE_AFTER_ACK = "";

export const SIGAL_GUIDE_FULL = [
  "לשלוח את התשובה המלאה:",
  "«תשובה מלאה» → «כן שלחי»",
  "",
  "לידים ופניות רגילות — שלב אחד: «תראי לי» או «תשובה מלאה».",
].join("\n");

export const SIGAL_GUIDE_HELP = [
  "היי אורית 💜 אני סיגל — העוזרת שלך.",
  "",
  SIGAL_INTRO_SUMMARY,
  "",
  "מה אפשר לבקש:",
  "• «תראי לי» / «תשובה מלאה» — לראות טיוטה לפני שליחה",
  "• «כן שלחי» — לשלוח (רק אחרי שראית)",
  "• «מה כתבה» — מה האורח/ת כתב/ה",
  "• «מה המצב» — איפה אנחנו עם הפנייה",
  "• «סיימתי» / «טיפלתי בזה» — לסגור את הנושא",
  "• «שלחי בוואטסאפ» — כשאין מייל אבל יש טלפון",
  "• «קישור» — לפתוח במחשב",
  "",
  "אפשר גם להקליט — אני מבינה דיבור.",
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
  | "link"
  | "intro"
  | "send_whatsapp";

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

  if (/(מה את עושה|מי את|איך את עוזר|מה התפקיד|מה את מסבירה)/.test(t)) {
    return "intro";
  }

  if (
    /(סיימתי|סמני כטופל|סמן כטופל|טיפלתי בזה|טיפלתי|טופל|סגרתי|סגרנו|הנושא נסגר|זה טופל|הטיפול הושלם|טיפלתי בזה בטלפון|done)(\s|$)/.test(t)
    || /^(סיימתי|טיפלתי)$/.test(t)
  ) {
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

  if (/(שלחי בוואטסאפ|שלחי וואטסאפ|וואטסאפ|whatsapp)/.test(t) && !/אינבוקס|שיחה/.test(t)) {
    return "send_whatsapp";
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

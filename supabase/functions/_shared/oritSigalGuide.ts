// Plain Hebrew copy + voice-friendly intent for Orit ↔ Sigal WhatsApp chat.

/** Warm intro — daughter-assistant tone. */
export const SIGAL_INTRO_SUMMARY = "אני מכינה טיוטות בסגנון שלך — שום דבר לא יוצא בלי אישור שלך.";

export const SIGAL_GUIDE_ACK = [
  "שלב 1 — הודעה קצרה «קיבלנו את פנייתך»:",
  '"תראי לי" לראות · "כן שלחי" לשליחה',
].join("\n");

export const SIGAL_GUIDE_AFTER_ACK = "";

export const SIGAL_GUIDE_FULL = [
  "שלב 2 — המכתב המלא לאורח:",
  '"תשובה מלאה" — ואז "כן שלחי"',
  "",
  "לידים ופניות רגילות — שלב אחד בלבד.",
].join("\n");

export const SIGAL_GUIDE_HELP = [
  "תלונה = שני שלבים:",
  "1) «קיבלנו את פנייתך» — דחוף, \"תראי לי\"",
  "2) מכתב מלא — \"תשובה מלאה\"",
  '"כן שלחי" · "תסדרי…" · "סיימתי" · "קישור" (לממשק)',
].join("\n");

export const SIGAL_GUIDE_CONFIRM = 'מוכנה לשלוח? עני "כן שלחי" · לביטול — "לא"';

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

  if (/(מה המצב|איפה אנחנו|מה הסטטוס|מה קורה עם|סטטוס הפנייה|קישור|פתחי במערכת|לינק|בממשק|באפליקציה)/.test(t)) {
    return "status";
  }

  if (/(מה (היא|הוא|האורח|האורחת) כתב|מה כתבה|מה כתב|מה השיב|מה השיבה|מה ענה|הודעת האורח)/.test(t)) {
    return "show_guest";
  }

  if (/(תשובה\s*ה?מלאה|מכתב מלא|שלב 2|שלב ב|שלב שתיים|התשובה לאורח|המכתב לאורח)/.test(t)) {
    return "show_full";
  }

  if (
    /(קיבלנו|אישור קבלה|ההודעה הראשונה|הודעה ראשונה|שלב 1|שלב א)/.test(t)
    && !/מלאה|מכתב מלא/.test(t)
  ) {
    return "show_ack";
  }

  if (/(שלחי בוואטסאפ|שלחי וואטסאפ|וואטסאפ|whatsapp)/.test(t) && !/אינבוקס|שיחה/.test(t)) {
    return "send_whatsapp";
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

/** Orit pasted a full replacement letter — not an edit instruction. */
export function isLikelyCustomDraft(text: string): boolean {
  const t = text.trim();
  return t.length >= 60 && (/שלום|תודה|אורית|בברכה|קיבלנו/i.test(t));
}

/** Short verbal edit request — route to AI refine (not a full paste). */
export function isOritRefineInstruction(text: string): boolean {
  const t = (text || "").trim();
  if (t.length < 6) return false;
  if (isLikelyCustomDraft(t)) return false;
  if (resolveOritSigalIntent(t)) return false;
  return /(תסדר|תכתב|תערכ|תשנ|תוסיפ|תוריד|תקצר|יותר\s+אישי|יותר\s+רך|פחות\s+רשמי|התנצל|סגנון|נוסח|טון|כתבי|סדרי|ערכי|תעדכן|תהפוך|תשנה|תעשי|תוסיפי|תחזר)/i.test(t);
}

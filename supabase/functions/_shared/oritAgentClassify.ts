// Tier-0 keyword classification for Orit CS Agent (before / after LLM).

export type OritThreadCategory =
  | "complaint"
  | "lead"
  | "booking"
  | "spa"
  | "vendor"
  | "internal"
  | "other";

export type OritUrgency = "critical" | "high" | "normal" | "low";

export type Tier0OritHint = {
  category: OritThreadCategory;
  urgency: OritUrgency;
  urgency_reason: string;
  summary: string;
  suggestions: string[];
  engine: "tier0";
};

const GENERIC_LEAD_SUBJECT_RE = /התקבלה פניה מלידים|פניה מלידים|lead inquiry/i;

const COMPLAINT_RE = /תלונ|אכזב|פיצוי|לא מרוצ|גרוע|נורא|מזעזע|החמיר|כישלון|נפגע|זועם|בושה|מחאה|החזר כספ|refund|complaint|disappoint/i;

const CRITICAL_COMPLAINT_RE = /תלונה חמור|פגיעה קשה|מזעזע|בושה|החזר מלא|עורך דין|משפט/i;

const LEAD_RE = /מעוניין|מעוניינת|להזמין|הזמנה|פרטים נוספים|מחיר|זמינות|חבילה|סוויטה|יום כיף|ביקור|שאלה לגבי|רוצה לבוא|interested|booking inquiry/i;

const SPA_RE = /ספא|טיפול|מסאז|עיסוי|spa/i;

const BOOKING_RE = /הזמנת לינה|תאריך הגעה|לילות|check.?in|חדר/i;

export function isGenericLeadFormSubject(subject: string): boolean {
  return GENERIC_LEAD_SUBJECT_RE.test((subject || "").trim());
}

function classifyText(text: string): Tier0OritHint | null {
  const body = (text || "").trim();
  if (!body || body.length < 8) return null;

  if (COMPLAINT_RE.test(body)) {
    const critical = CRITICAL_COMPLAINT_RE.test(body);
    const guestLine = body.split("\n").find((l) => l.trim().length > 12)?.trim().slice(0, 200)
      ?? "תלונת אורח על חוויית השהייה.";
    return {
      category: "complaint",
      urgency: critical ? "critical" : "high",
      urgency_reason: critical
        ? "תלונה חמורה — דורשת טיפול מיידי ואמפתי מצד אורית."
        : "תלונת אורח — יש להגיב במהירות ובטון מתנצל.",
      summary: guestLine,
      suggestions: [
        "שלום, תודה שפנית אלינו. אנחנו מצטערים לשמוע על החוויה שלך ולוקחים את הפנייה ברצינות רבה. נבדוק את הפרטים ונחזור אליך בהקדם.",
        "שלום, קיבלנו את תלונתך ומצטערים על האי-נוחות. הצוות שלנו בודק את הנושא ואורית תחזור אליך אישית בהקדם האפשרי.",
      ],
      engine: "tier0",
    };
  }

  if (SPA_RE.test(body) && !BOOKING_RE.test(body)) {
    return {
      category: "spa",
      urgency: "normal",
      urgency_reason: "פנייה בנושא ספא — מענה רגיל.",
      summary: body.slice(0, 220),
      suggestions: [
        "שלום, תודה על פנייתך בנושא הספא. נשמח לעזור — נחזור אליך בהקדם עם פרטים.",
      ],
      engine: "tier0",
    };
  }

  if (BOOKING_RE.test(body) || LEAD_RE.test(body)) {
    return {
      category: LEAD_RE.test(body) && !BOOKING_RE.test(body) ? "lead" : "booking",
      urgency: "normal",
      urgency_reason: "פניית ליד / הזמנה — מענה רגיל.",
      summary: body.slice(0, 220),
      suggestions: [
        "שלום, תודה על פנייתך לדרים איילנד! קיבלנו את הבקשה ונחזור אליך בהקדם עם כל הפרטים.",
        "שלום, שמחנו לשמוע ממך. נבדוק זמינות ונחזור אליך בהקדם.",
      ],
      engine: "tier0",
    };
  }

  return null;
}

/** Classify from body; ignore misleading website form subject when it says "לידים". */
export function tier0ClassifyOritThread(bodyText: string, subject: string): Tier0OritHint | null {
  const body = (bodyText || "").trim();
  const subj = (subject || "").trim();

  const fromBody = classifyText(body);
  if (fromBody) return fromBody;

  if (isGenericLeadFormSubject(subj) && body.length < 20) {
    return {
      category: "lead",
      urgency: "normal",
      urgency_reason: "פניית ליד מהאתר — מענה רגיל.",
      summary: subj || "פניית ליד חדשה מהאתר.",
      suggestions: [
        "שלום, תודה על פנייתך לדרים איילנד! קיבלנו את הבקשה ונחזור אליך בהקדם.",
      ],
      engine: "tier0",
    };
  }

  return classifyText(`${body}\n${subj}`);
}

export function mergeTier0Category(
  tier0: Tier0OritHint | null,
  llmCategory: string,
  llmUrgency: string,
): { category: OritThreadCategory; urgency: OritUrgency } {
  const allowed = new Set(["complaint", "lead", "booking", "spa", "vendor", "internal", "other"]);
  let category = (allowed.has(llmCategory) ? llmCategory : "other") as OritThreadCategory;
  let urgency = (["critical", "high", "normal", "low"].includes(llmUrgency) ? llmUrgency : "normal") as OritUrgency;

  if (tier0?.category === "complaint" && category !== "complaint") {
    category = "complaint";
    if (urgency === "normal" || urgency === "low") urgency = tier0.urgency;
  }

  if (tier0?.category === "lead" && category === "other") {
    category = "lead";
  }

  return { category, urgency };
}

// Waiter Service Pulse — editable outward-focused survey (what to improve, not self-rating).

export const BOT_CONFIG_WAITER_PULSE_UI_KEY = "waiter_service_pulse_ui";

export const WAITER_PULSE_QUESTION_TYPES = Object.freeze([
  Object.freeze({ id: "single_choice", label: "בחירה אחת" }),
  Object.freeze({ id: "multi_choice", label: "בחירה מרובה" }),
  Object.freeze({ id: "text", label: "טקסט חופשי" }),
]);

export const WAITER_PULSE_MANAGEMENT_STATUSES = Object.freeze([
  Object.freeze({ id: "new", label: "חדש" }),
  Object.freeze({ id: "reviewing", label: "בבדיקה" }),
  Object.freeze({ id: "implemented", label: "יושם" }),
  Object.freeze({ id: "declined", label: "לא עכשיו" }),
]);

const QUESTION_KEY_RE = /^[a-z][a-z0-9_]{0,48}$/;
export const WAITER_PULSE_MAX_QUESTIONS = 15;
export const WAITER_PULSE_MIN_QUESTIONS = 1;

export const DEFAULT_WAITER_PULSE_UI = Object.freeze({
  panel_title: "שאלון מלצרים - מסעדת ערמונים",
  intro_text:
    "שאלון זה הינו אנונימי לחלוטין!\n\nהמטרה שלנו היא לשפר את סביבת העבודה, התקשורת והחוויה של כולנו במסעדה. נשמח לתשובות הכנות שלך.",
  submit_label: "📋 שליחת השאלון",
  thank_you_title: "תודה על המשוב! 🙏",
  thank_you_body:
    "התשובות נשלחו באופן אנונימי להנהלה. נשתמש בהן כדי לשפר את סביבת העבודה, התקשורת והחוויה של כולנו במסעדה.",
  questions: Object.freeze([
    Object.freeze({
      key: "tenure",
      type: "single_choice",
      label: "1. כמה זמן אתה עובד במסעדת ערמונים? (בחירה אחת)",
      required: true,
      options: Object.freeze([
        Object.freeze({ id: "less_3_months", label: "פחות מ-3 חודשים" }),
        Object.freeze({ id: "3_6_months", label: "3–6 חודשים" }),
        Object.freeze({ id: "half_to_year", label: "חצי שנה עד שנה" }),
        Object.freeze({ id: "over_year", label: "מעל שנה" }),
      ]),
    }),
    Object.freeze({
      key: "manager_presence",
      type: "single_choice",
      label: "2. האם אתה מרגיש שהמנהל נוכח במשמרת?",
      required: true,
      options: Object.freeze([
        Object.freeze({ id: "yes", label: "כן" }),
        Object.freeze({ id: "no", label: "לא" }),
      ]),
      allow_other: true,
      other_label: "אחר / פירוט",
    }),
    Object.freeze({
      key: "manager_respect",
      type: "single_choice",
      label: "3. האם אתה מרגיש שהמנהלים מתייחסים אליך בכבוד?",
      required: true,
      options: Object.freeze([
        Object.freeze({ id: "yes", label: "כן" }),
        Object.freeze({ id: "no", label: "לא" }),
      ]),
      allow_other: true,
      other_label: "אחר / פירוט",
    }),
    Object.freeze({
      key: "manager_improvements",
      type: "multi_choice",
      label:
        "4. מה לדעתך המנהלים יכולים לעשות טוב יותר? (ניתן לסמן מספר אפשרויות ו/או לפרט בחופשיות)",
      required: true,
      options: Object.freeze([
        Object.freeze({ id: "clear_communication", label: "תקשורת ברורה ופתוחה יותר מול הצוות" }),
        Object.freeze({ id: "physical_support", label: "תמיכה וסיוע פיזי במהלך סרוויס עמוס" }),
        Object.freeze({ id: "positive_feedback", label: "מתן משוב חיובי/בונה בסיום משמרת" }),
        Object.freeze({ id: "fair_shifts", label: "חלוקה צודקת ומאוזנת של משמרות" }),
        Object.freeze({ id: "more_training", label: "הגדלת הדרכות ומקצועיות" }),
      ]),
      allow_other: true,
      other_label: "אחר / פירוט חופשי",
    }),
    Object.freeze({
      key: "team_cooperation",
      type: "single_choice",
      label: "5. האם יש שיתוף פעולה בין חברי הצוות?",
      required: true,
      options: Object.freeze([
        Object.freeze({ id: "yes", label: "כן" }),
        Object.freeze({ id: "no", label: "לא" }),
      ]),
      allow_other: true,
      other_label: "אחר / פירוט",
    }),
    Object.freeze({
      key: "tip_agreement_awareness",
      type: "single_choice",
      label: "6. האם אתה יודע שקיימת הסכמה בין המלצרים לגבי לקיחת טיפים?",
      required: true,
      options: Object.freeze([
        Object.freeze({ id: "yes", label: "כן" }),
        Object.freeze({ id: "no", label: "לא" }),
      ]),
      allow_other: true,
      other_label: "אחר / פירוט",
    }),
    Object.freeze({
      key: "tips_policy_aware",
      type: "single_choice",
      label: "7. חלוקת טיפים במשמרת — א. האם אתה מודע להגדרה זו?",
      help_text:
        "כהגדרה, טיפים המתקבלים מהלקוחות בכל שעות המשמרת הם טיפים משותפים לכלל המלצרים.",
      required: true,
      options: Object.freeze([
        Object.freeze({ id: "yes", label: "כן" }),
        Object.freeze({ id: "no", label: "לא" }),
      ]),
    }),
    Object.freeze({
      key: "tips_policy_change",
      type: "single_choice",
      label: "7. חלוקת טיפים במשמרת — ב. האם היית רוצה לשנות את השיטה הנוכחית?",
      required: true,
      options: Object.freeze([
        Object.freeze({ id: "no_change", label: "לא, השיטה טובה בעיניי" }),
      ]),
      allow_other: true,
      other_label: "כן (נמק מה היית משנה)",
    }),
    Object.freeze({
      key: "training_sufficient",
      type: "single_choice",
      label: "8. האם אתה מרגיש שקיבלת הכשרה מספקת מהמנהלים?",
      required: true,
      options: Object.freeze([
        Object.freeze({ id: "yes", label: "כן" }),
        Object.freeze({ id: "no", label: "לא" }),
      ]),
      allow_other: true,
      other_label: "פירוט (מה היה חסר בהכשרה?)",
    }),
    Object.freeze({
      key: "service_knowledge_gaps",
      type: "multi_choice",
      label: "9. האם אתה מרגיש צורך בחיזוק ידע במתן שירות?",
      required: true,
      options: Object.freeze([
        Object.freeze({ id: "confident", label: "לא, מרגיש שולט בחומר" }),
        Object.freeze({ id: "food_menu", label: "כן – בתפריט האוכל / ספיישלים" }),
        Object.freeze({ id: "wine_bar", label: "כן – בתפריט היין, האלכוהול והקוקטיילים" }),
        Object.freeze({ id: "pos_system", label: "כן – תפעול קופה / מערכת ההזמנות" }),
        Object.freeze({ id: "complaints", label: "כן – התמודדות עם תלונות לקוח וסרוויס מורכב" }),
      ]),
      allow_other: true,
      other_label: "פירוט נוסף",
    }),
    Object.freeze({
      key: "cross_team_difficulty",
      type: "multi_choice",
      label: "10. האם אתה מרגיש קושי בעבודה מול המטבח / הבר / המארחות?",
      required: true,
      options: Object.freeze([
        Object.freeze({ id: "no_difficulty", label: "לא, העבודה זורמת מצוין מול כולם" }),
        Object.freeze({ id: "kitchen", label: "כן – קושי מול המטבח" }),
        Object.freeze({ id: "bar", label: "כן – קושי מול הבר" }),
        Object.freeze({ id: "hosts", label: "כן – קושי מול צוות המארחות" }),
      ]),
      allow_other: true,
      other_label: "פירוט (מה מורכב/מה מפריע לך?)",
    }),
    Object.freeze({
      key: "additional_comments",
      type: "text",
      label: "11. משהו נוסף שהיית רוצה להוסיף או לשנות? (כתיבה חופשית)",
      required: false,
      placeholder: "כתבו כאן בחופשיות…",
      min_length: 0,
    }),
  ]),
});

function plainDefaultUi() {
  return {
    panel_title: DEFAULT_WAITER_PULSE_UI.panel_title,
    intro_text: DEFAULT_WAITER_PULSE_UI.intro_text,
    submit_label: DEFAULT_WAITER_PULSE_UI.submit_label,
    thank_you_title: DEFAULT_WAITER_PULSE_UI.thank_you_title,
    thank_you_body: DEFAULT_WAITER_PULSE_UI.thank_you_body,
    questions: DEFAULT_WAITER_PULSE_UI.questions.map((q) => ({
      key: q.key,
      type: q.type,
      label: q.label,
      help_text: q.help_text ?? "",
      required: q.required === true,
      placeholder: q.placeholder ?? "",
      min_length: q.min_length ?? 0,
      allow_other: q.allow_other === true,
      other_label: q.other_label ?? "אחר",
      options: (q.options ?? []).map((o) => ({ id: o.id, label: o.label })),
    })),
  };
}

export function isValidWaiterPulseQuestionKey(key) {
  return QUESTION_KEY_RE.test(String(key ?? ""));
}

export function makeWaiterPulseQuestionKey(existingKeys = []) {
  const used = new Set((existingKeys || []).map((k) => String(k)));
  for (let i = 0; i < 40; i++) {
    const key = `q_${Math.random().toString(36).slice(2, 8)}`;
    if (!used.has(key) && isValidWaiterPulseQuestionKey(key)) return key;
  }
  return `q_${Date.now().toString(36)}`;
}

function normalizeOption(raw, fallbackId) {
  const id = String(raw?.id ?? fallbackId ?? "").trim();
  const label = String(raw?.label ?? "").trim();
  if (!id || !label) return null;
  return { id, label };
}

function normalizeQuestion(raw, idx) {
  const type = ["single_choice", "multi_choice", "text"].includes(raw?.type) ? raw.type : "text";
  const key = isValidWaiterPulseQuestionKey(raw?.key) ? raw.key : makeWaiterPulseQuestionKey();
  const label = String(raw?.label ?? "").trim() || `שאלה ${idx + 1}`;
  const base = {
    key,
    type,
    label,
    help_text: String(raw?.help_text ?? "").trim(),
    required: raw?.required === true,
    placeholder: String(raw?.placeholder ?? "").trim(),
    min_length: Math.max(0, Number(raw?.min_length) || 0),
  };
  if (type === "text") return base;
  const options = (Array.isArray(raw?.options) ? raw.options : [])
    .map((o, i) => normalizeOption(o, `opt_${i + 1}`))
    .filter(Boolean);
  return {
    ...base,
    options: options.length ? options : [{ id: "opt_1", label: "אפשרות 1" }],
    allow_other: raw?.allow_other === true,
    other_label: String(raw?.other_label ?? "אחר").trim() || "אחר",
  };
}

export function normalizeWaiterPulseUi(raw) {
  let parsed = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }
  const base = plainDefaultUi();
  if (!parsed || typeof parsed !== "object") return base;

  base.panel_title = String(parsed.panel_title ?? base.panel_title).trim() || base.panel_title;
  base.intro_text = String(parsed.intro_text ?? base.intro_text).trim() || base.intro_text;
  base.submit_label = String(parsed.submit_label ?? base.submit_label).trim() || base.submit_label;
  base.thank_you_title = String(parsed.thank_you_title ?? base.thank_you_title).trim() || base.thank_you_title;
  base.thank_you_body = String(parsed.thank_you_body ?? base.thank_you_body).trim() || base.thank_you_body;

  if (Array.isArray(parsed.questions) && parsed.questions.length) {
    base.questions = parsed.questions
      .slice(0, WAITER_PULSE_MAX_QUESTIONS)
      .map((q, i) => normalizeQuestion(q, i));
  }
  if (base.questions.length < WAITER_PULSE_MIN_QUESTIONS) {
    return plainDefaultUi();
  }
  return base;
}

export function serializeWaiterPulseUi(ui) {
  return JSON.stringify(normalizeWaiterPulseUi(ui));
}

export function cloneDefaultWaiterPulseUi() {
  return plainDefaultUi();
}

export function optionLabelById(question, id) {
  const opt = (question?.options ?? []).find((o) => o.id === id);
  return opt?.label ?? id;
}

/** Validate answers object against normalized UI — returns Hebrew error or null. */
export function validateWaiterPulseAnswers(ui, answers) {
  const resolved = normalizeWaiterPulseUi(ui);
  const a = answers && typeof answers === "object" ? answers : {};

  for (const q of resolved.questions) {
    const val = a[q.key];
    if (q.type === "text") {
      const text = String(val ?? "").trim();
      if (q.required && !text) return `חסרה תשובה: ${q.label}`;
      if (text && q.min_length > 0 && text.length < q.min_length) {
        return `${q.label}: לפחות ${q.min_length} תווים`;
      }
      continue;
    }
    if (q.type === "single_choice") {
      const pick = String(val ?? "").trim();
      if (q.required && !pick) return `חסרה בחירה: ${q.label}`;
      if (pick === "__other__" && q.allow_other) {
        const other = String(a[`${q.key}_other`] ?? "").trim();
        if (!other) return `נא לפרט ב"${q.other_label || "אחר"}"`;
      }
      continue;
    }
    if (q.type === "multi_choice") {
      const picks = Array.isArray(val) ? val.filter(Boolean) : [];
      if (q.required && !picks.length) return `חסרה לפחות בחירה אחת: ${q.label}`;
      if (picks.includes("__other__") && q.allow_other) {
        const other = String(a[`${q.key}_other`] ?? "").trim();
        if (!other) return `נא לפרט ב"${q.other_label || "אחר"}"`;
      }
    }
  }
  return null;
}

export function extractSubmitterName(ui, answers) {
  const resolved = normalizeWaiterPulseUi(ui);
  const nameQ = resolved.questions.find((q) => q.key === "submitter_name");
  if (!nameQ) return String(answers?.submitter_name ?? "").trim() || null;
  return String(answers?.submitter_name ?? "").trim() || null;
}

export function formatWaiterPulseAnswerForDisplay(question, answers) {
  const val = answers?.[question.key];
  if (question.type === "text") {
    return String(val ?? "").trim() || "—";
  }
  if (question.type === "single_choice") {
    if (val === "__other__") return String(answers?.[`${question.key}_other`] ?? "").trim() || "אחר";
    return optionLabelById(question, val) || "—";
  }
  if (question.type === "multi_choice") {
    const picks = Array.isArray(val) ? val : [];
    const labels = picks
      .filter((id) => id !== "__other__")
      .map((id) => optionLabelById(question, id));
    if (picks.includes("__other__")) {
      const other = String(answers?.[`${question.key}_other`] ?? "").trim();
      if (other) labels.push(other);
      else labels.push(question.other_label || "אחר");
    }
    return labels.length ? labels.join(" · ") : "—";
  }
  return "—";
}

export function managementStatusLabel(status) {
  return WAITER_PULSE_MANAGEMENT_STATUSES.find((s) => s.id === status)?.label ?? status;
}

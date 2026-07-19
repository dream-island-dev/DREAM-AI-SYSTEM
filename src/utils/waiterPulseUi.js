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
export const WAITER_PULSE_MAX_QUESTIONS = 12;
export const WAITER_PULSE_MIN_QUESTIONS = 1;

export const DEFAULT_WAITER_PULSE_UI = Object.freeze({
  panel_title: "מה ראיתם מהרצפה?",
  intro_text:
    "אנחנו לא בודקים אתכם — רוצים לשמוע מה אתם רואים מול האורחים: מה מפריע לשירות טוב, ומה הייתם משנים.",
  submit_label: "📨 שליחת התשובות",
  thank_you_title: "תודה — שמענו אתכם",
  thank_you_body: "ההנהלה עוברת על התשובות וחוזרת עם עדכון.",
  questions: Object.freeze([
    Object.freeze({
      key: "system_friction",
      type: "multi_choice",
      label: "מה הכי מפריע היום לתת שירות טוב לאורח?",
      required: true,
      options: Object.freeze([
        Object.freeze({ id: "no_guest_info", label: "אין מידע על אלרגיות / פנסיון לפני שהאורח יושב" }),
        Object.freeze({ id: "no_table_time", label: "אורחים לא יודעים מתי השולחן / מגיעים לא בזמן" }),
        Object.freeze({ id: "peak_load", label: "עומס בשעות שיא בלי תגבור" }),
        Object.freeze({ id: "kitchen_comms", label: "תקשורת עם מטבח / מעבר פנימי" }),
        Object.freeze({ id: "menu_availability", label: "תפריט / זמינות מנים" }),
        Object.freeze({ id: "unclear_expectations", label: "ציפיות לא ברורות של האורח (מה כלול, מה לא)" }),
      ]),
      allow_other: true,
      other_label: "משהו אחר",
    }),
    Object.freeze({
      key: "guest_pain_point",
      type: "single_choice",
      label: "איפה האורח הכי מתוסכל אצלנו?",
      required: true,
      options: Object.freeze([
        Object.freeze({ id: "arrival", label: "הגעה למסעדה" }),
        Object.freeze({ id: "waiting", label: "המתנה לשולחן" }),
        Object.freeze({ id: "menu_explain", label: "הסבר על התפריט / מה כלול" }),
        Object.freeze({ id: "speed", label: "מהירות שירות" }),
        Object.freeze({ id: "warmth", label: "חום / יחס אישי" }),
        Object.freeze({ id: "checkout", label: "סיום / חשבון" }),
        Object.freeze({ id: "other", label: "אחר" }),
      ]),
    }),
    Object.freeze({
      key: "change_tomorrow",
      type: "text",
      label: "מה הייתם משנים מחר בבוקר?",
      required: true,
      placeholder: "למשל: לשלוח לנו שעת שולחן לפני הערב…",
      min_length: 15,
    }),
    Object.freeze({
      key: "one_idea",
      type: "text",
      label: "רעיון אחד ששווה לנסות",
      required: true,
      placeholder: "אם הייתם מנהלים לשבוע — מה הייתם מנסים?",
      min_length: 15,
    }),
    Object.freeze({
      key: "example_story",
      type: "text",
      label: "דוגמה מהשבוע האחרון (אופציונלי)",
      required: false,
      placeholder: "מקרה אחד שבו הרגשתם שאפשר היה לעשות יותר טוב — בלי שמות אורח",
    }),
    Object.freeze({
      key: "submitter_name",
      type: "text",
      label: "שם (אופציונלי — עוזר לחזור אליכם)",
      required: false,
      placeholder: "שם פרטי או ראשי תיבות",
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

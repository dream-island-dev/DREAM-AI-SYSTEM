// Deno mirror of waiterPulseUi for Edge Functions — keep in sync with src/utils/waiterPulseUi.js

export const BOT_CONFIG_WAITER_PULSE_UI_KEY = "waiter_service_pulse_ui";

const QUESTION_KEY_RE = /^[a-z][a-z0-9_]{0,48}$/;

export const DEFAULT_WAITER_PULSE_UI = {
  panel_title: "שאלון מלצרים - מסעדת ערמונים",
  intro_text:
    "שאלון זה הינו אנונימי לחלוטין!\n\nהמטרה שלנו היא לשפר את סביבת העבודה, התקשורת והחוויה של כולנו במסעדה. נשמח לתשובות הכנות שלך.",
  submit_label: "📋 שליחת השאלון",
  thank_you_title: "תודה על המשוב! 🙏",
  thank_you_body:
    "התשובות נשלחו באופן אנונימי להנהלה. נשתמש בהן כדי לשפר את סביבת העבודה, התקשורת והחוויה של כולנו במסעדה.",
  questions: [
    {
      key: "tenure",
      type: "single_choice",
      label: "1. כמה זמן אתה עובד במסעדת ערמונים? (בחירה אחת)",
      required: true,
      options: [
        { id: "less_3_months", label: "פחות מ-3 חודשים" },
        { id: "3_6_months", label: "3–6 חודשים" },
        { id: "half_to_year", label: "חצי שנה עד שנה" },
        { id: "over_year", label: "מעל שנה" },
      ],
    },
    {
      key: "manager_presence",
      type: "single_choice",
      label: "2. האם אתה מרגיש שהמנהל נוכח במשמרת?",
      required: true,
      options: [
        { id: "yes", label: "כן" },
        { id: "no", label: "לא" },
      ],
      allow_other: true,
      other_label: "אחר / פירוט",
    },
    {
      key: "manager_respect",
      type: "single_choice",
      label: "3. האם אתה מרגיש שהמנהלים מתייחסים אליך בכבוד?",
      required: true,
      options: [
        { id: "yes", label: "כן" },
        { id: "no", label: "לא" },
      ],
      allow_other: true,
      other_label: "אחר / פירוט",
    },
    {
      key: "manager_improvements",
      type: "multi_choice",
      label:
        "4. מה לדעתך המנהלים יכולים לעשות טוב יותר? (ניתן לסמן מספר אפשרויות ו/או לפרט בחופשיות)",
      required: true,
      options: [
        { id: "clear_communication", label: "תקשורת ברורה ופתוחה יותר מול הצוות" },
        { id: "physical_support", label: "תמיכה וסיוע פיזי במהלך סרוויס עמוס" },
        { id: "positive_feedback", label: "מתן משוב חיובי/בונה בסיום משמרת" },
        { id: "fair_shifts", label: "חלוקה צודקת ומאוזנת של משמרות" },
        { id: "more_training", label: "הגדלת הדרכות ומקצועיות" },
      ],
      allow_other: true,
      other_label: "אחר / פירוט חופשי",
    },
    {
      key: "team_cooperation",
      type: "single_choice",
      label: "5. האם יש שיתוף פעולה בין חברי הצוות?",
      required: true,
      options: [
        { id: "yes", label: "כן" },
        { id: "no", label: "לא" },
      ],
      allow_other: true,
      other_label: "אחר / פירוט",
    },
    {
      key: "tip_agreement_awareness",
      type: "single_choice",
      label: "6. האם אתה יודע שקיימת הסכמה בין המלצרים לגבי לקיחת טיפים?",
      required: true,
      options: [
        { id: "yes", label: "כן" },
        { id: "no", label: "לא" },
      ],
      allow_other: true,
      other_label: "אחר / פירוט",
    },
    {
      key: "tips_policy_aware",
      type: "single_choice",
      label: "7. חלוקת טיפים במשמרת — א. האם אתה מודע להגדרה זו?",
      help_text:
        "כהגדרה, טיפים המתקבלים מהלקוחות בכל שעות המשמרת הם טיפים משותפים לכלל המלצרים.",
      required: true,
      options: [
        { id: "yes", label: "כן" },
        { id: "no", label: "לא" },
      ],
    },
    {
      key: "tips_policy_change",
      type: "single_choice",
      label: "7. חלוקת טיפים במשמרת — ב. האם היית רוצה לשנות את השיטה הנוכחית?",
      required: true,
      options: [{ id: "no_change", label: "לא, השיטה טובה בעיניי" }],
      allow_other: true,
      other_label: "כן (נמק מה היית משנה)",
    },
    {
      key: "training_sufficient",
      type: "single_choice",
      label: "8. האם אתה מרגיש שקיבלת הכשרה מספקת מהמנהלים?",
      required: true,
      options: [
        { id: "yes", label: "כן" },
        { id: "no", label: "לא" },
      ],
      allow_other: true,
      other_label: "פירוט (מה היה חסר בהכשרה?)",
    },
    {
      key: "service_knowledge_gaps",
      type: "multi_choice",
      label: "9. האם אתה מרגיש צורך בחיזוק ידע במתן שירות?",
      required: true,
      options: [
        { id: "confident", label: "לא, מרגיש שולט בחומר" },
        { id: "food_menu", label: "כן – בתפריט האוכל / ספיישלים" },
        { id: "wine_bar", label: "כן – בתפריט היין, האלכוהול והקוקטיילים" },
        { id: "pos_system", label: "כן – תפעול קופה / מערכת ההזמנות" },
        { id: "complaints", label: "כן – התמודדות עם תלונות לקוח וסרוויס מורכב" },
      ],
      allow_other: true,
      other_label: "פירוט נוסף",
    },
    {
      key: "cross_team_difficulty",
      type: "multi_choice",
      label: "10. האם אתה מרגיש קושי בעבודה מול המטבח / הבר / המארחות?",
      required: true,
      options: [
        { id: "no_difficulty", label: "לא, העבודה זורמת מצוין מול כולם" },
        { id: "kitchen", label: "כן – קושי מול המטבח" },
        { id: "bar", label: "כן – קושי מול הבר" },
        { id: "hosts", label: "כן – קושי מול צוות המארחות" },
      ],
      allow_other: true,
      other_label: "פירוט (מה מורכב/מה מפריע לך?)",
    },
    {
      key: "additional_comments",
      type: "text",
      label: "11. משהו נוסף שהיית רוצה להוסיף או לשנות? (כתיבה חופשית)",
      required: false,
      placeholder: "כתבו כאן בחופשיות…",
      min_length: 0,
    },
  ],
};

function plainDefaultUi() {
  return JSON.parse(JSON.stringify(DEFAULT_WAITER_PULSE_UI));
}

export function isValidWaiterPulseQuestionKey(key: string) {
  return QUESTION_KEY_RE.test(String(key ?? ""));
}

function normalizeOption(raw: { id?: string; label?: string } | null, fallbackId: string) {
  const id = String(raw?.id ?? fallbackId ?? "").trim();
  const label = String(raw?.label ?? "").trim();
  if (!id || !label) return null;
  return { id, label };
}

function normalizeQuestion(raw: Record<string, unknown>, idx: number) {
  const type = ["single_choice", "multi_choice", "text"].includes(String(raw?.type))
    ? String(raw.type)
    : "text";
  const key = isValidWaiterPulseQuestionKey(String(raw?.key ?? ""))
    ? String(raw.key)
    : `q_${idx + 1}`;
  const label = String(raw?.label ?? "").trim() || `שאלה ${idx + 1}`;
  const base: Record<string, unknown> = {
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
    .map((o, i) => normalizeOption(o as { id?: string; label?: string }, `opt_${i + 1}`))
    .filter(Boolean);
  return {
    ...base,
    options: options.length ? options : [{ id: "opt_1", label: "אפשרות 1" }],
    allow_other: raw?.allow_other === true,
    other_label: String(raw?.other_label ?? "אחר").trim() || "אחר",
  };
}

export function normalizeWaiterPulseUi(raw: unknown) {
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
  const p = parsed as Record<string, unknown>;

  base.panel_title = String(p.panel_title ?? base.panel_title).trim() || base.panel_title;
  base.intro_text = String(p.intro_text ?? base.intro_text).trim() || base.intro_text;
  base.submit_label = String(p.submit_label ?? base.submit_label).trim() || base.submit_label;
  base.thank_you_title = String(p.thank_you_title ?? base.thank_you_title).trim() || base.thank_you_title;
  base.thank_you_body = String(p.thank_you_body ?? base.thank_you_body).trim() || base.thank_you_body;

  if (Array.isArray(p.questions) && p.questions.length) {
    base.questions = p.questions
      .slice(0, 15)
      .map((q, i) => normalizeQuestion(q as Record<string, unknown>, i));
  }
  return base;
}

export function validateWaiterPulseAnswers(ui: unknown, answers: Record<string, unknown>) {
  const resolved = normalizeWaiterPulseUi(ui);
  const a = answers && typeof answers === "object" ? answers : {};

  for (const q of resolved.questions) {
    const val = a[q.key as string];
    if (q.type === "text") {
      const text = String(val ?? "").trim();
      if (q.required && !text) return `חסרה תשובה: ${q.label}`;
      if (text && (q.min_length as number) > 0 && text.length < (q.min_length as number)) {
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

export function extractSubmitterName(_ui: unknown, answers: Record<string, unknown>) {
  return String(answers?.submitter_name ?? "").trim() || null;
}

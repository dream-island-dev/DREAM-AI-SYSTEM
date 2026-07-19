// Deno mirror of waiterPulseUi for Edge Functions — keep in sync with src/utils/waiterPulseUi.js

export const BOT_CONFIG_WAITER_PULSE_UI_KEY = "waiter_service_pulse_ui";

const QUESTION_KEY_RE = /^[a-z][a-z0-9_]{0,48}$/;

export const DEFAULT_WAITER_PULSE_UI = {
  panel_title: "שאלון תפעול ושיפור שירות למלצרים",
  intro_text:
    "צוות יקר, נשמח לדעת מה אתם חווים ומזהים מול האורחים בשטח: מה מפריע ומעכב אתכם מלתת את השירות המושלם, ואיזה שינוי או כלי יעזרו לכם להצליח יותר?",
  submit_label: "✉️ שרידת משוב ותובנות צוות",
  thank_you_title: "תודה על השותפות והחזון! 🙏",
  thank_you_body:
    "המשוב הגיע ישירות להנהלה. התשובות ינותחו כדי לבצע התאמות, לשפר את זרימת העבודה בשטח ולתת לכם את הכלים הטובים ביותר.",
  questions: [
    {
      key: "service_bottleneck",
      type: "single_choice",
      label: "מהו צוואר הבקבוק העיקרי שמעכב את מהירות השירות שלכם כרגע?",
      required: true,
      options: [
        { id: "kitchen_bar_timing", label: "⏱️ זמני יציאת מנות/משקאות מהמטבח והבר" },
        { id: "walking_equipment", label: "🏃‍♂️ מרחקי הליכה וחוסר בציוד עזר זמין בשטח" },
        { id: "systems_sync", label: "🖥️ עיכובים או חוסר סנכרון במערכות המחשוב/הזמנות" },
        { id: "workload_split", label: "👥 חלוקת גזרות עבודה או עומס חריג בנקודות קצה" },
      ],
    },
    {
      key: "recurring_guest_complaint",
      type: "single_choice",
      label: "מהי התלונה או הבקשה החוזרת ביותר שאתם שומעים מהאורחים במשמרת?",
      required: true,
      options: [
        { id: "slow_response", label: '💬 "לוקח זמן רב מדי לקבל חשבון או מענה מהמלצר"' },
        { id: "menu_dietary", label: '🍽️ "חסר גיוון או התאמה לרגישויות בתפריט"' },
        { id: "food_quality", label: '🌡️ "טמפרטורת המנה או איכות ההגשה לא היו אחידות"' },
        { id: "no_complaints", label: "✨ האורחים מרוצים לחלוטין ואין תלונות חוזרות" },
      ],
    },
    {
      key: "one_improvement",
      type: "text",
      label:
        "אם הייתם יכולים לשנות, להוסיף או לשפר דבר אחד קטן במשמרת כדי להפוך את העבודה ליותר חלקה ואת האורח ליותר שמח — מה זה היה?",
      required: true,
      placeholder: "למשל: עוד מגשים בשירות, עדכון מהיר יותר על מנות שנגמרו…",
      min_length: 15,
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
      .slice(0, 12)
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

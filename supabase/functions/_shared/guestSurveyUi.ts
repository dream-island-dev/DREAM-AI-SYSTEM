// supabase/functions/_shared/guestSurveyUi.ts
// Mirror of src/utils/guestSurveyUi.js for Edge Functions.

export const LEGACY_SURVEY_CATEGORY_KEYS = [
  "patio",
  "live_kitchen",
  "chestnut_restaurant",
  "service_team",
  "spa",
  "cleaning_maintenance",
] as const;

export const SURVEY_NEGATIVE_CATEGORY_MAX = 1;
export const SURVEY_NEGATIVE_OVERALL_MAX = 1;
export const SURVEY_SCORE_MIN = 1;
export const SURVEY_SCORE_MAX = 3;
export const SURVEY_POSITIVE_OVERALL_MIN = 2;

export type SurveyScoreOption = { value: number; label: string; emoji: string };

export const SURVEY_SCORE_OPTIONS: readonly SurveyScoreOption[] = [
  { value: 1, label: "נהנתי במידה מסוימת", emoji: "👌" },
  { value: 2, label: "חוויה טובה", emoji: "🙂" },
  { value: 3, label: "היה מדהים!", emoji: "🤩" },
];

export const SURVEY_MAX_CATEGORIES = 12;
export const SURVEY_MIN_CATEGORIES = 1;
export const DEFAULT_SUITES_CTA_URL = "https://www.dream-island.co.il/suites";
export const DEFAULT_SUITES_CTA_LABEL = "🛏️ רוצים לחוות לינה בסוויטה?";

export type GuestSurveyCategory = { key: string; label: string };

export type GuestSurveyUi = {
  panel_title: string;
  overall_label: string;
  free_text_label: string;
  free_text_placeholder: string;
  submit_label: string;
  suites_cta_label: string;
  suites_cta_url: string;
  categories: GuestSurveyCategory[];
};

export const DEFAULT_GUEST_SURVEY_UI: GuestSurveyUi = {
  panel_title: "📊 ספרו לנו איך היה",
  overall_label: "החוויה הכללית",
  free_text_label: "רוצים להוסיף כמה מילים? (לא חובה)",
  free_text_placeholder: "ספרו לנו עוד...",
  submit_label: "📨 שליחת הסקר",
  suites_cta_label: DEFAULT_SUITES_CTA_LABEL,
  suites_cta_url: DEFAULT_SUITES_CTA_URL,
  categories: [
    { key: "patio", label: "החצר / הפטיו" },
    { key: "live_kitchen", label: "המטבח החי" },
    { key: "chestnut_restaurant", label: "מסעדת ערמונים" },
    { key: "service_team", label: "צוות השירות" },
    { key: "spa", label: "הספא" },
    { key: "cleaning_maintenance", label: "ניקיון ותחזוקה" },
  ],
};

const CATEGORY_KEY_RE = /^[a-z][a-z0-9_]{0,40}$/;

function trimLabel(raw: unknown, fallback: string): string {
  const t = String(raw ?? "").trim();
  return t || fallback;
}

function plainDefault(): GuestSurveyUi {
  return {
    ...DEFAULT_GUEST_SURVEY_UI,
    categories: DEFAULT_GUEST_SURVEY_UI.categories.map((c) => ({ ...c })),
  };
}

export function isValidSurveyCategoryKey(key: string): boolean {
  return CATEGORY_KEY_RE.test(key);
}

export function normalizeGuestSurveyUi(raw: unknown): GuestSurveyUi {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return plainDefault();
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return plainDefault();
  }
  const obj = parsed as Record<string, unknown>;
  const defaultByKey = Object.fromEntries(
    DEFAULT_GUEST_SURVEY_UI.categories.map((c) => [c.key, c.label]),
  );
  const rawCats = Array.isArray(obj.categories) ? obj.categories : [];
  const seen = new Set<string>();
  const categories: GuestSurveyCategory[] = [];
  for (const row of rawCats) {
    if (!row || typeof row !== "object") continue;
    const key = String((row as { key?: unknown }).key ?? "").trim();
    if (!isValidSurveyCategoryKey(key) || seen.has(key)) continue;
    seen.add(key);
    categories.push({
      key,
      label: trimLabel((row as { label?: unknown }).label, defaultByKey[key] || "קטגוריה"),
    });
    if (categories.length >= SURVEY_MAX_CATEGORIES) break;
  }
  if (categories.length < SURVEY_MIN_CATEGORIES) return plainDefault();

  return {
    panel_title: trimLabel(obj.panel_title, DEFAULT_GUEST_SURVEY_UI.panel_title),
    overall_label: trimLabel(obj.overall_label, DEFAULT_GUEST_SURVEY_UI.overall_label),
    free_text_label: trimLabel(obj.free_text_label, DEFAULT_GUEST_SURVEY_UI.free_text_label),
    free_text_placeholder: trimLabel(
      obj.free_text_placeholder,
      DEFAULT_GUEST_SURVEY_UI.free_text_placeholder,
    ),
    submit_label: trimLabel(obj.submit_label, DEFAULT_GUEST_SURVEY_UI.submit_label),
    suites_cta_label: trimLabel(obj.suites_cta_label, DEFAULT_GUEST_SURVEY_UI.suites_cta_label),
    suites_cta_url: trimLabel(obj.suites_cta_url, DEFAULT_GUEST_SURVEY_UI.suites_cta_url),
    categories,
  };
}

export function isPositiveSurveyAverage(overall: number, _categoryScores: number[]): boolean {
  return overall >= SURVEY_POSITIVE_OVERALL_MIN && overall <= SURVEY_SCORE_MAX;
}

export function isValidSurveyScore(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= SURVEY_SCORE_MIN && n <= SURVEY_SCORE_MAX;
}

// src/utils/guestSurveyUi.js
// Guest Experience Survey — shared UI config for Guest Portal + staff
// preview/editor. Categories are editable (add/remove/rename labels); scores
// persist in guest_surveys.ratings jsonb. Legacy six column names remain as
// optional keys for backward compatibility.

/** Built-in seed keys (still valid; also mirrored to typed columns when present). */
export const LEGACY_SURVEY_CATEGORY_KEYS = Object.freeze([
  "patio",
  "live_kitchen",
  "chestnut_restaurant",
  "service_team",
  "spa",
  "cleaning_maintenance",
]);

/** @deprecated use LEGACY_SURVEY_CATEGORY_KEYS — kept for older imports/tests */
export const SURVEY_CATEGORY_KEYS = LEGACY_SURVEY_CATEGORY_KEYS;

export const SURVEY_NEGATIVE_CATEGORY_MAX = 4;
export const SURVEY_NEGATIVE_OVERALL_MAX = 4;
export const SURVEY_SCORE_MAX = 10;
/** Same positive bar as Google CTA (1-10): avg categories + overall ≥ 8. */
export const SURVEY_POSITIVE_AVG_MIN = 8.0;
export const SURVEY_POSITIVE_OVERALL_MIN = 8;

export const SURVEY_MAX_CATEGORIES = 12;
export const SURVEY_MIN_CATEGORIES = 1;

export const DEFAULT_SUITES_CTA_URL = "https://www.dream-island.co.il/suites";
export const DEFAULT_SUITES_CTA_LABEL = "🛏️ רוצים לחוות לינה בסוויטה?";

export const DEFAULT_GUEST_SURVEY_UI = Object.freeze({
  panel_title: "📊 ספרו לנו איך היה",
  overall_label: "החוויה הכללית (1-10)",
  free_text_label: "רוצים להוסיף כמה מילים? (לא חובה)",
  free_text_placeholder: "ספרו לנו עוד...",
  submit_label: "📨 שליחת הסקר",
  suites_cta_label: DEFAULT_SUITES_CTA_LABEL,
  suites_cta_url: DEFAULT_SUITES_CTA_URL,
  categories: Object.freeze([
    Object.freeze({ key: "patio", label: "החצר / הפטיו" }),
    Object.freeze({ key: "live_kitchen", label: "המטבח החי" }),
    Object.freeze({ key: "chestnut_restaurant", label: "מסעדת ערמונים" }),
    Object.freeze({ key: "service_team", label: "צוות השירות" }),
    Object.freeze({ key: "spa", label: "הספא" }),
    Object.freeze({ key: "cleaning_maintenance", label: "ניקיון ותחזוקה" }),
  ]),
});

export const BOT_CONFIG_SURVEY_UI_KEY = "guest_survey_ui";

const CATEGORY_KEY_RE = /^[a-z][a-z0-9_]{0,40}$/;

function trimLabel(raw, fallback) {
  const t = String(raw ?? "").trim();
  return t || fallback;
}

function plainDefaultSurveyUi() {
  return {
    panel_title: DEFAULT_GUEST_SURVEY_UI.panel_title,
    overall_label: DEFAULT_GUEST_SURVEY_UI.overall_label,
    free_text_label: DEFAULT_GUEST_SURVEY_UI.free_text_label,
    free_text_placeholder: DEFAULT_GUEST_SURVEY_UI.free_text_placeholder,
    submit_label: DEFAULT_GUEST_SURVEY_UI.submit_label,
    suites_cta_label: DEFAULT_GUEST_SURVEY_UI.suites_cta_label,
    suites_cta_url: DEFAULT_GUEST_SURVEY_UI.suites_cta_url,
    categories: DEFAULT_GUEST_SURVEY_UI.categories.map((c) => ({ key: c.key, label: c.label })),
  };
}

export function isValidSurveyCategoryKey(key) {
  return CATEGORY_KEY_RE.test(String(key ?? ""));
}

/** Stable unique key for a staff-invented category. */
export function makeSurveyCategoryKey(existingKeys = []) {
  const used = new Set((existingKeys || []).map((k) => String(k)));
  for (let i = 0; i < 40; i++) {
    const key = `cat_${Math.random().toString(36).slice(2, 8)}`;
    if (!used.has(key) && isValidSurveyCategoryKey(key)) return key;
  }
  return `cat_${Date.now().toString(36)}`;
}

/**
 * Merge raw bot_config JSON onto defaults.
 * Preserves category list order from config when present (add/remove supported).
 */
export function normalizeGuestSurveyUi(raw) {
  let parsed = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return plainDefaultSurveyUi();
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return plainDefaultSurveyUi();
  }

  const defaultByKey = Object.fromEntries(
    DEFAULT_GUEST_SURVEY_UI.categories.map((c) => [c.key, c.label]),
  );
  const rawCats = Array.isArray(parsed.categories) ? parsed.categories : [];
  const seen = new Set();
  const categories = [];
  for (const row of rawCats) {
    if (!row || typeof row !== "object") continue;
    const key = String(row.key ?? "").trim();
    if (!isValidSurveyCategoryKey(key) || seen.has(key)) continue;
    seen.add(key);
    categories.push({
      key,
      label: trimLabel(row.label, defaultByKey[key] || "קטגוריה"),
    });
    if (categories.length >= SURVEY_MAX_CATEGORIES) break;
  }

  if (categories.length < SURVEY_MIN_CATEGORIES) {
    return plainDefaultSurveyUi();
  }

  return {
    panel_title: trimLabel(parsed.panel_title, DEFAULT_GUEST_SURVEY_UI.panel_title),
    overall_label: trimLabel(parsed.overall_label, DEFAULT_GUEST_SURVEY_UI.overall_label),
    free_text_label: trimLabel(parsed.free_text_label, DEFAULT_GUEST_SURVEY_UI.free_text_label),
    free_text_placeholder: trimLabel(
      parsed.free_text_placeholder,
      DEFAULT_GUEST_SURVEY_UI.free_text_placeholder,
    ),
    submit_label: trimLabel(parsed.submit_label, DEFAULT_GUEST_SURVEY_UI.submit_label),
    suites_cta_label: trimLabel(parsed.suites_cta_label, DEFAULT_GUEST_SURVEY_UI.suites_cta_label),
    suites_cta_url: trimLabel(parsed.suites_cta_url, DEFAULT_GUEST_SURVEY_UI.suites_cta_url),
    categories,
  };
}

export function cloneDefaultSurveyUi() {
  return plainDefaultSurveyUi();
}

export function serializeGuestSurveyUi(ui) {
  const n = normalizeGuestSurveyUi(ui);
  return JSON.stringify(n);
}

export function addSurveyCategory(ui, label = "קטגוריה חדשה") {
  const base = normalizeGuestSurveyUi(ui);
  if (base.categories.length >= SURVEY_MAX_CATEGORIES) return base;
  const key = makeSurveyCategoryKey(base.categories.map((c) => c.key));
  return {
    ...base,
    categories: [...base.categories, { key, label: trimLabel(label, "קטגוריה חדשה") }],
  };
}

export function removeSurveyCategory(ui, key) {
  const base = normalizeGuestSurveyUi(ui);
  if (base.categories.length <= SURVEY_MIN_CATEGORIES) return base;
  const categories = base.categories.filter((c) => c.key !== key);
  if (categories.length < SURVEY_MIN_CATEGORIES) return base;
  return { ...base, categories };
}

/** Resolve per-category scores from ratings jsonb or legacy columns. */
export function resolveSurveyCategoryScores(row, categories) {
  const cats = Array.isArray(categories) && categories.length
    ? categories
    : DEFAULT_GUEST_SURVEY_UI.categories;
  const ratings = row?.ratings && typeof row.ratings === "object" && !Array.isArray(row.ratings)
    ? row.ratings
    : null;
  return cats.map((c) => {
    const fromRatings = ratings ? Number(ratings[c.key]) : NaN;
    const fromCol = Number(row?.[c.key]);
    const score = Number.isFinite(fromRatings) ? fromRatings
      : (Number.isFinite(fromCol) ? fromCol : null);
    return { key: c.key, label: c.label, score };
  });
}

export function isLowScoreSurveyRow(row) {
  if (!row || typeof row !== "object") return false;
  if (Number(row.overall_experience) <= SURVEY_NEGATIVE_OVERALL_MAX) return true;
  const scores = resolveSurveyCategoryScores(row, null)
    .map((c) => c.score)
    .filter((n) => typeof n === "number" && Number.isFinite(n));
  if (scores.length) return scores.some((n) => n <= SURVEY_NEGATIVE_CATEGORY_MAX);
  return LEGACY_SURVEY_CATEGORY_KEYS.some(
    (key) => Number(row[key]) <= SURVEY_NEGATIVE_CATEGORY_MAX,
  );
}

export function isPositiveSurveyAverage(overall, categoryScores) {
  const vals = (categoryScores || []).filter((n) => typeof n === "number" && Number.isFinite(n));
  if (!vals.length) return false;
  const avg = vals.reduce((s, n) => s + n, 0) / vals.length;
  return Number(overall) >= SURVEY_POSITIVE_OVERALL_MIN && avg >= SURVEY_POSITIVE_AVG_MIN;
}

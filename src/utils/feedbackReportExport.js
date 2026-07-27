// Guest feedback + survey Excel report — service-improvement export for managers.
import {
  isLowScoreSurveyRow,
  isPositiveSurveyAverage,
  resolveSurveyCategoryScores,
  normalizeGuestSurveyUi,
  DEFAULT_GUEST_SURVEY_UI,
} from "./guestSurveyUi";
import { facilityLabel } from "./guestFacilityMeta";

const SOURCE_LABEL = {
  freeform_reflection: "הודעה חופשית",
  post_stay_button: "כפתור לאחר שהות",
  severe_complaint: "תלונה חריפה",
  structured_survey: "מראה מסקר",
  facility_review: "ביקורת מתקן (בוט)",
  bot_tool: "ביקורת מתקן (AI)",
};

const SENTIMENT_LABEL = {
  positive: "חיובי",
  negative: "שלילי",
  neutral: "ניטרלי",
};

export const FEEDBACK_REPORT_DEFAULT_DAYS = 30;

export function defaultReportDateRange(days = FEEDBACK_REPORT_DEFAULT_DAYS) {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - days);
  return {
    fromYmd: from.toISOString().slice(0, 10),
    toYmd: to.toISOString().slice(0, 10),
  };
}

function fmtExportDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("he-IL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function inDateRangeYmd(ymd, fromYmd, toYmd) {
  if (!ymd) return false;
  return ymd >= fromYmd && ymd <= toYmd;
}

function inDateRangeIso(iso, fromYmd, toYmd) {
  if (!iso) return false;
  return iso.slice(0, 10) >= fromYmd && iso.slice(0, 10) <= toYmd;
}

export function filterFeedbackForReport(rows, { fromYmd, toYmd, includeArchived = true } = {}) {
  return (rows || []).filter((r) => {
    if (!inDateRangeIso(r.created_at, fromYmd, toYmd)) return false;
    if (!includeArchived && r.status === "archived") return false;
    return true;
  });
}

export function filterSurveysForReport(rows, { fromYmd, toYmd } = {}) {
  return (rows || []).filter((r) => inDateRangeYmd(r.visit_date, fromYmd, toYmd));
}

/** Exclude mirror rows from structured surveys — full data lives in guest_surveys. */
export function freeformFeedbackRows(rows) {
  return (rows || []).filter((r) => r.source !== "structured_survey");
}

function buildFeedbackRow(f) {
  return {
    date: fmtExportDate(f.created_at),
    name: f.guests?.name || "",
    room: f.guests?.room || "",
    phone: f.phone || "",
    sentiment: SENTIMENT_LABEL[f.sentiment] ?? f.sentiment ?? "",
    facility: facilityLabel(f.facility_category) || "",
    rating: f.rating != null ? `${f.rating}/10` : "",
    source: SOURCE_LABEL[f.source] ?? f.source ?? "",
    status: f.status === "archived" ? "טופל" : "פתוח",
    text: f.feedback_text || "",
    resolved_at: fmtExportDate(f.resolved_at),
  };
}

function buildSurveyRow(s, surveyUi) {
  const cats = resolveSurveyCategoryScores(s, surveyUi.categories);
  const row = {
    visit_date: s.visit_date || "",
    name: s.guests?.name || "",
    room: s.guests?.room || "",
    phone: s.phone || "",
    overall: s.overall_experience != null ? String(s.overall_experience) : "",
    tone: isLowScoreSurveyRow(s)
      ? "נמוך — דורש תשומת לב"
      : (isPositiveSurveyAverage(s.overall_experience) ? "חיובי" : "בינוני"),
    free_text: s.free_text || "",
    submitted_at: fmtExportDate(s.created_at),
  };
  for (const c of cats) {
    row[`cat_${c.key}`] = c.score != null ? String(c.score) : "";
  }
  return row;
}

function buildSummaryRows({ fromYmd, toYmd, feedback, surveys, surveyUi }) {
  const freeform = freeformFeedbackRows(feedback);
  const negFb = freeform.filter((f) => f.sentiment === "negative");
  const posFb = freeform.filter((f) => f.sentiment === "positive");
  const neuFb = freeform.filter((f) => f.sentiment === "neutral");
  const lowSurveys = surveys.filter(isLowScoreSurveyRow);
  const posSurveys = surveys.filter((s) => isPositiveSurveyAverage(s.overall_experience));

  const catAvgs = surveyUi.categories.map((c) => {
    const scores = surveys
      .map((s) => resolveSurveyCategoryScores(s, [c])[0]?.score)
      .filter((n) => typeof n === "number" && Number.isFinite(n));
    const avg = scores.length
      ? (scores.reduce((sum, n) => sum + n, 0) / scores.length).toFixed(1)
      : "—";
    return `${c.label}: ${avg}`;
  });

  return [
    { metric: "טווח תאריכים", value: `${fromYmd} — ${toYmd}` },
    { metric: "משוב חופשי — סה\"כ", value: String(freeform.length) },
    { metric: "משוב חופשי — שלילי", value: String(negFb.length) },
    { metric: "משוב חופשי — חיובי", value: String(posFb.length) },
    { metric: "משוב חופשי — ניטרלי", value: String(neuFb.length) },
    { metric: "סקרים — סה\"כ", value: String(surveys.length) },
    { metric: "סקרים — ציון נמוך", value: String(lowSurveys.length) },
    { metric: "סקרים — חיוביים", value: String(posSurveys.length) },
    ...catAvgs.map((line, i) => ({
      metric: i === 0 ? "ממוצעי קטגוריות סקר" : "",
      value: line,
    })),
  ];
}

function buildNegativePriorityRows(feedback, surveys, surveyUi) {
  const rows = [];
  for (const f of freeformFeedbackRows(feedback).filter((r) => r.sentiment === "negative")) {
    const b = buildFeedbackRow(f);
    rows.push({
      date: b.date,
      type: "משוב חופשי",
      name: b.name,
      room: b.room,
      phone: b.phone,
      score: b.sentiment,
      category: b.facility || b.source,
      source: b.source,
      status: b.status,
      text: b.text,
    });
  }
  for (const s of surveys.filter(isLowScoreSurveyRow)) {
    const cats = resolveSurveyCategoryScores(s, surveyUi.categories)
      .filter((c) => c.score != null && c.score <= 1)
      .map((c) => `${c.label} ${c.score}`)
      .join(" · ");
    rows.push({
      date: s.visit_date || fmtExportDate(s.created_at),
      type: "סקר",
      name: s.guests?.name || "",
      room: s.guests?.room || "",
      phone: s.phone || "",
      score: `חוויה ${s.overall_experience}/3`,
      category: cats || "ציון נמוך",
      source: "סקר פורטל",
      status: "—",
      text: s.free_text || "",
    });
  }
  return rows;
}

const FEEDBACK_COLUMNS = [
  { id: "date", label: "תאריך" },
  { id: "name", label: "שם" },
  { id: "room", label: "חדר" },
  { id: "phone", label: "טלפון" },
  { id: "sentiment", label: "סנטימנט" },
  { id: "facility", label: "מתקן" },
  { id: "rating", label: "דירוג" },
  { id: "source", label: "מקור" },
  { id: "status", label: "סטטוס" },
  { id: "text", label: "טקסט" },
  { id: "resolved_at", label: "טופל בתאריך" },
];

const NEGATIVE_PRIORITY_COLUMNS = [
  { id: "date", label: "תאריך" },
  { id: "type", label: "סוג" },
  { id: "name", label: "שם" },
  { id: "room", label: "חדר" },
  { id: "phone", label: "טלפון" },
  { id: "score", label: "ציון/סנטימנט" },
  { id: "category", label: "מתקן/קטגוריה" },
  { id: "source", label: "מקור" },
  { id: "status", label: "סטטוס" },
  { id: "text", label: "טקסט" },
];

function surveyColumns(surveyUi) {
  const base = [
    { id: "visit_date", label: "תאריך ביקור" },
    { id: "name", label: "שם" },
    { id: "room", label: "חדר" },
    { id: "phone", label: "טלפון" },
    { id: "overall", label: "חוויה כללית" },
    { id: "tone", label: "סיווג" },
  ];
  const cats = surveyUi.categories.map((c) => ({ id: `cat_${c.key}`, label: c.label }));
  return [
    ...base,
    ...cats,
    { id: "free_text", label: "טקסט חופשי" },
    { id: "submitted_at", label: "הוגש בתאריך" },
  ];
}

async function writeWorkbook(sheets, filename) {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const headers = sheet.columns.map((c) => c.label);
    const data = sheet.rows.map((r) => sheet.columns.map((c) => r[c.id] ?? ""));
    const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
    ws["!cols"] = sheet.columns.map((c) => ({
      wch: Math.max(String(c.label).length + 2, 14),
    }));
    const safeName = String(sheet.name).slice(0, 31);
    XLSX.utils.book_append_sheet(wb, ws, safeName);
  }
  XLSX.writeFile(wb, filename);
}

/**
 * Export multi-sheet service-improvement report.
 * @param {{ feedback: object[], surveys: object[], surveyUi?: object, fromYmd: string, toYmd: string, includeArchived?: boolean }} opts
 */
export async function exportFeedbackServiceReport(opts) {
  const surveyUi = normalizeGuestSurveyUi(opts.surveyUi ?? DEFAULT_GUEST_SURVEY_UI);
  const feedback = filterFeedbackForReport(opts.feedback, {
    fromYmd: opts.fromYmd,
    toYmd: opts.toYmd,
    includeArchived: opts.includeArchived !== false,
  });
  const surveys = filterSurveysForReport(opts.surveys, {
    fromYmd: opts.fromYmd,
    toYmd: opts.toYmd,
  });

  const freeform = freeformFeedbackRows(feedback);
  const summaryRows = buildSummaryRows({
    fromYmd: opts.fromYmd,
    toYmd: opts.toYmd,
    feedback,
    surveys,
    surveyUi,
  });
  const negativeRows = buildNegativePriorityRows(feedback, surveys, surveyUi);
  const feedbackRows = freeform.map(buildFeedbackRow);
  const surveyRows = surveys.map((s) => buildSurveyRow(s, surveyUi));
  const surveyCols = surveyColumns(surveyUi);

  const filename = `dream_feedback_report_${opts.fromYmd}_${opts.toYmd}.xlsx`;

  await writeWorkbook([
    {
      name: "סיכום",
      columns: [{ id: "metric", label: "מדד" }, { id: "value", label: "ערך" }],
      rows: summaryRows,
    },
    {
      name: "שלילי עדיפות",
      columns: NEGATIVE_PRIORITY_COLUMNS,
      rows: negativeRows,
    },
    {
      name: "משוב חופשי",
      columns: FEEDBACK_COLUMNS,
      rows: feedbackRows,
    },
    {
      name: "סקרים",
      columns: surveyCols,
      rows: surveyRows,
    },
  ], filename);

  return {
    filename,
    counts: {
      summary: summaryRows.length,
      negative: negativeRows.length,
      feedback: feedbackRows.length,
      surveys: surveyRows.length,
    },
  };
}

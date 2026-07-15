// supabase/functions/_shared/guestFacilityReview.ts
// Tier-0 + LLM-tool facility review capture — restaurant, spa, patio, etc.
// Distinct from operational COMPLAINT patterns and holistic stay reflections.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const FACILITY_CATEGORIES = [
  "restaurant",
  "live_kitchen",
  "patio",
  "spa",
  "pool",
  "bar",
  "cleaning",
  "service",
  "general",
] as const;

export type FacilityCategory = (typeof FACILITY_CATEGORIES)[number];

export type FacilitySentiment = "positive" | "negative" | "neutral";

export interface FacilityReviewCapture {
  facility: FacilityCategory;
  sentiment: FacilitySentiment;
  rating: number | null;
  /** Original guest text (tier-0) or model summary (tool). */
  text: string;
  source: "facility_review" | "bot_tool";
}

const FACILITY_PATTERNS: Array<{ facility: FacilityCategory; patterns: RegExp[] }> = [
  {
    facility: "restaurant",
    patterns: [
      /מסעדה|מסעדת|ארמונים|ערמונים|chestnut|armonim|ארוחת\s*(בוקר|צהריים|ערב|ארוחה)|האוכל\s*(במסעדה|בארוחה)/i,
      /restaurant|dining|breakfast|dinner\s+at/i,
    ],
  },
  {
    facility: "live_kitchen",
    patterns: [/מטבח\s*חי|live\s*kitchen|המטבח\s*החי/i],
  },
  {
    facility: "patio",
    patterns: [/פטיו|החצר|החצר\s*החיצונית|patio|courtyard/i],
  },
  {
    facility: "spa",
    patterns: [/ספא|spa|טיפול\s*(ב)?ספא|מסאז|עיסוי|מטפל|מטפלת/i],
  },
  {
    facility: "pool",
    patterns: [/בריכה|בריכות|pool|swimming/i],
  },
  {
    facility: "bar",
    patterns: [/(^|\s)בר(\s|$)|בר\s*המלון|קוקטייל|cocktail|\bbar\b/i],
  },
  {
    facility: "cleaning",
    patterns: [/ניקיון|נקי|מלוכלך|לכלוך|מצעים|cleaning|housekeeping/i],
  },
  {
    facility: "service",
    patterns: [/צוות\s*(ה)?שירות|שירות\s*(היה|היו|מעולה|גרוע)|הצוות\s*(היה|היו|מדהים|נהדר|אדיב)/i],
  },
];

const OPINION_GATE =
  /(היה|היו|הייתה|היתה|מעולה|נהדר|מדהים|מושלם|פנטסטי|גרוע|מאכזב|מאכזבת|טעים|לא\s*טעים|אהבתי|לא\s*אהבתי|ממליץ|ממליצה|תודה\s*על|לא\s*נעים|לא\s*מרוצה|amazing|excellent|delicious|disappointing|worst|best)/i;

const POSITIVE_OPINION: RegExp[] = [
  /מעולה|נהדר|מדהים|מושלם|פנטסטי|טעים|אהבתי|ממליץ|תודה/i,
  /amazing|excellent|delicious|wonderful|great|loved/i,
];

const NEGATIVE_OPINION: RegExp[] = [
  /גרוע|מאכזב|לא\s*טעים|לא\s*אהבתי|לא\s*מרוצה|לא\s*נעים|cold\s+food|disappointing|worst/i,
];

const QUESTION_EXCLUSION = /^(?:מה|מתי|איך|למה|האם|כמה|איפה|היכן)\b/u;

const RATING_PATTERNS: RegExp[] = [
  /(\d{1,2})\s*\/\s*10/,
  /(\d{1,2})\s*מתוך\s*10/,
  /דירוג\s*(\d{1,2})/,
  /ציון\s*(\d{1,2})/,
  /נתתי\s*(\d{1,2})/,
  /\b([1-9]|10)\s*כוכב/,
];

const HEBREW_RATING_WORDS: Array<[RegExp, number]> = [
  [/עשר(?:ה)?(?:\s*מתוך|\s*מ)?/i, 10],
  [/תשע(?:ה)?/i, 9],
  [/שמונה/i, 8],
  [/שבע(?:ה)?/i, 7],
  [/שש(?:ה)?/i, 6],
  [/חמש(?:ה)?/i, 5],
  [/ארבע(?:ה)?/i, 4],
  [/שלוש(?:ה)?/i, 3],
  [/שתיים|שניים/i, 2],
  [/אחד|אחת/i, 1],
];

export function isValidFacilityCategory(raw: unknown): raw is FacilityCategory {
  return typeof raw === "string" && (FACILITY_CATEGORIES as readonly string[]).includes(raw);
}

export function detectFacilityCategory(text: string): FacilityCategory | null {
  const t = text.trim();
  for (const { facility, patterns } of FACILITY_PATTERNS) {
    if (patterns.some((p) => p.test(t))) return facility;
  }
  return null;
}

export function extractRatingFromText(text: string): number | null {
  const t = text.trim();
  for (const re of RATING_PATTERNS) {
    const m = t.match(re);
    if (m?.[1]) {
      const n = Number(m[1]);
      if (n >= 1 && n <= 10) return n;
    }
  }
  for (const [re, score] of HEBREW_RATING_WORDS) {
    if (re.test(t)) return score;
  }
  return null;
}

function classifySentiment(text: string, rating: number | null): FacilitySentiment {
  if (rating != null) {
    if (rating >= 8) return "positive";
    if (rating <= 4) return "negative";
    return "neutral";
  }
  if (NEGATIVE_OPINION.some((p) => p.test(text))) return "negative";
  if (POSITIVE_OPINION.some((p) => p.test(text))) return "positive";
  return "neutral";
}

/**
 * Returns a facility review when the message expresses an opinion about a
 * resort facility — not a plain FAQ ("מתי נפתחת המסעדה?").
 */
export function classifyFacilityReview(text: string): FacilityReviewCapture | null {
  const t = text.trim();
  if (t.length < 4 || t.endsWith("?") || QUESTION_EXCLUSION.test(t)) return null;

  const facility = detectFacilityCategory(t);
  if (!facility) return null;

  const rating = extractRatingFromText(t);
  if (!OPINION_GATE.test(t) && rating == null) return null;

  const sentiment = classifySentiment(t, rating);
  return {
    facility,
    sentiment,
    rating,
    text: t,
    source: "facility_review",
  };
}

export function buildFacilityReviewReply(
  facility: FacilityCategory,
  sentiment: FacilitySentiment,
  rating: number | null,
): string {
  const labels: Record<FacilityCategory, string> = {
    restaurant: "המסעדה",
    live_kitchen: "המטבח החי",
    patio: "הפטיו",
    spa: "הספא",
    pool: "הבריכה",
    bar: "הבר",
    cleaning: "הניקיון",
    service: "צוות השירות",
    general: "המתקן",
  };
  const name = labels[facility] ?? "המתקן";

  if (sentiment === "positive") {
    return rating != null
      ? `תודה רבה על הדירוג ${rating}/10 ל${name}! 🌟 שמחים שנהניתם — המשוב שלכם חשוב לנו מאוד.`
      : `תודה רבה על המשוב על ${name}! 🌟 שמחים לשמוע. אם תרצו לדרג 1–10 — נשמח לדעת.`;
  }
  if (sentiment === "negative") {
    return `תודה שסיפרתם לנו על ${name}. 🙏 אנחנו מצטערים שהחוויה לא עמדה בציפיות — העברנו את המשוב לצוות הרלוונטי כדי שנשתפר.`;
  }
  return `תודה ששיתפתם אותנו לגבי ${name}! 🙏 נשמח תמיד לשמוע עוד.`;
}

export interface SaveGuestFacilityReviewOpts {
  guestId: number | null;
  phone: string;
  capture: FacilityReviewCapture;
}

/** Non-blocking-safe insert — never throws into the caller. */
export async function saveGuestFacilityReview(
  supabase: ReturnType<typeof createClient>,
  opts: SaveGuestFacilityReviewOpts,
): Promise<void> {
  const { guestId, phone, capture } = opts;
  const { error } = await supabase.from("guest_feedback").insert({
    guest_id:          guestId,
    phone,
    sentiment:         capture.sentiment,
    feedback_text:     capture.text,
    source:            capture.source,
    facility_category: capture.facility,
    rating:            capture.rating,
  });
  if (error) {
    console.error("[guestFacilityReview] insert FAILED:", error.message);
  }
}

export function normalizeFacilityReviewToolArgs(raw: unknown): FacilityReviewCapture | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const facilityRaw = String(obj.facility ?? "");
  if (!isValidFacilityCategory(facilityRaw)) {
    console.warn(`[guestFacilityReview] invalid facility "${facilityRaw}"`);
    return null;
  }
  const sentimentRaw = String(obj.sentiment ?? "neutral");
  const sentiment: FacilitySentiment =
    sentimentRaw === "positive" || sentimentRaw === "negative" ? sentimentRaw : "neutral";
  let rating: number | null = null;
  if (obj.rating != null && obj.rating !== "") {
    const n = Number(obj.rating);
    if (Number.isFinite(n) && n >= 1 && n <= 10) rating = Math.round(n);
  }
  const summary = typeof obj.summary === "string" && obj.summary.trim()
    ? obj.summary.trim()
    : null;
  if (!summary) return null;
  return {
    facility: facilityRaw,
    sentiment,
    rating,
    text: summary,
    source: "bot_tool",
  };
}

export const LOG_FACILITY_REVIEW_TOOL_NAME = "log_facility_review";

export const LOG_FACILITY_REVIEW_TOOL_DESCRIPTION =
  "Call when the guest shares an opinion or rating about a resort facility " +
  "(restaurant/food, spa, pool, patio, bar, cleaning, service team). " +
  "NEVER call for informational questions (hours, location, menu link). " +
  "Include rating 1-10 only if the guest gave one.";

export const LOG_FACILITY_REVIEW_JSON_SCHEMA = {
  type: "object",
  properties: {
    facility: {
      type: "string",
      enum: [...FACILITY_CATEGORIES],
      description: "Which facility the feedback is about.",
    },
    sentiment: {
      type: "string",
      enum: ["positive", "negative", "neutral"],
    },
    rating: {
      type: "integer",
      description: "1-10 if guest gave a numeric rating; omit if none.",
    },
    summary: {
      type: "string",
      description: "Short Hebrew summary of the guest's facility feedback (include key details).",
    },
  },
  required: ["facility", "sentiment", "summary"],
};

export const FACILITY_REVIEW_TOOL_INSTRUCTIONS = `

══ ביקורות מתקנים (לא להציג לאורח) ══
כשאורח משתף דעה על מתקן (מסעדה/אוכל, ספא, בריכה, פטיו, בר, ניקיון, צוות) — קרא ל-log_facility_review עם סיכום קצר בעברית.
אם חסר דירוג מספרי — אפשר לשאול בנימוס «איך הייתם מדרגים 1–10?» ואז לקרוא לפונקציה כשמקבלים תשובה.
אסור לקרוא על שאלות מידע (שעות, מיקום, תפריט). אסור על בקשות תפעוליות (תקלה, מגבות) — אלה log_guest_request או handoff.`;

// src/utils/importMapper.js
// ── Resilient Import Agent — frontend half ────────────────────────────────────
// Pairs with supabase/functions/suggest-import-mapping/index.ts. This file owns:
//   - the schema descriptor for "what fields exist" (mirrors the Edge Function's
//     SCHEMAS registry — keep both in sync by hand, no shared module between
//     Deno and browser JS in this codebase)
//   - privacy-conscious sample building (mask phone-shaped values before they
//     leave the browser for the AI suggestion call)
//   - small pure helpers used by MappingReviewPanel.js
//
// The actual row→profile extraction logic (phone/name cascades, day-guest
// classification) still lives in ezgoParser.js — this file does NOT replace
// that logic, it only helps produce the `columnMapping` object that
// ezgoParser.js's extractGuestDetails()/aggregateGuestProfiles() now accept
// as a parameter instead of hardcoding EZGO's exact column names.

// ── Schema descriptor — mirrors suggest-import-mapping/index.ts SCHEMAS.suite_arrivals ──
export const SUITE_ARRIVALS_SCHEMA = {
  orderNumber:  { label: "מספר הזמנה (PMS)",                                  required: "hard",     example: "266932" },
  resLineId:    { label: "מזהה שורת חדר גלובלי (מפתח ייחודי לכל חדר)",          required: "hard",     example: "9821345" },
  roomName:     { label: "מספר/שם חדר",                                       required: "optional", example: "8" },
  suiteType:    { label: "סוג סוויטה/חבילה",                                   required: "optional", example: "סוויטת אמטיסט" },
  coordName:    { label: "שם מזמין/קבוצה (קואורדינטור ההזמנה)",                 required: "optional", example: "ישראל ישראלי" },
  coordPhone:   { label: "טלפון מזמין — ספרות בלבד, לרוב ללא 0 מוביל",           required: "soft",     example: "525778390" },
  remark:       { label: "הערה חופשית — מכילה שם+טלפון האורח האמיתי בתוך הטקסט", required: "soft",     example: "מוחמד עדילה 052-5778390" },
  opRemark:     { label: "הערה תפעולית משנית — אותו פורמט כמו ההערה הראשית",     required: "optional", example: "" },
  adults:       { label: "מספר מבוגרים",                                      required: "optional", defaultPolicy: "1", example: "2" },
  children:     { label: "מספר ילדים",                                       required: "optional", defaultPolicy: "0", example: "0" },
  nights:       { label: "מספר לילות",                                       required: "optional", defaultPolicy: "0", example: "2" },
  checkinTime:  { label: "שעת צ׳ק-אין",                                       required: "optional", example: "15:00" },
  checkoutTime: { label: "שעת צ׳ק-אאוט",                                      required: "optional", example: "11:00" },
  groupId:      { label: "דגל בילוי-יומי (1 = אורח יומי, ללא לינה)",             required: "optional", defaultPolicy: "0", example: "0" },
  price:        { label: "מחיר",                                             required: "optional", defaultPolicy: "0", example: "1200" },
  arrivalDate:  { label: "תאריך הגעה",                                        required: "soft",     defaultPolicy: "היום (כשאין עמודת תאריך כלל)", example: "2026-06-18" },
};

// ── Schema descriptor — mirrors suggest-import-mapping/index.ts SCHEMAS.inventory_renewal ──
// parLevel/restockColumn are read as plain computed values, same as every
// other column — no formula-syntax parsing. If only restockColumn is mapped
// (no visible target column in the sheet), deriveParLevel() below recovers
// the target via simple arithmetic instead of re-implementing the formula.
export const INVENTORY_RENEWAL_SCHEMA = {
  itemName:        { label: "שם הפריט (מגבות, סבון, מצעים וכו׳)",                                  required: "hard",     example: "מגבות חדר" },
  currentQuantity: { label: "כמות נוכחית/שנספרה בפועל",                                           required: "hard",     example: "42" },
  unit:            { label: "יחידת מידה",                                                        required: "optional", defaultPolicy: "יח׳", example: "בקבוקים" },
  category:        { label: "קטגוריה (טקסטיל, אמבטיה, מתכלים...)",                                 required: "optional", defaultPolicy: "other", example: "אמבטיה" },
  parLevel:        { label: "עמודת יעד/מלאי מינימלי, אם קיימת בקובץ כעמודה נפרדת",                   required: "optional", example: "60" },
  restockColumn:   { label: "עמודת ׳להשלים/חסר׳ המחושבת בנוסחה הקיימת בקובץ (אם אין עמודת יעד נפרדת)", required: "optional", example: "18" },
};

/**
 * deriveParLevel(currentQuantity, parLevel, restockColumn)
 * If the sheet had a visible target column, that value wins as-is. Otherwise,
 * if it only had a "to restock" column (itself a formula's output, already
 * computed by Excel), the target is recovered by simple arithmetic: target =
 * current + restock — no formula text is ever read or re-implemented.
 * Returns null when neither column was mapped/present for this row.
 */
export function deriveParLevel(currentQuantity, parLevel, restockColumn) {
  const cur = Number(currentQuantity);
  if (parLevel !== "" && parLevel != null && !Number.isNaN(Number(parLevel))) {
    return Number(parLevel);
  }
  if (restockColumn !== "" && restockColumn != null && !Number.isNaN(Number(restockColumn)) && !Number.isNaN(cur)) {
    return cur + Number(restockColumn);
  }
  return null;
}

// ── Privacy: mask phone-shaped / long-numeric values before they leave the
// browser for the AI suggestion call. The model only needs to recognize a
// column's SHAPE ("this looks like a phone number"), not the real value —
// the real value is never sent here, only used later by applyMapping locally.
const PHONE_LIKE_RE = /(\+?\d[\d\-. ]{6,}\d)/g;

export function maskSampleValue(value) {
  if (value == null) return value;
  const s = String(value);
  // No .test() pre-check: PHONE_LIKE_RE is a module-level global regex, and
  // .test() would mutate its shared lastIndex across calls, causing later
  // calls to silently start scanning mid-string. .replace() resets lastIndex
  // to 0 internally on every call (per spec for global regexes), so it's
  // both correct and sufficient on its own — no match just returns `s` unchanged.
  return s.replace(PHONE_LIKE_RE, (m) => {
    const digits = m.replace(/\D/g, "");
    if (digits.length <= 4) return m; // too short to be identifying — leave as-is
    return m.slice(0, Math.ceil(m.length / 2)) + "*".repeat(m.length - Math.ceil(m.length / 2));
  });
}

/**
 * buildMaskedSample(rows, headers, n=3)
 * Returns up to n rows as plain {header: maskedValue} objects, safe to send
 * to the suggest-import-mapping Edge Function. Never used for the actual
 * import — that always reads the real, unmasked rows.
 */
export function buildMaskedSample(rows, headers, n = 3) {
  return rows.slice(0, n).map((row) => {
    const out = {};
    for (const h of headers) out[h] = maskSampleValue(row[h]);
    return out;
  });
}

/** Today's date as "YYYY-MM-DD" — the client-side fallback for arrivalDate when the AI call itself is unavailable (no key, network error, etc). Still shown/editable in the review screen, never applied silently. */
export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * clientSideDefault(fieldKey)
 * Used only when the AI suggestion call failed entirely (so there is no
 * `defaults` object to read from). Currently only arrivalDate has an
 * established safe-default concept; everything else is left for the admin
 * to fill in manually rather than guessing.
 */
export function clientSideDefault(fieldKey) {
  if (fieldKey === "arrivalDate") {
    return { value: todayISO(), reason: "הצעת AI לא הייתה זמינה — ברירת מחדל מקומית" };
  }
  return null;
}

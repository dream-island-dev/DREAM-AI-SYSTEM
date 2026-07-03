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
  leadSource:   { label: "מקור הגעה (Lead Source)",                           required: "optional", example: "מחלקת מכירות" },
  guestPhone:   { label: "טלפון אורח (עמודה ישירה, ללא הערות)",                required: "optional", example: "0522468207" },
};

/** Lead source value that muzzles all pipeline/cron WhatsApp automation. */
export const SALES_DEPT_LEAD_SOURCE = "מחלקת מכירות";

export function isAutomationMutedLeadSource(leadSource) {
  return String(leadSource ?? "").trim() === SALES_DEPT_LEAD_SOURCE;
}

/**
 * Preset column mapping for the advanced PMS export (e.g. 01.7.26.csv):
 * שם מלא, טלפון, מס. הזמנה, מס. לקוח, ת. התחלה, לילות, מקור הגעה.
 * Returns null when headers do not match this shape.
 */
export function detectSuiteArrivalsPreset(headers) {
  if (!headers?.length) return null;
  const set = new Set(headers);
  if (!set.has("מקור הגעה") || !set.has("שם מלא") || !set.has("טלפון")
      || !set.has("מס. הזמנה") || !set.has("מס. לקוח") || !set.has("ת. התחלה")) {
    return null;
  }
  const priceCol = headers.find((h) => h === "מחיר" || /^מחיר/.test(h)) ?? "מחיר";
  return {
    orderNumber: "מס. הזמנה",
    resLineId:   "מס. לקוח",
    coordName:   "שם מלא",
    coordPhone:  "טלפון",
    guestPhone:  "טלפון",
    roomName:    "חדרים",
    nights:      "לילות",
    price:       priceCol,
    arrivalDate: "ת. התחלה",
    leadSource:  "מקור הגעה",
  };
}

/**
 * Preset column mapping for the raw EZGO Suites Arrivals export ("Suite
 * CSV") — the iOrderId/sTel1/sRemark/sClientFullName/sSubItemName/sRoomName/
 * iResLineId column shape. Returns null when headers do not match this shape.
 *
 * guestPhone is deliberately NOT mapped here: sTel1 is the booking
 * COORDINATOR's phone (shared across every room in a group booking), not the
 * individual occupant's — ezgoParser.js's extractGuestDetails() resolves the
 * true individual phone from `remark` first (its remark-first phone
 * cascade). Mapping sTel1 to guestPhone would let a mapped "direct" phone
 * short-circuit that remark resolution and route messages to the
 * coordinator instead of the actual guest.
 */
export function detectEzgoArrivalsPreset(headers) {
  if (!headers?.length) return null;
  const set = new Set(headers);
  const required = ["iOrderId", "sTel1", "sRemark", "sClientFullName", "sSubItemName", "sRoomName", "iResLineId"];
  if (!required.every((h) => set.has(h))) return null;
  return {
    orderNumber: "iOrderId",
    resLineId:   "iResLineId",
    coordName:   "sClientFullName",
    coordPhone:  "sTel1",
    // guestPhone: intentionally omitted — see docstring above.
    remark:      "sRemark",
    suiteType:   "sSubItemName",
    roomName:    "sRoomName",
    groupId:     "Group_Id",
    nights:      "iNights",
    price:       "cPrice",
  };
}

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

// ── Schema descriptors — mirror suggest-import-mapping/index.ts SCHEMAS.voucher_provider_report
// / SCHEMAS.voucher_easygo_report (Voucher Reconciliation Engine, migration 091).
// Used only to render field labels/required-badges in MappingReviewPanel — the
// actual mapping/parsing happens server-side in reconcile-vouchers/index.ts.
export const VOUCHER_PROVIDER_SCHEMA = {
  voucherNumber: { label: "מספר שובר/קופון",              required: "soft",     example: "HZ-4821-0007" },
  guestName:     { label: "שם האורח כפי שמופיע בדוח הספק", required: "soft",     example: "ישראל ישראלי" },
  packageType:   { label: "סוג חבילה/שובר",               required: "optional", example: "זוגי + שמפניה" },
  amount:        { label: "סכום ששולם (₪)",               required: "optional", example: "450" },
  purchaseDate:  { label: "תאריך רכישת השובר",            required: "optional", example: "10/06/2026" },
};

export const VOUCHER_EASYGO_SCHEMA = {
  voucherNumber: { label: "מספר שובר כפי שמופיע בדוח השוברים של EasyGo", required: "soft",     example: "HZ-4821-00070192" },
  guestName:     { label: "שם האורח",                                  required: "soft",     example: "ישראל ישראלי" },
  phone:         { label: "טלפון האורח",                               required: "optional", example: "0525778390" },
  orderNumber:   { label: "מספר הזמנה (PMS)",                          required: "optional", example: "266932" },
  packageType:   { label: "סוג חבילה/שובר שהוזמן",                     required: "optional", example: "זוגי + שמפניה" },
  amount:        { label: "סכום (₪)",                                 required: "optional", example: "450" },
  arrivalDate:   { label: "תאריך הגעה",                                required: "optional", example: "18/06/2026" },
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

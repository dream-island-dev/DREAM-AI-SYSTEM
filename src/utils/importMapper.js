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

/** Trim + strip BOM — Excel/CSV headers often carry invisible prefix/spaces. */
export function normalizeImportHeaderKey(raw) {
  return String(raw ?? "")
    .replace(/[\u200B-\u200F\u202A-\u202E\uFEFF]/g, "")
    .trim();
}

function _findHeaderKey(headers, canonical) {
  const want = normalizeImportHeaderKey(canonical).toLowerCase();
  for (const h of headers ?? []) {
    if (normalizeImportHeaderKey(h).toLowerCase() === want) return normalizeImportHeaderKey(h);
  }
  return null;
}

/** Core EZGO Suites columns (every arrivals export). */
export const EZGO_CORE_HEADERS = ["iOrderId", "sTel1", "sRemark", "sClientFullName", "sSubItemName", "sRoomName"];

/** Line-id column — old ezgoParser used iReservationsLineId (global PMS key); some exports also have iResLineId. */
export const EZGO_LINE_ID_HEADERS = ["iReservationsLineId", "iResLineId"];

/** @deprecated use EZGO_CORE_HEADERS + EZGO_LINE_ID_HEADERS */
export const EZGO_REQUIRED_HEADERS = [...EZGO_CORE_HEADERS, "iResLineId"];

/** @returns {Record<string, string>|null} role → actual header key in this file */
function _resolveEzgoHeaderKeys(headers) {
  const out = {};
  for (const name of EZGO_CORE_HEADERS) {
    const key = _findHeaderKey(headers, name);
    if (!key) return null;
    out[name] = key;
  }
  let resLineKey = null;
  for (const alias of EZGO_LINE_ID_HEADERS) {
    resLineKey = _findHeaderKey(headers, alias);
    if (resLineKey) break;
  }
  if (!resLineKey) return null;
  out.resLineId = resLineKey;
  return out;
}

/**
 * FAIL VISIBLE diagnostic for when neither EZGO preset matches a file's
 * headers -- surfaced in ArrivalImportPanel.js so staff/dev see exactly
 * what was in the file instead of silently landing in the AI/manual
 * mapping screen with no explanation. Purely descriptive: never blocks or
 * alters the import itself.
 */
export function diagnoseEzgoPresetMiss(headers) {
  const cleaned = (headers ?? []).map(normalizeImportHeaderKey).filter(Boolean);
  const missingCore = EZGO_CORE_HEADERS.filter((name) => !_findHeaderKey(cleaned, name));
  const hasLineId = EZGO_LINE_ID_HEADERS.some((name) => _findHeaderKey(cleaned, name));
  const missing = [
    ...missingCore,
    ...(hasLineId ? [] : ["iReservationsLineId|iResLineId"]),
  ];
  const matchedCount = EZGO_CORE_HEADERS.length - missingCore.length + (hasLineId ? 1 : 0);
  return {
    headers: cleaned,
    required: [...EZGO_CORE_HEADERS, "iReservationsLineId|iResLineId"],
    missing,
    matchedCount,
  };
}

/** Old pre-Agent path: normalize keys + sGroupName → sClientFullName when empty. */
export function canonicalizeEzgoSuiteRows(rows) {
  return normalizeImportRows(rows).map((row) => {
    const out = { ...row };
    if (!String(out.sClientFullName ?? "").trim() && String(out.sGroupName ?? "").trim()) {
      out.sClientFullName = out.sGroupName;
    }
    return out;
  });
}

/** Rewrite row keys so preset detection and columnMapping use stable names. */
export function normalizeImportRows(rows) {
  if (!rows?.length) return [];
  return rows.map((row) => {
    const out = {};
    for (const [k, v] of Object.entries(row ?? {})) {
      out[normalizeImportHeaderKey(k)] = v;
    }
    return out;
  });
}

/** Mapping must include both hard keys before we trust memory or show approve. */
export function isMappingUsable(mapping) {
  if (!mapping || typeof mapping !== "object") return false;
  const order = String(mapping.orderNumber ?? "").trim();
  const resLine = String(mapping.resLineId ?? "").trim();
  return !!(order && resLine);
}

/** Map stored column names onto actual row keys (memory / AI alias tolerance). */
export function resolveImportColumn(mappingCol, headers, sampleRow) {
  if (!mappingCol) return "";
  const col = String(mappingCol).trim();
  if (sampleRow && col in sampleRow) return col;
  const norm = normalizeImportHeaderKey(col).toLowerCase();
  for (const h of headers ?? []) {
    if (normalizeImportHeaderKey(h).toLowerCase() === norm) return normalizeImportHeaderKey(h);
  }
  return col;
}

export function resolveImportMapping(mapping, headers, sampleRow) {
  if (!mapping) return null;
  const out = {};
  for (const [k, v] of Object.entries(mapping)) {
    out[k] = v ? resolveImportColumn(v, headers, sampleRow) : null;
  }
  return out;
}

/**
 * EZGO exports often have title rows before the real header row (Excel especially).
 * Scan the first N matrix rows for a preset-matching header line.
 * @returns {{ rows: object[], headerIdx: number } | null}
 */
export function matrixRowsFromHeaderScan(matrix, maxScan = 50) {
  if (!matrix?.length) return null;
  const limit = Math.min(matrix.length, maxScan);
  for (let i = 0; i < limit; i++) {
    const headerCells = (matrix[i] ?? []).map((c) => normalizeImportHeaderKey(c));
    if (!headerCells.some(Boolean)) continue;
    if (!detectEzgoArrivalsPreset(headerCells) && !detectSuiteArrivalsPreset(headerCells)) continue;
    const rows = matrix.slice(i + 1)
      .map((row) => {
        const obj = {};
        headerCells.forEach((h, col) => { obj[h] = row?.[col] ?? ""; });
        return obj;
      })
      .filter((row) => Object.values(row).some((v) => String(v ?? "").trim()));
    return { rows: normalizeImportRows(rows), headerIdx: i };
  }
  return null;
}

/**
 * Preset column mapping for the advanced PMS export (e.g. 01.7.26.csv):
 * שם מלא, טלפון, מס. הזמנה, מס. לקוח, ת. התחלה, לילות, מקור הגעה.
 * Returns null when headers do not match this shape.
 */
export function detectSuiteArrivalsPreset(headers) {
  if (!headers?.length) return null;
  const set = new Set(headers.map(normalizeImportHeaderKey));
  if (!set.has("מקור הגעה") || !set.has("שם מלא") || !set.has("טלפון")
      || !set.has("מס. הזמנה") || !set.has("מס. לקוח") || !set.has("ת. התחלה")) {
    return null;
  }
  const priceCol = headers.find((h) => {
    const n = normalizeImportHeaderKey(h);
    return n === "מחיר" || /^מחיר/.test(n);
  });
  const priceKey = priceCol ? normalizeImportHeaderKey(priceCol) : "מחיר";
  return {
    orderNumber: "מס. הזמנה",
    resLineId:   "מס. לקוח",
    coordName:   "שם מלא",
    coordPhone:  "טלפון",
    guestPhone:  "טלפון",
    roomName:    "חדרים",
    nights:      "לילות",
    price:       priceKey,
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
  const keys = _resolveEzgoHeaderKeys(headers);
  if (!keys) return null;
  const mapping = {
    orderNumber: keys.iOrderId,
    resLineId:   keys.resLineId,
    coordName:   keys.sClientFullName,
    coordPhone:  keys.sTel1,
    remark:      keys.sRemark,
    suiteType:   keys.sSubItemName,
    roomName:    keys.sRoomName,
    groupId:     _findHeaderKey(headers, "Group_Id") ?? "Group_Id",
    nights:      _findHeaderKey(headers, "iNights") ?? "iNights",
    price:       _findHeaderKey(headers, "cPrice") ?? "cPrice",
  };
  const opRemark = _findHeaderKey(headers, "sOperationRemark");
  const adults = _findHeaderKey(headers, "iAdults");
  const children = _findHeaderKey(headers, "iChilds");
  const arrival = _findHeaderKey(headers, "dtCheckIn");
  const checkIn = _findHeaderKey(headers, "sCheckInTime");
  const checkOut = _findHeaderKey(headers, "sCheckOutTime");
  if (opRemark) mapping.opRemark = opRemark;
  if (adults) mapping.adults = adults;
  if (children) mapping.children = children;
  if (arrival) mapping.arrivalDate = arrival;
  if (checkIn) mapping.checkinTime = checkIn;
  if (checkOut) mapping.checkoutTime = checkOut;
  return mapping;
}

/** Alias — single entry for the Tier-0 instant Doc 2 path. */
export const buildEzgoSuiteMapping = detectEzgoArrivalsPreset;

/** Fields staff may type a session default for in MappingReviewPanel. */
const TIME_DEFAULT_FIELDS = new Set(["checkinTime", "checkoutTime"]);

const ROOM_LEVEL_DEFAULT_FIELDS = new Set([
  "checkinTime", "checkoutTime", "adults", "children", "nights", "price", "groupId",
]);

export function isDefaultEditableField(fieldKey, spec) {
  if (TIME_DEFAULT_FIELDS.has(fieldKey)) return true;
  if (spec?.defaultPolicy != null && spec.defaultPolicy !== "") return true;
  return false;
}

export function isTimeDefaultField(fieldKey) {
  return TIME_DEFAULT_FIELDS.has(fieldKey);
}

export function isEmptyImportCell(value) {
  const s = String(value ?? "").trim();
  return !s || s === "-" || s === "—";
}

/** HH:MM (24h), optional leading zero on hour. */
export function isValidHmTime(value) {
  const s = String(value ?? "").trim();
  if (!s) return false;
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return false;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h >= 0 && h <= 23 && min >= 0 && min <= 59;
}

/**
 * parseMappingMemory — backward-compatible loader for import_mapping_memory.
 * v1: flat mapping object. v2: { v:2, mapping, fieldDefaults }.
 */
export function parseMappingMemory(stored) {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
    return { mapping: {}, fieldDefaults: {} };
  }
  if (stored.v === 2) {
    return {
      mapping: stored.mapping ?? {},
      fieldDefaults: stored.fieldDefaults ?? {},
    };
  }
  return { mapping: stored, fieldDefaults: {} };
}

/** Pack mapping + optional session defaults for DB memory (v2 when defaults exist). */
export function packMappingMemory(mapping, fieldDefaults) {
  const fd = Object.fromEntries(
    Object.entries(fieldDefaults ?? {}).filter(([, v]) => !isEmptyImportCell(v)),
  );
  if (!Object.keys(fd).length) return mapping;
  return { v: 2, mapping, fieldDefaults: fd };
}

/**
 * applyFieldDefaultsToProfiles — fill empty parsed cells only (never overwrite).
 * Room-level fields (checkin/checkout/adults/…) live on profile.rooms[].
 */
export function applyFieldDefaultsToProfiles(profileMap, appliedDefaults) {
  if (!profileMap?.size || !appliedDefaults) return;
  for (const profile of profileMap.values()) {
    for (const room of profile.rooms ?? []) {
      for (const [key, rawVal] of Object.entries(appliedDefaults)) {
        if (key === "arrivalDate" || !ROOM_LEVEL_DEFAULT_FIELDS.has(key)) continue;
        const val = String(rawVal ?? "").trim();
        if (!val) continue;
        if (isEmptyImportCell(room[key])) room[key] = val;
      }
    }
  }
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

// Voucher preset aliases — mirrored in supabase/functions/_shared/voucherImport.ts.
// reconcile-vouchers uses the server copy; these exports document the same rules.
export const VOUCHER_EASYGO_HEADER_ALIASES = {
  voucherNumber: ["מספר שובר", "מס שובר", "קוד שובר", "מספר קופון", "שובר", "CouponNo", "מזהה", "מזהה שובר"],
  packageType:   ["חבילה", "סוג חבילה", "סוג שובר", "שם חבילה", "package", "מוצר", "CouponDesc", "SIName"],
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

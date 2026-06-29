// src/utils/detailedReservationParser.js
// Dedicated parser for the PMS "Detailed Reservation Report" export (e.g. 01.7.26.csv).
// Pure transform — no Supabase calls. Wired from ArrivalImportPanel.js only.

import { isAutomationMutedLeadSource } from "./importMapper";

/** Excel 1900 date system — day 1 = 1899-12-30 UTC (Windows / SheetJS convention). */
const EXCEL_EPOCH_OFFSET = 25569;

const BOARD_BASIS_MAP = {
  BB: "בסיס ארוחת בוקר",
  HB: "חצי פנסיון (ארוחת ערב ובוקר)",
  FB: "פנסיון מלא",
  RO: "חדר בלבד (ללא ארוחות)",
};

const DUMMY_DATE_RE = /^01[/.-]01[/.-](1900|1970|2001)/;

/**
 * Convert an Excel serial (e.g. 46029.00046296296) to a JS Date (UTC midnight).
 */
export function excelSerialToDate(serial) {
  const n = typeof serial === "number" ? serial : parseFloat(String(serial).trim());
  if (!Number.isFinite(n) || n < 1) return null;
  const ms = Math.round((n - EXCEL_EPOCH_OFFSET) * 86_400_000);
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** ISO date string YYYY-MM-DD from Excel serial. */
export function excelSerialToISO(serial) {
  const d = excelSerialToDate(serial);
  return d ? d.toISOString().slice(0, 10) : null;
}

/**
 * Parse arrival date from detailed-report cells: Excel serial, DD/MM/YYYY[+time], ISO.
 */
export function parseDetailedArrivalDate(raw) {
  if (raw == null || raw === "") return null;
  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime()) ? null : raw.toISOString().slice(0, 10);
  }
  const s = String(raw).trim();
  if (!s || DUMMY_DATE_RE.test(s)) return null;

  const dmy = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?/);
  if (dmy) {
    const [, d, m, y] = dmy;
    const year = y.length === 2 ? `20${y}` : y;
    return `${year}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  if (/^\d{4}[-/]\d{2}[-/]\d{2}/.test(s)) {
    return s.slice(0, 10).replace(/\//g, "-");
  }

  const serial = parseFloat(s);
  if (Number.isFinite(serial) && serial > 25000) {
    return excelSerialToISO(serial);
  }

  return null;
}

export function translateBoardBasis(raw) {
  const code = String(raw ?? "").trim().toUpperCase();
  return BOARD_BASIS_MAP[code] ?? null;
}

export function parsePriceValue(raw) {
  if (raw == null || raw === "") return null;
  const cleaned = String(raw).replace(/[₪,\s]/g, "").trim();
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function pricesMatch(a, b, tolerance = 0.02) {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.abs(a - b) <= tolerance;
}

function normalizePhone(raw) {
  if (!raw) return null;
  const c = String(raw).replace(/[^\d+]/g, "");
  if (!c) return null;
  if (c.startsWith("+")) return c.length >= 10 ? c : null;
  if (/^5\d{8}$/.test(c)) return `+972${c}`;
  if (/^05\d{8}$/.test(c)) return `+972${c.slice(1)}`;
  if (c.startsWith("972") && c.length >= 11) return `+${c}`;
  return c.length >= 9 ? c : null;
}

/** Strip wrapping quotes and unescape doubled quotes from a cell value. */
export function cleanCsvCell(value) {
  if (value == null) return "";
  let s = String(value).trim();
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) {
    s = s.slice(1, -1).replace(/""/g, '"');
  }
  return s.trim();
}

/**
 * Fix common PMS export bug: Hebrew legal suffix בע"מ contains an unescaped `"` that
 * terminates the quoted name field early (e.g. אורמת מערכות בע"מ).
 */
function preprocessCsvLine(line) {
  return String(line)
    .replace(/בע"מ/g, 'בע""מ')
    .replace(/בע״מ/g, "בע״מ"); // geresh variant — keep as-is, no ASCII quote
}

/**
 * RFC 4180-style CSV line parser — respects quoted fields and escaped `""`.
 */
export function parseCsvLine(line) {
  const fields = [];
  let field = "";
  let inQuotes = false;
  const s = preprocessCsvLine(line);

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      continue;
    }
    if (c === ",") {
      fields.push(cleanCsvCell(field));
      field = "";
      continue;
    }
    field += c;
  }
  fields.push(cleanCsvCell(field));
  return fields;
}

/** Parse full CSV text into a matrix of clean string cells. */
export function parseCsvText(text) {
  const normalized = String(text ?? "").replace(/^\uFEFF/, "");
  const rows = [];
  let line = "";
  let inQuotes = false;

  // Line split that respects quoted newlines (rare but safe).
  for (let i = 0; i < normalized.length; i++) {
    const c = normalized[i];
    if (c === '"') {
      inQuotes = !inQuotes;
      line += c;
      continue;
    }
    if (!inQuotes && (c === "\n" || (c === "\r" && normalized[i + 1] === "\n"))) {
      if (c === "\r") i++;
      if (line.trim()) rows.push(parseCsvLine(line));
      line = "";
      continue;
    }
    line += c;
  }
  if (line.trim()) rows.push(parseCsvLine(line));
  return rows;
}

const EXPECTED_DETAILED_COLS = 22;

/** Detect SheetJS / naive reads that collapse each CSV line into a single cell. */
function isCollapsedCsvRow(row) {
  if (!row || row.length !== 1) return false;
  const s = String(row[0] ?? "");
  return s.includes('","') || (s.includes(",") && s.startsWith('"'));
}

/** Name cell polluted by SheetJS mis-split (raw CSV fragments in one field). */
function isBrokenMergedNameCell(value) {
  const s = String(value ?? "");
  return s.includes('","') || (/\d{2}\/\d{2}\/\d{4}/.test(s) && /05\d{8}/.test(s));
}

/**
 * Normalize input from SheetJS header:1 OR raw text OR collapsed single-column rows.
 */
export function normalizeDetailedReservationMatrix(rawRows) {
  if (!rawRows?.length) return [];

  if (typeof rawRows === "string") {
    return parseCsvText(rawRows);
  }

  if (isCollapsedCsvRow(rawRows[0]) || rawRows.every(isCollapsedCsvRow)) {
    const text = rawRows.map((r) => String(r[0] ?? "")).join("\n");
    return parseCsvText(text);
  }

  return rawRows.map((row) => (row || []).map((cell) => cleanCsvCell(cell)));
}

/** Use quote-safe text parser for .csv and CSV-shaped uploads (not SheetJS). */
export function shouldParseDetailedReportAsText(fileName, headText = "") {
  if (/\.csv$/i.test(fileName || "")) return true;
  const head = String(headText).replace(/^\uFEFF/, "");
  return head.includes("שם מלא") && (head.includes('"אתר"') || head.includes("מס. הזמנה"));
}

/**
 * Preferred entry for .csv uploads — reads file text with quote-safe parser.
 */
export function parseDetailedReservationCsvText(text) {
  const matrix = parseCsvText(text);
  return parseDetailedReservationRows(matrix);
}

function headerIndices(headers, name) {
  return headers
    .map((h, i) => (String(h).trim() === name ? i : -1))
    .filter((i) => i >= 0);
}

function cell(row, idx) {
  if (idx < 0 || idx >= row.length) return "";
  const v = row[idx];
  return v == null ? "" : v;
}

/**
 * True when the header row matches the detailed reservation export shape.
 */
export function isDetailedReservationFormat(headers) {
  if (!headers?.length) return false;
  const set = new Set(headers.map((h) => cleanCsvCell(h)));
  return (
    set.has("שם מלא") &&
    set.has("טלפון") &&
    set.has("מס. הזמנה") &&
    set.has("ת. התחלה") &&
    set.has("חדרים") &&
    set.has("לילות") &&
    set.has("מקור הגעה")
  );
}

/**
 * Parse raw sheet rows (header:1 from SheetJS) into profile-ready records.
 *
 * @returns {{
 *   rows: Array<object>,
 *   priceConflicts: Array<{ rowIndex, guestName, price1, price2, price1Label, price2Label }>
 * }}
 */
export function parseDetailedReservationRows(rawRows) {
  if (!rawRows?.length) {
    return { rows: [], priceConflicts: [] };
  }

  const matrix = normalizeDetailedReservationMatrix(rawRows);
  if (!matrix.length) {
    return { rows: [], priceConflicts: [] };
  }

  const headers = matrix[0].map((h) => cleanCsvCell(h));
  if (!isDetailedReservationFormat(headers)) {
    throw new Error("פורמט לא מזוהה — צפוי דוח הזמנות מפורט (שם מלא, טלפון, מס. הזמנה, ת. התחלה)");
  }

  const idx = (name) => headers.indexOf(name);
  const priceIdxs = headerIndices(headers, "מחיר");
  const boardIdxs = headerIndices(headers, "בסיס אירוח");
  const price1Idx = priceIdxs[0] ?? -1;
  const price2Idx = priceIdxs[1] ?? priceIdxs[0] ?? -1;
  // Letter codes (HB/BB/…) usually sit in the second duplicate column.
  const boardCodeIdx = boardIdxs.length > 1 ? boardIdxs[1] : boardIdxs[0] ?? -1;

  const rows = [];
  const priceConflicts = [];

  for (let ri = 1; ri < matrix.length; ri++) {
    const row = matrix[ri];
    if (!row || row.every((c) => c == null || String(c).trim() === "")) continue;

    if (row.length !== EXPECTED_DETAILED_COLS || isBrokenMergedNameCell(row[8])) {
      continue;
    }

    const guestName = cleanCsvCell(cell(row, idx("שם מלא")));
    const guestPhone = normalizePhone(cell(row, idx("טלפון")));
    const orderNumber = cleanCsvCell(cell(row, idx("מס. הזמנה")));
    const resLineId = cleanCsvCell(cell(row, idx("מס. לקוח")));
    const arrivalDate = parseDetailedArrivalDate(cell(row, idx("ת. התחלה")));
    const roomsCount = parseInt(cleanCsvCell(cell(row, idx("חדרים"))), 10) || 0;
    const nights = parseInt(cleanCsvCell(cell(row, idx("לילות"))), 10) || 0;
    const leadSource = cleanCsvCell(cell(row, idx("מקור הגעה"))) || null;
    const extraPhone = cleanCsvCell(cell(row, idx("טלפון נוסף")));
    const boardRaw = cell(row, boardCodeIdx);
    const mealLocation = translateBoardBasis(boardRaw);

    const price1 = parsePriceValue(cell(row, price1Idx));
    const price2 = parsePriceValue(cell(row, price2Idx));
    let resolvedPrice = price1 ?? price2 ?? 0;
    let priceConflict = null;

    if (!pricesMatch(price1, price2)) {
      priceConflict = {
        rowIndex: ri - 1,
        guestName: guestName || `שורה ${ri}`,
        price1,
        price2,
        price1Label: price1 != null ? `${price1} ₪` : "—",
        price2Label: price2 != null ? `${price2} ₪` : "—",
      };
      priceConflicts.push(priceConflict);
    } else if (price1 != null) {
      resolvedPrice = price1;
    } else if (price2 != null) {
      resolvedPrice = price2;
    }

    const guestNotes = extraPhone ? `טלפון נוסף: ${extraPhone}` : null;

    if (!guestName && !guestPhone && !orderNumber) continue;
    if (isBrokenMergedNameCell(guestName)) continue;

    const isDayGuest = nights === 0;

    rows.push({
      rowIndex: ri - 1,
      guestName,
      guestPhone,
      orderNumber,
      resLineId,
      arrivalDate,
      rooms_count: roomsCount,
      nights,
      leadSource,
      meal_location: mealLocation,
      guest_notes: guestNotes,
      price: resolvedPrice,
      priceConflict,
      isDayGuest,
      automationMuted: isAutomationMutedLeadSource(leadSource),
      phoneSource: "individual",
    });
  }

  return { rows, priceConflicts };
}

/**
 * Build the same Map shape as aggregateGuestProfiles() for sync_suite_arrivals.
 */
export function detailedRowsToProfileMap(parsedRows) {
  const profiles = new Map();

  parsedRows.forEach((r, index) => {
    profiles.set(`row_${index}`, {
      guestPhone: r.guestPhone,
      coordPhone: null,
      guestName: r.guestName,
      phoneSource: r.phoneSource ?? "individual",
      arrivalDate: r.arrivalDate,
      isDayGuest: r.isDayGuest,
      roomsQuantity: r.rooms_count,
      meal_location: r.meal_location,
      guest_notes: r.guest_notes,

      rooms: [{
        resLineId: r.resLineId,
        orderNumber: r.orderNumber,
        roomName: r.rooms_count > 0 ? String(r.rooms_count) : "",
        suiteType: "",
        adults: 1,
        children: 0,
        nights: r.nights,
        checkinTime: null,
        checkoutTime: null,
        price: r.price,
        isDayGuest: r.isDayGuest,
      }],

      orderNumbers: r.orderNumber ? new Set([r.orderNumber]) : new Set(),
      hasSuite: !r.isDayGuest && r.nights > 0,
      hasDayBooking: r.isDayGuest,
      spa_time: null,
      treatment_count: 0,
      treatment_type: null,
      meal_plan: null,
      meal_time: null,
      leadSource: r.leadSource,
      automationMuted: r.automationMuted,
    });
  });

  return profiles;
}

/**
 * Apply manager-selected prices after the discrepancy modal resolves conflicts.
 * @param {object[]} parsedRows
 * @param {Record<number, "price1"|"price2">} resolutions — rowIndex → choice
 */
export function applyPriceResolutions(parsedRows, resolutions) {
  return parsedRows.map((row) => {
    const pick = resolutions[row.rowIndex];
    if (!pick || !row.priceConflict) return row;
    const price = pick === "price1" ? row.priceConflict.price1 : row.priceConflict.price2;
    return {
      ...row,
      price: price ?? row.price,
      priceConflict: null,
    };
  });
}

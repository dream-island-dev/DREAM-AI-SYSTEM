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
  const set = new Set(headers.map((h) => String(h).trim()));
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

  const headers = rawRows[0].map((h) => String(h ?? "").trim());
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

  for (let ri = 1; ri < rawRows.length; ri++) {
    const row = rawRows[ri];
    if (!row || row.every((c) => c == null || String(c).trim() === "")) continue;

    const guestName = String(cell(row, idx("שם מלא"))).trim();
    const guestPhone = normalizePhone(cell(row, idx("טלפון")));
    const orderNumber = String(cell(row, idx("מס. הזמנה"))).trim();
    const resLineId = String(cell(row, idx("מס. לקוח"))).trim();
    const arrivalDate = parseDetailedArrivalDate(cell(row, idx("ת. התחלה")));
    const roomsCount = parseInt(String(cell(row, idx("חדרים"))).trim(), 10) || 0;
    const nights = parseInt(String(cell(row, idx("לילות"))).trim(), 10) || 0;
    const leadSource = String(cell(row, idx("מקור הגעה"))).trim() || null;
    const extraPhone = String(cell(row, idx("טלפון נוסף"))).trim();
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

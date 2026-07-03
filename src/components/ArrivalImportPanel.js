// src/components/ArrivalImportPanel.js
// Unified Import Hub — the SOLE import surface in the app (per session 7 consolidation).
// Lives only inside OperationsBoard.js (formerly TaskBoard.js, session 21). Two profiles:
//
//   "suites" — Doc 2 (any CSV/Excel of room arrivals) → headers sent to the
//              suggest-import-mapping Edge Function (Resilient Import Agent,
//              session 9) → MappingReviewPanel (admin reviews/edits/approves)
//              → aggregateGuestProfiles(rows, approvedMapping) → editable grid
//              (suite dropdown sourced from SUITE_REGISTRY) → sync_suite_arrivals
//              RPC (guests + suite_rooms + bookings, with guests.room denormalized).
//              Doc 1 (Daily Report Excel or EZGO HTML, optional) →
//              parseComprehensiveReport / parseHtmlDailyReport → merges spa_time
//              + meal_time into the same grid before sync.
//   "shifts" — any Excel → editable grid → export back to .xlsx (no DB write).
//
// SpaStagingPanel remains a separate, standalone tool — it solves a different
// problem (triaging an external email/PDF automation against existing bookings)
// and is intentionally NOT folded in here.

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { supabase } from "../supabaseClient";
import { EditableGrid, BulkEditBar, exportToExcel } from "./EditableGrid";
import MappingReviewPanel from "./MappingReviewPanel";
import { SUITE_REGISTRY, resolveSuiteFromEzgoFields } from "../data/suiteRegistry";
import {
  aggregateGuestProfiles,
  profilesToArray,
  enrichProfilesFromExcel,
} from "../utils/ezgoParser";
import { mergeCandidates, classifyDbMatch } from "../utils/guestImportIntelligence";
import { SUITE_ARRIVALS_SCHEMA, buildMaskedSample, detectSuiteArrivalsPreset, detectEzgoArrivalsPreset, applyFieldDefaultsToProfiles, parseMappingMemory, packMappingMemory } from "../utils/importMapper";
import {
  isDetailedReservationFormat,
  parseDetailedReservationRows,
  parseDetailedReservationCsvText,
  shouldParseDetailedReportAsText,
  detailedRowsToProfileMap,
  applyPriceResolutions,
  csvTextToRowObjects,
} from "../utils/detailedReservationParser";
import PriceDiscrepancyModal from "./PriceDiscrepancyModal";

// Sorted, joined header signature — matches import_mapping_memory.header_signature (migration 049).
// Not a hash: exact string equality is enough here and avoids a client-side hash dependency.
function _headerSignature(headers) {
  return [...headers].sort().join("␟");
}

// ── Date / phone helpers ──────────────────────────────────────────────────────

const DUMMY_DATE_RE = /^01[/.-]01[/.-](1900|1970|2001)/;

function _parseDate(raw) {
  if (!raw) return null;
  if (raw instanceof Date) return isNaN(raw.getTime()) ? null : raw.toISOString().slice(0, 10);
  const s = String(raw).trim();
  if (!s || DUMMY_DATE_RE.test(s)) return null;
  if (/^\d{4}[-/]\d{2}[-/]\d{2}/.test(s)) return s.slice(0, 10).replace(/\//g, "-");
  const dmy = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (dmy) {
    const [, d, m, y] = dmy;
    return `${y.length === 2 ? "20" + y : y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const serial = parseFloat(s);
  if (!isNaN(serial) && serial > 40000) {
    const dt = new Date(Math.round((serial - 25569) * 86_400_000));
    return isNaN(dt.getTime()) ? null : dt.toISOString().slice(0, 10);
  }
  return null;
}

function _addNights(arrival_date, nights) {
  if (!arrival_date || !nights) return null;
  const d = new Date(arrival_date);
  d.setDate(d.getDate() + parseInt(nights));
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function _sanitizeE164(raw) {
  if (!raw) return null;
  const c = String(raw).replace(/[^\d+]/g, "");
  if (!c) return null;
  if (c.startsWith("+")) return c.length >= 10 ? c : null;
  if (/^5\d{8}$/.test(c)) return `+972${c}`;
  if (/^05\d{8}$/.test(c)) return `+972${c.slice(1)}`;
  if (c.startsWith("972") && c.length >= 11) return `+${c}`;
  return c.length >= 9 ? c : null;
}

// ── Room dropdown options — SUITE_REGISTRY + exactly two day packages ───────
// Single source for every "assign a room" UI in the app (this panel + GuestsPage).
const ROOM_OPTIONS = [
  { value: "", label: "— ללא חדר —" },
  { value: "Premium Day 1", label: "⭐ חבילת פרימיום בילוי יומי 1" },
  { value: "Premium Day 2", label: "⭐ חבילת פרימיום בילוי יומי 2" },
  ...SUITE_REGISTRY.map(s => ({ value: s, label: s })),
];

// Best-effort match — delegates to suiteRegistry (number + suiteType brand).
function _bestGuessSuite(roomName, suiteType = "", isDayGuest = false) {
  return resolveSuiteFromEzgoFields(roomName, suiteType, isDayGuest);
}

/** Human-readable room label from parser fields — used for suite-assignment preview. */
function _roomLabelFromParts(roomName, suiteType) {
  const rn = String(roomName ?? "").trim();
  const st = String(suiteType ?? "").trim();
  if (st && rn && st.includes(rn)) return st;
  if (st && rn) return `${rn} ${st}`.trim();
  return st || rn;
}

/** Best display/sync value for room column — registry match when possible, else raw label. */
function _formatRoomForGrid(g) {
  const rooms = g.rooms ?? [];
  if (!rooms.length) return "";
  if (rooms.length > 1) {
    const labels = rooms
      .map((r) => {
        const guess = _bestGuessSuite(r.roomName, r.suiteType, r.isDayGuest);
        return guess || _roomLabelFromParts(r.roomName, r.suiteType);
      })
      .filter(Boolean);
    return labels.join(" · ");
  }
  const r0 = rooms[0];
  const isDay = !!g.isDayGuest || !!r0.isDayGuest;
  const guess = _bestGuessSuite(r0.roomName, r0.suiteType, isDay);
  if (guess) return guess;
  return _roomLabelFromParts(r0.roomName, r0.suiteType);
}

/** Canonical room for grid column + sync — staff edit in grid wins at sync time. */
function _resolveProfileRoomDisplay(g, editedRoom = "") {
  if (String(editedRoom ?? "").trim()) return String(editedRoom).trim();
  return _formatRoomForGrid(g);
}

function _gridRowId(g, i) {
  return `p${i}_${g.guestPhone || "nophone"}`;
}

function _hasSpaTime(row) {
  const v = row?.spa_time;
  return v != null && String(v).trim() !== "";
}

// ── Comprehensive Daily Report Parser (Doc 1) ─────────────────────────────────
// Produces: [{ order_number, guest_name, phone, arrival_date, spa_time, treatment_count }]

const _SOURCE_RE = /^(Hotel\s+WebSite|Booking\s+Collect|Booking\.com|Booking|Expedia|Hotels\.com)\s*-\s*/i;

const _SUITE_SPA_RE = /לאורחי הסוויטות|לשובר סוויטה|שובר סוויטה/i;
// Strict label for «ספא סוויטות בלבד» sync — only lines that explicitly say לאורחי הסוויטות
const _SUITE_GUEST_SPA_LABEL_RE = /לאורחי הסוויטות/;
const _GROUP_SPA_RE = /לקבוצות|קבוצות בלבד/i;

function _doc1ParseOpts(syncMode) {
  if (syncMode === "suite_spa_only") {
    return {
      suiteSpaOnly: true,
      strictSuiteLabel: true,
      dedupeBy: "order",
      spaRecordsOnly: true,
    };
  }
  return { suiteSpaOnly: false, dedupeBy: "phone" };
}

function _splitReportLines(raw) {
  return String(raw).split(/\r?\n|<BR\s*\/?>/gi);
}

function _extractExtras(block, raw, extractOpts = {}) {
  const { suiteSpaOnly = false, strictSuiteLabel = false } = extractOpts;
  const suiteLabelRe = strictSuiteLabel ? _SUITE_GUEST_SPA_LABEL_RE : _SUITE_SPA_RE;
  for (const line of _splitReportLines(raw)) {
    const clean = line.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
    if (!clean) continue;
    const m = clean.match(/^(\d+)\s*-\s*(\d{1,2}):(\d{2})/);
    if (!m) continue;
    if (_GROUP_SPA_RE.test(clean)) continue;
    if (suiteSpaOnly && !suiteLabelRe.test(clean)) continue;
    const count = parseInt(m[1]);
    const time  = m[2].padStart(2, "0") + ":" + m[3];
    block.treatment_count += count;
    if (!block.spa_time || time < block.spa_time) block.spa_time = time;
  }
}

// "EASYGO OPERATION FILE INGESTION" session — same comprehensive-report cell,
// looking for an explicit meal-time mention instead of the spa count-time
// shape _extractExtras matches. ⚠️ Not yet verified against a real EasyGo
// export (none was available to test against this session) — this matches
// the most likely Hebrew phrasings ("ארוחת ערב 19:30" / "ארוחה - 19:30" /
// "ארוחת בוקר: 08:00") so a real report's meal line is captured rather than
// silently dropped, but confirm against an actual file before fully trusting
// it; if the real format differs, only this regex needs adjusting — the
// meal_time/meal_location wiring below it is unaffected either way.
function _extractMealTime(block, raw) {
  for (const line of _splitReportLines(raw)) {
    const clean = line.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
    if (!clean) continue;
    // Skip spa appointment lines already consumed by _extractExtras ("N - HH:MM ...")
    if (/^\d+\s*-\s*\d{1,2}:\d{2}/.test(clean)) continue;

    let m = null;
    // 1. ארוחה keyword (original)
    m = clean.match(/ארוחה[ת]?\s*(?:ערב|בוקר|צהריים)?\s*[-:]?\s*(\d{1,2}):(\d{2})/);
    // 2. ערב / צהריים + מ- prefix (original)
    if (!m && /(?:ערב|א\.?\s*ערב|צהריים|א\.?\s*צהריים)/i.test(clean)) {
      m = clean.match(/מ-?\s*(\d{1,2}):(\d{2})/);
    }
    // 3. HB / Half Board keyword
    if (!m && /\b(?:HB|Half[\s-]?Board)\b/i.test(clean)) {
      m = clean.match(/(\d{1,2}):(\d{2})/);
    }
    // 4. Dinner keyword (English)
    if (!m && /\bDinner\b/i.test(clean)) {
      m = clean.match(/(\d{1,2}):(\d{2})/);
    }
    // 5. מסעדה (restaurant) keyword
    if (!m && /מסעדה/.test(clean)) {
      m = clean.match(/(\d{1,2}):(\d{2})/);
    }
    // 6. Evening time 18:00–21:30 with at least one meal-context word on the same line.
    //    Conservative: bare evening times without context are NOT captured to avoid
    //    false-positives from late check-ins or evening spa slots.
    if (!m && /(?:ארוחה|ארוחת|dinner|HB|מסעדה|board|פנסיון|שולחן)/i.test(clean)) {
      const eveM = clean.match(/\b(1[89]|2[01]):(\d{2})\b/);
      if (eveM) {
        const h = parseInt(eveM[1], 10);
        const min = parseInt(eveM[2], 10);
        if (!(h === 21 && min > 30)) m = eveM;
      }
    }

    if (!m) continue;
    const time = m[1].padStart(2, "0") + ":" + m[2];
    if (!block.meal_time || time < block.meal_time) block.meal_time = time;
  }
}

function _orderLineFromCell(c1) {
  const lines = String(c1).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  return lines.find(s => /^\d+:/.test(s)) ?? String(c1).trim();
}

function parseComprehensiveReport(rows, opts = {}) {
  const {
    suiteSpaOnly = false,
    strictSuiteLabel = false,
    dedupeBy = "phone",
    spaRecordsOnly = false,
  } = opts;
  const extractOpts = { suiteSpaOnly, strictSuiteLabel };
  let arrivalDate = null;
  let current     = null;
  const blocks    = [];

  for (const row of rows) {
    const [c0, c1, c2] = Array.isArray(row) ? row : [];

    if (!arrivalDate && typeof c0 === "number" && c0 > 40000) {
      arrivalDate = _parseDate(c0);
    }

    const orderLine = c1 && typeof c1 === "string" ? _orderLineFromCell(c1) : null;

    if (orderLine && /^\d+:/.test(orderLine)) {
      if (current) blocks.push(current);
      const orderMatch = orderLine.match(/^(\d+):/);
      const phoneMatch = orderLine.match(/\s+-\s+([+\d][\d\s\-+]{7,})\s*$/);
      const phone      = phoneMatch ? _sanitizeE164(phoneMatch[1]) : null;
      const afterId    = orderLine.replace(/^\d+:\s*/, "");
      const nameRaw    = phoneMatch
        ? afterId.slice(0, afterId.lastIndexOf(phoneMatch[0])).trim()
        : afterId.trim();
      current = {
        order_number:    orderMatch ? orderMatch[1] : null,
        guest_name:      nameRaw.replace(_SOURCE_RE, "").trim() || null,
        phone,
        arrival_date:    arrivalDate,
        spa_time:        null,
        treatment_count: 0,
        meal_time:       null,
        meal_location:   null,
      };
      if (c2) { _extractExtras(current, c2, extractOpts); _extractMealTime(current, c2); }
      continue;
    }
    if (!current) continue;
    if (c2) { _extractExtras(current, c2, extractOpts); _extractMealTime(current, c2); }
  }
  if (current) blocks.push(current);

  const _mergeBlock = (ex, b) => {
    ex.treatment_count += b.treatment_count;
    if (b.spa_time && (!ex.spa_time || b.spa_time < ex.spa_time)) ex.spa_time = b.spa_time;
    if (b.meal_time && (!ex.meal_time || b.meal_time < ex.meal_time)) ex.meal_time = b.meal_time;
    if (!ex.phone && b.phone) ex.phone = b.phone;
    if (!ex.guest_name && b.guest_name) ex.guest_name = b.guest_name;
  };

  if (dedupeBy === "order") {
    const byOrder = {};
    for (const b of blocks) {
      if (!b.order_number) continue;
      if (spaRecordsOnly && !b.spa_time) continue;
      if (!byOrder[b.order_number]) byOrder[b.order_number] = { ...b };
      else _mergeBlock(byOrder[b.order_number], b);
    }
    return Object.values(byOrder);
  }

  // Deduplicate by phone — accumulate treatment counts
  const byPhone = {};
  for (const b of blocks) {
    if (!b.phone) continue;
    if (spaRecordsOnly && !b.spa_time) continue;
    if (!byPhone[b.phone]) { byPhone[b.phone] = { ...b }; }
    else _mergeBlock(byPhone[b.phone], b);
  }
  return Object.values(byPhone);
}

// EZGO exports the comprehensive daily report as HTML (.htm) with nested tables:
// col0=order+phone, col1=extras/spa, col3=meals. Maps to parseComprehensiveReport
// pseudo-rows.

// DOM walk that converts <BR> tags to "\n" — guarantees correct line splitting
// regardless of whether DOMParser renders innerText for the document or not.
function _cellText(el) {
  if (!el) return "";
  let text = "";
  const walk = (node) => {
    if (node.nodeType === 3) {
      text += node.nodeValue || "";
    } else if (node.nodeName === "BR") {
      text += "\n";
    } else {
      for (const child of node.childNodes) walk(child);
    }
  };
  walk(el);
  return text.replace(/\u00a0/g, " ").trim();
}

function _extractArrivalDateFromHtml(htmlText) {
  const dmY = htmlText.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!dmY) return null;
  const [, d, m, y] = dmY;
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

function parseHtmlDailyReport(htmlText, opts = {}) {
  const doc = new DOMParser().parseFromString(htmlText, "text/html");
  // Tier 1: target <TH> header cells (e.g. "יום: ג<BR>30/06/2026") — precise.
  // Tier 2: fall back to raw-text regex for non-standard EasyGo variants.
  let arrivalDate = null;
  doc.querySelectorAll("th").forEach(th => {
    if (arrivalDate) return;
    const txt = _cellText(th);
    const m = txt.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) arrivalDate = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  });
  if (!arrivalDate) arrivalDate = _extractArrivalDateFromHtml(htmlText);
  const pseudoRows = [];
  // Per-phone board-basis defaults applied post-parse; explicit timed lines always win.
  const boardDefaults = new Map(); // E.164 phone → { meal_time, meal_location }

  doc.querySelectorAll("table table tbody tr").forEach(tr => {
    const tds = tr.querySelectorAll(":scope > td");
    // Require at least order-cell + extras-cell.
    // EasyGo HTML exports vary between 3-column (order|extras|board+meals) and
    // 4-column (order|extras|board|meals) layouts — do not hard-reject < 4.
    if (tds.length < 2) return;

    const orderRaw = _cellText(tds[0]);
    const extras   = _cellText(tds[1]); // TD 1 — תוספות / spa appointments
    // Defensive access: tolerate 3-column layouts where board and meals share TD 2.
    const board    = tds.length > 2 ? _cellText(tds[2]) : ""; // Board basis: HB/FB/BB/RO
    const meals    = tds.length > 3 ? _cellText(tds[3]) : ""; // ארוחות (may be absent)

    // Take only the first meaningful line from the order cell.
    const orderLine = orderRaw.split(/\r?\n/).map(s => s.trim()).find(s => /^\d+:/.test(s));
    if (!orderLine) return;

    // Board basis → strict Hebrew meal-plan label, meal_time always null.
    // NO time guessing — "19:00" defaults are forbidden (§3 strict meal rules).
    const bUpper = (board + " " + meals).trim().toUpperCase();
    let mealDefault = null;
    if (/\bFB\b/.test(bUpper)) {
      mealDefault = { meal_time: null, meal_location: "פנסיון מלא" };
    } else if (/\bHB\b/.test(bUpper)) {
      mealDefault = { meal_time: null, meal_location: "חצי פנסיון" };
    } else if (/\bBB\b/.test(bUpper)) {
      mealDefault = { meal_time: null, meal_location: "רק ארוחת בוקר" };
    }
    // RO or empty: mealDefault stays null — no meal fields set.
    if (mealDefault) {
      const pm   = orderLine.match(/\s+-\s+([+\d][\d\s\-+]{7,})\s*$/);
      const e164 = pm ? _sanitizeE164(pm[1]) : null;
      if (e164) boardDefaults.set(e164, mealDefault);
    }

    // Pass ONLY the extras (spa) column to parseComprehensiveReport.
    // Board/meals columns are handled entirely by the boardDefaults map above —
    // this prevents _extractMealTime from encountering HB/FB/BB keywords and
    // guessing a time from them (strict meal rules, §3).
    pseudoRows.push([null, orderLine, extras || null]);
  });

  const records = parseComprehensiveReport(pseudoRows, opts);
  if (arrivalDate) {
    for (const r of records) {
      if (!r.arrival_date) r.arrival_date = arrivalDate;
    }
  }

  // Apply board-basis meal plan label where not already set by an explicit timed line.
  // ONLY meal_location is written from board basis — meal_time is NEVER written here
  // (board basis codes carry no authoritative time, strict meal rules §3).
  for (const r of records) {
    const def = r.phone ? boardDefaults.get(r.phone) : null;
    if (def && !r.meal_location && def.meal_location) {
      r.meal_location = def.meal_location;
    }
  }

  return records;
}

function _buildDoc1Records(payload, syncMode) {
  if (!payload) return [];
  const opts = _doc1ParseOpts(syncMode);
  if (payload.kind === "html") {
    return parseHtmlDailyReport(payload.data, opts);
  }
  return parseComprehensiveReport(payload.data, opts);
}

// ── Profile Map cloner ────────────────────────────────────────────────────────

function _cloneProfileMap(map) {
  const clone = new Map();
  for (const [k, v] of map) {
    clone.set(k, { ...v, rooms: [...v.rooms], orderNumbers: new Set(v.orderNumbers) });
  }
  return clone;
}

function _todayISO() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

// ── Auto arrival-date detection — two-tier, pure functions ────────────────────
// These only PRE-FILL the picker; the picker remains editable and staff
// confirmation via a FAIL VISIBLE banner is required before any sync runs.

// Tier 1: filename pattern DD.MM.YY[YY] — e.g. "30.6.26.xlsx" → "2026-06-30"
function _detectDateFromFilename(filename) {
  if (!filename) return null;
  const m = filename.match(/(\d{1,2})[.\-_](\d{1,2})[.\-_](\d{2,4})/);
  if (!m) return null;
  const day   = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const yRaw  = parseInt(m[3], 10);
  const year  = m[3].length === 2 ? 2000 + yRaw : yRaw;
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  if (year < 2024 || year > 2030) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// Tier 2: first 3 cells of first data row — e.g. cell value "2026-06-30"
// or an Excel date serial > 40000. Validates via _parseDate + sanity range.
function _detectDateFromFirstCells(firstRow) {
  if (!firstRow) return null;
  for (const v of Object.values(firstRow).slice(0, 3)) {
    if (v === null || v === undefined || v === "") continue;
    const s = String(v).trim();
    if (!s || !/^\d/.test(s)) continue; // must start with a digit to be date-like
    const parsed = _parseDate(v);
    if (!parsed) continue;
    // Sanity: within −30 to +730 days (allow up to 2 years future for pre-imports)
    const diffDays = (new Date(parsed).getTime() - Date.now()) / 86400000;
    if (diffDays >= -30 && diffDays <= 730) return parsed;
  }
  return null;
}

// ── Shift-schedule Excel parser (ported from DataHub) ────────────────────────
async function parseShiftFile(arrayBuf) {
  const XLSX = await import("xlsx");
  const wb   = XLSX.read(arrayBuf, { type: "array", cellDates: true });
  const ws   = wb.Sheets[wb.SheetNames[0]];
  const raw  = XLSX.utils.sheet_to_json(ws, { defval: "" });
  return raw.map(row => ({ _id: crypto.randomUUID(), ...row }));
}

// ── Guest Import Intelligence — adapters ────────────────────────────────────
// Convert an already-aggregated profile (aggregateGuestProfiles/
// detailedRowsToProfileMap output, post profilesToArray()) back into the
// per-row shape mergeCandidates() expects for its "arrivals"/"detailed"
// inputs. Since Sprint 3, the resulting candidates (mergedCandidates, below in
// the component) are the source of truth handleSync() reads for identity/meal/
// spa/lead-source/automation fields — not display-only anymore.
function _profileToArrivalsInput(g) {
  const room = (g.rooms ?? [])[0] ?? {};
  return {
    orderNumber:  [...(g.orderNumbers ?? [])][0] ?? "",
    resLineId:    room.resLineId ?? "",
    roomName:     room.roomName ?? "",
    suiteType:    room.suiteType ?? "",
    guestName:    g.guestName ?? null,
    guestPhone:   g.guestPhone ?? null,
    coordPhone:   g.coordPhone ?? null,
    phoneSource:  g.phoneSource ?? null,
    arrivalDate:  g.arrivalDate ?? null,
    price:        (g.rooms ?? []).reduce((sum, r) => sum + (r.price || 0), 0),
    nights:       room.nights ?? 0,
    roomsCount:   g.roomsQuantity ?? (g.rooms ?? []).length ?? 1,
    isDayGuest:   !!g.isDayGuest,
    leadSource:   g.leadSource ?? null,
    automationMuted: !!g.automationMuted,
    mealTime:     g.meal_time ?? null,
  };
}

function _profileToDetailedInput(g) {
  const room = (g.rooms ?? [])[0] ?? {};
  return {
    orderNumber:  [...(g.orderNumbers ?? [])][0] ?? "",
    resLineId:    room.resLineId ?? "",
    guestName:    g.guestName ?? null,
    guestPhone:   g.guestPhone ?? null,
    arrivalDate:  g.arrivalDate ?? null,
    price:        (g.rooms ?? []).reduce((sum, r) => sum + (r.price || 0), 0),
    nights:       room.nights ?? 0,
    rooms_count:  g.roomsQuantity ?? (g.rooms ?? []).length ?? 0,
    meal_location: g.meal_location ?? null,
    leadSource:   g.leadSource ?? null,
    automationMuted: !!g.automationMuted,
    isDayGuest:   !!g.isDayGuest,
  };
}

const UMBRELLA_BADGE_LABEL = "⛔ מטריית קבוצה";
const SUSPICIOUS_NAME_BADGE_LABEL = "⚠ שם חשוד";

const DB_MATCH_BADGE_LABEL = {
  unimportable: UMBRELLA_BADGE_LABEL,
  new:      "🆕 חדש",
  existing: "🔄 קיים",
  conflict: "⚠ התנגשות",
};

// FAIL VISIBLE (§0.3) safety net — a mis-split CSV row (quote/comma bleed
// from a free-text field like sRemark) can still leak raw CSV fragments into
// guestName even after csvTextToRowObjects + extractNameFromRemark's own
// cleanup (see ezgoParser.js). Never silently accept a garbled name — flag
// the row so staff catches it before syncing instead of writing junk to
// guests.name.
export function _isSuspiciousGuestName(name) {
  const s = String(name ?? "");
  if (!s) return false;
  return (
    s.includes('","')
    || s.length > 120
    || /₪/.test(s)
    || /,\s*,/.test(s)
    || /\d+\s*בחדר/.test(s)
    || /\s+תשלום\b/.test(s)
  );
}

// ── Guest Import Intelligence — Sprint 3: DB-match lookup ──────────────────
// Looks up a candidate's existing `guests` row from the pre-fetched Map (keyed
// phone+arrival_date, and order_number+arrival_date as a fallback join — see
// the prefetch effect below). Scoped by arrival_date on both keys so a repeat
// guest's PRIOR stay never masquerades as "existing" for a new one — `guests`
// has no global phone uniqueness (migration 046's key is phone+arrival_date+
// guest_index), so an unscoped phone-only Map would false-positive on returning guests.
function _findExistingGuestRow(map, candidate) {
  if (!candidate || !map?.size) return null;
  if (candidate.guestPhone && candidate.arrivalDate) {
    const row = map.get(`${candidate.guestPhone}::${candidate.arrivalDate}`);
    if (row) return row;
  }
  if (candidate.orderNumber && candidate.arrivalDate) {
    const row = map.get(`order:${candidate.orderNumber}::${candidate.arrivalDate}`);
    if (row) return row;
  }
  return null;
}

// ── Suite-CSV profiles → flat grid rows ──────────────────────────────────────
// One row per guest profile. Multi-room (group) profiles show a read-only
// "N rooms" count instead of a single editable room — picking a value there
// still works and applies uniformly to that profile's rooms on sync.
function _profilesToGridRows(merged, { suiteAssignmentOnly = false, badgeByIdx = null } = {}) {
  return merged.map((g, i) => {
    const singleRoom = (g.rooms ?? []).length === 1 ? g.rooms[0] : null;
    const isDay       = !!g.isDayGuest || !!singleRoom?.isDayGuest;
    const roomDisplay = _formatRoomForGrid(g);
    // Financial mapping:
    const totalPrice  = (g.rooms ?? []).reduce((sum, r) => sum + (r.price || 0), 0);
    const qtyLabel    = (g.roomsQuantity ?? 0) > 1
      ? `${g.roomsQuantity} חדרים`
      : (g.rooms ?? []).length > 1 ? `${g.rooms.length} חדרים` : "";
    return {
      _id:          _gridRowId(g, i),
      _profileIdx:  i,
      guestName:    g.guestName ?? "",
      guestPhone:   g.guestPhone ?? "",
      orderNumber:  [...(g.orderNumbers ?? [])][0] ?? "",
      phoneSource:  g.phoneSource === "individual" ? "פרטי" : "קואורד׳",
      leadSource:   g.leadSource ?? "",
      automationMuted: g.automationMuted ? "🔇 ללא אוטומציה" : "",
      roomCount:    qtyLabel,
      room:         suiteAssignmentOnly
        ? roomDisplay
        : ((g.rooms ?? []).length > 1 ? "" : roomDisplay),
      tier:         isDay ? "☀️ בילוי יומי" : "🏨 סוויטה",
      spa_time:     g.spa_time ?? "",
      meal_time:    g.meal_time ?? "",
      meal_location: g.meal_location ?? "",
      amount:       totalPrice || "",
      arrivalDate:  g.arrivalDate ?? "",
      importBadge:  _composeImportBadge(g.guestName, badgeByIdx?.get(i)),
    };
  });
}

// Suspicious-name flag always wins visibility (data-quality issue takes
// priority over a DB-match status) — both are shown together when present so
// neither is hidden.
function _composeImportBadge(guestName, dbBadge) {
  const parts = [];
  if (_isSuspiciousGuestName(guestName)) parts.push(SUSPICIOUS_NAME_BADGE_LABEL);
  if (dbBadge) parts.push(dbBadge);
  return parts.join(" · ");
}

function _detailedProfilesToGridRows(merged, badgeByIdx = null) {
  return merged.map((g, i) => {
    const totalPrice = (g.rooms ?? []).reduce((sum, r) => sum + (r.price || 0), 0);
    const nights = (g.rooms ?? []).reduce((mx, r) => Math.max(mx, r.nights || 0), 0);
    const orderNumber = [...(g.orderNumbers ?? [])][0] ?? "";
    return {
      _id:          _gridRowId(g, i),
      _profileIdx:  i,
      guestName:    g.guestName ?? "",
      guestPhone:   g.guestPhone ?? "",
      orderNumber,
      arrivalDate:  g.arrivalDate ?? "",
      amount:       totalPrice || "",
      meal_location: g.meal_location ?? "",
      rooms_count:  g.roomsQuantity ?? 0,
      nights:       nights || "",
      leadSource:   g.leadSource ?? "",
      automationMuted: g.automationMuted ? "🔇 ללא אוטומציה" : "",
      importBadge:  badgeByIdx?.get(i) ?? "",
    };
  });
}

function _hasAssignedRoomsCount(val) {
  const n = Number(val);
  return Number.isFinite(n) && n > 0;
}

function _profileHasRooms(g) {
  return (g.roomsQuantity ?? 0) > 0;
}

function _resolveDetailedProfileType(g, filterMode) {
  if (filterMode === "suite") return "suite";
  if (filterMode === "day_use") return "day_use";
  return _profileHasRooms(g) ? "suite" : "day_use";
}

// Sprint 3: dbMatchByIdx (Map<profileIdx, "new"|"existing"|"conflict"|"unimportable">,
// from classifyDbMatch — see the mergedCandidates/dbMatchByIdx memos above in the
// component) gates which rows actually reach the RPC. "unimportable" rows (umbrella/
// corporate group bookings, or rows with neither phone nor name) are Disable-Don't-
// Hide (§0.2): they stay visible in the grid with their badge, they just never sync.
// "conflict" rows (phone/order matches an existing guest but name/room/date differs)
// are NOT skipped — they sync like any other match, but the caller surfaces the
// conflict count so staff can review after the fact (FAIL VISIBLE, §0.3).
export function _getSyncProfileIndices(merged, gridRows, { importSource, detailedRoomFilter, selectedIds, dbMatchByIdx }) {
  const gridByIdx = new Map(gridRows.map((r) => [r._profileIdx, r]));
  const indices = [];
  const conflicts = [];
  let skippedUnimportable = 0;
  for (let i = 0; i < merged.length; i++) {
    const g = merged[i];
    const row = gridByIdx.get(i);
    const rowId = row?._id ?? `row_${i}`;
    if (selectedIds.size > 0 && !selectedIds.has(rowId)) continue;
    if (importSource === "detailed") {
      const hasRooms = _profileHasRooms(g);
      if (detailedRoomFilter === "suite" && !hasRooms) continue;
      if (detailedRoomFilter === "day_use" && hasRooms) continue;
    }
    if (!g.guestPhone) continue;
    const dbStatus = dbMatchByIdx?.get(i) ?? null;
    if (dbStatus === "unimportable") { skippedUnimportable++; continue; }
    if (dbStatus === "conflict") conflicts.push(i);
    indices.push(i);
  }
  return { indices, conflicts, skippedUnimportable };
}

/** Targeted room-only sync — match existing guests by order_number or name. */
async function _executeSuiteAssignmentOnlySync(supabase, {
  merged,
  gridRows,
  syncIndices,
  arrivalDate,
}) {
  const gridByProfileIdx = new Map(gridRows.map((r) => [r._profileIdx, r]));
  let updated = 0;
  let skipped = 0;
  const notFound = [];
  const ambiguous = [];
  const noRoom = [];

  for (const i of syncIndices) {
    const g = merged[i];
    const edited = gridByProfileIdx.get(i) ?? {};
    const room = String(edited.room ?? "").trim();
    const guestName = String(edited.guestName ?? g.guestName ?? "").trim();
    const orderNumber = String(
      edited.orderNumber ?? [...(g.orderNumbers ?? [])][0] ?? "",
    ).trim();
    const profileArrival = g.arrivalDate ?? arrivalDate ?? null;

    if (!room) {
      skipped++;
      noRoom.push(orderNumber || guestName || `שורה ${i + 1}`);
      continue;
    }

    if (!orderNumber && !guestName) {
      skipped++;
      notFound.push(`שורה ${i + 1}`);
      continue;
    }

    let guestRow = null;

    if (orderNumber) {
      let q = supabase
        .from("guests")
        .select("id, name, order_number, room")
        .eq("order_number", orderNumber);
      if (profileArrival) q = q.eq("arrival_date", profileArrival);
      const { data, error } = await q.maybeSingle();
      if (error) throw new Error(error.message);
      guestRow = data;
    }

    if (!guestRow && guestName) {
      let q = supabase
        .from("guests")
        .select("id, name, order_number, room")
        .eq("name", guestName);
      if (profileArrival) q = q.eq("arrival_date", profileArrival);
      const { data, error } = await q.limit(2);
      if (error) throw new Error(error.message);
      if (data?.length === 1) guestRow = data[0];
      else if ((data?.length ?? 0) > 1) {
        skipped++;
        ambiguous.push(guestName);
        continue;
      }
    }

    if (!guestRow) {
      skipped++;
      notFound.push(orderNumber || guestName);
      continue;
    }

    if (guestRow.room === room) {
      skipped++;
      continue;
    }

    const { error: updErr } = await supabase
      .from("guests")
      .update({ room })
      .eq("id", guestRow.id);
    if (updErr) throw new Error(updErr.message);
    updated++;
  }

  return {
    updated,
    skipped,
    notFound: [...new Set(notFound)],
    ambiguous: [...new Set(ambiguous)],
    noRoom: [...new Set(noRoom)],
    total: syncIndices.length,
    arrivalDate,
  };
}

const DETAILED_GRID_COLS = [
  { id: "guestName",     label: "שם אורח",      editable: true,  w: 150 },
  { id: "guestPhone",    label: "טלפון",         editable: false, w: 120 },
  { id: "orderNumber",   label: "מספר הזמנה",    editable: false, w: 100 },
  { id: "arrivalDate",   label: "הגעה",          editable: false, w: 100 },
  { id: "amount",        label: "💰 סכום (₪)",   editable: true,  w: 100 },
  { id: "meal_location", label: "בסיס אירוח",    editable: false, w: 180 },
  { id: "rooms_count",   label: "מספר חדרים",    editable: false, w: 90  },
  { id: "nights",        label: "מספר לילות",    editable: false, w: 90  },
  { id: "leadSource",    label: "מקור הגעה",     editable: false, w: 120 },
  { id: "automationMuted", label: "אוטומציה",    editable: false, w: 95  },
  { id: "importBadge",  label: "סטטוס ייבוא",   editable: false, w: 130 },
];

const SUITES_GRID_COLS = [
  { id: "guestName",   label: "שם אורח",   editable: true,  w: 150 },
  { id: "guestPhone",  label: "טלפון",      editable: false, w: 120 },
  { id: "orderNumber", label: "מס׳ הזמנה",  editable: false, w: 100 },
  { id: "phoneSource", label: "מקור",       editable: false, w: 80  },
  { id: "leadSource",  label: "מקור הגעה",  editable: false, w: 100 },
  { id: "automationMuted", label: "אוטומציה", editable: false, w: 95 },
  { id: "roomCount",   label: "קבוצה",      editable: false, w: 70  },
  { id: "tier",        label: "שכבה",       editable: false, w: 90  },
  { id: "room",        label: "🏨 חדר/סוויטה", editable: true, w: 190, gold: true, options: ROOM_OPTIONS },
  { id: "spa_time",    label: "שעת ספא",    editable: true,  w: 90  },
  { id: "meal_time",   label: "שעת ארוחה (ערמונים)", editable: true, w: 130 },
  { id: "meal_location", label: "בסיס אירוח", editable: false, w: 160 },
  { id: "amount",      label: "💰 סכום (₪)", editable: true, w: 100 },
  { id: "arrivalDate", label: "הגעה",       editable: false, w: 100 },
  { id: "importBadge", label: "סטטוס ייבוא", editable: false, w: 130 },
];

/** Focused preview columns for Doc 2 suite-assignment-only mode */
const SUITE_ASSIGNMENT_GRID_COLS = [
  { id: "guestName",   label: "שם אורח",       editable: true,  w: 180 },
  { id: "orderNumber", label: "מס׳ הזמנה",     editable: false, w: 110 },
  { id: "room",        label: "🏨 חדר/סוויטה", editable: true,  w: 220, gold: true },
  { id: "guestPhone",  label: "טלפון",         editable: false, w: 120 },
];

// ── DropZone ─────────────────────────────────────────────────────────────────

function DropZone({ label, hint, loaded, fileName, onFile, inputRef, optional, accept = ".xlsx,.xls,.csv" }) {
  const [dragging, setDragging] = useState(false);
  return (
    <div
      onDragOver={e  => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={e => { e.preventDefault(); setDragging(false); onFile(e.dataTransfer.files?.[0]); }}
      onClick={() => inputRef.current?.click()}
      style={{
        border: `2px dashed ${loaded ? "var(--gold)" : dragging ? "var(--gold-dark)" : "var(--border)"}`,
        background: loaded ? "rgba(201,169,110,0.07)" : dragging ? "rgba(201,169,110,0.1)" : "var(--ivory)",
        borderRadius: 14, padding: "18px 12px", textAlign: "center",
        cursor: "pointer", transition: "all 0.18s", position: "relative",
      }}
    >
      {optional && !loaded && (
        <span style={{
          position: "absolute", top: 7, left: 9, fontSize: 9, fontWeight: 700,
          background: "var(--border)", color: "var(--text-muted)",
          padding: "1px 6px", borderRadius: 6,
        }}>אופציונלי</span>
      )}
      <input ref={inputRef} type="file" accept={accept} style={{ display: "none" }}
        onChange={e => e.target.files?.[0] && onFile(e.target.files[0])} />
      <div style={{ fontSize: 24, marginBottom: 5 }}>{loaded ? "✅" : "📂"}</div>
      <div style={{ fontSize: 12, fontWeight: 700,
        color: loaded ? "var(--gold-dark)" : "var(--black)", marginBottom: 3 }}>
        {label}
      </div>
      {fileName
        ? <div style={{ fontSize: 10, color: "var(--text-muted)", wordBreak: "break-all" }}>{fileName}</div>
        : <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{hint}</div>
      }
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ArrivalImportPanel({ defaultOpen = false } = {}) {
  const [open,     setOpen]     = useState(defaultOpen);
  const [tab,      setTab]      = useState("suites"); // "suites" | "shifts"

  // Suites profile state
  const [doc2Map,  setDoc2Map]  = useState(null);   // Map<key, profile> from Suite CSV
  const [doc1Rec,  setDoc1Rec]  = useState(null);   // [] from Daily Report Excel
  const [doc1SyncMode, setDoc1SyncMode] = useState("suite_spa_only"); // "full" | "suite_spa_only"
  const [doc2SyncMode, setDoc2SyncMode] = useState("full"); // "full" | "suite_assignment_only"
  const [rawDoc1Payload, setRawDoc1Payload] = useState(null); // { kind, data } for re-parse on mode change
  const [doc2Name, setDoc2Name] = useState("");
  const [doc1Name, setDoc1Name] = useState("");
  // Deterministic arrival date — staff sets this BEFORE dropping Doc 2; its
  // value at upload time becomes every profile's arrival date (no filename
  // or in-file date column is auto-parsed anymore).
  const [arrivalDate, setArrivalDate] = useState(_todayISO());
  const [merged,   setMerged]   = useState(null);   // enriched profiles array (doc2 + doc1 join)
  const [gridRows, setGridRows] = useState([]);      // editable grid rows derived from merged
  const [showOnlyWithSpa, setShowOnlyWithSpa] = useState(true); // default: spa-actionable rows only
  const [detailedRoomFilter, setDetailedRoomFilter] = useState("all"); // "all" | "suite" | "day_use"
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [syncing,  setSyncing]  = useState(false);
  const [result,   setResult]   = useState(null);
  const [toast,    setToast]    = useState(null);
  const doc2Ref = useRef();
  const doc1Ref = useRef();

  // Resilient Import Agent — mapping review state (Doc 2 / Suite CSV only)
  const [mappingStage, setMappingStage] = useState("idle"); // "idle" | "suggesting" | "review"
  const [rawDoc2Rows,  setRawDoc2Rows]  = useState(null);   // parsed SheetJS rows, kept for re-processing after approval
  const [doc2Fallback, setDoc2Fallback] = useState(null);   // arrivalDate picker snapshot, captured at upload time
  const [aiSuggestion, setAiSuggestion] = useState(null);   // { mapping, defaults, recommendations, confidence, engine } | null
  const [aiError,      setAiError]      = useState(null);   // string | null — shown, never hidden, when the AI call failed
  const [autoDateBanner, setAutoDateBanner] = useState(null); // { date, source } | null — FAIL VISIBLE auto-detect notice

  // Shifts profile state
  const [shiftRows,    setShiftRows]    = useState([]);
  const [shiftCols,    setShiftCols]    = useState([]);
  const [shiftSelected, setShiftSelected] = useState(new Set());
  const [shiftFileName, setShiftFileName] = useState("");
  const shiftRef = useRef();

  // Detailed reservation report — dedicated import path (no AI mapping)
  const detailedRef = useRef();
  const [importSource, setImportSource] = useState(null); // null | "detailed"
  const [detailedFileName, setDetailedFileName] = useState("");
  const [pendingDetailedRows, setPendingDetailedRows] = useState(null);
  const [priceConflictQueue, setPriceConflictQueue] = useState(null);
  const [priceConflictIdx, setPriceConflictIdx] = useState(0);
  const [priceResolutions, setPriceResolutions] = useState({});

  const showToast = (type, msg) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 4500);
  };

  const _loadDetailedProfiles = useCallback((parsedRows, resolutions) => {
    const resolved = applyPriceResolutions(parsedRows, resolutions);
    resolved.forEach((r) => {
      if (r.priceConflict) {
        r.price = r.price ?? 0;
      }
    });
    const map = detailedRowsToProfileMap(resolved);
    if (!map.size) {
      showToast("err", "לא נמצאו שורות תקפות בדוח");
      return false;
    }
    setDoc2Map(map);
    setImportSource("detailed");
    setMappingStage("idle");
    setRawDoc2Rows(null);
    setAiSuggestion(null);
    setAiError(null);
    setPendingDetailedRows(null);
    setPriceConflictQueue(null);
    setPriceConflictIdx(0);
    setPriceResolutions({});
    const firstDate = resolved.find((r) => r.arrivalDate)?.arrivalDate;
    if (firstDate) {
      setArrivalDate(firstDate);
      setAutoDateBanner({ date: firstDate, source: "דוח הזמנות מפורט (שורה ראשונה)" });
    }
    showToast("ok", `נטענו ${map.size} הזמנות מדוח מפורט — אמת בטבלה לפני סנכרון`);
    return true;
  }, []);

  const handlePriceConflictChoice = useCallback((choice) => {
    if (!priceConflictQueue?.length || !pendingDetailedRows) return;
    const conflict = priceConflictQueue[priceConflictIdx];
    const nextResolutions = { ...priceResolutions, [conflict.rowIndex]: choice };
    const nextIdx = priceConflictIdx + 1;
    if (nextIdx < priceConflictQueue.length) {
      setPriceResolutions(nextResolutions);
      setPriceConflictIdx(nextIdx);
      return;
    }
    _loadDetailedProfiles(pendingDetailedRows, nextResolutions);
  }, [priceConflictQueue, priceConflictIdx, pendingDetailedRows, priceResolutions, _loadDetailedProfiles]);

  const handlePriceConflictCancel = useCallback(() => {
    setPendingDetailedRows(null);
    setPriceConflictQueue(null);
    setPriceConflictIdx(0);
    setPriceResolutions({});
    setDetailedFileName("");
  }, []);

  const handleDetailedReservation = useCallback(async (file) => {
    if (!file) return;
    setDetailedFileName(file.name);
    setDoc2Name("");
    setResult(null);
    setMappingStage("idle");
    setRawDoc2Rows(null);
    setImportSource(null);
    try {
      const buf = await file.arrayBuffer();
      const headText = new TextDecoder("utf-8").decode(buf.slice(0, 512));
      const useCsvText = shouldParseDetailedReportAsText(file.name, headText);

      if (useCsvText) {
        const text = new TextDecoder("utf-8").decode(buf);
        const { rows, priceConflicts } = parseDetailedReservationCsvText(text);
        if (!rows.length) {
          showToast("err", "לא נמצאו שורות תקפות בדוח — בדוק פורמט CSV");
          return;
        }
        if (priceConflicts.length > 0) {
          setPendingDetailedRows(rows);
          setPriceConflictQueue(priceConflicts);
          setPriceConflictIdx(0);
          setPriceResolutions({});
          return;
        }
        _loadDetailedProfiles(rows, {});
        return;
      }

      const XLSX = await import("xlsx");
      const wb = XLSX.read(buf, { type: "array", raw: false });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

      if (!rawRows.length) {
        showToast("err", "הקובץ ריק");
        return;
      }

      const headers = rawRows[0].map((h) => String(h ?? "").trim());
      if (!isDetailedReservationFormat(headers)) {
        showToast("err", "קובץ לא מזוהה כדוח הזמנות מפורט — בדוק כותרות עמודות");
        return;
      }

      const { rows, priceConflicts } = parseDetailedReservationRows(rawRows);
      if (!rows.length) {
        showToast("err", "לא נמצאו שורות נתונים בדוח");
        return;
      }

      if (priceConflicts.length > 0) {
        setPendingDetailedRows(rows);
        setPriceConflictQueue(priceConflicts);
        setPriceConflictIdx(0);
        setPriceResolutions({});
        return;
      }

      _loadDetailedProfiles(rows, {});
    } catch (err) {
      showToast("err", "שגיאה בקריאת דוח מפורט: " + err.message);
    }
  }, [_loadDetailedProfiles]);

  // Derived flags
  const hasDoc2 = !!doc2Map;
  const hasDoc1 = !!(doc1Rec && doc1Rec.length > 0);
  const canSync = hasDoc2 || hasDoc1;

  // Recompute Doc 1 records when sync mode or uploaded payload changes
  useEffect(() => {
    if (!rawDoc1Payload) {
      setDoc1Rec(null);
      return;
    }
    const records = _buildDoc1Records(rawDoc1Payload, doc1SyncMode);
    if (!records.length) {
      setDoc1Rec(null);
      return;
    }
    setDoc1Rec(records);
    const detectedDate = records.find((r) => r.arrival_date)?.arrival_date;
    if (detectedDate) {
      setArrivalDate((prev) => prev || detectedDate);
    }
  }, [rawDoc1Payload, doc1SyncMode]);

  // Suite-assignment-only applies to standard Doc 2 grid (has room column), not detailed report
  useEffect(() => {
    if (importSource === "detailed" && doc2SyncMode === "suite_assignment_only") {
      setDoc2SyncMode("full");
    }
  }, [importSource, doc2SyncMode]);

  // Suite-only mode: show all parsed rows (spa filter would hide room-assignment imports)
  useEffect(() => {
    if (doc2SyncMode === "suite_assignment_only" && importSource !== "detailed") {
      setShowOnlyWithSpa(false);
    }
  }, [doc2SyncMode, importSource, merged]);

  // Recompute merged whenever Suite CSV or Daily Report changes
  useEffect(() => {
    if (!doc2Map) { setMerged(null); return; }
    const mapCopy = _cloneProfileMap(doc2Map);
    if (doc1Rec && doc1Rec.length > 0) {
      enrichProfilesFromExcel(mapCopy, doc1Rec);
    }
    setMerged(profilesToArray(mapCopy));
  }, [doc2Map, doc1Rec]);

  // ── Guest Import Intelligence — Sprint 3: wired into the real sync path ───
  // mergeCandidates() output is now the source of truth handleSync() reads for
  // guestPhone/guestName/meal/spa/leadSource/automationMuted (see the profiles/
  // rooms builders + post-RPC patch loop below) — not just a display-only
  // classification layer anymore (that was Sprint 2). Index i lines up 1:1
  // with `merged`/gridRows._profileIdx because both adapter arrays are built
  // by mapping `merged` in the same order, and mergeCandidates() pushes
  // exactly one candidate per arrivals/detailed input row (see
  // guestImportIntelligence.js's per-loop push order).
  const mergedCandidates = useMemo(() => {
    if (!merged || !merged.length) return [];
    return importSource === "detailed"
      ? mergeCandidates({ detailed: merged.map(_profileToDetailedInput), ops: doc1Rec ?? [] })
      : mergeCandidates({ arrivals: merged.map(_profileToArrivalsInput), ops: doc1Rec ?? [] });
  }, [merged, doc1Rec, importSource]);

  // ── Sprint 3: DB prefetch for classifyDbMatch (new/existing/conflict) ──────
  // Batch-fetches every `guests` row for the arrival date(s) present in this
  // session's candidates — one query, not one per row. Keyed by phone+date AND
  // order_number+date (see _findExistingGuestRow) so classifyDbMatch can
  // resolve either join without a second round-trip.
  const [existingGuestsMap, setExistingGuestsMap] = useState(new Map());

  useEffect(() => {
    let cancelled = false;
    if (!supabase || !mergedCandidates.length) {
      setExistingGuestsMap(new Map());
      return;
    }
    const dates = [...new Set(mergedCandidates.map((c) => c.arrivalDate).filter(Boolean))];
    if (!dates.length) {
      setExistingGuestsMap(new Map());
      return;
    }
    (async () => {
      const { data, error } = await supabase
        .from("guests")
        .select("id, phone, name, room, order_number, arrival_date")
        .in("arrival_date", dates);
      if (cancelled) return;
      if (error) {
        console.warn("[ArrivalImportPanel] existing-guest prefetch failed:", error.message);
        setExistingGuestsMap(new Map());
        return;
      }
      const map = new Map();
      (data ?? []).forEach((row) => {
        if (row.phone) map.set(`${row.phone}::${row.arrival_date}`, row);
        if (row.order_number) map.set(`order:${row.order_number}::${row.arrival_date}`, row);
      });
      setExistingGuestsMap(map);
    })();
    return () => { cancelled = true; };
  }, [mergedCandidates]);

  const dbMatchByIdx = useMemo(() => {
    const map = new Map();
    mergedCandidates.forEach((c, i) => {
      map.set(i, classifyDbMatch(c, _findExistingGuestRow(existingGuestsMap, c)));
    });
    return map;
  }, [mergedCandidates, existingGuestsMap]);

  const importBadgeByIdx = useMemo(() => {
    const map = new Map();
    dbMatchByIdx.forEach((status, i) => {
      const label = DB_MATCH_BADGE_LABEL[status];
      if (label) map.set(i, label);
    });
    return map;
  }, [dbMatchByIdx]);

  // Recompute grid rows whenever merged changes (fresh parse — discards manual edits)
  useEffect(() => {
    if (!merged) { setGridRows([]); return; }
    const suiteOnly = doc2SyncMode === "suite_assignment_only" && importSource !== "detailed";
    setGridRows(
      importSource === "detailed"
        ? _detailedProfilesToGridRows(merged, importBadgeByIdx)
        : _profilesToGridRows(merged, { suiteAssignmentOnly: suiteOnly, badgeByIdx: importBadgeByIdx }),
    );
  }, [merged, importSource, doc2SyncMode, importBadgeByIdx]);

  // ── Parse Doc 2: Suite CSV → AI-suggested column mapping → review screen ──
  // The AI only proposes; aggregateGuestProfiles() runs unchanged once the
  // admin approves a mapping in MappingReviewPanel (see handleMappingApprove).
  const handleDoc2 = useCallback(async (file) => {
    if (!file) return;
    setImportSource(null);
    setDetailedFileName("");
    setDoc2Name(file.name);
    setResult(null);
    try {
      const buf = await file.arrayBuffer();
      // .csv → quote-aware text parser (not SheetJS's own CSV auto-parse): a
      // free-text field like EZGO's sRemark can contain an unescaped comma or
      // quote, which makes SheetJS mis-split the row and bleed raw CSV
      // fragments (e.g. `","6","11"...,"עיריית תל אביב"`) into guestName.
      // parseCsvText/csvTextToRowObjects handle RFC4180 quoting properly —
      // see detailedReservationParser.js (already used for the "detailed
      // reservation report" import mode for the same reason).
      const isCsv = /\.csv$/i.test(file.name);
      let rows;
      if (isCsv) {
        const text = new TextDecoder("utf-8").decode(buf);
        rows = csvTextToRowObjects(text);
      } else {
        const XLSX = await import("xlsx");
        const wb   = XLSX.read(buf, { type: "array", raw: false });
        const ws   = wb.Sheets[wb.SheetNames[0]];
        rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
      }

      if (!rows.length) {
        showToast("err", "הקובץ ריק");
        return;
      }

      const headers = Object.keys(rows[0]);
      setRawDoc2Rows(rows);

      if (isDetailedReservationFormat(headers)) {
        showToast("err", "זהו דוח הזמנות מפורט — השתמש בכפתור «ייבוא דוח הזמנות מפורט» למטה");
        setMappingStage("idle");
        setRawDoc2Rows(null);
        setDoc2Name("");
        return;
      }

      // Auto-detect arrival date: filename (Tier 1) then first cells (Tier 2).
      // If found, pre-fill the picker AND show a FAIL VISIBLE banner so staff
      // can verify before syncing — the picker remains fully editable.
      const detectedByName    = _detectDateFromFilename(file.name);
      const detectedByContent = detectedByName ? null : _detectDateFromFirstCells(rows[0]);
      const detectedDate      = detectedByName || detectedByContent;
      if (detectedDate) {
        setArrivalDate(detectedDate);
        setAutoDateBanner({ date: detectedDate, source: detectedByName ? "שם הקובץ" : "תוכן הקובץ" });
      } else {
        setAutoDateBanner(null); // clear banner on re-upload without detection
      }
      // Snapshot for handleMappingApprove: use detected date if available,
      // else whatever the picker currently holds.
      setDoc2Fallback(detectedDate || arrivalDate || _todayISO());
      setMappingStage("suggesting");

      // ── Mapping memory: skip the AI call when this exact header set was
      // approved before. The review screen still always shows — this only
      // saves a round-trip to Gemini, never the human approval step.
      const signature = _headerSignature(headers);
      let rememberedMapping = null;
      let rememberedFieldDefaults = {};
      if (supabase) {
        const { data: mem } = await supabase
          .from("import_mapping_memory")
          .select("approved_mapping")
          .eq("schema_key", "suite_arrivals")
          .eq("header_signature", signature)
          .maybeSingle();
        if (mem?.approved_mapping) {
          const parsed = parseMappingMemory(mem.approved_mapping);
          rememberedMapping = parsed.mapping;
          rememberedFieldDefaults = parsed.fieldDefaults;
        }
      }

      if (rememberedMapping) {
        setAiSuggestion({
          mapping: rememberedMapping,
          defaults: {},
          fieldDefaults: rememberedFieldDefaults,
          confidence: {}, engine: "memory",
          recommendations: ["✓ זוהה כפורמט קובץ שאושר בעבר — מיפוי נטען מהזיכרון, יש לאשר מחדש"],
        });
        setAiError(null);
      } else {
        // EZGO's own raw Suites CSV shape checked first — it's the primary
        // source this panel is named for. detectSuiteArrivalsPreset (the
        // separate "advanced PMS export" shape) uses a disjoint header set,
        // so checking order between them doesn't matter for correctness.
        const ezgoPreset = detectEzgoArrivalsPreset(headers);
        const preset = ezgoPreset || detectSuiteArrivalsPreset(headers);
        if (preset) {
          setAiSuggestion({
            mapping: preset, defaults: {}, confidence: {}, engine: "preset",
            recommendations: [ezgoPreset
              ? "✓ זוהה קובץ EZGO Suites CSV גולמי (iOrderId/sTel1/sRemark) — מיפוי מוכן מראש"
              : "✓ זוהה דוח PMS מתקדם (מקור הגעה / שם מלא / טלפון) — מיפוי מוכן מראש"],
          });
          setAiError(null);
        } else try {
          const sample = buildMaskedSample(rows, headers, 3);
          const { data, error } = await supabase.functions.invoke("suggest-import-mapping", {
            body: { schemaKey: "suite_arrivals", headers, sampleRows: sample },
          });
          if (error) throw new Error(error.message);
          if (!data?.ok) throw new Error(data?.error || "מיפוי AI נכשל");
          setAiSuggestion(data);
          setAiError(null);
        } catch (e) {
          setAiSuggestion(null);
          setAiError(e.message);
        }
      }

      setMappingStage("review");
    } catch (err) {
      showToast("err", "שגיאה בקריאת Suite CSV: " + err.message);
      setMappingStage("idle");
    }
  }, [arrivalDate]);

  // ── Admin approved a mapping in the review screen — run the unchanged
  // extraction/grid/RPC pipeline with it, and remember it for next time. ──
  const handleMappingApprove = useCallback((finalMapping, appliedDefaults) => {
    if (!rawDoc2Rows) return;
    const profileMap = aggregateGuestProfiles(rawDoc2Rows, finalMapping, doc2Fallback);
    applyFieldDefaultsToProfiles(profileMap, appliedDefaults);
    if (appliedDefaults.arrivalDate) {
      for (const profile of profileMap.values()) {
        if (!profile.arrivalDate) profile.arrivalDate = appliedDefaults.arrivalDate;
      }
    }
    // Deterministic dates: the staff-set picker (doc2Fallback, captured at upload
    // time) is the ONLY arrival date source, full stop — even if the AI mapped some
    // column to the "arrivalDate" role and it parsed to a real value. Force it here
    // rather than relying on every upstream priority order to agree.
    for (const profile of profileMap.values()) {
      profile.arrivalDate = doc2Fallback;
    }
    if (!profileMap.size) {
      showToast("err", "לא נמצאו פרופילים — בדוק את המיפוי או שהקובץ ריק");
      setMappingStage("review");
      return;
    }
    setDoc2Map(profileMap);
    setImportSource(null);
    setMappingStage("idle");

    // Best-effort — never blocks the import if this fails
    if (supabase) {
      const signature = _headerSignature(Object.keys(rawDoc2Rows[0] ?? {}));
      supabase.from("import_mapping_memory")
        .upsert(
          {
            schema_key: "suite_arrivals",
            header_signature: signature,
            approved_mapping: packMappingMemory(finalMapping, appliedDefaults),
            last_used_at: new Date().toISOString(),
          },
          { onConflict: "schema_key,header_signature" },
        )
        .then(({ error }) => {
          if (error) console.warn("[ArrivalImportPanel] failed to save mapping memory:", error.message);
        });
    }
  }, [rawDoc2Rows, doc2Fallback]);

  const handleMappingCancel = useCallback(() => {
    setMappingStage("idle");
    setRawDoc2Rows(null);
    setDoc2Fallback(null);
    setAiSuggestion(null);
    setAiError(null);
    setDoc2Name("");
  }, []);

  // ── Parse Doc 1: Comprehensive Daily Report (Excel or EZGO HTML) ────────
  const handleDoc1 = useCallback(async (file) => {
    if (!file) return;
    setDoc1Name(file.name);
    setResult(null);
    try {
      const looksHtmlByName = /\.html?$/i.test(file.name);
      const looksHtmlByMime = file.type === "text/html";
      const headSniff = await file.slice(0, 512).text().catch(() => "");
      const looksHtmlByContent = /<!DOCTYPE\s+html|<html[\s>]|<table[\s>]/i.test(headSniff.trimStart());
      const isHtml = looksHtmlByName || looksHtmlByMime || looksHtmlByContent;

      const detectedByName = _detectDateFromFilename(file.name);
      if (detectedByName) {
        setArrivalDate(detectedByName);
        setAutoDateBanner({ date: detectedByName, source: "שם הקובץ" });
      }

      let payload;
      if (isHtml) {
        const text = await file.text();
        payload = { kind: "html", data: text };
        const preview = parseHtmlDailyReport(text, _doc1ParseOpts(doc1SyncMode));
        const detectedDate = preview.find((r) => r.arrival_date)?.arrival_date;
        if (detectedDate) {
          setArrivalDate(detectedDate);
          setAutoDateBanner({ date: detectedDate, source: "הדוח היומי (HTML)" });
        }
      } else {
        const XLSX = await import("xlsx");
        const buf  = await file.arrayBuffer();
        const wb   = XLSX.read(buf, { type: "array" });
        const ws   = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { defval: null, header: 1 });
        payload = { kind: "rows", data: rows };
        if (!detectedByName) {
          const firstDateRow = rows.find((row) => Array.isArray(row) && typeof row[0] === "number" && row[0] > 40000);
          if (firstDateRow) {
            const detectedDate = _parseDate(firstDateRow[0]);
            if (detectedDate) {
              setArrivalDate(detectedDate);
              setAutoDateBanner({ date: detectedDate, source: "תאריך בדוח (Excel)" });
            }
          }
        }
      }

      const records = _buildDoc1Records(payload, doc1SyncMode);
      if (!records.length) {
        showToast("err", doc1SyncMode === "suite_spa_only"
          ? "לא נמצאו שורות «לאורחי הסוויטות» עם שעת ספא בדוח"
          : "לא נמצאו הזמנות בדוח — בדוק פורמט");
        setRawDoc1Payload(null);
        setDoc1Rec(null);
        return;
      }

      setRawDoc1Payload(payload);
      showToast("ok", doc1SyncMode === "suite_spa_only"
        ? `זוהו ${records.length} הזמנות ספא לסוויטות (לאורחי הסוויטות)`
        : `נטענו ${records.length} שורות מהדוח היומי`);
    } catch (err) {
      showToast("err", "שגיאה בקריאת הדוח: " + err.message);
    }
  }, [doc1SyncMode]);

  const displayGridRows = useMemo(() => {
    let rows = gridRows;
    const spaFilterActive = showOnlyWithSpa
      && importSource !== "detailed"
      && doc2SyncMode !== "suite_assignment_only";
    if (spaFilterActive) {
      rows = rows.filter(_hasSpaTime);
    }
    if (importSource === "detailed") {
      if (detailedRoomFilter === "suite") {
        rows = rows.filter((r) => _hasAssignedRoomsCount(r.rooms_count));
      } else if (detailedRoomFilter === "day_use") {
        rows = rows.filter((r) => !_hasAssignedRoomsCount(r.rooms_count));
      }
    }
    return rows;
  }, [gridRows, showOnlyWithSpa, importSource, detailedRoomFilter, doc2SyncMode]);

  const displayDoc1Rec = useMemo(() => {
    if (!doc1Rec) return [];
    if (!showOnlyWithSpa) return doc1Rec;
    return doc1Rec.filter(_hasSpaTime);
  }, [doc1Rec, showOnlyWithSpa]);

  const handleFilteredGridChange = useCallback((updatedRows) => {
    setGridRows((prev) => {
      const patch = new Map(updatedRows.map((r) => [r._id, r]));
      return prev.map((r) => (patch.has(r._id) ? patch.get(r._id) : r));
    });
  }, []);

  const toggleSpaFilter = useCallback(() => {
    setShowOnlyWithSpa((v) => !v);
    setSelectedIds(new Set());
  }, []);

  const setDetailedRoomFilterAndClear = useCallback((mode) => {
    setDetailedRoomFilter(mode);
    setSelectedIds(new Set());
  }, []);

  // ── Bulk replace (suites grid) ───────────────────────────────────────────
  const handleGridReplace = (colId, search, replacement) => {
    setGridRows(prev => prev.map(r => {
      if (!selectedIds.has(r._id)) return r;
      const current = String(r[colId] ?? "");
      const updated = search
        ? current.replace(new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), replacement)
        : replacement;
      return { ...r, [colId]: updated };
    }));
  };

  // ── DB Sync — 2 independent paths ────────────────────────────────────────
  const handleSync = async () => {
    if (!supabase || !canSync) return;
    setSyncing(true);
    setResult(null);
    try {

      // ── PATH A: Suite CSV loaded (rooms + guests + bookings) ─────────────
      if (hasDoc2 && merged) {
        const gridByProfileIdx = new Map(gridRows.map((r) => [r._profileIdx, r]));
        const { indices: syncIndices, conflicts, skippedUnimportable } = _getSyncProfileIndices(merged, gridRows, {
          importSource,
          detailedRoomFilter,
          selectedIds,
          dbMatchByIdx,
        });
        if (!syncIndices.length) {
          showToast("err", skippedUnimportable > 0
            ? `כל ${skippedUnimportable} הרשומות בסינון הנוכחי סווגו כ"מטריית קבוצה" (⛔) ולא יובאו`
            : "אין רשומות לייבוא לפי הסינון הנוכחי");
          return;
        }

        if (doc2SyncMode === "suite_assignment_only" && importSource !== "detailed") {
          const roomStats = await _executeSuiteAssignmentOnlySync(supabase, {
            merged,
            gridRows,
            syncIndices,
            arrivalDate,
          });
          setResult({ mode: "suite_room_only", ...roomStats });
          return;
        }

        // Sprint 3: mergedCandidates[i] (Guest Import Intelligence merge — remark >
        // ops > detailed identity, ops-sourced spa/meal, detailed/arrivals price+
        // nights+leadSource+automationMuted per FIELD_SOURCE_PRIORITY) is the source
        // of truth here, not the raw per-source profile alone. `g` (merged[i]) is
        // still consulted for fields the candidate model doesn't carry — the
        // per-room breakdown (g.rooms/resLineId/coordPhone) is arrivals-only detail
        // that classifyDbMatch/mergeCandidates never needed to model.
        const profiles = syncIndices.map((i) => {
            const g = merged[i];
            const c = mergedCandidates[i];
            const edited = gridByProfileIdx.get(i) ?? {};
            const nightsFromGrid = parseInt(edited.nights, 10);
            const nights = importSource === "detailed"
              ? (Number.isFinite(nightsFromGrid) && nightsFromGrid > 0
                ? nightsFromGrid
                : (c.nights || (g.rooms ?? []).reduce((mx, r) => Math.max(mx, r.nights || 0), 0)) || 1)
              : (c.nights ?? (g.rooms ?? []).reduce((mx, r) => Math.max(mx, r.nights || 0), 0));
            const editedAmount = edited.amount !== undefined && edited.amount !== ""
              ? parseFloat(edited.amount) : null;
            const computedAmount = c.price ?? (g.rooms ?? []).reduce((sum, r) => sum + (r.price || 0), 0);
            const profileType = importSource === "detailed"
              ? _resolveDetailedProfileType(g, detailedRoomFilter)
              : (g.hasDayBooking ? "day_use" : "suite");
            const isSuiteProfile = profileType === "suite";
            const profileArrivalDate = c.arrivalDate ?? g.arrivalDate ?? null;
            return {
              guestPhone:      c.guestPhone ?? g.guestPhone,
              guestName:       edited.guestName ?? c.guestName ?? g.guestName ?? "",
              arrivalDate:     profileArrivalDate,
              departureDate:   _addNights(profileArrivalDate, nights),
              orderNumber:     c.orderNumber ?? [...(g.orderNumbers ?? [])][0] ?? null,
              hasSuite:        isSuiteProfile,
              isDayGuest:      !isSuiteProfile,
              profile_type:    profileType,
              treatment_count: c.treatment_count ?? g.treatment_count ?? 0,
              paymentAmount:   editedAmount ?? (computedAmount || null),
              leadSource:      c.leadSource ?? g.leadSource ?? null,
              automationMuted: !!(c.automationMuted ?? g.automationMuted),
              nights,
            };
          });

        const rooms = syncIndices
          .flatMap((i) => {
            const g = merged[i];
            const c = mergedCandidates[i];
            const edited      = gridByProfileIdx.get(i) ?? {};
            const roomOverride = edited.room || "";
            const profileType = importSource === "detailed"
              ? _resolveDetailedProfileType(g, detailedRoomFilter)
              : (g.hasDayBooking ? "day_use" : "suite");
            const isDayGuestRoom = profileType === "day_use";
            return (g.rooms ?? []).map(r => ({
              resLineId:    r.resLineId,
              orderNumber:  r.orderNumber,
              roomName:     r.roomName,
              suiteType:    r.suiteType,
              roomDisplay:  roomOverride
                || _bestGuessSuite(r.roomName, r.suiteType, isDayGuestRoom)
                || null,
              guestName:    edited.guestName ?? c.guestName ?? g.guestName ?? "",
              guestPhone:   c.guestPhone ?? g.guestPhone ?? null,
              coordPhone:   g.coordPhone ?? null,
              phoneSource:  g.phoneSource,
              adults:       r.adults,
              nights:       r.nights,
              arrivalDate:  c.arrivalDate ?? g.arrivalDate ?? null,
              checkinTime:  r.checkinTime ?? null,
              checkoutTime: r.checkoutTime ?? null,
              isDayGuest:   isDayGuestRoom,
            }));
          })
          .filter(r => r.resLineId && r.orderNumber);

        const batchProfileType = importSource === "detailed"
          ? (detailedRoomFilter === "all" ? "mixed" : detailedRoomFilter)
          : "mixed";

        const { data: rpcData, error: rpcErr } = await supabase
          .rpc("sync_suite_arrivals", {
            payload: {
              profiles,
              rooms,
              profile_batch_type: batchProfileType,
            },
          });
        if (rpcErr) throw new Error("sync_suite_arrivals: " + rpcErr.message);

        for (const i of syncIndices) {
          const g = merged[i];
          const c = mergedCandidates[i];
          const edited   = gridByProfileIdx.get(i) ?? {};
          const guestPhone      = c.guestPhone ?? g.guestPhone;
          const profileArrivalDate = c.arrivalDate ?? g.arrivalDate;
          const roomDisplay = _resolveProfileRoomDisplay(g, edited.room);
          const spaTime  = edited.spa_time  || c.spa_time  || g.spa_time;
          const mealTime = edited.meal_time || c.meal_time || g.meal_time;
          const mealLoc  = edited.meal_location || c.meal_location || g.meal_location;
          const notes    = g.guest_notes;
          const patch = {};
          const tc = c.treatment_count ?? g.treatment_count;
          if (tc != null && tc > 0) patch.treatment_count = tc;
          if (spaTime)  patch.spa_time      = spaTime;
          if (mealTime) patch.meal_time      = mealTime;
          if (mealLoc)  patch.meal_location  = mealLoc;
          if (notes)    patch.guest_notes    = notes;
          if (roomDisplay) patch.room = roomDisplay;
          if (guestPhone && profileArrivalDate && Object.keys(patch).length > 0) {
            await supabase.from("guests").update(patch)
              .eq("phone", guestPhone)
              .eq("arrival_date", profileArrivalDate);
          }
          if (guestPhone && profileArrivalDate && (g.roomsQuantity ?? 0) > 0) {
            await supabase.from("bookings").update({ room_count: g.roomsQuantity })
              .eq("phone", guestPhone.replace(/^\+/, ""))
              .eq("arrival_date", profileArrivalDate);
          }
        }

        const syncedMerged = syncIndices.map((i) => merged[i]);
        const corporateMuted = syncedMerged.filter((g) => g.automationMuted).length;
        setResult({
          mode:   importSource === "detailed" ? "detailed" : "suites",
          total:  rpcData?.guests ?? profiles.length,
          rooms:  rpcData?.rooms  ?? rooms.length,
          skippedRooms: rpcData?.skipped ?? 0,
          suites: profiles.filter((p) => p.hasSuite).length,
          days:   profiles.filter((p) => p.isDayGuest).length,
          spa:    syncIndices.filter((i) => gridByProfileIdx.get(i)?.spa_time).length,
          corporateMuted,
          batchType: batchProfileType,
          skippedUnimportable,
          conflictCount: conflicts.length,
          conflictNames: conflicts.map((i) =>
            gridByProfileIdx.get(i)?.guestName || mergedCandidates[i]?.guestName || `שורה ${i + 1}`),
        });

      // ── PATH B: Daily Report only — ENRICHMENT ONLY ─────────────────────
      // Updates spa/meal fields on EXISTING guests only. Never inserts new rows.
      // Guests must already exist from a Doc 2 (Suite CSV) import. This enforces
      // the single-source-of-truth rule: the Suite CSV creates guest records,
      // the Daily Report only enriches them (§4 — no duplicates).
      } else if (!hasDoc2 && hasDoc1) {
        if (doc1SyncMode === "suite_spa_only") {
          const spaRecords = doc1Rec.filter((r) => r.spa_time && r.order_number);
          if (!spaRecords.length) {
            showToast("err", "אין הזמנות עם שעת ספא «לאורחי הסוויטות» לסנכרון");
            return;
          }
          if (!arrivalDate) {
            showToast("err", "יש לבחור תאריך הגעה לפני סנכרון ספא סוויטות");
            return;
          }

          const orderNums = [...new Set(spaRecords.map((r) => r.order_number))];
          const { data: existingRows, error: lookupErr } = await supabase
            .from("guests")
            .select("id, order_number, phone, name")
            .in("order_number", orderNums)
            .eq("arrival_date", arrivalDate);
          if (lookupErr) throw new Error(lookupErr.message);

          const byOrder = new Map((existingRows ?? []).map((g) => [g.order_number, g]));
          let updated = 0;
          let skipped = 0;
          const notFoundOrders = [];

          for (const rec of spaRecords) {
            const guest = byOrder.get(rec.order_number);
            if (!guest) {
              skipped++;
              notFoundOrders.push(rec.order_number);
              continue;
            }
            const patch = {
              spa_time: rec.spa_time,
              treatment_count: rec.treatment_count ?? 0,
            };
            const { error } = await supabase.from("guests").update(patch).eq("id", guest.id);
            if (!error) updated++;
            else skipped++;
          }

          setResult({
            mode:        "suite_spa",
            updated,
            skipped,
            notFound:    [...new Set(notFoundOrders)],
            total:       spaRecords.length,
            arrivalDate,
          });
        } else {
        const allPhones = doc1Rec.filter(r => r.phone).map(r => r.phone);
        let updated = 0, skipped = 0;

        if (allPhones.length > 0) {
          const { data: existingRows } = await supabase
            .from("guests").select("phone").in("phone", allPhones);
          const existingPhones = new Set((existingRows ?? []).map(g => g.phone));

          for (const rec of doc1Rec) {
            if (!rec.phone) { skipped++; continue; }

            if (existingPhones.has(rec.phone)) {
              const patch = {};
              if (rec.spa_time)        patch.spa_time        = rec.spa_time;
              // meal_time and meal_location are independent: board-basis guests have
              // meal_location ("חצי פנסיון" etc.) with meal_time=null — both must be
              // written separately so plan labels reach the DB even without a time.
              if (rec.meal_time)       patch.meal_time       = rec.meal_time;
              if (rec.meal_location)   patch.meal_location   = rec.meal_location;
              if (rec.treatment_count) patch.treatment_count = rec.treatment_count;
              if (rec.order_number)    patch.order_number    = rec.order_number;
              if (rec.arrival_date)    patch.arrival_date    = rec.arrival_date;
              const { error } = await supabase.from("guests").update(patch).eq("phone", rec.phone);
              if (!error) updated++; else skipped++;
            } else {
              // Guest not found — enrichment-only path, never insert.
              skipped++;
            }
          }
        } else {
          skipped = doc1Rec.length;
        }
        setResult({ mode: "spa", updated, skipped });
        }
      }

    } catch (err) {
      showToast("err", "שגיאת סנכרון: " + err.message);
    } finally {
      setSyncing(false);
    }
  };

  const reset = () => {
    setDoc2Map(null); setDoc1Rec(null); setRawDoc1Payload(null);
    setDoc2Name(""); setDoc1Name("");
    setDoc1SyncMode("suite_spa_only");
    setDoc2SyncMode("full");
    setMerged(null); setGridRows([]); setShowOnlyWithSpa(true);
    setDetailedRoomFilter("all"); setSelectedIds(new Set()); setResult(null);
    setMappingStage("idle"); setRawDoc2Rows(null); setDoc2Fallback(null);
    setAiSuggestion(null); setAiError(null); setAutoDateBanner(null);
    setImportSource(null); setDetailedFileName("");
    setPendingDetailedRows(null); setPriceConflictQueue(null);
    setPriceConflictIdx(0); setPriceResolutions({});
  };

  // ── Shifts profile handlers ──────────────────────────────────────────────
  const handleShiftFile = useCallback(async (file) => {
    if (!file) return;
    setShiftFileName(file.name);
    try {
      const buf    = await file.arrayBuffer();
      const parsed = await parseShiftFile(buf);
      if (!parsed.length) { showToast("err", "הקובץ ריק"); return; }
      const keys = Object.keys(parsed[0]).filter(k => k !== "_id");
      setShiftCols(keys.map(k => ({ id: k, label: String(k), editable: true, w: 120 })));
      setShiftRows(parsed);
    } catch (err) {
      showToast("err", "שגיאה בניתוח: " + err.message);
    }
  }, []);

  const handleShiftReplace = (colId, search, replacement) => {
    setShiftRows(prev => prev.map(r => {
      if (!shiftSelected.has(r._id)) return r;
      const current = String(r[colId] ?? "");
      const updated = search
        ? current.replace(new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), replacement)
        : replacement;
      return { ...r, [colId]: updated };
    }));
  };

  const handleShiftExport = () => {
    exportToExcel(shiftCols, shiftRows, "dream_schedule.xlsx")
      .catch(e => showToast("err", e.message));
  };

  const syncTargetCount = useMemo(() => {
    if (!merged?.length) return 0;
    return _getSyncProfileIndices(merged, gridRows, {
      importSource,
      detailedRoomFilter,
      selectedIds,
      dbMatchByIdx,
    }).indices.length;
  }, [merged, gridRows, importSource, detailedRoomFilter, selectedIds, dbMatchByIdx]);

  // ── Sync button label ─────────────────────────────────────────────────────
  const syncLabel = syncing
    ? "⏳ מסנכרן..."
    : importSource === "detailed" && hasDoc2
      ? detailedRoomFilter === "suite"
        ? `⚡ ייבא פרופילים כאורחי סוויטות (${syncTargetCount} רשומות)`
        : detailedRoomFilter === "day_use"
          ? `☀️ ייבא פרופילים כבילוי יומי (${syncTargetCount} רשומות)`
          : `⚡ ייבא ${syncTargetCount} פרופילים`
    : (hasDoc2 && hasDoc1)
      ? `⚡ ייבא ${syncTargetCount} פרופילים + עדכן ספא`
    : hasDoc2
      ? doc2SyncMode === "suite_assignment_only"
        ? `🏨 עדכן שיבוץ סוויטות בלבד (${syncTargetCount} רשומות)`
        : `⚡ ייבא ${syncTargetCount} פרופילים`
      : doc1SyncMode === "suite_spa_only"
        ? `💆 סנכרן ספא סוויטות (${doc1Rec?.length ?? 0} הזמנות · לפי מס׳ הזמנה)`
        : `⚡ עדכן שעות ספא (${doc1Rec?.length ?? 0} אורחים)`;

  // ── Stats ─────────────────────────────────────────────────────────────────
  const activeGridCols = importSource === "detailed"
    ? DETAILED_GRID_COLS
    : doc2SyncMode === "suite_assignment_only"
      ? SUITE_ASSIGNMENT_GRID_COLS
      : SUITES_GRID_COLS;

  const stats = (hasDoc2 && merged)
    ? {
        mode:       importSource === "detailed" ? "detailed" : "suites",
        total:      merged.length,
        suites:     merged.filter(g => g.hasSuite).length,
        days:       merged.filter(g => g.hasDayBooking && !g.hasSuite).length,
        withSpa:    gridRows.filter(r => r.spa_time).length,
        withAmount: gridRows.filter(r => r.amount).length,
        assigned:   gridRows.filter(r => r.room).length,
        individual: merged.filter(g => g.phoneSource === "individual").length,
        withRooms:  gridRows.filter(r => _hasAssignedRoomsCount(r.rooms_count)).length,
        withoutRooms: gridRows.filter(r => !_hasAssignedRoomsCount(r.rooms_count)).length,
        muted:      merged.filter(g => g.automationMuted).length,
      }
    : hasDoc1
      ? {
          mode:    doc1SyncMode === "suite_spa_only" ? "suite_spa" : "spa",
          total:   doc1Rec.length,
          withSpa: doc1Rec.filter(r => r.spa_time).length,
        }
      : null;

  const showSuiteGrid = hasDoc2 && merged && merged.length > 0 && !result;
  const showSpaPreview   = !hasDoc2 && hasDoc1 && !result;
  const doc1PreviewHeaders = doc1SyncMode === "suite_spa_only"
    ? ["הזמנה #", "שם", "שעת ספא", "# טיפולים"]
    : ["הזמנה #", "שם", "שעת ספא", "שעת ארוחה", "# טיפולים"];

  return (
    <div style={{ marginBottom: 20 }}>

      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", top: 20, left: "50%", transform: "translateX(-50%)", zIndex: 9999,
          padding: "12px 22px", borderRadius: 10, fontWeight: 700, fontSize: 14,
          boxShadow: "0 8px 32px rgba(0,0,0,0.12)",
          background: toast.type === "ok" ? "#E8F5EF" : "#FFF0EE",
          color:      toast.type === "ok" ? "#1A7A4A" : "#C0392B",
          border:     `1px solid ${toast.type === "ok" ? "#1A7A4A" : "#C0392B"}`,
        }}>{toast.msg}</div>
      )}

      {/* Collapsible header */}
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "14px 20px", cursor: "pointer", userSelect: "none",
          background: "linear-gradient(135deg, #1c1c1c, #0F0F0F)",
          border: "1px solid var(--gold)",
          borderRadius: open ? "16px 16px 0 0" : 16,
          boxShadow: "0 4px 22px rgba(201,169,110,0.18)",
          transition: "border-radius 0.15s",
        }}
      >
        <span style={{ fontSize: 18 }}>🗂️</span>
        <span style={{ fontWeight: 800, fontSize: 15, color: "var(--gold-light)", flex: 1 }}>
          ייבוא נתונים — Data Hub
        </span>
        {tab === "suites" && stats && (
          <span style={{ fontSize: 12, color: "var(--gold)", fontWeight: 600 }}>
            {stats.mode === "suites"
              ? `${stats.total} פרופילים · ${stats.assigned} שויכו חדר`
              : stats.mode === "suite_spa"
                ? `${stats.total} הזמנות ספא לסוויטות`
                : `${stats.total} אורחי ספא`}
          </span>
        )}
        <span style={{ color: "rgba(232,201,138,0.55)", fontSize: 13 }}>{open ? "▲" : "▼"}</span>
      </div>

      {open && (
        <div style={{
          border: "1px solid var(--gold)", borderTop: "none",
          borderRadius: "0 0 16px 16px", padding: "20px 18px 22px",
          background: "linear-gradient(160deg, #161616, #0F0F0F)",
          boxShadow: "0 14px 40px rgba(0,0,0,0.35)",
        }}>

          {/* Profile tabs */}
          <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
            {[
              { key: "suites", label: "🏨 כניסות סוויטות" },
              { key: "shifts", label: "📋 סידור משמרות" },
            ].map(({ key, label }) => (
              <button key={key} onClick={() => setTab(key)} style={{
                padding: "8px 18px", borderRadius: 20, border: "none", cursor: "pointer",
                fontFamily: "Heebo,sans-serif", fontSize: 13, fontWeight: 700,
                background: tab === key ? "linear-gradient(135deg,var(--gold),var(--gold-dark))" : "rgba(255,255,255,0.06)",
                color:      tab === key ? "#0F0F0F"     : "var(--gold-light)",
                boxShadow:  tab === key ? "0 3px 14px rgba(201,169,110,0.3)" : "none",
                transition: "all 0.15s",
              }}>{label}</button>
            ))}
          </div>

          {tab === "suites" && (<>

          {/* Info banner */}
          <div style={{
            background: "rgba(201,169,110,0.08)", border: "1px solid rgba(201,169,110,0.3)",
            borderRadius: 10, padding: "10px 14px", marginBottom: 14,
            fontSize: 12, color: "var(--gold-light)", lineHeight: 1.8,
          }}>
            <strong>Doc 2 — דוח כניסות EZGO (CSV):</strong> ייבוא חדרים, אורחים, הזמנות · או <strong>«שיבוץ סוויטות בלבד»</strong> לעדכון חדר בפרופיל קיים (מס׳ הזמנה / שם)<br />
            <strong>Doc 1 — דוח יומי מקיף (Excel / HTML):</strong> עדכון שעות ספא (+ ארוחה במצב מלא)<br />
            <strong>💆 ספא סוויטות בלבד (ברירת מחדל):</strong> שורות עם «לאורחי הסוויטות» בלבד · התאמה לפי <em>מספר הזמנה</em> + תאריך הגעה → עדכון פרופיל קיים<br />
            <span style={{ color: "rgba(232,201,138,0.55)", fontSize: 11 }}>
              ניתן להעלות כל דוח בנפרד ● ערוך שם/חדר/ספא בטבלה לפני הסנכרון ● שדות בוט חיים לא נדרסים
            </span>
          </div>

          {/* Arrival date picker — auto-filled from filename / first cell when detected;
              editable at any time; its value at Doc 2 upload time becomes the snapshot
              (doc2Fallback) that applies to every profile in that import. */}
          <div style={{
            display: "flex", alignItems: "center", gap: 10, marginBottom: autoDateBanner ? 6 : 14,
            padding: "10px 14px", borderRadius: 8,
            background: "rgba(124,58,237,0.06)", border: "1px solid rgba(124,58,237,0.25)",
          }}>
            <label style={{ fontSize: 13, fontWeight: 800, color: "#7c3aed", whiteSpace: "nowrap" }}>
              📅 תאריך הגעה לייבוא זה
            </label>
            <input
              type="date"
              value={arrivalDate}
              onChange={e => { setArrivalDate(e.target.value); setAutoDateBanner(null); }}
              style={{
                padding: "7px 10px", borderRadius: 8, border: "1px solid rgba(124,58,237,0.4)",
                fontSize: 14, fontFamily: "Heebo,sans-serif", direction: "ltr",
              }}
            />
            <span style={{ fontSize: 11, color: "rgba(196,181,253,0.75)" }}>
              חל על כל הפרופילים בקובץ Doc 2 — תאריך העזיבה יחושב אוטומטית לפי מספר הלילות (iNights)
            </span>
          </div>

          {/* FAIL VISIBLE: auto-detected date banner — must be confirmed before sync */}
          {autoDateBanner && (
            <div style={{
              display: "flex", alignItems: "center", gap: 8, marginBottom: 14,
              padding: "9px 14px", borderRadius: 8,
              background: "rgba(52,211,153,0.08)", border: "1px solid rgba(52,211,153,0.45)",
              fontSize: 12,
            }}>
              <span style={{ fontSize: 16 }}>📅</span>
              <span style={{ flex: 1, color: "#065f46", fontWeight: 700 }}>
                תאריך זוהה אוטומטית מ{autoDateBanner.source}:{" "}
                <strong style={{ fontFamily: "monospace" }}>{autoDateBanner.date}</strong>
                {" "}— אמת ושנה לפי הצורך לפני הסנכרון
              </span>
              <button
                onClick={() => setAutoDateBanner(null)}
                title="סגור"
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  color: "#065f46", fontSize: 15, fontWeight: 700, padding: "0 4px", lineHeight: 1,
                }}
              >✕</button>
            </div>
          )}

          {/* Two drop zones */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
            <div>
              <DropZone
                label="📋 Doc 2 — כניסות אורחים"
                hint="כל CSV/Excel — עמודות מזוהות אוטומטית"
                loaded={hasDoc2 || mappingStage !== "idle"}
                fileName={importSource === "detailed" ? detailedFileName : doc2Name}
                onFile={handleDoc2}
                inputRef={doc2Ref}
              />
              {/* Doc 2 sync mode — full import vs room-only patch */}
              <div style={{
                display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10,
                padding: "10px 12px", borderRadius: 10,
                background: "rgba(201,169,110,0.1)", border: "1px solid rgba(201,169,110,0.4)",
              }}>
                <span style={{ fontSize: 12, fontWeight: 800, color: "var(--gold-dark)", alignSelf: "center" }}>
                  מצב Doc 2:
                </span>
                {[
                  {
                    key: "full",
                    label: "📋 ייבוא / עדכון מלא",
                  },
                  {
                    key: "suite_assignment_only",
                    label: "🏨 עדכון שיבוץ סוויטות בלבד",
                    disabled: importSource === "detailed",
                  },
                ].map(({ key, label, disabled }) => (
                  <button
                    key={key}
                    type="button"
                    disabled={disabled}
                    title={disabled ? "לא זמין בדוח הזמנות מפורט — השתמש ב-Doc 2 רגיל" : undefined}
                    onClick={() => !disabled && setDoc2SyncMode(key)}
                    style={{
                      padding: "7px 14px", borderRadius: 20,
                      cursor: disabled ? "not-allowed" : "pointer",
                      fontFamily: "Heebo,sans-serif", fontSize: 12, fontWeight: 700,
                      opacity: disabled ? 0.45 : 1,
                      border: doc2SyncMode === key ? "1px solid var(--gold-dark)" : "1px solid rgba(201,169,110,0.35)",
                      background: doc2SyncMode === key
                        ? "linear-gradient(135deg,var(--gold),var(--gold-dark))"
                        : "rgba(255,255,255,0.5)",
                      color: doc2SyncMode === key ? "#0F0F0F" : "var(--gold-dark)",
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {doc2SyncMode === "suite_assignment_only" && hasDoc2 && importSource !== "detailed" && (
                <div style={{
                  marginTop: 8, padding: "8px 12px", borderRadius: 8, fontSize: 11,
                  background: "var(--ivory)", border: "1px solid var(--border)",
                  color: "var(--black)", fontWeight: 600, lineHeight: 1.5,
                }}>
                  מעדכן רק את עמודת <strong>חדר/סוויטה</strong> לאורחים קיימים (התאמה לפי מס׳ הזמנה או שם).
                  לא משנה טלפון, תאריכים או סטטוס צ׳ק-אין.
                </div>
              )}
            </div>
            <DropZone
              label="📊 Doc 1 — דוח יומי מקיף"
              hint="Excel / HTML EZGO — שעות ספא וארוחה"
              loaded={hasDoc1}
              fileName={doc1Name}
              onFile={handleDoc1}
              inputRef={doc1Ref}
              accept=".xlsx,.xls,.htm,.html"
              optional
            />
          </div>

          {/* Doc 1 sync mode — suite spa only vs full enrichment */}
          <div style={{
            display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14,
            padding: "10px 12px", borderRadius: 10,
            background: "rgba(22,163,74,0.08)", border: "1px solid rgba(22,163,74,0.35)",
          }}>
            <span style={{ fontSize: 12, fontWeight: 800, color: "#166534", alignSelf: "center" }}>
              מצב Doc 1:
            </span>
            {[
              {
                key: "suite_spa_only",
                label: "💆 ספא סוויטות בלבד (לאורחי הסוויטות · מס׳ הזמנה)",
              },
              {
                key: "full",
                label: "📋 עדכון מלא (ספא + ארוחה · לפי טלפון)",
              },
            ].map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => setDoc1SyncMode(key)}
                style={{
                  padding: "7px 14px", borderRadius: 20, cursor: "pointer",
                  fontFamily: "Heebo,sans-serif", fontSize: 12, fontWeight: 700,
                  border: doc1SyncMode === key ? "1px solid #16a34a" : "1px solid rgba(22,163,74,0.35)",
                  background: doc1SyncMode === key ? "linear-gradient(135deg,#22c55e,#16a34a)" : "rgba(255,255,255,0.06)",
                  color: doc1SyncMode === key ? "#fff" : "#86efac",
                }}
              >
                {label}
              </button>
            ))}
            {rawDoc1Payload && !hasDoc1 && (
              <span style={{ fontSize: 11, color: "#b45309", fontWeight: 700, alignSelf: "center" }}>
                ⚠ במצב הנוכחי לא נמצאו שורות מתאימות בקובץ שנטען
              </span>
            )}
          </div>

          {/* Dedicated detailed reservation report — bypasses generic mapper */}
          <div style={{ marginBottom: 14 }}>
            <DropZone
              label="📑 ייבוא דוח הזמנות מפורט"
              hint="CSV/Excel PMS — תאריכי Excel, בסיס אירוח, פערי מחיר"
              loaded={importSource === "detailed" && hasDoc2}
              fileName={importSource === "detailed" ? detailedFileName : ""}
              onFile={handleDetailedReservation}
              inputRef={detailedRef}
            />
            {importSource === "detailed" && hasDoc2 && (
              <div style={{
                marginTop: 8, padding: "8px 12px", borderRadius: 8, fontSize: 11,
                background: "rgba(124,58,237,0.08)", border: "1px solid rgba(124,58,237,0.3)",
                color: "#5b21b6", fontWeight: 700,
              }}>
                מצב דוח מפורט — תאריך הגעה, בסיס אירוח ומחיר נלקחים מכל שורה בדוח (לא ממיפוי AI)
              </div>
            )}
          </div>

          {priceConflictQueue?.length > 0 && (
            <PriceDiscrepancyModal
              conflict={priceConflictQueue[priceConflictIdx]}
              current={priceConflictIdx + 1}
              total={priceConflictQueue.length}
              onChoose={handlePriceConflictChoice}
              onCancel={handlePriceConflictCancel}
            />
          )}

          {/* Resilient Import Agent — mapping suggestion + review gate */}
          {mappingStage === "suggesting" && (
            <div style={{
              textAlign: "center", padding: "24px", color: "var(--gold-light)",
              fontSize: 13, border: "1px dashed rgba(201,169,110,0.35)", borderRadius: 10, marginBottom: 14,
            }}>
              🤖 מנתח כותרות עמודות ומציע מיפוי...
            </div>
          )}
          {mappingStage === "review" && rawDoc2Rows && (
            <MappingReviewPanel
              schema={SUITE_ARRIVALS_SCHEMA}
              headers={Object.keys(rawDoc2Rows[0] ?? {})}
              sampleRow={rawDoc2Rows[0]}
              aiSuggestion={aiSuggestion}
              aiError={aiError}
              onApprove={handleMappingApprove}
              onCancel={handleMappingCancel}
            />
          )}

          {/* Stats bar */}
          {stats && (
            <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
              {stats.mode === "detailed" ? (
                <>
                  {[
                    { label: "פרופילים",   val: stats.total,      c: "#7c3aed", bg: "#f3f0ff" },
                    { label: "עם סכום",    val: stats.withAmount, c: "#0369a1", bg: "#eff6ff" },
                    { label: "עם חדרים",   val: stats.withRooms,    c: "#b45309", bg: "#fef3c7" },
                    { label: "ללא חדרים",  val: stats.withoutRooms, c: "#0e7490", bg: "#ecfeff" },
                    { label: "ללא אוטומציה", val: stats.muted,    c: "#dc2626", bg: "#fef2f2" },
                  ].map(({ label, val, c, bg }) => (
                    <div key={label} style={{
                      background: bg, borderRadius: 8, padding: "6px 12px",
                      border: `1px solid ${c}22`, display: "flex", alignItems: "baseline", gap: 5,
                    }}>
                      <span style={{ fontSize: 18, fontWeight: 900, color: c, lineHeight: 1 }}>{val}</span>
                      <span style={{ fontSize: 11, color: c, fontWeight: 700 }}>{label}</span>
                    </div>
                  ))}
                </>
              ) : stats.mode === "suites" ? (
                <>
                  {[
                    { label: "פרופילים",    val: stats.total,      c: "#7c3aed", bg: "#f3f0ff" },
                    { label: "סוויטות",     val: stats.suites,     c: "#b45309", bg: "#fef3c7" },
                    { label: "בילוי יומי",  val: stats.days,       c: "#0e7490", bg: "#ecfeff" },
                    { label: "עם ספא",      val: stats.withSpa,    c: "#16a34a", bg: "#f0fdf4" },
                    { label: "עם סכום",     val: stats.withAmount, c: "#0369a1", bg: "#eff6ff" },
                    { label: "שויכו חדר",   val: stats.assigned,   c: "#92400e", bg: "#fef3c7" },
                    { label: "טלפון פרטי",  val: stats.individual, c: "#dc2626", bg: "#fef2f2" },
                  ].map(({ label, val, c, bg }) => (
                    <div key={label} style={{
                      background: bg, borderRadius: 8, padding: "6px 12px",
                      border: `1px solid ${c}22`, display: "flex", alignItems: "baseline", gap: 5,
                    }}>
                      <span style={{ fontSize: 18, fontWeight: 900, color: c, lineHeight: 1 }}>{val}</span>
                      <span style={{ fontSize: 11, color: c, fontWeight: 700 }}>{label}</span>
                    </div>
                  ))}
                </>
              ) : stats.mode === "spa" || stats.mode === "suite_spa" ? (
                <>
                  {[
                    { label: stats.mode === "suite_spa" ? "הזמנות ספא" : "הזמנות", val: stats.total, c: "#7c3aed", bg: "#f3f0ff" },
                    { label: "עם שעת ספא", val: stats.withSpa, c: "#16a34a", bg: "#f0fdf4" },
                  ].map(({ label, val, c, bg }) => (
                    <div key={label} style={{
                      background: bg, borderRadius: 8, padding: "6px 12px",
                      border: `1px solid ${c}22`, display: "flex", alignItems: "baseline", gap: 5,
                    }}>
                      <span style={{ fontSize: 18, fontWeight: 900, color: c, lineHeight: 1 }}>{val}</span>
                      <span style={{ fontSize: 11, color: c, fontWeight: 700 }}>{label}</span>
                    </div>
                  ))}
                </>
              ) : null}
            </div>
          )}

          {/* Detailed report — suite vs day-use row filter */}
          {stats?.mode === "detailed" && showSuiteGrid && (
            <div style={{
              display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
              marginBottom: 12, padding: "8px 12px",
              background: "rgba(124,58,237,0.06)", borderRadius: 10,
              border: "1px solid rgba(124,58,237,0.2)",
            }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "#5b21b6", marginLeft: 4 }}>
                סינון תצוגה:
              </span>
              {[
                { key: "all", label: "הכל", count: stats.total },
                { key: "suite", label: "אורחי סוויטות — עם חדרים", count: stats.withRooms },
                { key: "day_use", label: "בילוי יומי — ללא חדרים", count: stats.withoutRooms },
              ].map(({ key, label, count }) => {
                const active = detailedRoomFilter === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setDetailedRoomFilterAndClear(key)}
                    style={{
                      padding: "6px 14px", borderRadius: 20,
                      border: `1px solid ${active ? "#7c3aed" : "rgba(124,58,237,0.35)"}`,
                      background: active ? "rgba(124,58,237,0.18)" : "rgba(255,255,255,0.04)",
                      color: active ? "#5b21b6" : "var(--gold-light)",
                      fontFamily: "Heebo,sans-serif", fontSize: 12, fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    {label} ({count})
                  </button>
                );
              })}
              <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>
                מוצגים {displayGridRows.length} מתוך {gridRows.length}
                {selectedIds.size > 0 ? ` · נבחרו ${selectedIds.size}` : ""}
              </span>
            </div>
          )}

          {/* Editable grid — Suite CSV profiles, room dropdown sourced from SUITE_REGISTRY */}
          {showSuiteGrid && (
            <div style={{ marginBottom: 14 }}>
              {importSource !== "detailed" && doc2SyncMode !== "suite_assignment_only" && (
                <div style={{
                  display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
                  marginBottom: 10, padding: "8px 12px",
                  background: "rgba(201,169,110,0.08)", borderRadius: 10,
                  border: "1px solid rgba(201,169,110,0.25)",
                }}>
                  <button
                    type="button"
                    onClick={toggleSpaFilter}
                    title={showOnlyWithSpa
                      ? "מציג רק אורחים עם שעת ספא — לחץ להצגת כל השורות"
                      : "מציג את כל האורחים — לחץ לסינון ספא בלבד"}
                    style={{
                      padding: "6px 14px", borderRadius: 20, border: "1px solid var(--gold)",
                      background: showOnlyWithSpa ? "rgba(201,169,110,0.15)" : "linear-gradient(135deg,var(--gold),var(--gold-dark))",
                      color: showOnlyWithSpa ? "var(--gold-light)" : "#0F0F0F",
                      fontFamily: "Heebo,sans-serif", fontSize: 12, fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    {showOnlyWithSpa ? "👁 הצג את כל האורחים" : "💆 הצג רק עם ספא"}
                  </button>
                  <span style={{ fontSize: 11, color: "var(--gold-light)", fontWeight: 600 }}>
                    מוצגים {displayGridRows.length} מתוך {gridRows.length}
                    {showOnlyWithSpa && displayGridRows.length < gridRows.length
                      ? " · סנכרון ייבא את כל הפרופילים"
                      : ""}
                  </span>
                </div>
              )}
              {doc2SyncMode === "suite_assignment_only" && importSource !== "detailed" && (
                <div style={{
                  marginBottom: 10, padding: "8px 12px", borderRadius: 10,
                  background: "rgba(201,169,110,0.1)", border: "1px solid rgba(201,169,110,0.35)",
                  fontSize: 11, fontWeight: 700, color: "var(--gold-dark)",
                }}>
                  🏨 תצוגת שיבוץ: שם · מס׳ הזמנה · חדר/סוויטה — {displayGridRows.length} שורות
                </div>
              )}
              {selectedIds.size > 0 && (
                <BulkEditBar
                  count={selectedIds.size}
                  columns={activeGridCols}
                  onReplace={handleGridReplace}
                  onClear={() => setSelectedIds(new Set())}
                />
              )}
              <div style={{ color: "#1A1A1A" }}>
              <EditableGrid
                columns={activeGridCols}
                rows={displayGridRows}
                onRowsChange={handleFilteredGridChange}
                selectedIds={selectedIds}
                onSelectionChange={setSelectedIds}
              />
              </div>
            </div>
          )}

          {/* Preview — Daily Report only (spa times) */}
          {showSpaPreview && (
            <div style={{
              border: "1px solid var(--border)", borderRadius: 10,
              overflow: "hidden", marginBottom: 14,
            }}>
              <div style={{
                padding: "8px 12px", background: "var(--ivory)",
                fontSize: 11, fontWeight: 700, color: "var(--text-muted)",
                borderBottom: "1px solid var(--border)",
                display: "flex", alignItems: "center", justifyContent: "space-between",
                flexWrap: "wrap", gap: 8,
              }}>
                <span>עדכון שעות ספא בלבד — לא ייבאו חדרים</span>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {doc1SyncMode === "suite_spa_only" && (
                    <span style={{ fontSize: 10, fontWeight: 700, color: "#166534" }}>
                      לאורחי הסוויטות · לפי מס׳ הזמנה
                    </span>
                  )}
                  {doc1SyncMode !== "suite_spa_only" && (
                  <>
                  <button
                    type="button"
                    onClick={toggleSpaFilter}
                    style={{
                      padding: "4px 12px", borderRadius: 16, border: "1px solid var(--gold-dark)",
                      background: showOnlyWithSpa ? "rgba(201,169,110,0.12)" : "var(--gold)",
                      color: showOnlyWithSpa ? "var(--gold-dark)" : "#fff",
                      fontFamily: "Heebo,sans-serif", fontSize: 11, fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    {showOnlyWithSpa ? "👁 הצג את כל האורחים" : "💆 הצג רק עם ספא"}
                  </button>
                  <span style={{ fontSize: 10, fontWeight: 600 }}>
                    {displayDoc1Rec.length} / {doc1Rec.length}
                  </span>
                  </>
                  )}
                </div>
              </div>
              <div style={{ overflowX: "auto", maxHeight: 280 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 480 }}>
                  <thead>
                    <tr style={{ background: "var(--ivory)" }}>
                      {doc1PreviewHeaders.map(h => (
                        <th key={h} style={{
                          padding: "8px 12px", fontSize: 11, fontWeight: 700,
                          color: "var(--text-muted)", textAlign: "right",
                          borderBottom: "1px solid var(--border)",
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {displayDoc1Rec.length === 0 && showOnlyWithSpa && (
                      <tr>
                        <td colSpan={doc1PreviewHeaders.length} style={{
                          padding: "16px 12px", fontSize: 12, textAlign: "center",
                          color: "var(--text-muted)", fontWeight: 600,
                        }}>
                          אין אורחים עם שעת ספא בדוח — לחץ «הצג את כל האורחים» לראות את כולם
                        </td>
                      </tr>
                    )}
                    {displayDoc1Rec.slice(0, 80).map((r, i) => (
                      <tr key={i} style={{
                        borderBottom: "1px solid var(--border)",
                        background: i % 2 === 0 ? "#fff" : "var(--ivory)",
                      }}>
                        <td style={{ padding: "8px 12px", fontSize: 12, color: "var(--text-muted)" }}>{r.order_number ?? "—"}</td>
                        <td style={{ padding: "8px 12px", fontSize: 13, fontWeight: 600 }}>{r.guest_name ?? "—"}</td>
                        <td style={{ padding: "8px 12px", fontSize: 13, fontWeight: 800,
                          color: r.spa_time ? "var(--gold-dark)" : "var(--text-muted)" }}>
                          {r.spa_time ?? "—"}
                        </td>
                        {doc1SyncMode !== "suite_spa_only" && (
                        <td style={{ padding: "8px 12px", fontSize: 13, fontWeight: 800,
                          color: r.meal_time ? "#1a7a4a" : "var(--text-muted)" }}>
                          {r.meal_time ?? "—"}
                        </td>
                        )}
                        <td style={{ padding: "8px 12px", fontSize: 12, textAlign: "center" }}>
                          {r.treatment_count > 0 ? r.treatment_count : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Sync + reset buttons — visible when either doc is loaded */}
          {canSync && !result && (
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={handleSync}
                disabled={syncing || (hasDoc2 && syncTargetCount === 0)}
                style={{
                  flex: 1, padding: "13px", borderRadius: 12, border: "none",
                  background: syncing ? "rgba(255,255,255,0.08)" : "linear-gradient(135deg,var(--gold),var(--gold-dark))",
                  color: syncing ? "rgba(232,201,138,0.5)" : "#0F0F0F",
                  fontFamily: "Heebo, sans-serif", fontSize: 14, fontWeight: 800,
                  boxShadow: syncing ? "none" : "0 6px 22px rgba(201,169,110,0.4)",
                  cursor: syncing ? "not-allowed" : "pointer", transition: "all 0.15s",
                }}>
                {syncLabel}
              </button>
              <button onClick={reset} style={{
                padding: "13px 16px", borderRadius: 12,
                border: "1px solid rgba(201,169,110,0.3)", background: "rgba(255,255,255,0.05)",
                cursor: "pointer", fontFamily: "Heebo, sans-serif",
                fontSize: 13, color: "var(--gold-light)",
              }}>
                ✕ נקה
              </button>
            </div>
          )}

          {/* Result */}
          {result && (
            <div style={{
              background: "#d1fae5", border: "1px solid #6ee7b7",
              borderRadius: 12, padding: "20px",
            }}>
              <div style={{ fontSize: 32, marginBottom: 10 }}>✅</div>
              {result.mode === "suites" || result.mode === "detailed" ? (
                <>
                  <div style={{ fontWeight: 800, fontSize: 16, color: "#065f46", marginBottom: 6 }}>
                    יובאו {result.total} אורחים
                    {result.mode === "detailed" && result.batchType && result.batchType !== "mixed" && (
                      <> ({result.batchType === "suite" ? "סוויטות" : "בילוי יומי"})</>
                    )}
                    {result.corporateMuted > 0 && (
                      <> ({result.corporateMuted} מכירות — ללא אוטומציה)</>
                    )}
                  </div>
                  <div style={{ fontSize: 13, color: "#065f46", lineHeight: 1.9 }}>
                    🏨 {result.suites} סוויטות ·
                    ☀️ {result.days} בילוי יומי ·
                    🛏️ {result.rooms} חדרים
                    {result.spa > 0 && <> · 💆 {result.spa} עם שעת ספא</>}
                  </div>
                  {result.skippedRooms > 0 && (
                    <div style={{ fontSize: 12, color: "#92400E", marginTop: 6, fontWeight: 700 }}>
                      ⚠ {result.skippedRooms} שורות חדר דולגו (חסר מספר הזמנה או מזהה שורה) — לא סונכרנו ל-DB
                    </div>
                  )}
                  {result.skippedUnimportable > 0 && (
                    <div style={{ fontSize: 12, color: "#92400E", marginTop: 6, fontWeight: 700 }}>
                      ⛔ {result.skippedUnimportable} שורות «מטריית קבוצה» דולגו אוטומטית — לא סונכרנו ל-DB
                    </div>
                  )}
                  {result.conflictCount > 0 && (
                    <div style={{ fontSize: 12, color: "#92400E", marginTop: 6, fontWeight: 700 }}>
                      ⚠ {result.conflictCount} רשומות עם התנגשות מול הקיים ב-DB (שם/חדר/תאריך שונה) יובאו בכל זאת — בדוק:{" "}
                      {result.conflictNames.slice(0, 8).join(", ")}
                      {result.conflictNames.length > 8 && ` +${result.conflictNames.length - 8}`}
                    </div>
                  )}
                </>
              ) : result.mode === "suite_spa" ? (
                <div style={{ color: "#065f46" }}>
                  <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 6 }}>
                    💆 עודכנו {result.updated} אורחי סוויטות (מס׳ הזמנה + תאריך {result.arrivalDate})
                  </div>
                  <div style={{ fontSize: 13, lineHeight: 1.8 }}>
                    סה״כ {result.total} שורות «לאורחי הסוויטות» בדוח
                    {result.skipped > 0 && <> · {result.skipped} דולגו</>}
                  </div>
                  {result.notFound?.length > 0 && (
                    <div style={{ fontSize: 12, color: "#92400E", marginTop: 8, fontWeight: 700 }}>
                      ⚠ לא נמצאו במערכת (בדוק תאריך הגעה / ייבוא Doc 2):{" "}
                      {result.notFound.join(", ")}
                    </div>
                  )}
                </div>
              ) : result.mode === "suite_room_only" ? (
                <div style={{ color: "#065f46" }}>
                  <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 6 }}>
                    🏨 עודכנו {result.updated} שיבוצי סוויטות
                    {result.arrivalDate && <> (תאריך הגעה {result.arrivalDate})</>}
                  </div>
                  <div style={{ fontSize: 13, lineHeight: 1.8 }}>
                    סה״כ {result.total} שורות בקובץ
                    {result.skipped > 0 && <> · {result.skipped} דולגו</>}
                  </div>
                  {result.noRoom?.length > 0 && (
                    <div style={{ fontSize: 12, color: "#92400E", marginTop: 8, fontWeight: 700 }}>
                      ⚠ ללא חדר משויך בטבלה: {result.noRoom.slice(0, 8).join(", ")}
                      {result.noRoom.length > 8 && ` +${result.noRoom.length - 8}`}
                    </div>
                  )}
                  {result.ambiguous?.length > 0 && (
                    <div style={{ fontSize: 12, color: "#92400E", marginTop: 8, fontWeight: 700 }}>
                      ⚠ שם כפול במערכת (לא עודכן): {result.ambiguous.join(", ")}
                    </div>
                  )}
                  {result.notFound?.length > 0 && (
                    <div style={{ fontSize: 12, color: "#92400E", marginTop: 8, fontWeight: 700 }}>
                      ⚠ לא נמצאו במערכת: {result.notFound.slice(0, 10).join(", ")}
                      {result.notFound.length > 10 && ` +${result.notFound.length - 10}`}
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ color: "#065f46" }}>
                  {result.updated > 0 && (
                    <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 4 }}>
                      🔄 עודכנו {result.updated} אורחים קיימים
                    </div>
                  )}
                  {result.skipped > 0 && (
                    <div style={{ fontSize: 12, color: "#1d7a5a", marginTop: 4 }}>
                      {result.skipped} רשומות דולגו (ללא טלפון, לא נמצאו במערכת, או שגיאה)
                    </div>
                  )}
                </div>
              )}
              <button onClick={reset} style={{
                marginTop: 16, padding: "8px 18px", borderRadius: 8,
                border: "1px solid #6ee7b7", background: "transparent",
                color: "#065f46", cursor: "pointer",
                fontFamily: "Heebo, sans-serif", fontSize: 13, fontWeight: 700,
              }}>
                ← ייבוא נוסף
              </button>
            </div>
          )}
          </>)}

          {tab === "shifts" && (<>
            <div style={{
              background: "rgba(201,169,110,0.08)", border: "1px solid rgba(201,169,110,0.3)",
              borderRadius: 10, padding: "10px 14px", marginBottom: 14,
              fontSize: 12, color: "var(--gold-light)",
            }}>
              כל קובץ Excel — ערוך בגריד וייצא חזרה. לא נכתב ל-DB.
            </div>

            {!shiftRows.length ? (
              <DropZone
                label="📊 קובץ סידור משמרות"
                hint="כל Excel — עמודות נגזרות מהכותרות"
                loaded={false}
                fileName={shiftFileName}
                onFile={handleShiftFile}
                inputRef={shiftRef}
              />
            ) : (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                  <span style={{ fontWeight: 700, fontSize: 13, color: "var(--gold-light)" }}>{shiftFileName}</span>
                  <span style={{ fontSize: 12, color: "rgba(232,201,138,0.55)" }}>{shiftRows.length} שורות</span>
                  <div style={{ marginRight: "auto", display: "flex", gap: 8 }}>
                    <button onClick={handleShiftExport} style={{
                      padding: "8px 16px", borderRadius: 8, border: "1.5px solid #1e40af",
                      background: "#eff6ff", color: "#1e40af", fontFamily: "Heebo,sans-serif",
                      fontSize: 13, fontWeight: 700, cursor: "pointer",
                    }}>📥 ייצוא Excel</button>
                    <button onClick={() => { setShiftRows([]); setShiftCols([]); setShiftFileName(""); setShiftSelected(new Set()); }} style={{
                      padding: "8px 14px", borderRadius: 8, border: "1px solid var(--border)",
                      background: "var(--card-bg)", cursor: "pointer", fontFamily: "Heebo,sans-serif",
                      fontSize: 13, color: "var(--text-muted)",
                    }}>✕ נקה</button>
                  </div>
                </div>
                {shiftSelected.size > 0 && (
                  <BulkEditBar
                    count={shiftSelected.size}
                    columns={shiftCols}
                    onReplace={handleShiftReplace}
                    onClear={() => setShiftSelected(new Set())}
                  />
                )}
                <EditableGrid
                  columns={shiftCols}
                  rows={shiftRows}
                  onRowsChange={setShiftRows}
                  selectedIds={shiftSelected}
                  onSelectionChange={setShiftSelected}
                />
              </>
            )}
          </>)}
        </div>
      )}
    </div>
  );
}

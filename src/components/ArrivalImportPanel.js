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
  normalizeGuestPhoneEdit,
} from "../utils/ezgoParser";
import { mergeCandidates, classifyDbMatch, buildExistingGuestsLookup, findExistingGuestRow, buildMultiRoomLineIndexMap, formatMultiRoomLineLabel, bookingGuestKey, getDbMatchDiffLabels, buildEnrichGuestPatch, resolveCandidateRoomDisplay, buildCombinedRoomLabel, buildDoc2SyncActionLabel } from "../utils/guestImportIntelligence";
import { SUITE_ARRIVALS_SCHEMA, buildMaskedSample, detectSuiteArrivalsPreset, detectEzgoArrivalsPreset, applyFieldDefaultsToProfiles, parseMappingMemory, packMappingMemory, normalizeImportRows, normalizeImportHeaderKey, isMappingUsable, resolveImportMapping, matrixRowsFromHeaderScan, diagnoseEzgoPresetMiss, canonicalizeEzgoSuiteRows, EZGO_CORE_HEADERS } from "../utils/importMapper";
import {
  isDetailedReservationFormat,
  parseDetailedReservationRows,
  parseDetailedReservationCsvText,
  shouldParseDetailedReportAsText,
  detailedRowsToProfileMap,
  applyPriceResolutions,
  csvTextToRowObjects,
  parseCsvText,
} from "../utils/detailedReservationParser";
import PriceDiscrepancyModal from "./PriceDiscrepancyModal";
import { isSuiteGuestProfile } from "../utils/guestTiming";
import { validateSuiteProfilesDeparture, ensureMissingDepartureAlert } from "../utils/departureDateGuard";
import { resolveEzgoHtmlFromUpload, looksLikeEml } from "../utils/ezgoEmailHtml";
import { isSpaUpsellEligible } from "../utils/spaUpsellAudience";

// Sorted, joined header signature — matches import_mapping_memory.header_signature (migration 049).
// Not a hash: exact string equality is enough here and avoids a client-side hash dependency.
function _headerSignature(headers) {
  return [...headers].map(normalizeImportHeaderKey).sort().join("␟");
}

// ── Date / phone helpers ──────────────────────────────────────────────────────

const DUMMY_DATE_RE = /^01[/.-]01[/.-](1900|1970|2001)/;

function isSaturdayArrivalYmd(ymd) {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(String(ymd))) return false;
  const d = new Date(`${ymd}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.getUTCDay() === 6;
}

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

function _buildIndicesByGuestKey(syncIndices, merged, mergedCandidates, gridByProfileIdx = null) {
  const indicesByGuestKey = new Map();
  for (const i of syncIndices) {
    const g = merged[i];
    const c = mergedCandidates[i];
    const edited = gridByProfileIdx?.get(i);
    const key = bookingGuestKey({
      orderNumber: c.orderNumber ?? [...(g.orderNumbers ?? [])][0] ?? null,
      arrivalDate: c.arrivalDate ?? g.arrivalDate,
      guestPhone: (edited?.guestPhone ?? c.guestPhone ?? g.guestPhone) || null,
    });
    if (!key) continue;
    if (!indicesByGuestKey.has(key)) indicesByGuestKey.set(key, []);
    indicesByGuestKey.get(key).push(i);
  }
  return indicesByGuestKey;
}

function _buildSyncRoomsFromIndices(syncIndices, merged, mergedCandidates, gridByProfileIdx, importSource, detailedRoomFilter) {
  return syncIndices
    .flatMap((i) => {
      const g = merged[i];
      const c = mergedCandidates[i];
      const edited = gridByProfileIdx.get(i) ?? {};
      const roomOverride = edited.room || "";
      const profileType = importSource === "detailed"
        ? _resolveDetailedProfileType(g, detailedRoomFilter)
        : (g.hasDayBooking ? "day_use" : "suite");
      const isDayGuestRoom = profileType === "day_use";
      return (g.rooms ?? []).map((r) => ({
        resLineId: r.resLineId,
        orderNumber: r.orderNumber,
        roomName: r.roomName,
        suiteType: r.suiteType,
        roomDisplay: roomOverride
          || resolveCandidateRoomDisplay({
            roomName: r.roomName,
            suiteType: r.suiteType,
            isDayGuest: isDayGuestRoom,
          })
          || _bestGuessSuite(r.roomName, r.suiteType, isDayGuestRoom)
          || null,
        guestName: edited.guestName ?? c.guestName ?? g.guestName ?? "",
        guestPhone: (edited.guestPhone ?? c.guestPhone ?? g.guestPhone) || null,
        coordPhone: g.coordPhone ?? null,
        phoneSource: g.phoneSource,
        adults: r.adults,
        nights: r.nights,
        arrivalDate: c.arrivalDate ?? g.arrivalDate ?? null,
        checkinTime: r.checkinTime ?? null,
        checkoutTime: r.checkoutTime ?? null,
        isDayGuest: isDayGuestRoom,
      }));
    })
    .filter((r) => r.resLineId && r.orderNumber);
}

async function _applyDoc2RoomGuestPatches(supabase, {
  indicesByGuestKey,
  merged,
  mergedCandidates,
  gridByProfileIdx,
  existingGuestsLookup,
  forceOverwriteRoom = false,
}) {
  let roomsFilledCount = 0;
  let roomsSkippedExisting = 0;
  let multiRoomBookingCount = 0;
  let updated = 0;

  for (const [, indices] of indicesByGuestKey) {
    if (indices.length > 1) multiRoomBookingCount++;
    const roomLabels = [];
    let guestPhone;
    let profileArrivalDate;
    let orderNumber;

    for (const i of indices) {
      const g = merged[i];
      const c = mergedCandidates[i];
      const edited = gridByProfileIdx.get(i) ?? {};
      guestPhone = (edited.guestPhone ?? c.guestPhone ?? g.guestPhone) || null;
      profileArrivalDate = c.arrivalDate ?? g.arrivalDate;
      orderNumber = c.orderNumber ?? [...(g.orderNumbers ?? [])][0] ?? null;
      const roomDisplay = _resolveProfileRoomDisplay(g, edited.room);
      if (roomDisplay) roomLabels.push(roomDisplay);
    }

    const combinedRoom = buildCombinedRoomLabel(roomLabels);
    // No-phone guest — still assignable by order+date (same tier _scopeGuestRowQuery supports).
    if (!combinedRoom || !profileArrivalDate || (!guestPhone && !orderNumber)) continue;

    const existingRow = findExistingGuestRow(existingGuestsLookup, {
      guestPhone,
      arrivalDate: profileArrivalDate,
      orderNumber,
    });
    if (!existingRow) continue;

    const dbRoom = String(existingRow.room ?? "").trim();
    if (dbRoom === combinedRoom) continue;
    if (dbRoom && !forceOverwriteRoom) {
      roomsSkippedExisting++;
      continue;
    }

    const scoped = _scopeGuestRowQuery(
      supabase.from("guests").update({ room: combinedRoom }),
      { guestPhone, profileArrivalDate, orderNumber },
    );
    if (scoped) {
      const { error } = await scoped;
      if (error) throw new Error(error.message);
      roomsFilledCount++;
      updated++;
    }
  }

  return { roomsFilledCount, roomsSkippedExisting, multiRoomBookingCount, updated };
}

function _suiteAssignmentSyncDiagnostics(syncIndices, merged, mergedCandidates, gridByProfileIdx, existingGuestsLookup) {
  let skipped = 0;
  const notFound = [];
  const noRoom = [];

  for (const i of syncIndices) {
    const g = merged[i];
    const c = mergedCandidates[i];
    const edited = gridByProfileIdx.get(i) ?? {};
    const room = String(edited.room ?? _resolveProfileRoomDisplay(g, edited.room) ?? "").trim();
    const guestPhone = c?.guestPhone ?? g.guestPhone ?? edited.guestPhone ?? null;
    const orderNumber = String(
      edited.orderNumber ?? c?.orderNumber ?? [...(g.orderNumbers ?? [])][0] ?? "",
    ).trim();
    const profileArrival = c?.arrivalDate ?? g.arrivalDate ?? null;

    if (!room) {
      skipped++;
      noRoom.push(orderNumber || g.guestName || `שורה ${i + 1}`);
      continue;
    }
    if (!guestPhone && !orderNumber) {
      skipped++;
      notFound.push(`שורה ${i + 1}`);
      continue;
    }
    const guestRow = findExistingGuestRow(existingGuestsLookup, {
      guestPhone,
      arrivalDate: profileArrival,
      orderNumber: orderNumber || null,
    });
    if (!guestRow) {
      skipped++;
      notFound.push(orderNumber || g.guestName || guestPhone || `שורה ${i + 1}`);
    }
  }

  return {
    skipped,
    notFound: [...new Set(notFound)],
    noRoom: [...new Set(noRoom)],
  };
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

function _finalizeDoc1Ingest({ payload, records, syncMode, detectedDate, filenameForDate, dateSource }) {
  if (!records.length) {
    return {
      ok: false,
      errMsg: syncMode === "suite_spa_only"
        ? "לא נמצאו שורות «לאורחי הסוויטות» עם שעת ספא בדוח"
        : "לא נמצאו הזמנות בדוח — בדוק פורמט",
    };
  }
  let arrivalHint = detectedDate ?? null;
  let arrivalSource = dateSource ?? null;
  if (!arrivalHint && filenameForDate) {
    arrivalHint = _detectDateFromFilename(filenameForDate);
    if (arrivalHint) arrivalSource = "שם הקובץ";
  }
  return {
    ok: true,
    payload,
    records,
    arrivalHint,
    arrivalSource,
    toastMsg: syncMode === "suite_spa_only"
      ? `זוהו ${records.length} הזמנות ספא לסוויטות (לאורחי הסוויטות)`
      : `נטענו ${records.length} שורות מהדוח היומי`,
  };
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
    automationScope: g.automationScope ?? "full",
    automationMuted: g.automationScope === "muted" || !!g.automationMuted,
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
    automationScope: g.automationScope ?? "full",
    automationMuted: g.automationScope === "muted" || !!g.automationMuted,
    isDayGuest:   !!g.isDayGuest,
  };
}

const UMBRELLA_BADGE_LABEL = "⛔ מטריית קבוצה";
const SUSPICIOUS_NAME_BADGE_LABEL = "⚠ שם חשוד";
const NO_PHONE_BADGE_LABEL = "📵 אין טלפון";

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
// Prefetch builds indexes via buildExistingGuestsLookup(); findExistingGuestRow
// mirrors sync_suite_arrivals tier-1/2/3 (order+date+phone → unique order → phone).

function _emptyGuestsLookup() {
  return buildExistingGuestsLookup([]);
}

/** Scope guests UPDATE to the same row sync_suite_arrivals would target. */
function _scopeGuestRowQuery(query, { guestPhone, profileArrivalDate, orderNumber }) {
  if (orderNumber && profileArrivalDate && guestPhone) {
    return query
      .eq("order_number", orderNumber)
      .eq("arrival_date", profileArrivalDate)
      .eq("phone", guestPhone);
  }
  if (guestPhone && profileArrivalDate) {
    return query.eq("phone", guestPhone).eq("arrival_date", profileArrivalDate);
  }
  // No-phone guest (Sprint C DOCS2) — same order+date tier the RPC itself uses
  // to find this row (sync_suite_arrivals Tier-2). Without an order_number
  // there is no reliable key to scope an UPDATE by, so this patch (spa/meal/
  // room/automation_scope) is skipped for that row — same accepted gap as the
  // RPC's own no-phone/no-order duplicate-risk case.
  if (orderNumber && profileArrivalDate) {
    return query
      .eq("order_number", orderNumber)
      .eq("arrival_date", profileArrivalDate)
      .is("phone", null);
  }
  return null;
}

// ── Suite-CSV profiles → flat grid rows ──────────────────────────────────────
// One row per guest profile. Multi-room (group) profiles show a read-only
// "N rooms" count instead of a single editable room — picking a value there
// still works and applies uniformly to that profile's rooms on sync.
function _profilesToGridRows(merged, { suiteAssignmentOnly = false, badgeByIdx = null, existingGuestsLookup = null, dbMatchByIdx = null, dbDiffByIdx = null, multiRoomLineIndexMap = null, syncActionByIdx = null, importWithoutAutomation = true, groupCourtesyAutomation = true } = {}) {
  return merged.map((g, i) => {
    const singleRoom = (g.rooms ?? []).length === 1 ? g.rooms[0] : null;
    const isDay       = !!g.isDayGuest || !!singleRoom?.isDayGuest;
    const roomDisplay = _formatRoomForGrid(g);
    const orderNumber = [...(g.orderNumbers ?? [])][0] ?? "";
    const candidate = { guestPhone: g.guestPhone, arrivalDate: g.arrivalDate, orderNumber };
    const existingRow = existingGuestsLookup ? findExistingGuestRow(existingGuestsLookup, candidate) : null;
    const dbStatus = dbMatchByIdx?.get(i) ?? null;
    const multiRoomLabel = formatMultiRoomLineLabel(multiRoomLineIndexMap, i);
    const totalPrice  = (g.rooms ?? []).reduce((sum, r) => sum + (r.price || 0), 0);
    const qtyLabel    = multiRoomLabel
      || ((g.roomsQuantity ?? 0) > 1
        ? `${g.roomsQuantity} חדרים`
        : (g.rooms ?? []).length > 1 ? `${g.rooms.length} חדרים` : "");
    return {
      _id:          _gridRowId(g, i),
      _profileIdx:  i,
      guestName:    g.guestName ?? "",
      guestPhone:   g.guestPhone ?? "",
      orderNumber,
      phoneSource:  g.phoneSource === "individual" ? "פרטי" : "קואורד׳",
      leadSource:   g.leadSource ?? "",
      automationScope: _resolveGridAutomationScope(g, existingRow, dbStatus, importWithoutAutomation, groupCourtesyAutomation),
      roomCount:    qtyLabel,
      room:         roomDisplay,
      tier:         isDay ? "☀️ בילוי יומי" : "🏨 סוויטה",
      spa_time:     g.spa_time ?? "",
      meal_time:    g.meal_time ?? "",
      meal_location: g.meal_location ?? "",
      amount:       totalPrice || "",
      arrivalDate:  g.arrivalDate ?? "",
      importBadge:  _composeImportBadge(g.guestName, badgeByIdx?.get(i), g.guestPhone),
      dbDiff:       dbDiffByIdx?.get(i) ?? "",
      syncAction:   syncActionByIdx?.get(i) ?? "",
    };
  });
}

// Suspicious-name flag always wins visibility (data-quality issue takes
// priority over a DB-match status) — both are shown together when present so
// neither is hidden.
function _composeImportBadge(guestName, dbBadge, guestPhone) {
  const parts = [];
  if (!guestPhone) parts.push(NO_PHONE_BADGE_LABEL);
  if (_isSuspiciousGuestName(guestName)) parts.push(SUSPICIOUS_NAME_BADGE_LABEL);
  if (dbBadge) parts.push(dbBadge);
  return parts.join(" · ");
}

function _detailedProfilesToGridRows(merged, { badgeByIdx = null, existingGuestsLookup = null, dbMatchByIdx = null, dbDiffByIdx = null, importWithoutAutomation = true, groupCourtesyAutomation = true } = {}) {
  return merged.map((g, i) => {
    const totalPrice = (g.rooms ?? []).reduce((sum, r) => sum + (r.price || 0), 0);
    const nights = (g.rooms ?? []).reduce((mx, r) => Math.max(mx, r.nights || 0), 0);
    const orderNumber = [...(g.orderNumbers ?? [])][0] ?? "";
    const candidate = { guestPhone: g.guestPhone, arrivalDate: g.arrivalDate, orderNumber };
    const existingRow = existingGuestsLookup ? findExistingGuestRow(existingGuestsLookup, candidate) : null;
    const dbStatus = dbMatchByIdx?.get(i) ?? null;
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
      automationScope: _resolveGridAutomationScope(g, existingRow, dbStatus, importWithoutAutomation, groupCourtesyAutomation),
      importBadge:  _composeImportBadge(g.guestName, badgeByIdx?.get(i), g.guestPhone),
      dbDiff:       dbDiffByIdx?.get(i) ?? "",
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
export function _getSyncProfileIndices(merged, gridRows, { importSource, detailedRoomFilter, selectedIds, dbMatchByIdx, mergedCandidates }) {
  const gridByIdx = new Map(gridRows.map((r) => [r._profileIdx, r]));
  const indices = [];
  const conflicts = [];
  const skippedNoPhone = [];
  const createdWithoutPhone = [];
  let skippedUnimportable = 0;
  let skippedDeselected = 0;
  for (let i = 0; i < merged.length; i++) {
    const g = merged[i];
    const c = mergedCandidates?.[i];
    const row = gridByIdx.get(i);
    const rowId = row?._id ?? `row_${i}`;
    if (selectedIds.size > 0 && !selectedIds.has(rowId)) {
      skippedDeselected++;
      continue;
    }
    if (importSource === "detailed") {
      const hasRooms = _profileHasRooms(g);
      if (detailedRoomFilter === "suite" && !hasRooms) continue;
      if (detailedRoomFilter === "day_use" && hasRooms) continue;
    }
    const dbStatus = dbMatchByIdx?.get(i) ?? null;
    if (dbStatus === "unimportable") { skippedUnimportable++; continue; }
    const guestPhone = c?.guestPhone ?? g.guestPhone ?? row?.guestPhone;
    const guestName = String(row?.guestName ?? c?.guestName ?? g.guestName ?? "").trim();
    const orderNumber = String(row?.orderNumber ?? c?.orderNumber ?? [...(g.orderNumbers ?? [])][0] ?? "").trim();
    if (!guestPhone) {
      // Zero Data Loss (§0.1): a named/ordered row is never dropped just because
      // the phone is missing — it still syncs (guests.phone NULL, muted), only
      // truly-blank rows (no phone, no name, no order) are skipped outright.
      if (!guestName && !orderNumber) {
        skippedNoPhone.push({ idx: i, guestName: `שורה ${i + 1}`, orderNumber });
        continue;
      }
      createdWithoutPhone.push({ idx: i, guestName: guestName || `שורה ${i + 1}`, orderNumber });
    }
    if (dbStatus === "conflict") conflicts.push(i);
    indices.push(i);
  }
  return { indices, conflicts, skippedUnimportable, skippedNoPhone, createdWithoutPhone, skippedDeselected };
}

/** Targeted room-only sync — match existing guests by order_number or name. */
const AUTOMATION_SCOPE_OPTIONS = [
  { value: "full", label: "✅ מלא" },
  { value: "courtesy_only", label: "🔔 נימוסים (שלב 4)" },
  { value: "muted", label: "🔇 מושתק" },
];

const VALID_AUTOMATION_SCOPES = new Set(["full", "courtesy_only", "muted"]);

function _normalizeAutomationScope(val) {
  if (VALID_AUTOMATION_SCOPES.has(val)) return val;
  if (val === true || val === "true" || val === "muted" || val === "🔇 ללא אוטומציה") return "muted";
  if (val === "courtesy" || val === "🔔 נימוסים") return "courtesy_only";
  if (val === false || val === "false" || val === "active" || val === "✅ פעיל") return "full";
  return null;
}

/** Grid default — remark group occupants → courtesy_only when toggle on. */
function _resolveGridAutomationScope(g, existingRow, dbStatus, importWithoutAutomation, groupCourtesyAutomation) {
  if (existingRow?.automation_scope && VALID_AUTOMATION_SCOPES.has(existingRow.automation_scope)) {
    return existingRow.automation_scope;
  }
  if (existingRow?.automation_muted === true) return "muted";
  const fromProfile = _normalizeAutomationScope(g.automationScope);
  if (fromProfile) {
    if (fromProfile === "courtesy_only" && !groupCourtesyAutomation) return "muted";
    return fromProfile;
  }
  if (g.isRemarkGroupOccupant && groupCourtesyAutomation) return "courtesy_only";
  if (g.automationMuted) return "muted";
  if (dbStatus === "new" && importWithoutAutomation) return "muted";
  return "full";
}

/** Payload for sync_suite_arrivals — scope drives automation_muted in RPC. */
function _parseGridAutomationScope(editedVal, c, g, dbStatus, importWithoutAutomation, groupCourtesyAutomation) {
  const edited = _normalizeAutomationScope(editedVal);
  if (edited) return edited;
  const fromCandidate = _normalizeAutomationScope(c.automationScope ?? g.automationScope);
  if (fromCandidate) {
    if (fromCandidate === "courtesy_only" && !groupCourtesyAutomation) return "muted";
    return fromCandidate;
  }
  if (g.isRemarkGroupOccupant || c.isRemarkGroupOccupant) {
    return groupCourtesyAutomation ? "courtesy_only" : "muted";
  }
  if (!!(c.automationMuted ?? g.automationMuted)) return "muted";
  if (dbStatus === "new" && importWithoutAutomation) return "muted";
  return "full";
}

function _scopeToAutomationMuted(scope) {
  return scope === "muted";
}

const DETAILED_GRID_COLS = [
  { id: "guestName",     label: "שם אורח",      editable: true,  w: 150 },
  { id: "guestPhone",    label: "טלפון",         editable: true,  w: 120 },
  { id: "orderNumber",   label: "מספר הזמנה",    editable: false, w: 100 },
  { id: "arrivalDate",   label: "הגעה",          editable: false, w: 100 },
  { id: "amount",        label: "💰 סכום (₪)",   editable: true,  w: 100 },
  { id: "meal_location", label: "בסיס אירוח",    editable: false, w: 180 },
  { id: "rooms_count",   label: "מספר חדרים",    editable: false, w: 90  },
  { id: "nights",        label: "מספר לילות",    editable: false, w: 90  },
  { id: "leadSource",    label: "מקור הגעה",     editable: false, w: 120 },
  { id: "automationScope", label: "אוטומציה",    editable: true,  w: 130, options: AUTOMATION_SCOPE_OPTIONS },
  { id: "importBadge",  label: "סטטוס ייבוא",   editable: false, w: 130 },
  { id: "dbDiff",       label: "הבדל מול DB",   editable: false, w: 120 },
];

const SUITES_GRID_COLS = [
  { id: "guestName",   label: "שם אורח",   editable: true,  w: 150 },
  { id: "guestPhone",  label: "טלפון",      editable: true,  w: 120 },
  { id: "orderNumber", label: "מס׳ הזמנה",  editable: false, w: 100 },
  { id: "phoneSource", label: "מקור",       editable: false, w: 80  },
  { id: "leadSource",  label: "מקור הגעה",  editable: false, w: 100 },
  { id: "automationScope", label: "אוטומציה", editable: true, w: 130, options: AUTOMATION_SCOPE_OPTIONS },
  { id: "roomCount",   label: "קבוצה",      editable: false, w: 70  },
  { id: "tier",        label: "שכבה",       editable: false, w: 90  },
  { id: "room",        label: "🏨 חדר/סוויטה", editable: true, w: 190, gold: true, options: ROOM_OPTIONS },
  { id: "syncAction",  label: "פעולת סנכרון", editable: false, w: 160 },
  { id: "spa_time",    label: "שעת ספא",    editable: true,  w: 90  },
  { id: "meal_time",   label: "שעת ארוחה (ערמונים)", editable: true, w: 130 },
  { id: "meal_location", label: "בסיס אירוח", editable: false, w: 160 },
  { id: "amount",      label: "💰 סכום (₪)", editable: true, w: 100 },
  { id: "arrivalDate", label: "הגעה",       editable: false, w: 100 },
  { id: "importBadge", label: "סטטוס ייבוא", editable: false, w: 130 },
  { id: "dbDiff",      label: "הבדל מול DB", editable: false, w: 120 },
];

/** Focused preview columns for Doc 2 suite-assignment-only mode */
const SUITE_ASSIGNMENT_GRID_COLS = [
  { id: "guestName",   label: "שם אורח",       editable: true,  w: 180 },
  { id: "orderNumber", label: "מס׳ הזמנה",     editable: false, w: 110 },
  { id: "roomCount",   label: "חדר בהזמנה",    editable: false, w: 90 },
  { id: "room",        label: "🏨 חדר/סוויטה", editable: true,  w: 220, gold: true },
  { id: "syncAction",  label: "פעולת סנכרון",  editable: false, w: 160 },
  { id: "guestPhone",  label: "טלפון",         editable: true,  w: 120 },
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

export default function ArrivalImportPanel({ defaultOpen = false, onSpaUpsellNavigate } = {}) {
  const [open,     setOpen]     = useState(defaultOpen);
  const [tab,      setTab]      = useState("suites"); // "suites" | "shifts"

  // Suites profile state
  const [doc2Map,  setDoc2Map]  = useState(null);   // Map<key, profile> from Suite CSV
  const [doc1Rec,  setDoc1Rec]  = useState(null);   // [] from Daily Report Excel
  const [doc1SyncMode, setDoc1SyncMode] = useState("suite_spa_only"); // "full" | "suite_spa_only"
  const [doc2SyncMode, setDoc2SyncMode] = useState("enrich"); // "enrich" | "full" | "suite_assignment_only"
  const [suiteAssignmentForceRoom, setSuiteAssignmentForceRoom] = useState(false);
  const [rawDoc1Payload, setRawDoc1Payload] = useState(null); // { kind, data } for re-parse on mode change
  const [doc2Name, setDoc2Name] = useState("");
  const [doc1Name, setDoc1Name] = useState("");
  const [doc1PasteText, setDoc1PasteText] = useState("");
  const [ezgoEmailOpen, setEzgoEmailOpen] = useState(true);
  // Deterministic arrival date — staff sets this BEFORE dropping Doc 2; its
  // value at upload time becomes every profile's arrival date (no filename
  // or in-file date column is auto-parsed anymore).
  const [arrivalDate, setArrivalDate] = useState(_todayISO());
  const [merged,   setMerged]   = useState(null);   // enriched profiles array (doc2 + doc1 join)
  const [gridRows, setGridRows] = useState([]);      // editable grid rows derived from merged
  const [showOnlyWithSpa, setShowOnlyWithSpa] = useState(true); // default: spa-actionable rows only
  const [detailedRoomFilter, setDetailedRoomFilter] = useState("all"); // "all" | "suite" | "day_use"
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [importWithoutAutomation, setImportWithoutAutomation] = useState(true);
  const [groupCourtesyAutomation, setGroupCourtesyAutomation] = useState(true);
  const [syncing,  setSyncing]  = useState(false);
  const [result,   setResult]   = useState(null);
  const [toast,    setToast]    = useState(null);

  // ── Phase 2: batch dispatch_channel picker (guest-outbound Whapi rollout) ──
  // Purely opt-in — sets guests.dispatch_channel on staff-selected suite guests
  // from THIS sync batch only. Never sends anything itself (Queue's bulk Whapi
  // action in AutomationControlCenter does that) and never touches cron.
  const [syncedGuestsForWhapiPick, setSyncedGuestsForWhapiPick] = useState([]);
  const [whapiPickSelected, setWhapiPickSelected] = useState(new Set());
  const [whapiPickSaving, setWhapiPickSaving] = useState(false);
  const [whapiPickDone, setWhapiPickDone] = useState(false);
  const [whapiPickError, setWhapiPickError] = useState(null);

  // ── Spa upsell for day-pass guests without a treatment (Doc 1 "spa" mode) ──
  // Review-before-commit list of Doc 1 rows with no existing guest match and no
  // spa_time — staff confirms before any guests row is created (Zero Data Loss).
  const [daypassCreateCandidates, setDaypassCreateCandidates] = useState([]);
  const [daypassCreateSelected, setDaypassCreateSelected] = useState(new Set());
  const [daypassCreating, setDaypassCreating] = useState(false);
  const [daypassCreateError, setDaypassCreateError] = useState(null);
  const doc2Ref = useRef();
  const doc1Ref = useRef();
  const mappingReviewRef = useRef(null);

  // Resilient Import Agent — mapping review state (Doc 2 / Suite CSV only)
  const [mappingStage, setMappingStage] = useState("idle"); // "idle" | "suggesting" | "review"
  const [rawDoc2Rows,  setRawDoc2Rows]  = useState(null);   // parsed SheetJS rows, kept for re-processing after approval
  const [doc2Fallback, setDoc2Fallback] = useState(null);   // arrivalDate picker snapshot, captured at upload time
  const [aiSuggestion, setAiSuggestion] = useState(null);   // { mapping, defaults, recommendations, confidence, engine } | null
  const [aiError,      setAiError]      = useState(null);   // string | null — shown, never hidden, when the AI call failed
  const [autoDateBanner, setAutoDateBanner] = useState(null); // { date, source } | null — FAIL VISIBLE auto-detect notice
  const [presetMissDebug, setPresetMissDebug] = useState(null); // { headers, required, missing, matchedCount } | null — FAIL VISIBLE when Tier-0 EZGO preset doesn't match

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

  // Keep mapping gate visible: collapse Doc 1 email paste + scroll to approve bar.
  useEffect(() => {
    if (mappingStage !== "suggesting" && mappingStage !== "review") return;
    setEzgoEmailOpen(false);
    const t = requestAnimationFrame(() => {
      mappingReviewRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
    return () => cancelAnimationFrame(t);
  }, [mappingStage]);

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
      setDoc2SyncMode("enrich");
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
  const [existingGuestsLookup, setExistingGuestsLookup] = useState(_emptyGuestsLookup);

  useEffect(() => {
    let cancelled = false;
    if (!supabase || !mergedCandidates.length) {
      setExistingGuestsLookup(_emptyGuestsLookup());
      return;
    }
    const dates = [...new Set(mergedCandidates.map((c) => c.arrivalDate).filter(Boolean))];
    if (!dates.length) {
      setExistingGuestsLookup(_emptyGuestsLookup());
      return;
    }
    (async () => {
      const { data, error } = await supabase
        .from("guests")
        .select("id, phone, name, room, order_number, arrival_date, automation_muted, automation_scope, guest_index, spa_time, meal_time, meal_location, treatment_count, payment_amount, lead_source, departure_date")
        .in("arrival_date", dates);
      if (cancelled) return;
      if (error) {
        console.warn("[ArrivalImportPanel] existing-guest prefetch failed:", error.message);
        setExistingGuestsLookup(_emptyGuestsLookup());
        return;
      }
      setExistingGuestsLookup(buildExistingGuestsLookup(data ?? []));
    })();
    return () => { cancelled = true; };
  }, [mergedCandidates]);

  const multiRoomLineIndexMap = useMemo(
    () => buildMultiRoomLineIndexMap(mergedCandidates),
    [mergedCandidates],
  );

  const dbMatchByIdx = useMemo(() => {
    const map = new Map();
    mergedCandidates.forEach((c, i) => {
      map.set(i, classifyDbMatch(c, findExistingGuestRow(existingGuestsLookup, c)));
    });
    return map;
  }, [mergedCandidates, existingGuestsLookup]);

  const importBadgeByIdx = useMemo(() => {
    const map = new Map();
    dbMatchByIdx.forEach((status, i) => {
      const label = DB_MATCH_BADGE_LABEL[status];
      if (label) map.set(i, label);
    });
    return map;
  }, [dbMatchByIdx]);

  const dbDiffByIdx = useMemo(() => {
    const map = new Map();
    mergedCandidates.forEach((c, i) => {
      if (dbMatchByIdx.get(i) !== "conflict") return;
      const existingRow = findExistingGuestRow(existingGuestsLookup, c);
      const labels = getDbMatchDiffLabels(c, existingRow);
      if (labels.length) map.set(i, labels.join(" · "));
    });
    return map;
  }, [mergedCandidates, existingGuestsLookup, dbMatchByIdx]);

  const enrichOnlyMode = doc2SyncMode === "enrich" || doc2SyncMode === "suite_assignment_only";

  const syncActionByIdx = useMemo(() => {
    const map = new Map();
    const suiteAssign = doc2SyncMode === "suite_assignment_only" && importSource !== "detailed";
    const enrichOnly = enrichOnlyMode;
    mergedCandidates.forEach((c, i) => {
      const g = merged?.[i];
      const existingRow = findExistingGuestRow(existingGuestsLookup, c);
      const candidateRoom = resolveCandidateRoomDisplay(c)
        || _resolveProfileRoomDisplay(g ?? {}, "");
      map.set(i, buildDoc2SyncActionLabel({
        dbStatus: dbMatchByIdx.get(i) ?? null,
        existingRow,
        candidateRoom,
        enrichOnly,
        hasPhone: !!(c.guestPhone && String(c.guestPhone).trim()),
        multiRoomLabel: formatMultiRoomLineLabel(multiRoomLineIndexMap, i),
        suiteAssignmentForce: suiteAssign && suiteAssignmentForceRoom,
      }));
    });
    return map;
  }, [
    mergedCandidates,
    merged,
    existingGuestsLookup,
    dbMatchByIdx,
    multiRoomLineIndexMap,
    doc2SyncMode,
    importSource,
    enrichOnlyMode,
    suiteAssignmentForceRoom,
  ]);

  // Recompute grid rows when merged/db badges/import opt-in changes.
  // Manual cell edits live in gridRows state until the next full recompute.
  useEffect(() => {
    if (!merged) { setGridRows([]); return; }
    const suiteOnly = doc2SyncMode === "suite_assignment_only" && importSource !== "detailed";
    setGridRows(
      importSource === "detailed"
        ? _detailedProfilesToGridRows(merged, { badgeByIdx: importBadgeByIdx, existingGuestsLookup, dbMatchByIdx, dbDiffByIdx, importWithoutAutomation, groupCourtesyAutomation })
        : _profilesToGridRows(merged, { suiteAssignmentOnly: suiteOnly, badgeByIdx: importBadgeByIdx, existingGuestsLookup, dbMatchByIdx, dbDiffByIdx, multiRoomLineIndexMap, syncActionByIdx, importWithoutAutomation, groupCourtesyAutomation }),
    );
  }, [merged, importSource, doc2SyncMode, importBadgeByIdx, existingGuestsLookup, dbMatchByIdx, dbDiffByIdx, multiRoomLineIndexMap, syncActionByIdx, importWithoutAutomation, groupCourtesyAutomation]);

  const _applyDoc2Mapping = useCallback((finalMapping, appliedDefaults, rows, fallback, { saveMemory = true } = {}) => {
    const sampleRow = rows[0] ?? {};
    const headers = Object.keys(sampleRow);
    const resolvedMapping = resolveImportMapping(finalMapping, headers, sampleRow) ?? finalMapping;
    const profileMap = aggregateGuestProfiles(rows, resolvedMapping, fallback);
    applyFieldDefaultsToProfiles(profileMap, appliedDefaults);
    if (appliedDefaults.arrivalDate) {
      for (const profile of profileMap.values()) {
        if (!profile.arrivalDate) profile.arrivalDate = appliedDefaults.arrivalDate;
      }
    }
    for (const profile of profileMap.values()) {
      profile.arrivalDate = fallback;
    }
    if (!profileMap.size) return 0;

    setDoc2Map(profileMap);
    setImportSource(null);
    setMappingStage("idle");
    setAiSuggestion(null);
    setAiError(null);

    if (saveMemory && supabase) {
      const signature = _headerSignature(Object.keys(rows[0] ?? {}));
      supabase.from("import_mapping_memory")
        .upsert(
          {
            schema_key: "suite_arrivals",
            header_signature: signature,
            approved_mapping: packMappingMemory(resolvedMapping, appliedDefaults),
            last_used_at: new Date().toISOString(),
          },
          { onConflict: "schema_key,header_signature" },
        )
        .then(({ error }) => {
          if (error) console.warn("[ArrivalImportPanel] failed to save mapping memory:", error.message);
        });
    }
    return profileMap.size;
  }, []);

  // ── Parse Doc 2: Suite CSV → AI-suggested column mapping → review screen ──
  // The AI only proposes; aggregateGuestProfiles() runs unchanged once the
  // admin approves a mapping in MappingReviewPanel (see handleMappingApprove).
  const handleDoc2 = useCallback(async (file) => {
    if (!file) return;
    setImportSource(null);
    setDetailedFileName("");
    setDoc2Name(file.name);
    setResult(null);
    setPresetMissDebug(null);
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
        const matrix = parseCsvText(text);
        const scanned = matrixRowsFromHeaderScan(matrix);
        rows = scanned?.rows?.length ? scanned.rows : canonicalizeEzgoSuiteRows(csvTextToRowObjects(text));
      } else {
        const XLSX = await import("xlsx");
        const wb   = XLSX.read(buf, { type: "array", raw: false });
        const ws   = wb.Sheets[wb.SheetNames[0]];
        const matrix = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
        const scanned = matrixRowsFromHeaderScan(matrix);
        if (scanned?.rows?.length) {
          rows = canonicalizeEzgoSuiteRows(scanned.rows);
        } else {
          rows = canonicalizeEzgoSuiteRows(XLSX.utils.sheet_to_json(ws, { defval: "" }));
        }
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
      const fallback = detectedDate || arrivalDate || _todayISO();

      const ezgoPreset = detectEzgoArrivalsPreset(headers);
      const preset = ezgoPreset || detectSuiteArrivalsPreset(headers);

      // ── Tier 0: EZGO/PMS preset — synchronous, no DB, no AI (restores pre-Agent path)
      if (preset) {
        setPresetMissDebug(null);
        const count = _applyDoc2Mapping(preset, {}, rows, fallback);
        if (count) {
          showToast("ok", `✓ מיפוי EZGO אוטומטי — נטענו ${count} פרופילים`);
          return;
        }
        showToast("err", `מיפוי EZGO זוהה אך לא נמצאו שורות נתונים (${rows.length} שורות בקובץ)`);
        setMappingStage("idle");
        return;
      }

      // EZGO-shaped file (most columns) but line-id alias mismatch — never send to AI
      const ezgoDiag = diagnoseEzgoPresetMiss(headers);
      if (ezgoDiag.matchedCount >= EZGO_CORE_HEADERS.length) {
        showToast("err", `קובץ EZGO — חסרה עמודת מזהה שורה (iReservationsLineId או iResLineId). כותרות: ${ezgoDiag.headers.slice(0, 8).join(", ")}`);
        setPresetMissDebug(ezgoDiag);
        setMappingStage("idle");
        return;
      }

      // FAIL VISIBLE: not EZGO — unknown shape may need AI/manual mapping
      setPresetMissDebug(ezgoDiag);

      setMappingStage("suggesting");

      // ── Tier 1: mapping memory (unknown header shape only — never blocks preset)
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
          if (isMappingUsable(parsed.mapping)) {
            rememberedMapping = parsed.mapping;
            rememberedFieldDefaults = parsed.fieldDefaults;
          }
        }
      }

      if (rememberedMapping) {
        const count = _applyDoc2Mapping(
          rememberedMapping,
          rememberedFieldDefaults,
          rows,
          fallback,
        );
        if (count) {
          showToast("ok", `✓ מיפוי מוכר — נטענו ${count} פרופילים`);
          return;
        }
        setAiSuggestion({
          mapping: resolveImportMapping(rememberedMapping, headers, rows[0]) ?? rememberedMapping,
          defaults: {},
          fieldDefaults: rememberedFieldDefaults,
          confidence: {}, engine: "memory",
          recommendations: ["⚠ זיכרון מיפוי לא ייצר פרופילים — בדוק/י ידנית ואשר"],
        });
        setAiError(null);
        setMappingStage("review");
        return;
      }

      try {
        const sample = buildMaskedSample(rows, headers, 3);
        const { data, error } = await supabase.functions.invoke("suggest-import-mapping", {
          body: { schemaKey: "suite_arrivals", headers, sampleRows: sample },
        });
        if (error) throw new Error(error.message);
        if (!data?.ok) throw new Error(data?.error || "מיפוי AI נכשל");
        const resolved = resolveImportMapping(data.mapping, headers, rows[0]);
        setAiSuggestion({
          ...data,
          mapping: isMappingUsable(resolved) ? resolved : (data.mapping ?? {}),
        });
        setAiError(null);
      } catch (e) {
        const headerFallback = detectEzgoArrivalsPreset(headers) || detectSuiteArrivalsPreset(headers);
        if (headerFallback) {
          // Known preset, just the AI call itself failed — never show the
          // human-approval gate for a shape we already trust completely.
          setPresetMissDebug(null);
          const count = _applyDoc2Mapping(headerFallback, {}, rows, fallback);
          if (count) {
            showToast("ok", `✓ AI נכשל — הוחל מיפוי EZGO מוכן מראש, נטענו ${count} פרופילים`);
            return;
          }
          setAiSuggestion({
            mapping: resolveImportMapping(headerFallback, headers, rows[0]) ?? headerFallback,
            defaults: {},
            confidence: {},
            engine: "preset",
            recommendations: ["⚠ מיפוי EZGO מוכן מראש הוחל אך לא נמצאו שורות נתונים — בדוק/י ידנית ואשר"],
          });
          setAiError(null);
        } else {
          setAiSuggestion(null);
          setAiError(e.message);
        }
      }

      setMappingStage("review");
    } catch (err) {
      showToast("err", "שגיאה בקריאת Suite CSV: " + err.message);
      setMappingStage("idle");
    }
  }, [arrivalDate, _applyDoc2Mapping]);

  const handleMappingApprove = useCallback((finalMapping, appliedDefaults) => {
    if (!rawDoc2Rows) return;
    const count = _applyDoc2Mapping(finalMapping, appliedDefaults, rawDoc2Rows, doc2Fallback);
    if (!count) {
      showToast("err", "לא נמצאו פרופילים — בדוק את המיפוי או שהקובץ ריק");
      setMappingStage("review");
      return;
    }
    showToast("ok", `נטענו ${count} פרופילים — ערוך בטבלה ולחץ סנכרן`);
  }, [rawDoc2Rows, doc2Fallback, _applyDoc2Mapping]);

  const handleMappingCancel = useCallback(() => {
    setMappingStage("idle");
    setRawDoc2Rows(null);
    setDoc2Fallback(null);
    setAiSuggestion(null);
    setAiError(null);
    setDoc2Name("");
    setPresetMissDebug(null);
  }, []);

  // ── Parse Doc 1: Comprehensive Daily Report (Excel or EZGO HTML / Gmail .eml) ─
  const applyDoc1Result = useCallback((result, displayName) => {
    if (!result.ok) {
      showToast("err", result.errMsg);
      setRawDoc1Payload(null);
      setDoc1Rec(null);
      return;
    }
    if (result.arrivalHint) {
      setArrivalDate(result.arrivalHint);
      if (result.arrivalSource) {
        setAutoDateBanner({ date: result.arrivalHint, source: result.arrivalSource });
      }
    }
    setDoc1Name(displayName);
    setRawDoc1Payload(result.payload);
    showToast("ok", result.toastMsg);
  }, []);

  const handleDoc1 = useCallback(async (file) => {
    if (!file) return;
    setResult(null);
    try {
      const headSniff = await file.slice(0, 2048).text().catch(() => "");
      const looksEml = /\.eml$/i.test(file.name);
      const looksHtmlByName = /\.html?$/i.test(file.name);
      const looksHtmlByMime = file.type === "text/html";
      const resolvedFromHead = resolveEzgoHtmlFromUpload({ text: headSniff, filename: file.name });
      const isHtml = looksEml || looksHtmlByName || looksHtmlByMime
        || /<!DOCTYPE\s+html|<html[\s>]|<table[\s>]/i.test(headSniff.trimStart())
        || (!!resolvedFromHead && (looksEml || looksHtmlByName));

      let payload;
      let detectedDate = null;

      if (isHtml) {
        const rawText = await file.text();
        const htmlText = resolveEzgoHtmlFromUpload({ text: rawText, filename: file.name })
          ?? rawText.trimStart().replace(/^\uFEFF/, "");
        if (!/<table[\s>]/i.test(htmlText)) {
          showToast("err", "לא נמצאה טבלת EZGO בקובץ — הורד את המייל כ-.eml או HTML (לא העתקת טקסט מ-Gmail)");
          return;
        }
        payload = { kind: "html", data: htmlText };
        const preview = parseHtmlDailyReport(htmlText, _doc1ParseOpts(doc1SyncMode));
        detectedDate = preview.find((r) => r.arrival_date)?.arrival_date ?? null;
      } else {
        const XLSX = await import("xlsx");
        const buf  = await file.arrayBuffer();
        const wb   = XLSX.read(buf, { type: "array" });
        const ws   = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { defval: null, header: 1 });
        payload = { kind: "rows", data: rows };
        if (!detectedDate) {
          const firstDateRow = rows.find((row) => Array.isArray(row) && typeof row[0] === "number" && row[0] > 40000);
          if (firstDateRow) {
            detectedDate = _parseDate(firstDateRow[0]);
          }
        }
      }

      const records = _buildDoc1Records(payload, doc1SyncMode);
      const finalized = _finalizeDoc1Ingest({
        payload,
        records,
        syncMode: doc1SyncMode,
        detectedDate,
        filenameForDate: file.name,
        dateSource: isHtml && detectedDate ? "הדוח היומי (HTML)" : (detectedDate ? "תאריך בדוח (Excel)" : null),
      });
      applyDoc1Result(finalized, file.name);
    } catch (err) {
      showToast("err", "שגיאה בקריאת הדוח: " + err.message);
    }
  }, [doc1SyncMode, applyDoc1Result]);

  const handleDoc1Paste = useCallback(() => {
    const raw = doc1PasteText.trim();
    if (!raw) {
      showToast("err", "הדבק קוד HTML מהמייל או תוכן קובץ .eml");
      return;
    }
    setResult(null);
    try {
      const htmlText = resolveEzgoHtmlFromUpload({ text: raw, filename: looksLikeEml(raw) ? "paste.eml" : "paste.html" });
      if (!htmlText || !/<table[\s>]/i.test(htmlText)) {
        showToast("err", "לא זוהתה טבלת EZGO — הורד את המייל (⋮ → הורד הודעה) או «הצג מקור» → HTML. אל תעתיק טקסט גלוי מ-Gmail");
        return;
      }
      const payload = { kind: "html", data: htmlText };
      const preview = parseHtmlDailyReport(htmlText, _doc1ParseOpts(doc1SyncMode));
      const detectedDate = preview.find((r) => r.arrival_date)?.arrival_date ?? null;
      const records = _buildDoc1Records(payload, doc1SyncMode);
      const finalized = _finalizeDoc1Ingest({
        payload,
        records,
        syncMode: doc1SyncMode,
        detectedDate,
        filenameForDate: null,
        dateSource: detectedDate ? "הדוח היומי (HTML)" : null,
      });
      applyDoc1Result(finalized, "מייל EZGO (הדבקה)");
      setDoc1PasteText("");
    } catch (err) {
      showToast("err", "שגיאה בפענוח ההדבקה: " + err.message);
    }
  }, [doc1PasteText, doc1SyncMode, applyDoc1Result]);

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
      const prevById = new Map(prev.map((r) => [r._id, r]));
      const patch = new Map();
      for (const row of updatedRows) {
        const prevRow = prevById.get(row._id);
        if (prevRow && row.guestPhone !== prevRow.guestPhone) {
          const { value, valid } = normalizeGuestPhoneEdit(row.guestPhone);
          if (!valid) {
            showToast("err", `מספר טלפון לא תקין — "${row.guestPhone}" לא נשמר`);
            patch.set(row._id, { ...row, guestPhone: prevRow.guestPhone });
            continue;
          }
          // Grid state convention for this column is "" (never null) for no-value
          // — every ?? fallback chain downstream (rawProfiles, UPDATE loop) relies
          // on that to tell "staff cleared it" apart from "grid row not found".
          patch.set(row._id, { ...row, guestPhone: value ?? "" });
          continue;
        }
        patch.set(row._id, row);
      }
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
    setSyncedGuestsForWhapiPick([]);
    setWhapiPickDone(false);
    setWhapiPickError(null);
    try {

      // ── PATH A: Suite CSV loaded (rooms + guests + bookings) ─────────────
      if (hasDoc2 && merged) {
        const gridByProfileIdx = new Map(gridRows.map((r) => [r._profileIdx, r]));
        const { indices: syncIndices, conflicts, skippedUnimportable, skippedNoPhone, createdWithoutPhone, skippedDeselected } = _getSyncProfileIndices(merged, gridRows, {
          importSource,
          detailedRoomFilter,
          selectedIds,
          dbMatchByIdx,
          mergedCandidates,
        });
        if (!syncIndices.length) {
          showToast("err", skippedUnimportable > 0
            ? `כל ${skippedUnimportable} הרשומות בסינון הנוכחי סווגו כ"מטריית קבוצה" (⛔) ולא יובאו`
            : "אין רשומות לייבוא לפי הסינון הנוכחי");
          return;
        }

        if (doc2SyncMode === "suite_assignment_only" && importSource !== "detailed") {
          const indicesByGuestKey = _buildIndicesByGuestKey(syncIndices, merged, mergedCandidates, gridByProfileIdx);
          const rooms = _buildSyncRoomsFromIndices(
            syncIndices, merged, mergedCandidates, gridByProfileIdx, importSource, detailedRoomFilter,
          );

          const { data: rpcData, error: rpcErr } = await supabase.rpc("sync_suite_arrivals", {
            payload: { profiles: [], rooms, enrichOnly: true },
          });
          if (rpcErr) throw new Error("sync_suite_arrivals: " + rpcErr.message);

          const patchStats = await _applyDoc2RoomGuestPatches(supabase, {
            indicesByGuestKey,
            merged,
            mergedCandidates,
            gridByProfileIdx,
            existingGuestsLookup,
            forceOverwriteRoom: suiteAssignmentForceRoom,
          });
          const diag = _suiteAssignmentSyncDiagnostics(
            syncIndices, merged, mergedCandidates, gridByProfileIdx, existingGuestsLookup,
          );

          setResult({
            mode: "suite_room_only",
            updated: patchStats.updated,
            roomsFilled: patchStats.roomsFilledCount,
            roomsSkippedExisting: patchStats.roomsSkippedExisting,
            multiRoomBookings: patchStats.multiRoomBookingCount,
            skipped: diag.skipped,
            notFound: diag.notFound,
            noRoom: diag.noRoom,
            total: syncIndices.length,
            arrivalDate,
            forceOverwriteRoom: suiteAssignmentForceRoom,
            rooms: rpcData?.rooms ?? rooms.length,
            skippedRooms: rpcData?.skipped ?? 0,
          });
          return;
        }

        // Sprint 3: mergedCandidates[i] (Guest Import Intelligence merge — remark >
        // ops > detailed identity, ops-sourced spa/meal, detailed/arrivals price+
        // nights+leadSource+automationMuted per FIELD_SOURCE_PRIORITY) is the source
        // of truth here, not the raw per-source profile alone. `g` (merged[i]) is
        // still consulted for fields the candidate model doesn't carry — the
        // per-room breakdown (g.rooms/resLineId/coordPhone) is arrivals-only detail
        // that classifyDbMatch/mergeCandidates never needed to model.
        const rawProfiles = syncIndices.map((i) => {
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
            const isDay = !isSuiteProfile;
            const departureDate = isDay
              ? profileArrivalDate
              : (_addNights(profileArrivalDate, nights) ?? null);
            return {
              // Staff edit in grid wins at sync time (same rule as room, see
              // _resolveProfileRoomDisplay) — a phone typed into the DOCS2 grid
              // must reach the RPC even though the source file had none. "" (grid's
              // no-value convention) is normalized to null before it leaves this file.
              guestPhone:      (edited.guestPhone ?? c.guestPhone ?? g.guestPhone) || null,
              guestName:       edited.guestName ?? c.guestName ?? g.guestName ?? "",
              arrivalDate:     profileArrivalDate,
              departureDate,
              orderNumber:     c.orderNumber ?? [...(g.orderNumbers ?? [])][0] ?? null,
              hasSuite:        isSuiteProfile,
              isDayGuest:      !isSuiteProfile,
              profile_type:    profileType,
              treatment_count: c.treatment_count ?? g.treatment_count ?? 0,
              paymentAmount:   editedAmount ?? (computedAmount || null),
              leadSource:      c.leadSource ?? g.leadSource ?? null,
              automationScope: _parseGridAutomationScope(
                edited.automationScope,
                c,
                g,
                dbMatchByIdx.get(i) ?? null,
                importWithoutAutomation,
                groupCourtesyAutomation,
              ),
              automationMuted: _scopeToAutomationMuted(_parseGridAutomationScope(
                edited.automationScope,
                c,
                g,
                dbMatchByIdx.get(i) ?? null,
                importWithoutAutomation,
                groupCourtesyAutomation,
              )),
              nights,
            };
          });

        // One guests row per booking — N CSV room lines → 1 profile + N suite_rooms
        const profiles = [];
        const profileSlotByKey = new Map();
        for (const profile of rawProfiles) {
          const key = bookingGuestKey(profile);
          if (!key) {
            profiles.push(profile);
            continue;
          }
          if (!profileSlotByKey.has(key)) {
            profileSlotByKey.set(key, profiles.length);
            profiles.push({ ...profile });
            continue;
          }
          const slot = profiles[profileSlotByKey.get(key)];
          slot.treatment_count = (slot.treatment_count || 0) + (profile.treatment_count || 0);
          if (profile.paymentAmount != null) {
            slot.paymentAmount = (slot.paymentAmount || 0) + Number(profile.paymentAmount);
          }
          if ((profile.nights || 0) > (slot.nights || 0)) slot.nights = profile.nights;
        }

        const departureBlocked = validateSuiteProfilesDeparture(profiles);
        if (departureBlocked.length > 0) {
          const sample = departureBlocked
            .slice(0, 3)
            .map((b) => `${b.name} (הגעה ${b.arrivalDate}, לילות: ${b.nights ?? "?"})`)
            .join(" · ");
          showToast(
            "err",
            `חסר תאריך עזיבה ל-${departureBlocked.length} אורחי סוויטה — בדוק עמודת לילות / NIGHTS / iNights. ${sample}`,
          );
          return;
        }

        const indicesByGuestKey = _buildIndicesByGuestKey(syncIndices, merged, mergedCandidates, gridByProfileIdx);

        const rooms = _buildSyncRoomsFromIndices(
          syncIndices, merged, mergedCandidates, gridByProfileIdx, importSource, detailedRoomFilter,
        );

        const batchProfileType = importSource === "detailed"
          ? (detailedRoomFilter === "all" ? "mixed" : detailedRoomFilter)
          : "mixed";

        const enrichOnly = doc2SyncMode === "enrich";

        const { data: rpcData, error: rpcErr } = await supabase
          .rpc("sync_suite_arrivals", {
            payload: {
              profiles,
              rooms,
              profile_batch_type: batchProfileType,
              enrichOnly,
            },
          });
        if (rpcErr) throw new Error("sync_suite_arrivals: " + rpcErr.message);

        let roomsFilledCount = 0;
        let roomsSkippedExisting = 0;
        let multiRoomBookingCount = 0;

        for (const [, indices] of indicesByGuestKey) {
          let patch = {};
          let guestPhone;
          let profileArrivalDate;
          let orderNumber;
          const roomLabels = [];
          let treatmentSum = 0;
          let notesMerged = "";

          for (const i of indices) {
            const g = merged[i];
            const c = mergedCandidates[i];
            const edited = gridByProfileIdx.get(i) ?? {};
            guestPhone = (edited.guestPhone ?? c.guestPhone ?? g.guestPhone) || null;
            profileArrivalDate = c.arrivalDate ?? g.arrivalDate;
            orderNumber = c.orderNumber ?? [...(g.orderNumbers ?? [])][0] ?? null;
            const roomDisplay = _resolveProfileRoomDisplay(g, edited.room);
            if (roomDisplay) roomLabels.push(roomDisplay);
            const spaTime = edited.spa_time || c.spa_time || g.spa_time;
            const mealTime = edited.meal_time || c.meal_time || g.meal_time;
            const mealLoc = edited.meal_location || c.meal_location || g.meal_location;
            const notes = g.guest_notes;
            const tc = c.treatment_count ?? g.treatment_count;
            if (tc != null && tc > 0) treatmentSum += tc;
            if (spaTime) {
              patch.spa_time = spaTime;
              if (profileArrivalDate) patch.spa_date = profileArrivalDate;
            }
            if (mealTime) patch.meal_time = mealTime;
            if (mealLoc) patch.meal_location = mealLoc;
            if (notes) notesMerged = notesMerged ? `${notesMerged}\n${notes}` : notes;
          }

          if (indices.length > 1) multiRoomBookingCount++;

          if (treatmentSum > 0) patch.treatment_count = treatmentSum;
          const combinedRoom = buildCombinedRoomLabel(roomLabels);
          if (combinedRoom) patch.room = combinedRoom;
          if (notesMerged) patch.guest_notes = notesMerged;

          const primaryIdx = indices[0];
          const primaryDbStatus = dbMatchByIdx.get(primaryIdx) ?? null;
          const primaryG = merged[primaryIdx];
          const primaryC = mergedCandidates[primaryIdx];
          const primaryEdited = gridByProfileIdx.get(primaryIdx) ?? {};
          const existingRow = findExistingGuestRow(existingGuestsLookup, {
            guestPhone,
            arrivalDate: profileArrivalDate,
            orderNumber,
          });
          const patchBeforeEnrich = { ...patch };
          if (enrichOnly && existingRow && primaryDbStatus !== "new") {
            patch = buildEnrichGuestPatch(patch, existingRow);
          }
          if (patchBeforeEnrich.room && !patch.room && existingRow?.room) {
            roomsSkippedExisting++;
          } else if (patch.room) {
            roomsFilledCount++;
          }
          const resolvedScope = _parseGridAutomationScope(
            primaryEdited.automationScope,
            primaryC,
            primaryG,
            primaryDbStatus,
            importWithoutAutomation,
            groupCourtesyAutomation,
          );
          if (resolvedScope !== "full" && existingRow?.automation_scope !== resolvedScope) {
            patch.automation_scope = resolvedScope;
            patch.automation_muted = resolvedScope === "muted";
          }

          if ((guestPhone || orderNumber) && profileArrivalDate && Object.keys(patch).length > 0) {
            const scoped = _scopeGuestRowQuery(
              supabase.from("guests").update(patch),
              { guestPhone, profileArrivalDate, orderNumber },
            );
            if (scoped) await scoped;
          }
          // bookings has no no-phone counterpart (phone NOT NULL, see migration
          // 190) — this block stays phone-gated on purpose.
          if (guestPhone && profileArrivalDate) {
            const roomLineCount = indices.length;
            const qtyFromProfile = merged[indices[0]]?.roomsQuantity;
            await supabase.from("bookings").update({
              room_count: (qtyFromProfile > 0 ? qtyFromProfile : roomLineCount),
            })
              .eq("phone", guestPhone.replace(/^\+/, ""))
              .eq("arrival_date", profileArrivalDate);
          }
        }

        const syncedMerged = syncIndices.map((i) => merged[i]);
        const importCourtesy = profiles.filter((p) => p.automationScope === "courtesy_only").length;
        const importMuted = profiles.filter((p) => p.automationScope === "muted").length;
        const groupOccupants = syncedMerged.filter((g) => g.isRemarkGroupOccupant).length;
        const uniqueGuestCount = indicesByGuestKey.size || profiles.length;
        const newCount = syncIndices.filter((i) => dbMatchByIdx.get(i) === "new").length;
        const enrichedCount = syncIndices.filter((i) => {
          const s = dbMatchByIdx.get(i);
          return s === "existing" || s === "conflict";
        }).length;
        setResult({
          mode:   importSource === "detailed" ? "detailed" : "suites",
          enrichOnly,
          newCount,
          enrichedCount,
          roomsFilledCount,
          roomsSkippedExisting,
          multiRoomBookingCount,
          total:  uniqueGuestCount,
          rooms:  rpcData?.rooms  ?? rooms.length,
          skippedRooms: rpcData?.skipped ?? 0,
          suites: profiles.filter((p) => p.hasSuite).length,
          days:   profiles.filter((p) => p.isDayGuest).length,
          spa:    syncIndices.filter((i) => gridByProfileIdx.get(i)?.spa_time).length,
          corporateMuted: groupOccupants,
          importCourtesy,
          importMuted,
          batchType: batchProfileType,
          skippedUnimportable,
          skippedNoPhone,
          createdWithoutPhone,
          createdWithoutPhoneCount: rpcData?.createdWithoutPhone ?? createdWithoutPhone.length,
          skippedDeselected,
          conflictCount: conflicts.length,
          conflictNames: conflicts.map((i) =>
            gridByProfileIdx.get(i)?.guestName || mergedCandidates[i]?.guestName || `שורה ${i + 1}`),
        });

        // ── Phase 2: batch dispatch_channel picker ──────────────────────────
        // Purely additive read — reuses the phones already computed above for
        // this sync batch (profiles), does not touch the patch loop. Suite-only
        // (מכשיר הסוויטות is a suites device; day-pass guests can't use it).
        try {
          const syncedPhones = [...new Set(profiles.map((p) => p.guestPhone).filter(Boolean))];
          if (syncedPhones.length > 0) {
            const { data: syncedGuestRows, error: syncedLookupErr } = await supabase
              .from("guests")
              .select("id, name, phone, room, room_type, dispatch_channel, arrival_date")
              .in("phone", syncedPhones);
            if (syncedLookupErr) throw syncedLookupErr;
            const suiteRows = (syncedGuestRows ?? []).filter((g) => isSuiteGuestProfile(g));
            setSyncedGuestsForWhapiPick(suiteRows);
            const autoShabbatIds = suiteRows
              .filter((g) => g.dispatch_channel !== "whapi" && isSaturdayArrivalYmd(g.arrival_date))
              .map((g) => g.id);
            setWhapiPickSelected(new Set(autoShabbatIds));
          } else {
            setSyncedGuestsForWhapiPick([]);
          }
        } catch (e) {
          console.warn("[ArrivalImportPanel] dispatch_channel picker guest lookup failed (non-blocking):", e?.message);
          setSyncedGuestsForWhapiPick([]);
        }
        setWhapiPickDone(false);
        setWhapiPickError(null);

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
        let upsellCount = 0;
        const daypassCandidates = [];

        if (allPhones.length > 0) {
          const { data: existingRows } = await supabase
            .from("guests")
            .select("id, phone, name, room_type, room, spa_date, arrival_date, status, msg_spa_upsell_sent")
            .in("phone", allPhones);
          const existingByPhone = new Map((existingRows ?? []).map(g => [g.phone, g]));

          for (const rec of doc1Rec) {
            if (!rec.phone) { skipped++; continue; }

            const existing = existingByPhone.get(rec.phone);
            if (existing) {
              const patch = {};
              if (rec.spa_time) {
                patch.spa_time = rec.spa_time;
                if (rec.arrival_date) patch.spa_date = rec.arrival_date;
              }
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

              const recArrival = rec.arrival_date || existing.arrival_date || arrivalDate;
              if (
                isSpaUpsellEligible(
                  { ...existing, spa_time: rec.spa_time || existing.spa_time, spa_date: rec.spa_time ? (rec.arrival_date || existing.spa_date) : existing.spa_date },
                  recArrival,
                )
              ) {
                upsellCount++;
              }
            } else if (!rec.spa_time) {
              // No existing profile AND no spa this visit — candidate for a
              // brand-new day-pass guest profile (staff reviews before create).
              daypassCandidates.push(rec);
              skipped++;
            } else {
              // Has a spa booking but no matching guest yet — enrichment-only
              // path, never insert (unusual: spa without a profile at all).
              skipped++;
            }
          }
        } else {
          skipped = doc1Rec.length;
        }
        setDaypassCreateCandidates(daypassCandidates);
        setDaypassCreateSelected(new Set(daypassCandidates.map((_, i) => i)));
        setResult({ mode: "spa", updated, skipped, upsellCount, daypassCandidateCount: daypassCandidates.length, arrivalDate });
        }
      }

    } catch (err) {
      showToast("err", "שגיאת סנכרון: " + err.message);
    } finally {
      setSyncing(false);
    }
  };

  // ── Phase 2: batch dispatch_channel picker — sets guests.dispatch_channel
  // on staff-selected guests from this sync only. Opt-in, never retroactive
  // (only touches the ids staff explicitly checked just now); does not send
  // anything — dispatch actually happens later via ACC's Queue / manual send.
  const toggleWhapiPick = (id) => {
    setWhapiPickSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleWhapiPickAll = () => {
    setWhapiPickSelected((prev) =>
      prev.size === syncedGuestsForWhapiPick.length
        ? new Set()
        : new Set(syncedGuestsForWhapiPick.map((g) => g.id)),
    );
  };
  const handleWhapiPickConfirm = async () => {
    if (!supabase || whapiPickSelected.size === 0) return;
    setWhapiPickSaving(true);
    setWhapiPickError(null);
    try {
      const ids = [...whapiPickSelected];
      const { error } = await supabase
        .from("guests")
        .update({ dispatch_channel: "whapi" })
        .in("id", ids);
      if (error) throw error;
      setSyncedGuestsForWhapiPick((prev) =>
        prev.map((g) => (ids.includes(g.id) ? { ...g, dispatch_channel: "whapi" } : g)),
      );
      setWhapiPickSelected(new Set());
      setWhapiPickDone(true);
      showToast("ok", `📱 ${ids.length} אורחים שויכו למכשיר הסוויטות`);
    } catch (err) {
      setWhapiPickError(err?.message ?? String(err));
    } finally {
      setWhapiPickSaving(false);
    }
  };

  // ── Day-pass profile creation from unmatched Doc 1 rows (no phone match, no spa) ──
  const toggleDaypassCreate = (idx) => {
    setDaypassCreateSelected((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  };
  const toggleDaypassCreateAll = () => {
    setDaypassCreateSelected((prev) =>
      prev.size === daypassCreateCandidates.length
        ? new Set()
        : new Set(daypassCreateCandidates.map((_, i) => i)),
    );
  };
  const handleCreateDaypassProfiles = async () => {
    if (!supabase || daypassCreateSelected.size === 0) return;
    setDaypassCreating(true);
    setDaypassCreateError(null);
    try {
      const rows = [...daypassCreateSelected].map((i) => daypassCreateCandidates[i]).filter(Boolean);
      const created = [];
      for (const rec of rows) {
        const recArrivalDate = rec.arrival_date || arrivalDate;
        const { data: inserted, error } = await supabase
          .from("guests")
          .insert({
            phone: rec.phone,
            name: rec.guest_name || null,
            arrival_date: recArrivalDate,
            departure_date: recArrivalDate,
            room_type: "day_guest",
            room: "Premium Day 1",
            status: "pending",
            order_number: rec.order_number || null,
            treatment_count: rec.treatment_count ?? 0,
            meal_time: rec.meal_time || null,
            meal_location: rec.meal_location || null,
          })
          .select("id, name, phone")
          .maybeSingle();
        if (error) { setDaypassCreateError(error.message); continue; }
        if (inserted) {
          created.push(inserted);
          // bookings.phone is digits-only, no "+" (Meta webhook convention).
          await supabase.from("bookings").upsert({
            phone: rec.phone.replace(/^\+/, ""),
            guest_name: rec.guest_name || null,
            arrival_date: recArrivalDate,
            status: "expected",
            room_count: 1,
          }, { onConflict: "phone,arrival_date" });
        }
      }
      if (created.length > 0) {
        showToast("ok", `☀️ נוצרו ${created.length} פרופילי בילוי יומי — עברו ללשונית «הצעת ספא» לשליחה`);
      }
      setDaypassCreateCandidates((prev) => prev.filter((_, i) => !daypassCreateSelected.has(i)));
      setDaypassCreateSelected(new Set());
    } catch (err) {
      setDaypassCreateError(err?.message ?? String(err));
    } finally {
      setDaypassCreating(false);
    }
  };

  const reset = () => {
    setDoc2Map(null); setDoc1Rec(null); setRawDoc1Payload(null);
    setDoc2Name(""); setDoc1Name("");
    setDoc1SyncMode("suite_spa_only");
    setDoc2SyncMode("enrich");
    setSuiteAssignmentForceRoom(false);
    setMerged(null); setGridRows([]); setShowOnlyWithSpa(true);
    setDetailedRoomFilter("all"); setSelectedIds(new Set()); setResult(null);
    setSyncedGuestsForWhapiPick([]); setWhapiPickSelected(new Set());
    setWhapiPickDone(false); setWhapiPickError(null);
    setDaypassCreateCandidates([]); setDaypassCreateSelected(new Set()); setDaypassCreateError(null);
    setMappingStage("idle"); setRawDoc2Rows(null); setDoc2Fallback(null);
    setAiSuggestion(null); setAiError(null); setAutoDateBanner(null);
    setImportSource(null); setDetailedFileName("");
    setPendingDetailedRows(null); setPriceConflictQueue(null);
    setPriceConflictIdx(0); setPriceResolutions({});
    setImportWithoutAutomation(true);
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
      mergedCandidates,
    }).indices.length;
  }, [merged, gridRows, importSource, detailedRoomFilter, selectedIds, dbMatchByIdx, mergedCandidates]);

  const syncEligibility = useMemo(() => {
    if (!merged?.length) return null;
    const r = _getSyncProfileIndices(merged, gridRows, {
      importSource,
      detailedRoomFilter,
      selectedIds,
      dbMatchByIdx,
      mergedCandidates,
    });
    return {
      total: merged.length,
      ready: r.indices.length,
      skippedNoPhone: r.skippedNoPhone,
      createdWithoutPhone: r.createdWithoutPhone,
      skippedUnimportable: r.skippedUnimportable,
      skippedDeselected: r.skippedDeselected,
    };
  }, [merged, gridRows, importSource, detailedRoomFilter, selectedIds, dbMatchByIdx, mergedCandidates]);

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
        : doc2SyncMode === "enrich"
          ? `📥 השלם נתונים חסרים / צור חדש (${syncTargetCount} רשומות)`
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
        courtesy:   gridRows.filter(r => r.automationScope === "courtesy_only").length,
        muted:      gridRows.filter(r => r.automationScope === "muted").length,
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
            <strong>Doc 1 — דוח יומי מקיף (Excel / HTML / מייל EZGO):</strong> עדכון שעות ספא + HB/FB · <strong>📧 ממייל Operations</strong> — הורד .eml מ-Gmail או הדבק HTML (ראה למטה)<br />
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
                    key: "enrich",
                    label: "📥 השלמת פרופיל (מומלץ)",
                  },
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
              {doc2SyncMode === "enrich" && hasDoc2 && (
                <div style={{
                  marginTop: 8, padding: "8px 12px", borderRadius: 8, fontSize: 11,
                  background: "var(--ivory)", border: "1px solid var(--border)",
                  color: "var(--black)", fontWeight: 600, lineHeight: 1.5,
                }}>
                  ממלא רק שדות <strong>ריקים</strong> בפרופיל קיים — חדר/סוויטה מ-Doc 2 נכנס רק אם ריק ב-DB.
                  כל שורת חדר בהזמנה נשמרת בטבלת שורות-חדר (suite_rooms) — הודעת «חדר מוכן» לכל סוויטה בנפרד.
                  עמודת «פעולת סנכרון» מציגה מראש מה יקרה לכל שורה.
                </div>
              )}
              {doc2SyncMode === "suite_assignment_only" && hasDoc2 && importSource !== "detailed" && (
                <div style={{
                  marginTop: 8, padding: "8px 12px", borderRadius: 8, fontSize: 11,
                  background: "var(--ivory)", border: "1px solid var(--border)",
                  color: "var(--black)", fontWeight: 600, lineHeight: 1.5,
                }}>
                  מעדכן <strong>רק שיבוץ חדר/סוויטה</strong> לאורחים קיימים (התאמה לפי טלפון+הזמנה+תאריך).
                  ברירת מחדל: ממלא חדר רק אם ריק — לא דורס עריכה ידנית. סנכרון suite_rooms לכל שורת חדר.
                </div>
              )}
            </div>
            <DropZone
              label="📊 Doc 1 — דוח יומי מקיף"
              hint="Excel / HTML / .eml מ-Gmail — שעות ספא ופנסיון"
              loaded={hasDoc1}
              fileName={doc1Name}
              onFile={handleDoc1}
              inputRef={doc1Ref}
              accept=".xlsx,.xls,.htm,.html,.eml"
              optional
            />
          </div>

          {/* FAIL VISIBLE: Tier-0 EZGO preset didn't match — show exactly what
              headers were found vs expected, so this never silently lands in
              the AI/manual review screen with no explanation. */}
          {presetMissDebug && (mappingStage === "suggesting" || mappingStage === "review") && (
            <div style={{
              marginBottom: 14, padding: "10px 14px", borderRadius: 10,
              background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.45)",
              fontSize: 11.5, color: "#92400E", lineHeight: 1.7,
            }}>
              ⚠ מיפוי EZGO אוטומטי לא זוהה ({presetMissDebug.matchedCount}/{presetMissDebug.required.length} עמודות נדרשות נמצאו) — לכן עבר למיפוי AI/ידני.
              <div style={{ marginTop: 6 }}>
                <strong>חסרות:</strong> {presetMissDebug.missing.length ? presetMissDebug.missing.join(", ") : "—"}
              </div>
              <div style={{ marginTop: 4, fontFamily: "monospace", direction: "ltr", textAlign: "left", wordBreak: "break-all" }}>
                כותרות בקובץ: {presetMissDebug.headers.join(" | ") || "(ריק)"}
              </div>
            </div>
          )}

          {/* Doc 2 mapping gate — directly under upload so approve isn't buried under paste zones */}
          <div ref={mappingReviewRef}>
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
                key={doc2Name || "doc2-mapping"}
                schema={SUITE_ARRIVALS_SCHEMA}
                headers={Object.keys(rawDoc2Rows[0] ?? {})}
                sampleRow={rawDoc2Rows[0]}
                aiSuggestion={aiSuggestion}
                aiError={aiError}
                onApprove={handleMappingApprove}
                onCancel={handleMappingCancel}
              />
            )}
          </div>

          {/* EZGO Operations email — Option A workflow */}
          <div style={{
            marginBottom: 14, borderRadius: 12,
            border: "1px solid rgba(34,197,94,0.35)",
            background: "rgba(22,163,74,0.06)",
            overflow: "hidden",
          }}>
            <button
              type="button"
              onClick={() => setEzgoEmailOpen((o) => !o)}
              style={{
                width: "100%", display: "flex", alignItems: "center", gap: 10,
                padding: "12px 14px", border: "none", cursor: "pointer",
                background: "transparent", fontFamily: "Heebo,sans-serif",
                textAlign: "right",
              }}
            >
              <span style={{ fontSize: 18 }}>📧</span>
              <span style={{ flex: 1, fontWeight: 800, fontSize: 13, color: "#86efac" }}>
                ממייל EZGO Operations — בלי להעתיק טקסט ידנית
              </span>
              {hasDoc1 && (
                <span style={{ fontSize: 11, color: "#4ade80", fontWeight: 700 }}>
                  ✓ דוח נטען
                </span>
              )}
              <span style={{ color: "rgba(134,239,172,0.6)", fontSize: 12 }}>{ezgoEmailOpen ? "▲" : "▼"}</span>
            </button>
            {ezgoEmailOpen && (
              <div style={{ padding: "0 14px 14px", fontSize: 12, color: "rgba(232,201,138,0.85)", lineHeight: 1.85 }}>
                <ol style={{ margin: "0 0 12px", paddingRight: 20 }}>
                  <li>ב-Gmail פתח מייל מ-<strong style={{ direction: "ltr", display: "inline" }}>noreply@ezgo.co.il</strong> — נושא «Operations»</li>
                  <li><strong>מומלץ:</strong> ⋮ → <strong>הורד הודעה</strong> (.eml) וגרור ל-Doc 1 למעלה</li>
                  <li><strong>חלופה:</strong> ⋮ → <strong>הצג מקור</strong> → שמור כ-HTML או העתק את כל הקוד להדבקה למטה</li>
                  <li>ודא מצב Doc 1: <strong>«ספא סוויטות בלבד»</strong> → לחץ <strong>סנכרן ספא סוויטות</strong></li>
                </ol>
                <div style={{
                  fontSize: 11, color: "#fbbf24", fontWeight: 700, marginBottom: 10,
                  padding: "8px 10px", borderRadius: 8,
                  background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.35)",
                }}>
                  ⚠ מייל אחד = יום אחד. אל תעתיק טקסט גלוי מ-Gmail (PDF/הדפסה) — חייב HTML או .eml
                </div>
                <textarea
                  value={doc1PasteText}
                  onChange={(e) => setDoc1PasteText(e.target.value)}
                  placeholder="הדבק כאן קוד HTML מ«הצג מקור» או תוכן קובץ .eml…"
                  dir="ltr"
                  style={{
                    width: "100%", minHeight: 72, maxHeight: 160, resize: "vertical",
                    padding: "10px 12px", borderRadius: 8, boxSizing: "border-box",
                    border: "1px solid rgba(34,197,94,0.4)",
                    background: "rgba(0,0,0,0.25)", color: "#d1fae5",
                    fontFamily: "monospace", fontSize: 11,
                  }}
                />
                <button
                  type="button"
                  onClick={handleDoc1Paste}
                  disabled={!doc1PasteText.trim()}
                  style={{
                    marginTop: 8, padding: "8px 18px", borderRadius: 20, border: "none",
                    cursor: doc1PasteText.trim() ? "pointer" : "not-allowed",
                    opacity: doc1PasteText.trim() ? 1 : 0.5,
                    fontFamily: "Heebo,sans-serif", fontSize: 12, fontWeight: 800,
                    background: "linear-gradient(135deg,#22c55e,#16a34a)", color: "#fff",
                  }}
                >
                  📥 טען דוח מההדבקה
                </button>
              </div>
            )}
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
                    { label: "🔔 נימוסים", val: stats.courtesy ?? 0, c: "#7c3aed", bg: "#f3f0ff" },
                    { label: "🔇 מושתקים", val: stats.muted,    c: "#dc2626", bg: "#fef2f2" },
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
                    { label: "🔔 נימוסים",   val: stats.courtesy,   c: "#7c3aed", bg: "#f3f0ff" },
                    { label: "🔇 מושתקים",   val: stats.muted,    c: "#6b7280", bg: "#f3f4f6" },
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
                  🏨 תצוגת שיבוץ: שם · מס׳ הזמנה · חדר · פעולת סנכרון — {displayGridRows.length} שורות
                  <label style={{ display: "block", marginTop: 8, fontWeight: 600, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={suiteAssignmentForceRoom}
                      onChange={(e) => setSuiteAssignmentForceRoom(e.target.checked)}
                      style={{ marginLeft: 6 }}
                    />
                    דרוס חדר קיים בפרופיל (לא מומלץ — ברירת מחדל ממלא ריק בלבד)
                  </label>
                </div>
              )}
              {syncEligibility && syncEligibility.total > 0 && (
                <div style={{
                  marginBottom: 10, padding: "8px 12px", borderRadius: 10,
                  background: syncEligibility.ready < syncEligibility.total
                    ? "rgba(245,158,11,0.12)" : "rgba(16,185,129,0.08)",
                  border: `1px solid ${syncEligibility.ready < syncEligibility.total
                    ? "rgba(245,158,11,0.45)" : "rgba(16,185,129,0.35)"}`,
                  fontSize: 11, fontWeight: 700,
                  color: syncEligibility.ready < syncEligibility.total ? "#92400E" : "#065f46",
                  lineHeight: 1.7,
                }}>
                  📊 בקובץ {syncEligibility.total} שורות · מוכנות לייבוא: {syncEligibility.ready}
                  {syncEligibility.skippedNoPhone.length > 0 && (
                    <> · 📵 {syncEligibility.skippedNoPhone.length} ללא טלפון (לא סונכרן)</>
                  )}
                  {syncEligibility.createdWithoutPhone.length > 0 && (
                    <> · 📵 {syncEligibility.createdWithoutPhone.length} ייווצר בלי טלפון (מושתק)</>
                  )}
                  {syncEligibility.skippedUnimportable > 0 && (
                    <> · ⛔ {syncEligibility.skippedUnimportable} מטריית קבוצה</>
                  )}
                  {syncEligibility.skippedDeselected > 0 && (
                    <> · {syncEligibility.skippedDeselected} לא נבחרו</>
                  )}
                  {syncEligibility.skippedNoPhone.length > 0 && (
                    <div style={{ fontWeight: 600, marginTop: 4 }}>
                      ללא טלפון ולא סונכרן: {syncEligibility.skippedNoPhone.slice(0, 6).map((r) => r.guestName).join(", ")}
                      {syncEligibility.skippedNoPhone.length > 6
                        ? ` +${syncEligibility.skippedNoPhone.length - 6}` : ""}
                      {" "}— הוסף מספר בהערות או בעמודת טלפון
                    </div>
                  )}
                  {syncEligibility.createdWithoutPhone.length > 0 && (
                    <div style={{ fontWeight: 600, marginTop: 4 }}>
                      ייווצר בלי טלפון (בלי WhatsApp עד שיוזן): {syncEligibility.createdWithoutPhone.slice(0, 6).map((r) => r.guestName).join(", ")}
                      {syncEligibility.createdWithoutPhone.length > 6
                        ? ` +${syncEligibility.createdWithoutPhone.length - 6}` : ""}
                      {" "}— אפשר להזין טלפון בעמודה לפני הסנכרון
                    </div>
                  )}
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
            <>
              <div style={{
                marginBottom: 12, padding: "14px 16px", borderRadius: 12,
                border: groupCourtesyAutomation ? "2px solid #7C3AED" : "1px solid var(--border)",
                background: groupCourtesyAutomation ? "rgba(124,58,237,0.08)" : "rgba(255,255,255,0.04)",
              }}>
                <label style={{
                  display: "flex", alignItems: "flex-start", gap: 12, cursor: "pointer",
                  fontFamily: "Heebo,sans-serif", marginBottom: 10,
                }}>
                  <input
                    type="checkbox"
                    checked={groupCourtesyAutomation}
                    onChange={(e) => setGroupCourtesyAutomation(e.target.checked)}
                    style={{ width: 20, height: 20, marginTop: 2, accentColor: "#7C3AED", cursor: "pointer" }}
                  />
                  <span>
                    <strong style={{ fontSize: 14, color: groupCourtesyAutomation ? "#5B21B6" : "var(--black)" }}>
                      🔔 אוטומציית נימוסים לדיירי קבוצה (שלב 4)
                    </strong>
                    <span style={{ display: "block", fontSize: 12, color: "var(--text-muted)", marginTop: 4, lineHeight: 1.5 }}>
                      דיירים עם שם+טלפון מההערות (עיריות/קבוצות) מקבלים רק בדיקת שלום באמצע השהייה + חדר מוכן מהפעמון.
                      {gridRows.filter((r) => r.automationScope === "courtesy_only").length > 0 && (
                        <> כרגע <strong>{gridRows.filter((r) => r.automationScope === "courtesy_only").length}</strong> שורות מסומנות כנימוסים.</>
                      )}
                    </span>
                  </span>
                </label>
              </div>
              <div style={{
                marginBottom: 12, padding: "14px 16px", borderRadius: 12,
                border: importWithoutAutomation ? "2px solid #F59E0B" : "1px solid var(--border)",
                background: importWithoutAutomation ? "rgba(245,158,11,0.12)" : "rgba(255,255,255,0.04)",
              }}>
                <label style={{
                  display: "flex", alignItems: "flex-start", gap: 12, cursor: "pointer",
                  fontFamily: "Heebo,sans-serif",
                }}>
                  <input
                    type="checkbox"
                    checked={importWithoutAutomation}
                    onChange={(e) => setImportWithoutAutomation(e.target.checked)}
                    style={{ width: 20, height: 20, marginTop: 2, accentColor: "var(--gold)", cursor: "pointer" }}
                  />
                  <span>
                    <strong style={{ fontSize: 14, color: importWithoutAutomation ? "#92400E" : "var(--black)" }}>
                      🔇 ייבוא ללא וואטסאפ (אורחים רגילים)
                    </strong>
                    <span style={{ display: "block", fontSize: 12, color: "var(--text-muted)", marginTop: 4, lineHeight: 1.5 }}>
                      אורחים חדשים שאינם דיירי קבוצה נכנסים מושתקים — אפשר לשנות בעמודת «אוטומציה» או מ«בקרת אוטומציה».
                      {gridRows.filter((r) => r.automationScope === "muted").length > 0 && (
                        <> כרגע <strong>{gridRows.filter((r) => r.automationScope === "muted").length}</strong> שורות מושתקות.</>
                      )}
                    </span>
                  </span>
                </label>
              </div>
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
            </>
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
                    {result.enrichOnly ? (
                      <>
                        📥 השלמת פרופיל — 🆕 {result.newCount ?? 0} חדשים
                        {(result.enrichedCount ?? 0) > 0 && (
                          <> · {result.enrichedCount} קיימים (חסר בלבד)</>
                        )}
                      </>
                    ) : (
                      <>יובאו {result.total} אורחים</>
                    )}
                    {result.mode === "detailed" && result.batchType && result.batchType !== "mixed" && (
                      <> ({result.batchType === "suite" ? "סוויטות" : "בילוי יומי"})</>
                    )}
                    {result.corporateMuted > 0 && (
                      <> · 👥 {result.corporateMuted} דיירי קבוצה</>
                    )}
                    {result.importCourtesy > 0 && (
                      <> · 🔔 {result.importCourtesy} נימוסים (שלב 4)</>
                    )}
                    {result.importMuted > 0 && (
                      <> · 🔇 {result.importMuted} מושתקים</>
                    )}
                  </div>
                  {result.importCourtesy > 0 && (
                    <div style={{ fontSize: 12, color: "#5B21B6", marginTop: 6, fontWeight: 700 }}>
                      🔔 {result.importCourtesy} דיירי קבוצה יקבלו רק בדיקת שלום (שלב 4) + חדר מוכן מהפעמון.
                    </div>
                  )}
                  {result.importMuted > 0 && (
                    <div style={{ fontSize: 12, color: "#92400E", marginTop: 6, fontWeight: 700 }}>
                      🔇 {result.importMuted} אורחים יובאו עם אוטומציה מושתקת — הפעל מ«בקרת אוטומציה → תור חי» לפני שליחה.
                    </div>
                  )}
                  <div style={{ fontSize: 13, color: "#065f46", lineHeight: 1.9 }}>
                    🏨 {result.suites} סוויטות ·
                    ☀️ {result.days} בילוי יומי ·
                    🛏️ {result.rooms} חדרים ב-suite_rooms
                    {result.spa > 0 && <> · 💆 {result.spa} עם שעת ספא</>}
                    {(result.roomsFilledCount ?? 0) > 0 && (
                      <> · 🏨 {result.roomsFilledCount} חדרים עודכנו בפרופיל</>
                    )}
                    {(result.roomsSkippedExisting ?? 0) > 0 && (
                      <> · ⏭️ {result.roomsSkippedExisting} עם חדר קיים (לא נדרס)</>
                    )}
                    {(result.multiRoomBookingCount ?? 0) > 0 && (
                      <> · 🛏️×{result.multiRoomBookingCount} הזמנות מרובות-חדר</>
                    )}
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
                  {result.skippedNoPhone?.length > 0 && (
                    <div style={{ fontSize: 12, color: "#92400E", marginTop: 6, fontWeight: 700 }}>
                      📵 {result.skippedNoPhone.length} ללא טלפון — לא סונכרנו (בדוק הערות / עמודת טלפון):{" "}
                      {result.skippedNoPhone.slice(0, 8).map((r) => r.guestName).join(", ")}
                      {result.skippedNoPhone.length > 8 && ` +${result.skippedNoPhone.length - 8}`}
                    </div>
                  )}
                  {(result.createdWithoutPhoneCount ?? 0) > 0 && (
                    <div style={{ fontSize: 12, color: "#92400E", marginTop: 6, fontWeight: 700 }}>
                      📵 {result.createdWithoutPhoneCount} נוצרו/עודכנו בלי טלפון — מושתקים אוטומטית (בלי WhatsApp) עד שיוזן טלפון:{" "}
                      {(result.createdWithoutPhone ?? []).slice(0, 8).map((r) => r.guestName).join(", ")}
                      {(result.createdWithoutPhone?.length ?? 0) > 8 && ` +${result.createdWithoutPhone.length - 8}`}
                    </div>
                  )}
                  {result.skippedDeselected > 0 && (
                    <div style={{ fontSize: 12, color: "#64748b", marginTop: 6 }}>
                      {result.skippedDeselected} שורות לא נבחרו בטבלה (סינון ידני)
                    </div>
                  )}
                  {result.conflictCount > 0 && (
                    <div style={{ fontSize: 12, color: "#92400E", marginTop: 6, fontWeight: 700 }}>
                      ⚠ {result.conflictCount} רשומות עם התנגשות מול הקיים ב-DB (שם/חדר/תאריך שונה)
                      {result.enrichOnly
                        ? " — נשמרו ערכי DB; מולאו רק שדות ריקים"
                        : " — יובאו בכל זאת, בדוק"}
                      {" — "}
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
                    {result.forceOverwriteRoom && <> · מצב דריסה פעיל</>}
                  </div>
                  <div style={{ fontSize: 13, lineHeight: 1.8 }}>
                    סה״כ {result.total} שורות בקובץ · {result.rooms} שורות ב-suite_rooms
                    {result.skipped > 0 && <> · {result.skipped} דולגו</>}
                    {(result.roomsSkippedExisting ?? 0) > 0 && (
                      <> · {result.roomsSkippedExisting} עם חדר קיים (לא נדרס)</>
                    )}
                    {(result.multiRoomBookings ?? 0) > 0 && (
                      <> · {result.multiRoomBookings} הזמנות מרובות-חדר</>
                    )}
                  </div>
                  {result.noRoom?.length > 0 && (
                    <div style={{ fontSize: 12, color: "#92400E", marginTop: 8, fontWeight: 700 }}>
                      ⚠ ללא חדר משויך בטבלה: {result.noRoom.slice(0, 8).join(", ")}
                      {result.noRoom.length > 8 && ` +${result.noRoom.length - 8}`}
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
                  {result.mode === "spa" && (result.daypassCandidateCount > 0 || result.upsellCount > 0) && (
                    <div style={{ fontSize: 12.5, color: "#8a6d1a", marginTop: 8, fontWeight: 700, lineHeight: 1.6 }}>
                      {result.daypassCandidateCount > 0 && <>☀️ {result.daypassCandidateCount} מועמדים לפרופיל בילוי יומי חדש (ללא טיפול ספא) · </>}
                      {result.upsellCount > 0 && (
                        <>
                          💆 {result.upsellCount} אורחי בילוי יומי ללא ספא
                          {onSpaUpsellNavigate && (
                            <>
                              {" — "}
                              <button
                                type="button"
                                onClick={() => onSpaUpsellNavigate(result.arrivalDate)}
                                style={{
                                  background: "none", border: "none", padding: 0,
                                  color: "#6d28d9", fontWeight: 800, cursor: "pointer",
                                  textDecoration: "underline", fontSize: "inherit",
                                }}
                              >
                                עבור לשליחת הצעות ספא →
                              </button>
                            </>
                          )}
                        </>
                      )}
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

          {syncedGuestsForWhapiPick.length > 0 && (
            <div style={{
              marginTop: 16, background: "#FFF8E7", border: "1px solid #C9A96E",
              borderRadius: 12, padding: "18px 20px",
            }}>
              <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 6, color: "#8a6d1a" }}>
                📱 שיוך ערוץ שליחה — מכשיר הסוויטות (Whapi)
              </div>
              <div style={{ fontSize: 12.5, color: "#6b5b3a", marginBottom: 12, lineHeight: 1.6 }}>
                {syncedGuestsForWhapiPick.length} אורחי סוויטות מהייבוא הזה. מגיעים בשבת מסומנים אוטומטית —
                שלבים 2.5 ו-3 יישלחו דרך מכשיר הסוויטות (גם בלי סימון כאן).
                סמן נוספים אם רוצים שכל האוטומציות שלהם יעברו ל-Whapi.
              </div>
              {whapiPickError && (
                <div style={{ background: "#FFF0EE", border: "1px solid #C0392B", borderRadius: 8, padding: "8px 12px", color: "#C0392B", fontSize: 12.5, marginBottom: 10 }}>
                  ⚠️ {whapiPickError}
                </div>
              )}
              {whapiPickDone && whapiPickSelected.size === 0 && !whapiPickError && (
                <div style={{ background: "#E8F5EF", border: "1px solid #1A7A4A", borderRadius: 8, padding: "8px 12px", color: "#1A7A4A", fontSize: 12.5, marginBottom: 10 }}>
                  ✅ עודכן. ניתן לסמן עוד אורחים או לסיים.
                </div>
              )}
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <button type="button" onClick={toggleWhapiPickAll} style={{ fontSize: 12, padding: "4px 10px", borderRadius: 8, border: "1px solid #C9A96E", background: "#fff", cursor: "pointer" }}>
                  {whapiPickSelected.size === syncedGuestsForWhapiPick.length ? "נקה בחירה" : "בחר הכל"}
                </button>
                <span style={{ fontSize: 12, color: "#6b5b3a" }}>{whapiPickSelected.size} נבחרו</span>
              </div>
              <div style={{ maxHeight: 220, overflowY: "auto", border: "1px solid #EADFC5", borderRadius: 8, background: "#fff" }}>
                {syncedGuestsForWhapiPick.map((g) => (
                  <label key={g.id} style={{
                    display: "flex", alignItems: "center", gap: 10, padding: "8px 12px",
                    borderBottom: "1px solid #F3EEDF", fontSize: 13, cursor: "pointer",
                    opacity: g.dispatch_channel === "whapi" ? 0.6 : 1,
                  }}>
                    <input
                      type="checkbox"
                      checked={whapiPickSelected.has(g.id)}
                      onChange={() => toggleWhapiPick(g.id)}
                      disabled={g.dispatch_channel === "whapi"}
                    />
                    <span style={{ fontWeight: 600 }}>{g.name || "—"}</span>
                    <span style={{ color: "#8a8266" }}>{g.phone}</span>
                    {g.room && <span style={{ color: "#8a8266" }}>· {g.room}</span>}
                    {isSaturdayArrivalYmd(g.arrival_date) && (
                      <span style={{ fontSize: 11, color: "#7C3AED", fontWeight: 700 }}>🕍 שבת</span>
                    )}
                    {g.dispatch_channel === "whapi" && (
                      <span style={{ marginRight: "auto", fontSize: 11, color: "#1A7A4A", fontWeight: 700 }}>
                        📱 כבר משויך
                      </span>
                    )}
                  </label>
                ))}
              </div>
              <button
                type="button"
                onClick={handleWhapiPickConfirm}
                disabled={whapiPickSaving || whapiPickSelected.size === 0}
                style={{
                  marginTop: 12, padding: "8px 18px", borderRadius: 8, border: "none",
                  background: whapiPickSaving || whapiPickSelected.size === 0 ? "#D9CBA3" : "#1A7A4A",
                  color: "#fff", fontWeight: 700, fontSize: 13,
                  cursor: whapiPickSaving || whapiPickSelected.size === 0 ? "not-allowed" : "pointer",
                }}
              >
                {whapiPickSaving ? "⏳ שומר..." : `📱 שייך ${whapiPickSelected.size || ""} למכשיר הסוויטות`}
              </button>
            </div>
          )}

          {daypassCreateCandidates.length > 0 && (
            <div style={{
              marginTop: 16, background: "#ecfeff", border: "1px solid #0e7490",
              borderRadius: 12, padding: "18px 20px",
            }}>
              <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 6, color: "#0e7490" }}>
                ☀️ פרופילי בילוי יומי חדשים — ללא טיפול ספא ({daypassCreateCandidates.length})
              </div>
              <div style={{ fontSize: 12.5, color: "#155e75", marginBottom: 12, lineHeight: 1.6 }}>
                הזמנות מהדוח שאין להן פרופיל אורח קיים לפי מספר טלפון, וללא שעת ספא. סמן מי ליצור בפועל.
              </div>
              {daypassCreateError && (
                <div style={{ background: "#FFF0EE", border: "1px solid #C0392B", borderRadius: 8, padding: "8px 12px", color: "#C0392B", fontSize: 12.5, marginBottom: 10 }}>
                  ⚠️ {daypassCreateError}
                </div>
              )}
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <button type="button" onClick={toggleDaypassCreateAll} style={{ fontSize: 12, padding: "4px 10px", borderRadius: 8, border: "1px solid #0e7490", background: "#fff", cursor: "pointer" }}>
                  {daypassCreateSelected.size === daypassCreateCandidates.length ? "נקה בחירה" : "בחר הכל"}
                </button>
                <span style={{ fontSize: 12, color: "#155e75" }}>{daypassCreateSelected.size} נבחרו</span>
              </div>
              <div style={{ maxHeight: 220, overflowY: "auto", border: "1px solid #A5E4EF", borderRadius: 8, background: "#fff" }}>
                {daypassCreateCandidates.map((rec, i) => (
                  <label key={`${rec.phone}_${i}`} style={{
                    display: "flex", alignItems: "center", gap: 10, padding: "8px 12px",
                    borderBottom: "1px solid #E0F5FA", fontSize: 13, cursor: "pointer",
                  }}>
                    <input type="checkbox" checked={daypassCreateSelected.has(i)} onChange={() => toggleDaypassCreate(i)} />
                    <span style={{ fontWeight: 600 }}>{rec.guest_name || "—"}</span>
                    <span style={{ color: "#0e7490" }}>{rec.phone}</span>
                    {rec.order_number && <span style={{ color: "#8a8266", fontSize: 12 }}>הזמנה #{rec.order_number}</span>}
                  </label>
                ))}
              </div>
              <button
                onClick={handleCreateDaypassProfiles}
                disabled={daypassCreating || daypassCreateSelected.size === 0}
                style={{
                  marginTop: 12, padding: "8px 18px", borderRadius: 8, border: "none",
                  background: daypassCreating || daypassCreateSelected.size === 0 ? "#A5E4EF" : "#0e7490",
                  color: "#fff", fontWeight: 700, fontSize: 13,
                  cursor: daypassCreating || daypassCreateSelected.size === 0 ? "not-allowed" : "pointer",
                }}
              >
                {daypassCreating ? "⏳ יוצר..." : `☀️ צור ${daypassCreateSelected.size || ""} פרופילי בילוי יומי`}
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

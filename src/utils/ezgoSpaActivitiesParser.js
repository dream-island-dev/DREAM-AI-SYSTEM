// src/utils/ezgoSpaActivitiesParser.js
// ── Ezgo "פעילויות" (Activities) daily report — pure row parser ─────────────
// Zero Supabase calls, zero side effects. Phase 1 of the Smart Spa Board full
// sync (docs/active_sprint.md). Consumed by SpaBoard.js's Excel import (Phase
// 3) and mirrored — same field names, same normalize logic, NOT the same
// file (Deno can't import from src/) — by a future
// supabase/functions/_shared/ezgoSpaActivities.ts for the spa-schedule-webhook
// HTML path (Phase 4). Same duplication convention already used in this repo
// for normalizePhone/normalizeTimeVal between SpaStagingPanel.js and
// spa-schedule-webhook/index.ts.
//
// ZERO DATA LOSS (CLAUDE.md §0.1): every non-empty input row produces exactly
// one output row (or is counted as skipped_cancelled — intentionally inactive,
// never silently vanished without a count). A row that can't be fully parsed
// is never dropped here — it comes back with `warnings` set and the full
// original row under `raw`, so the caller (Phase 2's upsert engine) can stage
// it as a FAIL VISIBLE unmatched row instead of it silently vanishing.
//
// Two source formats accepted:
//   1. Hebrew UI export — keys: תזמון / פעילות / מטפל / לקוח / טלפון / מזהה…
//   2. Ezgo machine CSV — keys: tmStart/tmEnd / sActivityDesc / sAttendantName /
//      sClientName / sTel / iAddsLineId / sRowNum / iLineStatus / dtDate…
// English CSV is canonicalized to the Hebrew key shape before mapping so the
// rest of the pipeline stays single-path.

/** Excel 1900 date system — same convention as detailedReservationParser (kept local to avoid coupling spa ingest to Doc2 parser). */
const EXCEL_EPOCH_OFFSET = 25569;

const TIME_RANGE_RE = /(\d{1,2}):(\d{2})\s*[-–—]\s*(\d{1,2}):(\d{2})/;
const CLOCK_RE = /^(\d{1,2}):(\d{2})$/;
const NEW_BOOKING_PLACEHOLDER_RE = /^\(?\s*הזמנה חדשה\s*\)?$/;
const NAME_WITH_GROUP_RE = /^(.*?)\s*\(([^)]+)\)\s*$/;
/** Org/booking labels in parentheses — not a person name for Golden Profile match. */
const ORG_GROUP_LABEL_RE = /ועד|בע["״']?מ|בעמ|טכנולוגי|חברה|ltd|inc|מוצרי|עיריית|קבוצת|פרומדיקס|אלקטרה/i;
const LATIN_NICKNAME_RE = /^[A-Za-z0-9][A-Za-z0-9.\s_-]*$/;
const HEBREW_CHAR_RE = /[\u0590-\u05FF]/;

function cleanCell(raw) {
  return String(raw ?? "")
    .replace(/[\r\n\t\xa0]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function excelSerialToISO(serial) {
  const n = typeof serial === "number" ? serial : parseFloat(String(serial).trim());
  if (!Number.isFinite(n) || n < 1) return null;
  const ms = Math.round((n - EXCEL_EPOCH_OFFSET) * 86_400_000);
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/**
 * Ezgo English CSV embeds unescaped ASCII quotes inside quoted fields
 * (Hebrew abbr בע"מ). SheetJS then merges/drops subsequent rows — ZERO DATA
 * LOSS violation. Replace with Hebrew gershayim before any CSV parse.
 */
export function repairEzgoCsvText(text) {
  return String(text ?? "")
    .replace(/^\uFEFF/, "")
    .replace(/בע"מ/g, "בע״מ")
    .replace(/בע''מ/g, "בע״מ");
}

/** True when parentheses text is a company/org booking label, not a companion person name. */
export function isSpaOrgGroupLabel(label) {
  return ORG_GROUP_LABEL_RE.test(String(label ?? ""));
}

/**
 * Prefer Hebrew person name from parentheses when the outer cell is a Latin
 * nickname ("limor (לימור סולומון)" → לימור סולומון) for Golden Profile
 * display / auto-create. Org labels stay as group_label only.
 */
export function resolveSpaGuestDisplayName(guestName, groupLabel) {
  if (
    guestName &&
    LATIN_NICKNAME_RE.test(guestName) &&
    groupLabel &&
    HEBREW_CHAR_RE.test(groupLabel) &&
    !isSpaOrgGroupLabel(groupLabel)
  ) {
    return groupLabel;
  }
  return guestName || null;
}

/**
 * Ordered name hints for phone-disambiguation against guests.name.
 * Latin nickname + Hebrew paren person → try Hebrew first.
 */
export function collectGuestNameHints(guestName, groupLabel) {
  const hints = [];
  const add = (h) => {
    const s = cleanCell(h);
    if (s && !hints.includes(s)) hints.push(s);
  };
  const display = resolveSpaGuestDisplayName(guestName, groupLabel);
  if (display && display !== guestName) add(display);
  add(guestName);
  if (groupLabel && !isSpaOrgGroupLabel(groupLabel)) add(groupLabel);
  return hints;
}

/**
 * Normalize Ezgo dtDate / Excel serial / Date → YYYY-MM-DD.
 * Garbage strings return null (never invent a date — UI picker remains SSOT).
 */
export function normalizeActivitiesDate(raw) {
  if (raw == null || raw === "") return null;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    // SheetJS cellDates yields a local-midnight Date — use local YMD so a
    // UTC-offset timezone never shifts the calendar day backward.
    const y = raw.getFullYear();
    const mo = String(raw.getMonth() + 1).padStart(2, "0");
    const d = String(raw.getDate()).padStart(2, "0");
    return `${y}-${mo}-${d}`;
  }
  if (typeof raw === "number" && raw > 25000) {
    return excelSerialToISO(raw);
  }
  const s = cleanCell(raw);
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const serial = parseFloat(s);
  if (Number.isFinite(serial) && serial > 25000 && !/^\d{1,2}[/.-]/.test(s)) {
    return excelSerialToISO(serial);
  }
  // DD/MM/YYYY or MM/DD/YYYY (SheetJS raw:false often emits locale short dates).
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) {
    let year = parseInt(m[3], 10);
    if (year < 100) year += 2000;
    const a = parseInt(m[1], 10);
    const b = parseInt(m[2], 10);
    // Prefer DMY when first part > 12 (Israeli day); otherwise MDY (SheetJS US).
    const dayFirst = a > 12;
    const day = dayFirst ? a : b;
    const month = dayFirst ? b : a;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  return null;
}

/** True when the row looks like Ezgo's English machine-CSV export (not the Hebrew UI report). */
export function isEnglishActivitiesCsvRow(rawRow) {
  if (!rawRow || typeof rawRow !== "object") return false;
  return (
    Object.prototype.hasOwnProperty.call(rawRow, "tmStart") ||
    Object.prototype.hasOwnProperty.call(rawRow, "sActivityDesc") ||
    Object.prototype.hasOwnProperty.call(rawRow, "iAddsLineId")
  );
}

/** Pads "9:00" → "09:00". Returns null when the cell is not a clock time. */
export function normalizeClockTime(raw) {
  const s = cleanCell(raw);
  const m = s.match(CLOCK_RE);
  if (!m) return null;
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

/**
 * English CSV → Hebrew-keyed shape the rest of the mapper already understands.
 * iAddsLineId alone is NOT unique per therapist on a couple booking — compose
 * with sRowNum (always unique in the daily export) for stable re-import keys.
 * iLineStatus "0" = cancelled line in Ezgo.
 */
export function canonicalizeEnglishActivitiesRow(rawRow) {
  const start = normalizeClockTime(rawRow.tmStart);
  const end = normalizeClockTime(rawRow.tmEnd);
  const timing = start && end ? `${start}-${end}` : cleanCell(rawRow.tmStart) || "";

  const lineId = cleanCell(rawRow.iAddsLineId);
  const rowNum = cleanCell(rawRow.sRowNum);
  const ezgoId = lineId && rowNum ? `${lineId}_${rowNum}` : lineId || rowNum || "";

  const statusRaw = cleanCell(rawRow.iLineStatus);
  // Ezgo: "1" = active, "0" = cancelled. Missing status → treat as active
  // (Hebrew path has no status column; don't invent cancellations).
  const cancelled = statusRaw === "0";

  // Coerce phone to string — SheetJS often turns 054… into number 54… (leading 0 lost).
  const telRaw = rawRow.sTel == null || rawRow.sTel === "" ? "" : String(rawRow.sTel);

  return {
    תזמון: timing,
    פעילות: rawRow.sActivityDesc ?? "",
    מטפל: rawRow.sAttendantName ?? "",
    "סוגי טיפולים": rawRow.sTreatDesc ?? "",
    תוספות: rawRow.sExtraDesc ?? "",
    לקוח: rawRow.sClientName ?? "",
    טלפון: telRaw,
    הערה: rawRow.sRemark ?? "",
    מזהה: ezgoId,
    _appointment_date: normalizeActivitiesDate(rawRow.dtDate),
    _cancelled: cancelled,
    _source: "english_csv",
  };
}

/** "10:00-10:30 .23" → {start_time:"10:00", end_time:"10:30"}. Trailing line-index noise after the range is ignored by construction (regex only looks for the HH:MM-HH:MM substring). */
export function parseTimeRange(raw) {
  const s = cleanCell(raw);
  const m = s.match(TIME_RANGE_RE);
  if (!m) return { start_time: null, end_time: null };
  const pad = (h, mi) => `${h.padStart(2, "0")}:${mi}`;
  return { start_time: pad(m[1], m[2]), end_time: pad(m[3], m[4]) };
}

/** Same normalize convention as SpaStagingPanel.js/spa-schedule-webhook (972XXXXXXXXX, no leading +) — guests.phone comparison (+972…) happens in the Phase 2 resolver, not here. */
export function normalizeActivitiesPhone(raw) {
  const p = cleanCell(raw).replace(/[\s\-().+]/g, "");
  if (!p) return null;
  if (p.startsWith("972") && p.length >= 11) return p;
  if (p.startsWith("0") && p.length === 10) return "972" + p.slice(1);
  if (/^5\d{8}$/.test(p)) return "972" + p;
  return p; // unrecognized shape — kept as-is rather than dropped; Phase 2 resolver will fail the guest match and stage it, never silently discard
}

/** "חדר 10 (זוגי)" → "חדר 10"; "סוויטת אבניו 1" untouched (no trailing parenthetical). Room-name→room_id resolution against spa_room_aliases happens in Phase 2. */
export function normalizeEzgoRoomName(raw) {
  const s = cleanCell(raw).replace(/\s*\([^)]*\)\s*$/, "").trim();
  return s || null;
}

/** "לקוח" cell: "(הזמנה חדשה)" is a placeholder (no name yet), "Name (Group)" splits into display name + group/booking label, plain text is used as-is. */
export function parseGuestNameCell(raw) {
  const s = cleanCell(raw);
  if (!s) return { guest_name: null, group_label: null, is_new_booking_placeholder: false };
  if (NEW_BOOKING_PLACEHOLDER_RE.test(s)) {
    return { guest_name: null, group_label: null, is_new_booking_placeholder: true };
  }
  const m = s.match(NAME_WITH_GROUP_RE);
  if (m && m[1].trim()) {
    return { guest_name: m[1].trim(), group_label: m[2].trim() || null, is_new_booking_placeholder: false };
  }
  return { guest_name: s, group_label: null, is_new_booking_placeholder: false };
}

/**
 * Maps one raw Excel/HTML/CSV row into the canonical SpaActivityRow shape.
 * English machine-CSV rows are canonicalized first; Hebrew UI rows pass through.
 */
export function mapEzgoActivitiesRow(rawRow) {
  const english = isEnglishActivitiesCsvRow(rawRow);
  const src = english ? canonicalizeEnglishActivitiesRow(rawRow) : rawRow;

  const { start_time, end_time } = parseTimeRange(src["תזמון"]);
  const roomRaw = normalizeEzgoRoomName(src["פעילות"]);
  const therapistName = cleanCell(src["מטפל"]) || null;
  const treatmentType = cleanCell(src["סוגי טיפולים"]) || null;
  const extras = cleanCell(src["תוספות"]) || null;
  const { guest_name, group_label, is_new_booking_placeholder } = parseGuestNameCell(src["לקוח"]);
  const phoneRaw = cleanCell(src["טלפון"]) || null;
  const phone = phoneRaw ? normalizeActivitiesPhone(phoneRaw) : null;
  const note = cleanCell(src["הערה"]) || null;
  const ezgoLineId = cleanCell(src["מזהה"]) || null;
  const appointmentDate = cleanCell(src._appointment_date) || null;
  const cancelled = !!src._cancelled;

  const warnings = [];
  if (cancelled) warnings.push("cancelled_line");
  if (!start_time || !end_time) warnings.push("no_time_range");
  if (!phone) warnings.push("no_phone");
  if (!roomRaw) warnings.push("no_room");

  return {
    raw: rawRow,
    ezgo_line_id: ezgoLineId,
    start_time,
    end_time,
    room_raw: roomRaw,
    therapist_name: therapistName,
    treatment_type: treatmentType,
    extras,
    guest_name,
    group_label,
    is_new_booking_placeholder,
    phone,
    phone_raw: phoneRaw,
    note,
    appointment_date: appointmentDate,
    cancelled,
    source: english ? "english_csv" : "hebrew_ui",
    warnings,
  };
}

function isRowEmpty(rawRow) {
  return Object.values(rawRow ?? {}).every((v) => v === null || v === undefined || String(v).trim() === "");
}

/**
 * Top-level entry point — parses every non-empty row of the full daily
 * Activities report. Cancelled English-CSV lines (iLineStatus=0) are counted
 * in `skippedCancelled` and omitted from the returned rows so the sync engine
 * never creates active appointments from them (they are not "lost" — the
 * count is returned for the import toast).
 */
export function parseEzgoActivitiesReport(rows) {
  if (!Array.isArray(rows)) return { rows: [], skippedCancelled: 0 };
  const parsed = [];
  let skippedCancelled = 0;
  for (const r of rows) {
    if (isRowEmpty(r)) continue;
    const mapped = mapEzgoActivitiesRow(r);
    if (mapped.cancelled) {
      skippedCancelled++;
      continue;
    }
    parsed.push(mapped);
  }
  return { rows: parsed, skippedCancelled };
}

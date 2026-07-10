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
// one output row. A row that can't be fully parsed is never dropped here —
// it comes back with `warnings` set and the full original row under `raw`,
// so the caller (Phase 2's upsert engine) can stage it as a FAIL VISIBLE
// unmatched row instead of it silently vanishing.
//
// Report columns handled (Hebrew header → canonical field):
//   תזמון          → start_time / end_time   ("10:00-10:30 .23" — trailing
//                     ".NN" line-index noise is ignored, not stripped by regex)
//   פעילות         → room_raw                 (e.g. "חדר 10 (זוגי)" → "חדר 10";
//                     resolved against spa_room_aliases in Phase 2, not here)
//   מטפל           → therapist_name
//   סוגי טיפולים   → treatment_type
//   תוספות         → extras
//   לקוח           → guest_name / group_label / is_new_booking_placeholder
//   טלפון          → phone (normalized "972XXXXXXXXX") / phone_raw
//   הערה           → note                     (e.g. "זוגי עם + X" — kept
//                     verbatim, not specially parsed; stays two appointment rows)
//   מזהה           → ezgo_line_id             (optional — not every report has it)

const TIME_RANGE_RE = /(\d{1,2}):(\d{2})\s*[-–—]\s*(\d{1,2}):(\d{2})/;
const NEW_BOOKING_PLACEHOLDER_RE = /^\(?\s*הזמנה חדשה\s*\)?$/;
const NAME_WITH_GROUP_RE = /^(.*?)\s*\(([^)]+)\)\s*$/;

function cleanCell(raw) {
  return String(raw ?? "")
    .replace(/[\r\n\t\xa0]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

/** Maps one raw Excel/HTML row (object keyed by literal Hebrew header text — same shape XLSX.utils.sheet_to_json and the webhook's parseHtmlTable already produce) into the canonical SpaActivityRow shape. */
export function mapEzgoActivitiesRow(rawRow) {
  const { start_time, end_time } = parseTimeRange(rawRow["תזמון"]);
  const roomRaw = normalizeEzgoRoomName(rawRow["פעילות"]);
  const therapistName = cleanCell(rawRow["מטפל"]) || null;
  const treatmentType = cleanCell(rawRow["סוגי טיפולים"]) || null;
  const extras = cleanCell(rawRow["תוספות"]) || null;
  const { guest_name, group_label, is_new_booking_placeholder } = parseGuestNameCell(rawRow["לקוח"]);
  const phoneRaw = cleanCell(rawRow["טלפון"]) || null;
  const phone = phoneRaw ? normalizeActivitiesPhone(phoneRaw) : null;
  const note = cleanCell(rawRow["הערה"]) || null;
  const ezgoLineId = cleanCell(rawRow["מזהה"]) || null;

  const warnings = [];
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
    warnings,
  };
}

function isRowEmpty(rawRow) {
  return Object.values(rawRow ?? {}).every((v) => v === null || v === undefined || String(v).trim() === "");
}

/** Top-level entry point — parses every non-empty row of the full daily Activities report (all suites/day-guests/groups, no suite-only filter — that filtering, if any, belongs to the caller). */
export function parseEzgoActivitiesReport(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.filter((r) => !isRowEmpty(r)).map(mapEzgoActivitiesRow);
}

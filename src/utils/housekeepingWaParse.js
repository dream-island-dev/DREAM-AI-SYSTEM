/**
 * Mirrors supabase/functions/_shared/housekeepingWaParse.ts (Deno boundary).
 */

const MIN_ROOM = 1;
const MAX_ROOM = 26;

const HEBREW_TSADI_QOF_APOSTROPHE = "[''\\u2019\\u2018\\u05F3\\u02BC\\u0060\\u00B4\\u2032]";

function normalizeHousekeepingLine(line) {
  return line.replace(
    new RegExp(`צ${HEBREW_TSADI_QOF_APOSTROPHE}ק`, "g"),
    "צק",
  );
}

const FORWARDED_RE = /הועברה/i;

// ✅ always takes priority over check-in phrasing in the same line: in practice
// ✅ arrives first (room turned over), and "N צ'ק אין" is typed later, on its
// own, once the guest actually walks in. Line has ✅ → ready only, never
// check-in. Line has check-in phrasing with NO ✅ → check-in only.
const HAS_CHECKMARK_RE = /✅/;

const READY_EXCLUDE_LINE_RE =
  /ממתין|\bcheck\s*[- ]?\s*out\b|\bco\b|\bout\b|יצאו|צ['׳']ק\s*אא?וט|צק\s*אא?וט/i;

const CHECKIN_LINE_RE =
  /^(?:room\s*)?(\d{1,2})\s*(?:צ['׳']ק\s*אין|צק\s*אין|\bcheck\s*[- ]?\s*in\b)/i;

const CHECKIN_TOKEN_PREFIX = "(?:ci\\b|check\\s*[- ]?\\s*in\\b|צ['׳']ק\\s*אין|צק\\s*אין)";
const CHECKIN_TOKEN_SUFFIX = "(?:ci\\b|check\\s*[- ]?\\s*in\\b)";

const CHECKIN_PREFIX_RE = new RegExp(
  `^(?:room\\s*)?${CHECKIN_TOKEN_PREFIX}\\s+(\\d{1,2})$`,
  "i",
);

const CHECKIN_SUFFIX_RE = new RegExp(
  `^(?:room\\s*)?(\\d{1,2})\\s+${CHECKIN_TOKEN_SUFFIX}`,
  "i",
);

// Hebrew has no JS \w word-chars — never put \b after Hebrew alternatives.
const CHECKOUT_TOKEN_PREFIX =
  "(?:co|check\\s*[- ]?\\s*out|צ['׳']ק\\s*אא?וט|צק\\s*אא?וט)";
const CHECKOUT_TOKEN_SUFFIX =
  "(?:co\\b|check\\s*[- ]?\\s*out\\b|צ['׳']ק\\s*אא?וט|צק\\s*אא?וט)";

const CHECKOUT_PREFIX_RE = new RegExp(
  `^(?:room\\s*)?${CHECKOUT_TOKEN_PREFIX}\\s+(\\d{1,2})$`,
  "i",
);

const CHECKOUT_SUFFIX_RE = new RegExp(
  `^(?:room\\s*)?(\\d{1,2})\\s+${CHECKOUT_TOKEN_SUFFIX}`,
  "i",
);

function inSuiteRange(n) {
  return Number.isInteger(n) && n >= MIN_ROOM && n <= MAX_ROOM;
}

function addRoom(rooms, raw) {
  const n = parseInt(String(raw ?? ""), 10);
  if (inSuiteRange(n)) rooms.add(n);
}

function matchCheckInRoom(line) {
  let m = line.match(CHECKIN_LINE_RE);
  if (m) return m[1];
  m = line.match(CHECKIN_PREFIX_RE);
  if (m) return m[1];
  m = line.match(CHECKIN_SUFFIX_RE);
  if (m) return m[1];
  return undefined;
}

function isCheckInLine(line) {
  return matchCheckInRoom(line) !== undefined;
}

export function parseHousekeepingCheckInRoomNumbers(text) {
  const body = String(text ?? "").trim();
  if (!body || FORWARDED_RE.test(body)) return [];

  const rooms = new Set();
  for (const line of body.split(/\r?\n/)) {
    const t = normalizeHousekeepingLine(line.trim());
    if (!t) continue;
    // ✅ wins — a line with a checkmark is a ready signal, not a check-in one.
    if (HAS_CHECKMARK_RE.test(t)) continue;
    const room = matchCheckInRoom(t);
    if (room) addRoom(rooms, room);
  }
  return [...rooms].sort((a, b) => a - b);
}

/** "Co 23" / "24 co" / Hebrew צ'ק אאוט — staff physical checkout signal. */
export function parseHousekeepingCheckOutRoomNumbers(text) {
  const body = String(text ?? "").trim();
  if (!body || FORWARDED_RE.test(body)) return [];

  const rooms = new Set();
  for (const line of body.split(/\r?\n/)) {
    const t = normalizeHousekeepingLine(line.trim());
    if (!t) continue;
    if (HAS_CHECKMARK_RE.test(t)) continue;
    if (isCheckInLine(t)) continue;

    let m = t.match(CHECKOUT_PREFIX_RE);
    if (m) {
      addRoom(rooms, m[1]);
      continue;
    }
    m = t.match(CHECKOUT_SUFFIX_RE);
    if (m) addRoom(rooms, m[1]);
  }
  return [...rooms].sort((a, b) => a - b);
}

export function parseHousekeepingReadyRoomNumbers(text) {
  const body = String(text ?? "").trim();
  if (!body || FORWARDED_RE.test(body)) return [];

  const rooms = new Set();

  for (const line of body.split(/\r?\n/)) {
    const t = normalizeHousekeepingLine(line.trim());
    if (!t || READY_EXCLUDE_LINE_RE.test(t)) continue;
    // Skip check-in-only lines — but ✅ always overrides check-in phrasing.
    if (isCheckInLine(t) && !HAS_CHECKMARK_RE.test(t)) continue;
    if (CHECKOUT_PREFIX_RE.test(t) || CHECKOUT_SUFFIX_RE.test(t)) continue;

    let m = t.match(/^(?:room\s*)?(\d{1,2})\s*✅/i);
    if (m) {
      addRoom(rooms, m[1]);
      continue;
    }

    m = t.match(/^(?:room\s*)?(\d{1,2})\s*(?:מוכן|ready|is\s+ready|si\s+ready)\b/i);
    if (m) {
      addRoom(rooms, m[1]);
      continue;
    }

    m = t.match(/^room\s+(\d{1,2})\s*✅/i);
    if (m) {
      addRoom(rooms, m[1]);
      continue;
    }

    m = t.match(/(?:^|\s)(?:room\s*)?(\d{1,2})\s+(?:מוכן|ready|is\s+ready|si\s+ready)\s*✅?/i);
    if (m) {
      addRoom(rooms, m[1]);
    }
  }

  return [...rooms].sort((a, b) => a - b);
}

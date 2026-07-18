/**
 * Mirrors supabase/functions/_shared/housekeepingWaParse.ts (Deno boundary).
 */

const MIN_ROOM = 1;
const MAX_ROOM = 26;

const ROOM_LIST_FRAGMENT = "[\\d\\s,/|&\\-]+";

const HEBREW_TSADI_QOF_APOSTROPHE = "[''\\u2019\\u2018\\u05F3\\u02BC\\u0060\\u00B4\\u2032]";

function normalizeHousekeepingLine(line) {
  return line
    .replace(new RegExp(`צ${HEBREW_TSADI_QOF_APOSTROPHE}ק`, "g"), "צק")
    .replace(/ציק/g, "צק");
}

const FORWARDED_RE = /הועברה/i;

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

const CHECKIN_INLINE_MULTI_SUFFIX_RE = new RegExp(
  `^(?:room\\s*)?(${ROOM_LIST_FRAGMENT})\\s+(?:צק\\s*אין|ci|check\\s*in)$`,
  "i",
);
const CHECKIN_INLINE_MULTI_PREFIX_RE = new RegExp(
  `^(?:צק\\s*אין|ci|check\\s*in)\\s+(${ROOM_LIST_FRAGMENT})$`,
  "i",
);

const CHECKIN_ACTION_ONLY_RE = /^(?:ci|check\s*in|צק\s*אין)$/i;

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

const CHECKOUT_INLINE_RE = new RegExp(
  `(?:^|\\s)(?:room\\s*)?(\\d{1,2})\\s+${CHECKOUT_TOKEN_SUFFIX}`,
  "i",
);

const CHECKOUT_INLINE_MULTI_SUFFIX_RE = new RegExp(
  `^(?:room\\s*)?(${ROOM_LIST_FRAGMENT})\\s+(?:co|check\\s*out|צק\\s*אא?וט)$`,
  "i",
);
const CHECKOUT_INLINE_MULTI_PREFIX_RE = new RegExp(
  `^(?:co|check\\s*out|צק\\s*אא?וט)\\s+(${ROOM_LIST_FRAGMENT})$`,
  "i",
);

const CHECKOUT_ACTION_ONLY_RE = /^(?:co|check\s*out|צק\s*אא?וט)$/i;

const READY_INLINE_MULTI_CHECKMARK_RE = new RegExp(
  `^(?:room\\s*)?(${ROOM_LIST_FRAGMENT})\\s*✅$`,
  "i",
);
const READY_INLINE_MULTI_WORD_RE = new RegExp(
  `^(?:room\\s*)?(${ROOM_LIST_FRAGMENT})\\s+(?:מוכן|ready|is\\s+ready|si\\s+ready)$`,
  "i",
);

const READY_ACTION_ONLY_RE = /^(?:מוכן|ready|is\s+ready|si\s+ready|✅)$/i;

function inSuiteRange(n) {
  return Number.isInteger(n) && n >= MIN_ROOM && n <= MAX_ROOM;
}

function addRoom(rooms, raw) {
  const n = parseInt(String(raw ?? ""), 10);
  if (inSuiteRange(n)) rooms.add(n);
}

function addRoomsFromList(rooms, fragment) {
  for (const part of fragment.split(/[\s,/|&\-]+/)) {
    const t = part.trim();
    if (!t) continue;
    const n = parseInt(t, 10);
    if (inSuiteRange(n)) rooms.add(n);
  }
}

function extractBareRoomNumbers(line) {
  const m = line.match(new RegExp(`^(?:room\\s*)?(${ROOM_LIST_FRAGMENT})$`, "i"));
  if (!m) return [];
  const out = [];
  for (const part of m[1].split(/[\s,/|&\-]+/)) {
    const t = part.trim();
    if (!t) continue;
    const n = parseInt(t, 10);
    if (inSuiteRange(n)) out.push(n);
  }
  return out;
}

function applyPendingRooms(rooms, pending) {
  for (const n of pending) rooms.add(n);
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
  if (matchCheckInRoom(line) !== undefined) return true;
  if (CHECKIN_INLINE_MULTI_SUFFIX_RE.test(line) || CHECKIN_INLINE_MULTI_PREFIX_RE.test(line)) return true;
  return CHECKIN_ACTION_ONLY_RE.test(line);
}

export function parseHousekeepingCheckInRoomNumbers(text) {
  const body = String(text ?? "").trim();
  if (!body || FORWARDED_RE.test(body)) return [];

  const rooms = new Set();
  let pending = [];

  for (const line of body.split(/\r?\n/)) {
    const t = normalizeHousekeepingLine(line.trim());
    if (!t) continue;
    if (HAS_CHECKMARK_RE.test(t)) continue;

    const room = matchCheckInRoom(t);
    if (room) {
      addRoom(rooms, room);
      continue;
    }

    const multiSuffix = t.match(CHECKIN_INLINE_MULTI_SUFFIX_RE);
    if (multiSuffix) {
      addRoomsFromList(rooms, multiSuffix[1]);
      pending = [];
      continue;
    }
    const multiPrefix = t.match(CHECKIN_INLINE_MULTI_PREFIX_RE);
    if (multiPrefix) {
      addRoomsFromList(rooms, multiPrefix[1]);
      pending = [];
      continue;
    }

    if (CHECKIN_ACTION_ONLY_RE.test(t) && pending.length) {
      applyPendingRooms(rooms, pending);
      pending = [];
      continue;
    }

    const bare = extractBareRoomNumbers(t);
    if (bare.length) {
      pending.push(...bare);
    }
  }

  return [...rooms].sort((a, b) => a - b);
}

export function parseHousekeepingCheckOutRoomNumbers(text) {
  const body = String(text ?? "").trim();
  if (!body || FORWARDED_RE.test(body)) return [];

  const rooms = new Set();
  let pending = [];

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
    if (m) {
      addRoom(rooms, m[1]);
      continue;
    }
    m = t.match(CHECKOUT_INLINE_RE);
    if (m) {
      addRoom(rooms, m[1]);
      continue;
    }

    m = t.match(CHECKOUT_INLINE_MULTI_SUFFIX_RE);
    if (m) {
      addRoomsFromList(rooms, m[1]);
      pending = [];
      continue;
    }
    m = t.match(CHECKOUT_INLINE_MULTI_PREFIX_RE);
    if (m) {
      addRoomsFromList(rooms, m[1]);
      pending = [];
      continue;
    }

    if (CHECKOUT_ACTION_ONLY_RE.test(t) && pending.length) {
      applyPendingRooms(rooms, pending);
      pending = [];
      continue;
    }

    const bare = extractBareRoomNumbers(t);
    if (bare.length) {
      pending.push(...bare);
    }
  }

  return [...rooms].sort((a, b) => a - b);
}

export function parseHousekeepingReadyRoomNumbers(text) {
  const body = String(text ?? "").trim();
  if (!body || FORWARDED_RE.test(body)) return [];

  const rooms = new Set();
  let pending = [];

  for (const line of body.split(/\r?\n/)) {
    const t = normalizeHousekeepingLine(line.trim());
    if (!t || READY_EXCLUDE_LINE_RE.test(t)) continue;
    if (isCheckInLine(t) && !HAS_CHECKMARK_RE.test(t)) continue;
    if (CHECKOUT_PREFIX_RE.test(t) || CHECKOUT_SUFFIX_RE.test(t)) continue;

    let m = t.match(/^(?:room\s*)?(\d{1,2})\s*✅/i);
    if (m) {
      addRoom(rooms, m[1]);
      continue;
    }

    m = t.match(READY_INLINE_MULTI_CHECKMARK_RE);
    if (m) {
      addRoomsFromList(rooms, m[1]);
      pending = [];
      continue;
    }

    m = t.match(/^(?:room\s*)?(\d{1,2})\s*(?:מוכן|ready|is\s+ready|si\s+ready)\b/i);
    if (m) {
      addRoom(rooms, m[1]);
      continue;
    }

    m = t.match(READY_INLINE_MULTI_WORD_RE);
    if (m) {
      addRoomsFromList(rooms, m[1]);
      pending = [];
      continue;
    }

    if (READY_ACTION_ONLY_RE.test(t) && pending.length) {
      applyPendingRooms(rooms, pending);
      pending = [];
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
      continue;
    }

    const bare = extractBareRoomNumbers(t);
    if (bare.length) {
      pending.push(...bare);
    }
  }

  return [...rooms].sort((a, b) => a - b);
}

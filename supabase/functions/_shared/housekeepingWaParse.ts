// Parse signals from the housekeeping WhatsApp group (צ'ק אין צ'ק אאוט).
// Ready: N✅ / ready / מוכן → bell (ממתין לאישור).
// Check-in: N צ'ק אין / CI N / check in → guests.checked_in + room תפוס.
// Check-out: Co N / N co / צ'ק אאוט → guests.checked_out + room לניקיון.
//
// Multi-line staff style (Adir): room list on one line, action on the next —
// e.g. "4,5\nצ׳ק אין" or "4 5\n✅". Pending rooms accumulate across bare-number
// lines until an action-only or inline-multi line consumes them.
//
// ✅ is the primary, authoritative signal that a room is clean/ready — it always
// wins. A line that happens to mention "צ'ק אין" (check-in) alongside a ✅ is
// still a READY signal, not a check-in one: in practice ✅ always arrives first
// (room turned over), and staff only type "N צ'ק אין" later, in its own message
// with no ✅, once the guest actually walks in. So: line has ✅ → ready only,
// never check-in. Line has check-in phrasing with NO ✅ → check-in only.

const MIN_ROOM = 1;
const MAX_ROOM = 26;

/** Comma / space / slash lists: "4,5", "4 5", "4/5". */
const ROOM_LIST_FRAGMENT = "[\\d\\s,/|&\\-]+";

/** iOS/WhatsApp often use U+2019 etc. instead of ASCII ' or Hebrew geresh. */
const HEBREW_TSADI_QOF_APOSTROPHE = "[''\\u2019\\u2018\\u05F3\\u02BC\\u0060\\u00B4\\u2032]";

function normalizeHousekeepingLine(line: string): string {
  return line
    .replace(new RegExp(`צ${HEBREW_TSADI_QOF_APOSTROPHE}ק`, "g"), "צק")
    .replace(/ציק/g, "צק");
}

/** Whole-message skip (forwarded bubbles). */
const FORWARDED_RE = /הועברה/i;

/** ✅ always takes priority over check-in phrasing in the same line — see header note. */
const HAS_CHECKMARK_RE = /✅/;

/** Per-line exclusions for READY parser only (check-in / check-out have their own parsers). */
const READY_EXCLUDE_LINE_RE =
  /ממתין|\bcheck\s*[- ]?\s*out\b|\bco\b|\bout\b|יצאו|צ['׳']ק\s*אא?וט|צק\s*אא?וט/i;

/** N צ'ק אין / N check in — must not match check out. */
const CHECKIN_LINE_RE =
  /^(?:room\s*)?(\d{1,2})\s*(?:צ['׳']ק\s*אין|צק\s*אין|\bcheck\s*[- ]?\s*in\b)/i;

const CHECKIN_TOKEN_PREFIX = "(?:ci\\b|check\\s*[- ]?\\s*in\\b|צ['׳']ק\\s*אין|צק\\s*אין)";
const CHECKIN_TOKEN_SUFFIX = "(?:ci\\b|check\\s*[- ]?\\s*in\\b)";

/** "CI 17" / "check in 16" / "צ'ק אין 24" */
const CHECKIN_PREFIX_RE = new RegExp(
  `^(?:room\\s*)?${CHECKIN_TOKEN_PREFIX}\\s+(\\d{1,2})$`,
  "i",
);

/** "17 ci" / "16 check in" */
const CHECKIN_SUFFIX_RE = new RegExp(
  `^(?:room\\s*)?(\\d{1,2})\\s+${CHECKIN_TOKEN_SUFFIX}`,
  "i",
);

/** "4,5 צק אין" / "check in 4,5" */
const CHECKIN_INLINE_MULTI_SUFFIX_RE = new RegExp(
  `^(?:room\\s*)?(${ROOM_LIST_FRAGMENT})\\s+(?:צק\\s*אין|ci|check\\s*in)$`,
  "i",
);
const CHECKIN_INLINE_MULTI_PREFIX_RE = new RegExp(
  `^(?:צק\\s*אין|ci|check\\s*in)\\s+(${ROOM_LIST_FRAGMENT})$`,
  "i",
);

/** Action on its own line after a bare room list: "צק אין" / "ci" */
const CHECKIN_ACTION_ONLY_RE = /^(?:ci|check\s*in|צק\s*אין)$/i;

// Hebrew has no JS \w word-chars — never put \b after Hebrew alternatives.
const CHECKOUT_TOKEN_PREFIX =
  "(?:co|check\\s*[- ]?\\s*out|צ['׳']ק\\s*אא?וט|צק\\s*אא?וט)";
const CHECKOUT_TOKEN_SUFFIX =
  "(?:co\\b|check\\s*[- ]?\\s*out\\b|צ['׳']ק\\s*אא?וט|צק\\s*אא?וט)";

/** "Co 23" / "check out 16" / "צ'ק אאוט 24" */
const CHECKOUT_PREFIX_RE = new RegExp(
  `^(?:room\\s*)?${CHECKOUT_TOKEN_PREFIX}\\s+(\\d{1,2})$`,
  "i",
);

/** "24 co" / "16 check out" / "23 צ'ק אאוט" */
const CHECKOUT_SUFFIX_RE = new RegExp(
  `^(?:room\\s*)?(\\d{1,2})\\s+${CHECKOUT_TOKEN_SUFFIX}`,
  "i",
);

/** Inline anywhere in line: "שילמו בקבלה 7 co" */
const CHECKOUT_INLINE_RE = new RegExp(
  `(?:^|\\s)(?:room\\s*)?(\\d{1,2})\\s+${CHECKOUT_TOKEN_SUFFIX}`,
  "i",
);

/** "4,5 co" / "co 4,5" */
const CHECKOUT_INLINE_MULTI_SUFFIX_RE = new RegExp(
  `^(?:room\\s*)?(${ROOM_LIST_FRAGMENT})\\s+(?:co|check\\s*out|צק\\s*אא?וט)$`,
  "i",
);
const CHECKOUT_INLINE_MULTI_PREFIX_RE = new RegExp(
  `^(?:co|check\\s*out|צק\\s*אא?וט)\\s+(${ROOM_LIST_FRAGMENT})$`,
  "i",
);

const CHECKOUT_ACTION_ONLY_RE = /^(?:co|check\s*out|צק\s*אא?וט)$/i;

/** "4,5 ✅" / "4,5 מוכן" */
const READY_INLINE_MULTI_CHECKMARK_RE = new RegExp(
  `^(?:room\\s*)?(${ROOM_LIST_FRAGMENT})\\s*✅$`,
  "i",
);
const READY_INLINE_MULTI_WORD_RE = new RegExp(
  `^(?:room\\s*)?(${ROOM_LIST_FRAGMENT})\\s+(?:מוכן|ready|is\\s+ready|si\\s+ready)$`,
  "i",
);

const READY_ACTION_ONLY_RE = /^(?:מוכן|ready|is\s+ready|si\s+ready|✅)$/i;

function inSuiteRange(n: number): boolean {
  return Number.isInteger(n) && n >= MIN_ROOM && n <= MAX_ROOM;
}

function addRoom(rooms: Set<number>, raw: string | undefined): void {
  const n = parseInt(String(raw ?? ""), 10);
  if (inSuiteRange(n)) rooms.add(n);
}

function addRoomsFromList(rooms: Set<number>, fragment: string): void {
  for (const part of fragment.split(/[\s,/|&\-]+/)) {
    const t = part.trim();
    if (!t) continue;
    const n = parseInt(t, 10);
    if (inSuiteRange(n)) rooms.add(n);
  }
}

/** Bare room list line: "4,5", "4 5", "4/5" — no action tokens. */
function extractBareRoomNumbers(line: string): number[] {
  const m = line.match(new RegExp(`^(?:room\\s*)?(${ROOM_LIST_FRAGMENT})$`, "i"));
  if (!m) return [];
  const out: number[] = [];
  for (const part of m[1].split(/[\s,/|&\-]+/)) {
    const t = part.trim();
    if (!t) continue;
    const n = parseInt(t, 10);
    if (inSuiteRange(n)) out.push(n);
  }
  return out;
}

function applyPendingRooms(rooms: Set<number>, pending: number[]): void {
  for (const n of pending) rooms.add(n);
}

function matchCheckInRoom(line: string): string | undefined {
  let m = line.match(CHECKIN_LINE_RE);
  if (m) return m[1];
  m = line.match(CHECKIN_PREFIX_RE);
  if (m) return m[1];
  m = line.match(CHECKIN_SUFFIX_RE);
  if (m) return m[1];
  return undefined;
}

function isCheckInLine(line: string): boolean {
  if (matchCheckInRoom(line) !== undefined) return true;
  if (CHECKIN_INLINE_MULTI_SUFFIX_RE.test(line) || CHECKIN_INLINE_MULTI_PREFIX_RE.test(line)) return true;
  return CHECKIN_ACTION_ONLY_RE.test(line);
}

/** Exported for tests via src/utils mirror — keep patterns in sync. */
export function parseHousekeepingCheckInRoomNumbers(text: string): number[] {
  const body = String(text ?? "").trim();
  if (!body || FORWARDED_RE.test(body)) return [];

  const rooms = new Set<number>();
  let pending: number[] = [];

  for (const line of body.split(/\r?\n/)) {
    const t = normalizeHousekeepingLine(line.trim());
    if (!t) continue;
    // ✅ wins — a line with a checkmark is a ready signal, not a check-in one.
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

/** "Co 23" / "24 co" / Hebrew צ'ק אאוט — staff physical checkout signal. */
export function parseHousekeepingCheckOutRoomNumbers(text: string): number[] {
  const body = String(text ?? "").trim();
  if (!body || FORWARDED_RE.test(body)) return [];

  const rooms = new Set<number>();
  let pending: number[] = [];

  for (const line of body.split(/\r?\n/)) {
    const t = normalizeHousekeepingLine(line.trim());
    if (!t) continue;
    if (HAS_CHECKMARK_RE.test(t)) continue;
    // Never steal a check-in line.
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

export function parseHousekeepingReadyRoomNumbers(text: string): number[] {
  const body = String(text ?? "").trim();
  if (!body || FORWARDED_RE.test(body)) return [];

  const rooms = new Set<number>();
  let pending: number[] = [];

  for (const line of body.split(/\r?\n/)) {
    const t = normalizeHousekeepingLine(line.trim());
    if (!t || READY_EXCLUDE_LINE_RE.test(t)) continue;
    // Skip lines that are check-in-only (handled separately) — but ✅ always
    // overrides check-in phrasing in the same line (see header note).
    if (isCheckInLine(t) && !HAS_CHECKMARK_RE.test(t)) continue;
    // Skip checkout-only lines (handled by check-out parser).
    if (CHECKOUT_PREFIX_RE.test(t) || CHECKOUT_SUFFIX_RE.test(t)) continue;

    // "14✅", "7 ✅", "Room 14 ✅"
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

    // "14 מוכן", "22 ready", "Room 2 is ready ✅", "6 si ready ✅"
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

    // "Room 7 ✅" / "Room 10 ✅" (number after Room)
    m = t.match(/^room\s+(\d{1,2})\s*✅/i);
    if (m) {
      addRoom(rooms, m[1]);
      continue;
    }

    // Inline: "22 ready ✅" mid-sentence
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

/**
 * Mirrors supabase/functions/_shared/housekeepingWaParse.ts (Deno boundary).
 */

const MIN_ROOM = 1;
const MAX_ROOM = 26;

const FORWARDED_RE = /הועברה/i;

const READY_EXCLUDE_LINE_RE =
  /ממתין|\bcheck\s*[- ]?\s*out\b|\bco\b|\bout\b|יצאו/i;

const CHECKIN_LINE_RE =
  /^(?:room\s*)?(\d{1,2})\s*(?:צ['׳']ק\s*אין|צק\s*אין|\bcheck\s*[- ]?\s*in\b)/i;

function inSuiteRange(n) {
  return Number.isInteger(n) && n >= MIN_ROOM && n <= MAX_ROOM;
}

function addRoom(rooms, raw) {
  const n = parseInt(String(raw ?? ""), 10);
  if (inSuiteRange(n)) rooms.add(n);
}

export function parseHousekeepingCheckInRoomNumbers(text) {
  const body = String(text ?? "").trim();
  if (!body || FORWARDED_RE.test(body)) return [];

  const rooms = new Set();
  for (const line of body.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    const m = t.match(CHECKIN_LINE_RE);
    if (m) addRoom(rooms, m[1]);
  }
  return [...rooms].sort((a, b) => a - b);
}

export function parseHousekeepingReadyRoomNumbers(text) {
  const body = String(text ?? "").trim();
  if (!body || FORWARDED_RE.test(body)) return [];

  const rooms = new Set();

  for (const line of body.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || READY_EXCLUDE_LINE_RE.test(t)) continue;
    if (CHECKIN_LINE_RE.test(t)) continue;

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

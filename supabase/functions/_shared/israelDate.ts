// Israel-local calendar date helpers for DATE-column comparisons (guests.arrival_date).

export function israelTodayYmd(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
}

export function isArrivalTodayIsrael(arrivalDateStr: string | null | undefined): boolean {
  if (!arrivalDateStr) return false;
  return arrivalDateStr === israelTodayYmd();
}

/** Format any instant as YYYY-MM-DD in Asia/Jerusalem (for IMAP envelope dates). */
export function israelYmdFromInstant(date: Date | null | undefined): string | null {
  if (!date || Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
}

function addCalendarDaysYmd(ymd: string, days: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const utc = new Date(Date.UTC(y, mo - 1, d, 12, 0, 0));
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

type WallParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function wallPartsFromInstant(instant: Date): WallParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(instant);
  const pick = (type: string) => Number(parts.find((p) => p.type === type)?.value || 0);
  return {
    year: pick("year"),
    month: pick("month"),
    day: pick("day"),
    hour: pick("hour"),
    minute: pick("minute"),
    second: pick("second"),
  };
}

function compareWallParts(a: WallParts, b: WallParts): number {
  const keys: Array<keyof WallParts> = ["year", "month", "day", "hour", "minute", "second"];
  for (const key of keys) {
    if (a[key] < b[key]) return -1;
    if (a[key] > b[key]) return 1;
  }
  return 0;
}

/** UTC instant for a wall-clock time in Asia/Jerusalem on a given calendar day. */
function jerusalemWallToUtc(ymd: string, h: number, mi: number, s: number): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const target: WallParts = { year: y, month: mo, day: d, hour: h, minute: mi, second: s };

  let lo = Date.UTC(y, mo - 1, d - 1, 0, 0, 0);
  let hi = Date.UTC(y, mo - 1, d + 2, 0, 0, 0);
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const cmp = compareWallParts(wallPartsFromInstant(new Date(mid)), target);
    if (cmp < 0) lo = mid + 1;
    else hi = mid;
  }
  return new Date(lo);
}

/**
 * IMAP SINCE/BEFORE bounds for one Israel calendar day (midnight→midnight Jerusalem).
 * Gmail envelope internal dates align with this better than naive UTC midnight.
 */
export function israelDayBoundsUtc(ymd: string): { since: Date; before: Date } | null {
  const since = jerusalemWallToUtc(ymd, 0, 0, 0);
  const nextYmd = addCalendarDaysYmd(ymd, 1);
  if (!since || !nextYmd) return null;
  const before = jerusalemWallToUtc(nextYmd, 0, 0, 0);
  if (!before) return null;
  return { since, before };
}

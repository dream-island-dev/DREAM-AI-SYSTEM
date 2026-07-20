/** Format UTC ISO timestamp for Israel-local display (queue override modals). */
export function formatIsraelDateTime(isoString) {
  if (!isoString) return "—";
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: "Asia/Jerusalem",
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

/** True when queue item has a future scheduled send and is not yet delivered. */
export function isFutureScheduledQueueItem(item) {
  if (!item?.scheduledFor) return false;
  if (["sent", "simulated"].includes(item?.status)) return false;
  return new Date(item.scheduledFor).getTime() > Date.now();
}

const ISRAEL_TZ = "Asia/Jerusalem";

/** Today's calendar date YYYY-MM-DD in Israel. */
export function israelTodayYmd() {
  return israelYmdFromIso(new Date().toISOString());
}

/** Tomorrow's calendar date YYYY-MM-DD in Israel. */
export function israelTomorrowYmd() {
  return israelAddDaysYmd(1);
}

/** Add N calendar days to a YYYY-MM-DD string (Israel calendar). */
export function israelAddDaysYmd(days, baseYmd = null) {
  const base = baseYmd || israelTodayYmd();
  const [y, m, d] = String(base).split("-").map(Number);
  if (!y || !m || !d) return base;
  const utc = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  utc.setUTCDate(utc.getUTCDate() + days);
  return israelYmdFromIso(utc.toISOString()) || base;
}

/**
 * Default schedule date for missed-window / late-import queue rows —
 * never returns a past date (uses tomorrow when projected/arrival already passed).
 */
export function futureScheduleDateYmd(item, todayYmd = israelTodayYmd) {
  const today = typeof todayYmd === "function" ? todayYmd() : todayYmd;
  const resolved = resolveQueueScheduleDateYmd(item, () => today);
  if (resolved >= today) return resolved;
  return israelTomorrowYmd();
}

/** YYYY-MM-DD in Israel for an ISO instant (queue schedule date picker default). */
export function israelYmdFromIso(isoString) {
  if (!isoString) return "";
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ISRAEL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  return y && m && day ? `${y}-${m}-${day}` : "";
}

/** HH:MM in Israel for an ISO instant. */
export function israelHmFromIso(isoString) {
  if (!isoString) return "";
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: ISRAEL_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

/**
 * Resolve default schedule date for a queue row — projected instant, else arrival.
 * @param {{ scheduledFor?: string|null, arrivalDate?: string|null }} item
 * @param {() => string} [todayYmd]
 */
export function resolveQueueScheduleDateYmd(item, todayYmd = () => new Date().toISOString().slice(0, 10)) {
  const fromIso = israelYmdFromIso(item?.scheduledFor);
  if (fromIso) return fromIso;
  const arrival = String(item?.arrivalDate ?? "").trim().slice(0, 10);
  if (arrival) return arrival;
  return todayYmd();
}

/**
 * Default date for staff stage scheduling — today if projected/arrival is already past.
 * @param {Array<{ scheduledFor?: string|null, arrivalDate?: string|null }>} items
 */
export function defaultStaffScheduleDateYmd(items, todayYmd = israelTodayYmd) {
  const today = typeof todayYmd === "function" ? todayYmd() : todayYmd;
  let earliestFuture = null;
  for (const item of items) {
    const d = resolveQueueScheduleDateYmd(item, () => today);
    if (d >= today && (earliestFuture === null || d < earliestFuture)) {
      earliestFuture = d;
    }
  }
  return earliestFuture ?? today;
}

/**
 * Build payload rows for staff_schedule_tasks_batch RPC.
 * @param {Array<{ guestId: number, stageKey: string, scheduledFor?: string|null, arrivalDate?: string|null }>} items
 * @param {Record<string, string>} timeByKey — key → HH:MM (keys vary by mode)
 * @param {(item: object) => string} keyForItem
 * @param {Record<string, string>|null} [dateByKey] — optional key → YYYY-MM-DD override
 */
export function buildStaffSchedulePayload(items, timeByKey, keyForItem, dateByKey = null) {
  const rows = [];
  for (const item of items) {
    const key = keyForItem(item);
    const time = String(timeByKey[key] ?? "").trim();
    const dateOverride = String(dateByKey?.[key] ?? "").trim();
    if (!time || !item?.guestId || !item?.stageKey) continue;
    rows.push({
      guest_id: item.guestId,
      stage_key: item.stageKey,
      schedule_date: dateOverride || resolveQueueScheduleDateYmd(item),
      schedule_time: time,
    });
  }
  return rows;
}

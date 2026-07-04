// Israeli 24-hour time helpers — HH:MM dropdowns (no AM/PM).

/** Normalize to zero-padded HH:MM when parseable; otherwise return trimmed raw. */
export function normalizeHmTime(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return s;
  const h = Math.min(23, Math.max(0, Number(m[1])));
  const min = Math.min(59, Math.max(0, Number(m[2])));
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/**
 * Build <select> options for spa/meal times — 24h clock, 15-min steps.
 * Preserves `extraValue` when imported from EZGO (e.g. 14:15).
 */
export function buildIsraeliTimeOptions(extraValue, opts = {}) {
  const {
    startHour = 7,
    endHour = 22,
    stepMinutes = 15,
    emptyLabel = "— בחר שעה —",
  } = opts;

  const seen = new Set();
  const items = [];

  const add = (value, label) => {
    const v = value ? normalizeHmTime(value) : "";
    if (v && seen.has(v)) return;
    if (v) seen.add(v);
    items.push({ value: v, label: label ?? (v || emptyLabel) });
  };

  add("", emptyLabel);
  for (let h = startHour; h <= endHour; h += 1) {
    for (let m = 0; m < 60; m += stepMinutes) {
      if (h === endHour && m > 0) break;
      add(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    }
  }
  if (extraValue) add(extraValue);

  const empty = items.find((x) => !x.value);
  const rest = items
    .filter((x) => x.value)
    .sort((a, b) => a.value.localeCompare(b.value));
  return empty ? [empty, ...rest] : rest;
}

/** Display spa slot for roster/cards: DD/MM/YYYY · HH:MM */
export function formatSpaSchedule(spaDate, spaTime) {
  const time = normalizeHmTime(spaTime);
  const ymd = String(spaDate ?? "").trim().slice(0, 10);
  if (!time && !ymd) return null;
  if (ymd && time) {
    const d = new Date(`${ymd}T12:00:00`);
    const dateStr = Number.isNaN(d.getTime())
      ? ymd
      : d.toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit", year: "numeric" });
    return `${dateStr} · ${time}`;
  }
  return time || ymd;
}

/** Hebrew when-phrase for staff macros / preview — mirrors _shared/spaSchedule.ts */
export function buildSpaWhenPhrase(spaDate, spaTime) {
  const time = normalizeHmTime(spaTime);
  const sched = formatSpaSchedule(spaDate, spaTime);
  if (!sched) return "";
  if (spaDate && time) {
    const datePart = sched.split(" · ")[0];
    return `ב-${datePart} בשעה ${time}`;
  }
  if (time) return `בשעה ${time}`;
  return sched ? `ב-${sched}` : "";
}

// Orit CS — schedule UI helpers (Israel quiet hours 21:00–05:00).

const ISRAEL_TZ = "Asia/Jerusalem";

export function israelLocalHour(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ISRAEL_TZ,
    hour: "numeric",
    hour12: false,
  }).formatToParts(now);
  const hourPart = parts.find((p) => p.type === "hour");
  return hourPart ? parseInt(hourPart.value, 10) : now.getHours();
}

/** Orit staff quiet window — suggest schedule instead of immediate guest send. */
export function isOritQuietHours(now = new Date()) {
  const h = israelLocalHour(now);
  return h >= 21 || h < 5;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

/** Value for <input type="datetime-local"> — default tomorrow 08:00 local. */
export function defaultOritScheduleLocalInput(now = new Date()) {
  const d = new Date(now);
  if (isOritQuietHours(now) || d.getHours() >= 20) {
    d.setDate(d.getDate() + 1);
  }
  d.setHours(8, 0, 0, 0);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T08:00`;
}

export function localInputToIso(localValue) {
  if (!localValue) return null;
  const d = new Date(localValue);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function formatOritScheduleLabel(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("he-IL", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const ORIT_QUIET_HOURS_HINT = "שעות שקט לאורחים: 21:00–05:00 (ישראל) — מומלץ לתזמן לבוקר";

// Israel-local quiet hours for manual outbound guest notifications (22:00–08:00).

const ISRAEL_TZ = "Asia/Jerusalem";

/** Hour (0–23) in Israel right now. */
export function israelLocalHour(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ISRAEL_TZ,
    hour: "numeric",
    hour12: false,
  }).formatToParts(now);
  const hourPart = parts.find((p) => p.type === "hour");
  return hourPart ? parseInt(hourPart.value, 10) : now.getHours();
}

/** True between 22:00 inclusive and 08:00 exclusive (Israel time). */
export function isIsraelQuietHours(now = new Date()) {
  const h = israelLocalHour(now);
  return h >= 22 || h < 8;
}

export const QUIET_HOURS_LABEL = "שליחה מחוץ לשעות הפעילות";

export const QUIET_HOURS_HINT = "שעות שקט: 22:00–08:00 (שעון ישראל)";

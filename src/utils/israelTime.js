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

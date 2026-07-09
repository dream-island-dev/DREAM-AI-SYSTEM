/**
 * Send-window helpers for automation_stages.local_time / local_time_end.
 * Mirrors effectiveCeilLocalHour in supabase/functions/_shared/automationSchedule.ts.
 */

export function parseLocalHourFromTime(timeStr) {
  if (!timeStr) return null;
  const h = parseInt(String(timeStr).trim().split(":")[0], 10);
  return Number.isFinite(h) ? h : null;
}

/** True when end hour is strictly before start hour (Israel-local, same calendar day). */
export function isSendWindowInvalid(localTime, localTimeEnd) {
  const floor = parseLocalHourFromTime(localTime);
  const ceil = parseLocalHourFromTime(localTimeEnd);
  if (floor === null || ceil === null) return false;
  return ceil < floor;
}

/**
 * If admin sets start after end, drop the ceiling so cron can still fire.
 * Returns patch unchanged when window is valid or timing fields untouched.
 */
export function normalizeStageTimingPatch(stage, patch) {
  if (!("local_time" in patch) && !("local_time_end" in patch)) return patch;
  const merged = { ...stage, ...patch };
  if (!isSendWindowInvalid(merged.local_time, merged.local_time_end)) return patch;
  return { ...patch, local_time_end: null };
}

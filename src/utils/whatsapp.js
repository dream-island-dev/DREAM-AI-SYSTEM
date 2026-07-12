// Shared WhatsApp template variable helpers — mirrors whatsapp-send/index.ts.
// Keep in sync when timing/fallback logic changes in the Edge Function.

/** Meta body expects {{1}}=name, {{2}}=entry time, {{3}}=check-in time */
export const THREE_PARAM_TIMING_TEMPLATES = new Set([
  "dream_suite_reminder",
]);

/** Room-ready templates — code may build 2 vars; server trims to live Meta count */
export const TWO_PARAM_ROOM_TEMPLATES = new Set([
  "dream_room_ready",
  "dream_room_ready1",
]);

export function guestDisplayName(guest) {
  const name = String(guest?.name ?? "").trim();
  return name || "אורח יקר";
}

export function guestRoomLabel(guest) {
  const room = String(guest?.room ?? guest?.suite_name ?? "").trim();
  return room || "סוויטה";
}

export function formatArrivalDate(guest) {
  const raw = String(guest?.arrival_date ?? "").trim();
  if (!raw) return "-";
  const parts = raw.split("-");
  if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
  return raw;
}

/** UTC midnight on YYYY-MM-DD — same convention as whatsapp-send resolveDayTimings */
export function resolveDayTimings(arrivalDateStr) {
  if (!arrivalDateStr) return { entryTime: "12:00", checkInTime: "15:00" };
  const d = new Date(`${arrivalDateStr}T00:00:00Z`);
  return d.getUTCDay() === 6
    ? { entryTime: "15:00", checkInTime: "18:00" }
    : { entryTime: "12:00", checkInTime: "15:00" };
}

export function sanitizeTemplateVars(vars) {
  return vars.map((v, i) => {
    const t = String(v ?? "").trim();
    if (t) return t;
    if (i === 0) return "אורח יקר";
    if (i === 1) return "12:00";
    if (i === 2) return "15:00";
    return "-";
  });
}

/** Always returns exactly 3 body parameters for Meta timing templates */
export function buildThreeParamTimingVars(guest, entryTime, checkInTime) {
  return sanitizeTemplateVars([
    guestDisplayName(guest),
    entryTime || "12:00",
    checkInTime || "15:00",
  ]);
}

export function buildThreeParamTimingVarsFromGuest(guest) {
  const { entryTime, checkInTime } = resolveDayTimings(String(guest?.arrival_date ?? ""));
  return buildThreeParamTimingVars(guest, entryTime, checkInTime);
}

export function buildTwoParamRoomVars(guest) {
  return sanitizeTemplateVars([
    guestDisplayName(guest),
    guestRoomLabel(guest),
  ]);
}

export function templateExpectsThreeBodyParams(templateName) {
  return THREE_PARAM_TIMING_TEMPLATES.has(templateName);
}

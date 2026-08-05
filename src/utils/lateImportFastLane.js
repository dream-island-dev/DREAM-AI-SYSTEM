// Browser mirror of supabase/functions/_shared/lateImportFastLane.ts
import { israelTodayStr, israelDateOffsetStr } from "./guestTiming";

function isValidYmd(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? "").trim().slice(0, 10));
}

/** arrival_date is today or tomorrow (Israel) — same-day / T-1 import lane. */
export function isLateImportFastLaneEligible(arrivalDate, now = new Date()) {
  if (!isValidYmd(arrivalDate)) return false;
  const arrival = arrivalDate.trim().slice(0, 10);
  const today = israelTodayStr();
  const tomorrow = israelDateOffsetStr(1, today);
  return arrival === today || arrival === tomorrow;
}

/** Physical presence or late import — sets arrival_confirmed without faking sent flags. */
export function buildPhysicalPresenceArrivalConfirmPatch(guest, now = new Date(), source = "physical_checkin") {
  if (guest?.arrival_confirmed === true && guest?.arrival_confirmed_at) return null;
  const ts = now.toISOString();
  return {
    arrival_confirmed: true,
    arrival_confirmed_at: guest?.arrival_confirmed_at ?? ts,
    arrival_confirmed_source: source,
  };
}

export function buildLateImportFastLanePatch(guest, now = new Date()) {
  if (guest?.automation_scope === "muted" || guest?.automation_muted === true) return null;
  if (guest?.room_type === "day_guest" || guest?.room_type === "premium_day_guest") return null;
  if (!isLateImportFastLaneEligible(guest?.arrival_date, now)) return null;
  return buildPhysicalPresenceArrivalConfirmPatch(guest, now, "late_import");
}

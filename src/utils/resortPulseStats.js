// Resort-wide operational counters — single source for ResortPulseBar + Dashboard hooks.
import { classifyInboxRosterSegment, israelTodayStr } from "./guestTiming";

/**
 * @param {Array<{status?:string,arrival_date?:string,departure_date?:string,requires_attention?:boolean,needs_callback?:boolean}>} guests
 */
export function computeResortPulse(guests, extras = {}) {
  const today = israelTodayStr();
  let arrivalsToday = 0;
  let inResort = 0;
  let departingToday = 0;
  let needsAttention = 0;

  for (const g of guests ?? []) {
    if (!g || g.status === "cancelled") continue;
    if (g.arrival_date === today) arrivalsToday += 1;
    if (g.departure_date === today && g.status !== "checked_out") departingToday += 1;
    if (g.requires_attention || g.needs_callback) needsAttention += 1;
    if (classifyInboxRosterSegment(g) === "in_resort") inResort += 1;
  }

  return {
    arrivalsToday,
    inResort,
    departingToday,
    needsAttention,
    blockedAutomation: extras.blockedAutomation ?? 0,
    openOpsTasks: extras.openOpsTasks ?? 0,
  };
}

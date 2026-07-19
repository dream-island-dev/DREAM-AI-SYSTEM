// Filter guests relevant for Restaurant Board (lunch + dinner meal scheduling).

import { israelTodayStr } from "./guestTiming";
import { MEAL_SLOTS_BY_PLAN, normalizeMealPlan } from "../data/stayMealsSchema";

const MEAL_PLANS_WITH_BOARD = new Set(["dinner_only", "half_board", "full_board"]);
const ACTIVE_STATUSES = new Set(["pending", "expected", "room_ready", "checked_in"]);

const DEFAULT_LUNCH_QUICK_SLOTS = ["12:00", "12:30", "13:00", "13:30", "14:00"];

/** Meal slots the restaurant coordinates (never breakfast — resort-wide hours). */
export function getCoordinationSlotsForGuest(guest) {
  const plan = normalizeMealPlan(guest?.meal_plan);
  return (MEAL_SLOTS_BY_PLAN[plan] ?? []).filter((slot) => slot !== "breakfast");
}

export function getLunchQuickSlots(config) {
  const fromCfg = config?.lunch_offer_slots;
  if (Array.isArray(fromCfg) && fromCfg.length) {
    return fromCfg.map((s) => String(s).trim()).filter((s) => /^\d{1,2}:\d{2}$/.test(s));
  }
  return [...DEFAULT_LUNCH_QUICK_SLOTS];
}

function guestHasWalkInFlag(guest) {
  const r = guest?.guest_profile?.restaurant;
  return Boolean(r && typeof r === "object" && r.walk_in);
}

function hasRestaurantMealReason(guest) {
  const plan = normalizeMealPlan(guest?.meal_plan);
  if (MEAL_PLANS_WITH_BOARD.has(plan)) return true;
  const lunch = String(guest?.lunch_time ?? "").trim();
  const dinner = String(guest?.dinner_time ?? guest?.meal_time ?? "").trim();
  if (lunch || dinner) return true;
  return guestHasWalkInFlag(guest);
}

/** Per-slot time string from guest row. */
export function getGuestMealSlotTime(guest, slot) {
  if (slot === "lunch") return String(guest?.lunch_time ?? "").trim();
  if (slot === "dinner") return String(guest?.dinner_time ?? guest?.meal_time ?? "").trim();
  return "";
}

/** Missing coordination slots for this guest (empty = fully scheduled). */
export function getMissingCoordinationSlots(guest) {
  const slots = getCoordinationSlotsForGuest(guest);
  const missing = slots.filter((slot) => !getGuestMealSlotTime(guest, slot));
  if (!slots.length && guestHasWalkInFlag(guest)) {
    const hasAny = getGuestMealSlotTime(guest, "lunch") || getGuestMealSlotTime(guest, "dinner");
    if (!hasAny) return ["lunch", "dinner"];
  }
  return missing;
}

export function guestNeedsMealCoordination(guest) {
  return getMissingCoordinationSlots(guest).length > 0;
}

/** Guest is on property (or arriving) on calendar day `dayYmd` (Israel). */
export function isGuestOnPropertyForDay(guest, dayYmd = israelTodayStr()) {
  if (!guest?.arrival_date || guest.status === "cancelled") return false;
  if (!ACTIVE_STATUSES.has(guest.status)) return false;

  const arrival = guest.arrival_date;
  const departure = guest.departure_date || guest.arrival_date;

  if (arrival > dayYmd) return false;
  if (departure < dayYmd) return false;
  return true;
}

/** True when guest should appear on restaurant board for `dayYmd`. */
export function isRestaurantBoardGuest(guest, dayYmd = israelTodayStr()) {
  if (!isGuestOnPropertyForDay(guest, dayYmd)) return false;
  return hasRestaurantMealReason(guest);
}

/** @deprecated use isRestaurantBoardGuest */
export const isRestaurantDinnerGuest = isRestaurantBoardGuest;

export function filterRestaurantDinnerGuests(guests, dayYmd = israelTodayStr()) {
  return (guests ?? []).filter((g) => isRestaurantBoardGuest(g, dayYmd));
}

export function sortRestaurantDinnerGuests(guests) {
  return [...(guests ?? [])].sort((a, b) => {
    const ta = String(a.dinner_time ?? a.lunch_time ?? a.meal_time ?? "99:99");
    const tb = String(b.dinner_time ?? b.lunch_time ?? b.meal_time ?? "99:99");
    if (ta !== tb) return ta.localeCompare(tb);
    return String(a.name ?? "").localeCompare(String(b.name ?? ""), "he");
  });
}

export function buildRestaurantDinnerMealPatch(guest, { lunchTime, dinnerTime, mealLocation, mealPlan }) {
  const plan = normalizeMealPlan(mealPlan ?? guest.meal_plan);
  const lunch = String(lunchTime ?? guest.lunch_time ?? "").trim() || null;
  const dinner = String(dinnerTime ?? guest.dinner_time ?? guest.meal_time ?? "").trim() || null;
  const loc = String(mealLocation ?? guest.meal_location ?? "").trim() || null;
  const primary = dinner || lunch || String(guest.breakfast_time ?? "").trim() || null;

  return {
    meal_plan: plan,
    breakfast_time: guest.breakfast_time?.trim() || null,
    lunch_time: lunch,
    dinner_time: dinner,
    meal_time: primary,
    meal_location: loc,
  };
}

// Meal plan + stay booking type — shared by GuestProfileModal, AddGuestModal, portal.

export const MEAL_PLANS = [
  { id: "none",         label: "ללא פנסיון" },
  { id: "dinner_only",  label: "ארוחת ערב בלבד" },
  { id: "half_board",   label: "חצי פנסיון" },
  { id: "full_board",   label: "פנסיון מלא" },
];

export const BOOKING_TYPES = [
  { id: "auto",    label: "זיהוי אוטומטי" },
  { id: "private", label: "לקוח פרטי" },
  { id: "group",   label: "קבוצה / הזמנה משותפת" },
];

const MEAL_PLAN_IDS = new Set(MEAL_PLANS.map((x) => x.id));
const BOOKING_TYPE_IDS = new Set(BOOKING_TYPES.map((x) => x.id));

/** Which meal slots are relevant per plan (for time pickers + portal). */
export const MEAL_SLOTS_BY_PLAN = {
  none: [],
  dinner_only: ["dinner"],
  half_board: ["breakfast", "dinner"],
  full_board: ["breakfast", "lunch", "dinner"],
};

export const MEAL_SLOT_LABELS = {
  breakfast: "ארוחת בוקר",
  lunch: "ארוחת צהריים",
  dinner: "ארוחת ערב",
};

export function normalizeMealPlan(raw) {
  return MEAL_PLAN_IDS.has(raw) ? raw : "none";
}

export function emptyStayProfile() {
  return { booking_type: "auto" };
}

export function normalizeStayProfile(raw) {
  const base = emptyStayProfile();
  if (!raw || typeof raw !== "object") return base;
  if (BOOKING_TYPE_IDS.has(raw.booking_type)) base.booking_type = raw.booking_type;
  return base;
}

export function serializeStayProfile(stay) {
  const s = normalizeStayProfile(stay);
  if (s.booking_type === "auto") return {};
  return { booking_type: s.booking_type };
}

export function mealTimesFromGuest(guest) {
  return {
    breakfast: guest?.breakfast_time ?? "",
    lunch: guest?.lunch_time ?? "",
    dinner: guest?.dinner_time ?? guest?.meal_time ?? "",
  };
}

/** Sync legacy meal_time for WA macros / old rows. */
export function applyLegacyMealColumns(plan, times, mealLocation) {
  const t = {
    breakfast_time: times.breakfast?.trim() || null,
    lunch_time: times.lunch?.trim() || null,
    dinner_time: times.dinner?.trim() || null,
    meal_plan: normalizeMealPlan(plan),
    meal_location: (mealLocation ?? "").trim() || null,
  };
  const primary =
    t.dinner_time || t.lunch_time || t.breakfast_time || null;
  t.meal_time = primary;
  return t;
}

const labelById = (list, id) => list.find((x) => x.id === id)?.label ?? id;

export function mealPlanLabel(planId) {
  return labelById(MEAL_PLANS, normalizeMealPlan(planId));
}

/** Rows for guest portal itinerary (only slots with time or plan implies them). */
export function buildMealsItinerary(guest) {
  const plan = normalizeMealPlan(guest?.meal_plan);
  const location = (guest?.meal_location ?? "").trim() || null;
  const times = mealTimesFromGuest(guest);
  const slots = MEAL_SLOTS_BY_PLAN[plan] ?? [];
  const rows = [];

  if (plan !== "none") {
    rows.push({
      icon: "🍴",
      label: "בסיס אירוח",
      value: mealPlanLabel(plan),
    });
  } else if (location) {
    rows.push({ icon: "🍴", label: "בסיס אירוח", value: location });
  }

  for (const slot of slots) {
    const time = (times[slot] ?? "").trim();
    if (time) {
      rows.push({
        icon: slot === "dinner" ? "🍽️" : "☕",
        label: MEAL_SLOT_LABELS[slot],
        value: location ? `${time} · ${location}` : time,
      });
    }
  }

  // Legacy single meal_time when plan is none but time exists
  if (plan === "none" && (times.dinner ?? "").trim()) {
    rows.push({
      icon: "🍽️",
      label: "ארוחה",
      value: location
        ? `${times.dinner.trim()} · ${location}`
        : times.dinner.trim(),
    });
  }

  return rows;
}

export function hasMealItinerary(guest) {
  return buildMealsItinerary(guest).length > 0;
}

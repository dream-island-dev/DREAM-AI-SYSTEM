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

/** Infer meal_plan from EZGO abbreviations / Hebrew when DB enum not set yet. */
export function inferMealPlanFromHints({
  meal_plan,
  meal_plan_label,
  package_label,
  guest_type_reason,
} = {}) {
  const normalized = normalizeMealPlan(meal_plan);
  if (normalized !== "none") return normalized;

  const hay = [meal_plan_label, package_label, guest_type_reason].filter(Boolean).join(" ");
  if (/\bFB\b|Full[\s-]?Board|פנסיון\s*מלא/i.test(hay)) return "full_board";
  if (/\bHB\b|Half[\s-]?Board|חצי\s*פנסיון/i.test(hay)) return "half_board";
  if (/ארוחת\s*ערב\s*בלבד|dinner\s*only/i.test(hay)) return "dinner_only";
  return "none";
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
      label: "פנסיון",
      value: mealPlanLabel(plan),
    });
  } else if (location) {
    rows.push({ icon: "🍴", label: "פנסיון", value: location });
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

/** Compact Hebrew line for LLM guest context + dining Tier-0. */
export function formatGuestMealsForAi(guest) {
  const rows = buildMealsItinerary(guest);
  if (!rows.length) return "";
  const details = rows.map((r) => `${r.label}: ${r.value}`).join(", ");
  return `ארוחות (לפי הפנסיון בהזמנה): ${details}`;
}

export function getGuestDinnerSlot(guest) {
  if (!guest) return null;
  const rows = buildMealsItinerary(guest);
  const dinner = rows.find((r) => r.label === "ארוחת ערב" || r.label === "ארוחה");
  return dinner?.value?.trim() || null;
}

export function retrieveDiningKnowledgeLines(knowledgeBase, _guestText, topK = 2) {
  const kb = String(knowledgeBase || "").trim();
  if (!kb) return [];
  return kb
    .split(/\n{2,}|(?=•\s)/)
    .map((c) => c.trim())
    .filter((c) => c.length > 20 && /מסעד|ארוח|אוכל|בוקר|צהריים|ערב|ערמונים|שף|פנסיון/i.test(c))
    .slice(0, topK);
}

export function retrieveMealKnowledgeLines(knowledgeBase, guestText, slot, topK = 2) {
  const queries = {
    breakfast: "ארוחת בוקר עמדות אוכל נשנושים קולינריה",
    lunch: "ארוחת צהריים",
    dinner: "ארוחת ערב מסעדת ערמונים שף",
  };
  const chunkRes = {
    breakfast: /בוקר|breakfast|עמדות\s*אוכל|נשנוש|קולינר/i,
    lunch: /צהריים|lunch/i,
    dinner: /ערב|dinner|ערמונים|מסעד/i,
  };
  const query = String(guestText || "").trim() || queries[slot];
  return retrieveDiningKnowledgeLines(knowledgeBase, query, topK + 2)
    .filter((c) => chunkRes[slot].test(c))
    .slice(0, topK);
}

export function getGuestBreakfastSlot(guest) {
  if (!guest) return null;
  const rows = buildMealsItinerary(guest);
  const breakfast = rows.find((r) => r.label === "ארוחת בוקר");
  return breakfast?.value?.trim() || null;
}

export function extractRestaurantMealHours(cfg = {}, slot, knowledgeBase = "", guestText = "") {
  const strictPatterns = {
    breakfast: /(?:ארוחת?\s*)?בוקר\s*(?:[:：]\s*)?(\d{1,2}:\d{2}\s*[–—-]\s*\d{1,2}:\d{2})/iu,
    lunch: /(?:ארוחת?\s*)?צהריים\s*(?:[:：]\s*)?(\d{1,2}:\d{2}\s*[–—-]\s*\d{1,2}:\d{2})/iu,
    dinner: /(?:ארוחת?\s*)?ערב\s*(?:[:：]\s*)?(\d{1,2}:\d{2}\s*[–—-]\s*\d{1,2}:\d{2})/iu,
  };

  const tryText = (raw) => {
    const t = String(raw || "").trim();
    if (!t) return null;
    const sm = t.match(strictPatterns[slot]);
    if (sm?.[1]?.trim()) return sm[1].trim();
    if (slot === "breakfast") return null;
    const pipePatterns = {
      lunch: /צהריים\s*([^|]+)/iu,
      dinner: /ערב\s*([^|]+)/iu,
    };
    const pm = t.match(pipePatterns[slot]);
    return pm?.[1]?.trim() || null;
  };

  const kb = String(knowledgeBase || "").trim();
  if (kb) {
    for (const line of retrieveMealKnowledgeLines(kb, guestText, slot)) {
      const hit = tryText(line);
      if (hit) return hit;
    }
    const fromKb = tryText(kb);
    if (fromKb) return fromKb;
  }

  if (slot === "breakfast") return null;

  return tryText(cfg.hotel_restaurant_hours);
}

export function formatRestaurantHoursLine(cfg = {}) {
  const raw = (cfg.hotel_restaurant_hours || "").trim();
  const withoutBreakfast = raw.replace(/בוקר\s*[^|]+\s*\|\s*/iu, "").trim();
  const restaurant = withoutBreakfast || raw || "18:30–22:00";
  return `מסעדת ערמונים — שעות פעילות: ${restaurant}`;
}

export function formatRestaurantKnowledgeForReply(cfg = {}, knowledgeBase = "", guestText = "") {
  const kbLines = retrieveDiningKnowledgeLines(knowledgeBase, guestText);
  if (kbLines.length) return kbLines.join("\n");
  return `${formatRestaurantHoursLine(cfg)}.`;
}

export function hasMealItinerary(guest) {
  return buildMealsItinerary(guest).length > 0;
}

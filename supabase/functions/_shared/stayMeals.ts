// Deno mirror of src/data/stayMealsSchema.js — guest portal meal itinerary.

type GuestMealRow = {
  meal_plan?: string | null;
  meal_location?: string | null;
  meal_time?: string | null;
  breakfast_time?: string | null;
  lunch_time?: string | null;
  dinner_time?: string | null;
};

const MEAL_PLAN_LABELS: Record<string, string> = {
  none: "ללא פנסיון",
  dinner_only: "ארוחת ערב בלבד",
  half_board: "חצי פנסיון",
  full_board: "פנסיון מלא",
};

const SLOTS_BY_PLAN: Record<string, string[]> = {
  none: [],
  dinner_only: ["dinner"],
  half_board: ["breakfast", "dinner"],
  full_board: ["breakfast", "lunch", "dinner"],
};

const SLOT_LABELS: Record<string, string> = {
  breakfast: "ארוחת בוקר",
  lunch: "ארוחת צהריים",
  dinner: "ארוחת ערב",
};

function normalizePlan(raw?: string | null): string {
  const p = raw ?? "none";
  return p in MEAL_PLAN_LABELS ? p : "none";
}

export function buildMealsItinerary(guest: GuestMealRow): { icon: string; label: string; value: string }[] {
  const plan = normalizePlan(guest.meal_plan);
  const location = (guest.meal_location ?? "").trim() || null;
  const times = {
    breakfast: guest.breakfast_time ?? "",
    lunch: guest.lunch_time ?? "",
    dinner: guest.dinner_time ?? guest.meal_time ?? "",
  };
  const rows: { icon: string; label: string; value: string }[] = [];

  if (plan !== "none") {
    rows.push({ icon: "🍴", label: "בסיס אירוח", value: MEAL_PLAN_LABELS[plan] });
  } else if (location) {
    rows.push({ icon: "🍴", label: "בסיס אירוח", value: location });
  }

  for (const slot of SLOTS_BY_PLAN[plan] ?? []) {
    const time = (times[slot as keyof typeof times] ?? "").trim();
    if (time) {
      rows.push({
        icon: slot === "dinner" ? "🍽️" : "☕",
        label: SLOT_LABELS[slot] ?? slot,
        value: location ? `${time} · ${location}` : time,
      });
    }
  }

  if (plan === "none" && (times.dinner ?? "").trim()) {
    const t = times.dinner.trim();
    rows.push({
      icon: "🍽️",
      label: "ארוחה",
      value: location ? `${t} · ${location}` : t,
    });
  }

  return rows;
}

// Deno mirror of src/data/stayMealsSchema.js — guest portal meal itinerary.

import { retrieveDiningKnowledgeLines, retrieveMealKnowledgeLines } from "./guestRag.ts";
export type GuestMealRow = {
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

export function inferMealPlanFromHints(hints: {
  meal_plan?: string | null;
  meal_plan_label?: string | null;
  package_label?: string | null;
  guest_type_reason?: string | null;
} = {}): string {
  const normalized = normalizePlan(hints.meal_plan);
  if (normalized !== "none") return normalized;

  const hay = [hints.meal_plan_label, hints.package_label, hints.guest_type_reason]
    .filter(Boolean)
    .join(" ");
  if (/\bFB\b|Full[\s-]?Board|פנסיון\s*מלא/i.test(hay)) return "full_board";
  if (/\bHB\b|Half[\s-]?Board|חצי\s*פנסיון/i.test(hay)) return "half_board";
  if (/ארוחת\s*ערב\s*בלבד|dinner\s*only/i.test(hay)) return "dinner_only";
  return "none";
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
    rows.push({ icon: "🍴", label: "פנסיון", value: MEAL_PLAN_LABELS[plan] });
  } else if (location) {
    rows.push({ icon: "🍴", label: "פנסיון", value: location });
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

/** Compact Hebrew line for LLM guest context + dining Tier-0. */
export function formatGuestMealsForAi(guest: GuestMealRow): string {
  const rows = buildMealsItinerary(guest);
  if (!rows.length) return "";
  const details = rows.map((r) => `${r.label}: ${r.value}`).join(", ");
  return `ארוחות (לפי הפנסיון בהזמנה): ${details}`;
}

/** Guest dinner slot from DB — null when not on their plan. */
export function getGuestDinnerSlot(guest: GuestMealRow | null | undefined): string | null {
  if (!guest) return null;
  const rows = buildMealsItinerary(guest);
  const dinner = rows.find((r) => r.label === "ארוחת ערב" || r.label === "ארוחה");
  return dinner?.value?.trim() || null;
}

/** Guest breakfast slot from DB — null when not on their plan. */
export function getGuestBreakfastSlot(guest: GuestMealRow | null | undefined): string | null {
  if (!guest) return null;
  const rows = buildMealsItinerary(guest);
  const breakfast = rows.find((r) => r.label === "ארוחת בוקר");
  return breakfast?.value?.trim() || null;
}

/** Parse lunch/dinner hours from KB or bot_config pipe text (HH:MM–HH:MM only). */
export function extractRestaurantMealHours(
  cfg: Record<string, string>,
  slot: "breakfast" | "lunch" | "dinner",
  knowledgeBase?: string,
  guestText?: string,
): string | null {
  const strictPatterns: Record<typeof slot, RegExp> = {
    breakfast: /(?:ארוחת?\s*)?בוקר\s*(?:[:：]\s*)?(\d{1,2}:\d{2}\s*[–—-]\s*\d{1,2}:\d{2})/iu,
    lunch: /(?:ארוחת?\s*)?צהריים\s*(?:[:：]\s*)?(\d{1,2}:\d{2}\s*[–—-]\s*\d{1,2}:\d{2})/iu,
    dinner: /(?:ארוחת?\s*)?ערב\s*(?:[:：]\s*)?(\d{1,2}:\d{2}\s*[–—-]\s*\d{1,2}:\d{2})/iu,
  };

  const tryText = (raw: string): string | null => {
    const t = (raw ?? "").trim();
    if (!t) return null;
    const sm = t.match(strictPatterns[slot]);
    if (sm?.[1]?.trim()) return sm[1].trim();
    if (slot === "breakfast") return null;
    const pipePatterns: Record<"lunch" | "dinner", RegExp> = {
      lunch: /צהריים\s*([^|]+)/iu,
      dinner: /ערב\s*([^|]+)/iu,
    };
    const pm = t.match(pipePatterns[slot as "lunch" | "dinner"]);
    return pm?.[1]?.trim() || null;
  };

  const kb = (knowledgeBase ?? "").trim();
  if (kb) {
    for (const line of retrieveMealKnowledgeLines(kb, guestText ?? "", slot)) {
      const hit = tryText(line);
      if (hit) return hit;
    }
    const fromKb = tryText(kb);
    if (fromKb) return fromKb;
  }

  // Breakfast is not Armonim pipe hours — only KB verbatim / guest profile.
  if (slot === "breakfast") return null;

  return tryText(cfg["hotel_restaurant_hours"] ?? "");
}

export function formatRestaurantHoursLine(cfg: Record<string, string>): string {
  const restaurant = (cfg["hotel_restaurant_hours"] ?? "").trim() || "07:00–22:00";
  return `מסעדת ערמונים — שעות פעילות: ${restaurant}`;
}

/** KB-first restaurant copy for Tier-0 + LLM parity; bot_config is fallback only. */
export function formatRestaurantKnowledgeForReply(
  cfg: Record<string, string>,
  knowledgeBase: string,
  guestText: string,
): string {
  const kbLines = retrieveDiningKnowledgeLines(knowledgeBase, guestText);
  if (kbLines.length) return kbLines.join("\n");
  return `${formatRestaurantHoursLine(cfg)}.`;
}

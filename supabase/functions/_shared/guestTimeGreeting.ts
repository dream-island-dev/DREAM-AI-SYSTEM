// supabase/functions/_shared/guestTimeGreeting.ts
// Deterministic Israel time-of-day greetings — shared Meta + Whapi guest DM.

import { israelLocalHour } from "./automationSchedule.ts";

export type IsraelTimeOfDay = "morning" | "afternoon" | "evening" | "night";

const STATIC_OPENER_RE =
  /^(?:שלום|בוקר טוב|צהריים טובים|ערב טוב|לילה טוב)[!.]?\s*/iu;

/** Hour buckets for Israel local time (Asia/Jerusalem). */
export function israelTimeOfDayFromHour(hour: number): IsraelTimeOfDay {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 22) return "evening";
  return "night";
}

export function getIsraelTimeOfDay(now: Date = new Date()): IsraelTimeOfDay {
  return israelTimeOfDayFromHour(israelLocalHour(now));
}

const GREETING_BY_SLOT: Record<IsraelTimeOfDay, string> = {
  morning: "בוקר טוב",
  afternoon: "צהריים טובים",
  evening: "ערב טוב",
  night: "לילה טוב",
};

export function getIsraelTimeGreeting(now: Date = new Date()): string {
  return GREETING_BY_SLOT[getIsraelTimeOfDay(now)];
}

/** HH:MM in Asia/Jerusalem — injected into guest LLM context. */
export function formatIsraelClockLabel(now: Date = new Date()): string {
  return now.toLocaleString("en-GB", {
    timeZone: "Asia/Jerusalem",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * Tier-0 greeting_reply: swap static "שלום" (or stale time greeting) for
 * the current Israel time greeting. Call after placeholder/name resolution.
 */
export function applyTimeGreetingToGuestReply(body: string, now: Date = new Date()): string {
  const trimmed = body.trim();
  if (!trimmed) return getIsraelTimeGreeting(now);

  const timeGreeting = getIsraelTimeGreeting(now);
  const withoutOpener = trimmed.replace(STATIC_OPENER_RE, "");
  return withoutOpener ? `${timeGreeting} ${withoutOpener}` : timeGreeting;
}

// Mirror of supabase/functions/_shared/pipelineLifecycle.ts — keep in sync.

export const POST_STAY_PIPELINE_TRIGGERS = new Set([
  "checkout_fb",
  "checkout_fb_daypass",
]);

export const IN_STAY_PIPELINE_TRIGGERS = new Set([
  "mid_stay",
  "mid_stay_daypass",
]);

export const ARRIVAL_DAY_PIPELINE_TRIGGERS = new Set([
  "morning_suite",
  "morning_welcome",
  "morning_daypass",
]);

function israelYmdLocal(now) {
  return now.toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
}

function invalidStayDates(guest) {
  if (!guest.arrival_date || !guest.departure_date) return false;
  return guest.departure_date < guest.arrival_date;
}

export function assertPipelineLifecycleForTrigger(trigger, guest, now = new Date()) {
  const todayStr = israelYmdLocal(now);

  if (invalidStayDates(guest)) return "invalid_stay_dates";

  if (POST_STAY_PIPELINE_TRIGGERS.has(trigger)) {
    if (!guest.arrival_date) return "missing_arrival_date";
    if (!guest.departure_date) return "missing_departure_date";
    if (guest.arrival_date > todayStr) return "guest_not_arrived";
    if (guest.departure_date > todayStr) return "stay_not_ended";
    if (guest.departure_date === todayStr && guest.status !== "checked_out") {
      return "stay_not_ended";
    }
    if (guest.status === "pending" || guest.status === "expected") {
      return "guest_never_checked_in";
    }
    return null;
  }

  if (IN_STAY_PIPELINE_TRIGGERS.has(trigger) || ARRIVAL_DAY_PIPELINE_TRIGGERS.has(trigger)) {
    if (!guest.arrival_date) return "missing_arrival_date";
    if (guest.arrival_date > todayStr) return "guest_not_arrived";
    return null;
  }

  return null;
}

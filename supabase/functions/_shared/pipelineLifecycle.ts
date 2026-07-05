// Pipeline lifecycle gates — keep automation aligned with guests table reality.
// Post-stay / in-stay stages must never fire for future arrivals or no-shows.

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

export interface PipelineLifecycleGuest {
  arrival_date?: string | null;
  departure_date?: string | null;
  status?: string | null;
}

/** True when stage_key / trigger is allowed after auto-checkout archival. */
export function isPostStayPipelineTrigger(trigger: string): boolean {
  return POST_STAY_PIPELINE_TRIGGERS.has(trigger);
}

function invalidStayDates(guest: PipelineLifecycleGuest): boolean {
  if (!guest.arrival_date || !guest.departure_date) return false;
  return guest.departure_date < guest.arrival_date;
}

function israelYmdLocal(now: Date): string {
  return now.toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
}

/**
 * Returns skip reason or null when guest lifecycle matches the pipeline stage.
 * Shared by automationSchedule.checkEligibility + whatsapp-send BRANCH D.
 */
export function assertPipelineLifecycleForTrigger(
  trigger: string,
  guest: PipelineLifecycleGuest,
  now: Date = new Date(),
): string | null {
  const todayStr = israelYmdLocal(now);

  if (invalidStayDates(guest)) return "invalid_stay_dates";

  if (POST_STAY_PIPELINE_TRIGGERS.has(trigger)) {
    if (!guest.arrival_date) return "missing_arrival_date";
    if (!guest.departure_date) return "missing_departure_date";
    if (guest.arrival_date > todayStr) return "guest_not_arrived";
    if (guest.departure_date >= todayStr) return "stay_not_ended";
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

// supabase/functions/_shared/automationSchedule.ts
//
// Shared scheduling resolver for the Automation Control Center.
//
// Used by BOTH whatsapp-cron (the real dispatcher — Phase 4, not wired up
// yet) and the automation-queue Edge Function (the read-only Live Queue
// preview — Phase 2) so the two can never drift: they call the literal same
// function instead of two copies of date math that could silently diverge.
//
// Ported 1:1 from whatsapp-cron/index.ts's existing hardcoded if/else as of
// migration 065 — see that file's header comment for the original day-offset/
// hour-threshold table this replaces. The fixed Israel UTC+2 offset (no DST)
// is preserved exactly as today's code computes it — not "fixed" here.

export const ISRAEL_UTC_OFFSET_HOURS = 2;

export type ScheduleMode = "day_offset_with_time" | "hours_after_event" | "event_immediate";
export type NodeType = "meta_template" | "session_message" | "hybrid";
export type AnchorEvent = "arrival_date" | "departure_date" | "arrival_confirmed_at" | "checkin_time";
export type AppliesTo = "all" | "suite" | "non_suite";

export interface InteractiveButton {
  type: "quick_reply" | "url";
  label: string;
  url?: string;
}

export interface AutomationStage {
  stage_key: string;
  display_name: string;
  journey_phase: string;
  sequence_order: number;
  node_type: NodeType;
  schedule_mode: ScheduleMode;
  anchor_event: AnchorEvent;
  day_offset: number | null;
  local_time: string | null;     // "HH:MM:SS" from Postgres TIME, may be null
  local_time_end: string | null;
  offset_hours: number | null;
  applies_to: AppliesTo;
  meta_template_name: string | null;
  session_message_script_key: string | null;
  interactive_buttons: InteractiveButton[];
  guest_flag_column: string | null;
  is_active: boolean;
}

// Only the guest fields the resolver actually reads. msg_*_sent flag columns
// are looked up dynamically by name (guest_flag_column), hence the index
// signature — mirrors how whatsapp-cron selects a fixed flag-column list today.
export interface GuestForSchedule {
  id: number | string;
  arrival_date: string | null;
  departure_date: string | null;
  room_type: string | null;
  status: string | null;
  checkin_time: string | null;
  needs_callback: boolean | null;
  [flagColumn: string]: unknown;
}

export interface ScheduleResult {
  scheduledFor: Date | null;
  dueNow: boolean;
  /** null = eligible. Non-null = why this guest won't receive this stage
   * (or won't receive it right now). Surfaced verbatim by the Live Queue
   * preview — FAIL VISIBLE (CLAUDE.md §0.3): never silently omit a guest
   * without saying why. */
  skipReason: string | null;
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 24 * 3600 * 1000);
}

function parseLocalTimeToUtcHour(localTime: string): number {
  const h = parseInt(localTime.split(":")[0], 10);
  return h - ISRAEL_UTC_OFFSET_HOURS;
}

function utcHourToTimestamp(dateStr: string, utcHour: number): Date {
  const normalized = ((utcHour % 24) + 24) % 24;
  return new Date(`${dateStr}T${String(normalized).padStart(2, "0")}:00:00.000Z`);
}

/**
 * Stage-specific eligibility guards — ported 1:1 from whatsapp-cron's
 * existing per-trigger if/else conditions (cancelled/needs_callback/
 * flag-already-sent/room_type/status checks). Pure function of (stage, guest,
 * now) — no I/O, easy to unit-test against real guest rows before Phase 4
 * ever touches the live dispatcher.
 */
export function checkEligibility(
  stage: AutomationStage,
  guest: GuestForSchedule,
  now: Date,
): string | null {
  if (guest.status === "cancelled") return "guest_cancelled";
  if (guest.needs_callback) return "needs_callback_open";
  if (stage.guest_flag_column && guest[stage.guest_flag_column] === true) return "already_sent";

  if (stage.applies_to === "suite" && guest.room_type !== "suite") return "wrong_room_type";
  if (stage.applies_to === "non_suite" && guest.room_type === "suite") return "wrong_room_type";

  if (stage.stage_key === "mid_stay") {
    if (guest.status !== "checked_in") return "not_checked_in";
    if (!guest.departure_date || guest.departure_date < ymd(now)) return "guest_already_departed";
  }
  return null;
}

/**
 * Resolves the exact instant a stage is scheduled to fire for a guest, and
 * whether it is due right now. `now` is injected (not read internally) so
 * the same call produces identical results in whatsapp-cron and in the
 * automation-queue preview at the same moment, and so it's testable without
 * mocking the clock.
 */
export function resolveStageSchedule(
  stage: AutomationStage,
  guest: GuestForSchedule,
  now: Date,
): ScheduleResult {
  const skipReason = checkEligibility(stage, guest, now);
  if (skipReason) return { scheduledFor: null, dueNow: false, skipReason };

  if (stage.schedule_mode === "event_immediate") {
    // Dispatched synchronously elsewhere (e.g. whatsapp-webhook's direct
    // reply to a guest's "כן, מגיעים!") — never polled by cron, so there is
    // no future instant to predict.
    return { scheduledFor: null, dueNow: false, skipReason: null };
  }

  if (stage.schedule_mode === "day_offset_with_time") {
    const anchorDateStr = stage.anchor_event === "departure_date" ? guest.departure_date : guest.arrival_date;
    if (!anchorDateStr) return { scheduledFor: null, dueNow: false, skipReason: "missing_anchor_date" };

    const anchorDate = new Date(`${anchorDateStr}T00:00:00.000Z`);
    const targetDateStr = ymd(addDays(anchorDate, stage.day_offset ?? 0));
    const todayStr = ymd(now);
    const floorUtcHour = stage.local_time ? parseLocalTimeToUtcHour(stage.local_time) : 0;
    const scheduledFor = utcHourToTimestamp(targetDateStr, floorUtcHour);

    if (targetDateStr !== todayStr) {
      return { scheduledFor, dueNow: false, skipReason: targetDateStr < todayStr ? "date_passed" : null };
    }

    if (!stage.local_time) {
      // No hour gate configured — eligible any time on the target day
      // (matches pre_arrival_2d's current "any hour" behavior).
      return { scheduledFor: now, dueNow: true, skipReason: null };
    }

    const hourUTC = now.getUTCHours();
    const floorUTC = floorUtcHour;
    const ceilUTC = stage.local_time_end ? parseLocalTimeToUtcHour(stage.local_time_end) : null;

    if (hourUTC < floorUTC) return { scheduledFor, dueNow: false, skipReason: null };
    if (ceilUTC !== null && hourUTC > ceilUTC) return { scheduledFor, dueNow: false, skipReason: "quiet_hours_passed" };
    return { scheduledFor, dueNow: true, skipReason: null };
  }

  if (stage.schedule_mode === "hours_after_event") {
    const anchorTs = stage.anchor_event === "checkin_time" ? guest.checkin_time : null;
    if (!anchorTs) return { scheduledFor: null, dueNow: false, skipReason: "missing_anchor_timestamp" };
    const scheduledFor = new Date(new Date(anchorTs).getTime() + (stage.offset_hours ?? 0) * 3600 * 1000);
    return { scheduledFor, dueNow: scheduledFor.getTime() <= now.getTime(), skipReason: null };
  }

  return { scheduledFor: null, dueNow: false, skipReason: "unknown_schedule_mode" };
}

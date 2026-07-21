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

import { assertPipelineLifecycleForTrigger } from "./pipelineLifecycle.ts";
import { getMissingRoomAssignmentSkipReason, isEffectiveSuiteGuest } from "./suiteNames.ts";
import { evaluateRetryGate, type RetryState } from "./automationRetryGate.ts";
import type { GuestMealRow } from "./stayMeals.ts";
import {
  buildMealsItinerary,
  extractRestaurantMealHours,
  formatGuestMealsForAi,
  formatGuestScheduledMealLine,
  formatResortBreakfastLine,
  formatRestaurantKnowledgeForReply,
  getGuestDinnerSlot,
} from "./stayMeals.ts";
import { formatGuestDietaryBrief } from "./guestProfile.ts";
import {
  isGuestStaffClaimActive,
  isGuestBotConversationDisabled,
  parseInboxClaimIdleReleaseMinutes,
  releaseStaleStaffClaims,
  touchStaffClaimActivity,
  INBOX_CLAIM_IDLE_RELEASE_CONFIG_KEY,
  DEFAULT_INBOX_CLAIM_IDLE_RELEASE_MINUTES,
} from "./guestStaffClaim.ts";
import {
  getAppliesToSkipReason,
  type AppliesTo,
} from "./automationCohort.ts";
import { hasDialableGuestPhone } from "./metaPhone.ts";

export const ISRAEL_UTC_OFFSET_HOURS = 2;

/** Israel-local hour (fixed UTC+2, no DST) when guests are auto-promoted to checked_in. */
export const AUTO_CHECKIN_LOCAL_HOUR = 15;

/** Israel-local hour when guests are auto-archived to checked_out on departure day. */
export const AUTO_CHECKOUT_LOCAL_HOUR = 11;

/** Day-pass same-day visit — auto checkout after resort closes (not 11:00 suites). */
export const AUTO_CHECKOUT_DAYPASS_LOCAL_HOUR = 19;

export function isPastDayPassAutoCheckoutGateway(now: Date): boolean {
  return israelLocalHour(now) >= AUTO_CHECKOUT_DAYPASS_LOCAL_HOUR;
}

export const AUTO_CHECKIN_ELIGIBLE_STATUSES = new Set(["pending", "expected", "room_ready"]);

export const AUTO_CHECKOUT_ELIGIBLE_STATUSES = new Set([
  "checked_in",
  "room_ready",
  "expected",
  "pending",
]);

/** Operations Board department for front-desk / spa / stay-change admin tickets. */
export const ADMIN_REQUESTS_DEPARTMENT = "קבלה/בקשות";

/** Field maintenance Whapi card department (Operations Board filter). */
export const FIELD_OPS_DEPARTMENT = "תפעול";

/** Amenity / HK delivery (towels, shampoo, water) — Operations Board filter. */
export const HOUSEKEEPING_OPS_DEPARTMENT = "משק";

/** SLA minutes for guest_request tasks — mirrors whapi-webhook/staff-ops-webhook. */
export const GUEST_OPS_SLA_THRESHOLDS: Readonly<Record<string, number>> = {
  pest_control: 10,
  guest_amenities: 15,
  maintenance: 30,
};

const GUEST_OPS_DEFAULT_SLA_CATEGORY = "maintenance";

const GUEST_OPS_PEST_KEYWORDS = [
  "bug", "ant", "ants", "cockroach", "roach", "mouse", "mice", "rat", "rats",
  "insect", "pest", "wasp", "spider",
  "חרק", "נמלה", "נמלים", "ג'וק", "עכבר", "עכברים", "חולדה",
];

const GUEST_OPS_AMENITY_KEYWORDS = [
  "towel", "towels", "pillow", "pillows", "soap", "shampoo", "amenities",
  "minibar", "slipper", "slippers", "blanket", "sheet", "sheets", "water",
  "מגבת", "מגבות", "כרית", "כריות", "סבון", "שמפו", "מצעים", "שמיכה", "מים", "חלב", "קפה", "קרח", "ice",
];

export interface GuestOpsEligibilityInput {
  status?: string | null;
  arrival_date?: string | null;
  departure_date?: string | null;
}

/** On-property or arrival-day guest — eligible for field-ops dispatch (not just checked_in). */
export function isGuestEligibleForInHouseOpsDispatch(
  guest: GuestOpsEligibilityInput,
  now: Date,
): boolean {
  const status = guest.status ?? null;
  if (status === "cancelled" || status === "checked_out") return false;

  const today = israelYmd(now);
  const arrival = guest.arrival_date ?? null;
  const departure = guest.departure_date ?? null;

  // A future arrival_date means this stay hasn't started yet regardless of
  // status — protects against a stale/incorrect checked_in flag left behind
  // when a guest's dates were later corrected (e.g. re-import) without
  // reverting status, which would otherwise dispatch a real ops task to a
  // room nobody is actually in yet.
  if (status === "checked_in") return !arrival || arrival <= today;

  if (!arrival || arrival > today) return false;
  if (departure && departure < today) return false;

  return status === "room_ready" || status === "expected" || status === "pending";
}

export function israelYmd(now: Date = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
}

export function israelLocalHour(now: Date): number {
  return Number(
    now.toLocaleString("en-GB", {
      timeZone: "Asia/Jerusalem",
      hour: "numeric",
      hour12: false,
    }),
  );
}

export function isPastAutoCheckinGateway(now: Date): boolean {
  return israelLocalHour(now) >= AUTO_CHECKIN_LOCAL_HOUR;
}

export function isPastAutoCheckoutGateway(now: Date): boolean {
  return israelLocalHour(now) >= AUTO_CHECKOUT_LOCAL_HOUR;
}

export function isGuestArrivalToday(
  arrivalDate: string | null | undefined,
  now: Date,
): boolean {
  return !!arrivalDate && arrivalDate === israelYmd(now);
}

/**
 * DISABLED (2026-07-11) — always returns false. The 15:00 sweep used to flip
 * pending/expected/room_ready guests to checked_in ahead of staff, which made
 * the housekeeping WA group's "N צ'ק אין" ack falsely read "כבר מסומן
 * כצ'ק-אין". The housekeeping WA group (housekeepingCheckInSignal.ts) is now
 * the sole check-in source for suites; manual GuestsPage/RoomBoard check-in
 * still works via performSuiteCheckIn. AUTO_CHECKIN_LOCAL_HOUR /
 * isPastAutoCheckinGateway stay in use — isCheckinBeforeTodayAutoGateway
 * still needs the 15:00 instant for the night_before Friday-bundle date math
 * below, which is unrelated to this promotion.
 */
export function shouldAutoPromoteToCheckedIn(
  _guest: { arrival_date?: string | null; status?: string | null },
  _now: Date,
): boolean {
  return false;
}

/** DB auto-checkout disabled (2026-07-17) — housekeeping WA "Co N" is sole suite checkout writer. */
export function shouldAutoCheckoutGuest(
  _guest: { departure_date?: string | null; status?: string | null },
  _now: Date,
): boolean {
  return false;
}

function getLateCheckoutUntil(guest: { guest_profile?: unknown }): string | null {
  const gp = guest.guest_profile;
  if (!gp || typeof gp !== "object") return null;
  const stay = (gp as Record<string, unknown>).stay;
  if (!stay || typeof stay !== "object") return null;
  const until = (stay as Record<string, unknown>).late_checkout_until;
  return typeof until === "string" && /^\d{2}:\d{2}$/.test(until) ? until : null;
}

function getDepartureCheckoutPromptHour(guest: { guest_profile?: unknown }): number {
  const late = getLateCheckoutUntil(guest);
  if (late) {
    const h = parseInt(late.split(":")[0], 10);
    if (!Number.isNaN(h)) return h;
  }
  return AUTO_CHECKOUT_LOCAL_HOUR;
}

/** Staff UI prompt — checked_in on/past departure after 11:00 (or late extension). */
export function needsDepartureCheckoutPrompt(
  guest: {
    departure_date?: string | null;
    status?: string | null;
    room_type?: string | null;
    guest_profile?: unknown;
  },
  now: Date,
): boolean {
  if (!guest || guest.status !== "checked_in") return false;
  if (guest.room_type === "day_guest" || guest.room_type === "premium_day_guest") return false;
  const today = israelYmd(now);
  if (!guest.departure_date) return false;
  if (guest.departure_date > today) return false;
  if (guest.departure_date < today) return true;
  return israelLocalHour(now) >= getDepartureCheckoutPromptHour(guest);
}

/** DB status only — no virtual checkout. */
export function resolveEffectiveGuestStatus(
  guest: {
    status?: string | null;
    arrival_date?: string | null;
    departure_date?: string | null;
  },
  _now: Date,
): string | null {
  return guest.status ?? null;
}

export type ScheduleMode = "day_offset_with_time" | "hours_after_event" | "event_immediate";
export type NodeType = "meta_template" | "session_message" | "hybrid";
export type AnchorEvent = "arrival_date" | "departure_date" | "arrival_confirmed_at" | "checkin_time" | "spa_time";
export type { AppliesTo };

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
  local_time_shabbat?: string | null;
  local_time_end: string | null;
  offset_hours: number | null;
  applies_to: AppliesTo;
  meta_template_name: string | null;
  session_message_script_key: string | null;
  session_message_script_key_shabbat?: string | null;
  session_message_image_url_shabbat?: string | null;
  interactive_buttons: InteractiveButton[];
  guest_flag_column: string | null;
  is_active: boolean;
  /** Stage 4 (mid_stay): when false, skip checked_in eligibility gate. Default true. */
  require_checked_in?: boolean;
}

// Only the guest fields the resolver actually reads. msg_*_sent flag columns
// are looked up dynamically by name (guest_flag_column), hence the index
// signature — mirrors how whatsapp-cron selects a fixed flag-column list today.
export interface GuestForSchedule {
  id: number | string;
  /** E.164 or national — required for any outbound automation dispatch. */
  phone?: string | null;
  arrival_date: string | null;
  departure_date: string | null;
  room_type: string | null;
  /** Assigned room — feeds effective suite classification (suiteNames.ts):
   * a canonical suite room overrides a mis-tagged day_guest room_type. */
  room?: string | null;
  status: string | null;
  checkin_time: string | null;
  /** Set by webhook on «כן מגיעים» — anchor for stage_2_arrival schedule. */
  arrival_confirmed?: boolean | null;
  arrival_confirmed_at?: string | null;
  needs_callback: boolean | null;
  automation_muted?: boolean | null;
  /** full | courtesy_only (mid_stay only) | muted — migration 154. */
  automation_scope?: string | null;
  /** WhatsAppInbox "קח שיחה" — staff-owned thread; blocks autonomous cron sends. */
  claimed_by?: string | null;
  /** stage_keys staff cancelled per guest (migration 169) — attached at cron/queue load. */
  pipeline_suppressed_stages?: string[] | null;
  /** Per-stage_key retry/claim state (automationRetryGate.ts) — attached at cron/queue load
   * from a batched notification_log read, same pattern as pipeline_suppressed_stages. */
  automation_retry_state?: Record<string, RetryState> | null;
  /** Day-pass spa cohort — anchor for spa_warmup_daypass (spa_time) + eligibility for both survey stages. */
  spa_date?: string | null;
  spa_time?: string | null;
  [flagColumn: string]: unknown;
}

/** Resolve stage_2_arrival anchor — legacy rows may lack arrival_confirmed_at. */
export function resolveArrivalConfirmedAnchor(
  guest: GuestForSchedule,
): string | null {
  if (guest.arrival_confirmed_at) return guest.arrival_confirmed_at;
  if (!guest.arrival_confirmed) return null;
  // Legacy confirm without timestamp — treat as due on arrival day morning (Israel).
  if (guest.arrival_date) {
    return utcHourToTimestamp(
      guest.arrival_date,
      parseLocalTimeToUtcHour("08:00"),
    ).toISOString();
  }
  return null;
}

export type AutomationScope = "full" | "courtesy_only" | "muted";

/** Stage 4 courtesy check — the only cron stages for courtesy_only guests. */
export const COURTESY_ONLY_STAGE_KEYS = new Set([
  "mid_stay",
  "mid_stay_daypass",
]);

export function resolveAutomationScope(
  guest: { automation_scope?: string | null; automation_muted?: boolean | null } | null | undefined,
): AutomationScope {
  const raw = guest?.automation_scope;
  if (raw === "courtesy_only" || raw === "muted" || raw === "full") return raw;
  if (guest?.automation_muted === true) return "muted";
  return "full";
}

/** Cron stage eligibility — room_ready is manual/AICopilot, not a stage row. */
export function getAutomationScopeStageSkipReason(
  guest: { automation_scope?: string | null; automation_muted?: boolean | null },
  stageKey: string,
): string | null {
  const scope = resolveAutomationScope(guest);
  if (scope === "full") return null;
  if (scope === "muted") return "automation_muted";
  if (COURTESY_ONLY_STAGE_KEYS.has(stageKey)) return null;
  return "automation_courtesy_only";
}

/** whatsapp-send pipeline trigger guard (exempt = manual + room_ready). */
export function getAutomationScopeTriggerBlockReason(
  guest: { automation_scope?: string | null; automation_muted?: boolean | null },
  trigger: string,
  exemptTriggers: ReadonlySet<string>,
): string | null {
  const scope = resolveAutomationScope(guest);
  if (scope === "full") return null;
  if (exemptTriggers.has(trigger)) return null;
  if (scope === "muted") return "automation_muted";
  if (COURTESY_ONLY_STAGE_KEYS.has(trigger)) return null;
  return "automation_courtesy_only";
}

export {
  isGuestStaffClaimActive,
  isGuestBotConversationDisabled,
  parseInboxClaimIdleReleaseMinutes,
  releaseStaleStaffClaims,
  touchStaffClaimActivity,
  INBOX_CLAIM_IDLE_RELEASE_CONFIG_KEY,
  DEFAULT_INBOX_CLAIM_IDLE_RELEASE_MINUTES,
};

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
  const h = parseLocalHour(localTime);
  return h - ISRAEL_UTC_OFFSET_HOURS;
}

/** Israel-local hour from automation_stages.local_time ("HH:MM" / "HH:MM:SS"). */
export function parseLocalHour(localTime: string): number {
  const h = parseInt(localTime.trim().split(":")[0], 10);
  return Number.isFinite(h) ? h : 0;
}

function utcHourToTimestamp(dateStr: string, utcHour: number): Date {
  const normalized = ((utcHour % 24) + 24) % 24;
  return new Date(`${dateStr}T${String(normalized).padStart(2, "0")}:00:00.000Z`);
}

/** Combine a DATE + local "HH:MM(:SS)" TIME (Israel, fixed UTC+2) into a UTC instant. */
function israelLocalDateTimeToUtc(dateStr: string | null | undefined, timeStr: string | null | undefined): Date | null {
  const d = String(dateStr ?? "").trim().slice(0, 10);
  const t = String(timeStr ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const m = t.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const hh = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  const utcMidnightMs = new Date(`${d}T00:00:00.000Z`).getTime();
  return new Date(utcMidnightMs + ((hh - ISRAEL_UTC_OFFSET_HOURS) * 60 + mm) * 60_000);
}

/** spa_warmup_daypass send instant must land within sane operating hours — a
 * missing/garbled spa_time must never silently schedule a 3am send. */
const SPA_WARMUP_SANE_HOUR_MIN = 6;
const SPA_WARMUP_SANE_HOUR_MAX = 22;

/** Day-pass spa cohort stages — late catch-up after this grace → missed_window
 * (manual Override only), never cron bulk-blast (Whapi ban prevention). */
const SPA_DAYPASS_CATCHUP_GRACE_MS = 30 * 60 * 1000;

const SPA_DAYPASS_CATCHUP_STAGE_KEYS = new Set([
  "spa_warmup_daypass",
  "survey_invite_daypass",
  "night_before_daypass",
]);

/** Shared anchor resolver for schedule_mode='hours_after_event' — one place
 * for all three anchor kinds, used by both computeScheduledInstant and
 * resolveStageSchedule so they can never diverge. */
function resolveHoursAfterEventAnchor(stage: AutomationStage, guest: GuestForSchedule): Date | null {
  // spa_warmup_daypass is always per-guest spa_time — never arrival_confirmed_at
  // even if automation_stages.anchor_event was corrupted via legacy ACC UI.
  if (stage.stage_key === "spa_warmup_daypass") {
    return israelLocalDateTimeToUtc(guest.spa_date, guest.spa_time);
  }
  if (stage.anchor_event === "checkin_time") {
    return guest.checkin_time ? new Date(guest.checkin_time) : null;
  }
  if (stage.anchor_event === "arrival_confirmed_at") {
    const anchor = resolveArrivalConfirmedAnchor(guest);
    return anchor ? new Date(anchor) : null;
  }
  if (stage.anchor_event === "spa_time") {
    return israelLocalDateTimeToUtc(guest.spa_date, guest.spa_time);
  }
  return null;
}

/** Calendar YMD + day offset without timezone drift on the anchor DATE string. */
function targetYmdFromAnchor(anchorDateStr: string, dayOffset: number): string {
  const anchorDate = new Date(`${anchorDateStr}T12:00:00.000Z`);
  return ymd(addDays(anchorDate, dayOffset ?? 0));
}

function isShabbatArrivalDate(arrivalDateStr: string | null | undefined): boolean {
  const ymdStr = String(arrivalDateStr ?? "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymdStr)) return false;
  const d = new Date(`${ymdStr}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.getUTCDay() === 6;
}

/** Guest arrives on a Friday (Israel calendar day) — the same-day half of the
 * night_before Shabbat bundle (2026-07-10: Friday arrivals get the Shabbat
 * script/template same-day instead of the weekday reminder the day before). */
export function isFridayArrivalDate(arrivalDateStr: string | null | undefined): boolean {
  const ymdStr = String(arrivalDateStr ?? "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymdStr)) return false;
  const d = new Date(`${ymdStr}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.getUTCDay() === 5;
}

/** night_before's Shabbat-bundle cohort — Friday OR Saturday arrival. Scoped to
 * night_before only; every other Shabbat-variant stage (morning_suite) stays
 * Saturday-only via isShabbatArrivalDate. */
export function isShabbatBundleArrival(arrivalDateStr: string | null | undefined): boolean {
  return isFridayArrivalDate(arrivalDateStr) || isShabbatArrivalDate(arrivalDateStr);
}

/** night_before fires same-day (offset 0) for Friday arrivals instead of the
 * stage's configured day-before offset — local_time_shabbat (15:00) already
 * matches Saturday's day-before-Friday send, only the day changes. */
function effectiveStageDayOffset(stage: AutomationStage, guest: GuestForSchedule): number {
  if (stage.stage_key === "night_before" && isFridayArrivalDate(guest.arrival_date)) return 0;
  return stage.day_offset ?? 0;
}

/** Shabbat arrivals may use local_time_shabbat instead of local_time (migration 172).
 * night_before additionally treats Friday arrivals as part of the bundle. */
function effectiveStageLocalTime(stage: AutomationStage, guest: GuestForSchedule): string | null {
  const shabbatTime = stage.local_time_shabbat?.trim();
  if (!shabbatTime) return stage.local_time;
  const useShabbatTime = stage.stage_key === "night_before"
    ? isShabbatBundleArrival(guest.arrival_date)
    : isShabbatArrivalDate(guest.arrival_date);
  return useShabbatTime ? shabbatTime : stage.local_time;
}

/** True when checkin_time predates today's AUTO_CHECKIN_LOCAL_HOUR gateway (Israel) —
 * a genuine early/manual check-in, as opposed to a status flip stamped by this
 * same tick's auto-promotion sweep. Timestamp-based (not scan-order-dependent) so
 * it stays correct even for callers that evaluate after auto-checkin has run
 * (e.g. automation-queue's Live Preview). */
function isCheckinBeforeTodayAutoGateway(checkinTime: string, now: Date): boolean {
  const checkinDate = new Date(checkinTime);
  if (Number.isNaN(checkinDate.getTime())) return false;
  const gatewayInstant = utcHourToTimestamp(israelYmd(now), AUTO_CHECKIN_LOCAL_HOUR - ISRAEL_UTC_OFFSET_HOURS);
  return checkinDate.getTime() < gatewayInstant.getTime();
}

function isDueByIsraelLocalClock(
  now: Date,
  floorLocalHour: number,
  ceilLocalHour: number | null,
): boolean {
  const hour = israelLocalHour(now);
  if (hour < floorLocalHour) return false;
  if (ceilLocalHour !== null && hour > ceilLocalHour) return false;
  return true;
}

/** Ignore ceiling when it precedes floor — misconfig must not block sends silently. */
export function effectiveCeilLocalHour(
  floorLocalHour: number,
  ceilLocalHour: number | null,
): number | null {
  if (ceilLocalHour === null) return null;
  if (ceilLocalHour < floorLocalHour) return null;
  return ceilLocalHour;
}

/**
 * Stage-specific eligibility guards — ported 1:1 from whatsapp-cron's
 * existing per-trigger if/else conditions (cancelled/flag-already-sent/
 * room_type/status checks). Pure function of (stage, guest,
 * now) — no I/O, easy to unit-test against real guest rows before Phase 4
 * ever touches the live dispatcher.
 */
export function checkEligibility(
  stage: AutomationStage,
  guest: GuestForSchedule,
  now: Date,
): string | null {
  if (guest.status === "cancelled") return "guest_cancelled";
  const roomAssignmentSkip = getMissingRoomAssignmentSkipReason(guest);
  if (roomAssignmentSkip) return roomAssignmentSkip;
  if (!hasDialableGuestPhone(guest.phone)) return "missing_phone";
  // Post-stay feedback fires after checkout — checked_out is expected, not a block.
  const postStayStage =
    stage.stage_key === "checkout_fb" || stage.stage_key === "checkout_fb_daypass";
  if (!postStayStage && guest.status === "checked_out") return "guest_checked_out";
  // Friday night_before bundle: skip only a genuine early/manual check-in
  // (checkin_time before today's 15:00 gateway) — NOT a check-in stamped by
  // this same tick's AUTO_CHECKIN_LOCAL_HOUR auto-promotion sweep, which would
  // otherwise make the bundle skip itself on almost every Friday guest.
  if (
    stage.stage_key === "night_before" &&
    isFridayArrivalDate(guest.arrival_date) &&
    guest.status === "checked_in" &&
    guest.checkin_time &&
    isCheckinBeforeTodayAutoGateway(guest.checkin_time, now)
  ) {
    return "already_checked_in";
  }
  // needs_callback is a staff UI alert only — intentionally NOT checked here (session 59).
  const scopeSkip = getAutomationScopeStageSkipReason(guest, stage.stage_key);
  if (scopeSkip) return scopeSkip;
  if (
    Array.isArray(guest.pipeline_suppressed_stages)
    && guest.pipeline_suppressed_stages.includes(stage.stage_key)
  ) {
    return "stage_suppressed";
  }
  if (isGuestStaffClaimActive(guest)) return "staff_claim_active";
  // Anti-spam/anti-race latch (2026-07-13) — a timeout/failed prior attempt
  // never stamps guest_flag_column (see automationRetryGate.ts header), so
  // without this a guest would re-qualify as due on every ~15-min cron tick
  // forever. Checked before already_sent since a guest can be mid-retry for
  // a stage that has never successfully sent.
  const retryGate = evaluateRetryGate(guest.automation_retry_state?.[stage.stage_key], now);
  if (retryGate) return retryGate;
  if (stage.guest_flag_column && guest[stage.guest_flag_column] === true) return "already_sent";

  const appliesToSkip = getAppliesToSkipReason(stage.applies_to, stage.stage_key, guest);
  if (appliesToSkip) return appliesToSkip;

  const effectiveSuite = isEffectiveSuiteGuest(guest);

  // Suite Stage 5 — event-driven from housekeeping «Co»; never cron day_offset.
  // Evaluated before generic post-stay lifecycle so Live Queue shows
  // suite_checkout_survey_via_housekeeping instead of misleading stay_not_ended.
  if (stage.stage_key === "checkout_fb" && effectiveSuite) {
    if (!guest.departure_date) return "missing_departure_date";
    const todayStr = israelYmd(now);
    if (guest.arrival_date && guest.arrival_date > todayStr) return "guest_not_arrived";
    if (guest.status === "pending" || guest.status === "expected") {
      return "guest_never_checked_in";
    }
    return "suite_checkout_survey_via_housekeeping";
  }

  const lifecycleBlock = assertPipelineLifecycleForTrigger(stage.stage_key, guest, now);
  if (lifecycleBlock) return lifecycleBlock;

  if (stage.stage_key === "stage_2_arrival") {
    if (!guest.arrival_confirmed && !guest.arrival_confirmed_at) {
      return "awaiting_confirmation";
    }
    if (!resolveArrivalConfirmedAnchor(guest)) {
      return "missing_anchor_timestamp";
    }
  }

  if (stage.stage_key === "mid_stay" || stage.stage_key === "mid_stay_daypass") {
    if (stage.stage_key === "mid_stay") {
      const requireCheckedIn = stage.require_checked_in !== false;
      if (requireCheckedIn && guest.status !== "checked_in") return "not_checked_in";
      if (!guest.departure_date || guest.departure_date < ymd(now)) return "guest_already_departed";
    } else {
      // Day-pass courtesy check — same-day visit; eligible once checked in or expected on arrival day.
      const todayStr = ymd(now);
      if (guest.arrival_date !== todayStr) return "not_arrival_day";
      if (guest.status !== "checked_in" && guest.status !== "expected" && guest.status !== "room_ready") {
        return "not_on_property";
      }
    }
  }

  if (stage.stage_key === "spa_warmup_daypass") {
    const anchor = israelLocalDateTimeToUtc(guest.spa_date, guest.spa_time);
    if (anchor) {
      const warmupInstant = new Date(anchor.getTime() + (stage.offset_hours ?? 0) * 3600 * 1000);
      const localHour = israelLocalHour(warmupInstant);
      if (localHour < SPA_WARMUP_SANE_HOUR_MIN || localHour > SPA_WARMUP_SANE_HOUR_MAX) {
        return "spa_warmup_outside_hours";
      }
    }
    // No anchor at all (spa_time missing/unparseable) falls through and is
    // caught by resolveStageSchedule's own missing_anchor_timestamp guard —
    // no silent fake time, no duplicate skip-reason logic needed here.
  }

  return null;
}

/**
 * Pure date/time math for a stage — no eligibility guards.
 * Used by automation-queue to show upcoming mid_stay (etc.) even when the
 * guest is not checked_in yet (skipReason=not_checked_in) so Stage 4 never
 * vanishes from the Live Monitor.
 */
export function computeScheduledInstant(
  stage: AutomationStage,
  guest: GuestForSchedule,
  now: Date,
): Date | null {
  if (stage.schedule_mode === "event_immediate") return null;

  // Suite checkout_fb uses post_checkout_survey_queue (Co + delay) — no legacy departure clock.
  if (stage.stage_key === "checkout_fb" && isEffectiveSuiteGuest(guest)) return null;

  if (stage.schedule_mode === "day_offset_with_time") {
    const anchorDateStr = stage.anchor_event === "departure_date" ? guest.departure_date : guest.arrival_date;
    if (!anchorDateStr) return null;
    const targetDateStr = targetYmdFromAnchor(anchorDateStr, effectiveStageDayOffset(stage, guest));
    const stageLocalTime = effectiveStageLocalTime(stage, guest);
    if (stageLocalTime) {
      return israelLocalDateTimeToUtc(targetDateStr, stageLocalTime);
    }
    return utcHourToTimestamp(targetDateStr, 0);
  }

  if (stage.schedule_mode === "hours_after_event") {
    const anchor = resolveHoursAfterEventAnchor(stage, guest);
    if (!anchor) return null;
    return new Date(anchor.getTime() + (stage.offset_hours ?? 0) * 3600 * 1000);
  }

  return null;
}

/** Stage keys the cron + Live Monitor must always surface when is_active. */
export const CORE_PIPELINE_STAGE_KEYS = [
  "pre_arrival_2d",
  "stage_2_arrival",
  "night_before",
  "night_before_daypass",
  "morning_suite",
  "morning_welcome",
  "mid_stay",
  "mid_stay_daypass",
  "checkout_fb",
  "checkout_fb_daypass",
] as const;

/** Pipeline stages that must NEVER auto-send after the ACC send window — surface
 * as missed_window in Live Queue for manual Override only (2026-07-14). */
const MISSED_WINDOW_AFTER_SEND_WINDOW_KEYS = new Set<string>([
  ...CORE_PIPELINE_STAGE_KEYS,
  "spa_warmup_daypass",
  "survey_invite_daypass",
  "night_before_daypass",
  "butler_1h",
]);

/** When local_time is set but local_time_end is missing, cap auto-send at
 * floor+4h (max 23) so a late-imported guest cannot trigger all-day cron spam. */
const DEFAULT_SEND_WINDOW_SPAN_HOURS = 4;

function resolveSendWindowCeil(
  stage: AutomationStage,
  floorLocal: number,
  ceilLocal: number | null,
): number | null {
  const configured = effectiveCeilLocalHour(floorLocal, ceilLocal);
  if (configured !== null) return configured;
  if (!stage.local_time || !MISSED_WINDOW_AFTER_SEND_WINDOW_KEYS.has(stage.stage_key)) {
    return null;
  }
  return Math.min(23, floorLocal + DEFAULT_SEND_WINDOW_SPAN_HOURS);
}

function pastWindowSkipReason(stageKey: string): "missed_window" | "quiet_hours_passed" {
  return MISSED_WINDOW_AFTER_SEND_WINDOW_KEYS.has(stageKey)
    ? "missed_window"
    : "quiet_hours_passed";
}

const LATE_IMPORT_CATCHUP_STAGE_KEYS = new Set<string>([
  "pre_arrival_2d",
  "night_before",
  "night_before_daypass",
  "morning_suite",
  "morning_welcome",
  "mid_stay",
  "mid_stay_daypass",
  "checkout_fb_daypass",
  // checkout_fb (suites) — housekeeping Co only; never day-schedule catch-up
]);

function isValidScheduleYmd(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * Late EZGO / manual import: target calendar day already passed but guest journey
 * still active → surface missed_window in Live Queue (manual Whapi bulk only).
 * Mirrors pre_arrival_2d catch-up (2026-07-14) across the full suite/day-pass cron pipeline.
 */
export function isLateImportCatchupEligible(
  stage: AutomationStage,
  guest: GuestForSchedule,
  todayStr: string,
): boolean {
  if (!LATE_IMPORT_CATCHUP_STAGE_KEYS.has(stage.stage_key)) return false;
  if (stage.guest_flag_column && guest[stage.guest_flag_column] === true) return false;

  const arrival = String(guest.arrival_date ?? "").trim().slice(0, 10);
  const departure = String(guest.departure_date ?? "").trim().slice(0, 10);

  switch (stage.stage_key) {
    case "pre_arrival_2d":
    case "night_before":
    case "night_before_daypass":
      return isValidScheduleYmd(arrival) && arrival >= todayStr;

    case "morning_suite":
    case "morning_welcome":
      if (!isValidScheduleYmd(arrival) || arrival > todayStr) return false;
      if (isValidScheduleYmd(departure)) return departure >= todayStr;
      return true;

    case "mid_stay":
    case "mid_stay_daypass":
    case "checkout_fb_daypass":
      return isValidScheduleYmd(departure) && departure >= todayStr;

    default:
      return false;
  }
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
  const scheduledForPreview = computeScheduledInstant(stage, guest, now);

  if (skipReason) {
    return { scheduledFor: scheduledForPreview, dueNow: false, skipReason };
  }

  if (stage.schedule_mode === "event_immediate") {
    // Legacy rows — stage_2_arrival moved to hours_after_event (migration 127).
    if (stage.stage_key === "stage_2_arrival") {
      const anchor = resolveArrivalConfirmedAnchor(guest);
      const scheduledFor = anchor ? new Date(anchor) : null;
      return { scheduledFor, dueNow: true, skipReason: null };
    }
    return { scheduledFor: null, dueNow: false, skipReason: null };
  }

  if (stage.schedule_mode === "day_offset_with_time") {
    const anchorDateStr = stage.anchor_event === "departure_date" ? guest.departure_date : guest.arrival_date;
    if (!anchorDateStr) return { scheduledFor: null, dueNow: false, skipReason: "missing_anchor_date" };

    const targetDateStr = targetYmdFromAnchor(anchorDateStr, effectiveStageDayOffset(stage, guest));
    const todayStr = israelYmd(now);
    const stageLocalTime = effectiveStageLocalTime(stage, guest);
    const scheduledFor = scheduledForPreview
      ?? (stageLocalTime
        ? israelLocalDateTimeToUtc(targetDateStr, stageLocalTime)
        : utcHourToTimestamp(targetDateStr, 0));

    if (targetDateStr !== todayStr) {
      if (targetDateStr > todayStr) {
        return { scheduledFor, dueNow: false, skipReason: null };
      }
      // targetDateStr < todayStr — window day already passed.
      // Late-import catch-up: guest journey still active + flag not sent →
      // missed_window for Live Queue / manual bulk (never cron auto-spam).
      if (isLateImportCatchupEligible(stage, guest, todayStr)) {
        return { scheduledFor, dueNow: false, skipReason: "missed_window" };
      }
      return { scheduledFor, dueNow: false, skipReason: "date_passed" };
    }

    if (!stageLocalTime) {
      // No hour gate configured — eligible any time on the target day
      // (matches pre_arrival_2d's current "any hour" behavior).
      return { scheduledFor: now, dueNow: true, skipReason: null };
    }

    const floorLocal = parseLocalHour(stageLocalTime);
    const ceilLocal = resolveSendWindowCeil(
      stage,
      floorLocal,
      stage.local_time_end ? parseLocalHour(stage.local_time_end) : null,
    );

    if (!isDueByIsraelLocalClock(now, floorLocal, ceilLocal)) {
      const hour = israelLocalHour(now);
      if (hour < floorLocal) {
        return { scheduledFor, dueNow: false, skipReason: null };
      }
      if (
        SPA_DAYPASS_CATCHUP_STAGE_KEYS.has(stage.stage_key)
        && scheduledFor.getTime() < now.getTime() - SPA_DAYPASS_CATCHUP_GRACE_MS
      ) {
        return { scheduledFor, dueNow: false, skipReason: "missed_window" };
      }
      return {
        scheduledFor,
        dueNow: false,
        skipReason: pastWindowSkipReason(stage.stage_key),
      };
    }
    return { scheduledFor, dueNow: true, skipReason: null };
  }

  if (stage.schedule_mode === "hours_after_event") {
    const anchor = resolveHoursAfterEventAnchor(stage, guest);
    if (!anchor) return { scheduledFor: null, dueNow: false, skipReason: "missing_anchor_timestamp" };
    const scheduledFor = scheduledForPreview ?? new Date(anchor.getTime() + (stage.offset_hours ?? 0) * 3600 * 1000);
    const msPast = now.getTime() - scheduledFor.getTime();
    if (
      SPA_DAYPASS_CATCHUP_STAGE_KEYS.has(stage.stage_key)
      && msPast > SPA_DAYPASS_CATCHUP_GRACE_MS
    ) {
      return { scheduledFor, dueNow: false, skipReason: "missed_window" };
    }
    return { scheduledFor, dueNow: scheduledFor.getTime() <= now.getTime(), skipReason: null };
  }

  return { scheduledFor: null, dueNow: false, skipReason: "unknown_schedule_mode" };
}

// ── In-room physical-presence signals (whatsapp-webhook keyword override) ───
// Guest DB status may still be pending/expected while they are already in the
// suite asking for towels — shared here so webhook + future cron gates stay aligned.

export const PRE_ARRIVAL_GUEST_STATUSES = new Set(["pending", "expected"]);

/** Meta / staff pipeline statuses that mean "not yet checked in" for override logic. */
export function isPreArrivalGuestStatus(status: string | null | undefined): boolean {
  return !!status && PRE_ARRIVAL_GUEST_STATUSES.has(status);
}

/**
 * Broad keyword hint (in-room tone / legacy). Task dispatch uses the strict
 * allowlist below — never this pattern alone.
 */
export const OPERATIONAL_IN_HOUSE_KEYWORD_PATTERN =
  /חלב|מים|קפה|מגבות|חלוקים|נייר(?:\s*טואלט)?|קפסולות|סבון|שמפו|שלט|מזגן|טלו(?:ו)?יז(?:יה|יון)|סתימה|אור(?:\s*שבור)?|זבל|ניקיון|לחדר|סדין|כרית|שמיכ(?:ה|ות)/;

/** @deprecated alias — same pattern as OPERATIONAL_IN_HOUSE_KEYWORD_PATTERN (session 76). */
export const IN_ROOM_KEYWORD_PATTERN = OPERATIONAL_IN_HOUSE_KEYWORD_PATTERN;

/** Informational / FAQ — KB+LLM only; must never open ops tasks. */
export const INFORMATIONAL_GUEST_QUERY_PATTERN =
  /(?:^|[\s,.!?])(?:מה|מתי|איפה|היכן|כמה|האם|איז(?:ה|ו)|מי)\b|(?:ה(?:יתה|יה)\s+פעם|פעם\s+ה(?:יתה|יה))|(?:ממוקמת|ממוקם|איפה\s+(?:ה(?:יא|וא)|נמצא)|היכן\s+(?:ה(?:יא|וא)|נמצא))|(?:שעות(?:\s*פתיחה)?|עד\s+מתי|checkout|צ.?ק.?אא?וט|בר(?:יכה|\s)?|עמד(?:ת|ה)|ברד|slushie|wifi|wi-fi|אינטרנט|מסעד(?:ה|ת)|חניה)/iu;

/** Guest wants physical action — not merely asking for information. */
export const PHYSICAL_REQUEST_INTENT_PATTERN =
  /אפשר|אפשרו|בבקשה|צר[י]כ[הים]?|חסר|חסרה|תביאו|תביא|שלחו|שלח|מבקש(?:ים|ת)?|נוכל(?:ים)?\s+לקבל|אפשר\s+לקבל|(?:א|נ)שמח|נשמח\s+לקבל|נוספ(?:ות|ים|ה|ף)?|דחוף|עזרו|עזרה|העבר|העבירו|עוד\s+(?:של|מ)|תוסיפו|need|please\s+(?:send|bring)|can\s+(?:i|we)\s+get/u;

/** Allowlist cat. 1 — concrete in-room amenity delivery. */
const ALLOWLIST_AMENITY_PATTERN =
  /(?:חלב|קפה|מגבות|שמפו|סבון|נייר(?:\s*טואלט)?|חלוק(?:ים)?|כרית(?:ות)?|שמיכ(?:ה|ות)?|קפסולות|כוסות?|צלחות?|בקבוק(?:י)?|זירו|קולה|קוקה|משק(?:ה|אות)|ספרייט|פאנטה|(?<![א-ת])קרח(?![א-ת])|\bice\b)/iu;

/** checked_in only — bare noun or qty+noun ("מגבות", "2 כוסות"); not questions. */
const BARE_IN_ROOM_AMENITY_SHORTHAND_RE =
  /^(?:\d{1,2}\s+)?(?:מגבות?|מגבת|חלב|קפה|שמפו|סבון|נייר(?:\s*טואלט)?|חלוק(?:ים)?|כרית(?:ות)?|שמיכ(?:ה|ות)?|קפסולות|כוסות?|צלחת|צלחות|קרח|\bice\b|(?:(?<![א-ת])|(?<=(?<![א-ת])[הושבכלמ]))מים(?![א-ת]))$/iu;

/** Portal OPS_REQUEST CTA taps — explicit button label, not free-text LLM guess. */
const PORTAL_TRUSTED_OPS_LABEL_RE = /^הזמנת\s+שירות\s+לחדר\b/u;

// ★ session 2026-07-07 fix: JS/Deno regex `\b` is defined over ASCII `\w`
// and never matches Hebrew letters, so a bare "מים" had zero word-boundary
// protection — it silently matched as a substring of unrelated Hebrew words
// ending the same way, e.g. "בפעמים" (times/occasions). This is the exact,
// confirmed root cause of the "אמרו לנו שאפשר ב-11 כמו שהיה בפעמים
// הקודמות" false-positive incident: "מים" inside "בפעמים" + "אפשר" inside
// "שאפשר" (PHYSICAL_REQUEST_INTENT_PATTERN) together satisfied this whole
// branch on a single, non-burst message — no burst-coalescing needed at all.
// The lookaround below simulates a real Hebrew word boundary: the character
// immediately before "מים" must be either non-Hebrew (start/whitespace/
// punctuation) OR exactly one of the standard single-letter prefix
// particles (ה/ו/ש/ב/כ/ל/מ — "the/and/that/in/like/to/from", always glued
// directly onto the following word with no space, e.g. "המים"/"ומים"/
// "למים") — and that prefix letter must itself start a word, not be part of
// a longer unrelated word. A bare non-Hebrew-letter check alone (without
// the prefix allowance) would incorrectly reject legitimate glued forms
// like "המים קרים" ("the water is cold").
const ALLOWLIST_BOTTLED_WATER_PATTERN =
  /(?:בבקשה\s+)?(?:עוד\s+)?(?:(?<![א-ת])|(?<=(?<![א-ת])[הושבכלמ]))מים(?![א-ת])(?:\s+(?:לחדר|בחדר|לסוויטה|בסוויטה|קר(?:ים|ות)|מינר(?:ל|al)))?/u;

/** Allowlist cat. 2 — maintenance / broken infrastructure. */
// ★ session 2026-07-07 fix: the trailing bare alternative used to match
// "לא עובד"/"תקלה"/"תקוע"/"שבור" ANYWHERE with zero required room/device
// context (unlike the מזגן/טלוויזיה groups above, which correctly require
// the device word) — false-positive risk on unrelated topics ("הקישור
// לתשלום לא עובד"). Now requires a nearby device/room noun within a
// gap-tolerant window, same [\s\S]{0,25} technique as
// SENSITIVE_STAY_CHANGE_PATTERN below (session 96 precedent). Also: bare
// "שלט" had the same unbounded-substring risk as "מים" above (it matches
// inside unrelated words like "שלטון"/government) — same Hebrew-aware
// word-boundary lookaround applied, preserving legitimate prefixed forms
// ("השלט לא עובד"/"אין לי שלט").
const ALLOWLIST_MAINTENANCE_PATTERN =
  /מזגן(?:\s*(?:לא\s+עובד|לא\s+מקרר|תקול|מקולקל))?|(?:טלו(?:ו)?יז(?:יה|יון)|(?:(?<![א-ת])|(?<=(?<![א-ת])[הושבכלמ]))שלט(?![א-ת])(?:\s*ט(?:לו(?:ו)?יז)?)?)(?:\s*(?:לא\s+עובד|תקוע|שבור))?|סתימה|(?:אין|לא\s+)מים\s+חמים|זרם\s+חלש|אור\s*שבור|כספת\s*נעולה|דלת\s*לא\s*נפתח(?:ת)?|(?:שער|גייט)(?:\s*(?:לא\s*נפתח|נעול|תקוע))?|(?:ל)?פתוח(?:ים)?\s*(?:את\s+)?(?:ה)?שער|(?:אין|חסר(?:ה)?)\s+ידית[\s\S]{0,20}דלת|דלת[\s\S]{0,20}ידית|(?:לא\s+עובד(?:ת)?|תקלה|תקוע(?:ה)?|שבור(?:ה)?)[\s\S]{0,25}(?:מזגן|טלו(?:ו)?יז(?:יה|יון)|שלט|דלת|שער|גייט|כספת|מים|אור|חדר|סוויטה|מקרר|מקלחת|ברז|חלון|תריס)|(?:מזגן|טלו(?:ו)?יז(?:יה|יון)|שלט|דלת|שער|גייט|כספת|מים|אור|חדר|סוויטה|מקרר|מקלחת|ברז|חלון|תריס)[\s\S]{0,25}(?:לא\s+עובד(?:ת)?|תקלה|תקוע(?:ה)?|שבור(?:ה)?)/u;

/** Allowlist cat. 3 — cleaning / physical labor. */
const ALLOWLIST_CLEANING_PATTERN =
  /(?:ניקיון(?:\s+(?:חדר|לחדר|בחדר|בסוויטה|לסוויטה|בבקשה))?|לפנות\s+זבל|להחליף\s+מצעים|החלפת\s+מצעים|שטיפת\s+רצפה|פינוי\s+זבל)/u;

const OPERATIONAL_NEED_LABELS: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  { pattern: /חלב/u, label: "חלב" },
  { pattern: /מגבות/u, label: "מגבות" },
  { pattern: /קפה/u, label: "קפה" },
  { pattern: /מים/u, label: "מים" },
  { pattern: /קרח|\bice\b/iu, label: "קרח" },
  { pattern: /קפסולות/u, label: "קפסולות" },
  { pattern: /כוס/u, label: "כוסות" },
  { pattern: /צלח/u, label: "צלחות" },
  { pattern: /בקבוק|זירו|קולה|משקה/u, label: "משקה" },
  { pattern: /סבון/u, label: "סבון" },
  { pattern: /שמפו/u, label: "שמפו" },
  { pattern: /נייר/u, label: "נייר טואלט" },
  { pattern: /חלוק/u, label: "חלוק" },
  { pattern: /כרית/u, label: "כרית" },
  { pattern: /שמיכ/u, label: "שמיכה" },
  { pattern: /מזגן/u, label: "מזגן" },
  { pattern: /טלו(?:ו)?יז/u, label: "טלויזיה" },
  { pattern: /שלט/u, label: "שלט" },
  { pattern: /סתימה/u, label: "סתימה" },
  { pattern: /אור\s*שבור/u, label: "אור שבור" },
  { pattern: /כספת/u, label: "כספת" },
  { pattern: /דלת/u, label: "דלת" },
  { pattern: /שער/u, label: "שער" },
  { pattern: /ידית/u, label: "ידית לדלת" },
  { pattern: /ניקיון/u, label: "ניקיון חדר" },
  { pattern: /זבל/u, label: "פינוי זבל" },
  { pattern: /מצע/u, label: "החלפת מצעים" },
  { pattern: /רצפה/u, label: "שטיפת רצפה" },
];

export function messageSignalsInRoomPresence(text: string): boolean {
  return OPERATIONAL_IN_HOUSE_KEYWORD_PATTERN.test(text);
}

export function messageSignalsOperationalInHouseRequest(text: string): boolean {
  return isAllowlistedPhysicalTaskRequest(text);
}

/** True when the guest is asking for info (hours, location, etc.) — not a dispatch. */
export function isInformationalGuestQuery(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  // ★ session 2026-07-11 fix: INFORMATIONAL_GUEST_QUERY_PATTERN's bare
  // "checkout|צ'ק-אאוט" alternative used to flag ANY message mentioning
  // checkout as pure FAQ — including "we need to check out, please send
  // someone for our luggage", which is a physical departure-assist request,
  // not a question. Check the departure-assist classifier first so a real
  // action ask is never mis-routed as informational-only.
  if (isDepartureAssistRequest(t)) return false;
  if (INFORMATIONAL_GUEST_QUERY_PATTERN.test(t)) return true;
  if (/\?\s*$/.test(t) && !PHYSICAL_REQUEST_INTENT_PATTERN.test(t) && !ALLOWLIST_MAINTENANCE_PATTERN.test(t)) {
    return true;
  }
  return false;
}

/**
 * Strict allowlist — ops task / Whapi card ONLY for these three categories.
 * Everything else (FAQ, locations, hours) → LLM/KB only.
 */
export function isAllowlistedPhysicalTaskRequest(text: string): boolean {
  const t = text.trim();
  if (!t || isInformationalGuestQuery(t)) return false;

  if (ALLOWLIST_MAINTENANCE_PATTERN.test(t)) {
    if (/^(?:מתי|איפה|היכן|מה|כמה|האם)\b/u.test(t) && !/(?:לא\s+עובד|תקול|שבור|סתימה|תקוע)/u.test(t)) {
      return false;
    }
    return true;
  }

  if (ALLOWLIST_CLEANING_PATTERN.test(t)) {
    return PHYSICAL_REQUEST_INTENT_PATTERN.test(t) || /(?:לחדר|לסוויטה|בחדר|בסוויטה)/u.test(t);
  }

  if (ALLOWLIST_AMENITY_PATTERN.test(t) || ALLOWLIST_BOTTLED_WATER_PATTERN.test(t)) {
    return PHYSICAL_REQUEST_INTENT_PATTERN.test(t)
      || /(?:לחדר|לסוויטה|בחדר|בסוויטה|עוד\s+)/u.test(t)
      || /(?:שתי|שלוש|ארבע|חמש|שישה|שבע|שמונה|תשע|עשר|\d{1,2})\s+/u.test(t);
  }

  return false;
}

/** checked_in guests — "מגבות" / "2 כוסות" without "אפשר…" (Tier-0 only, not LLM tool path). */
export function isBareInRoomAmenityShorthand(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 40) return false;
  if (isInformationalGuestQuery(t)) return false;
  if (/\?/.test(t)) return false;
  return BARE_IN_ROOM_AMENITY_SHORTHAND_RE.test(t);
}

/** Portal button OPS_REQUEST labels — trusted tap intent (guest-portal-ops-request). */
export function isPortalTrustedOpsLabel(label: string): boolean {
  const t = label.trim();
  if (!t) return false;
  if (PORTAL_TRUSTED_OPS_LABEL_RE.test(t)) return true;
  return isAllowlistedPhysicalTaskRequest(t);
}

/** Split burst / multi-thought guest text (newline or " / " separators). */
export function splitGuestInboundLines(text: string): string[] {
  return text
    .split(/\n+|(?:\s*\/\s*)+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Canonical ops-routing input — same line splitting everywhere Tier-0 runs. */
export function normalizeGuestInboundForOps(text: string): string {
  return splitGuestInboundLines(text).join("\n");
}

function lineMatchesInHouseOpsRequest(
  line: string,
  guest: GuestOpsEligibilityInput,
): boolean {
  if (isAllowlistedPhysicalTaskRequest(line)) return true;
  if (!isCheckedInGuestStatus(guest.status ?? null)) return false;
  return isBareInRoomAmenityShorthand(line);
}

function textMatchesInHouseOpsRequest(
  text: string,
  guest: GuestOpsEligibilityInput,
): boolean {
  const trimmed = text.trim();
  if (trimmed && lineMatchesInHouseOpsRequest(trimmed, guest)) return true;
  const lines = splitGuestInboundLines(text);
  if (lines.length <= 1) return false;
  return lines.some((line) => lineMatchesInHouseOpsRequest(line, guest));
}

/**
 * Burst-coalesced guest text can be several distinct messages joined by "\n"
 * (whatsapp-webhook's coalesceBurstIfLeader — same-phone inbound messages
 * within a 5s wall-clock window, zero topic grouping). Dispatching the
 * *whole* blob to the ops-group translator lets an unrelated line dominate/
 * confuse the English card even when only ONE line actually triggered the
 * allowlist gate (root cause of the "אמרו לנו שאפשר ב-11" false-positive
 * incident). Isolates just the line(s) that independently match the
 * allowlist; falls back to the full text if isolation finds nothing
 * (defensive — never silently drops a legitimate request, CLAUDE.md §0.1
 * Zero Data Loss).
 */
export function extractAllowlistedRequestLines(
  text: string,
  guest?: GuestOpsEligibilityInput,
): string {
  const lines = splitGuestInboundLines(text);
  if (lines.length <= 1) return text.trim();
  const relevant = lines.filter((line) =>
    guest ? lineMatchesInHouseOpsRequest(line, guest) : isAllowlistedPhysicalTaskRequest(line),
  );
  if (relevant.length === 0) {
    console.warn(
      `[automationSchedule] extractAllowlistedRequestLines — no single line isolated from a ${lines.length}-line burst, falling back to full text`,
    );
    return text.trim();
  }
  return relevant.join("\n");
}

/** @deprecated use isAllowlistedPhysicalTaskRequest */
export function isActionableOperationalInHouseRequest(text: string): boolean {
  return isAllowlistedPhysicalTaskRequest(text);
}

/** Classify guest in-room ask for sla-escalation-cron (same buckets as staff reports). */
export function guessGuestOpsSlaCategory(text: string): string {
  const lower = text.toLowerCase();
  if (GUEST_OPS_PEST_KEYWORDS.some((k) => lower.includes(k))) return "pest_control";
  if (GUEST_OPS_AMENITY_KEYWORDS.some((k) => lower.includes(k))) return "guest_amenities";
  return GUEST_OPS_DEFAULT_SLA_CATEGORY;
}

export function buildGuestOpsSlaDeadline(category: string, now: Date = new Date()): string {
  const minutes = GUEST_OPS_SLA_THRESHOLDS[category] ?? GUEST_OPS_SLA_THRESHOLDS.maintenance;
  return new Date(now.getTime() + minutes * 60_000).toISOString();
}

/** Amenities/HK → משק; broken infrastructure → תפעול. */
export function resolveGuestOpsDepartment(text: string): string {
  const t = text.trim();
  if (ALLOWLIST_MAINTENANCE_PATTERN.test(t)) return FIELD_OPS_DEPARTMENT;
  if (ALLOWLIST_CLEANING_PATTERN.test(t)) return HOUSEKEEPING_OPS_DEPARTMENT;
  if (ALLOWLIST_AMENITY_PATTERN.test(t) || ALLOWLIST_BOTTLED_WATER_PATTERN.test(t)) {
    return HOUSEKEEPING_OPS_DEPARTMENT;
  }
  return FIELD_OPS_DEPARTMENT;
}

export function isCheckedInGuestStatus(status: string | null | undefined): boolean {
  return status === "checked_in";
}

/** Tier-0 intercept: in-house guest + actionable operational ask — skip LLM. */
export function shouldInterceptOperationalInHouseRequest(
  text: string,
  guest: GuestOpsEligibilityInput,
  now: Date = new Date(),
): boolean {
  return isGuestEligibleForInHouseOpsDispatch(guest, now)
    && textMatchesInHouseOpsRequest(text, guest);
}

/** True when staff should get tasks + Whapi card + requires_attention. */
export function shouldDispatchOperationalInHouseAlert(text: string): boolean {
  return isAllowlistedPhysicalTaskRequest(text);
}

// ── In-room balloon décor — Requests Board only (never field-ops / tasks) ──

export const BALLOON_ROOM_REQUEST_PATTERN = /בלון(?:ים)?|balloons?/iu;

/** Balloon room décor ask — reception coordinates with external vendor. */
export function isBalloonRoomRequest(text: string): boolean {
  const t = text.trim();
  if (!t || !BALLOON_ROOM_REQUEST_PATTERN.test(t)) return false;
  if (isInformationalGuestQuery(t)) return false;
  if (/^(?:מה|האם|כמה|איפה|היכן)\b/u.test(t) && !PHYSICAL_REQUEST_INTENT_PATTERN.test(t)) {
    return false;
  }
  return true;
}

export function shouldInterceptBalloonRoomRequest(text: string): boolean {
  return isBalloonRoomRequest(text);
}

/** Canonical guest reply — reception passes details to balloon vendor (not field ops). */
export function buildBalloonRoomRequestReply(guestName?: string | null): string {
  const salutation = guestName ? `${guestName}, ` : "";
  return (
    `${salutation}בחירה נהדרת! 🎈 ` +
    `רשמתי את הבקשה. צוות הקבלה יעביר את הפרטים שלכם לנציגת הבלונים שלנו, ` +
    `והיא תיצור איתכם קשר בהקדם לתיאום.`
  );
}

/**
 * Single routing decision for guest free-text requests (after allowlist gate).
 * - operational_field_ops → tasks (dept=תפעול) + Whapi EN card (checked-in only)
 * - admin_reception_tasks → guest_alerts (Requests Board) + Whapi בקשות אורחים
 * - requests_board → guest_alerts (pre-check-in physical, manager/price/human, balloons)
 * - kb_only → LLM/KB answer only
 */
export type GuestRequestDispatchRoute =
  | "kb_only"
  | "operational_field_ops"
  | "admin_reception_tasks"
  | "requests_board";

export function classifyGuestRequestDispatch(
  text: string,
  guest: GuestOpsEligibilityInput,
  now: Date = new Date(),
): GuestRequestDispatchRoute {
  const status = guest.status ?? null;
  if (isInformationalGuestQuery(text)) return "kb_only";
  if (isBalloonRoomRequest(text)) return "requests_board";
  if (isAdministrativeInHouseRequest(text)) {
    return isCheckedInGuestStatus(status) ? "admin_reception_tasks" : "requests_board";
  }
  if (isAllowlistedPhysicalTaskRequest(text)) {
    return isGuestEligibleForInHouseOpsDispatch(guest, now) ? "operational_field_ops" : "requests_board";
  }
  return "kb_only";
}

/** Requests Board (guest_alerts) — human/price/manager or pre-check-in escalation. */
export function isRequestsBoardEscalation(text: string): boolean {
  return /(?:מנהל|מחיר|נציג)/u.test(text)
    || (/תקלה/u.test(text) && isAllowlistedPhysicalTaskRequest(text));
}

/** True when the guest ask is a low-risk amenity delivery — instant Whapi dispatch (no 7min HITL wait). */
export function isInstantAmenityOpsDispatch(text: string): boolean {
  const t = text.trim();
  if (!isAllowlistedPhysicalTaskRequest(t)) return false;
  if (ALLOWLIST_MAINTENANCE_PATTERN.test(t) || ALLOWLIST_CLEANING_PATTERN.test(t)) return false;
  return ALLOWLIST_AMENITY_PATTERN.test(t) || ALLOWLIST_BOTTLED_WATER_PATTERN.test(t);
}

/** Staff-facing summary + guests.attention_reason (e.g. "בקשת חלב לחדר"). */
export function buildOperationalRequestSummary(text: string): string {
  for (const { pattern, label } of OPERATIONAL_NEED_LABELS) {
    if (pattern.test(text)) return `בקשת ${label} לחדר`;
  }
  return "בקשת שירות בחדר";
}

/**
 * Deterministic field-ops reply — no LLM, no implied approval language.
 * Human-in-the-Loop gate (2026-07-07): must NOT claim the field team is
 * already on the way — dispatch now waits on staff approval in
 * OperationsBoard.js, so that claim would be false at send time.
 */
export function buildOperationalDispatchReply(
  _requestSummary?: string,
  _guestName?: string | null,
): string {
  return "קיבלנו את הבקשה שלך, הצוות שלנו בודק ומטפל בה כעת 🙏";
}

// ── Administrative in-house requests → קבלה/בקשות (tasks only, no Whapi ops) ──

export const ADMINISTRATIVE_IN_HOUSE_PATTERN =
  /בקשת\s*טיפול\s*(ב)?ספא|טיפול\s*(ב)?ספא|הזמנ(?:ה|ת)\s*טיפול|שינוי\s*(שעת\s*)?טיפול\s*ספא|לקבוע\s*טיפול|לשנות\s*טיפול\s*ספא/i;

export function isAdministrativeInHouseRequest(text: string): boolean {
  return ADMINISTRATIVE_IN_HOUSE_PATTERN.test(text.trim());
}

export function shouldInterceptAdministrativeInHouseRequest(
  text: string,
  status: string | null | undefined,
): boolean {
  return isCheckedInGuestStatus(status) && isAdministrativeInHouseRequest(text);
}

export function buildAdministrativeRequestSummary(text: string): string {
  if (/ספא|טיפול/i.test(text)) return "בקשת טיפול בספא";
  return "בקשה מנהלית";
}

export function buildAdministrativeDispatchReply(_guestName?: string | null): string {
  return "הבקשתך הועברה לצוות הקבלה שלנו, והם יצרו איתך קשר בהקדם. 🙏";
}

// ── Spa upsell acceptance (day-pass, manual "Send Offer Now" dispatch) ─────
// Whapi free-text has no reply buttons, so a guest who wants the massage
// simply replies "כן"/"רוצה"/etc. — anchored on the WHOLE trimmed message
// (not a substring match) so this never hijacks an unrelated "כן" mid-sentence
// or answering a different question. Callers MUST additionally gate this on
// guest.msg_spa_upsell_sent === true AND no spa booked yet for today — see
// runSpaUpsellAcceptanceIntercept in guestBalloonAdminIntercept.ts.
export const SPA_UPSELL_ACCEPT_PATTERN =
  /^(כן|כן\s*בבקשה|בבקשה|בטח|רוצה|רוצים|מעוניין|מעוניינת|מעוניינים|בשמחה|אשמח|סבבה|מגניב|למה\s*לא|תוסיפו|כן\s*תודה|אוקיי?|okay?|yes|sure)[\s!.,🙏😊👍❤️💆]*$/iu;

export function isSpaUpsellAcceptanceReply(text: string): boolean {
  return SPA_UPSELL_ACCEPT_PATTERN.test(text.trim());
}

export function buildSpaUpsellAcceptanceReply(_guestName?: string | null): string {
  return "מעולה! 💆 נדאג לשבץ אתכם לטיפול היום ונעדכן אתכם בהקדם עם השעה המדויקת 🙏";
}

/** True when pre-arrival DB status contradicts an obvious in-room request. */
export function shouldApplyInRoomContextOverride(
  text: string,
  status: string | null | undefined,
): boolean {
  if (!isPreArrivalGuestStatus(status)) return false;
  if (isInformationalGuestQuery(text)) return false;
  return isAllowlistedPhysicalTaskRequest(text);
}

// ── Sensitive stay / room-change requests — never imply approval (session 76b) ──

/**
 * Late checkout, extension, early check-in, room change — staff must confirm availability.
 * ★ session 96 fix: "חדר"/"מוקדם" and "לצאת"/"מאוחר" now match with a word-gap (`[\s\S]{0,25}`)
 * instead of requiring direct adjacency (`\s*`) — real guest phrasing like "לקבל את החדר
 * יותר מוקדם" (get the room earlier) or "לצאת מהחדר מאוחר יותר" (leave the room later)
 * separates the two keywords with other words, so the old adjacency-only version missed
 * them entirely and let the request fall through to the free-text LLM branch, where guest
 * context (spa booking time) could bias the model onto an unrelated topic. See §10 session 96.
 */
export const SENSITIVE_STAY_CHANGE_PATTERN =
  /הארכ(ה|ת)\s*(של\s*)?(ה)?(שהייה|שהות|חדר|הזמנה)|עזיבה\s*מאוחרת|פינוי\s*מאוחר|צ.?ק.?אא?וט\s*מאוחר|צ.?ק.?אא?וט\s*מאוחרת|להישאר\s*עוד|עוד\s*יום|עוד\s*לילה|לילה\s*נוסף|להאריך\s*(את\s*)?(ה)?(שהות|ההזמנה|השהייה)|לצ.?את[\s\S]{0,20}מאוחר|צ.?ק.?אין\s*מוקדם|הגעה\s*מוקדמת|כניסה\s*מוקדמת|חדר[\s\S]{0,25}מוקדם|מוקדם[\s\S]{0,25}חדר|להיכנס\s*(לחדר\s*)?מוקדם|שינוי\s*חדר|להחליף\s*חדר|חדר\s*אחר|early\s*check.?in|late\s*check.?out|extend\s*(my\s*)?(stay|booking)|extra\s*night|stay\s*longer/i;

const SENSITIVE_STAY_FAQ_EXCLUSION =
  /^(?:מה|מתי|איזו?\s*שעה|כמה|האם)\s+.{0,50}?(?:צ.?ק.?אא?וט|צ.?ק.?אין|שעת\s*(?:כניסה|עזיבה)|כניסה|הכנס|להיכנס|חדר|check.?out|check.?in)/iu;
const SENSITIVE_STAY_FAQ_EXCLUSION_HOURS = /^שעות?\s*(?:ה)?כניסה/iu;

export function isSensitiveStayChangeRequest(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  // BUG FIX (2026-07-06, P0): these two regexes were previously joined with the
  // bitwise `|` operator (`regexA | regexB`) instead of a logical OR of two
  // `.test()` calls. `RegExp | RegExp` coerces both operands to numbers (NaN),
  // and `NaN | NaN` evaluates to `0` — so this constant silently became the
  // *number* 0, not a RegExp. Every call to `.test()` on it threw
  // "SENSITIVE_STAY_FAQ_EXCLUSION.test is not a function", and since this
  // function runs on every non-button inbound message before the burst/LLM
  // step, the exception aborted per-message processing before any reply was
  // ever sent — this was the root cause of the bot going completely silent.
  if (SENSITIVE_STAY_FAQ_EXCLUSION.test(t) || SENSITIVE_STAY_FAQ_EXCLUSION_HOURS.test(t)) return false;
  return SENSITIVE_STAY_CHANGE_PATTERN.test(t);
}

/** Canonical staff handoff — MUST NOT vary; no enthusiastic approval language. */
export const CANONICAL_STAY_CHANGE_HANDOFF_MSG =
  "העברתי את בקשתך לצוות הסוויטות שלנו, והם יצרו איתך קשר בהקדם. 🙏";

// ── Guest request summary grounding — server-side check that a model's
// claimed item_summary is actually about the CURRENT message, not a stale
// topic carried over from conversation history (session 2026-07-11 incident:
// a checkout+luggage message got logged with summary "מגבת וחלוק לבריכה" —
// towels/robe from an earlier, already-resolved turn in the same thread).
// Deliberately loose (substring/stem overlap, no real NLP) — the goal is
// only to catch gross topic mismatches, not to second-guess paraphrasing.
const GROUNDING_STOPWORDS = new Set([
  "לצוות", "הבקשה", "בקשה", "לחדר", "בחדר", "לסוויטה", "בסוויטה", "בבקשה", "אנא",
  "עוד", "של", "עם", "גם", "את", "או", "אחד", "אחת", "for", "the", "and",
]);

function normalizeGroundingToken(word: string): string {
  let w = word;
  if (w.length > 3 && /^[הושבכלמ]/u.test(w)) w = w.slice(1);
  return w.replace(/(ים|ות)$/u, "");
}

/** True when at least one meaningful word of `summary` also appears in `text`. */
export function isRequestSummaryGrounded(summary: string, text: string): boolean {
  const words = summary
    .split(/[\s,./()]+/u)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3 && !GROUNDING_STOPWORDS.has(w));
  if (words.length === 0) return true; // nothing specific enough to check — don't false-reject
  return words.some((w) => {
    if (text.includes(w)) return true;
    const stem = normalizeGroundingToken(w);
    return stem.length >= 2 && text.includes(stem);
  });
}

// ── Departure / porter assist — physical checkout+luggage help. Distinct
// from SENSITIVE_STAY_CHANGE_PATTERN (late checkout / extension — staff must
// confirm availability): this guest IS leaving on schedule and needs someone
// to carry bags to reception — an Ops Board task like towels/AC, never a
// fake amenity ack (session 2026-07-11 hallucination incident).

const DEPARTURE_CHECKOUT_MENTION_PATTERN = /צ.?ק.?אא?וט|checkout|check.?out/iu;

const DEPARTURE_LUGGAGE_PATTERN =
  /מזווד(?:ה|ות)|כבודה|luggage|bags?|porter|(?:לקחת|לאסוף|יעביר|יעבירו)[\s\S]{0,25}(?:חפצים|תיק(?:ים)?|לקבלה|מהחדר)|מישהו\s+יגיע[\s\S]{0,20}(?:לחדר|לקחת)/iu;

const DEPARTURE_ASSIST_ACTION_PATTERN = /מישהו\s+יגיע|יגיע\s+מישהו|שמישהו|תבואו|תשלחו|תעזרו/iu;

/** Guest is checking out on schedule and needs porter/luggage help — not late-checkout. */
export function isDepartureAssistRequest(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (!DEPARTURE_CHECKOUT_MENTION_PATTERN.test(t)) return false;
  if (!DEPARTURE_LUGGAGE_PATTERN.test(t)) return false;
  if (isSensitiveStayChangeRequest(t)) return false; // late checkout / extension wins — do not steal
  if (!(PHYSICAL_REQUEST_INTENT_PATTERN.test(t) || DEPARTURE_ASSIST_ACTION_PATTERN.test(t))) return false;
  return true;
}

/** Tier-0 intercept gate — same on-property eligibility as operational in-house asks. */
export function shouldInterceptDepartureAssistRequest(
  text: string,
  guest: GuestOpsEligibilityInput,
  now: Date = new Date(),
): boolean {
  return isGuestEligibleForInHouseOpsDispatch(guest, now) && isDepartureAssistRequest(text);
}

/** Deterministic Hebrew summary from the CURRENT text only — never invents amenities. */
export function buildDepartureAssistSummary(text: string): string {
  const roomMatch = text.match(/חדר\s*(\d{1,4})/u);
  return roomMatch ? `איסוף מזוודה לצ'ק-אאוט (חדר ${roomMatch[1]})` : "איסוף מזוודה לצ'ק-אאוט";
}

/**
 * Deterministic reply — no enthusiasm, no implied approval. Human-in-the-Loop
 * gate (same as buildOperationalDispatchReply): staff must still approve the
 * Ops Board task before dispatch, so this must never claim help is already
 * on the way.
 */
export function buildDepartureAssistReply(_guestName?: string | null): string {
  return "קיבלנו את הבקשה שלך לעזרה עם המזוודות בצ'ק-אאוט, הצוות שלנו בודק ומטפל בה כעת 🙏";
}

// ── Check-in / entry policy FAQ — Tier-0 deterministic reply (no LLM) ────────
// Catches "האם ניתן להכנס לחדר בשעה 12?" and similar — must NOT fall through to
// LLM with incomplete bot_config knowledge (only hotel_checkin_time=15:00).

export const CHECK_IN_POLICY_QUESTION_PATTERN =
  /(?:מה|מתי|איזו?\s*שעה|כמה|האם)\s+[\s\S]{0,60}?(?:צ.?ק.?אין|צ.?ק.?אא?וט|שעת?\s*(?:כניסה|עזיבה)|כניסה\s*(?:ל)?חדר|להיכנס\s*לחדר|הכנס\w*\s*לחדר|check.?in|check.?out)|שעות?\s*(?:ה)?כניסה|קבלת\s*חדר|מועד\s*כניסה|(?:אפשר|ניתן|מותר)\s+[\s\S]{0,40}?(?:להיכנס|כניסה\s*(?:ל)?חדר)|מתי\s+(?:מקבלים|נותנים|מוסרים)\s*(?:את\s*)?החדר|מה\s+שעות/i;

/** Delivery to the suite ("2 בקבוקי זירו לחדר") — not an entry-policy question. */
const CHECK_IN_ENTRY_CONTEXT_PATTERN =
  /(?:להיכנס|כניסה|מקבלים|נותנים|מוסרים|שעת?\s*כניסה|מועד\s*כניסה|צ.?ק.?אין|check.?in)/iu;

export function isInRoomDeliveryRequest(text: string): boolean {
  const t = text.trim();
  if (!t || !PHYSICAL_REQUEST_INTENT_PATTERN.test(t)) return false;
  if (!/(?:לחדר|לסוויטה|בחדר|בסוויטה)/u.test(t)) return false;
  if (CHECK_IN_ENTRY_CONTEXT_PATTERN.test(t)) return false;
  return true;
}

/**
 * Guest asks for something physical in-room that Tier-0 cannot classify —
 * hand off to staff instead of FAQ/LLM guesswork.
 */
export function shouldHandoffUnrecognizedInRoomRequest(text: string): boolean {
  const t = text.trim();
  if (!t || t.length < 4) return false;
  if (!PHYSICAL_REQUEST_INTENT_PATTERN.test(t)) return false;
  if (isInformationalGuestQuery(t)) return false;
  if (isCheckInPolicyQuestion(t)) return false;
  if (isDiningQuestion(t)) return false;
  if (isAllowlistedPhysicalTaskRequest(t)) return false;
  if (isDepartureAssistRequest(t)) return false;
  if (isBalloonRoomRequest(t)) return false;
  if (isAdministrativeInHouseRequest(t)) return false;
  if (isMealDeclineOrApology(t)) return false;
  return true;
}

/** LLM replies about resort entry hours — used when truncation guard fires on reply text. */
export const CHECK_IN_HOURS_REPLY_PATTERN =
  /שעות?\s*(?:ה)?כניסה|כניסה\s*ל(?:חדר|מתחם)|קבלת\s*חדר|ימי\s*חול|שבתות\s*וחגים|החל\s*מהשעה/i;

export function looksLikeCheckInHoursReply(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return CHECK_IN_HOURS_REPLY_PATTERN.test(t);
}

export function isCheckInPolicyQuestion(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (isInRoomDeliveryRequest(t)) return false;
  return CHECK_IN_POLICY_QUESTION_PATTERN.test(t);
}

/** Complete resort entry + room check-in times from bot_config (BotConfigPanel keys). */
export function buildCheckInPolicyReply(
  cfg: Record<string, string>,
  _arrivalDateStr?: string | null,
): string {
  const entryTime = (cfg["night_before_entry_time_weekday"] ?? "").trim() || "12:00";
  const checkinWeekday =
    (cfg["night_before_checkin_time_weekday"] ?? "").trim()
    || (cfg["hotel_checkin_time"] ?? "").trim()
    || "15:00";
  const checkinShabbat =
    (cfg["night_before_checkin_time_shabbat"] ?? "").trim() || "18:00";
  const checkout = (cfg["hotel_checkout_time"] ?? "").trim() || "11:00";

  return (
    `שמח לעזור 🙏\n` +
    `כניסה למתחם: מהשעה ${entryTime} (כל יום).\n` +
    `קבלת חדר/סוויטה: ימי חול מהשעה ${checkinWeekday}, שבתות וחגים מהשעה ${checkinShabbat}.\n` +
    `צ'ק-אאוט: עד ${checkout}.\n\n` +
    `אם תרצו לנסות להיכנס לחדר לפני השעה הרשמית — נבדוק מול הצוות לפי תפוסה. פשוט כתבו לנו.`
  );
}

// ── Dining / room-service FAQ (Tier-0) ─────────────────────────────────────

export const DINING_QUESTION_PATTERN =
  /(?:יש|פותח|פתוח|זמין)[\s\S]{0,50}?(?:אוכל|מסעדה|לאכול|ארוחה|ביס)|(?:שירות\s*חדרים|הזמין|להזמין|להזמנה)[\s\S]{0,40}?(?:חדר|אוכל|לחדר)|(?:מה|מתי|איזה?\s*שעה)[\s\S]{0,50}?(?:שעות|פתוח)[\s\S]{0,30}?(?:מסעדה|אוכל|ארוחה)|(?:מתי|מה\s*שעות?)\s*[\s\S]{0,25}?מסעדה|(?:אפשר|ניתן|מותר)[\s\S]{0,40}?(?:לאכול|להזמין|אוכל|ארוחה)|order\s*(?:food|to\s*room)|room\s*service|something\s*(?:to\s*)?eat|where\s*(?:can\s*)?(?:we\s*)?eat/i;

export const DINING_HOURS_REPLY_PATTERN =
  /שירות\s*חדרים|מסעדת?\s*ערמונים|שעות\s*(?:ה)?מסעדה|room\s*service/i;

export function isDiningQuestion(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return DINING_QUESTION_PATTERN.test(t);
}

export function looksLikeDiningHoursReply(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return DINING_HOURS_REPLY_PATTERN.test(t);
}

/** Guest asks about *their* meals/plan/diet — not generic restaurant hours. */
export const GUEST_OWN_MEAL_QUESTION_PATTERN =
  /(?:שלנו|שלי|אצלנו|בהזמנה(?:\s*(?:שלנו|שלי))?)|(?:מה|איזה|האם)\s*[\s\S]{0,35}?(?:פנסיון|חצי\s*פנסיון|פנסיון\s*מלא|ארוח(?:ה|ות)(?:\s*(?:שלנו|שלי|כלולות))?)|(?:מתי|באיזה\s*שעה)\s*[\s\S]{0,30}?(?:ארוחת\s*(?:בוקר|צהריים|ערב)|הבוקר|הערב)(?:\s*שלנו)?|(?:האם|יש\s*ל(?:נו|י))\s*[\s\S]{0,25}?(?:פנסיון|ארוח(?:ה|ות)\s*כלול)|(?:אלרג|צמחונ|טבעונ|ללא\s*גלוטן|לקטוז|תזונה|כשר)|what(?:'s| is)\s*(?:included|our)|our\s*(?:meal|breakfast|dinner|lunch|board|plan)/iu;

export function isGuestOwnMealQuestion(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return GUEST_OWN_MEAL_QUESTION_PATTERN.test(t);
}

export type DiningGuestHints = GuestMealRow & {
  guest_profile?: Record<string, unknown> | null;
};

function formatGuestMealSummaryLine(guest: DiningGuestHints): string | null {
  const mealSummary = formatGuestMealsForAi(guest);
  if (!mealSummary) return null;
  return mealSummary.replace(
    /^ארוחות \(לפי הפנסיון בהזמנה\):\s*/,
    "לפי הפנסיון שלכם: ",
  );
}

/** Generic restaurant / room-service — KB first, then bot_config; guest dinner when evening. */
export function buildDiningReply(
  cfg: Record<string, string>,
  guest?: DiningGuestHints | null,
  guestText?: string,
  knowledgeBase?: string,
): string {
  const kb = knowledgeBase ?? "";
  const lines = [
    "שמח לעזור 🙏",
    formatRestaurantKnowledgeForReply(cfg, kb, guestText ?? ""),
    "שירות חדרים זמין 24/7 — ניתן להזמין ישירות לסוויטה.",
    "לשמירת מקום במסעדה או להזמנה — כתבו לנו ונדאג.",
  ];

  const dinnerSlot = getGuestDinnerSlot(guest);
  const mentionsEvening = guestText && /ערב|אוכל|ארוחה|dinner|evening|מסעדה/i.test(guestText);
  if (dinnerSlot && mentionsEvening) {
    lines.splice(2, 0, `ארוחת הערב שלכם לפי ההזמנה: ${dinnerSlot}.`);
  }

  const mentionsBreakfast = guestText && /בוקר|breakfast/i.test(guestText);
  if (mentionsBreakfast) {
    const breakfastLine = formatResortBreakfastLine(kb, guestText ?? "");
    if (breakfastLine) lines.splice(2, 0, breakfastLine);
  }

  return lines.join("\n");
}

/** Tier-0 answer when guest asks explicitly about their plan / meal times / diet. */
export function buildGuestOwnMealReply(
  cfg: Record<string, string>,
  guest: DiningGuestHints,
  guestText: string,
  knowledgeBase?: string,
): string {
  const t = guestText.trim();
  const kb = knowledgeBase ?? "";
  const lines = ["שמח לעזור 🙏"];
  const rows = buildMealsItinerary(guest);
  const byLabel = new Map(rows.map((r) => [r.label, r.value]));

  const asksDiet = /אלרג|צמחונ|טבעונ|גלוטן|לקטוז|תזונה|כשר|diet|allerg/i.test(t);
  const asksBreakfast = /בוקר|breakfast/i.test(t);
  const asksDinner = /ערב|dinner/i.test(t);
  const asksLunch = /צהריים|lunch/i.test(t);

  if (asksDiet) {
    const diet = formatGuestDietaryBrief(guest.guest_profile ?? null);
    lines.push(
      diet
        ? `ברשומה שלכם: ${diet}. הצוות במסעדה מודע.`
        : "לא רשום אצלנו מגבלת תזונה — ספרו לנו ונדאג.",
    );
  }

  if (asksBreakfast) {
    const breakfastLine = formatResortBreakfastLine(kb, t);
    if (breakfastLine) {
      lines.push(breakfastLine);
    } else {
      lines.push("ארוחת בוקר — נבדוק מול הקבלה ונחזור אליכם.");
    }
    const plan = (guest.meal_plan ?? "").trim();
    if (plan && plan !== "none" && plan !== "dinner_only") {
      lines.push("לפי הפנסיון שלכם — ארוחת בוקר כלולה.");
    }
  } else if (asksLunch) {
    lines.push(
      formatGuestScheduledMealLine(
        "ארוחת הצהריים שלכם",
        byLabel.get("ארוחת צהריים"),
        "לא מצאנו שעת צהריים ברשומה — נבדוק מול הקבלה ונחזור אליכם.",
      ),
    );
  } else if (asksDinner) {
    lines.push(
      formatGuestScheduledMealLine(
        "ארוחת הערב שלכם",
        byLabel.get("ארוחת ערב") ?? byLabel.get("ארוחה"),
        "לא מצאנו שעת ערב ברשומה — נבדוק מול הקבלה ונחזור אליכם.",
      ),
    );
  }

  const summaryLine = formatGuestMealSummaryLine(guest);
  const answeredSlot = (asksBreakfast || asksLunch || asksDinner) && lines.length > 1;
  if (!answeredSlot && !asksDiet) {
    lines.push(
      summaryLine ?? "לא מצאנו פרטי פנסיון/ארוחות ברשומה — נבדוק מול הקבלה ונחזור אליכם.",
    );
  } else if (!answeredSlot && asksDiet && summaryLine) {
    lines.push(summaryLine);
  } else if (lines.length === 1) {
    lines.push(
      summaryLine ?? "לא מצאנו פרטי ארוחות ברשומה — נבדוק מול הקבלה ונחזור אליכם.",
    );
  }

  return lines.join("\n");
}

export function buildDiningReplyForGuest(
  cfg: Record<string, string>,
  guestText: string,
  guest?: DiningGuestHints | null,
  knowledgeBase?: string,
): string {
  const kb = knowledgeBase ?? "";
  if (guest && isGuestOwnMealQuestion(guestText)) {
    return buildGuestOwnMealReply(cfg, guest, guestText, kb);
  }
  return buildDiningReply(cfg, guest, guestText, kb);
}

// ── Meal decline / apology (Tier-0) — restaurant reservation threads ─────────

export const MEAL_DECLINE_OR_APOLOGY_PATTERN =
  /לא\s*נגיע(?:ים)?|לא\s*נבוא(?:ים)?|שכחתי\s*להודיע|שכחנו\s*להודיע|מתנצל(?:ת|ים)?|סליחה(?:\s*ש|,).*(?:שכחתי|לא\s*הודעתי|לא\s*עדכנתי)|(?:ארוחת|מסעדה|ערב|בוקר).{0,30}(?:לא|ביטול|מבטל)|(?:לא|ביטול|מבטל).{0,30}(?:ארוחת|מסעדה|ערב)/iu;

export function isMealDeclineOrApology(text: string): boolean {
  const t = text.trim();
  if (!t || t.length < 4) return false;
  return MEAL_DECLINE_OR_APOLOGY_PATTERN.test(t);
}

export function buildMealDeclineAck(guestName: string | null | undefined): string {
  const name = guestName?.trim();
  const prefix = name ? `${name}, ` : "";
  return `${prefix}הכל בסדר גמור, תודה שעדכנתם 🙏 אנחנו כאן לכל דבר.`;
}

/** True when text ends like a complete guest-facing message (not mid-sentence). */
export function hasCompleteGuestMessageEnding(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  // Punctuation / common closing emoji (Stage 2, spa, welcome scripts).
  if (/[.!?…🙏✅🥰🌸❤️💆🔑🌴✨🤍😊)\u201d\u2019"']$/u.test(t)) return true;
  // Portal / payment / workshop links — must NOT trip the truncation guard.
  if (/https?:\/\/\S+$/i.test(t)) return true;
  // Bare portal UUID path segment at end.
  if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t)) return true;
  return false;
}

/** Known live truncation tails — mid-hour list, mid-word cuts (2026-07-18). */
const TRUNCATED_REPLY_TAIL_PATTERN =
  /(?:^|[\s,])מה$|החל\s+מה$|ובשבתות\s+וחגים\s+החל\s+מה$|בימי\s+חול,?\s+ובשבתות\s+וחגים\s+החל\s+מה$|ובין$|בין\s+השעות?\s*$|שתצטר$/u;

/**
 * Last token looks cut mid-root (e.g. "שתצטר" vs complete "שתצטרכו") — avoids
 * flagging whole messages that merely omit terminal punctuation (#4 audit).
 */
export function endsWithMidWordHebrewCut(text: string): boolean {
  const lastWord = text.trim().split(/\s+/).pop() ?? "";
  if (lastWord.length < 5 || lastWord.length > 10) return false;
  if (/[םןתהך]$/u.test(lastWord)) return false;
  // Common complete 2nd-person plural / future endings (תצטרכו, תוכלו, …).
  if (/[וכ]$/u.test(lastWord) && lastWord.length >= 7) return false;
  return /[צקרפגדבשט]$/u.test(lastWord);
}

/** Detect LLM replies cut mid-sentence before they reach the guest. */
export function isReplyObviouslyTruncated(text: string): boolean {
  const t = text.trim();
  if (!t || t.length < 25) return false;
  if (TRUNCATED_REPLY_TAIL_PATTERN.test(t)) return true;
  if (endsWithMidWordHebrewCut(t)) return true;
  return false;
}

/** Pick a complete replacement when a truncated reply must not reach the guest. */
export function resolveTruncatedReplyFallback(
  replyText: string,
  guestText: string,
  cfg: Record<string, string>,
  arrivalDateStr: string | null,
  genericFallback: string,
  guest?: DiningGuestHints | null,
  knowledgeBase?: string,
): string {
  // Guest intent wins over reply-shape heuristics (dining truncations often share
  // "ימי חול / שבתות וחגים" tokens with check-in policy copy).
  if (isDiningQuestion(guestText)) {
    return buildDiningReplyForGuest(cfg, guestText, guest, knowledgeBase);
  }
  if (isCheckInPolicyQuestion(guestText)) {
    return buildCheckInPolicyReply(cfg, arrivalDateStr);
  }
  if (shouldHandoffUnrecognizedInRoomRequest(guestText) || isInRoomDeliveryRequest(guestText)) {
    return genericFallback;
  }
  if (looksLikeDiningHoursReply(replyText)) {
    return buildDiningReplyForGuest(cfg, guestText, guest, knowledgeBase);
  }
  if (looksLikeCheckInHoursReply(replyText)) {
    return buildCheckInPolicyReply(cfg, arrivalDateStr);
  }
  return genericFallback;
}

// ── Sensitive financial / billing requests — never imply approval or a fixed
// resolution; staff must verify the charge before anyone promises anything ──

export const SENSITIVE_FINANCIAL_PATTERN =
  /חיוב(?:\s*כפול|\s*שגוי|\s*שגויה|\s*יתר|\s*נוסף)?|חויבתי\s*(פעמיים|בטעות|יותר|שוב)|גביתם\s*(ממני\s*)?(יותר|בטעות|פעמיים)|טעות\s*בחיוב|החזר(?:\s*כספי)?|לקבל\s*(את\s*)?(ה)?כסף\s*(בחזרה|חזרה)|חשבונית\s*(שגויה|לא\s*נכונה|חסרה)|תשלום\s*כפול|עמלה\s*(לא\s*מובנת|מיותרת|שלא\s*ביקשתי)|לא\s*אמור(?:ה)?\s*לשלם|למה\s*(שילמתי|חויבתי)|refund|overcharg(?:ed|e)|charged\s*twice|double\s*charge|billing\s*(issue|error|dispute|problem)|wrong\s*(amount|charge)|invoice\s*(error|issue)|dispute\s*(the\s*)?charge|chargeback/i;

export function isSensitiveFinancialRequest(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return SENSITIVE_FINANCIAL_PATTERN.test(t);
}

/** Canonical staff handoff for billing/refund disputes — neutral, no promise of outcome. */
export const CANONICAL_FINANCIAL_HANDOFF_MSG =
  "העברתי את הבקשה שלך לצוות לבדיקה, ויחזרו אליך בהקדם. 🙏";

// ── Severe-complaint kill-switch — furious/serious guest, LLM barred ────────
// Distinct from COMPLAINT_PATTERNS (whatsapp-webhook): both tiers send the
// same complaint_reply template, but this tier additionally guarantees the
// LLM never free-texts a response — only the fixed template, deterministically
// — plus requires_attention + a dedicated reason so a manager also reaches
// out personally, not just the automated acknowledgment.
export const SEVERE_COMPLAINT_PATTERN =
  /נהרס(?:ה|ו|תי|נו)?|הרסת(?:ם|י|ן)|אכזב(?:ה|תם|תי|נו)|גרוע(?:\s*(?:מאוד|ביותר|בצורה\s*חריגה))?|חבל\s*על\s*(?:ה)?כסף|מלוכלך(?:\s*(?:מאוד|ביותר|לגמרי))?|(?:איום\s*ונורא|נורא\s*ואיום)|בושה\s*(?:וחרפה)?|scandal(?:ous)?|disgusting|outraged|furious|worst\s*(?:hotel|experience|stay)/i;

export function isSevereComplaint(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return SEVERE_COMPLAINT_PATTERN.test(t);
}

// ── Defensive Shield — emoji/courtesy-only pass (Layer 2.1) ─────────────────
// A message that is nothing but an emoji ("👍", "🙏🏼") or a one-word courtesy
// closer ("תודה", "אוקי", "סגור") carries zero routing intent — sending the
// fallback/apology script on these makes the bot look robotic and spammy.
// Deliberately narrow: any additional substantive text after the courtesy
// word (e.g. "תודה על העזרה עם המזגן") must NOT match, so it still reaches
// the normal Tier-0/LLM pipeline unchanged.

/** Trimmed string is nothing but emoji/pictographic characters + whitespace. */
export const EMOJI_ONLY_PATTERN =
  /^[\s\p{Extended_Pictographic}‍️☀-➿]+$/u;

/**
 * One of a fixed set of courtesy closers, optionally followed only by
 * punctuation/whitespace/emoji — never by more Hebrew/English words, which
 * would signal a real (if short) message rather than a closer.
 */
export const COURTESY_ONLY_PATTERN =
  /^(?:תודה(?:\s*רבה)?|תודה\s*לך|הבנתי|הבנת|סגור|סבבה|בסדר(?:\s*גמור)?|אוקיי?|יא?ל+ה|מעולה|נהדר|great|awesome|perfect|cool|thanks?(?:\s*a\s*lot)?|thank\s*you|thx|ty|ok(?:ay)?|got\s*it|understood|sounds?\s*good)[\s!.,?~*'"‍️]*[\p{Extended_Pictographic}☀-➿]*[\s!.,?~*'"]*$/iu;

/** Conversation openers — must NEVER hit courtesy silent-exit (guest expects a hello back). */
const GREETING_TOKEN =
  "(?:היי+|הי|שלום|hey|hi|hello|good\\s*(?:morning|evening|afternoon))";
export const GREETING_ONLY_PATTERN = new RegExp(
  `^${GREETING_TOKEN}(?:\\s+${GREETING_TOKEN})*[\\s!.,?~*'\"‍️]*[\\p{Extended_Pictographic}☀-➿]*[\\s!.,?~*'\"]*$`,
  "iu",
);

export function isGuestGreetingMessage(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return GREETING_ONLY_PATTERN.test(t);
}

export function isLowValueCourtesyMessage(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (isGuestGreetingMessage(t)) return false;
  if (EMOJI_ONLY_PATTERN.test(t)) return true;
  return COURTESY_ONLY_PATTERN.test(t);
}

// ── Defensive Shield — guest's own WhatsApp Business away-message (Layer 2.2) ──
// Some guests' own phone numbers are themselves WhatsApp Business accounts
// (small-business owners). Messaging them can trigger THEIR OWN automated
// away-message reply back to us — Meta's Cloud API has no way to flag this as
// automated, it arrives indistinguishable from a normal inbound text. Left
// unhandled, this was falling through to intent classification → LLM, which
// produced confusing, off-topic replies to what is structurally an
// out-of-office notice, not a real guest reply. Detected by phrasing
// structure (business-hours + unavailability framing), not by hardcoding any
// one guest's business name — this is not guest-specific.
export const AUTO_AWAY_MESSAGE_PATTERN =
  /(מחוץ\s*ל?שעות\s*(הפעילות|העבודה|קבלת\s*הקהל)|שעות\s*(ה)?מענה\s*(בהודעות)?|הודעת\s*היעדרות|out[\s-]*of[\s-]*office|away\s*message|currently\s*unavailable\s*and\s*will|outside\s*(of\s*)?(our\s*)?(business|office)\s*hours)/iu;

export function isAutoAwayMessage(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return AUTO_AWAY_MESSAGE_PATTERN.test(t);
}

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

/** Israel-local hour (fixed UTC+2, no DST) when guests are auto-promoted to checked_in. */
export const AUTO_CHECKIN_LOCAL_HOUR = 15;

/** Israel-local hour when guests are auto-archived to checked_out on departure day. */
export const AUTO_CHECKOUT_LOCAL_HOUR = 11;

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

export function israelYmd(now: Date): string {
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

export function shouldAutoPromoteToCheckedIn(
  guest: { arrival_date?: string | null; status?: string | null },
  now: Date,
): boolean {
  if (!isPastAutoCheckinGateway(now)) return false;
  if (!isGuestArrivalToday(guest.arrival_date, now)) return false;
  return !!guest.status && AUTO_CHECKIN_ELIGIBLE_STATUSES.has(guest.status);
}

/** Auto checkout: 11:00 Israel on departure_date, or catch-up when departure_date passed. */
export function shouldAutoCheckoutGuest(
  guest: { departure_date?: string | null; status?: string | null },
  now: Date,
): boolean {
  if (!guest.departure_date) return false;
  if (guest.status === "checked_out" || guest.status === "cancelled") return false;
  if (!guest.status || !AUTO_CHECKOUT_ELIGIBLE_STATUSES.has(guest.status)) return false;
  const today = israelYmd(now);
  if (guest.departure_date < today) return true;
  if (guest.departure_date === today) return isPastAutoCheckoutGateway(now);
  return false;
}

/** In-memory + routing status: auto check-in after 15:00 / auto checkout after 11:00 on departure day. */
export function resolveEffectiveGuestStatus(
  guest: {
    status?: string | null;
    arrival_date?: string | null;
    departure_date?: string | null;
  },
  now: Date,
): string | null {
  if (shouldAutoCheckoutGuest(guest, now)) return "checked_out";
  if (shouldAutoPromoteToCheckedIn(guest, now)) return "checked_in";
  return guest.status ?? null;
}

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
  /** Stage 4 (mid_stay): when false, skip checked_in eligibility gate. Default true. */
  require_checked_in?: boolean;
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
  automation_muted?: boolean | null;
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
  // needs_callback is a staff UI alert only — intentionally NOT checked here (session 59).
  if (guest.automation_muted === true) return "automation_muted";
  if (stage.guest_flag_column && guest[stage.guest_flag_column] === true) return "already_sent";

  if (stage.applies_to === "suite" && guest.room_type !== "suite") return "wrong_room_type";
  if (stage.applies_to === "non_suite" && guest.room_type === "suite") return "wrong_room_type";

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

  if (stage.schedule_mode === "day_offset_with_time") {
    const anchorDateStr = stage.anchor_event === "departure_date" ? guest.departure_date : guest.arrival_date;
    if (!anchorDateStr) return null;
    const anchorDate = new Date(`${anchorDateStr}T00:00:00.000Z`);
    const targetDateStr = ymd(addDays(anchorDate, stage.day_offset ?? 0));
    const floorUtcHour = stage.local_time ? parseLocalTimeToUtcHour(stage.local_time) : 0;
    return utcHourToTimestamp(targetDateStr, floorUtcHour);
  }

  if (stage.schedule_mode === "hours_after_event") {
    const anchorTs = stage.anchor_event === "checkin_time" ? guest.checkin_time : null;
    if (!anchorTs) return null;
    return new Date(new Date(anchorTs).getTime() + (stage.offset_hours ?? 0) * 3600 * 1000);
  }

  return null;
}

/** Stage keys the cron + Live Monitor must always surface when is_active. */
export const CORE_PIPELINE_STAGE_KEYS = [
  "pre_arrival_2d",
  "night_before",
  "night_before_daypass",
  "morning_suite",
  "morning_welcome",
  "mid_stay",
  "mid_stay_daypass",
  "checkout_fb",
  "checkout_fb_daypass",
] as const;

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
    const scheduledFor = scheduledForPreview ?? utcHourToTimestamp(targetDateStr, floorUtcHour);

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
    const scheduledFor = scheduledForPreview ?? new Date(new Date(anchorTs).getTime() + (stage.offset_hours ?? 0) * 3600 * 1000);
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
  /אפשר|אפשרו|בבקשה|צר[י]כ[הים]?|חסר|חסרה|תביאו|תביא|שלחו|שלח|מבקש|מבקשת|נוכל\s+לקבל|אפשר\s+לקבל|אשמח|דחוף|עזרו|עזרה|העבר|העבירו|עוד\s+(?:של|מ)|תוסיפו|need|please\s+(?:send|bring)|can\s+(?:i|we)\s+get/u;

/** Allowlist cat. 1 — concrete in-room amenity delivery. */
const ALLOWLIST_AMENITY_PATTERN =
  /(?:חלב|קפה|מגבות|שמפו|סבון|נייר(?:\s*טואלט)?|חלוק(?:ים)?|כרית(?:ות)?|שמיכ(?:ה|ות)?|קפסולות)/u;

const ALLOWLIST_BOTTLED_WATER_PATTERN =
  /(?:בבקשה\s+)?(?:עוד\s+)?מים(?:\s+(?:לחדר|בחדר|לסוויטה|בסוויטה|קר(?:ים|ות)|מינר(?:ל|al)))?/u;

/** Allowlist cat. 2 — maintenance / broken infrastructure. */
const ALLOWLIST_MAINTENANCE_PATTERN =
  /מזגן(?:\s*(?:לא\s+עובד|לא\s+מקרר|תקול|מקולקל))?|(?:טלו(?:ו)?יז(?:יה|יון)|שלט(?:\s*ט(?:לו(?:ו)?יז)?)?)(?:\s*(?:לא\s+עובד|תקוע|שבור))?|סתימה|(?:אין|לא\s+)מים\s+חמים|זרם\s+חלש|אור\s*שבור|כספת\s*נעולה|דלת\s*לא\s*נפתח(?:ת)?|(?:לא\s+עובד(?:ת)?|תקלה|תקוע(?:ה)?|שבור(?:ה)?)/u;

/** Allowlist cat. 3 — cleaning / physical labor. */
const ALLOWLIST_CLEANING_PATTERN =
  /(?:ניקיון\s+חדר|לפנות\s+זבל|להחליף\s+מצעים|החלפת\s+מצעים|שטיפת\s+רצפה|פינוי\s+זבל)/u;

const OPERATIONAL_NEED_LABELS: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  { pattern: /חלב/u, label: "חלב" },
  { pattern: /מגבות/u, label: "מגבות" },
  { pattern: /קפה/u, label: "קפה" },
  { pattern: /מים/u, label: "מים" },
  { pattern: /קפסולות/u, label: "קפסולות" },
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
      || /(?:לחדר|לסוויטה|בחדר|בסוויטה|עוד\s+)/u.test(t);
  }

  return false;
}

/** @deprecated use isAllowlistedPhysicalTaskRequest */
export function isActionableOperationalInHouseRequest(text: string): boolean {
  return isAllowlistedPhysicalTaskRequest(text);
}

export function isCheckedInGuestStatus(status: string | null | undefined): boolean {
  return status === "checked_in";
}

/** Tier-0 intercept: checked-in guest + actionable operational ask — skip LLM. */
export function shouldInterceptOperationalInHouseRequest(
  text: string,
  status: string | null | undefined,
): boolean {
  return isCheckedInGuestStatus(status) && isActionableOperationalInHouseRequest(text);
}

/** True when staff should get tasks + Whapi card + requires_attention. */
export function shouldDispatchOperationalInHouseAlert(text: string): boolean {
  return isAllowlistedPhysicalTaskRequest(text);
}

/**
 * Single routing decision for guest free-text requests (after allowlist gate).
 * - operational_field_ops → tasks (dept=תפעול) + Whapi EN card (checked-in only)
 * - admin_reception_tasks → tasks (dept=קבלה/בקשות), no Whapi ops group
 * - requests_board → guest_alerts (pre-check-in physical, manager/price/human)
 * - kb_only → LLM/KB answer only
 */
export type GuestRequestDispatchRoute =
  | "kb_only"
  | "operational_field_ops"
  | "admin_reception_tasks"
  | "requests_board";

export function classifyGuestRequestDispatch(
  text: string,
  status: string | null | undefined,
): GuestRequestDispatchRoute {
  if (isInformationalGuestQuery(text)) return "kb_only";
  if (isAdministrativeInHouseRequest(text)) {
    return isCheckedInGuestStatus(status) ? "admin_reception_tasks" : "requests_board";
  }
  if (isAllowlistedPhysicalTaskRequest(text)) {
    return isCheckedInGuestStatus(status) ? "operational_field_ops" : "requests_board";
  }
  return "kb_only";
}

/** Requests Board (guest_alerts) — human/price/manager or pre-check-in escalation. */
export function isRequestsBoardEscalation(text: string): boolean {
  return /(?:מנהל|מחיר|נציג)/u.test(text)
    || (/תקלה/u.test(text) && isAllowlistedPhysicalTaskRequest(text));
}

/** Staff-facing summary + guests.attention_reason (e.g. "בקשת חלב לחדר"). */
export function buildOperationalRequestSummary(text: string): string {
  for (const { pattern, label } of OPERATIONAL_NEED_LABELS) {
    if (pattern.test(text)) return `בקשת ${label} לחדר`;
  }
  return "בקשת שירות בחדר";
}

/** Deterministic field-ops reply — no LLM, no implied approval language. */
export function buildOperationalDispatchReply(
  _requestSummary?: string,
  _guestName?: string | null,
): string {
  return "הבקשה הועברה ישירות לצוות השטח שלנו והם בדרך אליכם לחדר! המשך שהייה מפנקת! 🌟";
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

/** Late checkout, extension, early check-in, room change — staff must confirm availability. */
export const SENSITIVE_STAY_CHANGE_PATTERN =
  /הארכ(ה|ת)\s*(של\s*)?(ה)?(שהייה|שהות|חדר|הזמנה)|עזיבה\s*מאוחרת|פינוי\s*מאוחר|צ.?ק.?אא?וט\s*מאוחר|צ.?ק.?אא?וט\s*מאוחרת|להישאר\s*עוד|עוד\s*יום|עוד\s*לילה|לילה\s*נוסף|להאריך\s*(את\s*)?(ה)?(שהות|ההזמנה|השהייה)|לצ.?את\s*(יותר\s*)?מאוחר|צ.?ק.?אין\s*מוקדם|הגעה\s*מוקדמת|כניסה\s*מוקדמת|שינוי\s*חדר|להחליף\s*חדר|חדר\s*אחר|early\s*check.?in|late\s*check.?out|extend\s*(my\s*)?(stay|booking)|extra\s*night|stay\s*longer/i;

const SENSITIVE_STAY_FAQ_EXCLUSION =
  /^(?:מה|מתי|איזו?\s*שעה|כמה|האם)\s+.{0,40}?(?:צ.?ק.?אא?וט|צ.?ק.?אין|שעת\s*(?:כניסה|עזיבה)|check.?out|check.?in)/iu;

export function isSensitiveStayChangeRequest(text: string): boolean {
  const t = text.trim();
  if (!t || SENSITIVE_STAY_FAQ_EXCLUSION.test(t)) return false;
  return SENSITIVE_STAY_CHANGE_PATTERN.test(t);
}

/** Canonical staff handoff — MUST NOT vary; no enthusiastic approval language. */
export const CANONICAL_STAY_CHANGE_HANDOFF_MSG =
  "העברתי את בקשתך לצוות הסוויטות שלנו (אדיר ואפק), והם יצרו איתך קשר בהקדם. 🙏";

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
  /^(?:תודה(?:\s*רבה)?|תודה\s*לך|הבנתי|הבנת|סגור|סבבה|בסדר(?:\s*גמור)?|היי+|הי|שלום|אוקיי?|יא?ל+ה|מעולה|נהדר|great|awesome|perfect|cool|thanks?(?:\s*a\s*lot)?|thank\s*you|thx|ty|ok(?:ay)?|got\s*it|understood|sounds?\s*good)[\s!.,?~*'"‍️]*[\p{Extended_Pictographic}☀-➿]*[\s!.,?~*'"]*$/iu;

export function isLowValueCourtesyMessage(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (EMOJI_ONLY_PATTERN.test(t)) return true;
  return COURTESY_ONLY_PATTERN.test(t);
}

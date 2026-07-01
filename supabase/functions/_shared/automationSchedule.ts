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

/** Tier-0 operational keywords — amenities, supplies, maintenance (in-suite). */
export const OPERATIONAL_IN_HOUSE_KEYWORD_PATTERN =
  /חלב|מים|קפה|מגבות|חלוקים|נייר(?:\s*טואלט)?|קפסולות|סבון|שמפו|שלט|מזגן|טלויזיה|סתימה|אור(?:\s*שרוף)?|זבל|ניקיון|נמלי\s*אש|דבורים|צרעות|ג['']?וק|שירות\s*חדרים|לחדר|סדין/;

/** @deprecated alias — same pattern as OPERATIONAL_IN_HOUSE_KEYWORD_PATTERN (session 76). */
export const IN_ROOM_KEYWORD_PATTERN = OPERATIONAL_IN_HOUSE_KEYWORD_PATTERN;

const OPERATIONAL_NEED_LABELS: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  { pattern: /שירות\s*חדרים/u, label: "שירות חדרים" },
  { pattern: /חלב/u, label: "חלב" },
  { pattern: /מים/u, label: "מים" },
  { pattern: /קפה/u, label: "קפה" },
  { pattern: /מגבות/u, label: "מגבות" },
  { pattern: /חלוקים/u, label: "חלוקים" },
  { pattern: /נייר/u, label: "נייר" },
  { pattern: /קפסולות/u, label: "קפסולות" },
  { pattern: /סבון/u, label: "סבון" },
  { pattern: /שמפו/u, label: "שמפו" },
  { pattern: /שלט/u, label: "שלט" },
  { pattern: /מזגן/u, label: "מזגן" },
  { pattern: /סתימה/u, label: "סתימה" },
  { pattern: /אור\s*שרוף/u, label: "אור שרוף" },
  { pattern: /אור/u, label: "אור" },
  { pattern: /טלויזיה/u, label: "טלויזיה" },
  { pattern: /נמלי\s*אש/u, label: "נמלי אש" },
  { pattern: /דבורים/u, label: "דבורים" },
  { pattern: /צרעות/u, label: "צרעות" },
  { pattern: /ג['']?וק/u, label: "ג'וק" },
  { pattern: /זבל/u, label: "זבל" },
  { pattern: /ניקיון/u, label: "ניקיון" },
  { pattern: /סדין/u, label: "סדין" },
  { pattern: /לחדר/u, label: "שירות לחדר" },
];

export function messageSignalsInRoomPresence(text: string): boolean {
  return OPERATIONAL_IN_HOUSE_KEYWORD_PATTERN.test(text);
}

export function messageSignalsOperationalInHouseRequest(text: string): boolean {
  return OPERATIONAL_IN_HOUSE_KEYWORD_PATTERN.test(text);
}

/** Informational FAQ — keyword present but not a dispatch-worthy ask. */
const OPERATIONAL_FAQ_ONLY_PATTERN =
  /^(?:מה|מתי|איפה|כמה|האם)\b|^(?:יש|אין)\s+(?:ספא|בריכה|מסעדה|חניה|אינטרנט|wifi|wi-fi)/iu;

/** Guest is asking staff to do something — not just chatting about an amenity. */
const OPERATIONAL_REQUEST_SIGNAL_PATTERN =
  /אפשר|אפשרו|בבקשה|צריך|צריכה|צריכים|חסר|חסרה|חסרים|תביאו|תביא|שלחו|מבקש|מבקשת|לא\s+עובד|לא\s+עובדת|תקלה|תקוע|תקועה|בעיה|נוכל\s+לקבל|אפשר\s+לקבל|יש\s+לכם|אשמח|נשמח\s+לקבל|דחוף|עזרה|עזרו|מישהו\s+יכול|העבר|העבירו/u;

const STRONG_DISPATCH_KEYWORDS =
  /חלב|מגבות|חלוקים|קפסולות|סבון|שמפו|סתימה|מזגן|זבל|ניקיון|שירות\s*חדרים|סדין|נייר|טלויזיה|נמלי\s*אש|דבורים|צרעות|ג['']?וק|אור\s*שרוף/u;

/**
 * Tier-0 discretion: keyword alone is not enough — must look like a real
 * in-suite service ask (request signal or strong maintenance/supply keyword).
 * Pure FAQ ("מתי יש ניקיון?") falls through to LLM instead.
 */
export function isActionableOperationalInHouseRequest(text: string): boolean {
  const t = text.trim();
  if (!t || !messageSignalsOperationalInHouseRequest(t)) return false;

  const hasRequestSignal = OPERATIONAL_REQUEST_SIGNAL_PATTERN.test(t);
  const looksLikeFaqOnly = OPERATIONAL_FAQ_ONLY_PATTERN.test(t) && !hasRequestSignal;

  if (looksLikeFaqOnly) return false;

  if (STRONG_DISPATCH_KEYWORDS.test(t)) {
    return hasRequestSignal || /לחדר|לסוויטה|בחדר|בסוויטה/u.test(t) || /\?/.test(t);
  }

  if (/מים|קפה/u.test(t)) {
    return hasRequestSignal || /לחדר|לסוויטה|בחדר/u.test(t);
  }

  if (/שלט|אור/u.test(t)) {
    return /לא\s+עובד|תקלה|תקוע|בעיה|שלט|מאור|תאורה/u.test(t) && (hasRequestSignal || /לחדר|בחדר/u.test(t));
  }

  if (/לחדר/u.test(t)) {
    return hasRequestSignal && STRONG_DISPATCH_KEYWORDS.test(t.replace(/לחדר/gu, ""));
  }

  return hasRequestSignal;
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
  return isActionableOperationalInHouseRequest(text);
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
  return isPreArrivalGuestStatus(status) && messageSignalsInRoomPresence(text);
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

// supabase/functions/_shared/automationSchedule.test.ts
//
// Run: deno test supabase/functions/_shared/automationSchedule.test.ts
//
// Covers the Stage 2.5 (night_before) Shabbat-bundle rules added 2026-07-10:
//   - Friday arrivals fire same-day at local_time_shabbat instead of the
//     weekday reminder the day before.
//   - Saturday arrivals are unaffected (existing migration 172 behavior).
//   - A Friday arrival already checked in via a genuine early/manual
//     check-in (before today's 15:00 auto-checkin gateway) skips; one
//     auto-promoted by this same tick's 15:00 sweep still sends.
//   - Weekday arrivals are unaffected.

import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  resolveStageSchedule,
  checkEligibility,
  shouldAutoPromoteToCheckedIn,
  resolveEffectiveGuestStatus,
  isDepartureAssistRequest,
  isInformationalGuestQuery,
  isSensitiveStayChangeRequest,
  isRequestSummaryGrounded,
  buildDepartureAssistSummary,
  extractAllowlistedRequestLines,
  isInstantAmenityOpsDispatch,
  isDiningQuestion,
  isMealDeclineOrApology,
  buildDiningReply,
  buildMealDeclineAck,
  isReplyObviouslyTruncated,
  endsWithMidWordHebrewCut,
  resolveTruncatedReplyFallback,
  looksLikeDiningHoursReply,
  type AutomationStage,
  type GuestForSchedule,
} from "./automationSchedule.ts";

function nightBeforeStage(overrides: Partial<AutomationStage> = {}): AutomationStage {
  return {
    stage_key: "night_before",
    display_name: "Stage 2.5 — תזכורת ערב לפני",
    journey_phase: "pre_arrival",
    sequence_order: 150,
    node_type: "hybrid",
    schedule_mode: "day_offset_with_time",
    anchor_event: "arrival_date",
    day_offset: -1,
    local_time: "19:00",
    local_time_shabbat: "15:00",
    local_time_end: "23:00",
    offset_hours: null,
    applies_to: "suite",
    meta_template_name: "night_before_suites",
    session_message_script_key: "night_before_reminder",
    session_message_script_key_shabbat: "night_before_reminder_shabbat",
    session_message_image_url_shabbat: "https://example.com/suiteshabat.jpeg",
    interactive_buttons: [],
    guest_flag_column: "msg_pre_arrival_sent",
    is_active: true,
    ...overrides,
  };
}

function suiteGuest(overrides: Partial<GuestForSchedule> = {}): GuestForSchedule {
  return {
    id: 1,
    arrival_date: null,
    departure_date: null,
    room_type: "suite",
    room: "אמטיסט 8",
    status: "pending",
    checkin_time: null,
    arrival_confirmed: null,
    arrival_confirmed_at: null,
    needs_callback: null,
    automation_muted: false,
    claimed_by: null,
    msg_pre_arrival_sent: false,
    ...overrides,
  };
}

// Reference week (Israel calendar): 2026-07-05 Sun … 2026-07-11 Sat.
const WED = "2026-07-08";
const THU = "2026-07-09";
const FRI = "2026-07-10";
const SAT = "2026-07-11";

// Israel local HH:MM on a given YYYY-MM-DD, fixed UTC+2 (no DST) — matches
// the module's own convention.
function israelInstant(dateStr: string, hh: number, mm: number): Date {
  const utcHour = hh - 2;
  return new Date(`${dateStr}T${String(utcHour).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00.000Z`);
}

Deno.test("night_before: Saturday arrival, cron runs Friday 15:05 → due, Shabbat time", () => {
  const stage = nightBeforeStage();
  const guest = suiteGuest({ arrival_date: SAT });
  const result = resolveStageSchedule(stage, guest, israelInstant(FRI, 15, 5));
  assertEquals(result.dueNow, true);
  assertEquals(result.skipReason, null);
});

Deno.test("night_before: Friday arrival, status=pending, Friday 15:05 → due", () => {
  const stage = nightBeforeStage();
  const guest = suiteGuest({ arrival_date: FRI, status: "pending" });
  const result = resolveStageSchedule(stage, guest, israelInstant(FRI, 15, 5));
  assertEquals(result.dueNow, true);
  assertEquals(result.skipReason, null);
});

Deno.test("night_before: Friday arrival, genuine early check-in before 15:00 → already_checked_in", () => {
  const stage = nightBeforeStage();
  const guest = suiteGuest({
    arrival_date: FRI,
    status: "checked_in",
    checkin_time: israelInstant(FRI, 12, 0).toISOString(),
  });
  const result = resolveStageSchedule(stage, guest, israelInstant(FRI, 15, 5));
  assertEquals(result.dueNow, false);
  assertEquals(result.skipReason, "already_checked_in");
});

Deno.test("night_before: Friday arrival auto-promoted by this tick's 15:00 sweep → still sends", () => {
  const stage = nightBeforeStage();
  const guest = suiteGuest({
    arrival_date: FRI,
    status: "checked_in",
    checkin_time: israelInstant(FRI, 15, 0).toISOString(), // stamped by AUTO_CHECKIN_LOCAL_HOUR sweep
  });
  const result = resolveStageSchedule(stage, guest, israelInstant(FRI, 15, 5));
  assertEquals(result.dueNow, true);
  assertEquals(result.skipReason, null);
});

Deno.test("night_before: Friday arrival, Thursday 19:05 → NOT due (no Thursday weekday send)", () => {
  const stage = nightBeforeStage();
  const guest = suiteGuest({ arrival_date: FRI, status: "pending" });
  const result = resolveStageSchedule(stage, guest, israelInstant(THU, 19, 5));
  assertEquals(result.dueNow, false);
});

Deno.test("night_before: Wednesday arrival, Tuesday 19:05 → weekday path unchanged, due", () => {
  const stage = nightBeforeStage();
  const guest = suiteGuest({ arrival_date: WED, status: "pending" });
  const result = resolveStageSchedule(stage, guest, israelInstant("2026-07-07", 19, 5));
  assertEquals(result.dueNow, true);
  assertEquals(result.skipReason, null);
});

Deno.test("night_before: Saturday arrival checked_in is NOT covered by the Friday-only already_checked_in rule", () => {
  const stage = nightBeforeStage();
  const guest = suiteGuest({
    arrival_date: SAT,
    status: "checked_in",
    checkin_time: israelInstant(FRI, 10, 0).toISOString(),
  });
  const result = resolveStageSchedule(stage, guest, israelInstant(FRI, 15, 5));
  // Saturday arrivals were never part of this rule — a stray checked_in
  // status here should not be silently reinterpreted as the Friday skip.
  assertEquals(result.skipReason, null);
  assertEquals(result.dueNow, true);
});

// ── 15:00 auto check-in promotion — disabled 2026-07-11 (housekeeping WA
// group is the sole check-in source for suites) ──────────────────────────

Deno.test("shouldAutoPromoteToCheckedIn: always false — expected guest, arrival today, 16:00", () => {
  const guest = suiteGuest({ status: "expected", arrival_date: SAT });
  const result = shouldAutoPromoteToCheckedIn(
    { arrival_date: guest.arrival_date, status: guest.status },
    israelInstant(SAT, 16, 0),
  );
  assertEquals(result, false);
});

Deno.test("shouldAutoPromoteToCheckedIn: always false — pending guest, arrival today, past gateway", () => {
  const result = shouldAutoPromoteToCheckedIn(
    { arrival_date: SAT, status: "pending" },
    israelInstant(SAT, 23, 0),
  );
  assertEquals(result, false);
});

Deno.test("resolveEffectiveGuestStatus: expected guest at 16:00 stays expected (no auto-promotion)", () => {
  const result = resolveEffectiveGuestStatus(
    { status: "expected", arrival_date: SAT, departure_date: null },
    israelInstant(SAT, 16, 0),
  );
  assertEquals(result, "expected");
});

Deno.test("resolveEffectiveGuestStatus: departure-day auto checkout still fires at 11:00", () => {
  const result = resolveEffectiveGuestStatus(
    { status: "checked_in", arrival_date: FRI, departure_date: SAT },
    israelInstant(SAT, 11, 30),
  );
  assertEquals(result, "checked_out");
});

// ── Departure / porter assist — session 2026-07-11 hallucination incident ──
// Guest: "לצערי אנחנו צריכים לעשות צאק אאוט ומבקשים שמישהו יגיע לחדר 9 לקחת
// את המזוודה לקבלה" — bot replied with an invented "מגבת וחלוק לבריכה"
// (towels & robe) ack instead of routing the actual luggage-help request.
const INCIDENT_DEPARTURE_TEXT =
  "לצערי אנחנו צריכים לעשות צאק אאוט ומבקשים שמישהו יגיע לחדר 9 לקחת את המזוודה לקבלה";

Deno.test("isDepartureAssistRequest: incident text (checkout + luggage + room) → true", () => {
  assertEquals(isDepartureAssistRequest(INCIDENT_DEPARTURE_TEXT), true);
});

Deno.test("isDepartureAssistRequest: incident text is NOT informational", () => {
  assertEquals(isInformationalGuestQuery(INCIDENT_DEPARTURE_TEXT), false);
});

Deno.test("isDepartureAssistRequest: incident text is NOT a sensitive stay-change", () => {
  assertEquals(isSensitiveStayChangeRequest(INCIDENT_DEPARTURE_TEXT), false);
});

Deno.test("isDepartureAssistRequest: bare checkout-hours FAQ stays informational, not departure assist", () => {
  const t = "מה שעת צ'ק-אאוט?";
  assertEquals(isDepartureAssistRequest(t), false);
  assertEquals(isInformationalGuestQuery(t), true);
});

Deno.test("isDepartureAssistRequest: late checkout request stays on the stay-change shield, not departure assist", () => {
  const t = "אפשר צ'ק אאוט מאוחר יותר היום?";
  assertEquals(isSensitiveStayChangeRequest(t), true);
  assertEquals(isDepartureAssistRequest(t), false);
});

Deno.test("isDepartureAssistRequest: plain 'thanks, checking out now' with no luggage ask → false", () => {
  assertEquals(isDepartureAssistRequest("תודה, אנחנו עושים צ'ק אאוט עכשיו"), false);
});

Deno.test("buildDepartureAssistSummary: extracts room number from current text only", () => {
  assertEquals(
    buildDepartureAssistSummary(INCIDENT_DEPARTURE_TEXT),
    "איסוף מזוודה לצ'ק-אאוט (חדר 9)",
  );
  assertEquals(
    buildDepartureAssistSummary("צריכים לעשות צ'ק אאוט, מישהו יגיע לקחת את המזוודה?"),
    "איסוף מזוודה לצ'ק-אאוט",
  );
});

// ── Grounding — server-side check against history-bled tool summaries ──────
Deno.test("isRequestSummaryGrounded: invented towels/robe summary vs luggage text → rejected", () => {
  assertEquals(isRequestSummaryGrounded("מגבת וחלוק לבריכה", INCIDENT_DEPARTURE_TEXT), false);
});

Deno.test("isRequestSummaryGrounded: genuine luggage summary vs luggage text → accepted", () => {
  assertEquals(isRequestSummaryGrounded("איסוף מזוודה לצ'ק-אאוט", INCIDENT_DEPARTURE_TEXT), true);
});

Deno.test("isRequestSummaryGrounded: genuine towel summary vs towel text → accepted", () => {
  assertEquals(isRequestSummaryGrounded("בקשת מגבות לחדר", "אפשר עוד מגבות לחדר בבקשה"), true);
});

// ── Burst isolation — unrelated prior line must not dominate the allowlisted one ──
Deno.test("extractAllowlistedRequestLines: unrelated departure line does not pollute an amenity burst", () => {
  const burst = `${INCIDENT_DEPARTURE_TEXT}\nאגב אפשר גם עוד מגבות לחדר`;
  const isolated = extractAllowlistedRequestLines(burst);
  assertEquals(isolated, "אגב אפשר גם עוד מגבות לחדר");
});

// ── Stage 1 (pre_arrival_2d) late-import catch-up ──────────────────────────
function stage1PreArrival(overrides: Partial<AutomationStage> = {}): AutomationStage {
  return {
    stage_key: "pre_arrival_2d",
    display_name: "Stage 1 — אישור הגעה",
    journey_phase: "pre_arrival",
    sequence_order: 100,
    node_type: "hybrid",
    schedule_mode: "day_offset_with_time",
    anchor_event: "arrival_date",
    day_offset: -2,
    local_time: null,
    local_time_shabbat: null,
    local_time_end: null,
    offset_hours: null,
    applies_to: "all",
    meta_template_name: "dream_arrival_confirmation",
    session_message_script_key: "pre_arrival_2d",
    session_message_script_key_shabbat: null,
    session_message_image_url_shabbat: null,
    interactive_buttons: [],
    guest_flag_column: "msg_pre_arrival_2d_sent",
    is_active: true,
    ...overrides,
  };
}

Deno.test("pre_arrival_2d: late import before arrival → missed_window (not date_passed, not dueNow)", () => {
  // Arrival tomorrow; T-2 was yesterday → window missed, still catch-up eligible.
  const guest = suiteGuest({
    arrival_date: "2026-07-13",
    msg_pre_arrival_2d_sent: false,
  });
  const result = resolveStageSchedule(stage1PreArrival(), guest, israelInstant("2026-07-12", 11, 0));
  assertEquals(result.skipReason, "missed_window");
  assertEquals(result.dueNow, false);
});

Deno.test("pre_arrival_2d: late import on arrival day → missed_window", () => {
  const guest = suiteGuest({
    arrival_date: "2026-07-12",
    msg_pre_arrival_2d_sent: false,
  });
  const result = resolveStageSchedule(stage1PreArrival(), guest, israelInstant("2026-07-12", 11, 0));
  assertEquals(result.skipReason, "missed_window");
  assertEquals(result.dueNow, false);
});

Deno.test("pre_arrival_2d: arrival already past → date_passed (hidden permanently)", () => {
  const guest = suiteGuest({
    arrival_date: "2026-07-10",
    msg_pre_arrival_2d_sent: false,
  });
  const result = resolveStageSchedule(stage1PreArrival(), guest, israelInstant("2026-07-12", 11, 0));
  assertEquals(result.skipReason, "date_passed");
  assertEquals(result.dueNow, false);
});

Deno.test("pre_arrival_2d: on T-2 day → dueNow (normal cron path)", () => {
  const guest = suiteGuest({
    arrival_date: "2026-07-14",
    msg_pre_arrival_2d_sent: false,
  });
  const result = resolveStageSchedule(stage1PreArrival(), guest, israelInstant("2026-07-12", 11, 0));
  assertEquals(result.skipReason, null);
  assertEquals(result.dueNow, true);
});

Deno.test("night_before after window: still date_passed (no Stage-1-style catch-up)", () => {
  // night_before day_offset -1; arrival 07-13 → target 07-12; evaluating 07-13 → passed.
  const guest = suiteGuest({ arrival_date: "2026-07-13", msg_pre_arrival_sent: false });
  const result = resolveStageSchedule(nightBeforeStage(), guest, israelInstant("2026-07-13", 10, 0));
  assertEquals(result.skipReason, "date_passed");
  assertEquals(result.dueNow, false);
});

function morningSuiteStage(overrides: Partial<AutomationStage> = {}): AutomationStage {
  return {
    stage_key: "morning_suite",
    display_name: "Stage 3 — בוקר הגעה (סוויטות)",
    journey_phase: "arrival_day",
    sequence_order: 250,
    node_type: "hybrid",
    schedule_mode: "day_offset_with_time",
    anchor_event: "arrival_date",
    day_offset: 0,
    local_time: "06:00",
    local_time_end: "10:00",
    offset_hours: null,
    applies_to: "suite",
    meta_template_name: "suite_welcome_morning",
    session_message_script_key: "stage_3_morning",
    interactive_buttons: [],
    guest_flag_column: "msg_morning_suite_sent",
    is_active: true,
    ...overrides,
  };
}

Deno.test("morning_suite: inside send window on arrival day → dueNow", () => {
  const guest = suiteGuest({
    arrival_date: SAT,
    msg_morning_suite_sent: false,
  });
  const result = resolveStageSchedule(morningSuiteStage(), guest, israelInstant(SAT, 8, 0));
  assertEquals(result.skipReason, null);
  assertEquals(result.dueNow, true);
});

Deno.test("morning_suite: after send window on arrival day → missed_window, not cron auto-send", () => {
  const guest = suiteGuest({
    arrival_date: SAT,
    msg_morning_suite_sent: false,
  });
  const result = resolveStageSchedule(morningSuiteStage(), guest, israelInstant(SAT, 17, 33));
  assertEquals(result.skipReason, "missed_window");
  assertEquals(result.dueNow, false);
});

Deno.test("morning_suite: no local_time_end → default 4h cap, afternoon is missed_window", () => {
  const guest = suiteGuest({
    arrival_date: SAT,
    msg_morning_suite_sent: false,
  });
  const stage = morningSuiteStage({ local_time_end: null });
  const result = resolveStageSchedule(stage, guest, israelInstant(SAT, 17, 0));
  assertEquals(result.skipReason, "missed_window");
  assertEquals(result.dueNow, false);
});

Deno.test("night_before: past same-day quiet ceiling → missed_window (manual only)", () => {
  const stage = nightBeforeStage({
    day_offset: 0,
    local_time: "19:00",
    local_time_end: "21:00",
    local_time_shabbat: null,
  });
  const guest = suiteGuest({ arrival_date: SAT, msg_pre_arrival_sent: false });
  const result = resolveStageSchedule(stage, guest, israelInstant(SAT, 22, 0));
  assertEquals(result.skipReason, "missed_window");
  assertEquals(result.dueNow, false);
});

// ── Guest Experience Survey — spa_warmup_daypass / survey_invite_daypass ────
// (2026-07-13, migration 194) — spa_time-relative anchor + spa-cohort gate.

function daypassSpaGuest(overrides: Partial<GuestForSchedule> = {}): GuestForSchedule {
  return {
    id: 2,
    arrival_date: "2026-07-13",
    departure_date: "2026-07-13",
    room_type: "day_guest",
    room: null,
    status: "checked_in",
    checkin_time: null,
    arrival_confirmed: null,
    arrival_confirmed_at: null,
    needs_callback: null,
    automation_muted: false,
    claimed_by: null,
    spa_date: "2026-07-13",
    spa_time: "16:00",
    msg_spa_warmup_sent: false,
    msg_survey_invite_sent: false,
    ...overrides,
  };
}

function spaWarmupStage(overrides: Partial<AutomationStage> = {}): AutomationStage {
  return {
    stage_key: "spa_warmup_daypass",
    display_name: "ספא — חימום לפני הטיפול (בילוי יומי)",
    journey_phase: "in_stay",
    sequence_order: 310,
    node_type: "session_message",
    schedule_mode: "hours_after_event",
    anchor_event: "spa_time",
    day_offset: null,
    local_time: null,
    local_time_end: null,
    offset_hours: -0.5, // default 30 minutes before spa_time (ACC can change X)
    applies_to: "non_suite",
    meta_template_name: null,
    session_message_script_key: "spa_warmup_daypass",
    interactive_buttons: [],
    guest_flag_column: "msg_spa_warmup_sent",
    is_active: true,
    ...overrides,
  };
}

function surveyInviteStage(overrides: Partial<AutomationStage> = {}): AutomationStage {
  return {
    stage_key: "survey_invite_daypass",
    display_name: "סקר חוויית אורח (בילוי יומי)",
    journey_phase: "post_stay",
    sequence_order: 410,
    node_type: "session_message",
    schedule_mode: "day_offset_with_time",
    anchor_event: "arrival_date",
    day_offset: 0,
    local_time: "17:00",
    local_time_end: null,
    offset_hours: null,
    applies_to: "non_suite",
    meta_template_name: null,
    session_message_script_key: "survey_invite_daypass",
    interactive_buttons: [],
    guest_flag_column: "msg_survey_invite_sent",
    is_active: true,
    ...overrides,
  };
}

Deno.test("spa_warmup_daypass: corrupted anchor_event still schedules from spa_time", () => {
  const guest = daypassSpaGuest({ spa_time: "16:00" });
  const corrupted = spaWarmupStage({
    anchor_event: "arrival_confirmed_at",
    offset_hours: -0.5,
  });
  const due = resolveStageSchedule(corrupted, guest, israelInstant("2026-07-13", 15, 30));
  assertEquals(due.dueNow, true);
  assertEquals(due.skipReason, null);
});

Deno.test("spa_warmup_daypass: dueNow exactly at spa_time-30min, not before", () => {
  const guest = daypassSpaGuest({ spa_time: "16:00" }); // warmup instant = 15:30 Israel
  const before = resolveStageSchedule(spaWarmupStage(), guest, israelInstant("2026-07-13", 15, 29));
  assertEquals(before.dueNow, false);
  assertEquals(before.skipReason, null);
  const due = resolveStageSchedule(spaWarmupStage(), guest, israelInstant("2026-07-13", 15, 30));
  assertEquals(due.dueNow, true);
  assertEquals(due.skipReason, null);
});

Deno.test("spa_warmup_daypass: custom X minutes before (ACC offset_hours)", () => {
  const guest = daypassSpaGuest({ spa_time: "16:00" });
  // 45 minutes before → 15:15
  const stage = spaWarmupStage({ offset_hours: -0.75 });
  assertEquals(resolveStageSchedule(stage, guest, israelInstant("2026-07-13", 15, 14)).dueNow, false);
  assertEquals(resolveStageSchedule(stage, guest, israelInstant("2026-07-13", 15, 15)).dueNow, true);
});

Deno.test("spa_warmup_daypass: missing spa_time → missing_anchor_timestamp (no silent fake time)", () => {
  const guest = daypassSpaGuest({ spa_time: null });
  const result = resolveStageSchedule(spaWarmupStage(), guest, israelInstant("2026-07-13", 15, 0));
  assertEquals(result.skipReason, "missing_anchor_timestamp");
  assertEquals(result.dueNow, false);
});

Deno.test("spa_warmup_daypass: spa_date not the visit day → no_spa_visit_today", () => {
  const guest = daypassSpaGuest({ spa_date: "2026-07-10" }); // stale/prior-visit spa_date
  const result = resolveStageSchedule(spaWarmupStage(), guest, israelInstant("2026-07-13", 15, 0));
  assertEquals(result.skipReason, "no_spa_visit_today");
});

Deno.test("spa_warmup_daypass: very early spa_time → outside sane hours, skipped", () => {
  // Comfortable margin (not a boundary-minute value) — this codebase's anchor
  // math is intentionally fixed-UTC+2 (ISRAEL_UTC_OFFSET_HOURS, no DST) while
  // israelLocalHour() reads the real IANA-DST-aware clock; during Israel's
  // real DST season the two can differ by up to 1h, so only test comfortably
  // clear of the sane-hours boundary, same convention as the existing
  // night_before tests above (wide windows, not exact-minute assertions).
  const guest = daypassSpaGuest({ spa_time: "05:00" }); // warmup instant well before 06:00 either way
  const result = resolveStageSchedule(spaWarmupStage(), guest, israelInstant("2026-07-13", 10, 0));
  assertEquals(result.skipReason, "spa_warmup_outside_hours");
  assertEquals(result.dueNow, false);
});

Deno.test("spa_warmup_daypass: >30min past warmup instant → missed_window (no cron blast)", () => {
  const guest = daypassSpaGuest({ spa_time: "16:00" });
  const result = resolveStageSchedule(spaWarmupStage(), guest, israelInstant("2026-07-13", 17, 1));
  assertEquals(result.skipReason, "missed_window");
  assertEquals(result.dueNow, false);
});

Deno.test("spa_warmup_daypass: cancelled guest never fires", () => {
  const guest = daypassSpaGuest({ status: "cancelled" });
  const result = resolveStageSchedule(spaWarmupStage(), guest, israelInstant("2026-07-13", 14, 45));
  assertEquals(result.skipReason, "guest_cancelled");
});

Deno.test("spa_warmup_daypass: already sent → already_sent (idempotent)", () => {
  const guest = daypassSpaGuest({ msg_spa_warmup_sent: true });
  const result = resolveStageSchedule(spaWarmupStage(), guest, israelInstant("2026-07-13", 14, 45));
  assertEquals(result.skipReason, "already_sent");
});

Deno.test("survey_invite_daypass: dueNow at/after 17:00, not before (comfortable margin)", () => {
  // Comfortable margin either side of the 17:00 floor — see DST-margin note above.
  const guest = daypassSpaGuest();
  const before = resolveStageSchedule(surveyInviteStage(), guest, israelInstant("2026-07-13", 14, 0));
  assertEquals(before.dueNow, false);
  const due = resolveStageSchedule(surveyInviteStage(), guest, israelInstant("2026-07-13", 20, 0));
  assertEquals(due.dueNow, true);
  assertEquals(due.skipReason, null);
});

Deno.test("survey_invite_daypass: no spa that day → no_spa_visit_today (audience gate)", () => {
  const guest = daypassSpaGuest({ spa_date: null, spa_time: null });
  const result = resolveStageSchedule(surveyInviteStage(), guest, israelInstant("2026-07-13", 17, 0));
  assertEquals(result.skipReason, "no_spa_visit_today");
});

Deno.test("survey_invite_daypass: cancelled guest never fires (Zero-Spam)", () => {
  const guest = daypassSpaGuest({ status: "cancelled" });
  const result = resolveStageSchedule(surveyInviteStage(), guest, israelInstant("2026-07-13", 17, 0));
  assertEquals(result.skipReason, "guest_cancelled");
});

Deno.test("survey_invite_daypass: suite guest blocked by applies_to=non_suite", () => {
  const guest = daypassSpaGuest({ room_type: "suite", room: "אמטיסט 8" });
  const result = resolveStageSchedule(surveyInviteStage(), guest, israelInstant("2026-07-13", 17, 0));
  assertEquals(result.skipReason, "wrong_room_type");
});

Deno.test("survey_invite_daypass: needs_callback=true does NOT mute the automation (Silence Rule)", () => {
  const guest = daypassSpaGuest({ needs_callback: true });
  const result = resolveStageSchedule(surveyInviteStage(), guest, israelInstant("2026-07-13", 17, 0));
  assertEquals(result.skipReason, null);
  assertEquals(result.dueNow, true);
});

function nightBeforeDaypassStage(overrides: Partial<AutomationStage> = {}): AutomationStage {
  return {
    ...nightBeforeStage({ applies_to: "non_suite" }),
    stage_key: "night_before_daypass",
    display_name: "Stage 2.5 — תזכורת ערב לפני (בילוי יומי)",
    session_message_script_key: "night_before_daypass",
    ...overrides,
  };
}

Deno.test("night_before_daypass: no spa that day → no_spa_visit_today (spa cohort gate)", () => {
  const guest = daypassSpaGuest({
    arrival_date: "2026-07-14",
    departure_date: "2026-07-14",
    spa_date: null,
    spa_time: null,
  });
  const result = resolveStageSchedule(nightBeforeDaypassStage(), guest, israelInstant("2026-07-13", 19, 30));
  assertEquals(result.skipReason, "no_spa_visit_today");
});

// ── checkout_fb_daypass vs. survey_invite_daypass dedupe (Mike lock, 2026-07-13) ──
// A spa-cohort day-pass guest gets survey_invite_daypass as their ONE
// post-visit touch; the older, unscoped checkout_fb_daypass must yield to it
// so the guest isn't contacted twice. Non-spa day-pass guests are untouched.

function checkoutFbDaypassStage(overrides: Partial<AutomationStage> = {}): AutomationStage {
  return {
    stage_key: "checkout_fb_daypass",
    display_name: "משוב לאחר עזיבה (בילוי יומי)",
    journey_phase: "post_stay",
    sequence_order: 420,
    node_type: "hybrid",
    schedule_mode: "day_offset_with_time",
    anchor_event: "departure_date",
    day_offset: 1,
    local_time: "09:00",
    local_time_end: null,
    offset_hours: null,
    applies_to: "non_suite",
    meta_template_name: "dream_checkout_feedback",
    session_message_script_key: "checkout_fb_daypass",
    interactive_buttons: [],
    guest_flag_column: "msg_checkout_fb_sent",
    is_active: true,
    ...overrides,
  };
}

Deno.test("checkout_fb_daypass: spa-cohort day-pass guest (survey-eligible) → superseded_by_survey, not sent", () => {
  const guest = daypassSpaGuest(); // spa_date === arrival_date === departure_date
  const result = resolveStageSchedule(checkoutFbDaypassStage(), guest, israelInstant("2026-07-14", 9, 0));
  assertEquals(result.skipReason, "superseded_by_survey");
  assertEquals(result.dueNow, false);
});

Deno.test("checkout_fb_daypass: non-spa day-pass guest → fires normally (their only feedback channel)", () => {
  const guest = daypassSpaGuest({ spa_date: null, spa_time: null });
  const result = resolveStageSchedule(checkoutFbDaypassStage(), guest, israelInstant("2026-07-14", 9, 0));
  assertEquals(result.skipReason, null);
  assertEquals(result.dueNow, true);
});

Deno.test("checkout_fb_daypass: stale prior-visit spa_date (not this visit) → fires normally", () => {
  const guest = daypassSpaGuest({ spa_date: "2026-07-01" });
  const result = resolveStageSchedule(checkoutFbDaypassStage(), guest, israelInstant("2026-07-14", 9, 0));
  assertEquals(result.skipReason, null);
  assertEquals(result.dueNow, true);
});

Deno.test("checkout_fb: suite guest → suite_checkout_survey_via_housekeeping (housekeeping Co only)", () => {
  const stage: AutomationStage = {
    ...nightBeforeStage(),
    stage_key: "checkout_fb",
    applies_to: "suite",
    guest_flag_column: "msg_checkout_fb_sent",
    session_message_script_key: "checkout_fb",
  };
  const guest = suiteGuest({
    arrival_date: "2026-07-10",
    departure_date: "2026-07-13",
    status: "checked_out",
    msg_checkout_fb_sent: false,
  });
  assertEquals(
    checkEligibility(stage, guest, israelInstant("2026-07-14", 9, 0)),
    "suite_checkout_survey_via_housekeeping",
  );
});

// ── Anti-spam/anti-race latch (2026-07-13, automationRetryGate.ts) ─────────
// Regression coverage for the checkEligibility wiring — the pure
// evaluateRetryGate decision table itself is covered exhaustively in
// automationRetryGate.test.ts; these confirm it's actually reached from
// resolveStageSchedule/checkEligibility with the right per-stage_key scoping.

Deno.test("morning_suite: recent timeout attempt within cooldown → skipReason=cooldown, not re-queued", () => {
  const stage = nightBeforeStage({ stage_key: "morning_suite", guest_flag_column: "msg_morning_suite_sent" });
  const guest = suiteGuest({
    arrival_date: SAT,
    automation_retry_state: {
      morning_suite: { count: 1, lastAttemptAt: israelInstant(SAT, 9, 55).toISOString(), processing: false },
    },
  });
  const result = resolveStageSchedule(stage, guest, israelInstant(SAT, 10, 0));
  assertEquals(result.dueNow, false);
  assertEquals(result.skipReason, "cooldown");
});

Deno.test("morning_suite: 4th failed attempt logged → exhausted, even though flag was never stamped", () => {
  const stage = nightBeforeStage({ stage_key: "morning_suite", guest_flag_column: "msg_morning_suite_sent" });
  const guest = suiteGuest({
    arrival_date: SAT,
    msg_morning_suite_sent: false,
    automation_retry_state: {
      morning_suite: { count: 4, lastAttemptAt: israelInstant(SAT, 6, 0).toISOString(), processing: false },
    },
  });
  const result = resolveStageSchedule(stage, guest, israelInstant(SAT, 14, 0));
  assertEquals(result.dueNow, false);
  assertEquals(result.skipReason, "exhausted");
});

Deno.test("retry state is scoped per stage_key — a cooldown on morning_suite does not block night_before for the same guest", () => {
  const stage = nightBeforeStage(); // stage_key: "night_before"
  const guest = suiteGuest({
    arrival_date: SAT,
    automation_retry_state: {
      morning_suite: { count: 1, lastAttemptAt: israelInstant(FRI, 15, 4).toISOString(), processing: false },
    },
  });
  const result = resolveStageSchedule(stage, guest, israelInstant(FRI, 15, 5));
  assertEquals(result.dueNow, true);
  assertEquals(result.skipReason, null);
});

Deno.test("no prior attempts (fresh guest) → retry gate never fires, normal dueNow behavior unchanged", () => {
  const stage = nightBeforeStage();
  const guest = suiteGuest({ arrival_date: SAT });
  const result = resolveStageSchedule(stage, guest, israelInstant(FRI, 15, 5));
  assertEquals(result.dueNow, true);
  assertEquals(result.skipReason, null);
});

Deno.test("an in-flight (processing) claim → skipReason=in_flight, cron must not double-dispatch", () => {
  const stage = nightBeforeStage({ stage_key: "morning_suite", guest_flag_column: "msg_morning_suite_sent" });
  const guest = suiteGuest({
    arrival_date: SAT,
    automation_retry_state: {
      morning_suite: { count: 0, lastAttemptAt: israelInstant(SAT, 9, 59).toISOString(), processing: true },
    },
  });
  const result = resolveStageSchedule(stage, guest, israelInstant(SAT, 10, 0));
  assertEquals(result.dueNow, false);
  assertEquals(result.skipReason, "in_flight");
});

// ── Guest bot reliability sprint (2026-07-18) ────────────────────────────────

Deno.test("isInstantAmenityOpsDispatch: ice → true; maintenance → false", () => {
  assertEquals(isInstantAmenityOpsDispatch("אפשר עוד קרח לחדר"), true);
  assertEquals(isInstantAmenityOpsDispatch("need ice please"), true);
  assertEquals(isInstantAmenityOpsDispatch("יש תקלה במזגן"), false);
  assertEquals(isInstantAmenityOpsDispatch("צריך ניקיון בחדר"), false);
});

Deno.test("isDiningQuestion: food / room-service asks", () => {
  assertEquals(isDiningQuestion("יש אוכל בערב?"), true);
  assertEquals(isDiningQuestion("אפשר להזמין לחדר?"), true);
  assertEquals(isDiningQuestion("מתי המסעדה פתוחה?"), true);
  assertEquals(isDiningQuestion("מה שעות הצ'ק אין?"), false);
});

Deno.test("isMealDeclineOrApology: restaurant cancellation threads", () => {
  assertEquals(isMealDeclineOrApology("מתנצלים, לא נגיע לארוחת ערב"), true);
  assertEquals(isMealDeclineOrApology("שכחתי להודיע שלא נבוא"), true);
  assertEquals(isMealDeclineOrApology("תודה רבה על השהות"), false);
});

Deno.test("buildDiningReply + buildMealDeclineAck are complete messages", () => {
  const dining = buildDiningReply({ hotel_restaurant_hours: "07:00–22:00" });
  assertEquals(looksLikeDiningHoursReply(dining), true);
  assertEquals(isReplyObviouslyTruncated(dining), false);
  const meal = buildMealDeclineAck("דני");
  assertEquals(meal.includes("דני"), true);
  assertEquals(isReplyObviouslyTruncated(meal), false);
});

Deno.test("isReplyObviouslyTruncated: live samples #6 #7 + audit false-positives", () => {
  assertEquals(
    isReplyObviouslyTruncated(
      "שמח לעזור 🙏 מסעדת ערמונים פתוחה בימי חול, ובשבתות וחגים החל מה",
    ),
    true,
  );
  assertEquals(
    isReplyObviouslyTruncated("הכל בסדר גמור, תודה שעדכנתם 🙏 אנחנו כאן לכל דבר ובין"),
    true,
  );
  assertEquals(
    isReplyObviouslyTruncated("קיבלנו את הבקשה שלך, הצוות שלנו בודק ומטפל בה כעת 🙏"),
    false,
  );
  assertEquals(endsWithMidWordHebrewCut("אנחנו כאן לכל דבר ושתצטר"), true);
  assertEquals(endsWithMidWordHebrewCut("אנחנו כאן לכל דבר ושתצטרכו"), false);
});

Deno.test("resolveTruncatedReplyFallback: dining + check-in policy paths", () => {
  const cfg = { hotel_restaurant_hours: "07:00–22:00", hotel_checkin_time: "15:00" };
  const diningGuest = "יש אוכל בערב?";
  const truncatedDining = "מסעדת ערמונים פתוחה בימי חול, ובשבתות וחגים החל מה";
  const fallback = resolveTruncatedReplyFallback(
    truncatedDining,
    diningGuest,
    cfg,
    "2026-07-20",
    "generic handoff",
  );
  assertEquals(looksLikeDiningHoursReply(fallback), true);
  assertEquals(isReplyObviouslyTruncated(fallback), false);
});

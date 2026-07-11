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
  shouldAutoPromoteToCheckedIn,
  resolveEffectiveGuestStatus,
  isDepartureAssistRequest,
  isInformationalGuestQuery,
  isSensitiveStayChangeRequest,
  isRequestSummaryGrounded,
  buildDepartureAssistSummary,
  extractAllowlistedRequestLines,
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

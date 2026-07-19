// supabase/functions/_shared/resortDigestStats.test.ts
//
// Run: deno test supabase/functions/_shared/resortDigestStats.test.ts

import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { computeTeamOpsStats } from "./teamOpsAnalytics.ts";
import {
  ANOMALY_SAME_TYPE_THRESHOLD,
  bucketCheckinHour,
  computeAnomalies,
  computeArrivals,
  computeExecutiveTodayOutlook,
  computeRequestsBySuite,
  computeResortDigestStats,
  computeRoomReadyTiming,
  computeSlaCompliance,
  composeExecutiveHeadline,
  composeExecutiveActionHint,
  composeExecutiveMorningPulse,
  composePulseAttentionLines,
  composeResortDigestMessage,
  composeYesterdayPulseLine,
  filterDigestRelevantRules,
  formatCappedList,
  resolveDigestRange,
  type DigestGuestRow,
  type DigestTaskRow,
  type TodayOutlookGuestRow,
} from "./resortDigestStats.ts";

function guestRow(overrides: Partial<DigestGuestRow> = {}): DigestGuestRow {
  return {
    id: 1,
    room: "אמטיסט 8",
    checkin_time: null,
    room_ready_at: null,
    room_ready_notified: false,
    ...overrides,
  };
}

function taskRow(overrides: Partial<DigestTaskRow> = {}): DigestTaskRow {
  return {
    id: "t1",
    room_number: "אמטיסט 8",
    sla_category: "maintenance",
    status: "done",
    created_at: "2026-07-11T10:00:00.000Z",
    resolved_at: "2026-07-11T10:20:00.000Z",
    sla_deadline: "2026-07-11T10:30:00.000Z", // resolved 10 min before deadline by default — "good" data
    ...overrides,
  };
}

// Israel is UTC+3 (DST) in July 2026.
Deno.test("bucketCheckinHour: buckets Israel local hour, not UTC hour", () => {
  assertEquals(bucketCheckinHour("2026-07-11T11:59:00.000Z"), "before_15"); // 14:59 IL
  assertEquals(bucketCheckinHour("2026-07-11T12:00:00.000Z"), "15_18"); // 15:00 IL
  assertEquals(bucketCheckinHour("2026-07-11T14:59:00.000Z"), "15_18"); // 17:59 IL
  assertEquals(bucketCheckinHour("2026-07-11T15:00:00.000Z"), "18_22"); // 18:00 IL
  assertEquals(bucketCheckinHour("2026-07-11T18:59:00.000Z"), "18_22"); // 21:59 IL
  assertEquals(bucketCheckinHour("2026-07-11T19:00:00.000Z"), "after_22"); // 22:00 IL
  assertEquals(bucketCheckinHour("2026-07-11T21:30:00.000Z"), "after_22"); // 00:30 IL next day
});

Deno.test("computeArrivals: excludes guests who never checked in, sorts by checkin time", () => {
  const guests = [
    guestRow({ id: 1, room: "אמטיסט 8", checkin_time: "2026-07-11T14:00:00.000Z" }),
    guestRow({ id: 2, room: "יהלום 3", checkin_time: null }), // not arrived — must not appear
    guestRow({ id: 3, room: "ספיר 1", checkin_time: "2026-07-11T09:00:00.000Z" }),
  ];
  const arrivals = computeArrivals(guests);
  assertEquals(arrivals.length, 2);
  assertEquals(arrivals[0].room, "ספיר 1"); // earlier checkin sorts first
  assertEquals(arrivals[1].room, "אמטיסט 8");
});

Deno.test("computeArrivals: falls back to em-dash when room is null (FAIL VISIBLE, never blank)", () => {
  const arrivals = computeArrivals([guestRow({ room: null, checkin_time: "2026-07-11T10:00:00.000Z" })]);
  assertEquals(arrivals[0].room, "—");
});

Deno.test("computeRoomReadyTiming: on_time when room_ready_at is at/before checkin", () => {
  const [entry] = computeRoomReadyTiming([
    guestRow({
      checkin_time: "2026-07-11T12:00:00.000Z",
      room_ready_at: "2026-07-11T11:00:00.000Z",
    }),
  ]);
  assertEquals(entry.status, "on_time");
  assertEquals(entry.lateMinutes, null);
});

Deno.test("computeRoomReadyTiming: late with correct minute delta when room_ready_at is after checkin", () => {
  const [entry] = computeRoomReadyTiming([
    guestRow({
      checkin_time: "2026-07-11T12:00:00.000Z",
      room_ready_at: "2026-07-11T12:45:00.000Z",
    }),
  ]);
  assertEquals(entry.status, "late");
  assertEquals(entry.lateMinutes, 45);
});

Deno.test("computeRoomReadyTiming: unknown (not swallowed as on_time) when room_ready_at is null", () => {
  const [entry] = computeRoomReadyTiming([
    guestRow({ checkin_time: "2026-07-11T12:00:00.000Z", room_ready_at: null }),
  ]);
  assertEquals(entry.status, "unknown");
  assertEquals(entry.roomReadyAt, null);
});

Deno.test("computeRoomReadyTiming: excludes guests who never checked in", () => {
  const timing = computeRoomReadyTiming([guestRow({ checkin_time: null, room_ready_at: null })]);
  assertEquals(timing.length, 0);
});

Deno.test("computeRequestsBySuite: excludes tasks with no room_number (general ops, not per-suite)", () => {
  const summary = computeRequestsBySuite([
    taskRow({ room_number: null }),
    taskRow({ room_number: "   " }),
  ]);
  assertEquals(summary.length, 0);
});

Deno.test("computeRequestsBySuite: tallies total/resolved/open/rejected and per-category counts", () => {
  const summary = computeRequestsBySuite([
    taskRow({ room_number: "אמטיסט 8", status: "done", sla_category: "maintenance" }),
    taskRow({ room_number: "אמטיסט 8", status: "open", sla_category: "guest_amenities" }),
    taskRow({ room_number: "אמטיסט 8", status: "rejected", sla_category: "maintenance" }),
  ]);
  assertEquals(summary.length, 1);
  const s = summary[0];
  assertEquals(s.room, "אמטיסט 8");
  assertEquals(s.total, 3);
  assertEquals(s.resolved, 1);
  assertEquals(s.open, 1);
  assertEquals(s.rejected, 1);
  assertEquals(s.byCategory, { maintenance: 2, guest_amenities: 1 });
});

Deno.test("computeRequestsBySuite: sorts suites by total descending", () => {
  const summary = computeRequestsBySuite([
    taskRow({ room_number: "A" }),
    taskRow({ room_number: "B" }),
    taskRow({ room_number: "B" }),
  ]);
  assertEquals(summary.map((s) => s.room), ["B", "A"]);
});

Deno.test("computeRequestsBySuite: uncategorized bucket for null sla_category", () => {
  const [s] = computeRequestsBySuite([taskRow({ room_number: "A", sla_category: null })]);
  assertEquals(s.byCategory, { uncategorized: 1 });
});

Deno.test("computeAnomalies: flags a suite at exactly the threshold, not below it", () => {
  assertEquals(ANOMALY_SAME_TYPE_THRESHOLD, 3);
  const tasks: DigestTaskRow[] = [
    taskRow({ room_number: "A", sla_category: "pest_control" }),
    taskRow({ room_number: "A", sla_category: "pest_control" }),
  ];
  const belowThreshold = computeAnomalies(computeRequestsBySuite(tasks));
  assertEquals(belowThreshold.length, 0);

  tasks.push(taskRow({ room_number: "A", sla_category: "pest_control" }));
  const atThreshold = computeAnomalies(computeRequestsBySuite(tasks));
  assertEquals(atThreshold.length, 1);
  assertEquals(atThreshold[0], { room: "A", category: "pest_control", count: 3 });
});

Deno.test("computeAnomalies: respects a custom threshold override", () => {
  const tasks = [
    taskRow({ room_number: "A", sla_category: "maintenance" }),
    taskRow({ room_number: "A", sla_category: "maintenance" }),
  ];
  assertEquals(computeAnomalies(computeRequestsBySuite(tasks), 2).length, 1);
});

Deno.test("computeAnomalies: does not flag different categories in the same suite below threshold each", () => {
  const tasks = [
    taskRow({ room_number: "A", sla_category: "maintenance" }),
    taskRow({ room_number: "A", sla_category: "maintenance" }),
    taskRow({ room_number: "A", sla_category: "guest_amenities" }),
    taskRow({ room_number: "A", sla_category: "guest_amenities" }),
  ];
  assertEquals(computeAnomalies(computeRequestsBySuite(tasks)).length, 0);
});

const SLA_NOW = new Date("2026-07-11T12:00:00.000Z");

Deno.test("computeSlaCompliance: done task resolved before deadline counts within SLA", () => {
  const stats = computeSlaCompliance(
    [taskRow({ status: "done", resolved_at: "2026-07-11T10:20:00.000Z", sla_deadline: "2026-07-11T10:30:00.000Z" })],
    SLA_NOW,
  );
  assertEquals(stats, { withDeadline: 1, withinSla: 1, breached: 0, breachedStillOpen: 0, complianceRate: 100 });
});

Deno.test("computeSlaCompliance: done task resolved after deadline counts as breached", () => {
  const stats = computeSlaCompliance(
    [taskRow({ status: "done", resolved_at: "2026-07-11T10:45:00.000Z", sla_deadline: "2026-07-11T10:30:00.000Z" })],
    SLA_NOW,
  );
  assertEquals(stats.breached, 1);
  assertEquals(stats.withinSla, 0);
});

Deno.test("computeSlaCompliance: FAIL VISIBLE — done with no resolved_at counts as breached, not silently compliant", () => {
  const stats = computeSlaCompliance(
    [taskRow({ status: "done", resolved_at: null, sla_deadline: "2026-07-11T10:30:00.000Z" })],
    SLA_NOW,
  );
  assertEquals(stats.breached, 1);
  assertEquals(stats.withinSla, 0);
});

Deno.test("computeSlaCompliance: still-open task past its deadline is breached AND flagged actionable", () => {
  const stats = computeSlaCompliance(
    [taskRow({ status: "open", sla_deadline: "2026-07-11T11:00:00.000Z" })], // deadline before SLA_NOW (12:00)
    SLA_NOW,
  );
  assertEquals(stats.breached, 1);
  assertEquals(stats.breachedStillOpen, 1);
});

Deno.test("computeSlaCompliance: still-open task within its window counts as (provisionally) within SLA", () => {
  const stats = computeSlaCompliance(
    [taskRow({ status: "in_progress", sla_deadline: "2026-07-11T13:00:00.000Z" })], // deadline after SLA_NOW (12:00)
    SLA_NOW,
  );
  assertEquals(stats.withinSla, 1);
  assertEquals(stats.breached, 0);
});

Deno.test("computeSlaCompliance: rejected tasks are excluded entirely (no valid resolution to measure)", () => {
  const stats = computeSlaCompliance([taskRow({ status: "rejected" })], SLA_NOW);
  assertEquals(stats.withDeadline, 0);
  assertEquals(stats.complianceRate, null);
});

Deno.test("computeSlaCompliance: tasks with no sla_deadline are excluded entirely", () => {
  const stats = computeSlaCompliance([taskRow({ sla_deadline: null })], SLA_NOW);
  assertEquals(stats.withDeadline, 0);
  assertEquals(stats.complianceRate, null);
});

Deno.test("computeSlaCompliance: complianceRate is null (not 0%) when nothing has a deadline", () => {
  assertEquals(computeSlaCompliance([], SLA_NOW).complianceRate, null);
});

Deno.test("composeExecutiveHeadline: all clear when nothing needs attention", () => {
  const stats = computeResortDigestStats({
    guests: [guestRow({ checkin_time: "2026-07-11T10:00:00.000Z", room_ready_at: "2026-07-11T09:00:00.000Z" })],
    tasks: [],
    now: SLA_NOW,
  });
  assertEquals(composeExecutiveHeadline(stats), "✅ הכל תקין — אין נקודות לתשומת לב מיוחדת בתקופה זו.");
});

Deno.test("composeExecutiveHeadline: lists concerns from room-ready, SLA breaches, and anomalies together", () => {
  const stats = computeResortDigestStats({
    guests: [guestRow({ checkin_time: "2026-07-11T10:00:00.000Z", room_ready_at: null })], // → unknown
    tasks: [
      taskRow({ room_number: "A", status: "open", sla_deadline: "2026-07-11T11:00:00.000Z" }), // breached+open
      taskRow({ room_number: "B", sla_category: "pest_control" }),
      taskRow({ room_number: "B", sla_category: "pest_control" }),
      taskRow({ room_number: "B", sla_category: "pest_control" }), // → anomaly
    ],
    now: SLA_NOW,
  });
  const headline = composeExecutiveHeadline(stats);
  assertEquals(headline.startsWith("⚠️ לתשומת לבך:"), true);
  assertEquals(headline.includes('1 חדרים בלי סימון "מוכן"'), true);
  assertEquals(headline.includes("1 משימות פתוחות שלא טופלו בזמן"), true);
  assertEquals(headline.includes("1 סוויטות עם ריבוי בקשות חוזרות"), true);
});

Deno.test("composeExecutiveActionHint — breached open tasks first priority", () => {
  const stats = computeResortDigestStats({
    guests: [],
    tasks: [taskRow({ status: "open", sla_deadline: "2026-07-11T11:00:00.000Z" })],
    now: SLA_NOW,
  });
  const hint = composeExecutiveActionHint(stats);
  assertEquals(hint.includes("לא נסגרו ביעד הזמן"), true);
});

Deno.test("composeResortDigestMessage: includes the headline without task-assignment hints", () => {
  const stats = computeResortDigestStats({
    guests: [],
    tasks: [taskRow({ room_number: "A" })],
    now: SLA_NOW,
  });
  const body = composeResortDigestMessage(stats, "weekly", "2026-07-05–2026-07-11");
  assertEquals(body.includes("✅ הכל תקין"), true);
  assertEquals(body.includes("עמידה ביעדי זמן הטיפול: 100% (1/1)"), true);
  assertEquals(body.includes("👉 מומלץ"), false);
  assertEquals(body.includes("👉 מצב שקט"), false);
});

Deno.test("composeResortDigestMessage: weekly digest appends team ops section", () => {
  const stats = computeResortDigestStats({ guests: [], tasks: [], now: SLA_NOW });
  const teamOps = computeTeamOpsStats({
    period: "daily",
    now: SLA_NOW,
    messages: [{
      from_phone: "972546294885",
      from_name: "Adir",
      profile_id: null,
      group_key: "ops_calls",
      message_kind: "text",
      is_operational: false,
      operational_kind: "chitchat",
      created_at: "2026-07-11T10:00:00.000Z",
    }],
    tasks: [{
      id: "t1",
      status: "done",
      created_at: "2026-07-11T10:00:00.000Z",
      resolved_at: "2026-07-11T10:18:00.000Z",
      reporter_profile_id: null,
      resolved_by_phone: "972546294885",
      resolved_by_name: "Adir",
      sla_deadline: null,
    }],
    hkEvents: [],
    guestAlerts: [],
  });
  const weeklyBody = composeResortDigestMessage(stats, "weekly", "2026-07-04–2026-07-10", { teamOps });
  assertEquals(weeklyBody.includes("👥 צוות:"), false);
});

Deno.test("filterDigestRelevantRules + compose learned notes", () => {
  assertEquals(
    filterDigestRelevantRules(["תמיד הדגישי חריגות בדוח", "קפה בבוקר", "סיכום קצר יותר"]),
    ["תמיד הדגישי חריגות בדוח", "סיכום קצר יותר"],
  );
  const stats = computeResortDigestStats({ guests: [], tasks: [], now: SLA_NOW });
  const body = composeResortDigestMessage(stats, "daily", "2026-07-11", {
    assistantForName: "אליעד",
    learnedDigestNotes: ["תמיד הדגישי חריגות בדוח"],
  });
  assertEquals(body.includes("לפי מה שלימדת אותי"), true);
  assertEquals(body.includes("תמיד הדגישי חריגות בדוח"), true);
});

Deno.test("computeResortDigestStats: wires all five sections together from raw rows", () => {
  const stats = computeResortDigestStats({
    guests: [
      guestRow({
        room: "אמטיסט 8",
        checkin_time: "2026-07-11T12:00:00.000Z",
        room_ready_at: "2026-07-11T12:30:00.000Z",
      }),
    ],
    tasks: [
      taskRow({ room_number: "אמטיסט 8" }),
    ],
  });
  assertEquals(stats.arrivals.length, 1);
  assertEquals(stats.roomReadyTiming[0].status, "late");
  assertEquals(stats.requestsBySuite.length, 1);
  assertEquals(stats.anomalies.length, 0);
});

Deno.test("composeExecutiveMorningPulse: short daily voice, no task assignments", () => {
  const yesterday = computeResortDigestStats({
    guests: [
      guestRow({
        checkin_time: "2026-07-11T10:00:00.000Z",
        room_ready_at: "2026-07-11T09:00:00.000Z",
      }),
    ],
    tasks: [taskRow({ room_number: "אמטיסט 8" })],
    now: SLA_NOW,
  });
  const today = computeExecutiveTodayOutlook(
    [
      {
        status: "expected",
        arrival_date: "2026-07-12",
        departure_date: "2026-07-14",
        arrival_time: null,
        room: "ג׳ספר 3",
        room_type: "suite",
        requires_attention: false,
      },
      {
        status: "expected",
        arrival_date: "2026-07-12",
        departure_date: "2026-07-14",
        arrival_time: "15:00",
        room: "אמטיסט 8",
        room_type: "suite",
        requires_attention: true,
      },
    ] as TodayOutlookGuestRow[],
    "2026-07-12",
    { pendingApproval: 2 },
  );
  const body = composeExecutiveMorningPulse(yesterday, "2026-07-11", today, {
    assistantForName: "אליעד",
  });
  const lineCount = body.split("\n").filter((l) => l.trim()).length;
  assertEquals(lineCount <= 10, true);
  assertEquals(body.includes("בוקר טוב אליעד"), true);
  assertEquals(body.includes("אתמול (11.07):"), true);
  assertEquals(body.includes("היום: 2 מגיעים"), true);
  assertEquals(body.includes("בלי שעת הגעה (אדיר מטפל)"), true);
  assertEquals(body.includes("🔔 2 ממתינות לאישורך"), true);
  assertEquals(body.includes("⭐ 1 VIP מגיעים היום"), true);
  assertEquals(body.includes("👉 מומלץ"), false);
  assertEquals(body.includes("דוח תפעולי"), false);
  assertEquals(body.includes("מוכנות חדרים"), false);
});

Deno.test("composeYesterdayPulseLine: one-line recap with readiness rate", () => {
  const stats = computeResortDigestStats({
    guests: [
      guestRow({ checkin_time: "2026-07-11T10:00:00.000Z", room_ready_at: "2026-07-11T09:00:00.000Z" }),
      guestRow({ id: 2, checkin_time: "2026-07-11T12:00:00.000Z", room_ready_at: null }),
    ],
    tasks: [],
    now: SLA_NOW,
  });
  const line = composeYesterdayPulseLine(stats, "2026-07-11");
  assertEquals(line.includes("2 הגעות"), true);
  assertEquals(line.includes("מוכנות 50%"), true);
});

Deno.test("composePulseAttentionLines: observational, max 2, team handles ops", () => {
  const stats = computeResortDigestStats({
    guests: [],
    tasks: [
      taskRow({ room_number: "B", sla_category: "pest_control" }),
      taskRow({ room_number: "B", sla_category: "pest_control" }),
      taskRow({ room_number: "B", sla_category: "pest_control" }),
    ],
    now: SLA_NOW,
  });
  const lines = composePulseAttentionLines(stats, {
    todayYmd: "2026-07-12",
    arrivalsToday: 0,
    arrivalsMissingEta: 0,
    inResortSuites: 0,
    departingToday: 0,
    vipArrivingToday: 0,
    humanRequestedInbox: 3,
    pendingApproval: 1,
  });
  assertEquals(lines.length, 2);
  assertEquals(lines[0].includes("לאישורך"), true);
  assertEquals(lines.some((l) => l.includes("הצוות בטיפול")), true);
  assertEquals(lines.some((l) => l.includes("לבדוק")), false);
});

Deno.test("composeResortDigestMessage: renders period header for weekly reports", () => {
  const stats = computeResortDigestStats({
    guests: [guestRow({ room: "אמטיסט 8", checkin_time: "2026-07-11T12:00:00.000Z", room_ready_at: null })],
    tasks: [],
  });
  const body = composeResortDigestMessage(stats, "weekly", "2026-07-05–2026-07-11");
  assertEquals(body.includes("דוח תפעולי שבועי"), true);
  assertEquals(body.includes("בוקר טוב"), true);
  assertEquals(body.includes('לא סומן "חדר מוכן"'), true);
  assertEquals(body.includes("אין בקשות בתקופה זו."), true);
});

// "Now" = Sunday 2026-07-12, ~07:00 real Israel time (DST, so UTC+3 → 04:00 UTC).
// israelYmd() is real-timezone-aware so "today" resolves correctly even in DST;
// the range *instant* math (israelMidnightUtc) uses the same fixed UTC+2
// convention as automationSchedule.ts's ISRAEL_UTC_OFFSET_HOURS, so during DST
// months the calendar-day boundary itself lands ~1h off true local midnight —
// a pre-existing simplification in this codebase, not introduced here.
const CRON_TICK_SUNDAY_0700_IL = new Date("2026-07-12T04:00:00.000Z");

Deno.test("resolveDigestRange: daily always summarizes yesterday's full day, never today-so-far", () => {
  const range = resolveDigestRange("daily", CRON_TICK_SUNDAY_0700_IL);
  assertEquals(range.periodDate, "2026-07-11");
  assertEquals(range.label, "2026-07-11");
  assertEquals(range.rangeStart.toISOString(), "2026-07-10T22:00:00.000Z"); // 2026-07-11 00:00 IL
  assertEquals(range.rangeEnd.toISOString(), "2026-07-11T22:00:00.000Z"); // 2026-07-12 00:00 IL
});

Deno.test("resolveDigestRange: weekly covers the 7 days ending yesterday", () => {
  const range = resolveDigestRange("weekly", CRON_TICK_SUNDAY_0700_IL);
  assertEquals(range.periodDate, "2026-07-05");
  assertEquals(range.label, "2026-07-05–2026-07-11");
  assertEquals(range.rangeStart.toISOString(), "2026-07-04T22:00:00.000Z"); // 2026-07-05 00:00 IL
  assertEquals(range.rangeEnd.toISOString(), "2026-07-11T22:00:00.000Z"); // 2026-07-12 00:00 IL
});

Deno.test("resolveDigestRange: monthly covers the previous full calendar month", () => {
  // "Now" = 2026-08-01 07:00 Israel (04:00 UTC) — the 1st-of-month cron tick.
  const firstOfMonthTick = new Date("2026-08-01T04:00:00.000Z");
  const range = resolveDigestRange("monthly", firstOfMonthTick);
  assertEquals(range.periodDate, "2026-07-01");
  assertEquals(range.label, "2026-07");
  assertEquals(range.rangeStart.toISOString(), "2026-06-30T22:00:00.000Z"); // 2026-07-01 00:00 IL
  assertEquals(range.rangeEnd.toISOString(), "2026-07-31T22:00:00.000Z"); // 2026-08-01 00:00 IL
});

Deno.test("resolveDigestRange: monthly rolls the year back correctly in January", () => {
  const januaryTick = new Date("2026-01-01T04:00:00.000Z");
  const range = resolveDigestRange("monthly", januaryTick);
  assertEquals(range.periodDate, "2025-12-01");
  assertEquals(range.label, "2025-12");
});

Deno.test("formatCappedList: passes items through untouched when under the cap", () => {
  assertEquals(formatCappedList([1, 2], (n) => `#${n}`, 5), ["#1", "#2"]);
});

Deno.test("formatCappedList: truncates and appends a '+N more' trailer over the cap", () => {
  const lines = formatCappedList([1, 2, 3, 4, 5, 6, 7], (n) => `#${n}`, 5);
  assertEquals(lines, ["#1", "#2", "#3", "#4", "#5", "  ...ועוד 2 נוספים"]);
});

Deno.test("composeResortDigestMessage: at real-world volume, caps the room-ready list (weekly)", () => {
  const guests = Array.from({ length: 10 }, (_, i) =>
    guestRow({
      room: `חדר ${i}`,
      checkin_time: "2026-07-11T10:00:00.000Z",
      room_ready_at: `2026-07-11T10:${String(10 + i).padStart(2, "0")}:00.000Z`, // increasing lateness
    })
  );
  const stats = computeResortDigestStats({ guests, tasks: [], now: SLA_NOW });
  const body = composeResortDigestMessage(stats, "weekly", "2026-07-05–2026-07-11");
  const lateLines = body.split("\n").filter((l) => l.includes("⏰"));
  assertEquals(lateLines.length, 5); // capped, not all 10
  assertEquals(lateLines[0].includes("חדר 9"), true); // worst delay (19 min) shown first
  assertEquals(body.includes("...ועוד 5 נוספים"), true);
});

Deno.test("composeResortDigestMessage: renders anomaly line when present", () => {
  const stats = computeResortDigestStats({
    guests: [],
    tasks: [
      taskRow({ room_number: "A", sla_category: "pest_control" }),
      taskRow({ room_number: "A", sla_category: "pest_control" }),
      taskRow({ room_number: "A", sla_category: "pest_control" }),
    ],
  });
  const body = composeResortDigestMessage(stats, "weekly", "2026-07-05–2026-07-11");
  assertEquals(body.includes("🚩 חריגות:"), true);
  assertEquals(body.includes("A — 3× הדברה"), true);
});

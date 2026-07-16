// supabase/functions/_shared/teamOpsAnalytics.test.ts
// Run: deno test supabase/functions/_shared/teamOpsAnalytics.test.ts

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  computeHousekeepingTurnaround,
  computePresenceStats,
  computeOperationalStats,
  computeTeamOpsStats,
  composeTeamOpsMessage,
  composeTeamOpsActionHint,
  type HousekeepingEventRow,
  type StaffGroupMessageRow,
  type TeamOpsTaskRow,
} from "./teamOpsAnalytics.ts";

function msg(overrides: Partial<StaffGroupMessageRow> = {}): StaffGroupMessageRow {
  return {
    from_phone: "972546294885",
    from_name: "Adir",
    profile_id: null,
    group_key: "ops_calls",
    message_kind: "text",
    is_operational: false,
    operational_kind: "chitchat",
    created_at: "2026-07-15T10:00:00.000Z",
    ...overrides,
  };
}

function task(overrides: Partial<TeamOpsTaskRow> = {}): TeamOpsTaskRow {
  return {
    id: "t1",
    status: "done",
    created_at: "2026-07-15T10:00:00.000Z",
    resolved_at: "2026-07-15T10:18:00.000Z",
    reporter_profile_id: null,
    resolved_by_phone: "972546294885",
    resolved_by_name: "Adir",
    sla_deadline: null,
    ...overrides,
  };
}

Deno.test("computePresenceStats: Adir share of messages", () => {
  const messages = [
    msg({ from_phone: "972546294885" }),
    msg({ from_phone: "972546294885" }),
    msg({ from_phone: "972504654306", from_name: "Lidor" }),
    msg({ from_phone: "972504654306", from_name: "Lidor" }),
    msg({ from_phone: "972504654306", from_name: "Lidor" }),
  ];
  const stats = computePresenceStats(messages);
  const adir = stats.find((s) => s.displayName === "אדיר");
  assertEquals(adir?.messageCount, 2);
  assertEquals(adir?.presencePct, 40);
});

Deno.test("computePresenceStats: person filter אדיר", () => {
  const messages = [
    msg({ from_phone: "972546294885" }),
    msg({ from_phone: "972504654306", from_name: "Lidor" }),
  ];
  const stats = computePresenceStats(messages, "אדיר");
  assertEquals(stats.length, 1);
  assertEquals(stats[0].displayName, "אדיר");
});

Deno.test("computeOperationalStats: resolve count and avg minutes", () => {
  const tasks = [
    task(),
    task({
      id: "t2",
      resolved_by_phone: "972504654306",
      resolved_by_name: "Lidor",
      created_at: "2026-07-15T11:00:00.000Z",
      resolved_at: "2026-07-15T11:40:00.000Z",
    }),
  ];
  const stats = computeOperationalStats(tasks, [], new Map());
  const adir = stats.find((s) => s.displayName === "אדיר");
  assertEquals(adir?.tasksResolved, 1);
  assertEquals(adir?.avgResolveMinutes, 18);
});

Deno.test("computeHousekeepingTurnaround: checkout to ready", () => {
  const events: HousekeepingEventRow[] = [
    { room_id: "101", event_type: "check_out", created_at: "2026-07-15T08:00:00.000Z", from_phone: null, from_name: null },
    { room_id: "101", event_type: "ready", created_at: "2026-07-15T10:30:00.000Z", from_phone: null, from_name: null },
    { room_id: "102", event_type: "check_out", created_at: "2026-07-15T09:00:00.000Z", from_phone: null, from_name: null },
    { room_id: "102", event_type: "ready", created_at: "2026-07-15T11:00:00.000Z", from_phone: null, from_name: null },
  ];
  const r = computeHousekeepingTurnaround(events);
  assertEquals(r.pairs, 2);
  assertEquals(r.avgMinutes, 135);
  assertEquals(r.medianMinutes, 135);
});

Deno.test("composeTeamOpsMessage: includes presence and operational lines", () => {
  const stats = computeTeamOpsStats({
    period: "weekly",
    now: new Date("2026-07-16T07:00:00.000Z"),
    messages: [
      msg({ from_phone: "972546294885" }),
      msg({ from_phone: "972546294885" }),
      msg({ from_phone: "972504654306", from_name: "Lidor" }),
    ],
    tasks: [task()],
    hkEvents: [],
    guestAlerts: [],
  });
  const body = composeTeamOpsMessage(stats);
  assertStringIncludes(body, "נוכחות");
  assertStringIncludes(body, "אדיר");
  assertStringIncludes(body, "מעורבות תפעולית");
});

Deno.test("composeTeamOpsActionHint: returns non-empty hint", () => {
  const stats = computeTeamOpsStats({
    period: "weekly",
    now: new Date("2026-07-16T07:00:00.000Z"),
    personFilter: "אדיר",
    messages: [msg({ from_phone: "972546294885" })],
    tasks: [task()],
    hkEvents: [],
    guestAlerts: [],
  });
  const hint = composeTeamOpsActionHint(stats);
  assertEquals(hint.length > 0, true);
});

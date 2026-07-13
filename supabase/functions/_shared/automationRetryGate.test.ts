// supabase/functions/_shared/automationRetryGate.test.ts
//
// Run: deno test supabase/functions/_shared/automationRetryGate.test.ts

import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  buildRetryStateMap,
  evaluateRetryGate,
  RETRY_COOLDOWN_MINUTES,
  RETRY_MAX_ATTEMPTS,
  type RetryAttemptRow,
} from "./automationRetryGate.ts";

const NOW = new Date("2026-07-13T12:00:00.000Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60000).toISOString();

Deno.test("evaluateRetryGate: no state → null (never attempted)", () => {
  assertEquals(evaluateRetryGate(undefined, NOW), null);
});

Deno.test("evaluateRetryGate: recent failure, under max attempts → cooldown", () => {
  const state = { count: 1, lastAttemptAt: minutesAgo(5), processing: false };
  assertEquals(evaluateRetryGate(state, NOW), "cooldown");
});

Deno.test("evaluateRetryGate: failure past cooldown window, under max attempts → null (allowed to retry)", () => {
  const state = { count: 1, lastAttemptAt: minutesAgo(RETRY_COOLDOWN_MINUTES + 1), processing: false };
  assertEquals(evaluateRetryGate(state, NOW), null);
});

Deno.test("evaluateRetryGate: exactly at max attempts → exhausted, even if cooldown has elapsed", () => {
  const state = { count: RETRY_MAX_ATTEMPTS, lastAttemptAt: minutesAgo(RETRY_COOLDOWN_MINUTES + 60), processing: false };
  assertEquals(evaluateRetryGate(state, NOW), "exhausted");
});

Deno.test("evaluateRetryGate: exhausted takes priority over a cooldown-eligible timestamp", () => {
  const state = { count: RETRY_MAX_ATTEMPTS + 2, lastAttemptAt: minutesAgo(1), processing: false };
  assertEquals(evaluateRetryGate(state, NOW), "exhausted");
});

Deno.test("evaluateRetryGate: a live processing (claim) row → in_flight, regardless of count/cooldown", () => {
  const state = { count: 0, lastAttemptAt: minutesAgo(1), processing: true };
  assertEquals(evaluateRetryGate(state, NOW), "in_flight");
});

Deno.test("evaluateRetryGate: in_flight takes priority even once max attempts already reached", () => {
  const state = { count: RETRY_MAX_ATTEMPTS, lastAttemptAt: minutesAgo(1), processing: true };
  assertEquals(evaluateRetryGate(state, NOW), "in_flight");
});

Deno.test("buildRetryStateMap: counts timeout+failed, ignores sent/simulated, tracks latest sent_at per key", () => {
  const rows: RetryAttemptRow[] = [
    { guest_id: 1, trigger_type: "morning_suite", status: "timeout", sent_at: minutesAgo(40) },
    { guest_id: 1, trigger_type: "morning_suite", status: "failed", sent_at: minutesAgo(10) },
    { guest_id: 1, trigger_type: "morning_suite", status: "sent", sent_at: minutesAgo(5) },
    { guest_id: 2, trigger_type: "night_before", status: "failed", sent_at: minutesAgo(2) },
  ];
  const map = buildRetryStateMap(rows);
  const g1 = map.get("1::morning_suite");
  assertEquals(g1?.count, 2);
  assertEquals(g1?.lastAttemptAt, minutesAgo(10));
  assertEquals(g1?.processing, false);
  assertEquals(map.get("2::night_before")?.count, 1);
  assertEquals(map.has("1::night_before"), false);
});

Deno.test("buildRetryStateMap: blocked_by_meta counts toward exhaustion too (2026-07-12 day-pass template-rejection loop is the same failure class)", () => {
  const rows: RetryAttemptRow[] = [
    { guest_id: 8, trigger_type: "pre_arrival_2d", status: "blocked_by_meta", sent_at: minutesAgo(3) },
    { guest_id: 8, trigger_type: "pre_arrival_2d", status: "blocked_by_meta", sent_at: minutesAgo(2) },
  ];
  const map = buildRetryStateMap(rows);
  assertEquals(map.get("8::pre_arrival_2d")?.count, 2);
});

Deno.test("buildRetryStateMap: a processing row sets processing=true without counting toward exhaustion", () => {
  const rows: RetryAttemptRow[] = [
    { guest_id: 3, trigger_type: "pre_arrival_2d", status: "processing", sent_at: minutesAgo(1) },
  ];
  const map = buildRetryStateMap(rows);
  const g3 = map.get("3::pre_arrival_2d");
  assertEquals(g3?.processing, true);
  assertEquals(g3?.count, 0);
});

Deno.test("buildRetryStateMap: retry state is scoped per stage_key — one stage's failures don't affect another", () => {
  const rows: RetryAttemptRow[] = [
    { guest_id: 5, trigger_type: "morning_suite", status: "failed", sent_at: minutesAgo(1) },
  ];
  const map = buildRetryStateMap(rows);
  assertEquals(map.has("5::morning_suite"), true);
  assertEquals(map.has("5::mid_stay"), false);
});

Deno.test("buildRetryStateMap: rows missing guest_id/trigger_type/sent_at are skipped, not thrown", () => {
  const rows: RetryAttemptRow[] = [
    { guest_id: null, trigger_type: "morning_suite", status: "failed", sent_at: minutesAgo(1) },
    { guest_id: 6, trigger_type: null, status: "failed", sent_at: minutesAgo(1) },
    { guest_id: 6, trigger_type: "morning_suite", status: "failed", sent_at: null },
  ];
  const map = buildRetryStateMap(rows);
  assertEquals(map.size, 0);
});

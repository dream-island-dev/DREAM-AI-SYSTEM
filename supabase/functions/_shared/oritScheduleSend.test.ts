// Run: deno test --allow-env supabase/functions/_shared/oritScheduleSend.test.ts

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  defaultOritScheduleInstant,
  formatOritScheduleLabel,
  isOritQuietHours,
  parseOritScheduleFromText,
} from "./oritScheduleSend.ts";

Deno.test("isOritQuietHours: 21:00–05:00 Israel", () => {
  assertEquals(isOritQuietHours(new Date("2026-07-19T21:30:00+03:00")), true);
  assertEquals(isOritQuietHours(new Date("2026-07-19T04:30:00+03:00")), true);
  assertEquals(isOritQuietHours(new Date("2026-07-19T12:00:00+03:00")), false);
  assertEquals(isOritQuietHours(new Date("2026-07-19T20:59:00+03:00")), false);
});

Deno.test("parseOritScheduleFromText: מחר 8", () => {
  const now = new Date("2026-07-19T22:00:00+03:00");
  const parsed = parseOritScheduleFromText("תזמני למחר 8", now);
  assertEquals(parsed !== null, true);
  const label = formatOritScheduleLabel(parsed!.toISOString(), now);
  assertEquals(label.includes("08:00") || label.includes("8:00"), true);
});

Deno.test("defaultOritScheduleInstant: after quiet hours → next morning", () => {
  const now = new Date("2026-07-19T23:00:00+03:00");
  const instant = defaultOritScheduleInstant(now);
  const label = formatOritScheduleLabel(instant.toISOString(), now);
  assertEquals(label.includes("08:00") || label.includes("8:00"), true);
});

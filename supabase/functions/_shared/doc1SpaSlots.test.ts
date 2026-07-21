import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  addSpaSlot,
  formatDoc1SpaSlotsForAi,
  spaSlotsWarningLabel,
} from "./doc1SpaSlots.ts";

Deno.test("addSpaSlot merges same time and sorts", () => {
  let slots = addSpaSlot([], "16:00", 1);
  slots = addSpaSlot(slots, "14:00", 1);
  slots = addSpaSlot(slots, "14:00", 1);
  assertEquals(slots, [
    { time: "14:00", count: 2 },
    { time: "16:00", count: 1 },
  ]);
});

Deno.test("formatDoc1SpaSlotsForAi — two distinct times", () => {
  const line = formatDoc1SpaSlotsForAi(
    [{ time: "14:00", count: 1 }, { time: "16:00", count: 1 }],
    "2026-07-22",
    "14:00",
    2,
  );
  assertEquals(line, "2026-07-22 · 14:00, 16:00");
});

Deno.test("formatDoc1SpaSlotsForAi — same time couple", () => {
  const line = formatDoc1SpaSlotsForAi(
    [{ time: "14:00", count: 2 }],
    "2026-07-22",
    "14:00",
    2,
  );
  assertEquals(line, "2026-07-22 · 14:00 (2 טיפולים)");
});

Deno.test("spaSlotsWarningLabel — multiple hours", () => {
  assertEquals(
    spaSlotsWarningLabel([{ time: "14:00", count: 1 }, { time: "16:00", count: 1 }], 2),
    "⚠ 2 טיפולים · 2 שעות",
  );
});

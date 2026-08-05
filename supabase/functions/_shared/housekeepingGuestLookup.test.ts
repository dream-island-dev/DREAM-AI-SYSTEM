import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { formatAmbiguousGuestHint } from "./housekeepingGuestLookup.ts";

type FakeGuest = { name: string | null; arrival_date: string | null; departure_date: string | null };

Deno.test("formatAmbiguousGuestHint: 2 or fewer candidates — no truncation marker", () => {
  const candidates: FakeGuest[] = [
    { name: "אורח א", arrival_date: "2026-07-28", departure_date: "2026-07-30" },
    { name: "אורח ב", arrival_date: "2026-07-29", departure_date: "2026-07-30" },
  ];
  const hint = formatAmbiguousGuestHint(candidates as never);
  assertEquals(hint, "אורח א (הגעה 2026-07-28, עזיבה 2026-07-30) · אורח ב (הגעה 2026-07-29, עזיבה 2026-07-30)");
});

Deno.test("formatAmbiguousGuestHint: caps at 2 names + remaining count — regression for P0 2026-08-05 12-way wall of text on ג'ספר 3", () => {
  const candidates: FakeGuest[] = Array.from({ length: 12 }, (_, i) => ({
    name: `אורח ${i + 1}`,
    arrival_date: "2026-04-01",
    departure_date: "2026-04-05",
  }));
  const hint = formatAmbiguousGuestHint(candidates as never);
  assertEquals(
    hint,
    "אורח 1 (הגעה 2026-04-01, עזיבה 2026-04-05) · אורח 2 (הגעה 2026-04-01, עזיבה 2026-04-05) · ועוד 10",
  );
});

Deno.test("formatAmbiguousGuestHint: empty list", () => {
  assertEquals(formatAmbiguousGuestHint([]), "");
});

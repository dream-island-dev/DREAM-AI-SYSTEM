import {
  assertEquals,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  buildLateImportFastLanePatch,
  buildPhysicalPresenceArrivalConfirmPatch,
  isLateImportFastLaneEligible,
} from "./lateImportFastLane.ts";

Deno.test("isLateImportFastLaneEligible: today and tomorrow only", () => {
  const now = new Date("2026-08-05T12:00:00+03:00");
  assertEquals(isLateImportFastLaneEligible("2026-08-05", now), true);
  assertEquals(isLateImportFastLaneEligible("2026-08-06", now), true);
  assertEquals(isLateImportFastLaneEligible("2026-08-04", now), false);
  assertEquals(isLateImportFastLaneEligible("2026-08-07", now), false);
});

Deno.test("buildLateImportFastLanePatch: suite guest today → arrival_confirmed", () => {
  const patch = buildLateImportFastLanePatch(
    { arrival_date: "2026-08-05", room_type: "suite" },
    new Date("2026-08-05T10:00:00+03:00"),
  );
  assertEquals(patch?.arrival_confirmed, true);
  assertEquals(typeof patch?.arrival_confirmed_at, "string");
});

Deno.test("buildLateImportFastLanePatch: muted scope → no patch", () => {
  const patch = buildLateImportFastLanePatch(
    { arrival_date: "2026-08-05", automation_scope: "muted" },
    new Date("2026-08-05T10:00:00+03:00"),
  );
  assertEquals(patch, null);
});

Deno.test("buildPhysicalPresenceArrivalConfirmPatch: idempotent when already confirmed", () => {
  const patch = buildPhysicalPresenceArrivalConfirmPatch({
    arrival_confirmed: true,
    arrival_confirmed_at: "2026-08-05T08:00:00.000Z",
  });
  assertEquals(patch, null);
});

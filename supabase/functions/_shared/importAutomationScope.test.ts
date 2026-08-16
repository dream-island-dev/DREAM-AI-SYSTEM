import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  isCorporateMuteCoordName,
  mergeAutomationScope,
  resolveDoc2ImportAutomationScope,
} from "./importAutomationScope.ts";

Deno.test("resolveDoc2ImportAutomationScope: remark group occupant → courtesy_only, not muted (P0 2026-08-10)", () => {
  assertEquals(
    resolveDoc2ImportAutomationScope({ coordNameRaw: "בנק לאומי ועד תיכון", isRemarkGroupOccupant: true }),
    "courtesy_only",
  );
});

Deno.test("resolveDoc2ImportAutomationScope: remark group occupant wins even over a corporate coord name", () => {
  // isRemarkGroupOccupant is checked first — a resolved individual occupant on
  // a corporate-coordinator booking still gets the Stage 4 courtesy check.
  assertEquals(
    resolveDoc2ImportAutomationScope({ coordNameRaw: "עיריית תל אביב", isRemarkGroupOccupant: true }),
    "courtesy_only",
  );
});

Deno.test("resolveDoc2ImportAutomationScope: corporate coord without remark occupant → muted", () => {
  assertEquals(
    resolveDoc2ImportAutomationScope({ coordNameRaw: "עיריית תל אביב", isRemarkGroupOccupant: false }),
    "muted",
  );
});

Deno.test("resolveDoc2ImportAutomationScope: solo individual booking → full", () => {
  assertEquals(
    resolveDoc2ImportAutomationScope({ coordNameRaw: "רחל אופיר", isRemarkGroupOccupant: false }),
    "full",
  );
});

Deno.test("isCorporateMuteCoordName: municipal/bank aliases", () => {
  assertEquals(isCorporateMuteCoordName("עיריית תל אביב"), true);
  assertEquals(isCorporateMuteCoordName("בנק לאומי ועד תיכון"), true);
  assertEquals(isCorporateMuteCoordName("רחל אופיר"), false);
  assertEquals(isCorporateMuteCoordName(null), false);
});

Deno.test("mergeAutomationScope: never loosens an already-muted guest", () => {
  assertEquals(mergeAutomationScope("muted", "full"), "muted");
  assertEquals(mergeAutomationScope("muted", null), "muted");
});

Deno.test("mergeAutomationScope: escalates toward more restrictive", () => {
  assertEquals(mergeAutomationScope("full", "muted"), "muted");
  assertEquals(mergeAutomationScope("full", "courtesy_only"), "courtesy_only");
  assertEquals(mergeAutomationScope("courtesy_only", "muted"), "muted");
});

Deno.test("mergeAutomationScope: full stays full when both full/unset", () => {
  assertEquals(mergeAutomationScope(null, null), "full");
  assertEquals(mergeAutomationScope("full", "full"), "full");
});

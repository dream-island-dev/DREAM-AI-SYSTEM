import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  duplicateCoordNameKeys,
  extractMealTimeFromRemarkText,
  extractNameFromRemarkText,
  extractPhonesFromRemarkText,
  resolveDoc2GuestIdentity,
} from "./ezgoDoc2RemarkIdentity.ts";

Deno.test("extractNameFromRemarkText: single occupant, meal time after phone", () => {
  assertEquals(
    extractNameFromRemarkText("אורטל בנטורה 050-3302020 - א. ערב 20:00 - בעלה חוגג 40"),
    "אורטל בנטורה",
  );
  assertEquals(extractNameFromRemarkText("אנגלמן אמיר 054-7902278 - א. ערב 19:30"), "אנגלמן אמיר");
});

Deno.test("extractNameFromRemarkText: dual occupant — first name pairs with first phone, not a merged blob — P0 2026-08-05 regression", () => {
  const remark = "אורטל בנטורה 050-3302020 / דני כהן 052-1234567";
  assertEquals(extractNameFromRemarkText(remark), "אורטל בנטורה");
  assertEquals(extractPhonesFromRemarkText(remark)[0], "+972503302020");
});

Deno.test("extractNameFromRemarkText: no phone → null (not a name source)", () => {
  assertEquals(extractNameFromRemarkText("חוגגים יום הולדת לפנק"), null);
  assertEquals(extractNameFromRemarkText(""), null);
});

Deno.test("extractMealTimeFromRemarkText: extracts HH:MM from shorthand", () => {
  assertEquals(extractMealTimeFromRemarkText("אורטל בנטורה 050-3302020 - א. ערב 20:00"), "20:00");
  assertEquals(extractMealTimeFromRemarkText("אנגלמן אמיר 054-7902278 - א. ערב 19:30"), "19:30");
});

Deno.test("extractMealTimeFromRemarkText: no shorthand → null", () => {
  assertEquals(extractMealTimeFromRemarkText("חוגגים יום הולדת לפנק"), null);
  assertEquals(extractMealTimeFromRemarkText(""), null);
});

Deno.test("resolveDoc2GuestIdentity: dual-occupant remark still resolves to occupant #1", () => {
  const identity = resolveDoc2GuestIdentity(
    "בנק לאומי ועד תיכון",
    "0502005820",
    "אורטל בנטורה 050-3302020 / דני כהן 052-1234567",
    true,
  );
  assertEquals(identity.guest_name, "אורטל בנטורה");
  assertEquals(identity.phone, "+972503302020");
});

Deno.test("duplicateCoordNameKeys: flags names appearing 2+ times", () => {
  const dupes = duplicateCoordNameKeys(["בנק לאומי", "בנק לאומי", "יחיד"]);
  assertEquals(dupes.has("בנק לאומי"), true);
  assertEquals(dupes.has("יחיד"), false);
});

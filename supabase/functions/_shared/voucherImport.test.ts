// supabase/functions/_shared/voucherImport.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  assessVoucherParseQuality,
  detectVoucherEasygoPreset,
  detectVoucherProviderPreset,
  filterEasygoRowsByProvider,
  findHeaderByAliases,
  matrixRowsFromVoucherHeaderScan,
  normalizeVoucherNumber,
  packageTypesMatch,
  voucherNumbersMatchLocal,
} from "./voucherImport.ts";

Deno.test("normalizeVoucherNumber — strips Excel float, dots, scientific notation", () => {
  assertEquals(normalizeVoucherNumber("9998884321.0"), "9998884321");
  assertEquals(normalizeVoucherNumber("9.998884321E+9"), "9998884321");
  assertEquals(normalizeVoucherNumber("027825629."), "027825629");
  assertEquals(normalizeVoucherNumber("HZ-4821-0007"), "HZ-4821-0007");
});

Deno.test("detectVoucherEasygoPreset — EZGO coupons export (CouponNo)", () => {
  const headers = ["RefType", "CouponNo", "CouponDesc", "מזהה", "שם לקוח", "מחיר", "חברת שוברים", "ת. התחלה", "מס. הזמנה", "טלפון"];
  const preset = detectVoucherEasygoPreset(headers, "Pais Plus");
  assertEquals(preset?.voucherNumber, "CouponNo");
  assertEquals(preset?.packageType, "CouponDesc");
  assertEquals(preset?.guestName, "שם לקוח");
});

Deno.test("detectVoucherEasygoPreset — Nofshonit uses מזהה not CouponNo", () => {
  const headers = ["CouponNo", "CouponDesc", "מזהה", "שם לקוח", "חברת שוברים"];
  const preset = detectVoucherEasygoPreset(headers, "Nofshonit");
  assertEquals(preset?.voucherNumber, "מזהה");
});

Deno.test("detectVoucherProviderPreset — Multi-Pass CSV (שם = voucher id)", () => {
  const headers = ["שם קופון הטבה", "שם", "מחיר פריט", "שווי הטבות", "שם חברה"];
  const rows = [{ "שם": "122421946" }, { "שם": "154065270" }];
  const preset = detectVoucherProviderPreset(headers, rows, "Pais Plus");
  assertEquals(preset?.voucherNumber, "שם");
  assertEquals(preset?.packageType, "שם קופון הטבה");
});

Deno.test("detectVoucherProviderPreset — Nofshonit xlsx", () => {
  const headers = ["שעת מימוש", "ארגון", "מזהה לקוח", "וריאנט", "עסק"];
  const preset = detectVoucherProviderPreset(headers, [], "Nofshonit");
  assertEquals(preset?.voucherNumber, "מזהה לקוח");
  assertEquals(preset?.packageType, "וריאנט");
});

Deno.test("voucherNumbersMatchLocal — suffix_5 Hever/Police", () => {
  assertEquals(voucherNumbersMatchLocal("suffix_5", "34781", "434781"), true);
  assertEquals(voucherNumbersMatchLocal("suffix_5", "70180", "370180"), true);
  assertEquals(voucherNumbersMatchLocal("suffix_5", "11162", "311162"), true);
});

Deno.test("voucherNumbersMatchLocal — exact Nofshonit id leading zeros", () => {
  assertEquals(voucherNumbersMatchLocal("exact", "22616940", "022616940"), true);
});

Deno.test("voucherNumbersMatchLocal — truncate_4 Multi-Pass", () => {
  assertEquals(voucherNumbersMatchLocal("truncate_4", "122421946", "1224219466258"), true);
  assertEquals(voucherNumbersMatchLocal("truncate_4", "154065270", "154065270-8764"), true);
});

Deno.test("packageTypesMatch — classic/deluxe tiers", () => {
  assertEquals(packageTypesMatch("דרים איילנד25-חבילת Deluxe", "פיס פלוס - Dream Deluxe"), true);
  assertEquals(packageTypesMatch("Classic&more lunch", "swish קלאסיק וארוחת צהרים"), true);
  assertEquals(packageTypesMatch("classic&more - ליחיד", "swish קלאסיק וארוחת צהרים 2026"), true);
});

Deno.test("filterEasygoRowsByProvider — scopes by חברת שוברים", () => {
  const rows = [
    { "חברת שוברים": "נופשונית ח.מ תשורות חן (1987) בע\"מ", CouponNo: "1" },
    { "חברת שוברים": "חבר משרתי הקבע והגמלאים בע\"מ", CouponNo: "2" },
  ];
  const filtered = filterEasygoRowsByProvider(rows, "Nofshonit");
  assertEquals(filtered.length, 1);
  assertEquals(filtered[0].CouponNo, "1");
});

Deno.test("matrixRowsFromVoucherHeaderScan — skips title rows", () => {
  const matrix = [
    ["דוח מימוש שוברים"],
    [],
    ["שם", "מספר שובר", "חבילה"],
    ["ישראל", "999888-4321", "זוגי + שמפניה"],
  ];
  const scan = matrixRowsFromVoucherHeaderScan(matrix, (h) => detectVoucherEasygoPreset(h));
  assertEquals(scan?.headerIdx, 2);
  assertEquals(scan?.rows.length, 1);
});

Deno.test("assessVoucherParseQuality — flags bad mapping", () => {
  const rows = [{ שובר: "" }, { שובר: "" }, { שובר: "" }, { שובר: "" }, { שובר: "1234" }];
  const bad = assessVoucherParseQuality(rows, { voucherNumber: "שובר" });
  assertEquals(bad.ok, false);
});

Deno.test("findHeaderByAliases — substring fallback", () => {
  const h = findHeaderByAliases(["מספר שובר / קופון"], ["מספר שובר"]);
  assertEquals(h, "מספר שובר / קופון");
});

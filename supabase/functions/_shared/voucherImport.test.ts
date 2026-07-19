// supabase/functions/_shared/voucherImport.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  assessVoucherParseQuality,
  csvUtf8BytesToMatrix,
  detectVoucherEasygoPreset,
  detectVoucherProviderPreset,
  estimateReconciliationJoin,
  filterEasygoRowsByProvider,
  findHeaderByAliases,
  matrixRowsFromVoucherHeaderScan,
  matrixToVoucherRows,
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

Deno.test("detectVoucherEasygoPreset — Nofshonit uses CouponNo (מספר שובר) not מזהה", () => {
  const headers = ["CouponNo", "CouponDesc", "מזהה", "שם לקוח", "חברת שוברים"];
  const preset = detectVoucherEasygoPreset(headers, "Nofshonit");
  assertEquals(preset?.voucherNumber, "CouponNo");
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

Deno.test("voucherNumbersMatchLocal — Nofshonit CouponNo leading zeros", () => {
  assertEquals(voucherNumbersMatchLocal("exact", "32257537", "032257537"), true);
  assertEquals(voucherNumbersMatchLocal("exact", "203554126", "203554126"), true);
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

Deno.test("csvUtf8BytesToMatrix — Hebrew BOM + embedded quote in company name", () => {
  const csv = '\uFEFF"CouponNo","חברת שוברים","חברת שוברים","מזהה"\n"1","11448*1061","נופשונית ח.מ תשורות חן (1987) בע""מ","203232623"';
  const matrix = csvUtf8BytesToMatrix(new TextEncoder().encode(csv));
  assertEquals(matrix.length, 2);
  const { rows } = matrixToVoucherRows(matrix);
  assertEquals(rows[0]["מזהה"], "203232623");
  assertEquals(String(rows[0]["חברת שוברים"]).includes("נופשונית"), true);
});

Deno.test("estimateReconciliationJoin — detects good Nofshonit CouponNo join", () => {
  const providerRows = [{ "מזהה לקוח": "203554126", "וריאנט": "classic deluxe" }];
  const easygoRows = [{ CouponNo: "203554126", CouponDesc: "swish דלאקס 2026" }];
  const provMap = { voucherNumber: "מזהה לקוח", packageType: "וריאנט" };
  const ezMap = { voucherNumber: "CouponNo", packageType: "CouponDesc" };
  const est = estimateReconciliationJoin(providerRows, easygoRows, provMap, ezMap, "exact");
  assertEquals(est.ok, true);
  assertEquals(est.providerHits, 1);
});

Deno.test("estimateReconciliationJoin — flags wrong column mapping", () => {
  const providerRows = [{ "מזהה לקוח": "203554126", "וריאנט": "x" }];
  const easygoRows = [{ מזהה: "203232623", CouponDesc: "y" }];
  const provMap = { voucherNumber: "מזהה לקוח", packageType: "וריאנט" };
  const ezMap = { voucherNumber: "מזהה", packageType: "CouponDesc" };
  const est = estimateReconciliationJoin(providerRows, easygoRows, provMap, ezMap, "exact");
  assertEquals(est.ok, false);
  assertEquals(est.providerHits, 0);
});

Deno.test("filterEasygoRowsByProvider — duplicate-header row values", () => {
  const rows = [
    { "חברת שוברים__21": "11448*1061", "חברת שוברים__22": "נופשונית ח.מ תשורות חן (1987) בע\"מ", מזהה: "1" },
    { "חברת שוברים": "חבר משרתי הקבע והגמלאים בע\"מ", מזהה: "2" },
  ];
  const filtered = filterEasygoRowsByProvider(rows, "Nofshonit");
  assertEquals(filtered.length, 1);
  assertEquals(filtered[0].מזהה, "1");
});

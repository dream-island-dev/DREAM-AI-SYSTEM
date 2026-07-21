import {
  assertEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  parseTsvDailyReport,
  parseHtmlDailyReport,
  sanitizeE164,
  extractPhoneFromOpsText,
  parseOrderIdentityFromCell,
  defaultDoc1ParseOpts,
  looksLikeDoc1ExcelRows,
  mergeDoc1PhoneFromSecondary,
} from "./ezgoDoc1Parser.ts";

Deno.test("sanitizeE164 strips leading question mark", () => {
  assertEquals(sanitizeE164("?0548082123"), "+972548082123");
});

Deno.test("parseOrderIdentityFromCell finds phone on second line in cell", () => {
  const id = parseOrderIdentityFromCell("266141: נועה שני\n050-5475000");
  assertEquals(id.order_number, "266141");
  assertEquals(id.guest_name, "נועה שני");
  assertEquals(id.phone, "+972505475000");
});

Deno.test("extractPhoneFromOpsText finds IL mobile without dash separator", () => {
  assertEquals(
    extractPhoneFromOpsText("דור בידרמן050-1234567"),
    "+972501234567",
  );
});

Deno.test("parseHtmlDailyReport extracts phone from multiline order td", () => {
  const html = [
    "<table><tr>",
    "<td>266141: נועה שני<br>050-5475000</td>",
    "<td>1 - 12:00 - טיפול 45 דקות</td>",
    "<td></td><td></td>",
    "</tr></table>",
  ].join("");
  const records = parseHtmlDailyReport(html, defaultDoc1ParseOpts(true));
  assertEquals(records.length, 1);
  assertEquals(records[0].order_number, "266141");
  assertEquals(records[0].phone, "+972505475000");
  assertEquals(records[0].spa_time, "12:00");
});

Deno.test("parseTsvDailyReport extracts suite spa and HB", () => {
  const tsv = [
    "יום: ד\tהזמנה\tתוספות\t\tארוחות\t",
    "7/22/2026\t269731: יהודית פרסטר - 0558847742\t1 - חבר פרימיום HB\tHB\t",
    "\t1 חדרים.\t\t\t",
    "279668: עדן בן ישי - 0505475000\t2 - 19:00 - טיפול 45 דקות לאורחי הסוויטות\tBB\t",
  ].join("\n");

  const records = parseTsvDailyReport(tsv, defaultDoc1ParseOpts(true));
  const byOrder = Object.fromEntries(records.map((r) => [r.order_number, r]));

  assertEquals(byOrder["269731"]?.meal_location, "חצי פנסיון");
  assertEquals(byOrder["279668"]?.spa_time, "19:00");
  assertEquals(byOrder["279668"]?.arrival_date, "2026-07-22");
});

Deno.test("sanitizeE164 rejects placeholder 00", () => {
  assertEquals(sanitizeE164("00"), null);
});

Deno.test("parseHtmlDailyReport extracts phone from div-separated order td", () => {
  const html = [
    "<table><tr>",
    "<td><div>269707: נועה שני</div><div>050-5475000</div></td>",
    "<td>1 - 11:00 - טיפול 45 דקות</td>",
    "<td></td><td></td>",
    "</tr></table>",
  ].join("");
  const records = parseHtmlDailyReport(html, defaultDoc1ParseOpts(true));
  assertEquals(records.length, 1);
  assertEquals(records[0].order_number, "269707");
  assertEquals(records[0].phone, "+972505475000");
});

Deno.test("parseHtmlDailyReport attaches phone-only follow-up row", () => {
  const html = [
    "<table>",
    "<tr><td>270300: דור בידרמן</td><td>1 - 10:00 - טיפול</td><td></td><td></td></tr>",
    "<tr><td>050-1234567</td><td></td><td></td><td></td></tr>",
    "</table>",
  ].join("");
  const records = parseHtmlDailyReport(html, defaultDoc1ParseOpts(true));
  assertEquals(records.length, 1);
  assertEquals(records[0].order_number, "270300");
  assertEquals(records[0].phone, "+972501234567");
});

Deno.test("mergeDoc1PhoneFromSecondary fills missing phones by order", () => {
  const primary = [{
    order_number: "269707",
    guest_name: "נועה שני",
    phone: null,
    arrival_date: "2026-07-23",
    spa_time: "11:00",
    treatment_count: 1,
    meal_time: null,
    meal_location: null,
  }];
  const secondary = [{
    order_number: "269707",
    guest_name: "נועה שני",
    phone: "+972505475000",
    arrival_date: "2026-07-23",
    spa_time: null,
    treatment_count: 0,
    meal_time: null,
    meal_location: null,
  }];
  const merged = mergeDoc1PhoneFromSecondary(primary, secondary);
  assertEquals(merged[0].phone, "+972505475000");
});

Deno.test("looksLikeDoc1ExcelRows detects order column cells", () => {
  const rows = [
    [45828, null, null],
    [null, "269731: יהודית פרסטר - 0558847742", "1 - HB"],
    [null, "279668: עדן בן ישי - 0505475000", "2 - 19:00 - לאורחי הסוויטות"],
  ];
  assertEquals(looksLikeDoc1ExcelRows(rows), true);
  assertEquals(looksLikeDoc1ExcelRows([["שם", "טלפון"]]), false);
});

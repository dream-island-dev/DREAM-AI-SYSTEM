import {
  assertEquals,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  parseTsvDailyReport,
  sanitizeE164,
  defaultDoc1ParseOpts,
  looksLikeDoc1ExcelRows,
} from "./ezgoDoc1Parser.ts";

Deno.test("sanitizeE164 strips leading question mark", () => {
  assertEquals(sanitizeE164("?0548082123"), "+972548082123");
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

Deno.test("looksLikeDoc1ExcelRows detects order column cells", () => {
  const rows = [
    [45828, null, null],
    [null, "269731: יהודית פרסטר - 0558847742", "1 - HB"],
    [null, "279668: עדן בן ישי - 0505475000", "2 - 19:00 - לאורחי הסוויטות"],
  ];
  assertEquals(looksLikeDoc1ExcelRows(rows), true);
  assertEquals(looksLikeDoc1ExcelRows([["שם", "טלפון"]]), false);
});

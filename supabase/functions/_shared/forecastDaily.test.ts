import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  addYmd,
  classifySuiteOccupancy,
  composeForecastPingText,
  countDirectGroupOccupancy,
  mergeForecastGroups,
  parseForecastConfig,
  shouldDispatchForecastPing,
  summarizeDoc2MailOccupancy,
  type ForecastReport,
} from "./forecastDaily.ts";
import { israelLocalHour, israelYmd } from "./automationSchedule.ts";
import { classifyOpsRow, opsGuestQty, sumGroupSpaTreatments } from "./forecastOpsClassify.ts";

Deno.test("addYmd rolls month", () => {
  assertEquals(addYmd("2026-08-17", 1), "2026-08-18");
  assertEquals(addYmd("2026-08-31", 1), "2026-09-01");
});

Deno.test("suite occupancy buckets by dates", () => {
  const guests = [
    { id: 1, room: "אמטיסט 8", room_type: "suite", status: "expected", arrival_date: "2026-08-18", departure_date: "2026-08-19", order_number: "1", meal_plan: "half_board" },
    { id: 2, room: "אמטיסט 9", room_type: "suite", status: "checked_in", arrival_date: "2026-08-17", departure_date: "2026-08-18", order_number: "2", meal_plan: "half_board" },
    { id: 3, room: "ג׳ספר 1", room_type: "suite", status: "checked_in", arrival_date: "2026-08-16", departure_date: "2026-08-20", order_number: "3", meal_plan: "half_board" },
    { id: 4, room: "Premium Day 1", room_type: "day_guest", status: "expected", arrival_date: "2026-08-18", departure_date: "2026-08-18", order_number: "4", meal_plan: "none" },
    { id: 5, room: "אמטיסט 10", room_type: "suite", status: "cancelled", arrival_date: "2026-08-18", departure_date: "2026-08-19", order_number: "5", meal_plan: "half_board" },
  ];
  const rooms = new Map([
    [1, [{ adults: 2 }]],
    [2, [{ adults: 2 }]],
    [3, [{ adults: 2 }]],
    [4, [{ adults: 2 }]],
  ]);
  const occ = classifySuiteOccupancy(guests, rooms, "2026-08-18");
  assertEquals(occ.arrivals, { rooms: 1, guests: 2 });
  assertEquals(occ.departures, { rooms: 1, guests: 2 });
  assertEquals(occ.stayovers, { rooms: 1, guests: 2 });
  assertEquals(occ.capsules, { rooms: 1, guests: 2 });
  assertEquals(occ.suiteOrderNumbers.has("1"), true);
  assertEquals(occ.suiteOrderNumbers.has("5"), false);
  assertEquals(occ.breakfast, 4);
  assertEquals(occ.dinner, 4);
});

Deno.test("direct_group occupancy counts on-day group profiles only", () => {
  const guests = [
    { id: 1, room: "אמטיסט 8", room_type: "suite", status: "expected", arrival_date: "2026-08-18", departure_date: "2026-08-19", sales_segment_kind: "direct_group" },
    { id: 2, room: "אמטיסט 9", room_type: "suite", status: "expected", arrival_date: "2026-08-18", departure_date: "2026-08-19", sales_segment_kind: "individual" },
    { id: 3, room: "ג׳ספר 1", room_type: "suite", status: "cancelled", arrival_date: "2026-08-18", departure_date: "2026-08-19", sales_segment_kind: "direct_group" },
  ];
  const rooms = new Map([
    [1, [{ adults: 2 }]],
    [2, [{ adults: 2 }]],
    [3, [{ adults: 9 }]],
  ]);
  assertEquals(countDirectGroupOccupancy(guests, rooms, "2026-08-18"), { rooms: 1, guests: 2 });
});

Deno.test("ops qty: כניסה people, evening meals, EZGO tiling dump", () => {
  assertEquals(opsGuestQty("2 - קלאסיק", "ארוחת ערב בחבילה כמות: 2", "evening"), 2);
  const dumped = Array(14).fill("1 - קלאסיק עם א. צהרים 1 - כניסה 1 - פוד טראק").join(" ");
  assertEquals(opsGuestQty(dumped, "ארוחת צהרים בחבילה כמות: 1", "morning"), 1);
  assertEquals(opsGuestQty("1 - דלאקס 45 וצהריים 2 - כניסה", "ארוחת צהרים בחבילה כמות: 1", "morning"), 2);
  const eveDump = "2 - קלאסיק וא.ערב מ- 16:00 א-ד 2 - כניסה 2 - פוד טראק 2 - קלאסיק וא.ערב מ- 16:00 א-ד 2 - כניסה 2 - פוד טראק 1 - קלאסיק וא.ערב מ- 16:00 א-ד 1 - כניסה 1 - פוד טראק";
  assertEquals(opsGuestQty(eveDump, "ארוחת ערב בחבילה כמות: 2", "evening"), 2);
  const eve = classifyOpsRow({
    orderNumber: "9",
    extras: "2 - קלאסיק וא.ערב מ- 16:00 א-ד 2 - כניסה",
    board: "",
    meals: "ארוחת ערב בחבילה כמות: 2",
  }, new Set());
  assertEquals(eve.dayPart, "evening");
  assertEquals(eve.bucket, "classic_16");
  const morn = classifyOpsRow({
    orderNumber: "8",
    extras: "2 - דלאקס 45 וצהריים 2 - כניסה",
    board: "",
    meals: "ארוחת צהרים בחבילה כמות: 2",
  }, new Set());
  assertEquals(morn.dayPart, "morning");
  assertEquals(morn.bucket, "deluxe_45_lunch");
  const suiteBoard = classifyOpsRow({
    orderNumber: "1",
    extras: "",
    board: "BB",
    meals: "",
  }, new Set());
  assertEquals(suiteBoard.dayPart, "suite");
  const suite = classifyOpsRow({
    orderNumber: "271439",
    extras: "",
    board: "BB",
    meals: "",
  }, new Set(["271439"]));
  assertEquals(suite.dayPart, "suite");
});

Deno.test("group spa treatments from extras parts", () => {
  const row = classifyOpsRow({
    orderNumber: "100",
    extras: "6 - דלאקס+ט.30 דק+צהרים לקבוצות 6 - כניסה 1 - קלאסיק וטיפול 30 דקות",
    board: "",
    meals: "ארוחת צהרים בחבילה כמות: 6",
  }, new Set());
  assertEquals(row.dayPart, "group");
  assertEquals(sumGroupSpaTreatments([row]), 7);
});

Deno.test("ping has no URL; send gate needs phone and hour", () => {
  const report = {
    targetDate: "2026-08-18",
    totalOnSite: 10,
    totalWithDepartures: 12,
    spaTreatments: 3,
    sources: { missingOperations: false, suiteArrivalGap: false },
  } as ForecastReport;
  const text = composeForecastPingText(report);
  assertEquals(text.includes("http"), false);
  const now = new Date();
  const cfg = parseForecastConfig({
    enabled: true,
    send_hour: israelLocalHour(now),
    yelena_phone: "0500000000",
  });
  assertEquals(shouldDispatchForecastPing(cfg, now).due, true);
  assertEquals(shouldDispatchForecastPing({ ...cfg, last_sent_ymd: israelYmd(now) }, now).due, false);
  assertEquals(shouldDispatchForecastPing({ ...cfg, yelena_phone: "" }, now).reason, "missing_phone");
});

Deno.test("merge groups: ops qty + saved names when totals match", () => {
  const merged = mergeForecastGroups(
    [{ qty: 23 }],
    [
      { name: "בנק לאומי", arrival: "09:00", entry: "קבלה", meals: "התנהלות כבודדים", qty: 7 },
      { name: "אפ מרימים", arrival: "09:00", entry: "קבלה", meals: "15:30", qty: 7 },
      { name: "שטראוס גרופ", arrival: "09:00", entry: "קבלה", meals: "17:00", qty: 9 },
    ],
  );
  assertEquals(merged.length, 3);
  assertEquals(merged.reduce((s, g) => s + g.qty, 0), 23);
  assertEquals(merged[0].name, "בנק לאומי");
});

Deno.test("merge groups: empty saved → one row per ops order", () => {
  const merged = mergeForecastGroups([{ qty: 7 }, { qty: 7 }, { qty: 9 }], []);
  assertEquals(merged.map((g) => g.qty), [7, 7, 9]);
  assertEquals(merged[0].name, "");
  assertEquals(merged[0].entry, "קבלה");
});

Deno.test("doc2 mail occupancy counts unique rooms, not guests rows", () => {
  const sum = summarizeDoc2MailOccupancy([
    { section: "arrival", room: "אמטיסט 8", guest_count: "2" },
    { section: "arrival", room: "אמטיסט 8", guest_count: "2" },
    { section: "arrival", room: "וילה 3", guest_count: "2" },
    { section: "arrival", room: "Premium Day 1", guest_count: "2", is_day_guest: true },
    { section: "departure", room: "ג׳ספר 1", guest_count: "2" },
  ]);
  assertEquals(sum.arrivals, { rooms: 2, guests: 4 });
  assertEquals(sum.capsules, { rooms: 1, guests: 2 });
  assertEquals(sum.departures, { rooms: 1, guests: 2 });
});

Deno.test("group entry maps from legacy spa field", () => {
  const cfg = parseForecastConfig({
    groups_by_date: {
      "2026-08-18": [{ name: "בנק לאומי", arrival: "09:00", spa: "קבלה", meals: "התנהלות כבודדים", qty: 7 }],
    },
  });
  assertEquals(cfg.groups_by_date["2026-08-18"][0].entry, "קבלה");
});

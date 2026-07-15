// Run: deno test --allow-env supabase/functions/_shared/frontDeskMorningBrief.test.ts

import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  composeArrivalDeskBrief,
  buildFrontDeskMorningMessage,
  frontDeskMorningEnabled,
  type ArrivalDeskGuestRow,
} from "./frontDeskMorningBrief.ts";

const NOW = new Date("2026-07-16T04:00:00.000Z"); // 07:00 Israel

const ROWS: ArrivalDeskGuestRow[] = [
  {
    name: "יוסי",
    room: "Suite 3",
    room_type: "suite",
    status: "expected",
    arrival_date: "2026-07-16",
    arrival_time: "15:00",
    requires_attention: false,
  },
  {
    name: "דנה",
    room: "Suite 7",
    room_type: "suite",
    status: "expected",
    arrival_date: "2026-07-16",
    arrival_time: null,
    requires_attention: true,
  },
  {
    name: "מיכאל",
    room: "Suite 1",
    room_type: "suite",
    status: "expected",
    arrival_date: "2026-07-17",
    arrival_time: "14:00",
    requires_attention: false,
  },
];

Deno.test("composeArrivalDeskBrief — splits today/tomorrow and missing time", () => {
  const brief = composeArrivalDeskBrief(ROWS, NOW);
  assertEquals(brief.todayTotal, 2);
  assertEquals(brief.todayWithTime, 1);
  assertEquals(brief.todayMissingTime, 1);
  assertEquals(brief.tomorrowTotal, 1);
  assertEquals(brief.summary.includes("בלי שעה (1)"), true);
  assertEquals(brief.summary.includes("⚠VIP"), true);
});

Deno.test("buildFrontDeskMorningMessage — includes power hints and stats", () => {
  const body = buildFrontDeskMorningMessage({
    brief: composeArrivalDeskBrief(ROWS, NOW),
    openActionable: [
      { id: 1, alert_type: "request", message: "מגבות נוספות", guests: { name: "דנה", room: "Suite 7" } },
    ],
    openEtaCount: 2,
  });
  assertEquals(body.includes("בוקר טוב אדיר"), true);
  assertEquals(body.includes("2 הגעות היום"), true);
  assertEquals(body.includes("💪 מה אתה יכול לבקש"), true);
  assertEquals(body.includes("מגבות נוספות"), true);
  assertEquals(body.includes("שעות הגעה מאורחים"), true);
  assertEquals(body.includes("רוצה שאשלח הודעה קצרה לבקש שעת הגעה מ-1 האורחים"), true);
});

Deno.test("buildFrontDeskMorningMessage — omits power hints when includePowerHints=false", () => {
  const body = buildFrontDeskMorningMessage({
    brief: composeArrivalDeskBrief(ROWS, NOW),
    openActionable: [],
    openEtaCount: 0,
  }, { includePowerHints: false });
  assertEquals(body.includes("💪 מה אתה יכול לבקש"), false);
  assertEquals(body.includes("לוח בקשות"), true);
});

Deno.test("buildFrontDeskMorningMessage — includes power hints when includePowerHints=true", () => {
  const body = buildFrontDeskMorningMessage({
    brief: composeArrivalDeskBrief(ROWS, NOW),
    openActionable: [],
    openEtaCount: 0,
  }, { includePowerHints: true });
  assertEquals(body.includes("💪 מה אתה יכול לבקש"), true);
});

Deno.test("buildFrontDeskMorningMessage — omits the arrival-time-request suggestion when nobody is missing a time", () => {
  const allWithTime: ArrivalDeskGuestRow[] = ROWS.map((g) => ({ ...g, arrival_time: g.arrival_time ?? "12:00" }));
  const body = buildFrontDeskMorningMessage({
    brief: composeArrivalDeskBrief(allWithTime, NOW),
    openActionable: [],
    openEtaCount: 0,
  });
  assertEquals(body.includes("רוצה שאשלח הודעה קצרה לבקש שעת הגעה"), false);
});

Deno.test("frontDeskMorningEnabled — default on, explicit off", () => {
  const prev = Deno.env.get("FRONT_DESK_MORNING_ENABLED");
  Deno.env.delete("FRONT_DESK_MORNING_ENABLED");
  try {
    assertEquals(frontDeskMorningEnabled(), true);
    Deno.env.set("FRONT_DESK_MORNING_ENABLED", "false");
    assertEquals(frontDeskMorningEnabled(), false);
  } finally {
    if (prev === undefined) Deno.env.delete("FRONT_DESK_MORNING_ENABLED");
    else Deno.env.set("FRONT_DESK_MORNING_ENABLED", prev);
  }
});

// supabase/functions/_shared/guestTimeGreeting.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  applyTimeGreetingToGuestReply,
  getIsraelTimeGreeting,
  israelTimeOfDayFromHour,
} from "./guestTimeGreeting.ts";

Deno.test("israelTimeOfDayFromHour — morning/afternoon/evening/night buckets", () => {
  assertEquals(israelTimeOfDayFromHour(5), "morning");
  assertEquals(israelTimeOfDayFromHour(11), "morning");
  assertEquals(israelTimeOfDayFromHour(12), "afternoon");
  assertEquals(israelTimeOfDayFromHour(16), "afternoon");
  assertEquals(israelTimeOfDayFromHour(17), "evening");
  assertEquals(israelTimeOfDayFromHour(21), "evening");
  assertEquals(israelTimeOfDayFromHour(22), "night");
  assertEquals(israelTimeOfDayFromHour(4), "night");
});

Deno.test("getIsraelTimeGreeting — maps slots to Hebrew phrases", () => {
  assertEquals(getIsraelTimeGreeting(new Date("2026-07-19T05:30:00+03:00")), "בוקר טוב");
  assertEquals(getIsraelTimeGreeting(new Date("2026-07-19T14:00:00+03:00")), "צהריים טובים");
  assertEquals(getIsraelTimeGreeting(new Date("2026-07-19T19:00:00+03:00")), "ערב טוב");
  assertEquals(getIsraelTimeGreeting(new Date("2026-07-19T23:00:00+03:00")), "לילה טוב");
});

Deno.test("applyTimeGreetingToGuestReply — replaces שלום with time greeting", () => {
  const now = new Date("2026-07-19T08:00:00+03:00");
  const out = applyTimeGreetingToGuestReply(
    "שלום דני! 😊 ברוכים הבאים לדרים איילנד. במה אוכל לעזור?",
    now,
  );
  assertEquals(out.startsWith("בוקר טוב דני!"), true);
  assertEquals(out.includes("ברוכים הבאים"), true);
});

Deno.test("applyTimeGreetingToGuestReply — refreshes stale evening opener at noon", () => {
  const now = new Date("2026-07-19T13:00:00+03:00");
  const out = applyTimeGreetingToGuestReply("ערב טוב! במה אוכל לעזור?", now);
  assertEquals(out.startsWith("צהריים טובים"), true);
});

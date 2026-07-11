// supabase/functions/_shared/guestBotSanitize.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  looksLikePromptLeak,
  sanitizeGuestBotReply,
  shouldHardDropGuestReply,
} from "./guestBotSanitize.ts";
import { extractArrivalTimeFromText } from "./guestEta.ts";
import { isRecordOnlyArrivalTimeUpdate } from "./guestInboundOrchestrator.ts";

const LIVE_LEAK =
  `"תמיד בצורה טבעית, חמה ורב-מגדרית". - Yes. * "לעולם אל תציג את`;

Deno.test("looksLikePromptLeak — live Whapi leak 2026-07-11", () => {
  assertEquals(looksLikePromptLeak(LIVE_LEAK), true);
});

Deno.test("sanitizeGuestBotReply — drops live leak to empty", () => {
  assertEquals(sanitizeGuestBotReply(LIVE_LEAK), "");
});

Deno.test("shouldHardDropGuestReply — live leak", () => {
  assertEquals(shouldHardDropGuestReply(LIVE_LEAK), true);
});

Deno.test("sanitizeGuestBotReply — keeps normal Hebrew guest reply", () => {
  const ok = "רשמתי הגעה בסביבות 13:00 — נעדכן כשהסוויטה תהיה מוכנה 🙏";
  assertEquals(sanitizeGuestBotReply(ok), ok);
  assertEquals(looksLikePromptLeak(ok), false);
});

Deno.test("sanitizeGuestBotReply — strips English COT then keeps Hebrew", () => {
  const mixed =
    "The user is asking about arrival time. I should respond warmly.\nרשמתי, מחכים לכם!";
  assertEquals(sanitizeGuestBotReply(mixed), "רשמתי, מחכים לכם!");
});

Deno.test("ETA — מתכננת להגיע לקראת 13:00 is record-only", () => {
  const text =
    "היי יודעת שמחר בעקרון סגור לקבוצות אני מתכננת להגיע לקראת 13:00 אשמח אם תוכלו לעדכן אותי שהסוויטה מוכנה שהתארגן על השעה מראש ❤️";
  assertEquals(extractArrivalTimeFromText(text), "13:00");
  assertEquals(isRecordOnlyArrivalTimeUpdate(text), true);
});

Deno.test("ETA — מתכננות להגיע ב-12:00 is record-only (live miss 2026-07-11)", () => {
  const text = "מתכננות להגיע ב-12:00 💜";
  assertEquals(extractArrivalTimeFromText(text), "12:00");
  assertEquals(isRecordOnlyArrivalTimeUpdate(text), true);
});

Deno.test("ETA — gender forms of מתכנן + להגיע ב-", () => {
  assertEquals(isRecordOnlyArrivalTimeUpdate("מתכנן להגיע ב-14:00"), true);
  assertEquals(isRecordOnlyArrivalTimeUpdate("מתכננים להגיע ב 15:30"), true);
  assertEquals(extractArrivalTimeFromText("מתכננים להגיע ב 15:30"), "15:30");
});

Deno.test("ETA — בסביבות N with space extracts hour", () => {
  assertEquals(extractArrivalTimeFromText("מגיעים בסביבות 15"), "15:00");
  assertEquals(isRecordOnlyArrivalTimeUpdate("מגיעים בסביבות 15"), true);
  assertEquals(extractArrivalTimeFromText("נגיע אחרי הצהריים בסביבות 16"), "16:00");
  assertEquals(isRecordOnlyArrivalTimeUpdate("נגיע אחרי הצהריים בסביבות 16"), true);
});

Deno.test("ETA — around 4pm is record-only", () => {
  assertEquals(extractArrivalTimeFromText("around 4pm"), "16:00");
  assertEquals(isRecordOnlyArrivalTimeUpdate("around 4pm"), true);
});

Deno.test("ETA — date-change with תאריך (final kaf) is NOT record-only", () => {
  assertEquals(isRecordOnlyArrivalTimeUpdate("רוצים לשנות תאריך להגעה ב-12:00"), false);
});

Deno.test("ETA — bare 15:30 still record-only", () => {
  assertEquals(isRecordOnlyArrivalTimeUpdate("15:30"), true);
  assertEquals(extractArrivalTimeFromText("15:30"), "15:30");
});

Deno.test("ETA — arrival-time question is NOT record-only", () => {
  assertEquals(isRecordOnlyArrivalTimeUpdate("מה שעת ההגעה?"), false);
});

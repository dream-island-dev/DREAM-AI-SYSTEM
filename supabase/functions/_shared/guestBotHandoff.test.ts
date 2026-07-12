// supabase/functions/_shared/guestBotHandoff.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  GUEST_CALLBACK_ACK_SENTENCE,
  GUEST_STAFF_HANDOFF_SENTENCE,
  buildGuestHumanRequestReply,
  detectGuestHumanRequest,
  isGuestStaffHandoffReply,
} from "./guestBotHandoff.ts";

Deno.test("detectGuestHumanRequest — אשמח שתחזרו אלי שנקבע → call", () => {
  const r = detectGuestHumanRequest("אשמח שתחזרו אלי שנקבע");
  assertEquals(r, { requested: true, type: "call" });
});

Deno.test("detectGuestHumanRequest — תחזירו אלי / שיחזרו אלי / צרו איתי קשר → call", () => {
  assertEquals(detectGuestHumanRequest("תחזירו אלי בבקשה").type, "call");
  assertEquals(detectGuestHumanRequest("שיחזרו אלי מחר").type, "call");
  assertEquals(detectGuestHumanRequest("אפשר שתצרו איתי קשר?").type, "call");
  assertEquals(detectGuestHumanRequest("תיצרו איתי קשר לתאם").type, "call");
  assertEquals(detectGuestHumanRequest("תתקשרו אלי בבקשה").type, "call");
});

Deno.test("detectGuestHumanRequest — רוצה לדבר עם נציג → chat", () => {
  const r = detectGuestHumanRequest("רוצה לדבר עם נציג");
  assertEquals(r, { requested: true, type: "chat" });
});

Deno.test("detectGuestHumanRequest — FAQ pool hours → not requested", () => {
  const r = detectGuestHumanRequest("מה שעות הבריכה?");
  assertEquals(r, { requested: false, type: null });
});

Deno.test("buildGuestHumanRequestReply — call vs chat", () => {
  assertEquals(buildGuestHumanRequestReply("call"), GUEST_CALLBACK_ACK_SENTENCE);
  assertEquals(buildGuestHumanRequestReply("chat"), GUEST_STAFF_HANDOFF_SENTENCE);
  assertEquals(buildGuestHumanRequestReply(null), GUEST_STAFF_HANDOFF_SENTENCE);
});

Deno.test("isGuestStaffHandoffReply — includes callback ack sentence", () => {
  assertEquals(isGuestStaffHandoffReply(GUEST_CALLBACK_ACK_SENTENCE), true);
  assertEquals(isGuestStaffHandoffReply(GUEST_STAFF_HANDOFF_SENTENCE), true);
  assertEquals(isGuestStaffHandoffReply("שעות הבריכה עד 20:00"), false);
});

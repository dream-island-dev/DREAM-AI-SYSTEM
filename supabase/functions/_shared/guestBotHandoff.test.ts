// deno test --no-check supabase/functions/_shared/guestBotHandoff.test.ts

import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  buildArrivalDeclineHandoffReply,
  buildStayChangeHandoffReply,
  GUEST_STAFF_HANDOFF_SENTENCE,
  NEUTRAL_STAFF_HANDOFF_REPLY_HE,
  SUITE_ARRIVAL_DECLINE_REPLY_HE,
  SUITE_STAY_CHANGE_HANDOFF_MSG,
} from "./guestBotHandoff.ts";

Deno.test("buildArrivalDeclineHandoffReply: suite gets suites team + dates ask", () => {
  const msg = buildArrivalDeclineHandoffReply({ room: "אמטיסט 8", room_type: "suite" });
  assertEquals(msg, SUITE_ARRIVAL_DECLINE_REPLY_HE);
  assertEquals(msg.includes("סוויטות"), true);
});

Deno.test("buildArrivalDeclineHandoffReply: day-pass never mentions suites", () => {
  const msg = buildArrivalDeclineHandoffReply({ room: "Premium Day 1", room_type: "day_guest" });
  assertEquals(msg, NEUTRAL_STAFF_HANDOFF_REPLY_HE);
  assertEquals(msg.includes("סוויטות"), false);
});

Deno.test("buildStayChangeHandoffReply: day-pass neutral", () => {
  const msg = buildStayChangeHandoffReply({ room: "בילוי יומי", room_type: "day_guest" });
  assertEquals(msg, NEUTRAL_STAFF_HANDOFF_REPLY_HE);
});

Deno.test("buildStayChangeHandoffReply: suite stay-change copy", () => {
  const msg = buildStayChangeHandoffReply({ room: "ג׳ספר 3", room_type: "suite" });
  assertEquals(msg, SUITE_STAY_CHANGE_HANDOFF_MSG);
});

Deno.test("buildStayChangeHandoffReply: unknown guest → generic handoff", () => {
  assertEquals(buildStayChangeHandoffReply(null), GUEST_STAFF_HANDOFF_SENTENCE);
});

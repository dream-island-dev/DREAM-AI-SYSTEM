// deno test --allow-env supabase/functions/_shared/arrivalConfirmationAi.test.ts

import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  isGuestAwaitingArrivalConfirmationReply,
  parseArrivalConfirmClassification,
} from "./arrivalConfirmationAi.ts";

Deno.test("isGuestAwaitingArrivalConfirmationReply: stage1 sent, not confirmed", () => {
  assertEquals(
    isGuestAwaitingArrivalConfirmationReply({
      status: "expected",
      msg_pre_arrival_2d_sent: true,
      arrival_confirmed: false,
    }),
    true,
  );
});

Deno.test("isGuestAwaitingArrivalConfirmationReply: already confirmed → false", () => {
  assertEquals(
    isGuestAwaitingArrivalConfirmationReply({
      msg_pre_arrival_2d_sent: true,
      arrival_confirmed: true,
    }),
    false,
  );
});

Deno.test("isGuestAwaitingArrivalConfirmationReply: stage1 not sent → false", () => {
  assertEquals(
    isGuestAwaitingArrivalConfirmationReply({
      msg_pre_arrival_2d_sent: false,
      arrival_confirmed: false,
    }),
    false,
  );
});

Deno.test("parseArrivalConfirmClassification: confirm JSON", () => {
  const r = parseArrivalConfirmClassification('{"intent":"confirm","confidence":0.92}');
  assertEquals(r?.intent, "confirm");
  assertEquals(r?.confidence, 0.92);
});

Deno.test("parseArrivalConfirmClassification: wrapped JSON", () => {
  const r = parseArrivalConfirmClassification('Sure: {"intent":"decline","confidence":0.8}');
  assertEquals(r?.intent, "decline");
});

Deno.test("parseArrivalConfirmClassification: invalid → null", () => {
  assertEquals(parseArrivalConfirmClassification("not json"), null);
  assertEquals(parseArrivalConfirmClassification('{"intent":"maybe"}'), null);
});

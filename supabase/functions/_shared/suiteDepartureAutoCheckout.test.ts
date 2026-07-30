import {
  assertEquals,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  AUTO_CHECKOUT_SUITE_LOCAL_HOUR,
  isPastSuiteDepartureAutoCheckoutGateway,
} from "./suiteDepartureAutoCheckout.ts";

Deno.test("isPastSuiteDepartureAutoCheckoutGateway: before 16:00 Israel", () => {
  const at1559 = new Date("2026-07-30T12:59:00.000Z"); // 15:59 Asia/Jerusalem (IDT)
  assertEquals(isPastSuiteDepartureAutoCheckoutGateway(at1559), false);
});

Deno.test("isPastSuiteDepartureAutoCheckoutGateway: at 16:00 Israel", () => {
  const at1600 = new Date("2026-07-30T13:00:00.000Z"); // 16:00 Asia/Jerusalem (IDT)
  assertEquals(isPastSuiteDepartureAutoCheckoutGateway(at1600), true);
});

Deno.test("AUTO_CHECKOUT_SUITE_LOCAL_HOUR is 16", () => {
  assertEquals(AUTO_CHECKOUT_SUITE_LOCAL_HOUR, 16);
});

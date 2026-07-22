// deno test --no-check --allow-env supabase/functions/_shared/arrivalConfirmationResolve.test.ts

import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { isArrivalConfirmationTier0 } from "./arrivalConfirmationResolve.ts";

Deno.test("isArrivalConfirmationTier0: template phrase matches without AI", () => {
  assertEquals(isArrivalConfirmationTier0("כן, מגיעים!"), true);
});

Deno.test("isArrivalConfirmationTier0: natural phrase does NOT match tier-0", () => {
  assertEquals(isArrivalConfirmationTier0("בטח מגיעים. אשמח לקבל את כל ההצעה"), false);
});

Deno.test("isArrivalConfirmationTier0: decline never matches", () => {
  assertEquals(isArrivalConfirmationTier0("לא, שינוי בתאריך 🗓️"), false);
});

Deno.test("isArrivalConfirmationTier0: button reply path", () => {
  assertEquals(
    isArrivalConfirmationTier0("", {
      isButtonReply: true,
      buttonTitle: "כן, מגיעים! ✨",
      buttonId: "confirm_arriving",
    }),
    true,
  );
});

Deno.test("resolveArrivalConfirmationIntent: tier-0 decline", async () => {
  const { resolveArrivalConfirmationIntent } = await import("./arrivalConfirmationResolve.ts");
  assertEquals(
    await resolveArrivalConfirmationIntent("לא, שינוי בתאריך 🗓️", {
      status: "expected",
      msg_pre_arrival_2d_sent: true,
      arrival_confirmed: false,
    }),
    "decline",
  );
});

Deno.test("resolveArrivalConfirmation: confirm shorthand", async () => {
  const { resolveArrivalConfirmation } = await import("./arrivalConfirmationResolve.ts");
  assertEquals(await resolveArrivalConfirmation("כן, מגיעים!"), true);
});

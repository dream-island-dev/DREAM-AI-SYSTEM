import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { extractEzgoWebhookMeta } from "./ezgoWebhookMeta.ts";

Deno.test("extractEzgoWebhookMeta — root level fields", () => {
  assertEquals(
    extractEzgoWebhookMeta({ event: "booking.created", order_id: "12345" }),
    { event_type: "booking.created", external_id: "12345" },
  );
});

Deno.test("extractEzgoWebhookMeta — nested data object", () => {
  assertEquals(
    extractEzgoWebhookMeta({ data: { type: "update", reservationId: 999 } }),
    { event_type: "update", external_id: "999" },
  );
});

Deno.test("extractEzgoWebhookMeta — unknown shape", () => {
  assertEquals(extractEzgoWebhookMeta({ foo: "bar" }), { event_type: null, external_id: null });
  assertEquals(extractEzgoWebhookMeta(null), { event_type: null, external_id: null });
});

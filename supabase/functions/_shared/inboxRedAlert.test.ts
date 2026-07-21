import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { inboxAlertChannelLookupOrder } from "./inboxRedAlert.ts";

Deno.test("inboxAlertChannelLookupOrder — whapi prefers Suites thread with Meta fallback", () => {
  assertEquals(inboxAlertChannelLookupOrder("whapi"), ["whapi", "meta"]);
});

Deno.test("inboxAlertChannelLookupOrder — default Meta only", () => {
  assertEquals(inboxAlertChannelLookupOrder("meta"), ["meta"]);
  assertEquals(inboxAlertChannelLookupOrder(null), ["meta"]);
  assertEquals(inboxAlertChannelLookupOrder(undefined), ["meta"]);
});

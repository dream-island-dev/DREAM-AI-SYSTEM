import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { isApprovalGateStale, ROOM_APPROVAL_GATE_STALE_MS } from "./roomApprovalGate.ts";

Deno.test("isApprovalGateStale: Co after gate", () => {
  const gateAt = "2026-07-31T11:33:32.848Z";
  const coAt = "2026-08-02T06:55:15.185Z";
  assertEquals(isApprovalGateStale(gateAt, { checkoutAfterGateAt: coAt }), true);
});

Deno.test("isApprovalGateStale: fresh gate without Co", () => {
  const gateAt = new Date(Date.now() - 60_000).toISOString();
  assertEquals(isApprovalGateStale(gateAt, {}), false);
});

Deno.test("isApprovalGateStale: age over 24h", () => {
  const gateAt = new Date(Date.now() - ROOM_APPROVAL_GATE_STALE_MS - 1_000).toISOString();
  assertEquals(isApprovalGateStale(gateAt, {}), true);
});

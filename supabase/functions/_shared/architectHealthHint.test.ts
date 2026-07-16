// supabase/functions/_shared/architectHealthHint.test.ts
//
// Run: deno test supabase/functions/_shared/architectHealthHint.test.ts

import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  ARCHITECT_RELEVANT_CHECK_KEYS,
  composeArchitectHealthHint,
  HUMAN_REQUESTED_ALERT_THRESHOLD,
  isHumanRequestedSpike,
  isPendingApprovalSpike,
  PENDING_APPROVAL_ALERT_THRESHOLD,
} from "./architectHealthHint.ts";

Deno.test("ARCHITECT_RELEVANT_CHECK_KEYS contains exactly the expected 3 keys", () => {
  assertEquals(ARCHITECT_RELEVANT_CHECK_KEYS.size, 3);
  assertEquals(ARCHITECT_RELEVANT_CHECK_KEYS.has("whapi_device_health"), true);
  assertEquals(ARCHITECT_RELEVANT_CHECK_KEYS.has("pending_approval_spike"), true);
  assertEquals(ARCHITECT_RELEVANT_CHECK_KEYS.has("human_requested_spike"), true);
  // No new whapi_sos_active check — Mike's DM rides on the existing whapi_device_health flip only.
  assertEquals(ARCHITECT_RELEVANT_CHECK_KEYS.has("whapi_sos_active"), false);
});

Deno.test("isPendingApprovalSpike: below/at/above threshold", () => {
  assertEquals(isPendingApprovalSpike(PENDING_APPROVAL_ALERT_THRESHOLD - 1), false);
  assertEquals(isPendingApprovalSpike(PENDING_APPROVAL_ALERT_THRESHOLD), true);
  assertEquals(isPendingApprovalSpike(PENDING_APPROVAL_ALERT_THRESHOLD + 1), true);
  assertEquals(isPendingApprovalSpike(0), false);
});

Deno.test("isHumanRequestedSpike: below/at/above threshold", () => {
  assertEquals(isHumanRequestedSpike(HUMAN_REQUESTED_ALERT_THRESHOLD - 1), false);
  assertEquals(isHumanRequestedSpike(HUMAN_REQUESTED_ALERT_THRESHOLD), true);
  assertEquals(isHumanRequestedSpike(HUMAN_REQUESTED_ALERT_THRESHOLD + 1), true);
  assertEquals(isHumanRequestedSpike(0), false);
});

Deno.test("composeArchitectHealthHint: bad-flip mentions Mike, the label, and the detail", () => {
  const msg = composeArchitectHealthHint("whapi_device_health", false, { status: "DOWN" });
  assertEquals(msg.includes("מייק"), true);
  assertEquals(msg.includes("מכשיר Whapi"), true);
  assertEquals(msg.includes("DOWN"), true);
});

Deno.test("composeArchitectHealthHint: ok-flip is a short closing line, no detail dump", () => {
  const msg = composeArchitectHealthHint("pending_approval_spike", true, { count: 7 });
  assertEquals(msg.includes("מייק"), true);
  assertEquals(msg.includes("משימות ממתינות לאישור"), true);
  assertEquals(msg.includes("חזר לתקין"), true);
});

Deno.test("composeArchitectHealthHint: pending_approval_spike bad-flip includes count and threshold", () => {
  const msg = composeArchitectHealthHint("pending_approval_spike", false, { count: 8, threshold: PENDING_APPROVAL_ALERT_THRESHOLD });
  assertEquals(msg.includes("8"), true);
  assertEquals(msg.includes(String(PENDING_APPROVAL_ALERT_THRESHOLD)), true);
});

Deno.test("composeArchitectHealthHint: human_requested_spike bad-flip includes count and threshold", () => {
  const msg = composeArchitectHealthHint("human_requested_spike", false, { count: 4, threshold: HUMAN_REQUESTED_ALERT_THRESHOLD });
  assertEquals(msg.includes("4"), true);
  assertEquals(msg.includes(String(HUMAN_REQUESTED_ALERT_THRESHOLD)), true);
});

Deno.test("composeArchitectHealthHint: unknown check key falls back to the raw key as label", () => {
  const msg = composeArchitectHealthHint("some_future_check", false, {});
  assertEquals(msg.includes("some_future_check"), true);
});

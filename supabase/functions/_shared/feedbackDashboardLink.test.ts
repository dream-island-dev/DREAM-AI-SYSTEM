// Run: deno test --allow-env supabase/functions/_shared/feedbackDashboardLink.test.ts

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  buildFeedbackDashboardDeepLink,
  buildFeedbackDashboardNegativeDeepLink,
  composeFeedbackDashboardLinkUrl,
  FEEDBACK_DASHBOARD_LINK_LABEL,
  isIsraelSunday,
  messageExpectsFeedbackDashboardLinkFollowUp,
} from "./feedbackDashboardLink.ts";

Deno.test("buildFeedbackDashboardDeepLink — feedback_dashboard page", () => {
  const url = buildFeedbackDashboardDeepLink();
  assertEquals(url.includes("page=feedback_dashboard"), true);
  assertEquals(url.startsWith("https://dream-ai-system.vercel.app"), true);
});

Deno.test("buildFeedbackDashboardNegativeDeepLink — focus=negative", () => {
  const url = buildFeedbackDashboardNegativeDeepLink();
  assertEquals(url.includes("focus=negative"), true);
  assertEquals(url.includes("page=feedback_dashboard"), true);
});

Deno.test("composeFeedbackDashboardLinkUrl — LTR prefix for iOS", () => {
  assertEquals(composeFeedbackDashboardLinkUrl().startsWith("\u200E"), true);
});

Deno.test("messageExpectsFeedbackDashboardLinkFollowUp — label detection", () => {
  assertEquals(messageExpectsFeedbackDashboardLinkFollowUp(`שורה\n${FEEDBACK_DASHBOARD_LINK_LABEL}`), true);
  assertEquals(messageExpectsFeedbackDashboardLinkFollowUp("בלי קישור"), false);
});

Deno.test("isIsraelSunday — Israel timezone", () => {
  // 2026-07-26 06:00 UTC = Sunday 09:00 Israel (UTC+3)
  assertEquals(isIsraelSunday(new Date("2026-07-26T06:00:00.000Z")), true);
  // 2026-07-25 15:00 UTC = Saturday 18:00 Israel
  assertEquals(isIsraelSunday(new Date("2026-07-25T15:00:00.000Z")), false);
});

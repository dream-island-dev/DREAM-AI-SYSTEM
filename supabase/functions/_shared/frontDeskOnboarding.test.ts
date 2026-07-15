// Run: deno test --allow-env supabase/functions/_shared/frontDeskOnboarding.test.ts

import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { buildFrontDeskCapabilitiesOnboardingMessage } from "./frontDeskOnboarding.ts";

Deno.test("buildFrontDeskCapabilitiesOnboardingMessage — one-time guide sections", () => {
  const body = buildFrontDeskCapabilitiesOnboardingMessage();
  assertEquals(body.includes("הודעה חד-פעמית"), true);
  assertEquals(body.includes("איך מדברים איתי"), true);
  assertEquals(body.includes("מוכנה. מה תרצה לבדוק קודם"), true);
});

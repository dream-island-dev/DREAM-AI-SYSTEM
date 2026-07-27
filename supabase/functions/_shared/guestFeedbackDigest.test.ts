// Run: deno test --allow-env supabase/functions/_shared/guestFeedbackDigest.test.ts

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  computeGuestFeedbackDigestStats,
  composeEliadDailyFeedbackLinkBlock,
  composeEliadFeedbackIntroOneShot,
  composeSigalGuestFeedbackEveningReminder,
  composeSigalGuestFeedbackMorningNudge,
  composeSigalGuestFeedbackPulse,
} from "./guestFeedbackDigest.ts";
import { FEEDBACK_DASHBOARD_LINK_LABEL } from "./feedbackDashboardLink.ts";

Deno.test("computeGuestFeedbackDigestStats — counts and WA negatives", () => {
  const stats = computeGuestFeedbackDigestStats(
    [
      { sentiment: "negative", status: "open", source: "facility_review", created_at: "" },
      { sentiment: "negative", status: "open", source: "structured_survey", created_at: "" },
      { sentiment: "positive", status: "open", source: "freeform_reflection", created_at: "" },
    ],
    2,
  );
  assertEquals(stats.last24hTotal, 3);
  assertEquals(stats.last24hNegative, 2);
  assertEquals(stats.last24hWaNegative, 1);
  assertEquals(stats.openNegative, 2);
});

Deno.test("composeSigalGuestFeedbackMorningNudge — skips when empty", () => {
  assertEquals(
    composeSigalGuestFeedbackMorningNudge({
      last24hTotal: 0,
      last24hNegative: 0,
      openNegative: 0,
      last24hWaNegative: 0,
    }),
    "",
  );
});

Deno.test("composeSigalGuestFeedbackMorningNudge — includes link label", () => {
  const body = composeSigalGuestFeedbackMorningNudge({
    last24hTotal: 2,
    last24hNegative: 1,
    openNegative: 1,
    last24hWaNegative: 1,
  });
  assertEquals(body.includes("משוב אורחים"), true);
  assertEquals(body.includes("וואטסאפ"), true);
  assertEquals(body.includes(FEEDBACK_DASHBOARD_LINK_LABEL), true);
});

Deno.test("composeSigalGuestFeedbackEveningReminder — only when open negative", () => {
  assertEquals(composeSigalGuestFeedbackEveningReminder(0), "");
  const body = composeSigalGuestFeedbackEveningReminder(2);
  assertEquals(body.includes("נשארו 2"), true);
  assertEquals(body.includes(FEEDBACK_DASHBOARD_LINK_LABEL), true);
});

Deno.test("composeSigalGuestFeedbackPulse — empty state", () => {
  const body = composeSigalGuestFeedbackPulse({
    last24hTotal: 0,
    last24hNegative: 0,
    openNegative: 0,
    last24hWaNegative: 0,
  });
  assertEquals(body.includes("אין משוב חדש"), true);
  assertEquals(body.includes(FEEDBACK_DASHBOARD_LINK_LABEL), true);
});

Deno.test("composeEliadDailyFeedbackLinkBlock — skips when empty", () => {
  assertEquals(
    composeEliadDailyFeedbackLinkBlock({
      last24hTotal: 0,
      last24hNegative: 0,
      openNegative: 0,
      last24hWaNegative: 0,
    }),
    "",
  );
});

Deno.test("composeEliadDailyFeedbackLinkBlock — negative deep link", () => {
  const body = composeEliadDailyFeedbackLinkBlock({
    last24hTotal: 3,
    last24hNegative: 2,
    openNegative: 1,
    last24hWaNegative: 1,
  });
  assertEquals(body.includes("לשיפור שירות"), true);
  assertEquals(body.includes("focus=negative"), true);
});

Deno.test("composeEliadFeedbackIntroOneShot — includes negative link and export hint", () => {
  const body = composeEliadFeedbackIntroOneShot({
    last24hTotal: 5,
    last24hNegative: 2,
    openNegative: 3,
    last24hWaNegative: 1,
  });
  assertEquals(body.includes("דוח משוב לשיפור שירות"), true);
  assertEquals(body.includes("focus=negative"), true);
});

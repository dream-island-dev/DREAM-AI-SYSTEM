import {
  isCheckInPolicyQuestion,
  looksLikeCheckInHoursReply,
  isReplyObviouslyTruncated,
  hasCompleteGuestMessageEnding,
  resolveTruncatedReplyFallback,
  buildCheckInPolicyReply,
} from "./checkInPolicyFaq";

const TRUNCATED_LIVE_SAMPLE =
  "שעות הכניסה לחדרים בדרים איילנד הן החל מהשעה 15:00 בימי חול, ובשבתות וחגים החל מה";

const STAGE2_PORTAL_SAMPLE =
  "איזה כיף, אנחנו כבר מחכים לכם! 🥰 כל הפרטים בקישור: https://dream-ai-system.vercel.app/portal/154d8ae3-362a-4c0f-bed5-038c17b296e0";

describe("checkInPolicyFaq", () => {
  test("detects the live truncated check-in hours reply", () => {
    expect(isReplyObviouslyTruncated(TRUNCATED_LIVE_SAMPLE)).toBe(true);
    expect(looksLikeCheckInHoursReply(TRUNCATED_LIVE_SAMPLE)).toBe(true);
  });

  test("substitutes a complete policy reply for truncated hours text", () => {
    const fixed = resolveTruncatedReplyFallback(
      TRUNCATED_LIVE_SAMPLE,
      "שלום",
      {},
      null,
      "fallback",
    );
    expect(fixed).toContain("שבתות וחגים מהשעה 18:00");
    expect(fixed).toContain("🙏");
    expect(isReplyObviouslyTruncated(fixed)).toBe(false);
  });

  test("Tier-0 catches common guest phrasings", () => {
    expect(isCheckInPolicyQuestion("מה שעות הכניסה?")).toBe(true);
    expect(isCheckInPolicyQuestion("מתי מקבלים את החדר?")).toBe(true);
    expect(isCheckInPolicyQuestion("אפשר להיכנס לחדר ב-12?")).toBe(true);
    expect(isCheckInPolicyQuestion("יש מגבת בחדר")).toBe(false);
  });

  test("complete policy reply is not flagged as truncated", () => {
    const full = buildCheckInPolicyReply({});
    expect(isReplyObviouslyTruncated(full)).toBe(false);
  });

  test("Stage 2 portal-link script is not flagged as truncated", () => {
    expect(hasCompleteGuestMessageEnding(STAGE2_PORTAL_SAMPLE)).toBe(true);
    expect(isReplyObviouslyTruncated(STAGE2_PORTAL_SAMPLE)).toBe(false);
  });
});

import {
  isCheckInPolicyQuestion,
  looksLikeCheckInHoursReply,
  isReplyObviouslyTruncated,
  hasCompleteGuestMessageEnding,
  resolveTruncatedReplyFallback,
  buildCheckInPolicyReply,
  buildDiningReplyForGuest,
  isGuestOwnMealQuestion,
} from "./checkInPolicyFaq";

const TRUNCATED_LIVE_SAMPLE =
  "שעות הכניסה לחדרים בדרים איילנד הן החל מהשעה 15:00 בימי חול, ובשבתות וחגים החל מה";

const STAGE2_PORTAL_SAMPLE =
  "איזה כיף, אנחנו כבר מחכים לכם! 🥰 כל הפרטים בקישור: https://dream-ai-system.vercel.app/portal/154d8ae3-362a-4c0f-bed5-038c17b296e0";

const TRUNCATED_DINING_SAMPLE =
  "שירות החדרים זמין בין השעות 12:00-17:00 ובין";

const TRUNCATED_MEAL_ACK_SAMPLE =
  "הכל בסדר גמור, קריסטינה. תודה רבה שיידעתם. אנחנו כאן לכל דבר אחר שתצטר";

const COMPLETE_MEAL_ACK_SAMPLE =
  "הכל בסדר גמור, קריסטינה. תודה רבה שיידעתם. אנחנו כאן לכל דבר אחר שתצטרכו";

const CASUAL_FACT_NO_PERIOD =
  "חניה חינם זמינה לכל האורחים לאורך כל ימות השבוע";

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

  test("detects live dining reply cut mid-sentence (#6)", () => {
    expect(isReplyObviouslyTruncated(TRUNCATED_DINING_SAMPLE)).toBe(true);
  });

  test("detects live meal-ack reply cut mid-word (#7)", () => {
    expect(isReplyObviouslyTruncated(TRUNCATED_MEAL_ACK_SAMPLE)).toBe(true);
  });

  test("complete meal-ack counterpart is not truncated (audit #4)", () => {
    expect(isReplyObviouslyTruncated(COMPLETE_MEAL_ACK_SAMPLE)).toBe(false);
  });

  test("casual factual reply without terminal punctuation is not truncated (audit #4)", () => {
    expect(isReplyObviouslyTruncated(CASUAL_FACT_NO_PERIOD)).toBe(false);
  });

  test("short complete ack without terminal punctuation is not truncated", () => {
    expect(isReplyObviouslyTruncated("אנחנו כאן לכל דבר אחר שתצטרכו")).toBe(false);
  });

  test("dining guest intent wins over check-in-shaped truncated reply", () => {
    const truncatedDining =
      "מסעדת ערמונים פתוחה בימי חול, ובשבתות וחגים החל מה";
    const fixed = resolveTruncatedReplyFallback(
      truncatedDining,
      "יש אוכל בערב?",
      { hotel_restaurant_hours: "07:00–22:00" },
      null,
      "fallback",
    );
    expect(fixed).toContain("מסעדת ערמונים");
    expect(fixed).not.toContain("כניסה למתחם");
    expect(fixed).not.toContain("חצי פנסיון");
    expect(isReplyObviouslyTruncated(fixed)).toBe(false);
  });

  test("generic dining question does not dump guest meal plan", () => {
    const guest = {
      meal_plan: "half_board",
      breakfast_time: "08:00",
      dinner_time: "19:30",
      guest_profile: { dietary: { tags: ["vegetarian"], note: "" } },
    };
    const fixed = resolveTruncatedReplyFallback(
      "מסעדה",
      "יש אוכל בערב?",
      { hotel_restaurant_hours: "בוקר 07:00–10:30 | ערב 18:30–22:00" },
      null,
      "fallback",
      guest,
    );
    expect(fixed).not.toContain("08:00");
    expect(fixed).not.toContain("צמחוני");
    expect(fixed).toContain("19:30");
  });

  test("own breakfast question uses pension time not restaurant pipe hours", () => {
    const kb =
      "• עמדות אוכל: נשנושים חופשיים לאורך היום.\n" +
      "• מסעדת ערמונים: ארוחת ערב 18:30–22:00, הזמנות מראש.";
    const reply = buildDiningReplyForGuest(
      { hotel_restaurant_hours: "בוקר 08:00–11:00 | ערב 18:30–22:00" },
      "מתי ארוחת הבוקר שלנו?",
      { meal_plan: "half_board", breakfast_time: "08:30", meal_location: "עמדת בוקר" },
      kb,
    );
    expect(reply).toContain("08:30");
    expect(reply).not.toContain("08:00–11:00");
    expect(reply).not.toContain("שעות ארוחת הבוקר במסעדה");
  });

  test("audit: מתי ארוחת הבוקר without שלנו still routes to own-meal path", () => {
    expect(isGuestOwnMealQuestion("מתי ארוחת הבוקר?")).toBe(true);
    const reply = buildDiningReplyForGuest(
      {},
      "מתי ארוחת הבוקר?",
      { meal_plan: "half_board", breakfast_time: "09:00" },
      "",
    );
    expect(reply).toContain("09:00");
    expect(reply).not.toContain("שעות ארוחת הבוקר במסעדה");
  });

  test("audit: no breakfast in profile falls back to KB food-station line", () => {
    const kb = "• עמדות אוכל: נשנושים חופשיים לאורך היום.";
    const reply = buildDiningReplyForGuest(
      {},
      "מתי ארוחת הבוקר שלנו?",
      { meal_plan: "half_board" },
      kb,
    );
    expect(reply).toContain("עמדות אוכל");
    expect(reply).not.toContain("שעות ארוחת הבוקר במסעדה");
  });

  test("audit: generic dining without KB omits pipe breakfast segment", () => {
    const reply = buildDiningReplyForGuest(
      { hotel_restaurant_hours: "בוקר 08:00–11:00 | ערב 18:30–22:00" },
      "יש מסעדה?",
      null,
      "",
    );
    expect(reply).toContain("18:30–22:00");
    expect(reply).not.toContain("08:00–11:00");
  });
});

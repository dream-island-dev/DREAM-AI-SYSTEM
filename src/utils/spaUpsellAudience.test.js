import {
  isSpaUpsellEligible,
  guestHasSpaOnDate,
  resolveSpaLeadAudience,
  SPA_LEAD_AUDIENCE_GROUP,
  SPA_LEAD_AUDIENCE_REGULAR,
} from "./spaUpsellAudience";

describe("spaUpsellAudience — day-pass-only eligibility", () => {
  const suiteGuest = { room_type: "suite", room: "אמטיסט 8", status: "expected", arrival_date: "2026-08-11" };
  const dayGuest = { room_type: "day_guest", room: "בילוי יומי", status: "expected", arrival_date: "2026-08-11" };
  const premiumDayGuest = { room_type: "premium_day_guest", room: "Premium Day 1", status: "expected", arrival_date: "2026-08-11" };
  const noRoomGuest = { room_type: "day_guest", room: "", status: "expected", arrival_date: "2026-08-11" };
  // Split-brain: room_type says day-pass but room is an actual physical suite —
  // must never be treated as day-pass audience (_shared/suiteNames.ts hasSuiteRoomTypeConflict).
  const mistaggedSuiteGuest = { room_type: "day_guest", room: "רובי 14", status: "expected", arrival_date: "2026-08-11" };

  test("suite guest never appears in the day-pass spa upsell audience", () => {
    expect(isSpaUpsellEligible(suiteGuest, "2026-08-11")).toBe(false);
  });

  test("day-pass and Premium Day guests without a spa booking are eligible", () => {
    expect(isSpaUpsellEligible(dayGuest, "2026-08-11")).toBe(true);
    expect(isSpaUpsellEligible(premiumDayGuest, "2026-08-11")).toBe(true);
  });

  test("guest with no room assigned is excluded", () => {
    expect(isSpaUpsellEligible(noRoomGuest, "2026-08-11")).toBe(false);
  });

  test("room_type mistagged 'day_guest' but room is a canonical suite is excluded", () => {
    expect(isSpaUpsellEligible(mistaggedSuiteGuest, "2026-08-11")).toBe(false);
  });

  test("day-pass guest with a spa_time already booked is not eligible", () => {
    expect(isSpaUpsellEligible({ ...dayGuest, spa_time: "14:00" }, "2026-08-11")).toBe(false);
  });

  test("day-pass guest already sent the upsell is not eligible", () => {
    expect(isSpaUpsellEligible({ ...dayGuest, msg_spa_upsell_sent: true }, "2026-08-11")).toBe(false);
  });

  test("cancelled day-pass guest is not eligible", () => {
    expect(isSpaUpsellEligible({ ...dayGuest, status: "cancelled" }, "2026-08-11")).toBe(false);
  });

  test("guestHasSpaOnDate matches spa_date against the given date", () => {
    expect(guestHasSpaOnDate(dayGuest, "2026-08-11")).toBe(false);
    expect(guestHasSpaOnDate({ ...dayGuest, spa_date: "2026-08-11" }, "2026-08-11")).toBe(true);
  });
});

describe("resolveSpaLeadAudience", () => {
  test("untagged/legacy guest defaults to regular", () => {
    expect(resolveSpaLeadAudience({})).toBe(SPA_LEAD_AUDIENCE_REGULAR);
    expect(resolveSpaLeadAudience({ guest_profile: {} })).toBe(SPA_LEAD_AUDIENCE_REGULAR);
  });

  test("manual group tag (SpaUpsellConfirmModal) reads as group", () => {
    const guest = { guest_profile: { spa: { lead_audience: "group" } } };
    expect(resolveSpaLeadAudience(guest)).toBe(SPA_LEAD_AUDIENCE_GROUP);
  });

  test("wa.me campaign link (spaGroupCampaign.ts) also reads as group", () => {
    expect(resolveSpaLeadAudience({ guest_profile: { spa: { group_campaign: "everest-2026-08-10" } } }))
      .toBe(SPA_LEAD_AUDIENCE_GROUP);
    expect(resolveSpaLeadAudience({ guest_profile: { spa: { source: "wa_group_link" } } }))
      .toBe(SPA_LEAD_AUDIENCE_GROUP);
  });
});

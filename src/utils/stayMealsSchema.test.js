import {
  buildMealsItinerary,
  normalizeMealPlan,
  applyLegacyMealColumns,
  MEAL_SLOTS_BY_PLAN,
} from "../data/stayMealsSchema";
import {
  remarkContainsOccupantIdentity,
  inferBookingTypeFromGuest,
} from "../utils/guestStaySummary";

describe("stayMealsSchema", () => {
  test("half_board shows breakfast + dinner slots", () => {
    expect(MEAL_SLOTS_BY_PLAN.half_board).toEqual(["breakfast", "dinner"]);
  });

  test("buildMealsItinerary full_board with times", () => {
    const rows = buildMealsItinerary({
      meal_plan: "full_board",
      meal_location: "מסעדת ערמונים",
      breakfast_time: "08:00",
      lunch_time: "13:00",
      dinner_time: "19:30",
    });
    expect(rows.some((r) => r.value === "פנסיון מלא")).toBe(true);
    expect(rows.some((r) => r.value.includes("08:00"))).toBe(true);
    expect(rows.some((r) => r.value.includes("19:30"))).toBe(true);
  });

  test("applyLegacyMealColumns sets meal_time from dinner", () => {
    const cols = applyLegacyMealColumns(
      "dinner_only",
      { breakfast: "", lunch: "", dinner: "20:00" },
      "מסעדת ערמונים",
    );
    expect(cols.meal_time).toBe("20:00");
    expect(normalizeMealPlan(cols.meal_plan)).toBe("dinner_only");
  });
});

describe("guestStaySummary booking type", () => {
  test("remark with name+phone → group", () => {
    expect(remarkContainsOccupantIdentity("נוי 050-1234567")).toBe(true);
    expect(inferBookingTypeFromGuest({ guest_notes: "נוי 050-1234567" })).toBe("group");
  });

  test("empty remark → private", () => {
    expect(inferBookingTypeFromGuest({ guest_notes: "" })).toBe("private");
  });

  test("manual override wins", () => {
    expect(inferBookingTypeFromGuest({
      guest_notes: "נוי 050-1234567",
      guest_profile: { stay: { booking_type: "private" } },
    })).toBe("private");
  });
});

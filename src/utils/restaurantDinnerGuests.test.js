import { describe, it, expect } from "vitest";
import {
  filterRestaurantDinnerGuests,
  isRestaurantBoardGuest,
  isRestaurantDinnerGuest,
  buildRestaurantDinnerMealPatch,
  getCoordinationSlotsForGuest,
  guestNeedsMealCoordination,
  getEffectiveMealPlanForRestaurant,
} from "./restaurantDinnerGuests";

describe("restaurantDinnerGuests", () => {
  const today = "2026-07-19";

  it("includes half_board guest in resort today", () => {
    const g = {
      status: "checked_in",
      arrival_date: "2026-07-18",
      departure_date: "2026-07-20",
      meal_plan: "half_board",
    };
    expect(isRestaurantBoardGuest(g, today)).toBe(true);
    expect(isRestaurantDinnerGuest(g, today)).toBe(true);
  });

  it("includes full_board guest needing lunch coordination", () => {
    const g = {
      status: "checked_in",
      arrival_date: today,
      departure_date: today,
      meal_plan: "full_board",
      dinner_time: "19:30",
    };
    expect(getCoordinationSlotsForGuest(g)).toEqual(["lunch", "dinner"]);
    expect(guestNeedsMealCoordination(g)).toBe(true);
  });

  it("excludes cancelled guest", () => {
    const g = {
      status: "cancelled",
      arrival_date: today,
      meal_plan: "half_board",
    };
    expect(isRestaurantBoardGuest(g, today)).toBe(false);
  });

  it("buildRestaurantDinnerMealPatch syncs meal_time from dinner", () => {
    const patch = buildRestaurantDinnerMealPatch(
      { meal_plan: "half_board", breakfast_time: "08:00" },
      { dinnerTime: "19:30", mealLocation: "מסעדת ערמונים" },
    );
    expect(patch.dinner_time).toBe("19:30");
    expect(patch.meal_time).toBe("19:30");
    expect(patch.meal_location).toBe("מסעדת ערמונים");
  });

  it("buildRestaurantDinnerMealPatch syncs lunch_time", () => {
    const patch = buildRestaurantDinnerMealPatch(
      { meal_plan: "full_board", dinner_time: "20:00" },
      { lunchTime: "13:00", mealLocation: "מסעדת ערמונים" },
    );
    expect(patch.lunch_time).toBe("13:00");
    expect(patch.dinner_time).toBe("20:00");
    expect(patch.meal_time).toBe("20:00");
  });

  it("includes suite guest in resort without meal_plan", () => {
    const g = {
      status: "checked_in",
      arrival_date: today,
      departure_date: today,
      meal_plan: "none",
      room: "אמטיסט 8",
      room_type: "suite",
    };
    expect(isRestaurantBoardGuest(g, today)).toBe(true);
    expect(getCoordinationSlotsForGuest(g)).toEqual(["dinner"]);
    expect(guestNeedsMealCoordination(g)).toBe(true);
  });

  it("getEffectiveMealPlanForRestaurant defaults suite to half_board", () => {
    const g = { meal_plan: "none", room: "רובי 14" };
    expect(getEffectiveMealPlanForRestaurant(g)).toBe("half_board");
  });

  it("filterRestaurantDinnerGuests", () => {
    const rows = filterRestaurantDinnerGuests([
      { status: "checked_in", arrival_date: today, departure_date: today, meal_plan: "none", room: "אמטיסט 8" },
      { status: "checked_in", arrival_date: today, departure_date: today, meal_plan: "none" },
      { status: "checked_in", arrival_date: today, departure_date: today, meal_plan: "dinner_only" },
      { status: "checked_in", arrival_date: today, departure_date: today, meal_plan: "full_board" },
    ], today);
    expect(rows.length).toBe(3);
  });

  it("includes walk-in guest flagged in profile", () => {
    const g = {
      status: "checked_in",
      arrival_date: today,
      departure_date: today,
      meal_plan: "none",
      guest_profile: { restaurant: { walk_in: true } },
    };
    expect(isRestaurantBoardGuest(g, today)).toBe(true);
  });
});

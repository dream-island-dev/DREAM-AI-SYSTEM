import { describe, it, expect } from "vitest";
import { normalizeRestaurantKioskUi } from "./restaurantKioskUi";

describe("restaurantKioskUi", () => {
  it("returns defaults when raw is null", () => {
    const ui = normalizeRestaurantKioskUi(null);
    expect(ui.welcome_line).toContain("ברוכים הבאים");
    expect(ui.kosher_badge).toBe(true);
    expect(ui.wa_signature).toContain("ערמונים");
  });

  it("merges partial overrides", () => {
    const ui = normalizeRestaurantKioskUi({
      welcome_line: "שלום משמרת",
      shift_manager_pin: "1234",
    });
    expect(ui.welcome_line).toBe("שלום משמרת");
    expect(ui.shift_manager_pin).toBe("1234");
    expect(ui.external_menu_url).toContain("armmonim");
  });
});

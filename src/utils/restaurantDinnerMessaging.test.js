import { describe, it, expect } from "vitest";
import {
  composeAskMessage,
  composeConfirmMessage,
  renderDinnerMessageTemplate,
  buildDinnerMessageVars,
} from "./restaurantDinnerMessagesConfig";
import { resolveRestaurantGuestWaChannel } from "./restaurantDinnerMessaging";

describe("restaurantDinnerMessagesConfig", () => {
  it("composeAskMessage with slots", () => {
    const msg = composeAskMessage(null, {
      guestName: "דני",
      slots: ["19:00", "19:30"],
      location: "מסעדת ערמונים",
    });
    expect(msg).toContain("היי דני");
    expect(msg).toContain("19:00");
  });

  it("composeConfirmMessage", () => {
    const msg = composeConfirmMessage(null, {
      guestName: "דני",
      time: "20:00",
      location: "מסעדת ערמונים",
    });
    expect(msg).toContain("20:00");
  });

  it("renderDinnerMessageTemplate placeholders", () => {
    const vars = buildDinnerMessageVars({ guestName: "רות", location: "ערמונים" });
    const out = renderDinnerMessageTemplate("שלום {{greeting}} ב-{{location}}", vars);
    expect(out).toContain("היי רות");
    expect(out).toContain("ערמונים");
  });
});

describe("resolveRestaurantGuestWaChannel", () => {
  it("suite vs day pass", () => {
    expect(resolveRestaurantGuestWaChannel({ room: "אמטיסט 8" })).toBe("whapi");
    expect(resolveRestaurantGuestWaChannel({ room_type: "day_guest" })).toBe("meta");
  });
});

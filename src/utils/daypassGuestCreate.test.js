import { buildDaypassGuestRec } from "./daypassGuestCreate";

describe("buildDaypassGuestRec", () => {
  test("maps paste row fields", () => {
    const rec = buildDaypassGuestRec({
      phone: "+972501234567",
      name: "ישראל",
      arrivalDate: "2026-07-28",
    });
    expect(rec.phone).toBe("+972501234567");
    expect(rec.guest_name).toBe("ישראל");
    expect(rec.arrival_date).toBe("2026-07-28");
    expect(rec.room_type).toBeUndefined();
  });

  test("maps Doc1 import row with spa", () => {
    const rec = buildDaypassGuestRec({
      phone: "+972501234567",
      guest_name: "דנה",
      arrival_date: "2026-07-29",
      spa_time: "14:00",
      order_number: "12345",
      meal_time: "13:00",
    });
    expect(rec.guest_name).toBe("דנה");
    expect(rec.spa_time).toBe("14:00");
    expect(rec.order_number).toBe("12345");
    expect(rec.meal_time).toBe("13:00");
  });
});

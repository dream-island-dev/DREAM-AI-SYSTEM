import { assertPipelineLifecycleForTrigger } from "./pipelineLifecycle";

function israelDateOffsetStr(offsetDays, base = new Date()) {
  const d = new Date(base);
  d.setDate(d.getDate() + offsetDays);
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
}

describe("assertPipelineLifecycleForTrigger — checkout_fb", () => {
  const now = new Date("2026-07-05T12:00:00+03:00");
  const today = israelDateOffsetStr(0, now);
  const yesterday = israelDateOffsetStr(-1, now);
  const tomorrow = israelDateOffsetStr(1, now);
  const nextWeek = israelDateOffsetStr(7, now);

  test("blocks future arrival (השערים נסגרו לפני שהגיע)", () => {
    expect(
      assertPipelineLifecycleForTrigger(
        "checkout_fb",
        {
          arrival_date: tomorrow,
          departure_date: nextWeek,
          status: "expected",
        },
        now,
      ),
    ).toBe("guest_not_arrived");
  });

  test("blocks when stay has not ended", () => {
    expect(
      assertPipelineLifecycleForTrigger(
        "checkout_fb",
        {
          arrival_date: yesterday,
          departure_date: today,
          status: "checked_in",
        },
        now,
      ),
    ).toBe("stay_not_ended");
  });

  test("blocks no-show (pending after departure)", () => {
    expect(
      assertPipelineLifecycleForTrigger(
        "checkout_fb",
        {
          arrival_date: israelDateOffsetStr(-3, now),
          departure_date: yesterday,
          status: "pending",
        },
        now,
      ),
    ).toBe("guest_never_checked_in");
  });

  test("allows checked_out guest day after departure", () => {
    expect(
      assertPipelineLifecycleForTrigger(
        "checkout_fb",
        {
          arrival_date: israelDateOffsetStr(-3, now),
          departure_date: yesterday,
          status: "checked_out",
        },
        now,
      ),
    ).toBeNull();
  });

  test("blocks invalid stay dates (departure before arrival)", () => {
    expect(
      assertPipelineLifecycleForTrigger(
        "checkout_fb",
        {
          arrival_date: nextWeek,
          departure_date: yesterday,
          status: "expected",
        },
        now,
      ),
    ).toBe("invalid_stay_dates");
  });
});

describe("assertPipelineLifecycleForTrigger — in-stay / morning", () => {
  const now = new Date("2026-07-05T12:00:00+03:00");
  const tomorrow = israelDateOffsetStr(1, now);

  test("mid_stay blocked for future arrival", () => {
    expect(
      assertPipelineLifecycleForTrigger(
        "mid_stay",
        { arrival_date: tomorrow, departure_date: israelDateOffsetStr(3, now), status: "expected" },
        now,
      ),
    ).toBe("guest_not_arrived");
  });

  test("morning_suite blocked for future arrival", () => {
    expect(
      assertPipelineLifecycleForTrigger(
        "morning_suite",
        { arrival_date: tomorrow, status: "expected" },
        now,
      ),
    ).toBe("guest_not_arrived");
  });
});

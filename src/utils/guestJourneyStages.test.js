import {
  buildGuestJourneyFromFlags,
  mergeQueueIntoJourney,
  SKIP_REASON_LABELS,
} from "./guestJourneyStages";

describe("guestJourneyStages", () => {
  it("builds suite journey steps from flags", () => {
    const steps = buildGuestJourneyFromFlags({
      room_type: "suite",
      msg_pre_arrival_2d_sent: true,
      msg_checkout_fb_sent: false,
    });
    expect(steps.some((s) => s.key === "morning_suite")).toBe(true);
    expect(steps.find((s) => s.key === "pre_arrival_2d")?.sent).toBe(true);
  });

  it("merges queue skip reasons", () => {
    const base = buildGuestJourneyFromFlags({
      room_type: "suite",
      arrival_date: "2099-06-01",
    });
    const merged = mergeQueueIntoJourney(base, [
      { stageKey: "checkout_fb", status: "pending", skipReason: "guest_not_arrived" },
    ]);
    const step = merged.find((s) => s.key === "checkout_fb");
    expect(step?.status).toBe("blocked");
    expect(step?.skipLabel).toBe(SKIP_REASON_LABELS.guest_not_arrived);
  });
});

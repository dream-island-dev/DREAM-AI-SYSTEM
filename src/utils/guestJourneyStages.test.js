import {
  buildGuestJourneyFromFlags,
  mergeQueueIntoJourney,
  SKIP_REASON_LABELS,
} from "./guestJourneyStages";

describe("guestJourneyStages", () => {
  it("builds suite journey only (no day-pass stages)", () => {
    const steps = buildGuestJourneyFromFlags({
      room_type: "standard",
      room: "אקווה מרין 26",
      msg_pre_arrival_2d_sent: true,
      msg_checkout_fb_sent: false,
    });
    expect(steps.some((s) => s.key === "morning_suite")).toBe(true);
    expect(steps.some((s) => s.key === "morning_welcome")).toBe(false);
    expect(steps.some((s) => s.key === "mid_stay_daypass")).toBe(false);
    expect(steps.find((s) => s.key === "pre_arrival_2d")?.sent).toBe(true);
  });

  it("builds day-pass journey only", () => {
    const steps = buildGuestJourneyFromFlags({
      room_type: "day_guest",
      room: "Premium Day 1",
    });
    expect(steps.some((s) => s.key === "morning_welcome")).toBe(true);
    expect(steps.some((s) => s.key === "morning_suite")).toBe(false);
  });

  it("merges queue skip reasons", () => {
    const guest = { room_type: "suite", room: "רובי 14", arrival_date: "2099-06-01" };
    const base = buildGuestJourneyFromFlags(guest);
    const merged = mergeQueueIntoJourney(base, [
      { stageKey: "checkout_fb", status: "pending", skipReason: "guest_not_arrived" },
      { stageKey: "mid_stay_daypass", status: "pending", skipReason: "wrong_room_type" },
    ], guest);
    const step = merged.find((s) => s.key === "checkout_fb");
    expect(step?.status).toBe("blocked");
    expect(step?.skipLabel).toBe(SKIP_REASON_LABELS.guest_not_arrived);
    expect(merged.some((s) => s.key === "mid_stay_daypass")).toBe(false);
  });
});

import {
  classifyStagePipelineSegment,
  filterQueueItemsForGuest,
  isEffectiveDayPassGuest,
  isEffectiveSuiteGuest,
  queueItemAppliesToGuest,
  resolveGuestPipelineSegment,
} from "./pipelineSegment";

describe("pipelineSegment", () => {
  const suiteGuest = { room_type: "standard", room: "אקווה מרין 26" };
  const dayGuest = { room_type: "day_guest", room: "Premium Day 1" };
  const unassignedGuest = { room_type: "suite", room: "" };
  const misTaggedPremium = { room_type: "suite", room: "Premium Day 1" };

  test("suite room routes as suite", () => {
    expect(resolveGuestPipelineSegment(suiteGuest)).toBe("suite");
  });

  test("day guest routes as daypass", () => {
    expect(resolveGuestPipelineSegment(dayGuest)).toBe("daypass");
  });

  test("no room assignment routes as unassigned", () => {
    expect(resolveGuestPipelineSegment(unassignedGuest)).toBe("unassigned");
    expect(isEffectiveSuiteGuest(unassignedGuest)).toBe(false);
    expect(isEffectiveDayPassGuest(unassignedGuest)).toBe(false);
  });

  test("Premium Day mis-tagged suite routes as daypass", () => {
    expect(resolveGuestPipelineSegment(misTaggedPremium)).toBe("daypass");
    expect(isEffectiveSuiteGuest(misTaggedPremium)).toBe(false);
    expect(isEffectiveDayPassGuest(misTaggedPremium)).toBe(true);
  });

  test("unassigned guest sees no queue stages", () => {
    expect(queueItemAppliesToGuest({ stageKey: "pre_arrival_2d" }, unassignedGuest)).toBe(false);
    expect(queueItemAppliesToGuest({ stageKey: "morning_suite" }, unassignedGuest)).toBe(false);
  });

  test("suite guest never sees daypass-only stages", () => {
    expect(queueItemAppliesToGuest({ stageKey: "mid_stay_daypass" }, suiteGuest)).toBe(false);
    expect(queueItemAppliesToGuest({ stageKey: "mid_stay" }, suiteGuest)).toBe(true);
    expect(queueItemAppliesToGuest({ stageKey: "pre_arrival_2d" }, suiteGuest)).toBe(true);
  });

  test("day guest never sees suite-only stages", () => {
    expect(queueItemAppliesToGuest({ stageKey: "morning_suite" }, dayGuest)).toBe(false);
    expect(queueItemAppliesToGuest({ stageKey: "morning_welcome" }, dayGuest)).toBe(true);
  });

  test("filter removes cross-pipeline rows", () => {
    const items = [
      { stageKey: "pre_arrival_2d" },
      { stageKey: "mid_stay" },
      { stageKey: "mid_stay_daypass" },
      { stageKey: "morning_suite" },
      { stageKey: "morning_welcome" },
    ];
    const suiteOnly = filterQueueItemsForGuest(items, suiteGuest);
    expect(suiteOnly.map((i) => i.stageKey)).toEqual([
      "pre_arrival_2d",
      "mid_stay",
      "morning_suite",
    ]);
  });

  test("classify by applies_to fallback", () => {
    expect(classifyStagePipelineSegment("custom_stage", "suite")).toBe("suite");
    expect(classifyStagePipelineSegment("custom_stage", "non_suite")).toBe("daypass");
    expect(classifyStagePipelineSegment("custom_stage", "daypass_spa")).toBe("daypass");
    expect(classifyStagePipelineSegment("custom_stage", "suite_no_spa")).toBe("suite");
  });
});

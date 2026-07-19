import { describe, it, expect } from "vitest";
import {
  normalizeWaiterPulseUi,
  validateWaiterPulseAnswers,
} from "./waiterPulseUi";

describe("waiterPulseUi", () => {
  it("normalizes default survey", () => {
    const ui = normalizeWaiterPulseUi(null);
    expect(ui.questions).toHaveLength(3);
    expect(ui.panel_title).toContain("שאלון תפעול");
  });

  it("validates required text min length", () => {
    const ui = normalizeWaiterPulseUi(null);
    const err = validateWaiterPulseAnswers(ui, {
      service_bottleneck: "kitchen_bar_timing",
      recurring_guest_complaint: "slow_response",
      one_improvement: "קצר",
    });
    expect(err).toBeTruthy();
  });
});

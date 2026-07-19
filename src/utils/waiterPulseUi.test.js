import { describe, it, expect } from "vitest";
import {
  normalizeWaiterPulseUi,
  validateWaiterPulseAnswers,
} from "./waiterPulseUi";

describe("waiterPulseUi", () => {
  it("normalizes default survey", () => {
    const ui = normalizeWaiterPulseUi(null);
    expect(ui.questions.length).toBeGreaterThanOrEqual(5);
  });

  it("validates required text min length", () => {
    const ui = normalizeWaiterPulseUi(null);
    const err = validateWaiterPulseAnswers(ui, {
      system_friction: ["peak_load"],
      guest_pain_point: "waiting",
      change_tomorrow: "קצר",
      one_idea: "רעיון ארוך מספיק לבדיקה",
    });
    expect(err).toBeTruthy();
  });
});

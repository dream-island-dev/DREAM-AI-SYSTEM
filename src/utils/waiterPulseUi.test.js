import { describe, it, expect } from "vitest";
import {
  normalizeWaiterPulseUi,
  validateWaiterPulseAnswers,
} from "./waiterPulseUi";

describe("waiterPulseUi", () => {
  it("normalizes default survey", () => {
    const ui = normalizeWaiterPulseUi(null);
    expect(ui.questions).toHaveLength(12);
    expect(ui.panel_title).toContain("שאלון מלצרים");
    expect(ui.questions[6].help_text).toContain("טיפים משותפים");
  });

  it("validates required fields on complete answers", () => {
    const ui = normalizeWaiterPulseUi(null);
    const err = validateWaiterPulseAnswers(ui, {
      tenure: "over_year",
      manager_presence: "yes",
      manager_respect: "yes",
      manager_improvements: ["fair_shifts"],
      team_cooperation: "yes",
      tip_agreement_awareness: "yes",
      tips_policy_aware: "yes",
      tips_policy_change: "no_change",
      training_sufficient: "yes",
      service_knowledge_gaps: ["confident"],
      cross_team_difficulty: ["no_difficulty"],
    });
    expect(err).toBeNull();
  });

  it("requires other text when tips change yes is selected", () => {
    const ui = normalizeWaiterPulseUi(null);
    const err = validateWaiterPulseAnswers(ui, {
      tenure: "over_year",
      manager_presence: "yes",
      manager_respect: "yes",
      manager_improvements: ["fair_shifts"],
      team_cooperation: "yes",
      tip_agreement_awareness: "yes",
      tips_policy_aware: "yes",
      tips_policy_change: "__other__",
      training_sufficient: "yes",
      service_knowledge_gaps: ["confident"],
      cross_team_difficulty: ["no_difficulty"],
    });
    expect(err).toBeTruthy();
  });
});

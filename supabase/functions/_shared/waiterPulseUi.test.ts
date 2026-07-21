import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  normalizeWaiterPulseUi,
  validateWaiterPulseAnswers,
} from "./waiterPulseUi.ts";

Deno.test("normalizeWaiterPulseUi — keeps default questions", () => {
  const ui = normalizeWaiterPulseUi(null);
  assertEquals(ui.questions.length, 12);
  assertEquals(ui.panel_title.includes("שאלון מלצרים"), true);
});

Deno.test("validateWaiterPulseAnswers — passes complete answers", () => {
  const ui = normalizeWaiterPulseUi(null);
  const err = validateWaiterPulseAnswers(ui, {
    tenure: "3_6_months",
    manager_presence: "yes",
    manager_respect: "no",
    manager_improvements: ["clear_communication", "more_training"],
    team_cooperation: "yes",
    tip_agreement_awareness: "no",
    tips_policy_aware: "yes",
    tips_policy_change: "no_change",
    training_sufficient: "no",
    service_knowledge_gaps: ["food_menu", "wine_bar"],
    cross_team_difficulty: ["kitchen"],
    additional_comments: "הכל טוב",
  });
  assertEquals(err, null);
});

Deno.test("validateWaiterPulseAnswers — requires tips change rationale", () => {
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
  assertEquals(typeof err, "string");
});

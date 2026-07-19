import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  normalizeWaiterPulseUi,
  validateWaiterPulseAnswers,
} from "../waiterPulseUi.ts";

Deno.test("normalizeWaiterPulseUi — keeps default questions", () => {
  const ui = normalizeWaiterPulseUi(null);
  assertEquals(ui.questions.length, 3);
  assertEquals(ui.panel_title.includes("שאלון תפעול"), true);
});

Deno.test("validateWaiterPulseAnswers — requires one_improvement min length", () => {
  const ui = normalizeWaiterPulseUi(null);
  const err = validateWaiterPulseAnswers(ui, {
    service_bottleneck: ["kitchen_bar_timing"],
    recurring_guest_complaint: ["slow_response"],
    one_improvement: "קצר",
  });
  assertEquals(typeof err, "string");
});

Deno.test("validateWaiterPulseAnswers — passes complete answers", () => {
  const ui = normalizeWaiterPulseUi(null);
  const err = validateWaiterPulseAnswers(ui, {
    service_bottleneck: ["systems_sync", "workload_split"],
    recurring_guest_complaint: ["no_complaints"],
    one_improvement: "לוח ערב משותף עם קבלה בזמן אמת לכל שולחן",
  });
  assertEquals(err, null);
});

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  normalizeWaiterPulseUi,
  validateWaiterPulseAnswers,
  formatWaiterPulseAnswerForDisplay,
} from "../waiterPulseUi.ts";

Deno.test("normalizeWaiterPulseUi — keeps default questions", () => {
  const ui = normalizeWaiterPulseUi(null);
  assertEquals(ui.questions.length >= 5, true);
  assertEquals(ui.panel_title.includes("רצפה"), true);
});

Deno.test("validateWaiterPulseAnswers — requires change_tomorrow min length", () => {
  const ui = normalizeWaiterPulseUi(null);
  const err = validateWaiterPulseAnswers(ui, {
    system_friction: ["peak_load"],
    guest_pain_point: "waiting",
    change_tomorrow: "קצר",
    one_idea: "רעיון מספיק ארוך לבדיקה",
  });
  assertEquals(typeof err, "string");
});

Deno.test("validateWaiterPulseAnswers — passes complete answers", () => {
  const ui = normalizeWaiterPulseUi(null);
  const err = validateWaiterPulseAnswers(ui, {
    system_friction: ["no_table_time"],
    guest_pain_point: "waiting",
    change_tomorrow: "נשלח שעת שולחן לפני הערב לכל אורח",
    one_idea: "לוח ערב משותף עם קבלה בזמן אמת",
    submitter_name: "דני",
  });
  assertEquals(err, null);
});

Deno.test("formatWaiterPulseAnswerForDisplay — multi choice", () => {
  const ui = normalizeWaiterPulseUi(null);
  const q = ui.questions.find((x) => x.key === "system_friction");
  const text = formatWaiterPulseAnswerForDisplay(q, {
    system_friction: ["peak_load", "kitchen_comms"],
  });
  assertEquals(text.includes("עומס"), true);
});

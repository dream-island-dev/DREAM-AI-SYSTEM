import {
  DEFAULT_GUEST_SURVEY_UI,
  DEFAULT_SUITES_CTA_URL,
  isPositiveSurveyAverage,
  normalizeGuestSurveyUi,
} from "./guestSurveyUi.ts";

Deno.test("normalizeGuestSurveyUi — custom category preserved", () => {
  const ui = normalizeGuestSurveyUi({
    categories: [{ key: "cat_pool", label: "בריכה" }],
    suites_cta_url: "https://www.dream-island.co.il/suites",
  });
  if (ui.categories.length !== 1 || ui.categories[0].key !== "cat_pool") {
    throw new Error("custom category not preserved");
  }
  if (ui.suites_cta_url !== DEFAULT_SUITES_CTA_URL) {
    throw new Error("suites url mismatch");
  }
});

Deno.test("normalizeGuestSurveyUi — defaults on empty categories", () => {
  const ui = normalizeGuestSurveyUi({ categories: [] });
  if (ui.categories.length !== DEFAULT_GUEST_SURVEY_UI.categories.length) {
    throw new Error("expected defaults");
  }
});

Deno.test("isPositiveSurveyAverage (1-3 scale)", () => {
  if (!isPositiveSurveyAverage(3, [1, 1, 1])) throw new Error("expected positive overall 3");
  if (!isPositiveSurveyAverage(2, [3, 3, 3])) throw new Error("expected positive overall 2");
  if (isPositiveSurveyAverage(1, [3, 3, 3])) throw new Error("expected not positive overall 1");
});

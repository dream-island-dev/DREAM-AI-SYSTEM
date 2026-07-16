import {
  BOT_CONFIG_SURVEY_UI_KEY,
  DEFAULT_GUEST_SURVEY_UI,
  DEFAULT_SUITES_CTA_URL,
  LEGACY_SURVEY_CATEGORY_KEYS,
  SURVEY_MAX_CATEGORIES,
  addSurveyCategory,
  isPositiveSurveyAverage,
  isValidSurveyCategoryKey,
  makeSurveyCategoryKey,
  normalizeGuestSurveyUi,
  removeSurveyCategory,
  resolveSurveyCategoryScores,
  serializeGuestSurveyUi,
  isLowScoreSurveyRow,
} from "./guestSurveyUi";

describe("guestSurveyUi dynamic categories", () => {
  test("BOT_CONFIG key + suites defaults", () => {
    expect(BOT_CONFIG_SURVEY_UI_KEY).toBe("guest_survey_ui");
    expect(DEFAULT_GUEST_SURVEY_UI.suites_cta_url).toBe(DEFAULT_SUITES_CTA_URL);
  });

  test("normalize preserves custom category order and keys", () => {
    const ui = normalizeGuestSurveyUi({
      categories: [
        { key: "spa", label: "ספא" },
        { key: "cat_abc123", label: "בריכה פרטית" },
      ],
    });
    expect(ui.categories).toHaveLength(2);
    expect(ui.categories[1].key).toBe("cat_abc123");
    expect(ui.categories[1].label).toBe("בריכה פרטית");
  });

  test("normalize rejects invalid keys and empty list → defaults", () => {
    expect(normalizeGuestSurveyUi({ categories: [{ key: "BAD!", label: "x" }] }).categories).toHaveLength(6);
    expect(isValidSurveyCategoryKey("cat_ok")).toBe(true);
    expect(isValidSurveyCategoryKey("1bad")).toBe(false);
  });

  test("addSurveyCategory / removeSurveyCategory honor min/max", () => {
    let ui = cloneOrDefault();
    const before = ui.categories.length;
    ui = addSurveyCategory(ui, "חדש");
    expect(ui.categories.length).toBe(before + 1);
    expect(ui.categories[ui.categories.length - 1].label).toBe("חדש");
    const key = ui.categories[ui.categories.length - 1].key;
    ui = removeSurveyCategory(ui, key);
    expect(ui.categories.length).toBe(before);

    // cannot remove below min
    ui = normalizeGuestSurveyUi({ categories: [{ key: "spa", label: "ספא" }] });
    expect(removeSurveyCategory(ui, "spa").categories).toHaveLength(1);
  });

  test("makeSurveyCategoryKey is unique among existing", () => {
    const k = makeSurveyCategoryKey(["cat_aaaaaa"]);
    expect(isValidSurveyCategoryKey(k)).toBe(true);
    expect(k).not.toBe("cat_aaaaaa");
  });

  test("add refuses beyond SURVEY_MAX_CATEGORIES", () => {
    let ui = { categories: [] };
    for (let i = 0; i < SURVEY_MAX_CATEGORIES; i++) {
      ui = addSurveyCategory(ui, `C${i}`);
    }
    expect(ui.categories.length).toBe(SURVEY_MAX_CATEGORIES);
    const blocked = addSurveyCategory(ui, "overflow");
    expect(blocked.categories.length).toBe(SURVEY_MAX_CATEGORIES);
  });

  test("serialize round-trip keeps custom cat", () => {
    const ui = normalizeGuestSurveyUi({
      categories: [{ key: "cat_xyz", label: "יין" }],
      suites_cta_label: "לינה?",
    });
    const again = normalizeGuestSurveyUi(serializeGuestSurveyUi(ui));
    expect(again.categories[0].label).toBe("יין");
    expect(again.suites_cta_label).toBe("לינה?");
  });

  test("resolveSurveyCategoryScores prefers ratings jsonb", () => {
    const row = {
      patio: 3,
      ratings: { spa: 9, cat_x: 8 },
    };
    const resolved = resolveSurveyCategoryScores(row, [
      { key: "spa", label: "ספא" },
      { key: "cat_x", label: "אחר" },
      { key: "patio", label: "פטיו" },
    ]);
    expect(resolved.find((c) => c.key === "spa").score).toBe(9);
    expect(resolved.find((c) => c.key === "cat_x").score).toBe(8);
    expect(resolved.find((c) => c.key === "patio").score).toBe(3);
  });

  test("isLowScoreSurveyRow uses ratings", () => {
    expect(isLowScoreSurveyRow({
      overall_experience: 3,
      ratings: { spa: 1 },
    })).toBe(true);
    expect(isLowScoreSurveyRow({
      overall_experience: 3,
      ratings: { spa: 2 },
    })).toBe(false);
  });

  test("isPositiveSurveyAverage gate (1-3 scale)", () => {
    expect(isPositiveSurveyAverage(3, [1, 1, 1])).toBe(true);
    expect(isPositiveSurveyAverage(2, [3, 3, 3])).toBe(true);
    expect(isPositiveSurveyAverage(1, [3, 3, 3])).toBe(false);
  });

  test("legacy keys still listed", () => {
    expect(LEGACY_SURVEY_CATEGORY_KEYS).toContain("patio");
  });
});

function cloneOrDefault() {
  return normalizeGuestSurveyUi(null);
}

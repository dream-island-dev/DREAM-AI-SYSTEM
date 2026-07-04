import { buildIsraeliTimeOptions, buildSpaWhenPhrase, formatSpaSchedule, normalizeHmTime } from "./israeliTime";

describe("normalizeHmTime", () => {
  test("pads single-digit hour", () => {
    expect(normalizeHmTime("9:30")).toBe("09:30");
  });
  test("empty stays empty", () => {
    expect(normalizeHmTime("")).toBe("");
  });
});

describe("buildIsraeliTimeOptions", () => {
  test("includes imported odd minute", () => {
    const opts = buildIsraeliTimeOptions("14:17");
    expect(opts.some((o) => o.value === "14:17")).toBe(true);
  });
});

describe("formatSpaSchedule", () => {
  test("combines date and time", () => {
    const s = formatSpaSchedule("2026-07-05", "14:30");
    expect(s).toContain("14:30");
    expect(s).toContain("·");
  });
});

describe("buildSpaWhenPhrase", () => {
  test("includes date and time in Hebrew phrase", () => {
    const p = buildSpaWhenPhrase("2026-07-05", "14:30");
    expect(p).toContain("14:30");
    expect(p).toContain("05.07.2026");
  });
  test("time only when no date", () => {
    expect(buildSpaWhenPhrase(null, "14:30")).toContain("14:30");
  });
});

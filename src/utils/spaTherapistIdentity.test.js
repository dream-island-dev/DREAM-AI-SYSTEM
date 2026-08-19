import {
  canonicalizeTherapistName,
  catalogTherapists,
  isPlaceholderTherapistName,
  therapistMatchKey,
  planTherapistMerges,
  resolveTherapistIdFromName,
  shiftTherapistsForDay,
} from "./spaTherapistIdentity";

describe("isPlaceholderTherapistName", () => {
  test("migration 176 slots", () => {
    expect(isPlaceholderTherapistName("מטפל/ת 01")).toBe(true);
    expect(isPlaceholderTherapistName("מטפל/ת 70")).toBe(true);
    expect(isPlaceholderTherapistName("מטפלת 01")).toBe(true);
  });

  test("real short nicknames are not placeholders", () => {
    expect(isPlaceholderTherapistName("אור")).toBe(false);
    expect(isPlaceholderTherapistName("לאקי")).toBe(false);
    expect(isPlaceholderTherapistName("ג'ין")).toBe(false);
  });
});

describe("canonicalizeTherapistName", () => {
  test("strips female-only tail and leading CSV index", () => {
    expect(canonicalizeTherapistName("רחל סיאונוב-נשים בלבד")).toBe("רחל סיאונוב");
    expect(canonicalizeTherapistName("2 ליסה - Lissa")).toBe("ליסה");
  });

  test("drops placeholders", () => {
    expect(canonicalizeTherapistName("מטפל/ת 01")).toBe(null);
  });
});

describe("therapistMatchKey", () => {
  test("collapses geresh variants used for ג'ין / אור duplicates", () => {
    expect(therapistMatchKey("ג'ין")).toBe(therapistMatchKey("גין"));
    expect(therapistMatchKey("ג׳ין")).toBe(therapistMatchKey("ג'ין"));
    expect(therapistMatchKey("אור")).toBe(therapistMatchKey("אור"));
  });

  test("does not merge different people who share a first token", () => {
    expect(therapistMatchKey("אור")).not.toBe(therapistMatchKey("אור לוי"));
  });
});

describe("planTherapistMerges", () => {
  test("merges geresh / nickname duplicates Mike named (אור, ג'ין, …)", () => {
    const plans = planTherapistMerges([
      { id: 1, name: "אור" },
      { id: 2, name: "אור׳" },
      { id: 3, name: "לאקי" },
      { id: 4, name: "לאקי'" },
      { id: 5, name: "אום" },
      { id: 6, name: "אום׳" },
      { id: 7, name: "פור" },
      { id: 8, name: "פור'" },
      { id: 9, name: "ג'ין" },
      { id: 10, name: "גין" },
    ]);
    expect(plans).toHaveLength(5);
    expect(plans.every((p) => p.drop.length === 1)).toBe(true);
  });

  test("does not merge two rows that already have different EZGO worker ids", () => {
    const plans = planTherapistMerges([
      { id: 1, name: "פור", ezgo_worker_id: 10 },
      { id: 2, name: "פור", ezgo_worker_id: 11 },
    ]);
    expect(plans).toEqual([]);
  });

  test("skips placeholders", () => {
    expect(planTherapistMerges([{ id: 1, name: "מטפל/ת 01" }, { id: 2, name: "מטפל/ת 02" }])).toEqual([]);
  });
});

describe("resolveTherapistIdFromName", () => {
  const staff = [
    { id: 8, name: "אום", active: true },
    { id: 9, name: "גין", active: true },
  ];

  test("finds ג'ין against גין", () => {
    expect(resolveTherapistIdFromName("ג'ין", staff)).toBe(9);
  });

  test("ignores placeholders", () => {
    expect(resolveTherapistIdFromName("מטפל/ת 01", staff)).toBe(null);
  });
});

describe("shift / catalog lists", () => {
  const staff = [
    { id: 1, name: "אור" },
    { id: 2, name: "מטפל/ת 01" },
    { id: 3, name: "לאקי" },
  ];

  test("catalog hides placeholders", () => {
    expect(catalogTherapists(staff).map((t) => t.id)).toEqual([1, 3]);
  });

  test("shift list is today's booked ids only", () => {
    expect(shiftTherapistsForDay(staff, new Set([3]), [1]).map((t) => t.id)).toEqual([1, 3]);
    expect(shiftTherapistsForDay(staff, new Set([3])).map((t) => t.id)).toEqual([3]);
  });
});

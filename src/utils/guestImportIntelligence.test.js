// src/utils/guestImportIntelligence.test.js
// Golden-case tests for the Guest Import Intelligence Layer (Sprint 0).
// Each case below is a real-world row shape Mike has actually seen in an
// EZGO export — see the task description this sprint was built from.

import { extractGuestDetails } from "./ezgoParser";
import {
  isDummyPhone,
  isCorporateName,
  isUmbrellaRow,
  resolveIdentity,
  mergeCandidates,
  classifyDbMatch,
  buildExistingGuestsLookup,
  findExistingGuestRow,
  isSameBookingGuest,
  buildMultiRoomLineCounts,
  buildMultiRoomLineIndexMap,
  formatMultiRoomLineLabel,
  getDbMatchDiffLabels,
  buildEnrichGuestPatch,
  buildCombinedRoomLabel,
  buildDoc2SyncActionLabel,
  resolveCandidateRoomDisplay,
  pickEnrichValue,
} from "./guestImportIntelligence";

const ARRIVALS_MAPPING = {
  orderNumber: "Order",
  resLineId: "ResLine",
  remark: "Remark",
  coordName: "CoordName",
  coordPhone: "CoordPhone",
};

/** Same sClientFullName on 2+ rows in a real file — remark holds occupant identity. */
const GROUP_ROW_OPTS = { coordNameDuplicated: true };

describe("Guest Import Intelligence — golden cases", () => {
  test("case 1: municipality group row A — remark phone wins over coordinator phone", () => {
    const rowA = extractGuestDetails(
      {
        Order: "300100",
        ResLine: "rl-A",
        Remark: "מרדכי 050-7774904",
        CoordName: "עיריית",
        CoordPhone: "0548045722",
      },
      ARRIVALS_MAPPING,
      null,
      GROUP_ROW_OPTS,
    );

    expect(rowA.guestPhone).toBe("+972507774904");
    expect(rowA.guestPhone).not.toBe("+972548045722"); // coordinator phone must lose
    expect(rowA.phoneSource).toBe("individual");
    expect(rowA.guestName).toBe("מרדכי");

    // resolveIdentity: remark-tier fragment must beat a competing lower-tier
    // (detailed) fragment for the same guest — this is the priority rule
    // FIELD_SOURCE_PRIORITY.identity encodes (remark > ops > detailed).
    const identity = resolveIdentity([
      { source: "detailed", name: "אחר", phone: "+972500000001" },
      { source: "remark", name: rowA.guestName, phone: rowA.guestPhone },
    ]);
    expect(identity).toEqual({ name: "מרדכי", phone: "+972507774904", source: "remark" });

    const [candidate] = mergeCandidates({ arrivals: [rowA] });
    expect(candidate.guestPhone).toBe("+972507774904");
    expect(classifyDbMatch(candidate, null)).toBe("new");
  });

  test("case 2: municipality group row B — different individual, same order, not merged with row A", () => {
    const rowA = extractGuestDetails(
      {
        Order: "300100",
        ResLine: "rl-A",
        Remark: "מרדכי 050-7774904",
        CoordName: "עיריית",
        CoordPhone: "0548045722",
      },
      ARRIVALS_MAPPING,
      null,
      GROUP_ROW_OPTS,
    );
    const rowB = extractGuestDetails(
      {
        Order: "300100",
        ResLine: "rl-B",
        Remark: "גבריאל 052-6691991",
        CoordName: "עיריית",
        CoordPhone: "0548045722",
      },
      ARRIVALS_MAPPING,
      null,
      GROUP_ROW_OPTS,
    );

    expect(rowB.guestPhone).toBe("+972526691991");
    expect(rowB.guestName).toBe("גבריאל");

    const candidates = mergeCandidates({ arrivals: [rowA, rowB] });
    expect(candidates).toHaveLength(2); // zero-merging: 2 rows in → 2 candidates out
    expect(candidates[0].orderNumber).toBe("300100");
    expect(candidates[1].orderNumber).toBe("300100");
    expect(candidates[0].guestPhone).toBe("+972507774904");
    expect(candidates[1].guestPhone).toBe("+972526691991");
    expect(candidates[0].guestPhone).not.toBe(candidates[1].guestPhone);
  });

  test("case 3: umbrella coordinator row — dummy phone + corporate name + many rooms → unimportable", () => {
    expect(isDummyPhone("111")).toBe(true);
    expect(isDummyPhone("+972507774904")).toBe(false); // sanity: real phones are not flagged dummy
    expect(isCorporateName("עיריית")).toBe(true);
    expect(isCorporateName("מרדכי")).toBe(false); // sanity: a real first name is not corporate
    expect(isUmbrellaRow({ phone: "111", roomsCount: 12, name: "עיריית" })).toBe(true);

    const umbrellaCandidate = {
      guestName: "עיריית",
      guestPhone: null,
      _rawPhone: "111",
      orderNumber: "300200",
      roomsCount: 12,
    };
    expect(classifyDbMatch(umbrellaCandidate, null)).toBe("unimportable");
  });

  test("case 3b: dummy coordinator (111) + remark name/phone — each occupant importable, courtesy automation", () => {
    const rowA = extractGuestDetails(
      {
        Order: "300300",
        ResLine: "rl-1",
        Remark: "מרדכי 050-7774904",
        CoordName: "עיריית תל אביב",
        CoordPhone: "111",
      },
      ARRIVALS_MAPPING,
      null,
      GROUP_ROW_OPTS,
    );
    const rowB = extractGuestDetails(
      {
        Order: "300300",
        ResLine: "rl-2",
        Remark: "גבריאל 052-6691991",
        CoordName: "עיריית תל אביב",
        CoordPhone: "111",
      },
      ARRIVALS_MAPPING,
      null,
      GROUP_ROW_OPTS,
    );

    expect(rowA.guestPhone).toBe("+972507774904");
    expect(rowA.guestName).toBe("מרדכי");
    expect(rowA.automationScope).toBe("courtesy_only");
    expect(rowA.automationMuted).toBe(false);
    expect(rowB.guestPhone).toBe("+972526691991");

    const candidates = mergeCandidates({ arrivals: [rowA, rowB] });
    expect(candidates).toHaveLength(2);
    expect(candidates.every((c) => c.roomsCount === 1)).toBe(true);
    expect(candidates.every((c) => classifyDbMatch(c, null) === "new")).toBe(true);
    expect(candidates.every((c) => c.automationScope === "courtesy_only")).toBe(true);
  });

  test("case 4: ops header line — dummy phone, unresolvable corporate name → not a profile", () => {
    const candidates = mergeCandidates({ ops: ["262070: עיריית - 111"] });
    expect(candidates).toHaveLength(0);
  });

  test("case 5: ops individual line — real IL mobile → valid phone candidate", () => {
    const candidates = mergeCandidates({ ops: ["266046: טוהר יחיא - 0538244930"] });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].guestName).toBe("טוהר יחיא");
    expect(candidates[0].guestPhone).toBe("+972538244930");
    expect(candidates[0].orderNumber).toBe("266046");
    expect(classifyDbMatch(candidates[0], null)).toBe("new");
  });

  test("isCorporateName: 'עיירית' typo variant recognized alongside the correct 'עיריית' spelling (Sprint 2)", () => {
    expect(isCorporateName("עיירית")).toBe(true);
    expect(isCorporateName("עיירית תל אביב - ענבר")).toBe(true);
  });

  test("mergeCandidates: arrivals meal_time wired from extractGuestDetails' mealTime (Sprint 2)", () => {
    const row = extractGuestDetails(
      {
        Order: "300400",
        ResLine: "rl-Meal",
        Remark: "דני כהן 052-9998877 א. ערב 20:30",
        CoordName: "דני כהן",
        CoordPhone: "0529998877",
      },
      ARRIVALS_MAPPING,
    );
    expect(row.mealTime).toBe("20:30");

    const [candidate] = mergeCandidates({ arrivals: [row] });
    expect(candidate.meal_time).toBe("20:30");
  });

  test("mergeCandidates: arrivals with no remark meal shorthand still meal_time=null (unchanged default)", () => {
    const row = extractGuestDetails(
      {
        Order: "300401",
        ResLine: "rl-NoMeal",
        Remark: "משה לוי 052-1231234",
        CoordName: "משה לוי",
        CoordPhone: "0521231234",
      },
      ARRIVALS_MAPPING,
    );
    expect(row.mealTime).toBe(null);

    const [candidate] = mergeCandidates({ arrivals: [row] });
    expect(candidate.meal_time).toBe(null);
  });

  // Sprint 3: classifyDbMatch with a real existingGuestRow (not null) — the DB
  // prefetch join ArrivalImportPanel.js runs before sync (see _findExistingGuestRow).
  test("classifyDbMatch: matching phone, identical name/room/date → existing", () => {
    const candidate = {
      guestName: "מרדכי",
      guestPhone: "+972507774904",
      _rawPhone: "+972507774904",
      orderNumber: "300100",
      room: "וילה 1",
      arrivalDate: "2026-06-30",
      roomsCount: 1,
    };
    const existingGuestRow = {
      phone: "+972507774904",
      name: "מרדכי",
      room: "וילה 1",
      order_number: "300100",
      arrival_date: "2026-06-30",
    };
    expect(classifyDbMatch(candidate, existingGuestRow)).toBe("existing");
  });

  test("classifyDbMatch: matching phone but a different name on file → conflict", () => {
    const candidate = {
      guestName: "מרדכי כהן",
      guestPhone: "+972507774904",
      _rawPhone: "+972507774904",
      orderNumber: "300100",
      room: null,
      arrivalDate: "2026-06-30",
      roomsCount: 1,
    };
    const existingGuestRow = {
      phone: "+972507774904",
      name: "מרדכי לוי", // different surname on file
      room: null,
      order_number: "300100",
      arrival_date: "2026-06-30",
    };
    expect(classifyDbMatch(candidate, existingGuestRow)).toBe("conflict");
  });

  test("classifyDbMatch: matching order_number but a different room on file → conflict", () => {
    const candidate = {
      guestName: "גבריאל",
      guestPhone: "+972526691991",
      _rawPhone: "+972526691991",
      orderNumber: "300100",
      roomName: "וילה 2",
      suiteType: "",
      room: "וילה 2",
      isDayGuest: false,
      arrivalDate: "2026-06-30",
      roomsCount: 1,
    };
    const existingGuestRow = {
      phone: null,
      name: "גבריאל",
      room: "וילה 5",
      order_number: "300100",
      arrival_date: "2026-06-30",
    };
    expect(classifyDbMatch(candidate, existingGuestRow)).toBe("conflict");
  });

  test("classifyDbMatch: EZGO bare room number vs canonical guests.room → existing (not conflict)", () => {
    const candidate = {
      guestName: "מרדכי",
      guestPhone: "+972507774904",
      _rawPhone: "+972507774904",
      orderNumber: "300100",
      roomName: "8",
      suiteType: "סוויטת אמטיסט",
      room: "8",
      isDayGuest: false,
      arrivalDate: "2026-06-30",
      roomsCount: 1,
    };
    const existingGuestRow = {
      phone: "+972507774904",
      name: "מרדכי",
      room: "אמטיסט 8",
      order_number: "300100",
      arrival_date: "2026-06-30",
    };
    expect(classifyDbMatch(candidate, existingGuestRow)).toBe("existing");
  });

  test("classifyDbMatch: no phone/order overlap with the existing row → new (not existing/conflict)", () => {
    const candidate = {
      guestName: "אורח אחר",
      guestPhone: "+972500000002",
      _rawPhone: "+972500000002",
      orderNumber: "999999",
      room: null,
      arrivalDate: "2026-06-30",
      roomsCount: 1,
    };
    const existingGuestRow = {
      phone: "+972507774904",
      name: "מרדכי",
      room: null,
      order_number: "300100",
      arrival_date: "2026-06-30",
    };
    expect(classifyDbMatch(candidate, existingGuestRow)).toBe("new");
  });

  test("findExistingGuestRow: order+date+phone tier-1 match", () => {
    const lookup = buildExistingGuestsLookup([
      {
        phone: "+972501111111",
        order_number: "266932",
        arrival_date: "2026-07-10",
        guest_index: 1,
        name: "אורח",
      },
    ]);
    const hit = findExistingGuestRow(lookup, {
      guestPhone: "+972501111111",
      orderNumber: "266932",
      arrivalDate: "2026-07-10",
    });
    expect(hit?.order_number).toBe("266932");
  });

  test("findExistingGuestRow: unique order+date when phone corrected in file", () => {
    const lookup = buildExistingGuestsLookup([
      {
        phone: "+972501111111",
        order_number: "266932",
        arrival_date: "2026-07-10",
        guest_index: 1,
        name: "אורח",
      },
    ]);
    const hit = findExistingGuestRow(lookup, {
      guestPhone: "+972502222222",
      orderNumber: "266932",
      arrivalDate: "2026-07-10",
    });
    expect(hit?.phone).toBe("+972501111111");
  });

  test("findExistingGuestRow: two guests same order — disambiguate by phone", () => {
    const lookup = buildExistingGuestsLookup([
      {
        phone: "+972501111111",
        order_number: "300100",
        arrival_date: "2026-06-30",
        guest_index: 1,
        name: "מרדכי",
      },
      {
        phone: "+972526691991",
        order_number: "300100",
        arrival_date: "2026-06-30",
        guest_index: 1,
        name: "גבריאל",
      },
    ]);
    const hit = findExistingGuestRow(lookup, {
      guestPhone: "+972526691991",
      orderNumber: "300100",
      arrivalDate: "2026-06-30",
    });
    expect(hit?.name).toBe("גבריאל");
  });

  test("classifyDbMatch: same order+phone+date, different room line → existing (multi-room)", () => {
    const existingGuestRow = {
      phone: "+972501234567",
      name: "נוי ברנע",
      room: "אמטיסט 12",
      order_number: "266932",
      arrival_date: "2026-07-10",
    };
    const secondRoomLine = {
      guestName: "נוי ברנע",
      guestPhone: "+972501234567",
      _rawPhone: "+972501234567",
      orderNumber: "266932",
      roomName: "8",
      suiteType: "סוויטת אמטיסט",
      room: "8",
      isDayGuest: false,
      arrivalDate: "2026-07-10",
      roomsCount: 1,
    };
    expect(isSameBookingGuest(secondRoomLine, existingGuestRow)).toBe(true);
    expect(classifyDbMatch(secondRoomLine, existingGuestRow)).toBe("existing");
  });

  test("buildMultiRoomLineCounts: two CSV lines same order+phone → 2", () => {
    const counts = buildMultiRoomLineCounts([
      { orderNumber: "266932", arrivalDate: "2026-07-10", guestPhone: "+972501234567" },
      { orderNumber: "266932", arrivalDate: "2026-07-10", guestPhone: "+972501234567" },
    ]);
    expect(counts.get("266932::2026-07-10::+972501234567")).toBe(2);
  });

  test("buildMultiRoomLineIndexMap: per-line labels חדר 1 מ־2 / חדר 2 מ־2", () => {
    const candidates = [
      { orderNumber: "266932", arrivalDate: "2026-07-10", guestPhone: "+972501234567" },
      { orderNumber: "266932", arrivalDate: "2026-07-10", guestPhone: "+972501234567" },
      { orderNumber: "266933", arrivalDate: "2026-07-10", guestPhone: "+972509999999" },
    ];
    const indexMap = buildMultiRoomLineIndexMap(candidates);
    expect(formatMultiRoomLineLabel(indexMap, 0)).toBe("חדר 1 מ־2");
    expect(formatMultiRoomLineLabel(indexMap, 1)).toBe("חדר 2 מ־2");
    expect(formatMultiRoomLineLabel(indexMap, 2)).toBe("");
  });

  test("getDbMatchDiffLabels: name mismatch → שם", () => {
    const labels = getDbMatchDiffLabels(
      { guestPhone: "+972501234567", orderNumber: "100", guestName: "דני", arrivalDate: "2026-07-10" },
      { phone: "+972501234567", order_number: "100", name: "משה", arrival_date: "2026-07-10", room: "אמטיסט 8" },
    );
    expect(labels).toEqual(["שם"]);
  });

  test("buildEnrichGuestPatch: fills empty DB fields only", () => {
    const patch = buildEnrichGuestPatch(
      { spa_time: "14:00", room: "וילה 1", name: "דני" },
      { spa_time: null, room: "אמטיסט 8", name: "משה כהן" },
    );
    expect(patch).toEqual({ spa_time: "14:00" });
  });

  test("pickEnrichValue: skips when DB already has value", () => {
    expect(pickEnrichValue("14:00", "15:00")).toBeUndefined();
    expect(pickEnrichValue("14:00", "")).toBe("14:00");
  });

  test("resolveCandidateRoomDisplay: maps room number to registry suite", () => {
    const label = resolveCandidateRoomDisplay({
      roomName: "8",
      suiteType: "סוויטת אמטיסט",
      isDayGuest: false,
    });
    expect(label).toMatch(/אמטיסט/i);
  });

  test("buildCombinedRoomLabel: dedupes and joins multi-room labels", () => {
    expect(buildCombinedRoomLabel(["אמטיסט 8", "וילה 3", "אמטיסט 8"])).toBe("אמטיסט 8 · וילה 3");
  });

  test("buildDoc2SyncActionLabel: enrich skips existing room", () => {
    const label = buildDoc2SyncActionLabel({
      dbStatus: "existing",
      existingRow: { room: "אמטיסט 8" },
      candidateRoom: "וילה 3",
      enrichOnly: true,
      hasPhone: true,
      multiRoomLabel: "חדר 2 מ־2",
    });
    expect(label).toContain("⏭️ חדר קיים");
    expect(label).toContain("חדר 2 מ־2");
  });

  test("buildDoc2SyncActionLabel: enrich fills empty room", () => {
    const label = buildDoc2SyncActionLabel({
      dbStatus: "existing",
      existingRow: { room: "" },
      candidateRoom: "אמטיסט 8",
      enrichOnly: true,
      hasPhone: true,
    });
    expect(label).toContain("🏨 חדר");
  });
});

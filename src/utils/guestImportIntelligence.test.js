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
} from "./guestImportIntelligence";

const ARRIVALS_MAPPING = {
  orderNumber: "Order",
  resLineId: "ResLine",
  remark: "Remark",
  coordName: "CoordName",
  coordPhone: "CoordPhone",
};

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
});

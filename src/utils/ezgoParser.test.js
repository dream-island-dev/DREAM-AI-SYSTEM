// src/utils/ezgoParser.test.js
// Sprint 1 regression tests — the remark-first phone bug and its neighbors.

import { extractGuestDetails, extractMealTimeFromRemark, extractNameFromRemark, extractNameFromRemarkWithoutPhone } from "./ezgoParser";

const ARRIVALS_MAPPING = {
  orderNumber: "Order",
  resLineId: "ResLine",
  remark: "Remark",
  coordName: "CoordName",
  coordPhone: "CoordPhone",
  guestPhone: "GuestPhone",
  leadSource: "LeadSource",
};

describe("ezgoParser — Sprint 1 fixes", () => {
  test("remark phone+name wins over a mapped direct guestPhone column (the actual bug)", () => {
    // This is the real-world shape a preset that maps guestPhone:"sTel1"
    // produces: sTel1 IS the group coordinator's number, reused on every
    // room row, but it was landing in a "direct" column and winning before
    // this fix — silently routing the individual's messages to the group
    // organizer instead of the real occupant found in the remark.
    const row = extractGuestDetails(
      {
        Order: "300300",
        ResLine: "rl-X",
        Remark: "יעקב כהן 052-1234567",
        CoordName: "ישראל ישראלי",
        CoordPhone: "0501112222",
        GuestPhone: "0501112222", // same coordinator number, mapped as "direct"
      },
      ARRIVALS_MAPPING,
    );

    expect(row.guestPhone).toBe("+972521234567");
    expect(row.guestPhone).not.toBe("+972501112222");
    expect(row.phoneSource).toBe("individual");
    expect(row.guestName).toBe("יעקב כהן");
    expect(row.coordPhone).toBe("+972501112222"); // coordinator phone still preserved separately
  });

  test("dummy coordinator phone (111) is ignored — remark name+phone is the guest profile", () => {
    const row = extractGuestDetails(
      {
        Order: "300350",
        ResLine: "rl-Z",
        Remark: "מרדכי 050-7774904",
        CoordName: "עיריית תל אביב",
        CoordPhone: "111",
        GuestPhone: "111",
      },
      ARRIVALS_MAPPING,
    );

    expect(row.guestPhone).toBe("+972507774904");
    expect(row.guestName).toBe("מרדכי");
    expect(row.phoneSource).toBe("individual");
    expect(row.coordPhone).toBeNull();
    expect(row.coordPhoneRaw).toBe("111");
    expect(row.automationMuted).toBe(true);
  });

  test("direct guestPhone still wins when remark has no phone at all", () => {
    const row = extractGuestDetails(
      {
        Order: "300301",
        ResLine: "rl-Y",
        Remark: "בקשה מיוחדת: מיטה נוספת",
        CoordName: "דנה לוי",
        CoordPhone: "0509998888",
        GuestPhone: "0525556666",
      },
      ARRIVALS_MAPPING,
    );

    expect(row.guestPhone).toBe("+972525556666");
    expect(row.phoneSource).toBe("individual");
  });

  test("falls back to coordinator phone when neither remark nor direct column resolve", () => {
    const row = extractGuestDetails(
      {
        Order: "300302",
        ResLine: "rl-Z",
        Remark: "",
        CoordName: "משפחת אברהם",
        CoordPhone: "0521231234",
      },
      ARRIVALS_MAPPING,
    );

    expect(row.guestPhone).toBe("+972521231234");
    expect(row.phoneSource).toBe("coordinator");
  });

  test("automationMuted: corporate coordinator name mutes even without a lead_source column", () => {
    const municipality = extractGuestDetails(
      {
        Order: "300303",
        ResLine: "rl-M",
        Remark: "",
        CoordName: "עיריית חיפה",
        CoordPhone: "0500000000",
      },
      ARRIVALS_MAPPING,
    );
    expect(municipality.automationMuted).toBe(true);

    const bank = extractGuestDetails(
      {
        Order: "300304",
        ResLine: "rl-B",
        Remark: "מרדכי 050-7774904",
        CoordName: "בנק לאומי סניף מרכז",
        CoordPhone: "0548045722",
      },
      ARRIVALS_MAPPING,
    );
    // Even though an individual WAS resolved from the remark, the booking is
    // still a muted corporate group booking — mute must not depend on
    // phoneSource.
    expect(bank.phoneSource).toBe("individual");
    expect(bank.automationMuted).toBe(true);

    const realGuest = extractGuestDetails(
      {
        Order: "300305",
        ResLine: "rl-R",
        Remark: "יוסי כהן 052-1112233",
        CoordName: "יוסי כהן",
        CoordPhone: "0521112233",
      },
      ARRIVALS_MAPPING,
    );
    expect(realGuest.automationMuted).toBe(false);
  });

  test("automationMuted: existing sales-dept lead_source rule still works unchanged", () => {
    const row = extractGuestDetails(
      {
        Order: "300306",
        ResLine: "rl-S",
        Remark: "יוסי כהן 052-1112233",
        CoordName: "יוסי כהן",
        CoordPhone: "0521112233",
        LeadSource: "מחלקת מכירות",
      },
      ARRIVALS_MAPPING,
    );
    expect(row.automationMuted).toBe(true);
  });

  test("extractMealTimeFromRemark: dinner shorthand extraction", () => {
    expect(extractMealTimeFromRemark("א. ערב 19:30")).toBe("19:30");
    expect(extractMealTimeFromRemark("א.ערב 20:00")).toBe("20:00");
    expect(extractMealTimeFromRemark("מרדכי 050-7774904")).toBe(null);
    expect(extractMealTimeFromRemark(null)).toBe(null);
  });

  test("extractGuestDetails wires mealTime from remark shorthand (best-effort, additive)", () => {
    const row = extractGuestDetails(
      {
        Order: "300307",
        ResLine: "rl-T",
        Remark: "יוסי כהן 052-1112233 א. ערב 19:30",
        CoordName: "יוסי כהן",
        CoordPhone: "0521112233",
      },
      ARRIVALS_MAPPING,
    );
    expect(row.mealTime).toBe("19:30");
  });

  test("automationMuted: 'עיירית' typo variant (transposed יי/ר) is treated as corporate mute", () => {
    // Real-world coordinator name typo — extra yod before the resh, unlike the
    // correctly-spelled "עיריית" already covered above. Sprint 2 fix.
    const row = extractGuestDetails(
      {
        Order: "300308",
        ResLine: "rl-U",
        Remark: "",
        CoordName: "עיירית תל אביב - ענבר",
        CoordPhone: "0501234567",
      },
      ARRIVALS_MAPPING,
    );
    expect(row.automationMuted).toBe(true);
  });

  // ── XOS Task 1: CSV mis-split defensive cleanup ────────────────────────────
  // A raw EZGO Suites CSV row whose sRemark contains an unescaped comma/quote
  // can get mis-split by a naive CSV reader, bleeding leftover CSV fragments
  // (","6","11"...,"עיריית תל אביב") in front of the phone number. The
  // primary fix is quote-aware parsing at read time (csvTextToRowObjects in
  // ArrivalImportPanel.js/detailedReservationParser.js) — this is the
  // secondary, defense-in-depth layer inside extractNameFromRemark itself.
  test("extractNameFromRemark: cuts at the first CSV mis-split artifact instead of keeping the leaked junk", () => {
    const mangled = 'רינת עקיבא 3 בחדר","6","11","גוש 12","עיריית תל אביב",0506919808';
    expect(extractNameFromRemark(mangled)).toBe("רינת עקיבא");
  });

  test("extractNameFromRemark: loose comma bleed (no quote artifact) still resolves to occupant name only", () => {
    const mangled =
      "רינת עקיבא 3 בחדר תוספת ל 3 פרטי 1000 שח תשלום ביום ההגעה, ,11,6, ,₪, ,0,3,0,0506919808";
    expect(extractNameFromRemark(mangled)).toBe("רינת עקיבא");
  });

  test("extractNameFromRemark: multi-guest slash/plus — name adjacent to phone wins", () => {
    expect(extractNameFromRemark("יוסי יוסף / איגור גרינבאום - 0526651629")).toBe("איגור גרינבאום");
    expect(extractNameFromRemark("מוחמד עדילה/ ראמי עדילה052-5778390")).toBe("ראמי עדילה");
    expect(extractNameFromRemark("ארז לבנון+ חגיי קריק 0526651633")).toBe("חגיי קריק");
  });

  test("extractGuestDetails: remark is full identity when coordinator phone is dummy", () => {
    const row = extractGuestDetails(
      {
        Order: "262071",
        ResLine: "rl-rinat",
        Remark:
          "רינת עקיבא 3 בחדר תוספת ל 3 פרטי 1000 שח תשלום ביום ההגעה, ,11,6, ,₪, ,0,3,0,0506919808",
        CoordName: "עיריית תל אביב",
        CoordPhone: "111",
      },
      ARRIVALS_MAPPING,
    );
    expect(row.guestName).toBe("רינת עקיבא");
    expect(row.guestPhone).toBe("+972506919808");
    expect(row.phoneSource).toBe("individual");
    expect(row.automationMuted).toBe(true);
  });

  test("extractNameFromRemark: caps name length as a hard backstop when no artifact pattern matches", () => {
    const longJunk = "א".repeat(150);
    const mangled = `${longJunk} 0501234567`;
    const result = extractNameFromRemark(mangled);
    expect(result.length).toBeLessThanOrEqual(80);
  });

  test("extractGuestDetails: mis-split CSV remark resolves to the clean name prefix, not the raw junk", () => {
    const row = extractGuestDetails(
      {
        Order: "300309",
        ResLine: "rl-V",
        Remark: 'רינת עקיבא 3 בחדר","6","11","גוש 12","עיריית תל אביב",0506919808',
        CoordName: "רינת עקיבא",
        CoordPhone: "0506919808",
      },
      ARRIVALS_MAPPING,
    );
    expect(row.guestName).toBe("רינת עקיבא");
    expect(row.guestName).not.toContain('","');
    expect(row.guestPhone).toBe("+972506919808");
  });

  test("name-only remark + phone in sTel1 column → occupant profile", () => {
    expect(extractNameFromRemarkWithoutPhone("נילי הללי")).toBe("נילי הללי");
    expect(extractNameFromRemarkWithoutPhone("Eric Yosef Cohen")).toBe("Eric Yosef Cohen");

    const row = extractGuestDetails(
      {
        Order: "262071",
        ResLine: "rl-nili",
        Remark: "נילי הללי",
        CoordName: "פרטי",
        CoordPhone: "0524549965",
      },
      ARRIVALS_MAPPING,
    );
    expect(row.guestName).toBe("נילי הללי");
    expect(row.guestPhone).toBe("+972524549965");
    expect(row.phoneSource).toBe("individual");
  });
});

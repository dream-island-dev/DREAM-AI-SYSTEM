import {
  mapEzgoActivitiesRow,
  normalizeActivitiesPhone,
  normalizeEzgoRoomName,
  parseEzgoActivitiesReport,
  parseGuestNameCell,
  parseTimeRange,
} from "./ezgoSpaActivitiesParser";

describe("parseTimeRange", () => {
  test("standard range", () => {
    expect(parseTimeRange("10:00-10:30")).toEqual({ start_time: "10:00", end_time: "10:30" });
  });

  test("ignores trailing line-index noise (.23)", () => {
    expect(parseTimeRange("10:00-10:30 .23")).toEqual({ start_time: "10:00", end_time: "10:30" });
  });

  test("en-dash separator", () => {
    expect(parseTimeRange("9:00–9:45")).toEqual({ start_time: "09:00", end_time: "09:45" });
  });

  test("pads single-digit hour", () => {
    expect(parseTimeRange("9:00-9:30")).toEqual({ start_time: "09:00", end_time: "09:30" });
  });

  test("unparseable → both null, never throws", () => {
    expect(parseTimeRange("")).toEqual({ start_time: null, end_time: null });
    expect(parseTimeRange(null)).toEqual({ start_time: null, end_time: null });
    expect(parseTimeRange("שעה לא ידועה")).toEqual({ start_time: null, end_time: null });
  });
});

describe("normalizeActivitiesPhone", () => {
  test("0-prefixed 10-digit → 972…", () => {
    expect(normalizeActivitiesPhone("0522822548")).toBe("972522822548");
  });

  test("already 972-prefixed passes through", () => {
    expect(normalizeActivitiesPhone("972522822548")).toBe("972522822548");
  });

  test("bare 9-digit mobile (no leading 0) → 972…", () => {
    expect(normalizeActivitiesPhone("522822548")).toBe("972522822548");
  });

  test("dashes/spaces/parens stripped before normalizing", () => {
    expect(normalizeActivitiesPhone("052-282-2548")).toBe("972522822548");
  });

  test("empty/null → null", () => {
    expect(normalizeActivitiesPhone("")).toBeNull();
    expect(normalizeActivitiesPhone(null)).toBeNull();
  });

  test("unrecognized shape kept as-is, not dropped (ZERO DATA LOSS)", () => {
    expect(normalizeActivitiesPhone("123")).toBe("123");
  });
});

describe("normalizeEzgoRoomName", () => {
  test("strips trailing couple marker", () => {
    expect(normalizeEzgoRoomName("חדר 10 (זוגי)")).toBe("חדר 10");
  });

  test("leaves a name with no trailing parenthetical untouched", () => {
    expect(normalizeEzgoRoomName("סוויטת אבניו 1")).toBe("סוויטת אבניו 1");
  });

  test("collapses embedded whitespace/newlines", () => {
    expect(normalizeEzgoRoomName("חדר   9\n")).toBe("חדר 9");
  });

  test("empty → null", () => {
    expect(normalizeEzgoRoomName("")).toBeNull();
  });
});

describe("parseGuestNameCell", () => {
  test("plain name", () => {
    expect(parseGuestNameCell("דיין חיים")).toEqual({
      guest_name: "דיין חיים", group_label: null, is_new_booking_placeholder: false,
    });
  });

  test("name with group/booking label in parens", () => {
    expect(parseGuestNameCell("דיין חיים (קבוצת עיריית חיפה)")).toEqual({
      guest_name: "דיין חיים", group_label: "קבוצת עיריית חיפה", is_new_booking_placeholder: false,
    });
  });

  test("new-booking placeholder", () => {
    expect(parseGuestNameCell("(הזמנה חדשה)")).toEqual({
      guest_name: null, group_label: null, is_new_booking_placeholder: true,
    });
  });

  test("empty cell", () => {
    expect(parseGuestNameCell("")).toEqual({
      guest_name: null, group_label: null, is_new_booking_placeholder: false,
    });
  });
});

describe("mapEzgoActivitiesRow", () => {
  const fullRow = {
    "תזמון": "10:00-10:30 .23",
    "פעילות": "חדר 10 (זוגי)",
    "מטפל": "אולגה",
    "סוגי טיפולים": "שוודי",
    "תוספות": "טיפול 30 דק'",
    "לקוח": "דיין חיים (קבוצת עיריית חיפה)",
    "טלפון": "0507834236",
    "הערה": "זוגי עם + שרה כהן",
    "מזהה": "88213",
  };

  test("maps a fully-populated row with no warnings", () => {
    const row = mapEzgoActivitiesRow(fullRow);
    expect(row).toMatchObject({
      ezgo_line_id: "88213",
      start_time: "10:00",
      end_time: "10:30",
      room_raw: "חדר 10",
      therapist_name: "אולגה",
      treatment_type: "שוודי",
      extras: "טיפול 30 דק'",
      guest_name: "דיין חיים",
      group_label: "קבוצת עיריית חיפה",
      is_new_booking_placeholder: false,
      phone: "972507834236",
      phone_raw: "0507834236",
      note: "זוגי עם + שרה כהן",
      warnings: [],
    });
    // ZERO DATA LOSS — the original row is always carried through untouched.
    expect(row.raw).toBe(fullRow);
  });

  test("missing time/phone/room → warnings set, row still returned (never dropped)", () => {
    const row = mapEzgoActivitiesRow({ "לקוח": "אורח כלשהו" });
    expect(row.warnings).toEqual(expect.arrayContaining(["no_time_range", "no_phone", "no_room"]));
    expect(row.guest_name).toBe("אורח כלשהו");
  });

  test("new-booking placeholder guest never invents a name", () => {
    const row = mapEzgoActivitiesRow({ ...fullRow, "לקוח": "(הזמנה חדשה)" });
    expect(row.guest_name).toBeNull();
    expect(row.is_new_booking_placeholder).toBe(true);
  });
});

describe("parseEzgoActivitiesReport", () => {
  test("drops only fully-empty rows, keeps every real row (ZERO DATA LOSS)", () => {
    const rows = [
      { "לקוח": "אורח א", "טלפון": "0501111111", "תזמון": "09:00-09:30", "פעילות": "חדר 1" },
      { "לקוח": "", "טלפון": "", "תזמון": "", "פעילות": "" }, // spacer row
      { "לקוח": "אורח ב", "טלפון": "0502222222", "תזמון": "10:00-10:30", "פעילות": "חדר 2" },
    ];
    const parsed = parseEzgoActivitiesReport(rows);
    expect(parsed).toHaveLength(2);
    expect(parsed.map((r) => r.guest_name)).toEqual(["אורח א", "אורח ב"]);
  });

  test("two rows sharing one phone (couple/group) both survive independently", () => {
    const rows = [
      { "לקוח": "בעל", "טלפון": "0503333333", "תזמון": "09:00-09:30", "פעילות": "חדר 3" },
      { "לקוח": "אישה", "טלפון": "0503333333", "תזמון": "09:00-09:30", "פעילות": "חדר 4" },
    ];
    const parsed = parseEzgoActivitiesReport(rows);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].phone).toBe(parsed[1].phone);
    expect(parsed.map((r) => r.guest_name)).toEqual(["בעל", "אישה"]);
  });

  test("non-array input returns empty array instead of throwing", () => {
    expect(parseEzgoActivitiesReport(null)).toEqual([]);
    expect(parseEzgoActivitiesReport(undefined)).toEqual([]);
  });
});

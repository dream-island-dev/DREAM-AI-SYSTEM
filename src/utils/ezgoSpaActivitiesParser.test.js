import {
  canonicalizeEnglishActivitiesRow,
  collectGuestNameHints,
  isEnglishActivitiesCsvRow,
  isSpaOrgGroupLabel,
  mapEzgoActivitiesRow,
  normalizeActivitiesDate,
  normalizeActivitiesPhone,
  normalizeClockTime,
  normalizeEzgoRoomName,
  parseEzgoActivitiesReport,
  parseGuestNameCell,
  parseTimeRange,
  repairEzgoCsvText,
  resolveSpaGuestDisplayName,
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

describe("normalizeClockTime", () => {
  test("pads single-digit hour", () => {
    expect(normalizeClockTime("9:00")).toBe("09:00");
    expect(normalizeClockTime("9:45")).toBe("09:45");
  });

  test("already-padded passes through", () => {
    expect(normalizeClockTime("10:00")).toBe("10:00");
  });

  test("garbage → null", () => {
    expect(normalizeClockTime("")).toBeNull();
    expect(normalizeClockTime("abc")).toBeNull();
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

  test("+972 with spaces (English CSV rare shape) → 972…", () => {
    expect(normalizeActivitiesPhone("+972 50 507 3097")).toBe("972505073097");
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

  test("trims trailing spaces from English CSV room cells", () => {
    expect(normalizeEzgoRoomName("סוויטת אבניו 2 ")).toBe("סוויטת אבניו 2");
    expect(normalizeEzgoRoomName("טרקלין -חדר זוגי ")).toBe("טרקלין -חדר זוגי");
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

  test("Latin nickname with Hebrew person in parens", () => {
    expect(parseGuestNameCell("limor (לימור סולומון)")).toEqual({
      guest_name: "limor", group_label: "לימור סולומון", is_new_booking_placeholder: false,
    });
  });
});

describe("repairEzgoCsvText / date / display-name helpers", () => {
  test("repairEzgoCsvText replaces unescaped בע\"מ so CSV field boundaries survive", () => {
    const broken = `"a","פרומדיקס בע"מ","b"`;
    const fixed = repairEzgoCsvText(broken);
    expect(fixed).toContain("בע״מ");
    expect(fixed).not.toMatch(/בע"/);
  });

  test("normalizeActivitiesDate accepts ISO, Excel serial, and Date", () => {
    expect(normalizeActivitiesDate("2026-07-13")).toBe("2026-07-13");
    expect(normalizeActivitiesDate(46216)).toBe("2026-07-13");
    expect(normalizeActivitiesDate("46216.125")).toBe("2026-07-13");
    expect(normalizeActivitiesDate(new Date(2026, 6, 13))).toBe("2026-07-13");
    expect(normalizeActivitiesDate("7/13/26")).toBe("2026-07-13");
    expect(normalizeActivitiesDate("13/7/2026")).toBe("2026-07-13");
    expect(normalizeActivitiesDate("not-a-date")).toBeNull();
  });

  test("canonicalize English row turns Excel serial dtDate into YYYY-MM-DD", () => {
    const c = canonicalizeEnglishActivitiesRow({
      iLineStatus: "1", iAddsLineId: "1", sRowNum: "1",
      tmStart: "9:00", tmEnd: "9:45", dtDate: 46216,
      sTel: 544973430, sClientName: "זיו",
    });
    expect(c._appointment_date).toBe("2026-07-13");
    expect(c.טלפון).toBe("544973430");
  });

  test("resolveSpaGuestDisplayName prefers Hebrew paren person over Latin nickname", () => {
    expect(resolveSpaGuestDisplayName("limor", "לימור סולומון")).toBe("לימור סולומון");
    expect(resolveSpaGuestDisplayName("זיו מוזס", "ועד עובדי הטכנולוגיה")).toBe("זיו מוזס");
  });

  test("isSpaOrgGroupLabel / collectGuestNameHints skip org booking labels", () => {
    expect(isSpaOrgGroupLabel("ועד עובדי הטכנולוגיה בנק הפועלים")).toBe(true);
    expect(isSpaOrgGroupLabel("לימור סולומון")).toBe(false);
    expect(collectGuestNameHints("limor", "לימור סולומון")).toEqual(["לימור סולומון", "limor"]);
    expect(collectGuestNameHints("זיו מוזס", "ועד עובדי הטכנולוגיה בנק הפועלים")).toEqual(["זיו מוזס"]);
  });

  test("parseEzgoActivitiesReport after repair keeps בע״מ rows (ZERO DATA LOSS)", () => {
    const XLSX = require("xlsx");
    const rawCsv = [
      "iLineStatus,iAddsLineId,sRowNum,dtDate,tmStart,tmEnd,sAttendantName,sTreatDesc,sExtraDesc,sActivityDesc,sClientName,sTel,sRemark",
      `"1","1","1","2026-07-13","10:00","10:30","דוד","שוודי","30","חדר 1","אליאנה (פרומדיקס בע"מ)","0546443510",""`,
      `"1","2","2","2026-07-13","10:00","10:30","טרסה","שוודי","30","חדר 2","ליאב (פרומדיקס בע"מ)","0546443510",""`,
    ].join("\n");
    const brokenWb = XLSX.read(rawCsv, { type: "string" });
    const fixedWb = XLSX.read(repairEzgoCsvText(rawCsv), { type: "string", raw: false });
    const broken = XLSX.utils.sheet_to_json(brokenWb.Sheets[brokenWb.SheetNames[0]], { defval: null });
    const fixed = XLSX.utils.sheet_to_json(fixedWb.Sheets[fixedWb.SheetNames[0]], { defval: null, raw: false });
    expect(fixed.length).toBeGreaterThanOrEqual(2);
    expect(broken.length).toBeLessThan(fixed.length);
    const { rows, skippedCancelled } = parseEzgoActivitiesReport(fixed);
    expect(skippedCancelled).toBe(0);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.start_time === "10:00")).toBe(true);
    expect(rows[0].phone).toBe("972546443510");
    // Date may arrive as ISO, locale short, or Date — all must normalize.
    expect(rows.map((r) => r.appointment_date)).toEqual(["2026-07-13", "2026-07-13"]);
  });

  test("real Mike CSV תפעול ספא 13.7 — repair recovers full day (skip if file absent)", () => {
    const fs = require("fs");
    const path = require("path");
    const XLSX = require("xlsx");
    const csvPath = path.join(
      process.env.USERPROFILE || process.env.HOME || "",
      "Downloads",
      "תפעול ספא 13.7.csv"
    );
    if (!fs.existsSync(csvPath)) return; // CI / other machines — unit suite still green

    const buf = fs.readFileSync(csvPath);
    const brokenWb = XLSX.read(buf, { type: "buffer" });
    const broken = XLSX.utils.sheet_to_json(brokenWb.Sheets[brokenWb.SheetNames[0]], { defval: null });

    const text = repairEzgoCsvText(buf.toString("utf8"));
    const fixedWb = XLSX.read(text, { type: "string", raw: false, codepage: 65001 });
    const fixed = XLSX.utils.sheet_to_json(fixedWb.Sheets[fixedWb.SheetNames[0]], { defval: null, raw: false });
    const { rows, skippedCancelled } = parseEzgoActivitiesReport(fixed);

    expect(fixed.length).toBeGreaterThan(broken.length);
    expect(rows.length + skippedCancelled).toBe(fixed.length);
    expect(rows.length).toBeGreaterThanOrEqual(200);
    expect(skippedCancelled).toBeGreaterThanOrEqual(40);
    expect(rows.every((r) => r.start_time && r.end_time)).toBe(true);
    expect(rows.every((r) => r.source === "english_csv")).toBe(true);
    expect(new Set(rows.map((r) => r.appointment_date))).toEqual(new Set(["2026-07-13"]));
    expect(rows.filter((r) => !r.phone).length).toBe(0);
    expect(rows.filter((r) => !r.room_raw).length).toBe(0);
  });
});

describe("English CSV canonicalize", () => {
  const englishRow = {
    iItemId: "11448",
    iLineStatus: "1",
    iAddsLineId: "2890534",
    sRowNum: "1",
    dtDate: "2026-06-16",
    tmStart: "9:00",
    tmEnd: "9:45",
    sAttendantName: "אולגה רודה",
    sTreatDesc: "שוודי",
    sExtraDesc: "טיפול 45 דקות בחבילה-לא למכירה ",
    sActivityDesc: "סוויטת אבניו 1",
    sClientName: "רעות (רעות לוי)",
    sTel: "0507474176",
    sRemark: "",
  };

  test("isEnglishActivitiesCsvRow detects machine CSV keys", () => {
    expect(isEnglishActivitiesCsvRow(englishRow)).toBe(true);
    expect(isEnglishActivitiesCsvRow({ תזמון: "10:00-10:30", פעילות: "חדר 1" })).toBe(false);
  });

  test("canonicalize composes unique ezgo id from iAddsLineId + sRowNum", () => {
    const c = canonicalizeEnglishActivitiesRow(englishRow);
    expect(c.מזהה).toBe("2890534_1");
    expect(c.תזמון).toBe("09:00-09:45");
    expect(c._appointment_date).toBe("2026-06-16");
    expect(c._cancelled).toBe(false);
  });

  test("couple half-rows sharing iAddsLineId get distinct מזהה via sRowNum", () => {
    const a = canonicalizeEnglishActivitiesRow({ ...englishRow, sRowNum: "1", sAttendantName: "נטלי" });
    const b = canonicalizeEnglishActivitiesRow({ ...englishRow, sRowNum: "2", sAttendantName: "סבטה" });
    expect(a.מזהה).toBe("2890534_1");
    expect(b.מזהה).toBe("2890534_2");
    expect(a.מזהה).not.toBe(b.מזהה);
  });

  test("iLineStatus 0 → cancelled", () => {
    const c = canonicalizeEnglishActivitiesRow({ ...englishRow, iLineStatus: "0" });
    expect(c._cancelled).toBe(true);
  });

  test("mapEzgoActivitiesRow maps a full English CSV row", () => {
    const row = mapEzgoActivitiesRow(englishRow);
    expect(row).toMatchObject({
      ezgo_line_id: "2890534_1",
      start_time: "09:00",
      end_time: "09:45",
      room_raw: "סוויטת אבניו 1",
      therapist_name: "אולגה רודה",
      treatment_type: "שוודי",
      guest_name: "רעות",
      group_label: "רעות לוי",
      phone: "972507474176",
      phone_raw: "0507474176",
      appointment_date: "2026-06-16",
      cancelled: false,
      source: "english_csv",
      warnings: [],
    });
    expect(row.raw).toBe(englishRow);
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

  test("maps a fully-populated Hebrew row with no warnings", () => {
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
      source: "hebrew_ui",
      warnings: [],
    });
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
      { "לקוח": "", "טלפון": "", "תזמון": "", "פעילות": "" },
      { "לקוח": "אורח ב", "טלפון": "0502222222", "תזמון": "10:00-10:30", "פעילות": "חדר 2" },
    ];
    const { rows: parsed, skippedCancelled } = parseEzgoActivitiesReport(rows);
    expect(parsed).toHaveLength(2);
    expect(skippedCancelled).toBe(0);
    expect(parsed.map((r) => r.guest_name)).toEqual(["אורח א", "אורח ב"]);
  });

  test("two rows sharing one phone (couple/group) both survive independently", () => {
    const rows = [
      { "לקוח": "בעל", "טלפון": "0503333333", "תזמון": "09:00-09:30", "פעילות": "חדר 3" },
      { "לקוח": "אישה", "טלפון": "0503333333", "תזמון": "09:00-09:30", "פעילות": "חדר 4" },
    ];
    const { rows: parsed } = parseEzgoActivitiesReport(rows);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].phone).toBe(parsed[1].phone);
    expect(parsed.map((r) => r.guest_name)).toEqual(["בעל", "אישה"]);
  });

  test("English CSV cancelled lines (iLineStatus=0) are counted, not synced", () => {
    const rows = [
      {
        iLineStatus: "1", iAddsLineId: "1", sRowNum: "1", dtDate: "2026-06-16",
        tmStart: "9:00", tmEnd: "9:45", sActivityDesc: "חדר 1", sAttendantName: "א",
        sClientName: "פעיל", sTel: "0501111111",
      },
      {
        iLineStatus: "0", iAddsLineId: "2", sRowNum: "2", dtDate: "2026-06-16",
        tmStart: "10:00", tmEnd: "10:45", sActivityDesc: "חדר 2", sAttendantName: "ב",
        sClientName: "מבוטל", sTel: "0502222222",
      },
    ];
    const { rows: parsed, skippedCancelled } = parseEzgoActivitiesReport(rows);
    expect(skippedCancelled).toBe(1);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].guest_name).toBe("פעיל");
  });

  test("non-array input returns empty shape instead of throwing", () => {
    expect(parseEzgoActivitiesReport(null)).toEqual({ rows: [], skippedCancelled: 0 });
    expect(parseEzgoActivitiesReport(undefined)).toEqual({ rows: [], skippedCancelled: 0 });
  });
});

import {
  detectEzgoLooseArrivalsPreset,
  parseDateFromCsvFilename,
  parseSuiteArrivalsCsvText,
  looksLikeSuiteArrivalsCsv,
} from "./ezgoDoc2SuiteCsvParser.ts";

Deno.test("parseDateFromCsvFilename reads csv.25.07.26 style names", () => {
  const d = parseDateFromCsvFilename("csv.25.07.26");
  if (d !== "2026-07-25") throw new Error(`expected 2026-07-25 got ${d}`);
});

Deno.test("parseSuiteArrivalsCsvText parses standard EZGO suite export", () => {
  const csv = [
    "iOrderId,sTel1,sRemark,sClientFullName,sSubItemName,sRoomName,iResLineId,iNights",
    "266932,525778390,מרדכי 050-7774904,עיריית ת״א,סוויטת אמטיסט,8,9821345,2",
  ].join("\n");
  const records = parseSuiteArrivalsCsvText(csv, "csv.25.07.26");
  if (records.length !== 1) throw new Error(`expected 1 record got ${records.length}`);
  if (records[0].order_number !== "266932") throw new Error("order mismatch");
  if (!records[0].phone) throw new Error("expected phone");
  if (records[0].arrival_date !== "2026-07-25") throw new Error(`arrival ${records[0].arrival_date}`);
});

Deno.test("detectEzgoLooseArrivalsPreset matches LineIndex/ItemID export shape", () => {
  const headers = [
    "LineIndex", "LineType", "ItemID", "KIDrowID", "SUBItemName", "sTel1", "sRemark",
  ];
  const preset = detectEzgoLooseArrivalsPreset(headers);
  if (!preset) throw new Error("expected loose preset");
  if (preset.orderNumber !== "ItemID") throw new Error(`order col ${preset.orderNumber}`);
  if (preset.suiteType !== "SUBItemName") throw new Error(`suite col ${preset.suiteType}`);
});

Deno.test("parseSuiteArrivalsCsvText: blank iNights on suite row → departure_date null + departure_missing_nights, NOT day-guest — P0 2026-08-05", () => {
  const csv = [
    "iOrderId,sTel1,sRemark,sClientFullName,sSubItemName,sRoomName,iResLineId,iNights",
    "266940,0525778392,מרדכי,ישראל כהן,סוויטת אמטיסט,10,9821347,",
  ].join("\n");
  const records = parseSuiteArrivalsCsvText(csv, "05.08.26.csv");
  if (records.length !== 1) throw new Error(`expected 1 record got ${records.length}`);
  if (records[0].nights !== null) throw new Error(`expected null nights got ${records[0].nights}`);
  if (records[0].is_day_guest) throw new Error("expected suite, not day guest");
  if (records[0].departure_date !== null) throw new Error(`expected null departure got ${records[0].departure_date}`);
  if (!records[0].departure_missing_nights) throw new Error("expected departure_missing_nights flag");
});

Deno.test("parseSuiteArrivalsCsvText: iNights=2 on suite row → departure = arrival+2, flag false", () => {
  const csv = [
    "iOrderId,sTel1,sRemark,sClientFullName,sSubItemName,sRoomName,iResLineId,iNights",
    "266942,0525778394,מרדכי,ישראל דגן,סוויטת אמטיסט,11,9821349,2",
  ].join("\n");
  const records = parseSuiteArrivalsCsvText(csv, "05.08.26.csv");
  if (records[0].departure_date !== "2026-08-07") throw new Error(`departure ${records[0].departure_date}`);
  if (records[0].departure_missing_nights) throw new Error("expected flag false");
});

Deno.test("parseSuiteArrivalsCsvText: duplicated coordinator name → is_remark_group_occupant + coord_name/coord_phone set (CSV parity with HTML mail path) — P1 2026-08-05", () => {
  const csv = [
    "iOrderId,sTel1,sRemark,sClientFullName,sSubItemName,sRoomName,iResLineId,iNights",
    "301222,0500000000,ישראל ישראלי 0521111111,ישראל ישראלי,סוויטת אוניקס,12,9821350,1",
    "301222,0500000000,משה לוי 0522222222,ישראל ישראלי,סוויטת אוניקס,7,9821351,1",
  ].join("\n");
  const records = parseSuiteArrivalsCsvText(csv, "07.08.26.csv");
  if (records.length !== 2) throw new Error(`expected 2 records got ${records.length}`);
  for (const r of records) {
    if (!r.is_remark_group_occupant) throw new Error("expected is_remark_group_occupant true");
    if (r.coord_name !== "ישראל ישראלי") throw new Error(`coord_name ${r.coord_name}`);
    if (!r.coord_phone) throw new Error("expected coord_phone set");
  }
  if (records[0].guest_name !== "ישראל ישראלי") throw new Error(`row0 guest_name ${records[0].guest_name}`);
  if (records[1].guest_name !== "משה לוי") throw new Error(`row1 guest_name ${records[1].guest_name}`);
});

Deno.test("parseSuiteArrivalsCsvText: iNights=0 on day-pass row → departure_date === arrival_date — P0 2026-08-05", () => {
  const csv = [
    "iOrderId,sTel1,sRemark,sClientFullName,sSubItemName,sRoomName,iResLineId,iNights",
    "266941,0525778393,הערה,ישראל לוי,בילוי יומי,,9821348,0",
  ].join("\n");
  const records = parseSuiteArrivalsCsvText(csv, "05.08.26.csv");
  if (records.length !== 1) throw new Error(`expected 1 record got ${records.length}`);
  if (!records[0].is_day_guest) throw new Error("expected day guest");
  if (records[0].departure_date !== records[0].arrival_date) {
    throw new Error(`expected departure===arrival, got ${records[0].departure_date} vs ${records[0].arrival_date}`);
  }
});

Deno.test("looksLikeSuiteArrivalsCsv detects Hebrew detailed export", () => {
  const text = [
    '"אתר","מס. לקוח","סטטוס","ResMode","מספר פקיד","סגמנט מכירות","מספר מקור הגעה","1Lina7NoLina","שם מלא","טלפון","ת. התחלה","דואר אלקטרוני","טלפון נוסף","חדרים","לילות","מחיר","מטבע","מחיר","מקור הגעה","בסיס אירוח","בסיס אירוח","מס. הזמנה"',
    '"11448","17044","1","1","177","3","17","1","ורד אמויאל","0522468207","01/07/2026 00:00:00","","0507966645","1","1","0","0","0.00₪","שוברים ","11","HB","274644"',
  ].join("\n");
  if (!looksLikeSuiteArrivalsCsv(text)) throw new Error("expected Hebrew preset hit");
  const records = parseSuiteArrivalsCsvText(text, "01.7.26.csv");
  if (records.length < 1) throw new Error(`expected rows got ${records.length}`);
});

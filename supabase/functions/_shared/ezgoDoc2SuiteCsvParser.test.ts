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

Deno.test("looksLikeSuiteArrivalsCsv detects Hebrew detailed export", () => {
  const text = [
    '"אתר","מס. לקוח","סטטוס","ResMode","מספר פקיד","סגמנט מכירות","מספר מקור הגעה","1Lina7NoLina","שם מלא","טלפון","ת. התחלה","דואר אלקטרוני","טלפון נוסף","חדרים","לילות","מחיר","מטבע","מחיר","מקור הגעה","בסיס אירוח","בסיס אירוח","מס. הזמנה"',
    '"11448","17044","1","1","177","3","17","1","ורד אמויאל","0522468207","01/07/2026 00:00:00","","0507966645","1","1","0","0","0.00₪","שוברים ","11","HB","274644"',
  ].join("\n");
  if (!looksLikeSuiteArrivalsCsv(text)) throw new Error("expected Hebrew preset hit");
  const records = parseSuiteArrivalsCsvText(text, "01.7.26.csv");
  if (records.length < 1) throw new Error(`expected rows got ${records.length}`);
});

// src/utils/detailedReservationParser.test.js
// Sprint 2 — umbrella/municipal group row detection on the Detailed
// Reservation Report import path. Mirrors the same isUmbrellaRow() rule
// Guest Import Intelligence already applies to the arrivals/ops sources
// (see guestImportIntelligence.test.js) — this file only proves the
// Detailed Reservation Report's own row flag (isUmbrellaGroupRow) and its
// classifyDbMatch() outcome, not the shared rule itself.

import { parseDetailedReservationRows, csvTextToRowObjects } from "./detailedReservationParser";
import { classifyDbMatch } from "./guestImportIntelligence";

const HEADERS = ["שם מלא", "טלפון", "מס. הזמנה", "ת. הגעה", "חדרים", "לילות", "מקור הגעה"];

function buildMatrix(dataRow) {
  return [HEADERS, dataRow];
}

describe("detailedReservationParser — umbrella group row detection (Sprint 2)", () => {
  test("dummy phone + many rooms + corporate name → isUmbrellaGroupRow + classifyDbMatch unimportable", () => {
    const matrix = buildMatrix(["עיריית תל אביב", "111", "300500", "01/07/2026", "12", "3", "אתר האינטרנט"]);
    const { rows } = parseDetailedReservationRows(matrix);

    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.guestPhone).toBe(null); // "111" fails IL-mobile normalization — never silently coerced
    expect(row.isUmbrellaGroupRow).toBe(true);

    const candidate = {
      guestName: row.guestName,
      guestPhone: row.guestPhone,
      _rawPhone: row.guestPhone,
      orderNumber: row.orderNumber,
      roomsCount: row.rooms_count,
    };
    expect(classifyDbMatch(candidate, null)).toBe("unimportable");
  });

  test("real individual guest, single room, real phone → isUmbrellaGroupRow is false", () => {
    const matrix = buildMatrix(["יוסי כהן", "0521112233", "300501", "01/07/2026", "1", "2", "אתר האינטרנט"]);
    const { rows } = parseDetailedReservationRows(matrix);

    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.guestPhone).toBe("+972521112233");
    expect(row.isUmbrellaGroupRow).toBe(false);

    const candidate = {
      guestName: row.guestName,
      guestPhone: row.guestPhone,
      _rawPhone: row.guestPhone,
      orderNumber: row.orderNumber,
      roomsCount: row.rooms_count,
    };
    expect(classifyDbMatch(candidate, null)).toBe("new");
  });

  test("row is never dropped even when flagged as an umbrella group (Zero Data Loss)", () => {
    const matrix = buildMatrix(["עיריית חיפה", "0000000000", "300502", "01/07/2026", "8", "1", "אתר האינטרנט"]);
    const { rows } = parseDetailedReservationRows(matrix);

    expect(rows).toHaveLength(1); // present + flagged, not silently removed
    expect(rows[0].isUmbrellaGroupRow).toBe(true);
  });
});

// ── XOS Task 1: csvTextToRowObjects — quote-aware CSV → header-keyed rows ──
// Used by ArrivalImportPanel.js's handleDoc2 for raw EZGO Suites .csv uploads
// instead of SheetJS's own CSV auto-parse, which can mis-split a row when a
// free-text field (e.g. sRemark) embeds an unescaped comma/quote.
describe("detailedReservationParser — csvTextToRowObjects", () => {
  test("parses a well-formed CSV into header-keyed row objects", () => {
    const text = "iOrderId,sTel1,sRemark\n266932,0501112222,מרדכי 050-7774904\n";
    const rows = csvTextToRowObjects(text);
    expect(rows).toEqual([
      { iOrderId: "266932", sTel1: "0501112222", sRemark: "מרדכי 050-7774904" },
    ]);
  });

  test("a quoted field containing a comma stays intact in a single column (the bug this fixes)", () => {
    // The exact failure mode: sRemark holds a comma-laden fragment quoted per
    // RFC4180 — a naive/SheetJS split on bare commas would bleed this across
    // extra columns; the quote-aware parser keeps it as one field.
    const text =
      'iOrderId,sTel1,sRemark,sClientFullName\n' +
      '266933,0506919808,"רינת עקיבא 3 בחדר, גוש 12, עיריית תל אביב 0506919808",רינת עקיבא\n';
    const rows = csvTextToRowObjects(text);
    expect(rows).toHaveLength(1);
    expect(rows[0].sRemark).toBe("רינת עקיבא 3 בחדר, גוש 12, עיריית תל אביב 0506919808");
    expect(rows[0].sClientFullName).toBe("רינת עקיבא");
  });

  test("empty text returns an empty array, not a throw", () => {
    expect(csvTextToRowObjects("")).toEqual([]);
  });

  test("unescaped ש\"ח inside a quoted sRemark does not truncate the file", () => {
    const text =
      'iOrderId,sTel1,sRemark\n' +
      '262071,111,"רינת עקיבא 3 בחדר תוספת ל 3 פרטי 1000 ש"ח תשלום ביום ההגעה"\n' +
      "277797,0545679149,\n";
    const rows = csvTextToRowObjects(text);
    expect(rows).toHaveLength(2);
    expect(rows[0].sRemark).toContain("1000 ש\"ח");
    expect(rows[1].iOrderId).toBe("277797");
  });
});

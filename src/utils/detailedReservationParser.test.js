// src/utils/detailedReservationParser.test.js
// Sprint 2 — umbrella/municipal group row detection on the Detailed
// Reservation Report import path. Mirrors the same isUmbrellaRow() rule
// Guest Import Intelligence already applies to the arrivals/ops sources
// (see guestImportIntelligence.test.js) — this file only proves the
// Detailed Reservation Report's own row flag (isUmbrellaGroupRow) and its
// classifyDbMatch() outcome, not the shared rule itself.

import { parseDetailedReservationRows } from "./detailedReservationParser";
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

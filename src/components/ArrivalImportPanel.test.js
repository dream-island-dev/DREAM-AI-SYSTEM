// src/components/ArrivalImportPanel.test.js
// Sprint 3 — _getSyncProfileIndices unit tests. Guest Import Intelligence
// wiring (CLAUDE.md §10 session — Sprint 3): dbMatchByIdx (from
// classifyDbMatch, see guestImportIntelligence.js) now gates which rows
// actually reach the sync_suite_arrivals RPC.

import { _getSyncProfileIndices } from "./ArrivalImportPanel";

function _row(i, { guestPhone = "+972500000000" } = {}) {
  return { _profileIdx: i, guestPhone };
}

function _gridRow(i) {
  return { _profileIdx: i, _id: `row_${i}` };
}

describe("_getSyncProfileIndices — Sprint 3 DB-match gating", () => {
  test("skips rows classified as unimportable (umbrella/corporate), keeps the rest", () => {
    const merged = [_row(0), _row(1), _row(2)];
    const gridRows = merged.map((_, i) => _gridRow(i));
    const dbMatchByIdx = new Map([
      [0, "unimportable"],
      [1, "new"],
      [2, "existing"],
    ]);

    const { indices, skippedUnimportable, conflicts } = _getSyncProfileIndices(merged, gridRows, {
      importSource: null,
      detailedRoomFilter: "all",
      selectedIds: new Set(),
      dbMatchByIdx,
    });

    expect(indices).toEqual([1, 2]);
    expect(skippedUnimportable).toBe(1);
    expect(conflicts).toEqual([]);
  });

  test("still skips rows with no guestPhone regardless of dbMatchByIdx status", () => {
    const merged = [_row(0, { guestPhone: null }), _row(1)];
    const gridRows = merged.map((_, i) => _gridRow(i));
    const dbMatchByIdx = new Map([
      [0, "new"], // would be importable per DB status, but has no phone at all
      [1, "new"],
    ]);

    const { indices } = _getSyncProfileIndices(merged, gridRows, {
      importSource: null,
      detailedRoomFilter: "all",
      selectedIds: new Set(),
      dbMatchByIdx,
    });

    expect(indices).toEqual([1]);
  });

  test("conflict rows are NOT skipped — they sync, but are reported separately", () => {
    const merged = [_row(0), _row(1)];
    const gridRows = merged.map((_, i) => _gridRow(i));
    const dbMatchByIdx = new Map([
      [0, "conflict"],
      [1, "existing"],
    ]);

    const { indices, conflicts, skippedUnimportable } = _getSyncProfileIndices(merged, gridRows, {
      importSource: null,
      detailedRoomFilter: "all",
      selectedIds: new Set(),
      dbMatchByIdx,
    });

    expect(indices).toEqual([0, 1]); // conflict row 0 still syncs
    expect(conflicts).toEqual([0]);
    expect(skippedUnimportable).toBe(0);
  });

  test("selectedIds filter still applies on top of dbMatchByIdx gating", () => {
    const merged = [_row(0), _row(1), _row(2)];
    const gridRows = merged.map((_, i) => _gridRow(i));
    const dbMatchByIdx = new Map([
      [0, "new"],
      [1, "new"],
      [2, "unimportable"],
    ]);

    const { indices } = _getSyncProfileIndices(merged, gridRows, {
      importSource: null,
      detailedRoomFilter: "all",
      selectedIds: new Set(["row_1"]), // only row 1 hand-picked
      dbMatchByIdx,
    });

    expect(indices).toEqual([1]);
  });

  test("missing dbMatchByIdx (undefined) never throws and treats every row as importable", () => {
    const merged = [_row(0), _row(1)];
    const gridRows = merged.map((_, i) => _gridRow(i));

    const { indices, skippedUnimportable, conflicts } = _getSyncProfileIndices(merged, gridRows, {
      importSource: null,
      detailedRoomFilter: "all",
      selectedIds: new Set(),
    });

    expect(indices).toEqual([0, 1]);
    expect(skippedUnimportable).toBe(0);
    expect(conflicts).toEqual([]);
  });
});

import fs from "fs";
import path from "path";
import {
  parseHousekeepingReadyRoomNumbers,
  parseHousekeepingCheckInRoomNumbers,
  parseHousekeepingCheckOutRoomNumbers,
  looksLikeHousekeepingNearMiss,
  buildHousekeepingNearMissClarification,
} from "./housekeepingWaParse";
import { buildHousekeepingGroupAckMessage, buildHousekeepingReadyAckLine } from "./housekeepingReadySignal";
import { buildHousekeepingCheckInAckLine } from "./housekeepingCheckInSignal";

const REPO_ROOT = path.resolve(__dirname, "../..");

function listMirrorConstNames(source) {
  return [...source.matchAll(/^const ([A-Z][A-Z0-9_]+) = /gm)].map((m) => m[1]).sort();
}

function listMirrorExportNames(source) {
  return [...source.matchAll(/^export function (\w+)/gm)].map((m) => m[1]).sort();
}

describe("housekeepingWaParse", () => {
  test("TS/JS mirror — same const + export surface", () => {
    const ts = fs.readFileSync(
      path.join(REPO_ROOT, "supabase/functions/_shared/housekeepingWaParse.ts"),
      "utf8",
    );
    const js = fs.readFileSync(path.join(__dirname, "housekeepingWaParse.js"), "utf8");
    expect(listMirrorConstNames(ts)).toEqual(listMirrorConstNames(js));
    expect(listMirrorExportNames(ts)).toEqual(listMirrorExportNames(js));
  });
  test("parses compact ready patterns from live group export", () => {
    expect(parseHousekeepingReadyRoomNumbers("7✅")).toEqual([7]);
    expect(parseHousekeepingReadyRoomNumbers("13✅\n16✅")).toEqual([13, 16]);
    expect(parseHousekeepingReadyRoomNumbers("Room 7 ✅")).toEqual([7]);
    expect(parseHousekeepingReadyRoomNumbers("22 ready ✅")).toEqual([22]);
    expect(parseHousekeepingReadyRoomNumbers("Room 2 is ready ✅")).toEqual([2]);
    expect(parseHousekeepingReadyRoomNumbers("14 מוכן")).toEqual([14]);
  });

  test("excludes waiting / checkout — check-in handled separately", () => {
    expect(parseHousekeepingReadyRoomNumbers("5 ממתין")).toEqual([]);
    expect(parseHousekeepingReadyRoomNumbers("25 - ממתין - טריפל")).toEqual([]);
    expect(parseHousekeepingReadyRoomNumbers("8 check outtttt")).toEqual([]);
    expect(parseHousekeepingReadyRoomNumbers("22 co")).toEqual([]);
    expect(parseHousekeepingReadyRoomNumbers("2 צ׳ק אין")).toEqual([]);
  });

  test("parses check-in patterns from live group export", () => {
    expect(parseHousekeepingCheckInRoomNumbers("2 צ׳ק אין")).toEqual([2]);
    expect(parseHousekeepingCheckInRoomNumbers("25 צק אין")).toEqual([25]);
    expect(parseHousekeepingCheckInRoomNumbers("4 ציק אין")).toEqual([4]);
    expect(parseHousekeepingCheckInRoomNumbers("4,5\nציק אין")).toEqual([4, 5]);
    expect(parseHousekeepingCheckInRoomNumbers("1 check in")).toEqual([1]);
    expect(parseHousekeepingCheckInRoomNumbers("17 צ'ק אין")).toEqual([17]);
    expect(parseHousekeepingCheckInRoomNumbers("16 צ\u2019ק אין")).toEqual([16]);
    expect(parseHousekeepingCheckInRoomNumbers("CI 17")).toEqual([17]);
    expect(parseHousekeepingCheckInRoomNumbers("ci 7")).toEqual([7]);
    expect(parseHousekeepingCheckInRoomNumbers("check in 11")).toEqual([11]);
    expect(parseHousekeepingCheckInRoomNumbers("17 ci")).toEqual([17]);
    expect(parseHousekeepingCheckInRoomNumbers("8 check out")).toEqual([]);
  });

  test("parses check-out patterns from live group (Co 23 / 24 co)", () => {
    expect(parseHousekeepingCheckOutRoomNumbers("Co 23")).toEqual([23]);
    expect(parseHousekeepingCheckOutRoomNumbers("24 co")).toEqual([24]);
    expect(parseHousekeepingCheckOutRoomNumbers("CO 7")).toEqual([7]);
    expect(parseHousekeepingCheckOutRoomNumbers("16 check out")).toEqual([16]);
    expect(parseHousekeepingCheckOutRoomNumbers("check out 11")).toEqual([11]);
    expect(parseHousekeepingCheckOutRoomNumbers("23 צ'ק אאוט")).toEqual([23]);
    expect(parseHousekeepingCheckOutRoomNumbers("צק אאוט 9")).toEqual([9]);
    expect(parseHousekeepingCheckOutRoomNumbers("שילמו בקבלה 7 co")).toEqual([7]);
    // Must not steal check-in or ready
    expect(parseHousekeepingCheckOutRoomNumbers("17 צ'ק אין")).toEqual([]);
    expect(parseHousekeepingCheckOutRoomNumbers("CI 17")).toEqual([]);
    expect(parseHousekeepingCheckOutRoomNumbers("14✅")).toEqual([]);
    expect(parseHousekeepingCheckInRoomNumbers("Co 23")).toEqual([]);
    expect(parseHousekeepingReadyRoomNumbers("Co 23")).toEqual([]);
    expect(parseHousekeepingReadyRoomNumbers("24 co")).toEqual([]);
  });

  test("✅ always wins over check-in phrasing in the same line (bell priority)", () => {
    // ✅ right after the room number (the real-world order — ✅ arrives first)
    // + check-in text tacked on → READY only, never check-in.
    expect(parseHousekeepingReadyRoomNumbers("14 ✅ צ'ק אין")).toEqual([14]);
    expect(parseHousekeepingCheckInRoomNumbers("14 ✅ צ'ק אין")).toEqual([]);

    // ✅ anywhere in the line always blocks check-in detection, even if the
    // ✅ isn't adjacent enough to the room number to register as ready itself
    // (ambiguous message — safer to trigger neither action than to wrongly
    // fire check-in on what was actually a ready/bell message).
    expect(parseHousekeepingReadyRoomNumbers("14 צ'ק אין ✅")).toEqual([]);
    expect(parseHousekeepingCheckInRoomNumbers("14 צ'ק אין ✅")).toEqual([]);

    // No ✅, just check-in text → check-in only, never ready (unchanged behavior)
    expect(parseHousekeepingReadyRoomNumbers("14 צ'ק אין")).toEqual([]);
    expect(parseHousekeepingReadyRoomNumbers("CI 17")).toEqual([]);
    expect(parseHousekeepingCheckInRoomNumbers("14 צ'ק אין")).toEqual([14]);
    expect(parseHousekeepingCheckInRoomNumbers("CI 17")).toEqual([17]);
  });

  test("parses checkmark-before-number (✅ 23)", () => {
    expect(parseHousekeepingReadyRoomNumbers("✅ 23")).toEqual([23]);
    expect(parseHousekeepingReadyRoomNumbers("✅23")).toEqual([23]);
    expect(parseHousekeepingReadyRoomNumbers("✅ 6,11,14")).toEqual([6, 11, 14]);
  });

  test("parses forwarded bubbles — strips label, keeps room signal", () => {
    expect(parseHousekeepingReadyRoomNumbers("הועברה\n14✅")).toEqual([14]);
    expect(parseHousekeepingReadyRoomNumbers("הועברה\n✅ 23")).toEqual([23]);
    expect(parseHousekeepingCheckInRoomNumbers("הועברה\n17 צק אין")).toEqual([17]);
  });

  test("near-miss gate — short HK anchor only, not long chat", () => {
    expect(looksLikeHousekeepingNearMiss("✅")).toBe(true);
    expect(looksLikeHousekeepingNearMiss("מה יש לארוחת צהריים היום בערמונים")).toBe(false);
    expect(looksLikeHousekeepingNearMiss("14✅")).toBe(false);
    expect(buildHousekeepingNearMissClarification("✅")).toBe("⚠️ איזה חדר מוכן? (למשל 6✅)");
  });

  test("clamps to suite numbers 1–26", () => {
    expect(parseHousekeepingReadyRoomNumbers("99✅")).toEqual([]);
    expect(parseHousekeepingReadyRoomNumbers("0✅")).toEqual([]);
  });

  test("mixed multi-line bubble from Adir-style burst", () => {
    const text = [
      "Room 7 ✅",
      "13✅",
      "16✅",
      "18✅",
      "Room 9 ✅",
    ].join("\n");
    expect(parseHousekeepingReadyRoomNumbers(text)).toEqual([7, 9, 13, 16, 18]);
  });

  test("Adir-style room list then action on next line", () => {
    expect(parseHousekeepingCheckInRoomNumbers("4,5\nצ׳ק אין")).toEqual([4, 5]);
    expect(parseHousekeepingCheckInRoomNumbers("4 5\nצק אין")).toEqual([4, 5]);
    expect(parseHousekeepingCheckInRoomNumbers("4\n5\nצ׳ק אין")).toEqual([4, 5]);
    expect(parseHousekeepingCheckInRoomNumbers("4,5 צ׳ק אין")).toEqual([4, 5]);
    expect(parseHousekeepingCheckInRoomNumbers("צק אין\n4,5")).toEqual([]);
    expect(parseHousekeepingReadyRoomNumbers("4,5\n✅")).toEqual([4, 5]);
    expect(parseHousekeepingReadyRoomNumbers("4,5\nמוכן")).toEqual([4, 5]);
    expect(parseHousekeepingReadyRoomNumbers("4,5 ✅")).toEqual([4, 5]);
    expect(parseHousekeepingCheckOutRoomNumbers("4,5\nco")).toEqual([4, 5]);
    expect(parseHousekeepingCheckOutRoomNumbers("4,5 co")).toEqual([4, 5]);
  });

  test("group ack message for fresh bell triggers", () => {
    expect(buildHousekeepingGroupAckMessage(["רובי 14"])).toBe(
      "✅ רובי 14 מוכן — ממתין לאישור מנהל לשליחת הודעה 🔔",
    );
    expect(buildHousekeepingGroupAckMessage([
      { roomId: "רובי 14", guestName: "ישראל ישראלי" },
      { roomId: "רובי 15" },
    ])).toBe(
      "✅ רובי 14 מוכן — אורח: ישראל ישראלי — ממתין לאישור מנהל לשליחת הודעה 🔔\n✅ רובי 15 מוכן — ממתין לאישור מנהל לשליחת הודעה 🔔",
    );
    expect(buildHousekeepingGroupAckMessage([])).toBe("");
  });

  test("ready ack lines for sync outcomes", () => {
    expect(buildHousekeepingReadyAckLine({
      roomId: "רובי 14",
      guestName: "ישראל",
      action: "updated",
    })).toBe("✅ רובי 14 מוכן — אורח: ישראל — ממתין לאישור מנהל 🔔");
    expect(buildHousekeepingReadyAckLine({
      roomId: "רובי 6",
      action: "already_pending",
    })).toBe("ℹ️ רובי 6 — כבר ממתין לאישור");
  });

  describe("known parse gaps — documented, not yet fixed (see CLAUDE.md Epic A follow-up)", () => {
    test("alternate checkmark glyphs (✔ ☑ ✓) are NOT recognized as an HK anchor — deliberate, not a gap", () => {
      // Considered widening HK_ANCHOR_RE to catch these too (a staff phone that
      // renders a different checkmark than ✅), but ✔/☑/✓ are common casual
      // "ok/got it" chat in Hebrew — doing so turned ordinary messages like
      // "✓ 5 דקות ומגיע" into false-positive "which room?" clarifies. Reverted;
      // staying ✅-only is the safer tradeoff.
      expect(looksLikeHousekeepingNearMiss("✔️ 14")).toBe(false);
      expect(parseHousekeepingReadyRoomNumbers("✔️ 14")).toEqual([]);
    });


    test("Hebrew 'ו' (and) between two rooms — parse fails whole-line, but the near-miss safety net catches it", () => {
      // "4 ו-5 צק אין" — real staff phrasing meaning "rooms 4 and 5, check in".
      // The Hebrew ו breaks every regex's contiguous room-list match, so the
      // WHOLE line fails to parse (not a partial 4-only capture, as it might look
      // at a glance) — but looksLikeHousekeepingNearMiss (now unconditionally
      // visible, this PR) still fires because the line keeps its housekeeping
      // anchor + a suite-range digit, so staff get a "which room?" clarify rather
      // than a silent drop. Still worth teaching the parser this phrasing
      // properly (0 rooms recorded is still 0 rooms recorded) — flagged as a
      // follow-up, but no longer a *silent* gap.
      expect(parseHousekeepingCheckInRoomNumbers("4 ו-5 צק אין")).toEqual([]);
      expect(looksLikeHousekeepingNearMiss("4 ו-5 צק אין")).toBe(true);
    });

    test("dash is read as a list separator, not a range — '4-6' silently checks in {4,6}, room 5 vanishes with NO clarify", () => {
      // Unlike the ו case above, this one parses successfully (non-empty), so the
      // near-miss gate never sees it — the more dangerous of the two gaps, since
      // there's no signal anything is wrong at all. Flagged as a follow-up.
      expect(parseHousekeepingCheckInRoomNumbers("4-6 צק אין")).toEqual([4, 6]);
      expect(looksLikeHousekeepingNearMiss("4-6 צק אין")).toBe(false);
    });

    test("suite name instead of room number never parses and never near-misses", () => {
      // Parser is 100% digit-based — a message using the suite's name ("רובי")
      // instead of its number has no digit for extractBareRoomNumbers/addRoom to
      // find, so all three parsers return [] AND looksLikeHousekeepingNearMiss's
      // final hasSuiteRangeNumber() check also fails (no digit at all) — this is
      // silently classified as ordinary chat, not even a near-miss clarify.
      expect(parseHousekeepingReadyRoomNumbers("רובי מוכן")).toEqual([]);
      expect(looksLikeHousekeepingNearMiss("רובי מוכן")).toBe(false);
    });
  });

  test("check-in group ack lines", () => {
    expect(buildHousekeepingCheckInAckLine({
      roomId: "רובי 14",
      guestName: "ישראל",
      action: "updated",
    })).toBe("✅ חדר רובי 14 — צ'ק-אין נקלט (ישראל)");
    expect(buildHousekeepingCheckInAckLine({
      roomId: "רובי 14",
      guestName: "ישראל",
      action: "already_checked_in",
    })).toBe("ℹ️ חדר רובי 14 — כבר מסומן כצ'ק-אין (ישראל)");
    expect(buildHousekeepingCheckInAckLine({
      roomId: "רובי 14",
      action: "dedup",
    })).toBe(null);
    expect(buildHousekeepingCheckInAckLine({
      roomNumber: 99,
      roomId: null,
      action: "skipped_no_suite",
    })).toBe("⚠️ מספר חדר #99 לא מוכר במערכת — צ'ק-אין לא נקלט, בדקו את המספר");
    expect(buildHousekeepingCheckInAckLine({
      roomId: "רובי 14",
      action: "error",
    })).toBe("🚨 חדר רובי 14 — שגיאת מערכת בקליטת צ'ק-אין. בדקו ב-XOS ונסו לשלוח שוב, או פנו לתמיכה.");
  });

  test("ready ack lines for skipped_no_suite / error", () => {
    expect(buildHousekeepingReadyAckLine({
      roomNumber: 99,
      roomId: null,
      action: "skipped_no_suite",
    })).toBe('⚠️ מספר חדר #99 לא מוכר במערכת — סטטוס "מוכן" לא נקלט, בדקו את המספר');
    expect(buildHousekeepingReadyAckLine({
      roomId: "רובי 14",
      action: "error",
    })).toBe('🚨 רובי 14 — שגיאת מערכת בסימון "מוכן". בדקו ב-XOS ונסו לשלוח שוב, או פנו לתמיכה.');
    expect(buildHousekeepingReadyAckLine({
      roomId: "רובי 14",
      action: "dedup",
    })).toBe(null);
  });
});

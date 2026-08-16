import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  BOARD_TO_MEAL_PLAN,
  ddmmyyyyToIso,
  extractOrderClient,
  extractReservation,
  pickFillEmpty,
  resolveApiRoomOccupantIdentity,
} from "./ezgoGuestSyncLogic.ts";

// ── ddmmyyyyToIso ──────────────────────────────────────────────────────────

Deno.test("ddmmyyyyToIso: EZGO DD/MM/YYYY -> YYYY-MM-DD", () => {
  assertEquals(ddmmyyyyToIso("13/08/2026"), "2026-08-13");
  assertEquals(ddmmyyyyToIso("13/08/2026 11:00"), "2026-08-13"); // Timing.Start-style, time ignored
});

Deno.test("ddmmyyyyToIso: garbage/empty -> null, never guesses", () => {
  assertEquals(ddmmyyyyToIso(""), null);
  assertEquals(ddmmyyyyToIso(null), null);
  assertEquals(ddmmyyyyToIso("not a date"), null);
  assertEquals(ddmmyyyyToIso("2026-08-13"), null); // wrong order — not EZGO's format
});

// ── BOARD_TO_MEAL_PLAN ────────────────────────────────────────────────────

Deno.test("BOARD_TO_MEAL_PLAN: matches the live guests_meal_plan_check enum", () => {
  assertEquals(BOARD_TO_MEAL_PLAN[0], "none");
  assertEquals(BOARD_TO_MEAL_PLAN[1], "none"); // RoomOnly
  assertEquals(BOARD_TO_MEAL_PLAN[11], "half_board");
  assertEquals(BOARD_TO_MEAL_PLAN[15], "full_board");
});

Deno.test("BOARD_TO_MEAL_PLAN: BB(3) deliberately has no entry — never guessed onto the wrong enum value", () => {
  assertEquals(BOARD_TO_MEAL_PLAN[3], undefined);
});

// ── pickFillEmpty ──────────────────────────────────────────────────────────

Deno.test("pickFillEmpty: fills when existing is empty/null/undefined", () => {
  assertEquals(pickFillEmpty("new@mail.com", null), { value: "new@mail.com", conflict: false });
  assertEquals(pickFillEmpty("new@mail.com", ""), { value: "new@mail.com", conflict: false });
  assertEquals(pickFillEmpty("new@mail.com", undefined), { value: "new@mail.com", conflict: false });
});

Deno.test("pickFillEmpty: never overwrites an existing non-empty value that agrees", () => {
  assertEquals(pickFillEmpty("same", "same"), { value: undefined, conflict: false });
});

Deno.test("pickFillEmpty: existing non-empty + API disagrees -> conflict, value NOT written", () => {
  const result = pickFillEmpty("api-value", "existing-value");
  assertEquals(result.value, undefined); // never silently overwritten
  assertEquals(result.conflict, true); // but surfaced, not silently dropped either
});

Deno.test("pickFillEmpty: API has nothing -> no-op, no conflict", () => {
  assertEquals(pickFillEmpty(null, "existing-value"), { value: undefined, conflict: false });
  assertEquals(pickFillEmpty(undefined, "existing-value"), { value: undefined, conflict: false });
  assertEquals(pickFillEmpty("", "existing-value"), { value: undefined, conflict: false });
});

// ── extractOrderClient — both live payload shapes ──────────────────────────

Deno.test("extractOrderClient: Entity=Orders shape (Data Webhook)", () => {
  const row = {
    id: "row-1",
    created_at: "2026-08-13T10:00:00Z",
    raw_payload: {
      Entity: "Orders",
      ItemId: 11448,
      OrderId: 280735,
      Value: JSON.stringify({
        Order: { OrderId: 280735, Status: 1, Board: 11 },
        Client: { FullName: "רוני אברהמי", Tel1: "0547762015", Email: "roni@example.com" },
      }),
    },
  };
  const result = extractOrderClient(row);
  assertEquals(result?.orderId, "280735");
  assertEquals(result?.status, 1);
  assertEquals(result?.board, 11);
  assertEquals(result?.fullName, "רוני אברהמי");
  assertEquals(result?.tel1, "0547762015");
  assertEquals(result?.email, "roni@example.com");
});

Deno.test("extractOrderClient: plain Type=Update full-snapshot shape (the other live webhook)", () => {
  const row = {
    id: "row-2",
    created_at: "2026-08-13T10:00:00Z",
    raw_payload: {
      Type: "Update",
      OrderId: 280735,
      Order: { OrderId: 280735, Status: 1, Board: 3 },
      Client: { FullName: "דניאל מנחם", Tel1: "0535488132", Email: null },
    },
  };
  const result = extractOrderClient(row);
  assertEquals(result?.orderId, "280735");
  assertEquals(result?.board, 3);
  assertEquals(result?.fullName, "דניאל מנחם");
  assertEquals(result?.email, null);
});

Deno.test("extractOrderClient: Type=Delete is NOT extracted here (handled separately by applyCancellation)", () => {
  const row = {
    id: "row-3",
    created_at: "2026-08-13T10:00:00Z",
    raw_payload: { Type: "Delete", OrderId: 284868, Order: { OrderId: 284868 }, Client: {} },
  };
  assertEquals(extractOrderClient(row), null);
});

Deno.test("extractOrderClient: Activities/Reservations entities return null (not this function's job)", () => {
  assertEquals(extractOrderClient({ id: "x", created_at: "", raw_payload: { Entity: "Activities" } }), null);
  assertEquals(extractOrderClient({ id: "x", created_at: "", raw_payload: { Entity: "Reservations" } }), null);
});

// ── extractReservation ─────────────────────────────────────────────────────

Deno.test("extractReservation: Entity=Reservations, real live-shaped payload", () => {
  const row = {
    id: "row-4",
    raw_payload: {
      Entity: "Reservations",
      OrderId: 284927,
      Value: JSON.stringify({
        Room: {
          SubItemId: 11436, LineId: 122852, RoomId: 3, Status: 1, LineStatus: 1,
          Checkin: "12/02/2027", Checkout: "13/02/2027", Remark: "", OperationRemark: "",
        },
      }),
    },
  };
  const result = extractReservation(row);
  assertEquals(result?.orderId, "284927");
  assertEquals(result?.roomId, 3);
  assertEquals(result?.lineId, "122852");
  assertEquals(result?.checkin, "2027-02-12");
  assertEquals(result?.checkout, "2027-02-13");
});

Deno.test("extractReservation: RoomId=0 (not yet assigned) is still extracted — caller decides, not this function", () => {
  const row = {
    id: "row-5",
    raw_payload: {
      Entity: "Reservations", OrderId: 284927,
      Value: JSON.stringify({ Room: { LineId: 122859, RoomId: 0, Status: 1 } }),
    },
  };
  assertEquals(extractReservation(row)?.roomId, 0);
});

// ── resolveApiRoomOccupantIdentity — group/room-merge rule (Mike, 2026-08-16,
// live incident: EZGO arrivals 2026-08-17, 22 room-lines / 17 guests, 5
// extra rooms with name-only remarks never landed in suite_rooms) ─────────

const coord = { fullName: "עידן זיתוני", tel1: "0523265035" };

Deno.test("2-room order, remarks name-only (no phone) -> both rooms stay on coordinator identity (1 guest, 2 suite_rooms)", () => {
  const room1 = resolveApiRoomOccupantIdentity(coord, "דגנית ושיר מוריה 7787", 2);
  const room2 = resolveApiRoomOccupantIdentity(coord, "❤️ יום הולדת", 2);
  for (const r of [room1, room2]) {
    assertEquals(r.is_remark_group_occupant, false);
    assertEquals(r.guest_name, coord.fullName);
    assertEquals(r.phone, coord.tel1);
  }
});

Deno.test("2-room order, each remark 'שם + 05x' -> two distinct occupants (2 guests, distinct phones)", () => {
  const room1 = resolveApiRoomOccupantIdentity(coord, "יוסי כהן 0521234567", 2);
  const room2 = resolveApiRoomOccupantIdentity(coord, "רותי לוי 0549876543", 2);
  assertEquals(room1.is_remark_group_occupant, true);
  assertEquals(room1.guest_name, "יוסי כהן");
  assertEquals(room1.phone, "+972521234567");
  assertEquals(room2.is_remark_group_occupant, true);
  assertEquals(room2.guest_name, "רותי לוי");
  assertEquals(room2.phone, "+972549876543");
  assertEquals(room1.phone === room2.phone, false); // distinct phones -> distinct guests
});

Deno.test("2-room order, remark is bare phone (no parseable name) -> do not swap, coordinator identity, rooms merged", () => {
  const room1 = resolveApiRoomOccupantIdentity(coord, "0521234567", 2);
  assertEquals(room1.is_remark_group_occupant, false);
  assertEquals(room1.guest_name, coord.fullName);
  assertEquals(room1.phone, coord.tel1);
});

Deno.test("single-room order (totalLinesInOrder=1) never swaps, even with a full name+phone remark", () => {
  // Not a shared-coordinator booking — matches Doc2 exactly (coordNameDuplicated
  // gates the swap, not remark content alone). Prevents inventing a second
  // group detector keyed only on remark shape.
  const solo = resolveApiRoomOccupantIdentity(coord, "יוסי כהן 0521234567", 1);
  assertEquals(solo.is_remark_group_occupant, false);
  assertEquals(solo.guest_name, coord.fullName);
  assertEquals(solo.phone, coord.tel1);
});

Deno.test("empty remark -> coordinator identity (no signal to swap on)", () => {
  const result = resolveApiRoomOccupantIdentity(coord, "", 2);
  assertEquals(result.is_remark_group_occupant, false);
  assertEquals(result.phone, coord.tel1);
});

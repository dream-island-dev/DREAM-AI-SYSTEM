import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  BOARD_TO_MEAL_PLAN,
  TRUSTED_ROOM_MAP_MATCHED_VIA,
  buildTrustedRoomMap,
  classifyOrderResolution,
  ddmmyyyyToIso,
  extractOrderClient,
  extractOrderRoomsCount,
  extractReservation,
  pickFillEmpty,
  resolveApiRoomOccupantIdentity,
  selectPrioritizedBatch,
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
        Client: { FullName: "רוני אברהמי", Tel1: "0547762015", Email: "roni@example.com", ClientId: 157124 },
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
  assertEquals(result?.clientId, 157124);
});

Deno.test("extractOrderClient: ClientId=0 (EZGO's 'unset' sentinel, same pattern as RoomId=0) -> null, never a fake link", () => {
  const row = {
    id: "row-1b",
    created_at: "2026-08-13T10:00:00Z",
    raw_payload: {
      Entity: "Orders",
      OrderId: 280736,
      Value: JSON.stringify({
        Order: { OrderId: 280736, Status: 1, Board: 0 },
        Client: { FullName: "בדיקה", Tel1: "0500000000", ClientId: 0 },
      }),
    },
  };
  assertEquals(extractOrderClient(row)?.clientId, null);
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

// ── extractOrderRoomsCount ──────────────────────────────────────────────────

Deno.test("extractOrderRoomsCount: Entity=Orders shape, empty Rooms -> 0 (day-pass/spa-only)", () => {
  const rawPayload = {
    Entity: "Orders",
    OrderId: 285007,
    Value: JSON.stringify({ Order: { OrderId: 285007, Rooms: [] }, Client: {} }),
  };
  assertEquals(extractOrderRoomsCount(rawPayload), 0);
});

Deno.test("extractOrderRoomsCount: plain Type=Update shape, empty Rooms -> 0", () => {
  const rawPayload = { Type: "Update", OrderId: 284340, Order: { OrderId: 284340, Rooms: [] }, Client: {} };
  assertEquals(extractOrderRoomsCount(rawPayload), 0);
});

Deno.test("extractOrderRoomsCount: non-empty Rooms -> count, not room-less", () => {
  const rawPayload = { Type: "Update", OrderId: 1, Order: { Rooms: [{ RoomId: 3 }, { RoomId: 7 }] }, Client: {} };
  assertEquals(extractOrderRoomsCount(rawPayload), 2);
});

Deno.test("extractOrderRoomsCount: unreadable shape -> null, never guessed as room-less", () => {
  assertEquals(extractOrderRoomsCount({ Entity: "Activities" }), null);
  assertEquals(extractOrderRoomsCount({ Type: "Delete", Order: { Rooms: [] } }), null);
  assertEquals(extractOrderRoomsCount({ Type: "Update", Order: { Rooms: "not-an-array" } }), null);
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

// ── buildTrustedRoomMap — trust gate (Mike, sync-management follow-up
// part 1): an auto_bootstrap/manual RoomId mapping is an unconfirmed guess
// until staff clicks "אשר נכון" in EzgoApiCodeMappingPanel.js. Using one to
// resolve a room-line would let a wrong inference silently create/enrich a
// guest with the wrong suite. ─────────────────────────────────────────────

Deno.test("buildTrustedRoomMap: csv_verified and staff_verified rows are kept", () => {
  const map = buildTrustedRoomMap([
    { ezgo_room_id: 3, suite_name: "אמטיסט 8", matched_via: "csv_verified" },
    { ezgo_room_id: 7, suite_name: "וילה 3", matched_via: "staff_verified" },
  ]);
  assertEquals(map.get(3), "אמטיסט 8");
  assertEquals(map.get(7), "וילה 3");
  assertEquals(map.size, 2);
});

Deno.test("buildTrustedRoomMap: auto_bootstrap and manual rows are dropped -- unresolved room_not_mapped, not a guess", () => {
  const map = buildTrustedRoomMap([
    { ezgo_room_id: 11, suite_name: "יהלום 2", matched_via: "auto_bootstrap" },
    { ezgo_room_id: 12, suite_name: "ספיר 1", matched_via: "manual" },
  ]);
  assertEquals(map.has(11), false);
  assertEquals(map.has(12), false);
  assertEquals(map.size, 0);
});

Deno.test("buildTrustedRoomMap: mixed trust tiers -- only the trusted ones resolve", () => {
  const map = buildTrustedRoomMap([
    { ezgo_room_id: 1, suite_name: "טופז 1", matched_via: "csv_verified" },
    { ezgo_room_id: 2, suite_name: "טופז 2", matched_via: "auto_bootstrap" },
    { ezgo_room_id: 3, suite_name: "טופז 3", matched_via: "staff_verified" },
    { ezgo_room_id: 4, suite_name: "טופז 4", matched_via: "manual" },
  ]);
  assertEquals([...map.keys()].sort(), [1, 3]);
});

Deno.test("buildTrustedRoomMap: empty input -> empty map, not an error", () => {
  assertEquals(buildTrustedRoomMap([]).size, 0);
});

Deno.test("TRUSTED_ROOM_MAP_MATCHED_VIA: exactly mirrors EzgoApiCodeMappingPanel.js's isTrustedMatch tiers", () => {
  assertEquals([...TRUSTED_ROOM_MAP_MATCHED_VIA].sort(), ["csv_verified", "staff_verified"]);
});

// ── classifyOrderResolution — terminal park (Mike, sync-management
// follow-up part 2): a bad phone / unmapped room / duplicate guest / bad
// dates must stop cycling staged->processing->staged forever with zero
// trace, same bug class the grace-period fix closed for room-less orders.
// no_checkin_date and a genuine "error" must NOT be parked -- both can
// still resolve themselves on a later run. ─────────────────────────────────

Deno.test("classifyOrderResolution: all created/enriched -> parsed", () => {
  assertEquals(
    classifyOrderResolution([{ kind: "created" }, { kind: "enriched" }]),
    { action: "parsed" },
  );
});

Deno.test("classifyOrderResolution: single-line no_usable_phone -> park, notes names the reason", () => {
  assertEquals(
    classifyOrderResolution([{ kind: "unresolved", reason: "no_usable_phone" }]),
    { action: "park", notes: "unresolved_no_usable_phone" },
  );
});

Deno.test("classifyOrderResolution: room_not_mapped -> park (also covers a trust-gated-out mapping, same reason string)", () => {
  assertEquals(
    classifyOrderResolution([{ kind: "unresolved", reason: "room_not_mapped" }]),
    { action: "park", notes: "unresolved_room_not_mapped" },
  );
});

Deno.test("classifyOrderResolution: duplicate_guest_same_phone_date -> park", () => {
  assertEquals(
    classifyOrderResolution([{ kind: "unresolved", reason: "duplicate_guest_same_phone_date" }]),
    { action: "park", notes: "unresolved_duplicate_guest_same_phone_date" },
  );
});

Deno.test("classifyOrderResolution: invalid_dates -> park", () => {
  assertEquals(
    classifyOrderResolution([{ kind: "unresolved", reason: "invalid_dates" }]),
    { action: "park", notes: "unresolved_invalid_dates" },
  );
});

Deno.test("classifyOrderResolution: no_checkin_date -> retry, NOT parked (a real race, may resolve next run)", () => {
  assertEquals(
    classifyOrderResolution([{ kind: "unresolved", reason: "no_checkin_date" }]),
    { action: "retry" },
  );
});

Deno.test("classifyOrderResolution: a genuine error -> retry, NOT parked (could be transient)", () => {
  assertEquals(
    classifyOrderResolution([{ kind: "error" }]),
    { action: "retry" },
  );
});

Deno.test("classifyOrderResolution: an unrecognized/empty reason -> retry, never guessed as parkable", () => {
  assertEquals(classifyOrderResolution([{ kind: "unresolved", reason: "something_new" }]), { action: "retry" });
  assertEquals(classifyOrderResolution([{ kind: "unresolved" }]), { action: "retry" });
});

Deno.test("classifyOrderResolution: two lines, both parkable but DIFFERENT reasons -> park, notes lists both sorted", () => {
  assertEquals(
    classifyOrderResolution([
      { kind: "unresolved", reason: "room_not_mapped" },
      { kind: "unresolved", reason: "no_usable_phone" },
    ]),
    { action: "park", notes: "unresolved_multiple:no_usable_phone,room_not_mapped" },
  );
});

Deno.test("classifyOrderResolution: one parkable line + one no_checkin_date line -> retry, NOT park (mixed order stays whole)", () => {
  assertEquals(
    classifyOrderResolution([
      { kind: "unresolved", reason: "room_not_mapped" },
      { kind: "unresolved", reason: "no_checkin_date" },
    ]),
    { action: "retry" },
  );
});

Deno.test("classifyOrderResolution: one created line + one parkable unresolved line -> park the whole order (the already-created guest write already happened and is unaffected -- only the ingest row's pointless per-minute re-processing stops)", () => {
  assertEquals(
    classifyOrderResolution([
      { kind: "created" },
      { kind: "unresolved", reason: "room_not_mapped" },
    ]),
    { action: "park", notes: "unresolved_room_not_mapped" },
  );
});

// ── selectPrioritizedBatch — batch claim prioritization (Mike, 2026-08-17,
// live incident): a real suite Reservations row must not wait behind a
// large room-less/day-pass backlog just because the backlog is older by
// created_at. Zero Data Loss: nothing is ever dropped, only reordered. ────

Deno.test("selectPrioritizedBatch: order with a Reservations row in the pool goes first, even if an unrelated day-pass row is older", () => {
  const rows = [
    { id: "old-daypass", created_at: "2026-08-17T08:00:00Z", raw_payload: { Entity: "Orders", OrderId: "1", Value: JSON.stringify({ Order: { Rooms: [] }, Client: {} }) } },
    { id: "newer-suite-order", created_at: "2026-08-17T08:05:00Z", raw_payload: { Entity: "Orders", OrderId: "2", Value: JSON.stringify({ Order: {}, Client: {} }) } },
    { id: "newer-suite-res", created_at: "2026-08-17T08:06:00Z", raw_payload: { Entity: "Reservations", OrderId: "2", Value: JSON.stringify({ Room: { RoomId: 3 } }) } },
  ];
  assertEquals(selectPrioritizedBatch(rows, 2), ["newer-suite-order", "newer-suite-res"]);
});

Deno.test("selectPrioritizedBatch: with room for everyone, still oldest-first within each tier (only reorders across tiers)", () => {
  const rows = [
    { id: "a", created_at: "1", raw_payload: { Entity: "Orders", OrderId: "1", Value: JSON.stringify({ Order: {}, Client: {} }) } },
    { id: "b", created_at: "2", raw_payload: { Entity: "Reservations", OrderId: "1", Value: JSON.stringify({ Room: { RoomId: 1 } }) } },
    { id: "c", created_at: "3", raw_payload: { Entity: "Orders", OrderId: "2", Value: JSON.stringify({ Order: { Rooms: [] }, Client: {} }) } },
  ];
  assertEquals(selectPrioritizedBatch(rows, 10), ["a", "b", "c"]);
});

Deno.test("selectPrioritizedBatch: nothing dropped -- batchLimit >= pool size still returns every id", () => {
  const rows = [
    { id: "a", created_at: "1", raw_payload: { Entity: "Orders", OrderId: "1" } },
    { id: "b", created_at: "2", raw_payload: { Entity: "Activities", OrderId: "1" } },
  ];
  assertEquals(new Set(selectPrioritizedBatch(rows, 10)), new Set(["a", "b"]));
});

Deno.test("selectPrioritizedBatch: a row with no readable OrderId falls into the non-priority tier, never throws", () => {
  const rows = [
    { id: "no-order-id", created_at: "1", raw_payload: {} },
    { id: "has-res", created_at: "2", raw_payload: { Entity: "Reservations", OrderId: "1" } },
  ];
  assertEquals(selectPrioritizedBatch(rows, 1), ["has-res"]);
});

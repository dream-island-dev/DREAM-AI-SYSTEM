import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  BOARD_TO_MEAL_PLAN,
  ddmmyyyyToIso,
  extractOrderClient,
  extractReservation,
  pickFillEmpty,
  resolveRemarkOccupant,
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

// ── resolveRemarkOccupant — the corrected group-vs-single logic's core ────

Deno.test("resolveRemarkOccupant: real phone in remark -> resolved occupant", () => {
  const result = resolveRemarkOccupant("יוסי כהן 0521234567");
  assertEquals(result?.phone, "+972521234567");
});

Deno.test("resolveRemarkOccupant: empty remark -> null (falls back to order-level logic upstream)", () => {
  assertEquals(resolveRemarkOccupant(""), null);
  assertEquals(resolveRemarkOccupant("   "), null);
});

Deno.test("resolveRemarkOccupant: remark text with no extractable phone -> null, never guesses", () => {
  // Plain operational note, no phone number anywhere — must not be
  // mistaken for an occupant identity.
  assertEquals(resolveRemarkOccupant("שעות מתחם 21:00 - 16:00"), null);
});

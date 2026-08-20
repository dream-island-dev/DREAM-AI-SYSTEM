import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { buildDoc2EnrichmentPatch, classifyDoc2MailWorkflow } from "./ezgoDoc2MailLineWorkflow.ts";
import {
  buildCombinedRoomLabel,
  doc2CreateAutomationScope,
  doc2MailResLineId,
  doc2NamesMatch,
  doc2PhonesMatch,
  guestRoomLabelsInclude,
  isSameDoc2Booking,
  splitCombinedRoomLabel,
} from "./ezgoDoc2SuiteRoomSync.ts";

const shacharGuest = {
  id: 1,
  name: "שחר יובל",
  phone: "+972535235010",
  order_number: "275896",
  arrival_date: "2026-07-21",
  departure_date: "2026-07-23",
  room: "אמטיסט 10",
  room_type: "suite",
  meal_location: null,
};

const shacharSecondRoom = {
  _report: "doc2" as const,
  section: "arrival" as const,
  order_number: "275896",
  room_raw: "סוויטת אמטיסט - 11",
  room: "אמטיסט 11",
  board_basis: null,
  meal_location: null,
  arrival_time: null,
  nights: null,
  guest_count: null,
  guest_name: "שחר יובל",
  phone: "+972535235010",
  amount: null,
  notes: null,
  arrival_date: "2026-07-21",
  departure_date: "2026-07-23",
  is_day_guest: false,
  is_premium_day: false,
};

Deno.test("same booking second room → suite_room_add not conflict", () => {
  const r = classifyDoc2MailWorkflow(shacharSecondRoom, shacharGuest);
  if (r.workflow !== "suite_room_add") {
    throw new Error(`expected suite_room_add got ${r.workflow}`);
  }
  if (r.action !== "enrich") throw new Error("expected enrich action");
});

Deno.test("combined room label already includes incoming room → noop", () => {
  const guest = {
    ...shacharGuest,
    room: "אמטיסט 10 · אמטיסט 11",
  };
  const r = classifyDoc2MailWorkflow(shacharSecondRoom, guest);
  if (r.workflow !== "noop") throw new Error(`expected noop got ${r.workflow}`);
});

Deno.test("isSameDoc2Booking matches order number", () => {
  if (!isSameDoc2Booking(shacharSecondRoom, shacharGuest)) {
    throw new Error("expected same booking by order");
  }
});

Deno.test("isSameDoc2Booking: same order_number but different phones → false — P0 2026-08-05 regression (never merge group occupants via order alone)", () => {
  const rec = { ...shacharSecondRoom, phone: "+972501112233" };
  const guest = { ...shacharGuest, phone: "+972529998877" };
  if (isSameDoc2Booking(rec, guest)) {
    throw new Error("expected false — order match must not override a phone mismatch");
  }
});

Deno.test("isSameDoc2Booking: same order_number, one side missing phone → still matches (unchanged)", () => {
  const rec = { ...shacharSecondRoom, phone: null };
  if (!isSameDoc2Booking(rec, shacharGuest)) {
    throw new Error("expected true when one side has no phone to compare");
  }
});

Deno.test("guestRoomLabelsInclude handles combined label", () => {
  if (!guestRoomLabelsInclude("אמטיסט 10 · אמטיסט 11", "אמטיסט 11")) {
    throw new Error("expected room 11 in combined label");
  }
  if (guestRoomLabelsInclude("אמטיסט 10", "אמטיסט 11")) {
    throw new Error("room 11 should not match single room 10");
  }
});

Deno.test("doc2MailResLineId is stable per order+room", () => {
  const a = doc2MailResLineId("275896", "אמטיסט 10");
  const b = doc2MailResLineId("275896", "אמטיסט 11");
  if (a === b) throw new Error("res_line_id must differ per room");
  if (!a.startsWith("doc2mail-275896-")) throw new Error(`unexpected id ${a}`);
});

Deno.test("buildCombinedRoomLabel dedupes rooms", () => {
  const combined = buildCombinedRoomLabel(["אמטיסט 10", "אמטיסט 11", "אמטיסט 10"]);
  if (combined !== "אמטיסט 10 · אמטיסט 11") {
    throw new Error(`unexpected combined ${combined}`);
  }
  const parts = splitCombinedRoomLabel(combined);
  if (parts.length !== 2) throw new Error("expected 2 room parts");
});

Deno.test("different booking same phone → conflict", () => {
  const otherGuest = {
    ...shacharGuest,
    order_number: "999999",
    name: "אורח אחר",
  };
  const rec = {
    ...shacharSecondRoom,
    order_number: "888888",
    guest_name: "אורח אחר",
    room: "אמטיסט 8",
  };
  const r = classifyDoc2MailWorkflow(rec, otherGuest);
  if (r.workflow !== "conflict") {
    throw new Error(`expected conflict got ${r.workflow}`);
  }
});

const noRoomOrderOnly = {
  _report: "doc2" as const,
  section: "arrival" as const,
  order_number: "278993",
  room_raw: "סוויטת אמטיסט -",
  room: null,
  board_basis: "BB",
  meal_location: "רק ארוחת בוקר",
  arrival_time: null,
  nights: 1,
  guest_count: "2",
  guest_name: "לימור ניסני",
  phone: "+972542203442",
  amount: "1,805₪",
  notes: null,
  arrival_date: "2026-07-25",
  departure_date: "2026-07-26",
  is_day_guest: false,
  is_premium_day: false,
};

Deno.test("no room but phone+order number, no existing guest → suite_arrival_create", () => {
  const r = classifyDoc2MailWorkflow(noRoomOrderOnly, null);
  if (r.workflow !== "suite_arrival_create") {
    throw new Error(`expected suite_arrival_create got ${r.workflow}`);
  }
  if (r.action !== "create") throw new Error("expected create action");
});

Deno.test("no room but phone+name (no order number), no existing guest → suite_arrival_create", () => {
  const rec = { ...noRoomOrderOnly, order_number: null };
  const r = classifyDoc2MailWorkflow(rec, null);
  if (r.workflow !== "suite_arrival_create") {
    throw new Error(`expected suite_arrival_create got ${r.workflow}`);
  }
});

Deno.test("no room, no name, no order number, no existing guest → no_match (missing details)", () => {
  const rec = { ...noRoomOrderOnly, order_number: null, guest_name: null };
  const r = classifyDoc2MailWorkflow(rec, null);
  if (r.workflow !== "no_match") {
    throw new Error(`expected no_match got ${r.workflow}`);
  }
});

Deno.test("guest exists, no room in report row → suite_arrival_enrich (room untouched)", () => {
  const guest = { ...shacharGuest, order_number: null };
  const rec = {
    ...noRoomOrderOnly,
    phone: shacharGuest.phone,
    guest_name: shacharGuest.name,
    arrival_date: shacharGuest.arrival_date,
    departure_date: shacharGuest.departure_date,
    order_number: null,
  };
  const r = classifyDoc2MailWorkflow(rec, guest);
  if (r.workflow !== "suite_arrival_enrich") {
    throw new Error(`expected suite_arrival_enrich got ${r.workflow}`);
  }
  if ("room" in r.patch) throw new Error("room must not be touched when rec.room is null");
});

Deno.test("guest exists, no room in report, nothing new to enrich → noop", () => {
  const guestAlreadyComplete = {
    id: 5,
    name: "לימור ניסני",
    phone: "+972542203442",
    order_number: "278993",
    arrival_date: "2026-07-25",
    departure_date: "2026-07-26",
    room: "אמטיסט 8",
    room_type: "suite",
    meal_location: "רק ארוחת בוקר",
  };
  const r = classifyDoc2MailWorkflow(noRoomOrderOnly, guestAlreadyComplete);
  if (r.workflow !== "noop") {
    throw new Error(`expected noop got ${r.workflow}`);
  }
});

Deno.test("fixture row 278993 (אמטיסט בלי מספר) → suite_arrival_create", () => {
  const r = classifyDoc2MailWorkflow(noRoomOrderOnly, null);
  if (r.workflow !== "suite_arrival_create") {
    throw new Error(`expected suite_arrival_create got ${r.workflow}`);
  }
});

Deno.test("classifyDoc2MailWorkflow: daypass guard blocks stale is_day_guest when room already resolved to a canonical suite — P0 2026-08-05 regression", () => {
  const rec = {
    ...noRoomOrderOnly,
    order_number: null,
    room: "אמטיסט 11",
    is_day_guest: true, // stale flag, as if from an older parsed_json row
  };
  const r = classifyDoc2MailWorkflow(rec, null);
  if (r.workflow !== "suite_arrival_create") {
    throw new Error(`expected suite_arrival_create (suite wins), got ${r.workflow}`);
  }
});

Deno.test("classifyDoc2MailWorkflow: genuine day-pass still routes to daypass_create", () => {
  const rec = { ...noRoomOrderOnly, order_number: null, room: "בילוי יומי", is_day_guest: true };
  const r = classifyDoc2MailWorkflow(rec, null);
  if (r.workflow !== "daypass_create") {
    throw new Error(`expected daypass_create, got ${r.workflow}`);
  }
});

Deno.test("buildDoc2EnrichmentPatch: escalates existing guest to muted when rec resolves to a group occupant", () => {
  const guest = { ...shacharGuest, automation_scope: "full" };
  const rec = {
    ...shacharSecondRoom,
    room: shacharGuest.room,
    guest_name: "משה לוי",
    coord_name: "שחר יובל",
    is_remark_group_occupant: true,
    automation_scope: "muted" as const,
  };
  const patch = buildDoc2EnrichmentPatch(rec, guest);
  assertEquals(patch.automation_scope, "muted");
  assertEquals(patch.automation_muted, true);
});

Deno.test("buildDoc2EnrichmentPatch: never un-mutes an already-muted guest", () => {
  const guest = { ...shacharGuest, automation_scope: "muted" };
  const rec = { ...shacharSecondRoom, room: shacharGuest.room, automation_scope: "full" as const };
  const patch = buildDoc2EnrichmentPatch(rec, guest);
  assertEquals("automation_scope" in patch, false);
});

Deno.test("buildDoc2EnrichmentPatch: suite guest with 0-night bug (arrival===departure) is corrected by fresh nights-derived departure — P0-C 2026-08-05", () => {
  const guest = { ...shacharGuest, departure_date: shacharGuest.arrival_date };
  const rec = { ...shacharSecondRoom, room: shacharGuest.room, departure_date: "2026-07-23" };
  const patch = buildDoc2EnrichmentPatch(rec, guest);
  assertEquals(patch.departure_date, "2026-07-23");
});

Deno.test("buildDoc2EnrichmentPatch: suite guest with missing departure_date is corrected — P0-C 2026-08-05", () => {
  const guest = { ...shacharGuest, departure_date: null };
  const rec = { ...shacharSecondRoom, room: shacharGuest.room, departure_date: "2026-07-23" };
  const patch = buildDoc2EnrichmentPatch(rec, guest);
  assertEquals(patch.departure_date, "2026-07-23");
});

Deno.test("buildDoc2EnrichmentPatch: same booking overwrites suite departure from EZGO nights snapshot", () => {
  const guest = { ...shacharGuest, arrival_date: "2026-07-21", departure_date: "2026-07-23" };
  const rec = { ...shacharSecondRoom, room: shacharGuest.room, departure_date: "2026-07-25" };
  const patch = buildDoc2EnrichmentPatch(rec, guest);
  assertEquals(patch.departure_date, "2026-07-25");
});

Deno.test("buildDoc2EnrichmentPatch: different booking does NOT overwrite valid suite dates", () => {
  const guest = { ...shacharGuest, arrival_date: "2026-07-21", departure_date: "2026-07-23" };
  const rec = {
    ...shacharSecondRoom,
    order_number: "999999",
    phone: "+972501110000",
    room: shacharGuest.room,
    departure_date: "2026-07-25",
  };
  const patch = buildDoc2EnrichmentPatch(rec, guest);
  assertEquals("departure_date" in patch, false);
});

Deno.test("buildDoc2EnrichmentPatch: incoming departure_date not after arrival is refused even when suspect — P0-C 2026-08-05", () => {
  const guest = { ...shacharGuest, arrival_date: "2026-07-21", departure_date: "2026-07-21" };
  const rec = { ...shacharSecondRoom, room: shacharGuest.room, departure_date: "2026-07-21" };
  const patch = buildDoc2EnrichmentPatch(rec, guest);
  assertEquals("departure_date" in patch, false);
});

Deno.test("buildDoc2EnrichmentPatch: day-pass guest (arrival===departure by design) is never treated as suspect — P0-C 2026-08-05", () => {
  const guest = {
    ...shacharGuest,
    room: "בילוי יומי",
    room_type: "day_guest",
    arrival_date: "2026-07-21",
    departure_date: "2026-07-21",
  };
  const rec = { ...shacharSecondRoom, room: "בילוי יומי", is_day_guest: true, departure_date: "2026-07-25" };
  const patch = buildDoc2EnrichmentPatch(rec, guest);
  assertEquals("departure_date" in patch, false);
});

Deno.test("buildDoc2EnrichmentPatch: name/meal stay fill-empty-only even when dates are suspect — P0-C 2026-08-05", () => {
  const guest = { ...shacharGuest, departure_date: shacharGuest.arrival_date, name: "רחל אופיר", meal_location: "חצי פנסיון" };
  const rec = {
    ...shacharSecondRoom,
    room: shacharGuest.room,
    departure_date: "2026-07-23",
    guest_name: "שם אחר",
    meal_location: "פנסיון מלא",
  };
  const patch = buildDoc2EnrichmentPatch(rec, guest);
  assertEquals("name" in patch, false);
  assertEquals("meal_location" in patch, false);
});

Deno.test("returning guest with new arrival → suite_arrival_create not enrich", () => {
  const archivedGuest = {
    id: 99,
    name: "ליאור חבולי",
    phone: "+972501112233",
    order_number: "111111",
    arrival_date: "2026-07-06",
    departure_date: "2026-07-07",
    room: "אמטיסט 8",
    room_type: "suite",
    meal_location: null,
  };
  const rec = {
    _report: "doc2" as const,
    section: "arrival" as const,
    order_number: "222222",
    room_raw: "סוויטת אמטיסט - 10",
    room: "אמטיסט 10",
    board_basis: null,
    meal_location: null,
    arrival_time: null,
    nights: 1,
    guest_count: "2",
    guest_name: "ליאור חבולי",
    phone: "+972501112233",
    amount: null,
    notes: null,
    arrival_date: "2026-08-08",
    departure_date: "2026-08-09",
    is_day_guest: false,
    is_premium_day: false,
  };
  const r = classifyDoc2MailWorkflow(rec, archivedGuest);
  if (r.workflow !== "suite_arrival_create") {
    throw new Error(`expected suite_arrival_create got ${r.workflow}`);
  }
  if (r.action !== "create") throw new Error("expected create action");
});

Deno.test("group occupant second room → suite_arrival_create not suite_room_add — P0 2026-08-05", () => {
  const coordinatorProfile = {
    id: 99,
    name: "ישראל ישראלי",
    phone: "+972500000000",
    order_number: "301222",
    arrival_date: "2026-08-07",
    departure_date: "2026-08-08",
    room: "אוניקס 12",
    room_type: "suite",
    meal_location: null,
  };
  const secondOccupant = {
    _report: "doc2" as const,
    section: "arrival" as const,
    order_number: "301222",
    room_raw: "סוויטת אוניקס - 7",
    room: "אוניקס 7",
    board_basis: null,
    meal_location: null,
    arrival_time: null,
    nights: 1,
    guest_count: "2",
    guest_name: "משה לוי",
    phone: "+972522222222",
    amount: null,
    notes: "משה לוי 052-2222222",
    arrival_date: "2026-08-07",
    departure_date: "2026-08-08",
    is_day_guest: false,
    is_premium_day: false,
    is_remark_group_occupant: true,
    coord_name: "ישראל ישראלי",
    coord_phone: "+972500000000",
  };
  const r = classifyDoc2MailWorkflow(secondOccupant, coordinatorProfile);
  if (r.workflow !== "suite_arrival_create") {
    throw new Error(`expected suite_arrival_create got ${r.workflow}`);
  }
});

Deno.test("isSameDoc2Booking: group rows with different occupant names → false", () => {
  const rec = {
    guest_name: "משה לוי",
    phone: "+972522222222",
    order_number: "301222",
    is_remark_group_occupant: true,
    arrival_date: "2026-08-07",
  };
  const guest = {
    name: "ישראל ישראלי",
    phone: "+972500000000",
    order_number: "301222",
    arrival_date: "2026-08-07",
  };
  if (isSameDoc2Booking(rec as never, guest as never)) {
    throw new Error("expected false for different group occupants");
  }
});

Deno.test("same-person Doc2 row (name spacing + group flag) → suite_room_add not duplicate create", () => {
  const existing = {
    id: 5305,
    name: "ש. פרויקטים",
    phone: "+972546969445",
    order_number: "271439",
    arrival_date: "2026-08-18",
    departure_date: "2026-08-19",
    room: "ג'ספר 3",
    room_type: "suite",
    meal_location: null,
  };
  const rec = {
    _report: "doc2" as const,
    section: "arrival" as const,
    order_number: "271439",
    room_raw: "סוויטת ג'ספר - 6",
    room: "ג'ספר 6",
    board_basis: null,
    meal_location: null,
    arrival_time: null,
    nights: 1,
    guest_count: "2",
    guest_name: "ש.פרויקטים",
    phone: "972546969445",
    amount: null,
    notes: null,
    arrival_date: "2026-08-18",
    departure_date: "2026-08-19",
    is_day_guest: false,
    is_premium_day: false,
    is_remark_group_occupant: true,
    coord_name: "ש.פרויקטים",
    coord_phone: "+972546969445",
    automation_scope: "courtesy_only" as const,
  };
  const r = classifyDoc2MailWorkflow(rec, existing);
  assertEquals(r.workflow, "suite_room_add");
  assertEquals(isSameDoc2Booking(rec as never, existing as never), true);
});

Deno.test("doc2CreateAutomationScope: same-name coordinator is full not muted", () => {
  if (!doc2NamesMatch("ש.פרויקטים", "ש. פרויקטים")) {
    throw new Error("expected name spacing to match");
  }
  if (!doc2PhonesMatch("+972546969445", "972546969445")) {
    throw new Error("expected phone variants to match");
  }
  const scope = doc2CreateAutomationScope({
    guest_name: "ש.פרויקטים",
    coord_name: "ש.פרויקטים",
    is_remark_group_occupant: true,
    automation_scope: "courtesy_only",
  } as never);
  assertEquals(scope, "full");
});

Deno.test("buildDoc2EnrichmentPatch: split-brain suite room + day_guest type gets suite type + nights departure", () => {
  const guest = {
    ...shacharGuest,
    room: "אקווה מרין 26",
    room_type: "day_guest",
    arrival_date: "2026-08-20",
    departure_date: "2026-08-20",
  };
  const rec = {
    ...shacharSecondRoom,
    room: "אקווה מרין 26",
    arrival_date: "2026-08-20",
    departure_date: "2026-08-21",
    nights: 1,
    is_day_guest: false,
  };
  const patch = buildDoc2EnrichmentPatch(rec, guest);
  assertEquals(patch.departure_date, "2026-08-21");
  assertEquals(patch.room_type, "suite");
});

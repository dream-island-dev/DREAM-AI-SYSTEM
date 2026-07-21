import { classifyDoc2MailWorkflow } from "./ezgoDoc2MailLineWorkflow.ts";
import {
  buildCombinedRoomLabel,
  doc2MailResLineId,
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
  _report: "doc2",
  section: "arrival",
  order_number: "275896",
  guest_name: "שחר יובל",
  phone: "+972535235010",
  arrival_date: "2026-07-21",
  departure_date: "2026-07-23",
  room: "אמטיסט 11",
  room_raw: "סוויטת אמטיסט - 11",
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

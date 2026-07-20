import {
  classifyEzgoMailWorkflow,
  guestHasSpaOnDate,
} from "./ezgoMailLineWorkflow.ts";

Deno.test("suite guest with spa → suite_spa_sync", () => {
  const rec = {
    order_number: "276034",
    guest_name: "צחי",
    phone: "+972501234567",
    arrival_date: "2026-07-20",
    spa_time: "10:30",
    treatment_count: 1,
    meal_time: null,
    meal_location: null,
  };
  const guest = {
    id: 1,
    name: "צחי",
    phone: "+972501234567",
    order_number: "276034",
    arrival_date: "2026-07-20",
    departure_date: "2026-07-22",
    room: "אמרלד 17",
    room_type: "suite",
    spa_time: null,
    spa_date: null,
    meal_location: null,
    meal_time: null,
    treatment_count: 0,
    msg_spa_upsell_sent: false,
  };
  const r = classifyEzgoMailWorkflow(rec, guest, "2026-07-20");
  if (r.workflow !== "suite_spa_sync") throw new Error(`expected suite_spa_sync got ${r.workflow}`);
});

Deno.test("daypass without spa → daypass_upsell", () => {
  const rec = {
    order_number: "111",
    guest_name: "דני",
    phone: "+972501111111",
    arrival_date: "2026-07-20",
    spa_time: null,
    treatment_count: 0,
    meal_time: null,
    meal_location: null,
  };
  const guest = {
    id: 2,
    name: "דני",
    phone: "+972501111111",
    order_number: "111",
    arrival_date: "2026-07-20",
    departure_date: "2026-07-20",
    room: "בילוי יומי",
    room_type: "day_guest",
    spa_time: null,
    spa_date: null,
    meal_location: null,
    meal_time: null,
    treatment_count: 0,
    msg_spa_upsell_sent: false,
  };
  const r = classifyEzgoMailWorkflow(rec, guest, "2026-07-20");
  if (r.workflow !== "daypass_upsell") throw new Error(`expected daypass_upsell got ${r.workflow}`);
});

Deno.test("no guest with spa → daypass_create_spa", () => {
  const rec = {
    order_number: "222",
    guest_name: "מיה",
    phone: "+972502222222",
    arrival_date: "2026-07-20",
    spa_time: "14:00",
    treatment_count: 1,
    meal_time: null,
    meal_location: null,
  };
  const r = classifyEzgoMailWorkflow(rec, null, "2026-07-20");
  if (r.workflow !== "daypass_create_spa" || r.action !== "create") {
    throw new Error(`expected daypass_create_spa/create got ${r.workflow}/${r.action}`);
  }
});

Deno.test("guestHasSpaOnDate respects spa_date", () => {
  const ok = guestHasSpaOnDate(
    { id: 1, name: null, phone: null, order_number: null, arrival_date: null, departure_date: null, room: null, spa_time: null, spa_date: "2026-07-20", meal_location: null, meal_time: null, treatment_count: null },
    "2026-07-20",
  );
  if (!ok) throw new Error("expected spa_date match");
});

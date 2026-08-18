import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  classifySpaActivityApply,
  clockFromEzgoDateTime,
  extractSpaActivity,
  matchSpaAppointment,
  pickGuestIdForActivity,
  shouldStampTherapistWorkerId,
  type ParsedSpaActivity,
  type SpaApptCandidate,
} from "./ezgoSpaActivitySync.ts";

const liveActivitiesPayload = {
  Entity: "Activities",
  ItemId: 11448,
  OrderId: 280735,
  Value: JSON.stringify({
    Timing: {
      Index: 0,
      Status: 1,
      Start: "18/08/2026 10:00",
      End: "18/08/2026 10:45",
      Guest: "רוני אברהמי",
      Worker: { WorkerId: 276 },
      Activity: "חדר 5",
    },
  }),
};

function act(over: Partial<ParsedSpaActivity> = {}): ParsedSpaActivity {
  return {
    ingestId: "ing-1",
    orderId: "280735",
    activityKey: "280735:11448:0",
    itemId: "11448",
    index: 0,
    status: 1,
    cancelled: false,
    appointmentDate: "2026-08-18",
    startTime: "10:00",
    endTime: "10:45",
    workerId: 276,
    guestName: "רוני אברהמי",
    roomRaw: "חדר 5",
    ...over,
  };
}

function row(over: Partial<SpaApptCandidate> = {}): SpaApptCandidate {
  return {
    id: 1,
    ezgo_activity_key: null,
    ezgo_order_id: "280735",
    appointment_date: "2026-08-18",
    start_time: "10:00:00",
    status: "scheduled",
    therapist_id: 9,
    guest_id: 100,
    ...over,
  };
}

Deno.test("clockFromEzgoDateTime: date+time", () => {
  assertEquals(clockFromEzgoDateTime("18/08/2026 10:00"), { date: "2026-08-18", time: "10:00" });
  assertEquals(clockFromEzgoDateTime("18/08/2026 9:05"), { date: "2026-08-18", time: "09:05" });
});

Deno.test("clockFromEzgoDateTime: date only → time null (never invent 00:00)", () => {
  assertEquals(clockFromEzgoDateTime("18/08/2026"), { date: "2026-08-18", time: null });
});

Deno.test("extractSpaActivity: live Entity=Activities shape", () => {
  const parsed = extractSpaActivity({ id: "r1", raw_payload: liveActivitiesPayload });
  assertEquals(parsed?.activityKey, "280735:11448:0");
  assertEquals(parsed?.orderId, "280735");
  assertEquals(parsed?.appointmentDate, "2026-08-18");
  assertEquals(parsed?.startTime, "10:00");
  assertEquals(parsed?.endTime, "10:45");
  assertEquals(parsed?.workerId, 276);
  assertEquals(parsed?.guestName, "רוני אברהמי");
  assertEquals(parsed?.roomRaw, "חדר 5");
  assertEquals(parsed?.cancelled, false);
});

Deno.test("extractSpaActivity: Status=0 is cancelled", () => {
  const payload = {
    ...liveActivitiesPayload,
    Value: JSON.stringify({
      Timing: { Index: 0, Status: 0, Start: "18/08/2026 10:00", End: "18/08/2026 10:45", Worker: { WorkerId: 276 } },
    }),
  };
  assertEquals(extractSpaActivity({ id: "r1", raw_payload: payload })?.cancelled, true);
});

Deno.test("extractSpaActivity: non-Activities entity → null", () => {
  assertEquals(extractSpaActivity({ id: "x", raw_payload: { Entity: "Orders" } }), null);
});

Deno.test("matchSpaAppointment: activity key wins even if times already changed", () => {
  const hit = matchSpaAppointment(act({ startTime: "14:00", endTime: "14:45" }), [
    row({ ezgo_activity_key: "280735:11448:0", start_time: "10:00:00" }),
  ]);
  assertEquals(hit.kind, "activity_key");
  assertEquals(hit.appointment?.id, 1);
});

Deno.test("matchSpaAppointment: same order+date+start time when key not stamped yet", () => {
  const hit = matchSpaAppointment(act(), [row()]);
  assertEquals(hit.kind, "order_date_time");
});

Deno.test("matchSpaAppointment: unique open row that day after a time change (CSV seed, first API tick)", () => {
  const hit = matchSpaAppointment(act({ startTime: "14:00", endTime: "14:45" }), [
    row({ start_time: "10:00:00" }),
  ]);
  assertEquals(hit.kind, "order_date_unique");
});

Deno.test("matchSpaAppointment: two treatments same day + time already moved → none (never guess)", () => {
  const hit = matchSpaAppointment(act({ startTime: "14:00", endTime: "14:45" }), [
    row({ id: 1, start_time: "10:00:00" }),
    row({ id: 2, start_time: "12:00:00" }),
  ]);
  assertEquals(hit.kind, "none");
  assertEquals(hit.appointment, null);
});

Deno.test("pickGuestIdForActivity: sole guest; name disambiguation; ambiguous → null", () => {
  assertEquals(pickGuestIdForActivity([{ id: 1, name: "א" }], "ב"), 1);
  assertEquals(pickGuestIdForActivity(
    [{ id: 1, name: "רוני אברהמי" }, { id: 2, name: "דנה כהן" }],
    "רוני",
  ), 1);
  assertEquals(pickGuestIdForActivity(
    [{ id: 1, name: "רוני" }, { id: 2, name: "דנה" }],
    null,
  ), null);
});

Deno.test("classifySpaActivityApply: time change on matched row", () => {
  assertEquals(classifySpaActivityApply({
    activity: act({ startTime: "14:00", endTime: "14:45" }),
    guestId: 100,
    matched: row(),
    roomId: 5,
  }).action, "update");
});

Deno.test("classifySpaActivityApply: no guest yet → retry (same cron may create them next)", () => {
  assertEquals(classifySpaActivityApply({
    activity: act(),
    guestId: null,
    matched: null,
    roomId: 5,
  }).notes, "spa_waiting_guest");
});

Deno.test("classifySpaActivityApply: new treatment without spa room → unresolved, not a silent create", () => {
  assertEquals(classifySpaActivityApply({
    activity: act(),
    guestId: 100,
    matched: null,
    roomId: null,
  }).notes, "spa_no_room");
});

Deno.test("classifySpaActivityApply: cancel with no board row is skip not create", () => {
  assertEquals(classifySpaActivityApply({
    activity: act({ cancelled: true, status: 0 }),
    guestId: 100,
    matched: null,
    roomId: 5,
  }).action, "skip");
});

Deno.test("shouldStampTherapistWorkerId: fill-empty only", () => {
  assertEquals(shouldStampTherapistWorkerId(null, 276), true);
  assertEquals(shouldStampTherapistWorkerId(276, 276), false);
  assertEquals(shouldStampTherapistWorkerId(276, 99), false);
  assertEquals(shouldStampTherapistWorkerId(null, null), false);
});

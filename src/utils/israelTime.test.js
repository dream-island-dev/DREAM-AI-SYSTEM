import {
  israelHmFromIso,
  israelYmdFromIso,
  isFutureScheduledQueueItem,
  resolveQueueScheduleDateYmd,
  buildStaffSchedulePayload,
} from "./israelTime";

describe("israelTime queue schedule helpers", () => {
  test("israelYmdFromIso uses Asia/Jerusalem", () => {
    // 2026-07-07 22:00 UTC = 2026-07-08 01:00 Israel (summer +3)
    expect(israelYmdFromIso("2026-07-07T22:00:00.000Z")).toBe("2026-07-08");
  });

  test("israelHmFromIso returns HH:MM", () => {
    const hm = israelHmFromIso("2026-07-08T07:30:00.000Z");
    expect(hm).toMatch(/^\d{2}:\d{2}$/);
  });

  test("resolveQueueScheduleDateYmd prefers projected instant", () => {
    const item = { scheduledFor: "2026-07-10T10:00:00.000Z", arrivalDate: "2026-07-05" };
    expect(resolveQueueScheduleDateYmd(item)).toBe(israelYmdFromIso(item.scheduledFor));
  });

  test("resolveQueueScheduleDateYmd falls back to arrival", () => {
    expect(resolveQueueScheduleDateYmd({ arrivalDate: "2026-08-01" })).toBe("2026-08-01");
  });

  test("buildStaffSchedulePayload by day key", () => {
    const items = [
      { guestId: 1, stageKey: "night_before", arrivalDate: "2026-07-10", displayName: "T-1" },
      { guestId: 2, stageKey: "night_before", arrivalDate: "2026-07-10" },
    ];
    const rows = buildStaffSchedulePayload(
      items,
      { "2026-07-10": "18:00" },
      (q) => q.arrivalDate,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      guest_id: 1,
      stage_key: "night_before",
      schedule_date: "2026-07-10",
      schedule_time: "18:00",
    });
  });

  test("isFutureScheduledQueueItem", () => {
    const future = new Date(Date.now() + 3600000).toISOString();
    expect(isFutureScheduledQueueItem({ scheduledFor: future, status: "pending" })).toBe(true);
    expect(isFutureScheduledQueueItem({ scheduledFor: future, status: "sent" })).toBe(false);
  });
});

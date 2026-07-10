import {
  buildExistingApptIndex,
  buildGuestSpaProfilePatch,
  matchExistingAppointment,
  pickBestGuestMatch,
  resolvePhoneVariants,
} from "./spaActivitiesSyncEngine";

describe("resolvePhoneVariants", () => {
  test("972-prefixed phone → +972 / 972 / 0 variants", () => {
    expect(resolvePhoneVariants("972507834236")).toEqual(
      expect.arrayContaining(["972507834236", "+972507834236", "0507834236"])
    );
  });

  test("empty/null → empty list", () => {
    expect(resolvePhoneVariants(null)).toEqual([]);
    expect(resolvePhoneVariants("")).toEqual([]);
  });
});

describe("pickBestGuestMatch", () => {
  test("no candidates → null, not suspicious", () => {
    expect(pickBestGuestMatch([], "2026-07-15")).toEqual({ guest: null, suspicious: false, reason: null });
  });

  test("single candidate → accepted as-is, never flagged suspicious", () => {
    const g = { id: 1, arrival_date: "2026-07-10", departure_date: "2026-07-20" };
    expect(pickBestGuestMatch([g], "2026-07-15")).toEqual({ guest: g, suspicious: false, reason: null });
  });

  test("couple sharing a phone — one candidate's stay window contains the appointment date, wins", () => {
    const inStay = { id: 1, arrival_date: "2026-07-10", departure_date: "2026-07-20" };
    const notInStay = { id: 2, arrival_date: "2025-01-01", departure_date: "2025-01-05" };
    const { guest, suspicious } = pickBestGuestMatch([notInStay, inStay], "2026-07-15");
    expect(guest.id).toBe(1);
    expect(suspicious).toBe(true);
  });

  test("couple sharing a phone, BOTH in-stay — row's own לקוח name disambiguates (the actual couple case)", () => {
    const husband = { id: 1, name: "דיין חיים", arrival_date: "2026-07-10", departure_date: "2026-07-20" };
    const wife = { id: 2, name: "דיין שרה", arrival_date: "2026-07-10", departure_date: "2026-07-20" };
    const forHusband = pickBestGuestMatch([husband, wife], "2026-07-15", "דיין חיים");
    const forWife = pickBestGuestMatch([husband, wife], "2026-07-15", "דיין שרה");
    expect(forHusband.guest.id).toBe(1);
    expect(forWife.guest.id).toBe(2);
    expect(forHusband.suspicious).toBe(true);
    expect(forWife.suspicious).toBe(true);
  });

  test("name hint matches regardless of word order (\"חיים דיין\" vs stored \"דיין חיים\")", () => {
    const a = { id: 1, name: "דיין חיים" };
    const b = { id: 2, name: "כהן משה" };
    const { guest } = pickBestGuestMatch([a, b], "2026-07-15", "חיים דיין");
    expect(guest.id).toBe(1);
  });

  test("name hint present but matches nothing/ambiguous — falls back to date logic instead of guessing", () => {
    const a = { id: 1, name: "כהן משה", arrival_date: "2026-07-14" };
    const b = { id: 2, name: "לוי דוד", arrival_date: "2026-01-01" };
    const { guest } = pickBestGuestMatch([a, b], "2026-07-15", "אורח לא ידוע");
    expect(guest.id).toBe(1); // closest arrival_date, name hint didn't help
  });

  test("no stay-window match — falls back to closest arrival_date, still flagged suspicious", () => {
    const far = { id: 1, arrival_date: "2026-01-01" };
    const close = { id: 2, arrival_date: "2026-07-14" };
    const { guest, suspicious } = pickBestGuestMatch([far, close], "2026-07-15");
    expect(guest.id).toBe(2);
    expect(suspicious).toBe(true);
  });

  test("multiple candidates, none with arrival_date — first one used, flagged suspicious", () => {
    const a = { id: 1 };
    const b = { id: 2 };
    const { guest, suspicious, reason } = pickBestGuestMatch([a, b], "2026-07-15");
    expect(guest.id).toBe(1);
    expect(suspicious).toBe(true);
    expect(reason).toMatch(/לא ניתן לקבוע/);
  });
});

describe("buildExistingApptIndex / matchExistingAppointment", () => {
  const existing = [
    { id: 100, ezgo_line_id: "L1", room_id: 5, start_time: "10:00", guest_id: 42 },
    { id: 101, ezgo_line_id: null, room_id: 6, start_time: "11:00", guest_id: 43 },
  ];

  test("matches by ezgo_line_id first when present", () => {
    const index = buildExistingApptIndex(existing);
    const row = { ezgo_line_id: "L1", start_time: "10:00" };
    expect(matchExistingAppointment(row, 5, 42, index).id).toBe(100);
  });

  test("falls back to (room, start_time, guest) natural key when no line id", () => {
    const index = buildExistingApptIndex(existing);
    const row = { ezgo_line_id: null, start_time: "11:00" };
    expect(matchExistingAppointment(row, 6, 43, index).id).toBe(101);
  });

  test("no match → null (this is a genuinely new appointment)", () => {
    const index = buildExistingApptIndex(existing);
    const row = { ezgo_line_id: null, start_time: "12:00" };
    expect(matchExistingAppointment(row, 7, 99, index)).toBeNull();
  });

  test("empty existing list never throws", () => {
    const index = buildExistingApptIndex([]);
    expect(matchExistingAppointment({ start_time: "09:00" }, 1, 1, index)).toBeNull();
  });
});

describe("buildGuestSpaProfilePatch", () => {
  test("merges spa key without dropping existing profile keys", () => {
    const existing = { vip_status: "gold", dietary: { tags: ["vegan"] } };
    const patch = buildGuestSpaProfilePatch(existing, {
      appointment_date: "2026-07-15", start_time: "10:00", end_time: "10:30",
      room: "חדר 10", therapist: "אולגה", treatment_type: "שוודי", ezgo_line_id: "L1",
    });
    expect(patch.vip_status).toBe("gold");
    expect(patch.dietary).toEqual({ tags: ["vegan"] });
    expect(patch.spa).toMatchObject({
      date: "2026-07-15", time: "10:00", end_time: "10:30",
      room: "חדר 10", therapist: "אולגה", treatment_type: "שוודי", ezgo_line_id: "L1",
    });
    expect(typeof patch.spa.imported_at).toBe("string");
  });

  test("null/non-object existing profile → spa key added to a fresh object", () => {
    const patch = buildGuestSpaProfilePatch(null, { appointment_date: "2026-07-15", start_time: "09:00" });
    expect(patch).toHaveProperty("spa");
    expect(Object.keys(patch)).toEqual(["spa"]);
  });
});

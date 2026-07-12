// jsdom's test environment doesn't expose the browser `crypto` global that
// syncEzgoSpaActivities relies on for crypto.randomUUID() — no test exercised
// the orchestrator before this file, so this gap was never hit.
if (!global.crypto || typeof global.crypto.randomUUID !== "function") {
  const nodeCrypto = require("crypto");
  global.crypto = { ...global.crypto, randomUUID: () => nodeCrypto.randomUUID() };
}

import {
  buildExistingApptIndex,
  buildGuestSpaProfilePatch,
  extractSpaMealTime,
  matchExistingAppointment,
  pickBestGuestMatch,
  resolvePhoneVariants,
  syncEzgoSpaActivities,
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

  test("Latin nickname + Hebrew group_label matches Golden Profile Hebrew name", () => {
    const limor = { id: 1, name: "לימור סולומון", arrival_date: "2026-07-12", departure_date: "2026-07-14" };
    const other = { id: 2, name: "כהן משה", arrival_date: "2026-07-12", departure_date: "2026-07-14" };
    const { guest, suspicious } = pickBestGuestMatch([limor, other], "2026-07-13", "limor", "לימור סולומון");
    expect(guest.id).toBe(1);
    expect(suspicious).toBe(true);
  });

  test("org group_label is ignored for name match — does not steal by ועד… tokens", () => {
    const a = { id: 1, name: "זיו מוזס", arrival_date: "2026-07-13", departure_date: "2026-07-13" };
    const b = { id: 2, name: "מאור סיסו", arrival_date: "2026-07-13", departure_date: "2026-07-13" };
    const { guest } = pickBestGuestMatch(
      [a, b],
      "2026-07-13",
      "זיו מוזס",
      "ועד עובדי הטכנולוגיה בנק הפועלים"
    );
    expect(guest.id).toBe(1);
  });

  test("loose Hebrew token subset matches fuller stored name", () => {
    const full = { id: 1, name: "רעות לוי כהן", arrival_date: "2026-07-10", departure_date: "2026-07-20" };
    const other = { id: 2, name: "שלומית מרמור", arrival_date: "2026-07-10", departure_date: "2026-07-20" };
    const { guest } = pickBestGuestMatch([full, other], "2026-07-13", "רעות לוי");
    expect(guest.id).toBe(1);
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
    { id: 100, ezgo_line_id: "L1", room_id: 5, start_time: "10:00", guest_id: 42, therapist_id: 7 },
    { id: 101, ezgo_line_id: null, room_id: 6, start_time: "11:00", guest_id: 43, therapist_id: 8 },
    { id: 102, ezgo_line_id: "2890534_1", room_id: 1, start_time: "09:00", guest_id: 50, therapist_id: 10 },
    { id: 103, ezgo_line_id: "2890534_2", room_id: 1, start_time: "09:00", guest_id: 50, therapist_id: 11 },
  ];

  test("matches by ezgo_line_id first when present", () => {
    const index = buildExistingApptIndex(existing);
    const row = { ezgo_line_id: "L1", start_time: "10:00" };
    expect(matchExistingAppointment(row, 5, 42, index, 7).id).toBe(100);
  });

  test("falls back to (room, start_time, guest, therapist) natural key when no line id", () => {
    const index = buildExistingApptIndex(existing);
    const row = { ezgo_line_id: null, start_time: "11:00" };
    expect(matchExistingAppointment(row, 6, 43, index, 8).id).toBe(101);
  });

  test("couple slot — two therapists same room/start/guest stay as distinct appointments", () => {
    const index = buildExistingApptIndex(existing);
    expect(matchExistingAppointment({ ezgo_line_id: "2890534_1", start_time: "09:00" }, 1, 50, index, 10).id).toBe(102);
    expect(matchExistingAppointment({ ezgo_line_id: "2890534_2", start_time: "09:00" }, 1, 50, index, 11).id).toBe(103);
    // Natural-key path also distinguishes by therapist when line ids are absent.
    const noLine = buildExistingApptIndex([
      { id: 201, ezgo_line_id: null, room_id: 1, start_time: "09:00", guest_id: 50, therapist_id: 10 },
      { id: 202, ezgo_line_id: null, room_id: 1, start_time: "09:00", guest_id: 50, therapist_id: 11 },
    ]);
    expect(matchExistingAppointment({ ezgo_line_id: null, start_time: "09:00" }, 1, 50, noLine, 10).id).toBe(201);
    expect(matchExistingAppointment({ ezgo_line_id: null, start_time: "09:00" }, 1, 50, noLine, 11).id).toBe(202);
  });

  test("no match → null (this is a genuinely new appointment)", () => {
    const index = buildExistingApptIndex(existing);
    const row = { ezgo_line_id: null, start_time: "12:00" };
    expect(matchExistingAppointment(row, 7, 99, index, 1)).toBeNull();
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

describe("extractSpaMealTime", () => {
  test("explicit ארוחת ערב + time → captured", () => {
    expect(extractSpaMealTime("ארוחת ערב 19:30")).toBe("19:30");
  });

  test("HB keyword + bare time → captured", () => {
    expect(extractSpaMealTime("HB 20:00")).toBe("20:00");
  });

  test("board-basis word alone (חצי פנסיון), no time → null, never guessed", () => {
    expect(extractSpaMealTime("חצי פנסיון")).toBeNull();
  });

  test("bare evening time with no meal-context word → null (avoids late check-in/spa-slot false positive)", () => {
    expect(extractSpaMealTime("19:30 הגעה")).toBeNull();
  });

  test("empty/null/whitespace → null", () => {
    expect(extractSpaMealTime(null)).toBeNull();
    expect(extractSpaMealTime("")).toBeNull();
    expect(extractSpaMealTime("   ")).toBeNull();
  });

  test("evening time after 21:30 with meal context → not captured (same cutoff as ArrivalImportPanel)", () => {
    expect(extractSpaMealTime("ארוחה - שולחן פנוי אחרי 21:45")).toBeNull();
  });
});

describe("syncEzgoSpaActivities — orchestrator (mocked supabase)", () => {
  function makeSupabaseMock(resolve) {
    function chain(ctx) {
      const api = {
        select(cols) { ctx.select = cols; return api; },
        insert(payload) { ctx.op = "insert"; ctx.payload = payload; return api; },
        update(payload) { ctx.op = "update"; ctx.payload = payload; return api; },
        eq(col, val) { ctx.eq = { ...(ctx.eq || {}), [col]: val }; return api; },
        neq(col, val) { ctx.neq = { ...(ctx.neq || {}), [col]: val }; return api; },
        in(col, vals) { ctx.in = { ...(ctx.in || {}), [col]: vals }; return api; },
        order() { return api; },
        limit() { return api; },
        maybeSingle() { return Promise.resolve(resolve(ctx) ?? { data: null, error: null }); },
        then(res, rej) {
          return Promise.resolve(resolve(ctx) ?? { data: null, error: null }).then(res, rej);
        },
      };
      return api;
    }
    return { from: (table) => chain({ table, op: "select" }) };
  }

  function baseRow(overrides = {}) {
    return {
      raw: {}, ezgo_line_id: null, start_time: "10:00", end_time: "10:30",
      room_raw: "חדר 5", therapist_name: null, treatment_type: "עיסוי", extras: null,
      guest_name: "דנה כהן", group_label: null, is_new_booking_placeholder: false,
      phone: "972500000001", phone_raw: "0500000001", note: null, warnings: [],
      ...overrides,
    };
  }

  test("no existing guest, real phone+name → auto-created as day_guest, appointment linked", async () => {
    let insertedGuestPayload = null;
    const supabase = makeSupabaseMock((ctx) => {
      if (ctx.table === "spa_room_aliases") return { data: [{ ezgo_name: "חדר 5", room_id: 5 }] };
      if (ctx.table === "spa_therapists") return { data: [] };
      if (ctx.table === "spa_rooms") return { data: [{ id: 5, name: "חדר 5" }] };
      if (ctx.table === "spa_appointments" && ctx.op === "select") {
        if (ctx.eq?.guest_id !== undefined) {
          return { data: [{ start_time: "10:00", end_time: "10:30", room_id: 5, treatment_type: "עיסוי", ezgo_line_id: null, spa_therapists: null }] };
        }
        return { data: [] };
      }
      if (ctx.table === "guests" && ctx.in) return { data: [] };
      if (ctx.table === "guests" && ctx.op === "insert") {
        insertedGuestPayload = ctx.payload;
        return { data: { id: 999, name: "דנה כהן", phone: "+972500000001", arrival_date: "2026-07-15", departure_date: "2026-07-15", status: "expected" }, error: null };
      }
      if (ctx.table === "spa_appointments" && ctx.op === "insert") return { error: null };
      if (ctx.table === "spa_import_unmatched") return { error: null };
      if (ctx.table === "guests" && ctx.select === "guest_profile, meal_time") return { data: { guest_profile: {}, meal_time: null } };
      if (ctx.table === "guests" && ctx.op === "update") return { error: null };
      return null;
    });

    const summary = await syncEzgoSpaActivities([baseRow()], "2026-07-15", { supabase });
    expect(summary.guests_created).toBe(1);
    expect(summary.created).toBe(1);
    expect(summary.matched_guests).toBe(1);
    expect(summary.unmatched).toBe(0);
    expect(summary.not_in_file).toBe(0);
    expect(insertedGuestPayload).toMatchObject({
      phone: "+972500000001", name: "דנה כהן", room_type: "day_guest", room: "Premium Day 1",
      arrival_date: "2026-07-15", departure_date: "2026-07-15", status: "expected",
    });
  });

  test("garbage/non-phone-shaped טלפון cell (e.g. misaligned column) → NOT created, stays no_guest_match", async () => {
    let unmatchedPayload = null;
    const supabase = makeSupabaseMock((ctx) => {
      if (ctx.table === "spa_room_aliases") return { data: [{ ezgo_name: "חדר 5", room_id: 5 }] };
      if (ctx.table === "spa_therapists") return { data: [] };
      if (ctx.table === "spa_rooms") return { data: [{ id: 5, name: "חדר 5" }] };
      if (ctx.table === "spa_appointments" && ctx.op === "select") return { data: [] };
      if (ctx.table === "guests" && ctx.in) return { data: [] };
      if (ctx.table === "guests" && ctx.op === "insert") throw new Error("must not auto-create off a non-phone-shaped value");
      if (ctx.table === "spa_import_unmatched") { unmatchedPayload = ctx.payload; return { error: null }; }
      return null;
    });

    // normalizeActivitiesPhone keeps an unrecognized shape as-is rather than
    // nulling it (ZERO DATA LOSS at the parser layer) — the sync engine must
    // still refuse to auto-create off it.
    const row = baseRow({ phone: "מטפלתרחל", phone_raw: "מטפלת רחל" });
    const summary = await syncEzgoSpaActivities([row], "2026-07-15", { supabase });
    expect(summary.guests_created).toBe(0);
    expect(summary.unmatched).toBe(1);
    expect(unmatchedPayload[0].reason).toBe("no_guest_match");
  });

  test("unusable identity (new-booking placeholder, no name) → NOT created, stays no_guest_match", async () => {
    let unmatchedPayload = null;
    const supabase = makeSupabaseMock((ctx) => {
      if (ctx.table === "spa_room_aliases") return { data: [{ ezgo_name: "חדר 5", room_id: 5 }] };
      if (ctx.table === "spa_therapists") return { data: [] };
      if (ctx.table === "spa_rooms") return { data: [{ id: 5, name: "חדר 5" }] };
      if (ctx.table === "spa_appointments" && ctx.op === "select") return { data: [] };
      if (ctx.table === "guests" && ctx.in) return { data: [] };
      if (ctx.table === "guests" && ctx.op === "insert") throw new Error("must not auto-create for a placeholder row");
      if (ctx.table === "spa_import_unmatched") { unmatchedPayload = ctx.payload; return { error: null }; }
      return null;
    });

    const row = baseRow({ guest_name: null, is_new_booking_placeholder: true });
    const summary = await syncEzgoSpaActivities([row], "2026-07-15", { supabase });
    expect(summary.guests_created).toBe(0);
    expect(summary.unmatched).toBe(1);
    expect(unmatchedPayload[0].reason).toBe("no_guest_match");
  });

  test("re-import: appointment absent from new file is counted not_in_file, never mutated", async () => {
    const supabase = makeSupabaseMock((ctx) => {
      if (ctx.table === "spa_room_aliases") return { data: [{ ezgo_name: "חדר 5", room_id: 5 }] };
      if (ctx.table === "spa_therapists") return { data: [] };
      if (ctx.table === "spa_rooms") return { data: [{ id: 5, name: "חדר 5" }] };
      if (ctx.table === "spa_appointments" && ctx.op === "select") {
        if (ctx.eq?.guest_id !== undefined) {
          return { data: [{ start_time: "10:00", end_time: "10:30", room_id: 5, treatment_type: "עיסוי", ezgo_line_id: "L1", spa_therapists: null }] };
        }
        // Two existing appointments today: L1 (still in this file) + L2 (missing from this file)
        return { data: [{ id: 501, guest_id: 42, room_id: 5, ezgo_line_id: "L1", start_time: "10:00" }, { id: 502, guest_id: 43, room_id: 6, ezgo_line_id: "L2", start_time: "12:00" }] };
      }
      if (ctx.table === "guests" && ctx.in) return { data: [{ id: 42, name: "דנה כהן", phone: "+972500000001", arrival_date: "2026-07-15", departure_date: "2026-07-15" }] };
      if (ctx.table === "spa_appointments" && ctx.op === "update") return { error: null };
      if (ctx.table === "guests" && ctx.select === "guest_profile, meal_time") return { data: { guest_profile: {}, meal_time: null } };
      if (ctx.table === "guests" && ctx.op === "update") return { error: null };
      return null;
    });

    const row = baseRow({ ezgo_line_id: "L1" });
    const summary = await syncEzgoSpaActivities([row], "2026-07-15", { supabase });
    expect(summary.updated).toBe(1);
    expect(summary.not_in_file).toBe(1); // only L2 was left untouched
  });

  test("explicit meal time in note, guest.meal_time currently null → meal_time_set", async () => {
    let guestUpdatePayload = null;
    const supabase = makeSupabaseMock((ctx) => {
      if (ctx.table === "spa_room_aliases") return { data: [{ ezgo_name: "חדר 5", room_id: 5 }] };
      if (ctx.table === "spa_therapists") return { data: [] };
      if (ctx.table === "spa_rooms") return { data: [{ id: 5, name: "חדר 5" }] };
      if (ctx.table === "spa_appointments" && ctx.op === "select") {
        if (ctx.eq?.guest_id !== undefined) {
          return { data: [{ start_time: "10:00", end_time: "10:30", room_id: 5, treatment_type: "עיסוי", ezgo_line_id: null, spa_therapists: null }] };
        }
        return { data: [] };
      }
      if (ctx.table === "guests" && ctx.in) return { data: [{ id: 42, name: "דנה כהן", phone: "+972500000001", arrival_date: "2026-07-15", departure_date: "2026-07-15" }] };
      if (ctx.table === "spa_appointments" && ctx.op === "insert") return { error: null };
      if (ctx.table === "guests" && ctx.select === "guest_profile, meal_time") return { data: { guest_profile: {}, meal_time: null } };
      if (ctx.table === "guests" && ctx.op === "update") { guestUpdatePayload = ctx.payload; return { error: null }; }
      return null;
    });

    const row = baseRow({ note: "ארוחת ערב 19:30" });
    const summary = await syncEzgoSpaActivities([row], "2026-07-15", { supabase });
    expect(summary.meal_time_set).toBe(1);
    expect(guestUpdatePayload.meal_time).toBe("19:30");
  });

  test("explicit meal time in note, guest.meal_time already set → never overwritten", async () => {
    let guestUpdatePayload = null;
    const supabase = makeSupabaseMock((ctx) => {
      if (ctx.table === "spa_room_aliases") return { data: [{ ezgo_name: "חדר 5", room_id: 5 }] };
      if (ctx.table === "spa_therapists") return { data: [] };
      if (ctx.table === "spa_rooms") return { data: [{ id: 5, name: "חדר 5" }] };
      if (ctx.table === "spa_appointments" && ctx.op === "select") {
        if (ctx.eq?.guest_id !== undefined) {
          return { data: [{ start_time: "10:00", end_time: "10:30", room_id: 5, treatment_type: "עיסוי", ezgo_line_id: null, spa_therapists: null }] };
        }
        return { data: [] };
      }
      if (ctx.table === "guests" && ctx.in) return { data: [{ id: 42, name: "דנה כהן", phone: "+972500000001", arrival_date: "2026-07-15", departure_date: "2026-07-15" }] };
      if (ctx.table === "spa_appointments" && ctx.op === "insert") return { error: null };
      if (ctx.table === "guests" && ctx.select === "guest_profile, meal_time") return { data: { guest_profile: {}, meal_time: "18:00" } };
      if (ctx.table === "guests" && ctx.op === "update") { guestUpdatePayload = ctx.payload; return { error: null }; }
      return null;
    });

    const row = baseRow({ note: "ארוחת ערב 19:30" });
    const summary = await syncEzgoSpaActivities([row], "2026-07-15", { supabase });
    expect(summary.meal_time_set).toBe(0);
    expect(guestUpdatePayload.meal_time).toBeUndefined();
  });

  test("couple cell (\"Name (Group)\") on an auto-created guest → one profile + suspicious_shared_phone flag, no second guest created", async () => {
    let guestInsertCount = 0;
    let unmatchedPayload = null;
    const supabase = makeSupabaseMock((ctx) => {
      if (ctx.table === "spa_room_aliases") return { data: [{ ezgo_name: "חדר 5", room_id: 5 }] };
      if (ctx.table === "spa_therapists") return { data: [] };
      if (ctx.table === "spa_rooms") return { data: [{ id: 5, name: "חדר 5" }] };
      if (ctx.table === "spa_appointments" && ctx.op === "select") {
        if (ctx.eq?.guest_id !== undefined) {
          return { data: [{ start_time: "10:00", end_time: "10:30", room_id: 5, treatment_type: "עיסוי", ezgo_line_id: null, spa_therapists: null }] };
        }
        return { data: [] };
      }
      if (ctx.table === "guests" && ctx.in) return { data: [] };
      if (ctx.table === "guests" && ctx.op === "insert") {
        guestInsertCount++;
        return { data: { id: 999, name: "דנה כהן", phone: "+972500000001", arrival_date: "2026-07-15", departure_date: "2026-07-15", status: "expected" }, error: null };
      }
      if (ctx.table === "spa_appointments" && ctx.op === "insert") return { error: null };
      if (ctx.table === "spa_import_unmatched") { unmatchedPayload = ctx.payload; return { error: null }; }
      if (ctx.table === "guests" && ctx.select === "guest_profile, meal_time") return { data: { guest_profile: {}, meal_time: null } };
      if (ctx.table === "guests" && ctx.op === "update") return { error: null };
      return null;
    });

    const row = baseRow({ group_label: "בן/בת זוג" });
    const summary = await syncEzgoSpaActivities([row], "2026-07-15", { supabase });
    expect(guestInsertCount).toBe(1); // never a second guest for the companion
    expect(summary.guests_created).toBe(1);
    expect(summary.suspicious).toBe(1);
    expect(unmatchedPayload[0].reason).toBe("suspicious_shared_phone");
    expect(unmatchedPayload[0].guest_name).toMatch(/פרופיל שני לא נוצר/);
  });
});

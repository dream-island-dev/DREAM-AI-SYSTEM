import { buildSpaLeadSingleCopy, fetchSpaCoordinatorLeads, mergePastedSpaUpsellContacts, resolvePastedRowAgainstGuests, resolveSentGuestIds } from "./spaUpsellHub";

describe("resolveSentGuestIds — phone match, not array-index match (P0 2026-08-05)", () => {
  test("matches sent jobs to the right guest even when DB rows come back out of order", () => {
    const targets = [
      { id: 1, phone: "+972501111111" },
      { id: 2, phone: "+972502222222" },
      { id: 3, phone: "+972503333333" },
    ];
    // DB returns rows in a different order than targets, and the middle one failed.
    const rows = [
      { phone: "+972503333333", status: "sent" },
      { phone: "+972501111111", status: "sent" },
      { phone: "+972502222222", status: "failed" },
    ];
    const sentIds = resolveSentGuestIds(rows, targets);
    expect(sentIds.has(1)).toBe(true);
    expect(sentIds.has(3)).toBe(true);
    expect(sentIds.has(2)).toBe(false); // the failed one must stay in the list
  });

  test("all-sent fallback still marks every target sent regardless of order", () => {
    const targets = [{ id: 1, phone: "+972501111111" }, { id: 2, phone: "+972502222222" }];
    const rows = [{ phone: "+972502222222", status: "sent" }, { phone: "+972501111111", status: "sent" }];
    const sentIds = resolveSentGuestIds(rows, targets);
    expect(sentIds.size).toBe(2);
  });

  test("empty rows → nothing marked sent", () => {
    expect(resolveSentGuestIds([], [{ id: 1, phone: "+972501111111" }]).size).toBe(0);
  });
});

function makeMockSupabase(guestsResponse = { data: [], error: null }) {
  const builder = {
    select() { return builder; },
    in() { return builder; },
    neq() { return builder; },
    then(resolve, reject) {
      return Promise.resolve(guestsResponse).then(resolve, reject);
    },
  };
  return { from: () => builder };
}

describe("fetchSpaCoordinatorLeads — orphaned leads stay visible (P0 2026-08-05)", () => {
  function makeAlertsMockSupabase(response) {
    const builder = {
      select() { return builder; },
      in() { return builder; },
      eq() { return builder; },
      order() { return Promise.resolve(response); },
    };
    return { from: () => builder };
  }

  test("flags a lead with no linked guest instead of dropping it", async () => {
    const supabase = makeAlertsMockSupabase({
      data: [
        { id: 1, phone: "+972501234567", message: "אשמח לתאם", resolved: false, guests: null },
        { id: 2, phone: "+972502222222", message: "אשמח לתאם", resolved: false, guests: { id: 9, name: "דנה" } },
      ],
      error: null,
    });
    const { leads, error } = await fetchSpaCoordinatorLeads(supabase);
    expect(error).toBeNull();
    expect(leads).toHaveLength(2);
    expect(leads.find((l) => l.id === 1).guestMissing).toBe(true);
    expect(leads.find((l) => l.id === 2).guestMissing).toBeUndefined();
  });
});

describe("mergePastedSpaUpsellContacts — duplicate lines pass through (P0 2026-08-05)", () => {
  test("surfaces duplicates instead of dropping them silently", async () => {
    const supabase = makeMockSupabase({ data: [], error: null });
    const result = await mergePastedSpaUpsellContacts(
      supabase,
      "דנה: +972501234567\nדנה שוב: +972-50-123-4567",
      "2026-08-10",
    );
    expect(result.duplicates).toHaveLength(1);
    expect(result.duplicates[0]).toContain("דנה שוב");
  });

  test("empty paste still returns a duplicates array", async () => {
    const supabase = makeMockSupabase();
    const result = await mergePastedSpaUpsellContacts(supabase, "לא מספר", "2026-08-10");
    expect(result.duplicates).toEqual([]);
    expect(result.invalid).toEqual(["לא מספר"]);
  });
});

describe("buildSpaLeadSingleCopy", () => {
  test("formats name, room, date, phone and quoted message", () => {
    const lead = {
      phone: "+972501234567",
      message: "אשמח לתאם",
      guests: { name: "דנה כהן", room: "אמטיסט 8", arrival_date: "2026-08-11" },
    };
    expect(buildSpaLeadSingleCopy(lead)).toBe(
      "💆 דנה כהן · אמטיסט 8\n📅 2026-08-11 · 📱 +972501234567\n«אשמח לתאם»",
    );
  });

  test("falls back to guest phone when lead.phone is missing", () => {
    const lead = { guests: { name: "אורח", phone: "+972500000000" } };
    expect(buildSpaLeadSingleCopy(lead)).toContain("📱 +972500000000");
  });

  test("omits the quote line when there is no message", () => {
    const lead = { phone: "+972501234567", guests: { name: "אורח" } };
    const text = buildSpaLeadSingleCopy(lead);
    expect(text).not.toContain("«");
  });

  test("uses placeholders when guest fields are missing", () => {
    const text = buildSpaLeadSingleCopy({});
    expect(text).toBe("💆 אורח\n📅 — · 📱 —");
  });
});

describe("resolvePastedRowAgainstGuests", () => {
  const row = { name: "אורן", phone: "+972538929368" };
  const hubDate = "2026-08-05";

  test("notFound when no DB matches", () => {
    expect(resolvePastedRowAgainstGuests(row, [], hubDate)).toEqual({ kind: "notFound" });
  });

  test("merged when day-pass guest matches hub arrival date", () => {
    const guest = {
      id: 1,
      phone: "972538929368",
      name: "אורן",
      room: "בילוי יומי",
      room_type: "day_guest",
      arrival_date: hubDate,
      status: "expected",
      msg_spa_upsell_sent: false,
    };
    const res = resolvePastedRowAgainstGuests(row, [guest], hubDate);
    expect(res.kind).toBe("merged");
    expect(res.item.id).toBe(1);
  });

  test("ineligible for suite guest on hub date", () => {
    const guest = {
      id: 2,
      phone: "+972538929368",
      name: "אורן",
      room: "ג׳ספר 3",
      room_type: "suite",
      arrival_date: hubDate,
      departure_date: "2026-08-07",
      status: "expected",
      msg_spa_upsell_sent: false,
    };
    const res = resolvePastedRowAgainstGuests(row, [guest], hubDate);
    expect(res.kind).toBe("ineligible");
    expect(res.reason).toContain("סוויטה");
  });

  test("notFound when only a past day-pass profile exists (returning guest)", () => {
    const guest = {
      id: 3,
      phone: "+972538929368",
      name: "אורן",
      room: "בילוי יומי",
      room_type: "day_guest",
      arrival_date: "2026-08-01",
      status: "expected",
      msg_spa_upsell_sent: false,
    };
    expect(resolvePastedRowAgainstGuests(row, [guest], hubDate)).toEqual({
      kind: "notFound",
      hint: `יש ביקור קודם ב-2026-08-01 — «צור פרופיל» יוסיף שורה חדשה ל-${hubDate} בלבד (לא כפילות)`,
    });
  });

  test("ineligible when duplicate profiles share hub arrival date", () => {
    const dupA = {
      id: 10,
      phone: "+972538929368",
      name: "אורן",
      room: "בילוי יומי",
      room_type: "day_guest",
      arrival_date: hubDate,
      status: "expected",
      msg_spa_upsell_sent: false,
    };
    const dupB = { ...dupA, id: 11, room: "Premium Day 1", room_type: "premium_day_guest" };
    const res = resolvePastedRowAgainstGuests(row, [dupA, dupB], hubDate);
    expect(res.kind).toBe("ineligible");
    expect(res.reason).toContain("כפילות");
  });

  test("blocks create path when suite stay overlaps hub date but arrival differs", () => {
    const guest = {
      id: 4,
      phone: "+972538929368",
      name: "אורן",
      room: "אמטיסט 8",
      room_type: "suite",
      arrival_date: "2026-08-04",
      departure_date: "2026-08-06",
      status: "checked_in",
      msg_spa_upsell_sent: false,
    };
    const res = resolvePastedRowAgainstGuests(row, [guest], hubDate);
    expect(res.kind).toBe("ineligible");
    expect(res.reason).toContain("לא ניתן ליצור בילוי יומי");
  });
});

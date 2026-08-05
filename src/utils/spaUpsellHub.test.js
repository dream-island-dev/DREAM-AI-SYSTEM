import { buildSpaLeadSingleCopy, resolvePastedRowAgainstGuests } from "./spaUpsellHub";

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

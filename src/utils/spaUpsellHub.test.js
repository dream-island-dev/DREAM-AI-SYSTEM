import { buildSpaLeadSingleCopy } from "./spaUpsellHub";

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

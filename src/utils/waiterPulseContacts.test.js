import {
  parseWaiterPulsePaste,
  personalizeWaiterPulseInvite,
} from "./waiterPulseContacts";

describe("parseWaiterPulsePaste", () => {
  test("parses name: phone lines", () => {
    const { rows, invalid } = parseWaiterPulsePaste(
      "ליאור לוי: +972 53-338-2689\n+972 50-607-0247",
    );
    expect(invalid).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ name: "ליאור לוי", phone: "+972533382689" });
    expect(rows[1]).toEqual({ name: "", phone: "+972506070247" });
  });

  test("dedupes by phone", () => {
    const { rows } = parseWaiterPulsePaste("+972501234567\n+972-50-123-4567");
    expect(rows).toHaveLength(1);
  });

  test("flags invalid lines", () => {
    const { rows, invalid } = parseWaiterPulsePaste("לא מספר\nabc");
    expect(rows).toHaveLength(0);
    expect(invalid).toHaveLength(2);
  });

  test("surfaces dropped duplicate lines instead of silently discarding them — P0 2026-08-05", () => {
    const { rows, duplicates } = parseWaiterPulsePaste(
      "דנה: +972501234567\nדנה שוב: +972-50-123-4567",
    );
    expect(rows).toHaveLength(1);
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0]).toContain("דנה שוב");
  });
});

describe("personalizeWaiterPulseInvite", () => {
  const tpl = "היי {{שם}}!\n{{קישור}}";

  test("replaces name and link", () => {
    expect(personalizeWaiterPulseInvite(tpl, { name: "עופרי", link: "https://x/pulse/1" }))
      .toBe("היי עופרי!\nhttps://x/pulse/1");
  });

  test("unnamed drops name token", () => {
    const out = personalizeWaiterPulseInvite(tpl, { name: "", link: "https://x" });
    expect(out).toContain("היי!");
    expect(out).not.toContain("{{שם}}");
    expect(out).toContain("https://x");
  });
});

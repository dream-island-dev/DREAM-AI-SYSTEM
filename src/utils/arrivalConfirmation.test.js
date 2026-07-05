import { isArrivalConfirmationMessage, normalizeInboundConfirmText } from "./arrivalConfirmation";

describe("arrivalConfirmation", () => {
  test("normalizeInboundConfirmText strips WhatsApp bold markers", () => {
    expect(normalizeInboundConfirmText("**כן, מגיעים!**")).toBe("כן, מגיעים!");
  });

  test("matches template quick-reply variants", () => {
    expect(isArrivalConfirmationMessage("כן,מגיעים!")).toBe(true);
    expect(isArrivalConfirmationMessage("כן, מגיעים!")).toBe(true);
    expect(isArrivalConfirmationMessage("**כן, מגיעים!**")).toBe(true);
    expect(isArrivalConfirmationMessage("כן, מגיעים! ✨")).toBe(true);
    expect(
      isArrivalConfirmationMessage("כן, מגיעים!", { buttonTitle: "כן, מגיעים! ✨" }),
    ).toBe(true);
  });

  test("rejects date-change decline button", () => {
    expect(isArrivalConfirmationMessage("לא, שינוי בתאריך 🗓️")).toBe(false);
    expect(
      isArrivalConfirmationMessage("", { buttonTitle: "לא, שינוי בתאריך" }),
    ).toBe(false);
  });

  test("rejects unrelated courtesy replies", () => {
    expect(isArrivalConfirmationMessage("תודה")).toBe(false);
    expect(isArrivalConfirmationMessage("בסדר")).toBe(false);
  });
});

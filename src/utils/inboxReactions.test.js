import {
  formatGuestReactionLabel,
  isGuestReactionRow,
  parseGuestReactionMessage,
} from "./inboxReactions";

describe("inboxReactions", () => {
  test("parseGuestReactionMessage — add with snippet", () => {
    const parsed = parseGuestReactionMessage("👍 תגובה על ההודעה: «כן מגיעים!»", "guest_reaction");
    expect(parsed).toEqual({ kind: "add", emoji: "👍", snippet: "כן מגיעים!" });
  });

  test("parseGuestReactionMessage — add generic (legacy rows)", () => {
    const parsed = parseGuestReactionMessage("👍 תגובה על הודעה קודמת", "received");
    expect(parsed).toEqual({ kind: "add", emoji: "👍", snippet: null });
  });

  test("parseGuestReactionMessage — remove", () => {
    const parsed = parseGuestReactionMessage("הוסרה תגובה מהודעה קודמת", "guest_reaction");
    expect(parsed).toEqual({ kind: "remove", emoji: null, snippet: null });
  });

  test("isGuestReactionRow skips unread noise", () => {
    expect(isGuestReactionRow({
      direction: "inbound",
      intent: "guest_reaction",
      message: "👍 תגובה על הודעה קודמת",
    })).toBe(true);
    expect(isGuestReactionRow({
      direction: "inbound",
      intent: "received",
      message: "שלום",
    })).toBe(false);
  });

  test("formatGuestReactionLabel", () => {
    expect(formatGuestReactionLabel({ kind: "add", emoji: "👍", snippet: "כן" }))
      .toBe("👍 תגובה ל־«כן»");
  });
});

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

  // Regression: multi-codepoint emoji (skin tone / VS16 / ZWJ) used to fail
  // the whole anchored regex because it was captured as a single
  // \p{Extended_Pictographic} code point — the guest's real emoji+snippet
  // was logged correctly by the webhook but rendered as a bare "תגובה" pill.
  test("parseGuestReactionMessage — skin-toned emoji (👍🏼)", () => {
    const parsed = parseGuestReactionMessage("👍🏼 תגובה על ההודעה: «הסוויטה מוכנה»", "guest_reaction");
    expect(parsed).toEqual({ kind: "add", emoji: "👍🏼", snippet: "הסוויטה מוכנה" });
  });

  test("parseGuestReactionMessage — red heart with variation selector (❤️, WhatsApp's default quick-react)", () => {
    const parsed = parseGuestReactionMessage("❤️ תגובה על ההודעה: «הסוויטה מוכנה»", "guest_reaction");
    expect(parsed).toEqual({ kind: "add", emoji: "❤️", snippet: "הסוויטה מוכנה" });
  });

  test("parseGuestReactionMessage — skin-toned emoji, generic (no snippet)", () => {
    const parsed = parseGuestReactionMessage("🙏🏽 תגובה על הודעה קודמת", "guest_reaction");
    expect(parsed).toEqual({ kind: "add", emoji: "🙏🏽", snippet: null });
  });

  test("parseGuestReactionMessage — ZWJ family emoji", () => {
    const parsed = parseGuestReactionMessage("👨‍👩‍👧 תגובה על ההודעה: «הסוויטה מוכנה»", "guest_reaction");
    expect(parsed).toEqual({ kind: "add", emoji: "👨‍👩‍👧", snippet: "הסוויטה מוכנה" });
  });

  test("parseGuestReactionMessage — flag emoji (regional indicator pair)", () => {
    const parsed = parseGuestReactionMessage("🇮🇱 תגובה על ההודעה: «הסוויטה מוכנה»", "guest_reaction");
    expect(parsed).toEqual({ kind: "add", emoji: "🇮🇱", snippet: "הסוויטה מוכנה" });
  });

  // Plain guest text must never be misread as a reaction, even with intent
  // wrongly tagged — protects the "never hide a real text message" guarantee.
  test("parseGuestReactionMessage — plain guest text is never treated as a reaction template", () => {
    const parsed = parseGuestReactionMessage("היי רציתי לדעת אם יש אפשרות לקבל את החדר יותר מוקדם?", "faq");
    expect(parsed).toBeNull();
  });

  // FAIL VISIBLE: an intent="guest_reaction" row that matches none of the
  // known templates (future Meta shape / legacy row) must return null — not
  // a content-free stub — so the caller falls back to the raw stored text
  // instead of pretending nothing was said.
  test("parseGuestReactionMessage — unparseable guest_reaction row falls back to null (never a fake stub)", () => {
    const parsed = parseGuestReactionMessage("some future Meta payload shape we don't recognize", "guest_reaction");
    expect(parsed).toBeNull();
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

  // Defense in depth: even if some future caller hand-builds a content-free
  // parsed object, the label must stay honest — never a bare "תגובה" that
  // pretends real content exists.
  test("formatGuestReactionLabel — content-free stub never renders as bare 'תגובה'", () => {
    expect(formatGuestReactionLabel({ kind: "add", emoji: null, snippet: null }))
      .toBe("תגובת אמוג'י (פרטים חסרים)");
  });
});

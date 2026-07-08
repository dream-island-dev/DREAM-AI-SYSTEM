/**
 * Parse guest WhatsApp emoji-reaction rows logged by whatsapp-webhook (session 125+).
 * Reactions are not real text messages — compact UI only.
 */

// A guest's emoji reaction is rarely a single Unicode code point. WhatsApp's
// default reactions include ❤️ (U+2764 + VARIATION SELECTOR-16) and skin-toned
// 👍🏼 (U+1F44D + an Emoji_Modifier) — both common, and both invisible to a
// capture group anchored to a lone \p{Extended_Pictographic} char: the regex
// matches only the base code point, then fails on the very next character
// (VS16 / skin tone) instead of the expected whitespace, so the *entire*
// anchored pattern never matches. That silently fell through to the
// "guest_reaction intent but unparsed" branch below, which used to render a
// content-free "תגובה" bubble even though the webhook had logged the real
// emoji + quoted snippet. EMOJI_SEQUENCE matches a full emoji grapheme
// cluster: base pictograph + optional modifier/VS16, optionally chained with
// ZWJ for compound emoji (👨‍👩‍👧), or a two-symbol flag.
const EMOJI_SEQUENCE =
  "(?:\\p{Regional_Indicator}{2}|\\p{Extended_Pictographic}(?:\\p{Emoji_Modifier}|\\uFE0F)?(?:\\u200D\\p{Extended_Pictographic}(?:\\p{Emoji_Modifier}|\\uFE0F)?)*)";
const REACTION_ADD_WITH_SNIPPET = new RegExp(`^(${EMOJI_SEQUENCE})\\s+תגובה על ההודעה:\\s*«(.+)»$`, "u");
const REACTION_ADD_GENERIC = new RegExp(`^(${EMOJI_SEQUENCE})\\s+תגובה על הודעה קודמת$`, "u");
const REACTION_REMOVE_WITH_SNIPPET = /^הוסרה תגובה מההודעה:\s*«(.+)»$/u;
const REACTION_REMOVE_GENERIC = /^הוסרה תגובה מהודעה קודמת$/u;

/** @returns {boolean} */
export function isGuestReactionRow(msg) {
  if (!msg || msg.direction !== "inbound") return false;
  if (msg.intent === "guest_reaction") return true;
  return !!parseGuestReactionMessage(msg.message, msg.intent);
}

/**
 * @returns {{ kind: 'add'|'remove', emoji: string|null, snippet: string|null }|null}
 */
export function parseGuestReactionMessage(raw, intent) {
  if (!raw || typeof raw !== "string") return null;
  const text = raw.trim();
  if (!text) return null;

  let m = text.match(REACTION_ADD_WITH_SNIPPET);
  if (m) return { kind: "add", emoji: m[1], snippet: m[2] };

  m = text.match(REACTION_ADD_GENERIC);
  if (m) return { kind: "add", emoji: m[1], snippet: null };

  m = text.match(REACTION_REMOVE_WITH_SNIPPET);
  if (m) return { kind: "remove", emoji: null, snippet: m[1] };

  if (REACTION_REMOVE_GENERIC.test(text)) {
    return { kind: "remove", emoji: null, snippet: null };
  }

  // intent="guest_reaction" but none of the known templates matched (e.g. a
  // future Meta payload shape, or a row written by older webhook code).
  // FAIL VISIBLE (CLAUDE.md §0.3): return null rather than a content-free
  // stub — the caller falls back to rendering the raw stored message, which
  // is always a real, human-readable string (the webhook never writes an
  // empty inbox row for a reaction), instead of a generic "תגובה" pill that
  // hides whatever actually happened.
  return null;
}

/** Human label for compact reaction bubble (Hebrew UI). */
export function formatGuestReactionLabel(parsed) {
  if (!parsed) return "";
  if (parsed.kind === "remove") {
    return parsed.snippet
      ? `הוסרה תגובה מ־«${parsed.snippet}»`
      : "הוסרה תגובה";
  }
  if (parsed.emoji && parsed.snippet) {
    return `${parsed.emoji} תגובה ל־«${parsed.snippet}»`;
  }
  if (parsed.emoji) return parsed.emoji;
  // Defense in depth — parseGuestReactionMessage no longer produces this shape
  // (add + no emoji + no snippet) itself, but keep an honest label here in
  // case a caller ever constructs one directly. Never claim content exists.
  return "תגובת אמוג'י (פרטים חסרים)";
}

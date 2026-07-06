/**
 * Parse guest WhatsApp emoji-reaction rows logged by whatsapp-webhook (session 125+).
 * Reactions are not real text messages — compact UI only.
 */

const REACTION_ADD_WITH_SNIPPET = /^(\p{Extended_Pictographic})\s+תגובה על ההודעה:\s*«(.+)»$/u;
const REACTION_ADD_GENERIC = /^(\p{Extended_Pictographic})\s+תגובה על הודעה קודמת$/u;
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

  if (intent === "guest_reaction") {
    return { kind: "add", emoji: null, snippet: null };
  }

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
  return "תגובה";
}

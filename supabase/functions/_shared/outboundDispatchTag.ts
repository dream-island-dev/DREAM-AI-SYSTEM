// Inbox-only dispatch tags on whatsapp_conversations outbound rows.
// [META]/[SESSION]/[WHAPI] must never reach guests or LLM history.

const DISPATCH_META_PREFIX = /^\[META\]\n?/;
const DISPATCH_SESSION_PREFIX = /^\[SESSION\]\n?/;
const DISPATCH_WHAPI_PREFIX = /^\[WHAPI\]\n?/;
const INTERACTIVE_BUTTONS_SUFFIX = /\n?\[\+\s*Interactive Buttons(?::\s*([^\]]+))?\]\s*$/;

/** Strip inbox dispatch tags + interactive-button footer from a stored row. */
export function stripOutboundDispatchTag(raw: string): string {
  if (!raw || typeof raw !== "string") return raw ?? "";
  let body = raw;
  if (DISPATCH_META_PREFIX.test(body)) body = body.replace(DISPATCH_META_PREFIX, "");
  else if (DISPATCH_SESSION_PREFIX.test(body)) body = body.replace(DISPATCH_SESSION_PREFIX, "");
  else if (DISPATCH_WHAPI_PREFIX.test(body)) body = body.replace(DISPATCH_WHAPI_PREFIX, "");
  return body.replace(INTERACTIVE_BUTTONS_SUFFIX, "").trimEnd();
}

function truncateConversationLog(text: string): string {
  const t = text.trim();
  return t.length > 4000 ? `${t.slice(0, 3997)}…` : t;
}

/** Prefix [WHAPI] for whatsapp_conversations logging (Inbox channel badge). */
export function formatWhapiSuitesConversationLog(body: string): string {
  return `[WHAPI]\n${truncateConversationLog(body.trim())}`;
}

// Gmail / IMAP fetch for EZGO mail sync — preserves HTML body for Doc1 parsing.

import { ImapFlow } from "npm:imapflow@1.0.168";
import PostalMime from "npm:postal-mime@2";

export type EzgoInboundMail = {
  id: string;
  fromEmail: string;
  fromName: string | null;
  subject: string;
  receivedAt: string;
  bodyPreview: string;
  bodyText: string;
  bodyHtml: string;
};

export type EzgoImapConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
};

export type EzgoImapFetchMeta = {
  mailboxTotal: number;
  searchMethod: string;
  searchUids: number;
  scannedRaw: number;
  afterAllowlist: number;
};

export type EzgoImapFetchResult = {
  messages: EzgoInboundMail[];
  meta: EzgoImapFetchMeta;
};

/** Built-in EZGO report senders — merged with EZGO_MAIL_ALLOWLIST extras. */
export const DEFAULT_EZGO_MAIL_SENDERS = [
  "hagar.mesilati@dream-island.co.il",
  "tzalamnadlan@gmail.com",
];

export function resolveEzgoImapConfig(): EzgoImapConfig | null {
  const host = (Deno.env.get("EZGO_MAIL_IMAP_HOST") || "imap.gmail.com").trim();
  const user = (Deno.env.get("EZGO_MAIL_IMAP_USER") || "").trim();
  const password = (Deno.env.get("EZGO_MAIL_IMAP_PASSWORD") || "").trim();
  const portRaw = Number(Deno.env.get("EZGO_MAIL_IMAP_PORT") || "993");
  const port = Number.isFinite(portRaw) ? portRaw : 993;
  const secure = Deno.env.get("EZGO_MAIL_IMAP_TLS") !== "false";
  if (!host || !user || !password) return null;
  return { host, port, secure, user, password };
}

export function ezgoMailSyncEnabled(): boolean {
  return Deno.env.get("EZGO_MAIL_SYNC_ENABLED") === "true";
}

export function parseAllowlist(): string[] {
  const raw = (Deno.env.get("EZGO_MAIL_ALLOWLIST") || "").trim();
  const fromEnv = raw
    ? raw.split(/[,;]/).map((s) => s.trim().toLowerCase()).filter(Boolean)
    : [];
  return [...new Set([...DEFAULT_EZGO_MAIL_SENDERS, ...fromEnv])];
}

export function isSenderAllowed(fromEmail: string, allowlist: string[]): boolean {
  const email = (fromEmail || "").trim().toLowerCase();
  if (!email) return false;
  if (/^(no[-_.]?reply|donotreply|mailer-daemon)@/i.test(email)) return false;
  if (!allowlist.length) return false;
  return allowlist.some((a) => email === a || email.endsWith(`@${a}`));
}

function stripHtmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type ParsedMimeEmail = { html?: string; text?: string; attachments?: Array<{ mimeType?: string; content?: unknown }> };

async function parseMimeSource(source: Uint8Array | string): Promise<ParsedMimeEmail | null> {
  try {
    return await PostalMime.parse(source) as ParsedMimeEmail;
  } catch {
    return null;
  }
}

/**
 * Decode raw RFC822 source via postal-mime — handles nested multipart, quoted-printable/
 * base64, and charsets correctly. Forwards that attach the original message as a raw
 * message/rfc822 part are unwrapped recursively to reach the EZGO table.
 */
export async function extractBodiesFromSource(
  source: Uint8Array | string,
): Promise<{ text: string; html: string; preview: string }> {
  let html = "";
  let text = "";

  const email = await parseMimeSource(source);
  if (email) {
    html = email.html || "";
    text = email.text || "";

    if (!/<table[\s>]/i.test(html)) {
      for (const att of email.attachments || []) {
        if (att.mimeType !== "message/rfc822") continue;
        const raw = att.content instanceof ArrayBuffer
          ? new Uint8Array(att.content)
          : typeof att.content === "string"
            ? att.content
            : null;
        if (!raw) continue;
        const nested = await parseMimeSource(raw);
        if (nested?.html && /<table[\s>]/i.test(nested.html)) {
          html = nested.html;
          if (!text) text = nested.text || "";
          break;
        }
      }
    }
  }

  if (!html && text) {
    const inline = text.match(/<html[\s\S]*?<\/html>/i);
    if (inline && /<table[\s>]/i.test(inline[0])) html = inline[0];
  }
  if (!text && html) text = stripHtmlToText(html);

  const preview = (text || stripHtmlToText(html)).replace(/\s+/g, " ").slice(0, 500);
  return { text: text.slice(0, 12000), html: html.slice(0, 500_000), preview };
}

function buildGmailFromQuery(allowlist: string[]): string {
  return allowlist.map((s) => `from:${s}`).join(" OR ");
}

async function searchAllowlistedUids(
  client: ImapFlow,
  allowlist: string[],
  limit: number,
): Promise<{ uids: number[]; method: string }> {
  const gmailQuery = buildGmailFromQuery(allowlist);
  try {
    const found = await client.search({ gmailRaw: gmailQuery }, { uid: true });
    if (found?.length) {
      return {
        uids: [...found].sort((a, b) => b - a).slice(0, limit),
        method: "gmailRaw",
      };
    }
  } catch {
    // fall through
  }

  const uidSet = new Set<number>();
  for (const sender of allowlist) {
    try {
      const found = await client.search({ from: sender }, { uid: true });
      for (const uid of found || []) uidSet.add(uid);
    } catch {
      // continue
    }
  }
  if (uidSet.size > 0) {
    return {
      uids: [...uidSet].sort((a, b) => b - a).slice(0, limit),
      method: "from",
    };
  }

  return { uids: [], method: "sequence_scan" };
}

async function messageFromFetch(
  msg: {
    uid?: number;
    envelope?: { from?: Array<{ address?: string; name?: string }>; subject?: string; date?: Date };
    source?: Buffer | Uint8Array;
    headers?: Map<string, string> | Headers;
  },
  allowlist: string[],
): Promise<EzgoInboundMail | null> {
  const env = msg.envelope;
  const fromRaw = env?.from?.[0];
  const fromEmail = fromRaw?.address?.toLowerCase() ?? "";
  if (!fromEmail || !isSenderAllowed(fromEmail, allowlist)) return null;

  const { text, html, preview } = await extractBodiesFromSource(msg.source || new Uint8Array());
  const headers = msg.headers;
  const messageId = (headers instanceof Map
    ? headers.get("message-id")
    : headers?.get?.("message-id"))?.toString();
  const id = messageId?.replace(/^<|>$/g, "") || `uid-${msg.uid}`;

  return {
    id,
    fromEmail,
    fromName: fromRaw?.name || null,
    subject: env?.subject ?? "",
    receivedAt: env?.date?.toISOString() ?? new Date().toISOString(),
    bodyPreview: preview,
    bodyText: text,
    bodyHtml: html,
  };
}

async function fetchMessagesByUidList(
  client: ImapFlow,
  uids: number[],
  allowlist: string[],
  meta: EzgoImapFetchMeta,
): Promise<EzgoInboundMail[]> {
  const out: EzgoInboundMail[] = [];
  if (!uids.length) return out;

  const range = uids.join(",");
  for await (const msg of client.fetch(range, {
    uid: true,
    envelope: true,
    source: true,
    headers: ["message-id"],
  })) {
    meta.scannedRaw += 1;
    const parsed = await messageFromFetch(msg, allowlist);
    if (!parsed) continue;
    meta.afterAllowlist += 1;
    out.push(parsed);
  }
  return out;
}

async function fetchRecentBySequence(
  client: ImapFlow,
  allowlist: string[],
  limit: number,
  meta: EzgoImapFetchMeta,
): Promise<EzgoInboundMail[]> {
  const out: EzgoInboundMail[] = [];
  const total = client.mailbox?.exists ?? 0;
  meta.mailboxTotal = total;
  if (total === 0) return out;

  const scanCount = Math.min(total, Math.max(limit * 6, 60));
  const startSeq = Math.max(1, total - scanCount + 1);

  for await (const msg of client.fetch(`${startSeq}:*`, {
    uid: true,
    envelope: true,
    source: true,
    headers: ["message-id"],
  })) {
    meta.scannedRaw += 1;
    const parsed = await messageFromFetch(msg, allowlist);
    if (!parsed) continue;
    meta.afterAllowlist += 1;
    out.push(parsed);
    if (out.length >= limit) break;
  }

  return out;
}

export async function fetchEzgoInboxMessages(
  config: EzgoImapConfig,
  limit = 25,
  allowlist: string[] = parseAllowlist(),
): Promise<EzgoImapFetchResult> {
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.password },
    logger: false,
    emitLogs: false,
  });

  const meta: EzgoImapFetchMeta = {
    mailboxTotal: 0,
    searchMethod: "none",
    searchUids: 0,
    scannedRaw: 0,
    afterAllowlist: 0,
  };

  let messages: EzgoInboundMail[] = [];

  await client.connect();
  try {
    const mailbox = await client.mailboxOpen("INBOX");
    meta.mailboxTotal = mailbox.exists ?? 0;

    const { uids, method } = await searchAllowlistedUids(client, allowlist, limit);
    meta.searchMethod = method;
    meta.searchUids = uids.length;

    if (uids.length > 0) {
      messages = await fetchMessagesByUidList(client, uids, allowlist, meta);
    }

    // Gmail SEARCH can miss fresh forwards — always scan recent INBOX as backup.
    if (messages.length === 0) {
      meta.searchMethod = uids.length > 0 ? `${method}+sequence_scan` : "sequence_scan";
      messages = await fetchRecentBySequence(client, allowlist, limit, meta);
    }
  } finally {
    await client.logout();
  }

  messages.sort(
    (a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime(),
  );

  return { messages, meta };
}

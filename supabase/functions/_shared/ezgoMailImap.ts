// Gmail / IMAP fetch for EZGO mail sync — preserves HTML body for Doc1 parsing.

import { ImapFlow } from "npm:imapflow@1.0.168";

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

function decodeQuotedPrintable(input: string): string {
  const softBreaks = String(input).replace(/=\r?\n/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < softBreaks.length; i++) {
    if (softBreaks[i] === "=" && i + 2 < softBreaks.length) {
      const hex = softBreaks.slice(i + 1, i + 3);
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
        bytes.push(parseInt(hex, 16));
        i += 2;
        continue;
      }
    }
    bytes.push(softBreaks.charCodeAt(i) & 0xff);
  }
  try {
    return new TextDecoder("utf-8").decode(new Uint8Array(bytes));
  } catch {
    return String.fromCharCode(...bytes);
  }
}

function decodePartBody(raw: string, cte: string | undefined): string {
  const body = raw.trim();
  const enc = (cte || "").toLowerCase();
  if (enc === "quoted-printable") return decodeQuotedPrintable(body);
  if (enc === "base64") {
    try {
      const bin = atob(body.replace(/\s/g, ""));
      const arr = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      return new TextDecoder("utf-8").decode(arr);
    } catch {
      return "";
    }
  }
  return body;
}

function stripHtmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Walk all MIME text/html parts — prefer longest part that contains an EZGO table (forwards). */
export function extractBodiesFromSource(source: string): { text: string; html: string; preview: string } {
  let text = "";
  let html = "";

  const htmlPartRe =
    /Content-Type:\s*text\/html[^\n]*\n(?:[^\n]*\n)*?\n([\s\S]*?)(?=\r?\n--[^\r\n]+|\r?\nContent-Type:|\r?\n\.\r?\n|$)/gi;
  let htmlMatch: RegExpExecArray | null;
  while ((htmlMatch = htmlPartRe.exec(source)) !== null) {
    const partHeader = htmlMatch[0].slice(0, htmlMatch[0].indexOf("\n\n") + 2);
    const cte = partHeader.match(/content-transfer-encoding:\s*([^\s;]+)/i)?.[1];
    const body = decodePartBody(htmlMatch[1], cte);
    if (body && /<table[\s>]/i.test(body) && body.length > html.length) html = body;
  }

  const textPartRe =
    /Content-Type:\s*text\/plain[^\n]*\n(?:[^\n]*\n)*?\n([\s\S]*?)(?=\r?\n--[^\r\n]+|\r?\nContent-Type:|\r?\n\.\r?\n|$)/gi;
  let textMatch: RegExpExecArray | null;
  while ((textMatch = textPartRe.exec(source)) !== null) {
    const partHeader = textMatch[0].slice(0, textMatch[0].indexOf("\n\n") + 2);
    const cte = partHeader.match(/content-transfer-encoding:\s*([^\s;]+)/i)?.[1];
    const body = decodePartBody(textMatch[1], cte);
    if (body && body.length > text.length) text = body;
  }

  if (!html) {
    const inline = source.match(/<html[\s\S]*?<\/html>/i);
    if (inline && /<table[\s>]/i.test(inline[0])) html = inline[0];
  }
  if (!text && html) text = stripHtmlToText(html);
  if (!text) {
    const afterHeaders = source.split(/\r?\n\r?\n/).slice(1).join("\n\n");
    text = afterHeaders.slice(0, 12000).trim();
  }

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

function messageFromFetch(
  msg: {
    uid?: number;
    envelope?: { from?: Array<{ address?: string; name?: string }>; subject?: string; date?: Date };
    source?: Buffer | Uint8Array;
    headers?: Map<string, string> | Headers;
  },
  allowlist: string[],
): EzgoInboundMail | null {
  const env = msg.envelope;
  const fromRaw = env?.from?.[0];
  const fromEmail = fromRaw?.address?.toLowerCase() ?? "";
  if (!fromEmail || !isSenderAllowed(fromEmail, allowlist)) return null;

  const sourceStr = msg.source ? new TextDecoder().decode(msg.source) : "";
  const { text, html, preview } = extractBodiesFromSource(sourceStr);
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
    const parsed = messageFromFetch(msg, allowlist);
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
    const parsed = messageFromFetch(msg, allowlist);
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

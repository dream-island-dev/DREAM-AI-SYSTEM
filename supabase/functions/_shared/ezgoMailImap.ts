// Gmail / IMAP fetch for EZGO mail sync — preserves HTML body for Doc1 parsing.

import { ImapFlow } from "npm:imapflow@1.0.168";
import { classifyEzgoMailContent, looksLikeDoc1Html } from "./ezgoDoc1Parser.ts";

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

/** Owner inbox may forward Operations reports into promote7il as a backup path. */
export const DEFAULT_EZGO_MAIL_RELAY_ALLOWLIST = ["tzalamnadlan@gmail.com"];

export function parseAllowlist(): string[] {
  const raw = (Deno.env.get("EZGO_MAIL_ALLOWLIST") || "").trim();
  if (!raw) return [];
  return raw.split(/[,;]/).map((s) => s.trim().toLowerCase()).filter(Boolean);
}

/** Relay forwarders — only accepted when the message looks like EZGO Doc1. */
export function parseRelayAllowlist(): string[] {
  const raw = (Deno.env.get("EZGO_MAIL_RELAY_ALLOWLIST") || "").trim().toLowerCase();
  if (raw === "off" || raw === "false" || raw === "0") return [];
  if (raw) {
    return raw.split(/[,;]/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  }
  return [...DEFAULT_EZGO_MAIL_RELAY_ALLOWLIST];
}

export function isSenderAllowed(fromEmail: string, allowlist: string[]): boolean {
  const email = (fromEmail || "").trim().toLowerCase();
  if (!email) return false;
  if (/^(no[-_.]?reply|donotreply|mailer-daemon)@/i.test(email)) return false;
  if (!allowlist.length) return true;
  return allowlist.some((a) => email === a || email.endsWith(`@${a}`));
}

export function looksLikeEzgoOperationsSubject(subject: string): boolean {
  const s = String(subject || "").trim();
  return /operations/i.test(s)
    || /dream\s*island/i.test(s)
    || /הוספת\s*טיפולים/i.test(s);
}

export function looksLikeEzgoMailPayload(bodyHtml: string, bodyText: string): boolean {
  const html = String(bodyHtml || "");
  const text = String(bodyText || "");
  if (classifyEzgoMailContent(html, text).reportType !== "unknown") return true;
  return (/<table[\s>]/i.test(html) && looksLikeDoc1Html(html))
    || (text.includes("\t") && classifyEzgoMailContent("", text).reportType !== "unknown");
}

/** Primary senders (Hagar) OR trusted relay forward with EZGO-shaped content. */
export function isEzgoInboundAllowed(
  msg: { fromEmail: string; subject: string; bodyHtml: string; bodyText: string },
  senderAllowlist: string[],
  relayAllowlist: string[] = parseRelayAllowlist(),
): boolean {
  if (isSenderAllowed(msg.fromEmail, senderAllowlist)) return true;
  if (!isSenderAllowed(msg.fromEmail, relayAllowlist)) return false;
  return looksLikeEzgoOperationsSubject(msg.subject)
    && looksLikeEzgoMailPayload(msg.bodyHtml, msg.bodyText);
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

function stripHtmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function partBody(part: string): string {
  const split = part.split(/\r?\n\r?\n/);
  if (split.length < 2) return "";
  let body = split.slice(1).join("\n\n");
  body = body.replace(/\r?\n--[^\r\n]+[\s\S]*$/, "").trim();
  const cte = part.match(/content-transfer-encoding:\s*([^\s;]+)/i)?.[1]?.toLowerCase();
  if (cte === "quoted-printable") return decodeQuotedPrintable(body);
  if (cte === "base64") {
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

function extractBodiesFromSource(source: string): { text: string; html: string; preview: string } {
  let text = "";
  let html = "";

  const boundary = source.match(/boundary="?([^"\r\n;]+)"?/i)?.[1];
  const chunks = boundary
    ? source.split(new RegExp(`--${boundary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "g"))
    : [source];

  for (const part of chunks) {
    if (/content-type:\s*text\/html/i.test(part)) {
      const body = partBody(part);
      if (body && /<table[\s>]/i.test(body)) html = body;
    }
    if (/content-type:\s*text\/plain/i.test(part)) {
      const body = partBody(part);
      if (body) text = body;
    }
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

export async function fetchEzgoInboxMessages(
  config: EzgoImapConfig,
  limit = 40,
): Promise<EzgoInboundMail[]> {
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.password },
    logger: false,
    emitLogs: false,
  });

  const out: EzgoInboundMail[] = [];

  await client.connect();
  try {
    const mailbox = await client.mailboxOpen("INBOX");
    const total = mailbox.exists ?? 0;
    if (total === 0) return out;

    const startSeq = Math.max(1, total - limit + 1);
    const range = `${startSeq}:*`;

    for await (const msg of client.fetch(range, {
      uid: true,
      envelope: true,
      source: true,
      headers: ["message-id"],
    })) {
      const env = msg.envelope;
      const fromRaw = env?.from?.[0];
      const fromEmail = fromRaw?.address?.toLowerCase() ?? "";
      if (!fromEmail) continue;

      const sourceStr = msg.source ? new TextDecoder().decode(msg.source) : "";
      const { text, html, preview } = extractBodiesFromSource(sourceStr);
      const messageId = msg.headers?.get("message-id")?.toString();
      const id = messageId?.replace(/^<|>$/g, "") || `uid-${msg.uid}`;

      out.push({
        id,
        fromEmail,
        fromName: fromRaw?.name || null,
        subject: env?.subject ?? "",
        receivedAt: env?.date?.toISOString() ?? new Date().toISOString(),
        bodyPreview: preview,
        bodyText: text,
        bodyHtml: html,
      });
    }
  } finally {
    await client.logout();
  }

  return out.sort(
    (a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime(),
  );
}

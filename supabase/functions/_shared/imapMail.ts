// IMAP read-only inbox fetch for Orit CS Agent (Hosted Exchange / Matrio).

import { ImapFlow } from "npm:imapflow@1.0.168";
import type { OritMailboxRow } from "./oritAgentMail.ts";
import { stripHtmlToText } from "./oritAgentMail.ts";
import type { InboundMailMessage } from "./mailProvider.ts";

export type ImapConnectionConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
};

function extractBodyFromSource(source: string): { text: string; preview: string } {
  const htmlMatch = source.match(/Content-Type:\s*text\/html[\s\S]*?\r?\n\r?\n([\s\S]*?)(?=\r?\n--|\r?\n\.\r?\n|$)/i);
  const textMatch = source.match(/Content-Type:\s*text\/plain[\s\S]*?\r?\n\r?\n([\s\S]*?)(?=\r?\n--|\r?\n\.\r?\n|$)/i);
  let body = "";
  if (textMatch?.[1]) {
    body = textMatch[1].replace(/\r?\n/g, "\n").trim();
  } else if (htmlMatch?.[1]) {
    body = stripHtmlToText(htmlMatch[1]);
  } else {
    const afterHeaders = source.split(/\r?\n\r?\n/).slice(1).join("\n\n");
    body = afterHeaders.slice(0, 8000).trim();
  }
  const preview = body.replace(/\s+/g, " ").slice(0, 500);
  return { text: body.slice(0, 8000), preview };
}

function threadKeyFromHeaders(messageId: string | undefined, inReplyTo: string | undefined, fromEmail: string, subject: string): string {
  const root = (inReplyTo || messageId || "").trim();
  if (root) return root.replace(/^<|>$/g, "");
  const subj = (subject || "").replace(/^(re|fwd?):\s*/gi, "").trim().toLowerCase();
  return `${fromEmail}::${subj}`;
}

export function resolveImapConfig(mailbox: OritMailboxRow): ImapConnectionConfig | null {
  const host = (mailbox.imap_host || Deno.env.get("ORIT_IMAP_HOST") || "").trim();
  const user = (mailbox.imap_username || Deno.env.get("ORIT_IMAP_USER") || mailbox.owner_email || "").trim();
  const password = (mailbox.imap_password || Deno.env.get("ORIT_IMAP_PASSWORD") || "").trim();
  const portRaw = mailbox.imap_port || Number(Deno.env.get("ORIT_IMAP_PORT") || "993");
  const port = Number.isFinite(portRaw) ? portRaw : 993;
  const secure = mailbox.imap_tls !== false && Deno.env.get("ORIT_IMAP_TLS") !== "false";

  if (!host || !user || !password) return null;
  return { host, port, secure, user, password };
}

export function isImapConfigured(mailbox?: OritMailboxRow | null): boolean {
  if (mailbox) {
    const cfg = resolveImapConfig(mailbox);
    if (cfg) return true;
  }
  return Boolean(
    Deno.env.get("ORIT_IMAP_HOST") &&
      Deno.env.get("ORIT_IMAP_USER") &&
      Deno.env.get("ORIT_IMAP_PASSWORD"),
  );
}

export async function testImapConnection(config: ImapConnectionConfig): Promise<void> {
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.password },
    logger: false,
    emitLogs: false,
  });
  await client.connect();
  try {
    await client.mailboxOpen("INBOX");
  } finally {
    await client.logout();
  }
}

export async function fetchImapInboxMessages(
  config: ImapConnectionConfig,
  limit = 30,
): Promise<InboundMailMessage[]> {
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.password },
    logger: false,
    emitLogs: false,
  });

  const out: InboundMailMessage[] = [];

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
      headers: ["message-id", "in-reply-to"],
    })) {
      const env = msg.envelope;
      const fromRaw = env?.from?.[0];
      const fromEmail = fromRaw?.address?.toLowerCase() ?? "";
      if (!fromEmail) continue;

      const fromName = fromRaw?.name || null;
      const subject = env?.subject ?? "";
      const receivedAt = env?.date?.toISOString() ?? new Date().toISOString();
      const sourceStr = msg.source ? new TextDecoder().decode(msg.source) : "";
      const { text, preview } = extractBodyFromSource(sourceStr);

      const messageId = msg.headers?.get("message-id")?.toString();
      const inReplyTo = msg.headers?.get("in-reply-to")?.toString();
      const threadKey = threadKeyFromHeaders(messageId, inReplyTo, fromEmail, subject);
      const id = messageId?.replace(/^<|>$/g, "") || `uid-${msg.uid}`;

      out.push({
        id,
        threadKey,
        subject,
        fromEmail,
        fromName,
        receivedAt,
        bodyPreview: preview,
        bodyText: text,
      });
    }
  } finally {
    await client.logout();
  }

  return out.sort(
    (a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime(),
  );
}

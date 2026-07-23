// Gmail / IMAP fetch for EZGO mail sync — preserves HTML body for Doc1 parsing.

import { ImapFlow } from "npm:imapflow@1.0.168";

export type EzgoMailExcelAttachment = {
  filename: string;
  data: Uint8Array;
};

export type EzgoInboundMail = {
  id: string;
  fromEmail: string;
  fromName: string | null;
  subject: string;
  receivedAt: string;
  bodyPreview: string;
  bodyText: string;
  bodyHtml: string;
  excelAttachments: EzgoMailExcelAttachment[];
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
  mailboxName: string;
  imapUser: string;
  searchMethod: string;
  searchUids: number;
  scannedRaw: number;
  afterAllowlist: number;
  /** Already in ezgo_mail_ingest — envelope checked, source not downloaded. */
  skippedKnown: number;
  /** Full MIME bodies fetched (postal-mime). */
  downloadedSource: number;
  /** Query "kinds" that returned at least one UID (transparency — which search shape found mail). */
  reportQueriesUsed: string[];
  /** Downloaded messages classified by subject — doc1/doc2/other. */
  foundByReportType: { doc1: number; doc2: number; other: number };
};

export type EzgoImapFetchOptions = {
  /** Message-IDs already ingested — skip source download. */
  knownMessageIds?: Set<string>;
  /** Wider search window (no newer_than, larger limits). */
  fullSync?: boolean;
  /** Manual UI scan — wider supplement + auto-escalate when nothing new downloads. */
  manual?: boolean;
};

export type EzgoImapFetchResult = {
  messages: EzgoInboundMail[];
  meta: EzgoImapFetchMeta;
};

/** Default Gmail lookback for incremental sync (override via EZGO_MAIL_SEARCH_DAYS). */
export const EZGO_MAIL_SEARCH_DAYS_DEFAULT = 7;

export function resolveEzgoMailSearchDays(): number {
  const raw = Number(Deno.env.get("EZGO_MAIL_SEARCH_DAYS") || EZGO_MAIL_SEARCH_DAYS_DEFAULT);
  if (!Number.isFinite(raw) || raw <= 0) return EZGO_MAIL_SEARCH_DAYS_DEFAULT;
  return Math.min(Math.floor(raw), 30);
}

export function normalizeMessageId(raw: string | undefined | null): string {
  return String(raw || "").replace(/^<|>$/g, "").trim().toLowerCase();
}

function emptyFetchMeta(imapUser: string): EzgoImapFetchMeta {
  return {
    mailboxTotal: 0,
    mailboxName: "INBOX",
    imapUser,
    searchMethod: "none",
    searchUids: 0,
    scannedRaw: 0,
    afterAllowlist: 0,
    skippedKnown: 0,
    downloadedSource: 0,
    reportQueriesUsed: [],
    foundByReportType: { doc1: 0, doc2: 0, other: 0 },
  };
}

/** Classify a fetched message by subject only — cheap transparency counter, not the real classifier. */
function classifySubjectReportType(subject: string): "doc1" | "doc2" | "other" {
  const s = String(subject || "");
  if (/כניסות|יציאות/.test(s)) return "doc2";
  if (/Operations/i.test(s)) return "doc1";
  return "other";
}

/** Built-in EZGO report senders — merged with EZGO_MAIL_ALLOWLIST extras. */
export const DEFAULT_EZGO_MAIL_SENDERS = [
  "noreply@ezgo.co.il",
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

export function normalizeEzgoMailAddress(raw: string): string {
  return String(raw || "").trim().toLowerCase().replace(/[\u200E\u200F\u202A-\u202E]/g, "");
}

/** Extract first email from a RFC5322 address header value. */
export function extractEmailFromHeaderValue(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  const angle = s.match(/<([^>]+)>/);
  if (angle?.[1]) return normalizeEzgoMailAddress(angle[1]);
  const plain = normalizeEzgoMailAddress(s);
  return plain.includes("@") ? plain : "";
}

export function isSenderAllowed(fromEmail: string, allowlist: string[]): boolean {
  const email = normalizeEzgoMailAddress(fromEmail);
  if (!email) return false;
  if (!allowlist.length) return false;
  const normalizedAllow = allowlist.map((a) => normalizeEzgoMailAddress(a));
  const onAllowlist = normalizedAllow.some((a) => email === a || email.endsWith(`@${a}`));
  if (onAllowlist) return true;
  // Direct EZGO domain (Operations reports may use variants of noreply@).
  if (
    normalizedAllow.includes("noreply@ezgo.co.il")
    && email.endsWith("@ezgo.co.il")
  ) {
    return true;
  }
  if (/^(no[-_.]?reply|donotreply|mailer-daemon)@/i.test(email)) return false;
  return false;
}

function stripHtmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type ParsedMimeAttachment = {
  mimeType?: string;
  filename?: string;
  content?: unknown;
};

type ParsedMimeEmail = {
  html?: string;
  text?: string;
  attachments?: ParsedMimeAttachment[];
  from?: { address?: string; name?: string };
  subject?: string;
  date?: string;
  messageId?: string;
};

const IMAP_SEARCH_MAILBOXES = ["[Gmail]/All Mail", "INBOX"];
const SUPPLEMENT_MAILBOXES = ["INBOX", "[Gmail]/All Mail"];

function imapSinceDate(searchDays: number | null): Date | null {
  if (!searchDays) return null;
  const since = new Date();
  since.setDate(since.getDate() - searchDays);
  since.setHours(0, 0, 0, 0);
  return since;
}

/** Optional Gmail label to search first (e.g. a filter that auto-labels EZGO mail "EZGO") — much faster than scanning All Mail. */
export function resolveEzgoMailGmailLabel(): string | null {
  const raw = (Deno.env.get("EZGO_MAIL_GMAIL_LABEL") || "").trim();
  return raw || null;
}

async function openSearchMailbox(client: ImapFlow): Promise<string> {
  const label = resolveEzgoMailGmailLabel();
  const candidates = label
    ? [`[Gmail]/Label/${label}`, label, `[Gmail]/${label}`, ...IMAP_SEARCH_MAILBOXES]
    : IMAP_SEARCH_MAILBOXES;
  for (const name of candidates) {
    try {
      await client.mailboxOpen(name);
      return name;
    } catch {
      // try next
    }
  }
  const mailbox = await client.mailboxOpen("INBOX");
  return mailbox.path || "INBOX";
}

function attachmentToBytes(content: unknown): Uint8Array | null {
  if (content instanceof Uint8Array) return content;
  if (content instanceof ArrayBuffer) return new Uint8Array(content);
  if (typeof content === "string") {
    try {
      const bin = atob(content.replace(/\s/g, ""));
      return Uint8Array.from(bin, (c) => c.charCodeAt(0));
    } catch {
      return null;
    }
  }
  return null;
}

function isExcelAttachment(att: ParsedMimeAttachment): boolean {
  const fn = String(att.filename || "").toLowerCase();
  const mt = String(att.mimeType || "").toLowerCase();
  if (/\.xlsx?$/i.test(fn)) return true;
  return mt.includes("spreadsheet")
    || mt.includes("excel")
    || mt === "application/vnd.ms-excel"
    || mt === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    || mt === "application/octet-stream" && /\.xlsx?$/i.test(fn);
}

async function collectExcelAttachments(email: ParsedMimeEmail | null): Promise<EzgoMailExcelAttachment[]> {
  if (!email) return [];
  const out: EzgoMailExcelAttachment[] = [];

  for (const att of email.attachments || []) {
    if (att.mimeType === "message/rfc822") {
      const raw = attachmentToBytes(att.content);
      if (raw) {
        const nested = await parseMimeSource(raw);
        out.push(...await collectExcelAttachments(nested));
      }
      continue;
    }
    if (!isExcelAttachment(att)) continue;
    const data = attachmentToBytes(att.content);
    if (!data?.length) continue;
    out.push({
      filename: att.filename || "attachment.xlsx",
      data,
    });
  }
  return out;
}

type PostalMimeClass = { parse: (source: Uint8Array | string) => Promise<ParsedMimeEmail> };

let postalMimeLoader: Promise<PostalMimeClass> | null = null;

/** Lazy-load postal-mime — static npm import crashes Supabase Edge cold start (503). */
function loadPostalMime(): Promise<PostalMimeClass> {
  if (!postalMimeLoader) {
    postalMimeLoader = import("https://esm.sh/postal-mime@2.4.3").then((mod) => {
      const candidate = (mod as { default?: PostalMimeClass }).default ?? mod;
      return candidate as PostalMimeClass;
    });
  }
  return postalMimeLoader;
}

async function parseMimeSource(source: Uint8Array | string): Promise<ParsedMimeEmail | null> {
  try {
    const PostalMime = await loadPostalMime();
    return await PostalMime.parse(source);
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
): Promise<{ text: string; html: string; preview: string; excelAttachments: EzgoMailExcelAttachment[] }> {
  let html = "";
  let text = "";
  let excelAttachments: EzgoMailExcelAttachment[] = [];

  const email = await parseMimeSource(source);
  if (email) {
    html = email.html || "";
    text = email.text || "";
    excelAttachments = await collectExcelAttachments(email);

    if (!/<table[\s>]/i.test(html)) {
      for (const att of email.attachments || []) {
        if (att.mimeType !== "message/rfc822") continue;
        const raw = attachmentToBytes(att.content);
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
  return {
    text: text.slice(0, 12000),
    html: html.slice(0, 500_000),
    preview,
    excelAttachments,
  };
}

/** Parse a downloaded .eml (same postal-mime path as IMAP fetch). */
export async function parseEmlSourceToInboundMail(
  source: Uint8Array | string,
  allowlist: string[] = parseAllowlist(),
): Promise<EzgoInboundMail | null> {
  const email = await parseMimeSource(source);
  if (!email) return null;

  const fromEmail = extractEmailFromHeaderValue(email.from?.address || "");
  if (!fromEmail || !isSenderAllowed(fromEmail, allowlist)) return null;

  const { text, html, preview, excelAttachments } = await extractBodiesFromSource(source);
  const id = email.messageId?.replace(/^<|>$/g, "") || `eml-${Date.now()}`;

  return {
    id,
    fromEmail,
    fromName: email.from?.name || null,
    subject: email.subject ?? "",
    receivedAt: email.date ? new Date(email.date).toISOString() : new Date().toISOString(),
    bodyPreview: preview,
    bodyText: text,
    bodyHtml: html,
    excelAttachments,
  };
}

function buildGmailFromQuery(allowlist: string[], searchDays: number | null): string {
  const parts = allowlist.map((s) => `from:${s}`);
  if (allowlist.some((s) => s.includes("@ezgo.co.il"))) {
    parts.push("from:ezgo.co.il");
  }
  const recency = searchDays ? `newer_than:${searchDays}d ` : "";
  return `in:anywhere ${recency}(${parts.join(" OR ")})`.replace(/\s+/g, " ").trim();
}

function gmailRecencyClause(searchDays: number | null): string {
  return searchDays ? `newer_than:${searchDays}d ` : "";
}

/**
 * Dedicated report-type searches for EZGO's own domain — subject-based, so they still find
 * the daily Doc1/Doc2 report even when the generic "from:" queries above miss it in a busy
 * inbox (Gmail search relevance can drop older-looking mail from a >500-message window).
 */
export function buildEzgoReportSearchQueries(
  sender: string,
  searchDays: number | null,
): Array<{ kind: string; gmailRaw: string }> {
  if (!sender.includes("@ezgo.co.il") && sender !== "ezgo.co.il") return [];
  const recency = gmailRecencyClause(searchDays);
  const base = `in:anywhere ${recency}from:ezgo.co.il`.replace(/\s+/g, " ").trim();
  return [
    { kind: "report_subject_arrivals", gmailRaw: `${base} subject:כניסות` },
    { kind: "report_subject_departures", gmailRaw: `${base} subject:ויציאות` },
    { kind: "report_subject_operations", gmailRaw: `${base} subject:Operations` },
    { kind: "report_xlsx_attachment", gmailRaw: `${base} has:attachment filename:xlsx` },
  ];
}

async function searchUidsForSender(
  client: ImapFlow,
  sender: string,
  perSender: number,
  searchDays: number | null,
  meta?: EzgoImapFetchMeta,
): Promise<number[]> {
  const caps = Math.max(perSender, 1);
  const recency = gmailRecencyClause(searchDays);
  const queries: Array<{ kind: string; search: Record<string, unknown> }> = [
    { kind: "direct_from", search: { gmailRaw: `in:anywhere ${recency}from:${sender}`.replace(/\s+/g, " ").trim() } },
    { kind: "category_updates", search: { gmailRaw: `in:anywhere ${recency}category:updates from:${sender}`.replace(/\s+/g, " ").trim() } },
    { kind: "imap_from", search: { from: sender } },
  ];
  if (sender.includes("@ezgo.co.il")) {
    queries.unshift(
      { kind: "ezgo_domain", search: { gmailRaw: `in:anywhere ${recency}from:ezgo.co.il`.replace(/\s+/g, " ").trim() } },
      { kind: "ezgo_domain_updates", search: { gmailRaw: `in:anywhere ${recency}category:updates from:ezgo.co.il`.replace(/\s+/g, " ").trim() } },
      { kind: "ezgo_domain_promotions", search: { gmailRaw: `in:anywhere ${recency}category:promotions from:ezgo.co.il`.replace(/\s+/g, " ").trim() } },
    );
    for (const q of buildEzgoReportSearchQueries(sender, searchDays)) {
      queries.push({ kind: q.kind, search: { gmailRaw: q.gmailRaw } });
    }
  }

  const uidSet = new Set<number>();
  for (const { kind, search } of queries) {
    try {
      const found = await client.search(search, { uid: true });
      const sorted = [...(found || [])].sort((a, b) => b - a);
      if (sorted.length) meta?.reportQueriesUsed.push(kind);
      for (const uid of sorted.slice(0, caps)) uidSet.add(uid);
      if (uidSet.size >= caps) break;
    } catch {
      // try next query shape
    }
  }

  // SINCE supplement — always runs (not gated behind the cap break above). Gmail's
  // newer_than-based relevance search can miss mail that's a few days old once the
  // inbox has 500+ non-EZGO messages in that window; a raw IMAP SINCE date search
  // against this sender catches it.
  const since = imapSinceDate(searchDays);
  if (since) {
    try {
      const found = await client.search({ since, from: sender }, { uid: true });
      const sorted = [...(found || [])].sort((a, b) => b - a);
      if (sorted.length) meta?.reportQueriesUsed.push("since_supplement");
      for (const uid of sorted.slice(0, caps)) uidSet.add(uid);
    } catch {
      // ignore — supplement only
    }
  }

  return [...uidSet].sort((a, b) => b - a).slice(0, caps);
}

/** Fair quota per direct sender — avoids one inbox (e.g. forwards) starving others. */
export const EZGO_MAIL_PER_SENDER_MIN = 21;

/** Wider per-sender budget for manual UI scans / full_sync — worth the extra IMAP round-trips. */
export const EZGO_MAIL_PER_SENDER_MANUAL_CAP = 36;

async function searchAllowlistedUids(
  client: ImapFlow,
  allowlist: string[],
  limit: number,
  searchDays: number | null,
  meta?: EzgoImapFetchMeta,
  perSenderCapOverride?: number,
): Promise<{ uids: number[]; method: string }> {
  const perSender = perSenderCapOverride ?? Math.max(
    EZGO_MAIL_PER_SENDER_MIN,
    Math.ceil(limit / Math.max(allowlist.length, 1)),
  );
  const uidSet = new Set<number>();

  for (const sender of allowlist) {
    const uids = await searchUidsForSender(client, sender, perSender, searchDays, meta);
    for (const uid of uids) uidSet.add(uid);
  }

  if (uidSet.size > 0) {
    const method = searchDays
      ? `per_sender_newer_than_${searchDays}d`
      : "per_sender_anywhere";
    return {
      uids: [...uidSet].sort((a, b) => b - a),
      method,
    };
  }

  const gmailQuery = buildGmailFromQuery(allowlist, searchDays);
  try {
    const found = await client.search({ gmailRaw: gmailQuery }, { uid: true });
    if (found?.length) {
      return {
        uids: [...found].sort((a, b) => b - a).slice(0, limit),
        method: searchDays ? `gmailRaw_newer_than_${searchDays}d` : "gmailRaw",
      };
    }
  } catch {
    // fall through
  }

  return { uids: [], method: "sequence_scan" };
}

type ImapFetchMsg = {
  uid?: number;
  envelope?: {
    from?: Array<{ address?: string; name?: string }>;
    sender?: Array<{ address?: string; name?: string }>;
    subject?: string;
    date?: Date;
  };
  source?: Buffer | Uint8Array;
  headers?: Map<string, string> | Headers;
};

function resolveMessageIdFromFetch(msg: ImapFetchMsg): string {
  const headers = msg.headers;
  const messageId = (headers instanceof Map
    ? headers.get("message-id")
    : headers?.get?.("message-id"))?.toString();
  return normalizeMessageId(messageId) || `uid-${msg.uid}`;
}

function resolveAllowlistedSender(
  msg: ImapFetchMsg,
  allowlist: string[],
): { fromEmail: string; fromName: string | null } | null {
  const env = msg.envelope;
  const headers = msg.headers;
  const headerFrom = headers instanceof Map
    ? headers.get("from")
    : headers?.get?.("from");
  const headerSender = headers instanceof Map
    ? headers.get("sender")
    : headers?.get?.("sender");

  const candidates = [
    env?.from?.[0]?.address,
    env?.sender?.[0]?.address,
    extractEmailFromHeaderValue(headerSender),
    extractEmailFromHeaderValue(headerFrom),
  ].map((v) => normalizeEzgoMailAddress(String(v ?? ""))).filter(Boolean);

  for (const c of candidates) {
    if (isSenderAllowed(c, allowlist)) {
      return { fromEmail: c, fromName: env?.from?.[0]?.name || null };
    }
  }
  return null;
}

async function messageFromFetch(
  msg: ImapFetchMsg,
  allowlist: string[],
): Promise<EzgoInboundMail | null> {
  const sender = resolveAllowlistedSender(msg, allowlist);
  if (!sender) return null;

  const env = msg.envelope;
  const { text, html, preview, excelAttachments } = await extractBodiesFromSource(
    msg.source || new Uint8Array(),
  );
  const id = resolveMessageIdFromFetch(msg);

  return {
    id,
    fromEmail: sender.fromEmail,
    fromName: sender.fromName,
    subject: env?.subject ?? "",
    receivedAt: env?.date?.toISOString() ?? new Date().toISOString(),
    bodyPreview: preview,
    bodyText: text,
    bodyHtml: html,
    excelAttachments,
  };
}

async function fetchMessagesByUidList(
  client: ImapFlow,
  uids: number[],
  allowlist: string[],
  meta: EzgoImapFetchMeta,
  knownMessageIds: Set<string> = new Set(),
): Promise<EzgoInboundMail[]> {
  if (!uids.length) return [];

  const range = uids.join(",");
  const downloadUids: number[] = [];

  // Phase 1 — envelope + Message-ID only (fast dedup).
  for await (const msg of client.fetch(range, {
    uid: true,
    envelope: true,
    headers: ["message-id"],
  })) {
    meta.scannedRaw += 1;
    if (!resolveAllowlistedSender(msg, allowlist)) continue;
    meta.afterAllowlist += 1;
    const id = resolveMessageIdFromFetch(msg);
    if (knownMessageIds.has(id)) {
      meta.skippedKnown += 1;
      continue;
    }
    if (msg.uid) downloadUids.push(msg.uid);
  }

  if (!downloadUids.length) return [];

  const out: EzgoInboundMail[] = [];
  // Phase 2 — full source only for new allowlisted messages.
  for await (const msg of client.fetch(downloadUids.join(","), {
    uid: true,
    envelope: true,
    source: true,
    headers: ["message-id"],
  })) {
    meta.downloadedSource += 1;
    const parsed = await messageFromFetch(msg, allowlist);
    if (parsed) out.push(parsed);
  }
  return out;
}

/** Envelope-only scan of recent messages — finds forwarded EZGO mail Gmail SEARCH may miss. */
async function fetchRecentAllowlistedUids(
  client: ImapFlow,
  allowlist: string[],
  limit: number,
  meta: EzgoImapFetchMeta,
  knownMessageIds: Set<string>,
  scanCountCap = 28,
): Promise<number[]> {
  const total = client.mailbox?.exists ?? 0;
  if (total === 0) return [];

  const scanCount = Math.min(total, Math.max(limit * 3, scanCountCap));
  const startSeq = Math.max(1, total - scanCount + 1);
  const candidateUids: number[] = [];

  for await (const msg of client.fetch(`${startSeq}:*`, {
    uid: true,
    envelope: true,
    headers: ["message-id"],
  })) {
    meta.scannedRaw += 1;
    if (!resolveAllowlistedSender(msg, allowlist)) continue;
    meta.afterAllowlist += 1;
    const id = resolveMessageIdFromFetch(msg);
    if (knownMessageIds.has(id)) {
      meta.skippedKnown += 1;
      continue;
    }
    if (msg.uid) candidateUids.push(msg.uid);
    if (candidateUids.length >= limit) break;
  }

  return candidateUids;
}

async function fetchRecentAllowlistedUidsAcrossMailboxes(
  client: ImapFlow,
  allowlist: string[],
  limit: number,
  meta: EzgoImapFetchMeta,
  knownMessageIds: Set<string>,
  scanCountCap: number,
): Promise<number[]> {
  const uidSet = new Set<number>();
  for (const mailboxName of SUPPLEMENT_MAILBOXES) {
    try {
      await client.mailboxOpen(mailboxName);
      meta.mailboxName = mailboxName;
      meta.mailboxTotal = client.mailbox?.exists ?? 0;
      const uids = await fetchRecentAllowlistedUids(
        client,
        allowlist,
        limit,
        meta,
        knownMessageIds,
        scanCountCap,
      );
      for (const uid of uids) uidSet.add(uid);
      if (uidSet.size >= limit) break;
    } catch {
      // try next mailbox
    }
  }
  return [...uidSet].slice(0, limit);
}

type EzgoFetchPassOpts = {
  fetchLimit: number;
  searchDays: number | null;
  supplementLimit: number;
  supplementScanCap: number;
  /** Per-sender UID cap override — wider for manual scans / full_sync (EZGO_MAIL_PER_SENDER_MANUAL_CAP). */
  perSenderCap?: number;
};

async function runEzgoFetchPass(
  client: ImapFlow,
  allowlist: string[],
  knownMessageIds: Set<string>,
  meta: EzgoImapFetchMeta,
  pass: EzgoFetchPassOpts,
): Promise<{ messages: EzgoInboundMail[]; uids: number[]; method: string }> {
  await openSearchMailbox(client);
  meta.mailboxTotal = client.mailbox?.exists ?? 0;

  const downloadedBefore = meta.downloadedSource;
  const { uids, method } = await searchAllowlistedUids(
    client,
    allowlist,
    pass.fetchLimit,
    pass.searchDays,
    meta,
    pass.perSenderCap,
  );

  const messages: EzgoInboundMail[] = [];
  const seen = new Set<string>();

  if (uids.length > 0) {
    const primary = await fetchMessagesByUidList(
      client,
      uids,
      allowlist,
      meta,
      knownMessageIds,
    );
    for (const m of primary) {
      messages.push(m);
      seen.add(m.id);
    }
  }

  const supplementUids = await fetchRecentAllowlistedUidsAcrossMailboxes(
    client,
    allowlist,
    pass.supplementLimit,
    meta,
    knownMessageIds,
    pass.supplementScanCap,
  );
  const extraUids = supplementUids.filter((uid) => !uids.includes(uid));
  if (extraUids.length) {
    const supplementMsgs = await fetchMessagesByUidList(
      client,
      extraUids,
      allowlist,
      meta,
      knownMessageIds,
    );
    for (const m of supplementMsgs) {
      if (!seen.has(m.id)) {
        messages.push(m);
        seen.add(m.id);
      }
    }
  }

  if (messages.length === 0 && meta.downloadedSource === downloadedBefore) {
    const fallbackUids = await fetchRecentAllowlistedUidsAcrossMailboxes(
      client,
      allowlist,
      pass.fetchLimit,
      meta,
      knownMessageIds,
      Math.max(pass.supplementScanCap, 80),
    );
    if (fallbackUids.length) {
      const fallbackMsgs = await fetchMessagesByUidList(
        client,
        fallbackUids,
        allowlist,
        meta,
        knownMessageIds,
      );
      for (const m of fallbackMsgs) {
        if (!seen.has(m.id)) {
          messages.push(m);
          seen.add(m.id);
        }
      }
      return { messages, uids, method: `${method}+mailbox_fallback` };
    }
  }

  const suffix = supplementUids.length > 0 && method !== "sequence_scan"
    ? "+envelope_supplement"
    : "";
  return { messages, uids, method: `${method}${suffix}` };
}

/** Fetch one message by stored external_message_id (Message-ID or uid-N fallback). */
export async function fetchEzgoMessageById(
  config: EzgoImapConfig,
  externalMessageId: string,
  allowlist: string[] = parseAllowlist(),
): Promise<EzgoInboundMail | null> {
  const targetId = String(externalMessageId || "").trim();
  if (!targetId) return null;

  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.password },
    logger: false,
    emitLogs: false,
  });

  const meta = emptyFetchMeta(config.user);
  meta.searchMethod = "by_id";

  await client.connect();
  try {
    meta.mailboxName = await openSearchMailbox(client);
    meta.mailboxTotal = client.mailbox?.exists ?? 0;

    const uidMatch = /^uid-(\d+)$/i.exec(targetId);
    if (uidMatch) {
      const uid = Number(uidMatch[1]);
      const msgs = await fetchMessagesByUidList(client, [uid], allowlist, meta);
      if (msgs[0]) return msgs[0];
    }

    const idVariants = [
      targetId,
      `<${targetId.replace(/^<|>$/g, "")}>`,
      targetId.replace(/^<|>$/g, ""),
    ];
    const tried = new Set<string>();
    for (const mid of idVariants) {
      const key = mid.toLowerCase();
      if (!key || tried.has(key)) continue;
      tried.add(key);
      try {
        const found = await client.search({ header: { "message-id": mid } }, { uid: true });
        if (found?.length) {
          const msgs = await fetchMessagesByUidList(client, [found[0]], allowlist, meta);
          if (msgs[0]) return msgs[0];
        }
      } catch {
        // continue
      }
    }

    const searchDays = resolveEzgoMailSearchDays();
    const { uids } = await searchAllowlistedUids(client, allowlist, 48, searchDays);
    meta.searchUids = uids.length;
    if (uids.length) {
      const msgs = await fetchMessagesByUidList(client, uids, allowlist, meta);
      const normTarget = normalizeMessageId(targetId);
      const hit = msgs.find((m) => normalizeMessageId(m.id) === normTarget);
      if (hit) return hit;
    }

    return null;
  } finally {
    await client.logout();
  }
}

export async function fetchEzgoInboxMessages(
  config: EzgoImapConfig,
  limit = 24,
  allowlist: string[] = parseAllowlist(),
  options: EzgoImapFetchOptions = {},
): Promise<EzgoImapFetchResult> {
  const fullSync = options.fullSync === true;
  const manual = options.manual === true;
  const knownMessageIds = options.knownMessageIds ?? new Set<string>();
  const fetchLimit = fullSync || manual ? Math.max(limit, 36) : limit;
  const searchDays = fullSync ? null : resolveEzgoMailSearchDays();

  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.password },
    logger: false,
    emitLogs: false,
  });

  const meta = emptyFetchMeta(config.user);
  let messages: EzgoInboundMail[] = [];

  await client.connect();
  try {
    const pass1 = await runEzgoFetchPass(client, allowlist, knownMessageIds, meta, {
      fetchLimit,
      searchDays,
      supplementLimit: manual ? 16 : 10,
      supplementScanCap: manual ? 120 : 60,
      perSenderCap: (manual || fullSync) ? EZGO_MAIL_PER_SENDER_MANUAL_CAP : undefined,
    });
    messages = pass1.messages;
    meta.searchMethod = pass1.method;
    meta.searchUids = pass1.uids.length;

    // Escalate when Gmail found old UIDs but missed new mail (common with newer_than + busy inbox).
    const needsEscalation = messages.length === 0
      && meta.downloadedSource === 0
      && (manual || fullSync || pass1.uids.length > 0);
    if (needsEscalation) {
      const pass2 = await runEzgoFetchPass(client, allowlist, knownMessageIds, meta, {
        fetchLimit: Math.max(fetchLimit, 48),
        searchDays: null,
        supplementLimit: 20,
        supplementScanCap: 180,
        perSenderCap: EZGO_MAIL_PER_SENDER_MANUAL_CAP,
      });
      meta.searchUids = Math.max(meta.searchUids, pass2.uids.length);
      const seen = new Set(messages.map((m) => m.id));
      for (const m of pass2.messages) {
        if (!seen.has(m.id)) {
          messages.push(m);
          seen.add(m.id);
        }
      }
      if (pass2.messages.length > 0 || pass2.uids.length > pass1.uids.length) {
        meta.searchMethod = `${pass1.method}+escalated_unbounded`;
      }
    }
  } finally {
    await client.logout();
  }

  messages.sort(
    (a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime(),
  );

  meta.reportQueriesUsed = [...new Set(meta.reportQueriesUsed)];
  for (const m of messages) {
    meta.foundByReportType[classifySubjectReportType(m.subject)] += 1;
  }

  return { messages, meta };
}

// Gmail / IMAP fetch for EZGO mail sync — preserves HTML body for Doc1 parsing.

import { ImapFlow } from "npm:imapflow@1.0.168";
import { israelDayBoundsUtc, israelYmdFromInstant } from "./israelDate.ts";

export type EzgoMailCsvAttachment = {
  filename: string;
  data: Uint8Array;
};

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
  csvAttachments: EzgoMailCsvAttachment[];
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
  /**
   * Query kinds that threw (previously swallowed silently — FAIL VISIBLE per project rules).
   * A `gmailRaw`/`X-GM-RAW` query throws `MissingServerExtension` if the IMAP session doesn't
   * report the X-GM-EXT-1 capability; when that happens every Gmail-syntax query in the plan
   * fails the same way and the sync falls back entirely on the slow envelope-scan supplement.
   */
  searchErrors: string[];
  /** Downloaded messages classified by subject — doc1/doc2/other. */
  foundByReportType: { doc1: number; doc2: number; other: number };
  /** Day-scoped search filter (YYYY-MM-DD) when set. */
  searchDateYmd: string | null;
};

export type EzgoImapFetchOptions = {
  /** Message-IDs already ingested — skip source download. */
  knownMessageIds?: Set<string>;
  /** Wider search window (no newer_than, larger limits). */
  fullSync?: boolean;
  /** Manual UI scan — wider supplement + auto-escalate when nothing new downloads. */
  manual?: boolean;
  /** YYYY-MM-DD (Israel calendar) — narrow IMAP/Gmail search to one day only. */
  searchDateYmd?: string | null;
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

/**
 * Wide-but-bounded search window for full_sync and the auto-escalation retry — NOT
 * unbounded. `searchDays: null` drops the `newer_than:` clause entirely, turning every
 * gmailRaw query into a full-account-history search; against a real mailbox that is
 * slow enough by itself to blow the 55s IMAP budget, especially once multiplied across
 * several senders/domains. 45 days is still far wider than the 7-day default.
 */
export const EZGO_MAIL_FULL_SYNC_SEARCH_DAYS = 45;

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
    searchErrors: [],
    foundByReportType: { doc1: 0, doc2: 0, other: 0 },
    searchDateYmd: null,
  };
}

/** Classify a fetched message by subject / attachment hint — cheap transparency counter. */
function classifySubjectReportType(subject: string, hasCsvAttachment = false): "doc1" | "doc2" | "other" {
  const s = String(subject || "");
  if (/כניסות|יציאות/.test(s)) return "doc2";
  if (hasCsvAttachment) return "doc2";
  if (/Operations/i.test(s)) return "doc1";
  return "other";
}

/** Built-in EZGO report senders — merged with EZGO_MAIL_ALLOWLIST extras. */
export const DEFAULT_EZGO_MAIL_SENDERS = [
  "noreply@ezgo.co.il",
  "hagar.mesilati@dream-island.co.il",
  "reception@dream-island.co.il",
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

/** Cron background IMAP — opt-in only (manual UI scan still works when sync enabled). */
export function ezgoMailBackgroundSyncEnabled(): boolean {
  return Deno.env.get("EZGO_MAIL_BACKGROUND_SYNC") === "true";
}

export const EZGO_MAIL_BACKGROUND_MIN_HOURS_DEFAULT = 2;

export function resolveEzgoMailBackgroundMinHours(): number {
  const raw = Number(Deno.env.get("EZGO_MAIL_BACKGROUND_MIN_HOURS") || EZGO_MAIL_BACKGROUND_MIN_HOURS_DEFAULT);
  if (!Number.isFinite(raw) || raw <= 0) return EZGO_MAIL_BACKGROUND_MIN_HOURS_DEFAULT;
  return raw;
}

export function israelLocalHour(now: Date = new Date()): number {
  const h = Number(
    new Date(now).toLocaleString("en-US", {
      timeZone: "Asia/Jerusalem",
      hour: "numeric",
      hour12: false,
    }),
  );
  return Number.isFinite(h) ? h : 0;
}

export function isEzgoMailBusinessHours(now: Date = new Date()): boolean {
  const start = Number(Deno.env.get("EZGO_MAIL_BUSINESS_HOUR_START") || "7");
  const end = Number(Deno.env.get("EZGO_MAIL_BUSINESS_HOUR_END") || "20");
  const h = israelLocalHour(now);
  return h >= start && h < end;
}

/**
 * Gate for whatsapp-cron → ezgo-mail-sync. Manual panel invokes ezgo-mail-sync directly.
 * Requires EZGO_MAIL_SYNC_ENABLED + EZGO_MAIL_BACKGROUND_SYNC, business hours, min gap.
 */
export function shouldInvokeEzgoMailFromCron(opts?: {
  now?: Date;
  lastBackgroundRunAt?: string | null;
}): boolean {
  if (!ezgoMailSyncEnabled()) return false;
  if (!ezgoMailBackgroundSyncEnabled()) return false;
  const now = opts?.now ?? new Date();
  if (!isEzgoMailBusinessHours(now)) return false;
  const last = opts?.lastBackgroundRunAt;
  if (last) {
    const ageMs = now.getTime() - new Date(last).getTime();
    if (ageMs < resolveEzgoMailBackgroundMinHours() * 3_600_000) return false;
  }
  return true;
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
  if (
    normalizedAllow.some((a) => a.endsWith("@dream-island.co.il"))
    && email.endsWith("@dream-island.co.il")
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

/** Single-calendar-day IMAP bounds (SINCE inclusive, BEFORE exclusive) — Israel midnight. */
export function parseSearchDateYmd(ymd: string): { since: Date; before: Date } | null {
  return israelDayBoundsUtc(String(ymd || "").trim());
}

/** Gmail after:/before: clause for one calendar day (used in gmailRaw supplementary tier). */
export function gmailDateRangeClause(searchDateYmd: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(searchDateYmd || "").trim());
  if (!m) return "";
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const nextYmd = addCalendarDaysYmdIsrael(m[0], 1);
  if (!nextYmd) return "";
  const [ny, nmo, nd] = nextYmd.split("-").map(Number);
  return `after:${y}/${mo}/${d} before:${ny}/${nmo}/${nd} `;
}

function addCalendarDaysYmdIsrael(ymd: string, days: number): string | null {
  const parsed = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!parsed) return null;
  const y = Number(parsed[1]);
  const mo = Number(parsed[2]);
  const d = Number(parsed[3]);
  const utc = new Date(Date.UTC(y, mo - 1, d, 12, 0, 0));
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

function applyImapDateBounds(
  search: Record<string, unknown>,
  searchDays: number | null,
  searchDateYmd: string | null | undefined,
): void {
  if (searchDateYmd) {
    const range = parseSearchDateYmd(searchDateYmd);
    if (range) {
      search.since = range.since;
      search.before = range.before;
    }
    return;
  }
  const since = imapSinceDate(searchDays);
  if (since) search.since = since;
}

function gmailRecencyOrDateClause(
  searchDays: number | null,
  searchDateYmd: string | null | undefined,
): string {
  const dateClause = gmailDateRangeClause(searchDateYmd);
  if (dateClause) return dateClause;
  return gmailRecencyClause(searchDays);
}

/** Optional Gmail label to search first (e.g. a filter that auto-labels EZGO mail "EZGO") — much faster than scanning All Mail. */
export function resolveEzgoMailGmailLabel(): string | null {
  const raw = (Deno.env.get("EZGO_MAIL_GMAIL_LABEL") || "").trim();
  return raw || null;
}

/**
 * Mailbox candidates for the envelope-only supplement/fallback scan, label first.
 * The primary gmailRaw searches use `in:anywhere`, which Gmail treats as "search
 * everything" regardless of which mailbox is open, so a configured label doesn't
 * speed those up. This envelope scan is different — it fetches raw messages from
 * whichever mailbox is opened, so a small label mailbox here is the one place the
 * label actually cuts scan volume (label mail only, instead of all of INBOX/All Mail).
 */
export function resolveSupplementMailboxCandidates(): string[] {
  const label = resolveEzgoMailGmailLabel();
  if (!label) return SUPPLEMENT_MAILBOXES;
  return [`[Gmail]/Label/${label}`, label, `[Gmail]/${label}`, ...SUPPLEMENT_MAILBOXES];
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

function isCsvAttachment(att: ParsedMimeAttachment): boolean {
  const fn = String(att.filename || "").toLowerCase();
  const mt = String(att.mimeType || "").toLowerCase();
  if (/\.csv$/i.test(fn)) return true;
  return mt === "text/csv"
    || mt === "application/csv"
    || mt === "text/comma-separated-values"
    || (mt === "application/octet-stream" && /\.csv$/i.test(fn));
}

async function collectCsvAttachments(email: ParsedMimeEmail | null): Promise<EzgoMailCsvAttachment[]> {
  if (!email) return [];
  const out: EzgoMailCsvAttachment[] = [];

  for (const att of email.attachments || []) {
    if (att.mimeType === "message/rfc822") {
      const raw = attachmentToBytes(att.content);
      if (raw) {
        const nested = await parseMimeSource(raw);
        out.push(...await collectCsvAttachments(nested));
      }
      continue;
    }
    if (!isCsvAttachment(att)) continue;
    const data = attachmentToBytes(att.content);
    if (!data?.length) continue;
    out.push({
      filename: att.filename || "attachment.csv",
      data,
    });
  }
  return out;
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
): Promise<{
  text: string;
  html: string;
  preview: string;
  excelAttachments: EzgoMailExcelAttachment[];
  csvAttachments: EzgoMailCsvAttachment[];
}> {
  let html = "";
  let text = "";
  let excelAttachments: EzgoMailExcelAttachment[] = [];
  let csvAttachments: EzgoMailCsvAttachment[] = [];

  const email = await parseMimeSource(source);
  if (email) {
    html = email.html || "";
    text = email.text || "";
    excelAttachments = await collectExcelAttachments(email);
    csvAttachments = await collectCsvAttachments(email);

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
    csvAttachments,
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

  const { text, html, preview, excelAttachments, csvAttachments } = await extractBodiesFromSource(source);
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
    csvAttachments,
  };
}

function buildGmailFromQuery(
  allowlist: string[],
  searchDays: number | null,
  searchDateYmd: string | null = null,
): string {
  const parts = allowlist.map((s) => `from:${s}`);
  if (allowlist.some((s) => s.includes("@ezgo.co.il"))) {
    parts.push("from:ezgo.co.il");
  }
  if (allowlist.some((s) => s.includes("@dream-island.co.il"))) {
    parts.push("from:dream-island.co.il");
  }
  const recency = gmailRecencyOrDateClause(searchDays, searchDateYmd);
  return `in:anywhere ${recency}(${parts.join(" OR ")})`.replace(/\s+/g, " ").trim();
}

function gmailRecencyClause(searchDays: number | null): string {
  return searchDays ? `newer_than:${searchDays}d ` : "";
}

/**
 * Gmail-only best-effort attachment search — `has:attachment filename:X` has no native
 * IMAP equivalent, so this stays on the X-GM-RAW extension. It is now a SUPPLEMENTARY
 * tier only (see buildSenderSearchQueryPlan): the daily report is found primarily via
 * the native from+subject/since search below, which doesn't depend on this extension.
 * If the IMAP session doesn't report X-GM-EXT-1, `client.search` throws
 * `MissingServerExtension` for every gmailRaw query at once — previously that was
 * silently swallowed, which meant the ENTIRE search plan quietly produced zero results
 * and the sync fell back to the slow raw envelope scan with no visible error anywhere.
 */
export function buildEzgoReportSearchQueries(
  sender: string,
  searchDays: number | null,
  searchDateYmd: string | null = null,
): Array<{ kind: string; gmailRaw: string }> {
  if (!sender.includes("@ezgo.co.il") && sender !== "ezgo.co.il") return [];
  const recency = gmailRecencyOrDateClause(searchDays, searchDateYmd);
  const base = `in:anywhere ${recency}from:ezgo.co.il`.replace(/\s+/g, " ").trim();
  return [
    {
      kind: "report_attachment_gmailraw",
      gmailRaw: `${base} (has:attachment filename:xlsx OR has:attachment filename:csv)`,
    },
  ];
}

/** Same reasoning as buildEzgoReportSearchQueries — gmailRaw-only supplementary tier. */
export function buildDreamIslandReportSearchQueries(
  sender: string,
  searchDays: number | null,
  searchDateYmd: string | null = null,
): Array<{ kind: string; gmailRaw: string }> {
  if (!sender.includes("@dream-island.co.il") && sender !== "dream-island.co.il") return [];
  const recency = gmailRecencyOrDateClause(searchDays, searchDateYmd);
  const base = `in:anywhere ${recency}from:dream-island.co.il`.replace(/\s+/g, " ").trim();
  return [
    { kind: "dream_island_attachment_gmailraw", gmailRaw: `${base} has:attachment` },
  ];
}

/**
 * Ordered search-query plan for one sender — priority order (the loop below stops once
 * the per-sender cap fills). Native IMAP criteria (`from`/`subject`/`since`/`or`) come
 * FIRST and are extension-independent: imapflow's search-compiler maps them straight to
 * standard RFC 3501 SEARCH keys, unlike `gmailRaw` (X-GM-RAW) which requires the Gmail
 * X-GM-EXT-1 capability and throws if it's unavailable. Gmail-only attachment/category
 * queries (no native equivalent) come after, as best-effort extras — if the extension
 * ever isn't available, the native queries have already done the real work of finding
 * the report. Exported so the priority order and query shapes are unit-testable without
 * a live IMAP connection.
 */
export function buildSenderSearchQueryPlan(
  sender: string,
  searchDays: number | null,
  searchDateYmd: string | null = null,
): Array<{ kind: string; search: Record<string, unknown> }> {
  const recency = gmailRecencyOrDateClause(searchDays, searchDateYmd);
  const queries: Array<{ kind: string; search: Record<string, unknown> }> = [];

  if (sender.includes("@ezgo.co.il")) {
    const subjectSearch: Record<string, unknown> = {
      from: "ezgo.co.il",
      or: [{ subject: "כניסות" }, { subject: "ויציאות" }, { subject: "Operations" }],
    };
    applyImapDateBounds(subjectSearch, searchDays, searchDateYmd);
    queries.push({ kind: "report_subject_native", search: subjectSearch });

    const domainSearch: Record<string, unknown> = { from: "ezgo.co.il" };
    applyImapDateBounds(domainSearch, searchDays, searchDateYmd);
    queries.push({ kind: "ezgo_domain_native", search: domainSearch });

    for (const q of buildEzgoReportSearchQueries(sender, searchDays, searchDateYmd)) {
      queries.push({ kind: q.kind, search: { gmailRaw: q.gmailRaw } });
    }
    queries.push(
      {
        kind: "ezgo_domain_updates",
        search: { gmailRaw: `in:anywhere ${recency}category:updates from:ezgo.co.il`.replace(/\s+/g, " ").trim() },
      },
      {
        kind: "ezgo_domain_promotions",
        search: { gmailRaw: `in:anywhere ${recency}category:promotions from:ezgo.co.il`.replace(/\s+/g, " ").trim() },
      },
    );
  }

  if (sender.includes("@dream-island.co.il")) {
    const subjectSearch: Record<string, unknown> = {
      from: "dream-island.co.il",
      or: [{ subject: "כניסות" }, { subject: "ויציאות" }],
    };
    applyImapDateBounds(subjectSearch, searchDays, searchDateYmd);
    queries.push({ kind: "dream_island_report_subject_native", search: subjectSearch });

    const senderSearch: Record<string, unknown> = { from: sender };
    applyImapDateBounds(senderSearch, searchDays, searchDateYmd);
    queries.push({ kind: "dream_island_sender_native", search: senderSearch });

    const domainSearch: Record<string, unknown> = { from: "dream-island.co.il" };
    applyImapDateBounds(domainSearch, searchDays, searchDateYmd);
    queries.push({ kind: "dream_island_domain_native", search: domainSearch });

    for (const q of buildDreamIslandReportSearchQueries(sender, searchDays, searchDateYmd)) {
      queries.push({ kind: q.kind, search: { gmailRaw: q.gmailRaw } });
    }
  }

  const imapFrom: Record<string, unknown> = { from: sender };
  if (searchDateYmd) {
    applyImapDateBounds(imapFrom, searchDays, searchDateYmd);
    if (!sender.includes("@dream-island.co.il")) {
      queries.push({ kind: "sender_date_native", search: imapFrom });
    }
  } else {
    queries.push({ kind: "imap_from", search: imapFrom });
  }

  queries.push(
    {
      kind: "category_updates",
      search: { gmailRaw: `in:anywhere ${recency}category:updates from:${sender}`.replace(/\s+/g, " ").trim() },
    },
  );

  return queries;
}

/** Widen a sender to its domain for query grouping ("noreply@ezgo.co.il" → "ezgo.co.il"); other senders (e.g. tzalamnadlan@gmail.com) stay exact. */
export function domainOrSenderKey(sender: string): string {
  const s = String(sender || "").trim().toLowerCase();
  if (s.endsWith("@ezgo.co.il") || s === "ezgo.co.il") return "ezgo.co.il";
  if (s.endsWith("@dream-island.co.il") || s === "dream-island.co.il") return "dream-island.co.il";
  return s;
}

const COMBINED_SUBJECT_VARIANTS: Record<string, string[]> = {
  "ezgo.co.il": ["כניסות", "ויציאות", "Operations"],
  "dream-island.co.il": ["כניסות", "ויציאות"],
};

/**
 * Collapses the whole allowlist into 1-2 native IMAP queries instead of looping
 * `buildSenderSearchQueryPlan` once per sender (previously ~5-8 round trips PER sender,
 * ~20+ total for the default 4-sender allowlist — see ezgoMailImap.test.ts's
 * "each extra query is a real IMAP round trip" comment on buildEzgoReportSearchQueries).
 * With whatsapp-cron invoking ezgo-mail-sync on every 15-minute tick (unconditionally,
 * outside CRON_ENABLED — see whatsapp-cron/index.ts), that per-sender fan-out ran ~20
 * serial IMAP SEARCH round trips roughly 96 times/day even when nothing new had arrived,
 * which is what made the 55s IMAP_BUDGET_MS budget (ezgo-mail-sync/index.ts) an
 * intermittent, load-dependent trip rather than a rare one. IMAP `or` accepts an N-ary
 * array (already relied on for the 3-way subject OR in buildSenderSearchQueryPlan), so
 * every sender's criteria can be ORed together into ONE query instead of one query per
 * sender. Native `from`/`subject`/`since`/`before` keys are extension-independent (same
 * reasoning as buildSenderSearchQueryPlan) so this doesn't depend on Gmail's X-GM-RAW.
 */
export function buildCombinedAllowlistSearchPlan(
  allowlist: string[],
  searchDays: number | null,
  searchDateYmd: string | null = null,
): Array<{ kind: string; search: Record<string, unknown> }> {
  const keys = [...new Set(allowlist.map(domainOrSenderKey).filter(Boolean))];
  if (!keys.length) return [];

  const queries: Array<{ kind: string; search: Record<string, unknown> }> = [];

  // Tier 1 — subject-prioritized, ONE query per report domain (not merged across domains).
  // Each query reuses the exact `{from, or: [{subject}, ...]}` shape buildSenderSearchQueryPlan
  // already ran successfully in production — merging multiple domains into a single query
  // would require nesting that shape inside an outer `or` (or-of-or), which is a structurally
  // different, never-proven-live query shape; keeping one query per domain avoids that risk
  // entirely while still cutting round trips from one-per-SENDER to one-per-DOMAIN.
  for (const k of keys) {
    const variants = COMBINED_SUBJECT_VARIANTS[k];
    if (!variants) continue;
    const subjectSearch: Record<string, unknown> = {
      from: k,
      or: variants.map((subject) => ({ subject })),
    };
    applyImapDateBounds(subjectSearch, searchDays, searchDateYmd);
    queries.push({ kind: `combined_report_subject_native_${k}`, search: subjectSearch });
  }

  // Tier 2 — plain combined from-OR (flat, no nesting), always runs (superset safety net;
  // also the only tier for allowlist entries outside the ezgo/dream-island domains).
  const domainGroups = keys.map((k) => ({ from: k }));
  const domainSearch: Record<string, unknown> = domainGroups.length === 1
    ? domainGroups[0]
    : { or: domainGroups };
  applyImapDateBounds(domainSearch, searchDays, searchDateYmd);
  queries.push({ kind: "combined_domain_native", search: domainSearch });

  return queries;
}

/**
 * Gmail-only best-effort attachment supplement — one combined round trip covering both
 * report domains, replacing the old per-sender buildEzgoReportSearchQueries/
 * buildDreamIslandReportSearchQueries calls (2 more round trips per matching sender).
 * Same X-GM-EXT-1 caveat as buildEzgoReportSearchQueries — caller must catch/record.
 */
export function buildCombinedAttachmentGmailQuery(
  allowlist: string[],
  searchDays: number | null,
  searchDateYmd: string | null = null,
): string | null {
  const keys = [...new Set(allowlist.map(domainOrSenderKey))]
    .filter((k) => k === "ezgo.co.il" || k === "dream-island.co.il");
  if (!keys.length) return null;
  const recency = gmailRecencyOrDateClause(searchDays, searchDateYmd);
  const fromClause = keys.map((k) => `from:${k}`).join(" OR ");
  return `in:anywhere ${recency}(${fromClause}) has:attachment`.replace(/\s+/g, " ").trim();
}

/**
 * `searchUidsForSender` is exported (in addition to being called internally) so its
 * cross-sender query cache is unit-testable with a fake IMAP client — see
 * ezgoMailImap.test.ts for the case two dream-island.co.il senders share a query.
 * Kept as the fallback path behind buildCombinedAllowlistSearchPlan (see
 * searchAllowlistedUids) for the rare case the combined queries find nothing at all.
 */
export async function searchUidsForSender(
  client: ImapFlow,
  sender: string,
  perSender: number,
  searchDays: number | null,
  meta?: EzgoImapFetchMeta,
  /** Shared across senders within one searchAllowlistedUids pass — same-domain senders (e.g. two @dream-island.co.il addresses) issue byte-identical domain-wide queries otherwise, doubling round trips for zero extra recall. */
  queryCache?: Map<string, number[]>,
  searchDateYmd: string | null = null,
): Promise<number[]> {
  const caps = Math.max(perSender, 1);
  const plan = buildSenderSearchQueryPlan(sender, searchDays, searchDateYmd);

  const uidSet = new Set<number>();
  for (const { kind, search } of plan) {
    const cacheKey = JSON.stringify(search);
    try {
      let sorted: number[];
      if (queryCache?.has(cacheKey)) {
        sorted = queryCache.get(cacheKey)!;
      } else {
        const found = await client.search(search, { uid: true });
        sorted = [...(found || [])].sort((a, b) => b - a);
        queryCache?.set(cacheKey, sorted);
      }
      if (sorted.length) meta?.reportQueriesUsed.push(kind);
      for (const uid of sorted.slice(0, caps)) uidSet.add(uid);
      if (uidSet.size >= caps) break;
    } catch (e) {
      // FAIL VISIBLE — a gmailRaw query throws MissingServerExtension when X-GM-EXT-1
      // isn't available; recording it (instead of silently trying the next query shape)
      // is what lets the sync toast explain a total miss instead of looking like nothing
      // was wrong.
      meta?.searchErrors.push(`${kind}: ${(e as Error).message}`);
    }
  }

  // SINCE/BEFORE supplement — always runs (not gated behind the cap break above).
  const dateRange = searchDateYmd ? parseSearchDateYmd(searchDateYmd) : null;
  const sinceOnly = !dateRange ? imapSinceDate(searchDays) : null;
  if (dateRange || sinceOnly) {
    try {
      const sinceSearch: Record<string, unknown> = { from: sender };
      if (dateRange) {
        sinceSearch.since = dateRange.since;
        sinceSearch.before = dateRange.before;
      } else if (sinceOnly) {
        sinceSearch.since = sinceOnly;
      }
      const found = await client.search(sinceSearch, { uid: true });
      const sorted = [...(found || [])].sort((a, b) => b - a);
      if (sorted.length) meta?.reportQueriesUsed.push(dateRange ? "date_supplement" : "since_supplement");
      for (const uid of sorted.slice(0, caps)) uidSet.add(uid);
    } catch (e) {
      meta?.searchErrors.push(`${dateRange ? "date_supplement" : "since_supplement"}: ${(e as Error).message}`);
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
  searchDateYmd: string | null = null,
): Promise<{ uids: number[]; method: string }> {
  // Combined tier — 2-3 total IMAP round trips for the whole allowlist (see
  // buildCombinedAllowlistSearchPlan) instead of one pass per sender. This is the fast
  // path taken on virtually every call, cron or manual, since domain-wide date-bounded
  // queries almost always match SOMETHING once any report has ever been seen.
  const combinedUidSet = new Set<number>();
  const combinedPlan = buildCombinedAllowlistSearchPlan(allowlist, searchDays, searchDateYmd);
  for (const { kind, search } of combinedPlan) {
    try {
      const found = await client.search(search, { uid: true });
      const sorted = [...(found || [])].sort((a, b) => b - a);
      if (sorted.length) meta?.reportQueriesUsed.push(kind);
      for (const uid of sorted) combinedUidSet.add(uid);
    } catch (e) {
      meta?.searchErrors.push(`${kind}: ${(e as Error).message}`);
    }
  }
  const attachmentQuery = buildCombinedAttachmentGmailQuery(allowlist, searchDays, searchDateYmd);
  if (attachmentQuery) {
    try {
      const found = await client.search({ gmailRaw: attachmentQuery }, { uid: true });
      const sorted = [...(found || [])].sort((a, b) => b - a);
      if (sorted.length) meta?.reportQueriesUsed.push("combined_attachment_gmailraw");
      for (const uid of sorted) combinedUidSet.add(uid);
    } catch (e) {
      meta?.searchErrors.push(`combined_attachment_gmailraw: ${(e as Error).message}`);
    }
  }

  if (combinedUidSet.size > 0) {
    const method = searchDateYmd
      ? `combined_date_${searchDateYmd}`
      : searchDays
        ? `combined_newer_than_${searchDays}d`
        : "combined_anywhere";
    const cap = Math.max(limit, perSenderCapOverride ?? EZGO_MAIL_PER_SENDER_MANUAL_CAP);
    return { uids: [...combinedUidSet].sort((a, b) => b - a).slice(0, cap), method };
  }

  // Fallback — the old, more expensive per-sender loop. Only reached when the combined
  // queries above found literally nothing (e.g. a genuinely quiet day-scoped scan, or an
  // allowlist entry whose grouping the combined tier missed); kept intact as a safety net.
  const perSender = perSenderCapOverride ?? Math.max(
    EZGO_MAIL_PER_SENDER_MIN,
    Math.ceil(limit / Math.max(allowlist.length, 1)),
  );
  const uidSet = new Set<number>();
  const queryCache = new Map<string, number[]>();

  for (const sender of allowlist) {
    const uids = await searchUidsForSender(
      client, sender, perSender, searchDays, meta, queryCache, searchDateYmd,
    );
    for (const uid of uids) uidSet.add(uid);
  }

  if (uidSet.size > 0) {
    const method = searchDateYmd
      ? `per_sender_date_${searchDateYmd}`
      : searchDays
        ? `per_sender_newer_than_${searchDays}d`
        : "per_sender_anywhere";
    return {
      uids: [...uidSet].sort((a, b) => b - a),
      method,
    };
  }

  const gmailQuery = buildGmailFromQuery(allowlist, searchDays, searchDateYmd);
  try {
    const found = await client.search({ gmailRaw: gmailQuery }, { uid: true });
    if (found?.length) {
      return {
        uids: [...found].sort((a, b) => b - a).slice(0, limit),
        method: searchDays ? `gmailRaw_newer_than_${searchDays}d` : "gmailRaw",
      };
    }
  } catch (e) {
    meta?.searchErrors.push(`gmailraw_fallback: ${(e as Error).message}`);
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
  const { text, html, preview, excelAttachments, csvAttachments } = await extractBodiesFromSource(
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
    csvAttachments,
  };
}

function envelopeMatchesSearchDate(
  msg: ImapFetchMsg,
  searchDateYmd: string | null,
): boolean {
  if (!searchDateYmd) return true;
  return israelYmdFromInstant(msg.envelope?.date) === searchDateYmd;
}

/** Exported so the client.fetch() UID-mode calling convention is unit-testable — see ezgoMailImap.test.ts. */
export async function fetchMessagesByUidList(
  client: ImapFlow,
  uids: number[],
  allowlist: string[],
  meta: EzgoImapFetchMeta,
  knownMessageIds: Set<string> = new Set(),
  searchDateYmd: string | null = null,
): Promise<EzgoInboundMail[]> {
  if (!uids.length) return [];

  const range = uids.join(",");
  const downloadUids: number[] = [];

  // Phase 1 — envelope + Message-ID only (fast dedup).
  //
  // `range` here is a list of IMAP UIDs (from a UID SEARCH), not sequence numbers.
  // imapflow's fetch() only sends `UID FETCH` (vs. plain `FETCH`, which treats `range`
  // as sequence numbers) when the THIRD argument's `.uid` is true — `uid: true` inside
  // the second (query) argument only asks the server to include the UID field in the
  // response, it does not select UID mode (see imapflow lib/imap-flow.js `fetch()`,
  // which reads `options.uid`, and lib/commands/fetch.js which sends `options.uid ?
  // 'UID FETCH' : 'FETCH'`). Without this third argument, real UIDs get sent as a
  // sequence-number range; Gmail silently returns zero matches once a UID exceeds the
  // mailbox's current EXISTS count, which is every UID search result in a mailbox with
  // any history of expunges/archiving — this was the root cause of ezgo-mail-sync
  // finding SEARCH matches (searchUids > 0) but downloading nothing (scannedRaw:
  // downloadedSource: 0) for every automated cron tick.
  for await (const msg of client.fetch(range, {
    uid: true,
    envelope: true,
    headers: ["message-id"],
  }, { uid: true })) {
    meta.scannedRaw += 1;
    if (!resolveAllowlistedSender(msg, allowlist)) continue;
    meta.afterAllowlist += 1;
    if (!envelopeMatchesSearchDate(msg, searchDateYmd)) continue;
    const id = resolveMessageIdFromFetch(msg);
    if (knownMessageIds.has(id)) {
      meta.skippedKnown += 1;
      continue;
    }
    if (msg.uid) downloadUids.push(msg.uid);
  }

  if (!downloadUids.length) return [];

  const out: EzgoInboundMail[] = [];
  // Phase 2 — full source only for new allowlisted messages. Same UID-mode requirement
  // as phase 1 above.
  for await (const msg of client.fetch(downloadUids.join(","), {
    uid: true,
    envelope: true,
    source: true,
    headers: ["message-id"],
  }, { uid: true })) {
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
  searchDateYmd: string | null = null,
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
    if (!envelopeMatchesSearchDate(msg, searchDateYmd)) continue;
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
  searchDateYmd: string | null = null,
): Promise<number[]> {
  const uidSet = new Set<number>();
  for (const mailboxName of resolveSupplementMailboxCandidates()) {
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
        searchDateYmd,
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
  searchDateYmd: string | null;
  supplementLimit: number;
  supplementScanCap: number;
  /** Per-sender UID cap override — wider for manual scans / full_sync (EZGO_MAIL_PER_SENDER_MANUAL_CAP). */
  perSenderCap?: number;
  /**
   * Skip the envelope-scan supplement/fallback entirely — surgical mode. Native SEARCH
   * (per-sender query plan) is extension-independent and already covers subject/domain/
   * since; the linear mailbox scan below is a manual-only safety net for stray forwards,
   * not something an unattended cron tick should pay for every 15 minutes.
   */
  skipSupplement?: boolean;
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
    pass.searchDateYmd,
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
      pass.searchDateYmd,
    );
    for (const m of primary) {
      messages.push(m);
      seen.add(m.id);
    }
  }

  // Envelope-scan supplement/fallback — a blunt linear mailbox scan kept only as a
  // manual-trigger safety net for stray forwards the native SEARCH criteria might miss.
  // Skipped on unattended cron ticks (pass.skipSupplement=true) so the automatic sync
  // stays surgical: native per-sender SEARCH only, no full-mailbox envelope scan every
  // 15 minutes regardless of whether anything new actually arrived.
  let supplementUids: number[] = [];
  if (!pass.skipSupplement) {
    supplementUids = await fetchRecentAllowlistedUidsAcrossMailboxes(
      client,
      allowlist,
      pass.supplementLimit,
      meta,
      knownMessageIds,
      pass.supplementScanCap,
      pass.searchDateYmd,
    );
    const extraUids = supplementUids.filter((uid) => !uids.includes(uid));
    if (extraUids.length) {
      const supplementMsgs = await fetchMessagesByUidList(
        client,
        extraUids,
        allowlist,
        meta,
        knownMessageIds,
        pass.searchDateYmd,
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
        pass.searchDateYmd,
      );
      if (fallbackUids.length) {
        const fallbackMsgs = await fetchMessagesByUidList(
          client,
          fallbackUids,
          allowlist,
          meta,
          knownMessageIds,
          pass.searchDateYmd,
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

/**
 * Escalation re-runs the search at a much wider window/cap plus a full mailbox
 * envelope scan — it must stay a rare, manual-only safety net. It used to also fire
 * whenever the plain SEARCH found any UID at all (`pass1.uids.length > 0`), which is
 * true on almost every cron tick once a single report has ever been seen (old,
 * already-known UIDs keep matching the domain/subject SEARCH even when nothing new
 * arrived) — that turned a "should be rare" fallback into a 45-day rescan + wide
 * mailbox scan on ~every 15-minute cron tick, forever. Exported so the condition is
 * unit-testable without a live IMAP client.
 */
export function shouldEscalate(opts: {
  manual: boolean;
  fullSync: boolean;
  messagesFound: number;
  downloadedSource: number;
  searchDateYmd?: string | null;
  skippedKnown?: number;
  searchUids?: number;
}): boolean {
  if (opts.searchDateYmd) return false;
  if ((opts.skippedKnown ?? 0) > 0 && (opts.searchUids ?? 0) > 0) return false;
  return opts.manual
    && !opts.fullSync
    && opts.messagesFound === 0
    && opts.downloadedSource === 0;
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
  const searchDateYmd = options.searchDateYmd?.trim() || null;
  const dayScoped = !!(searchDateYmd && parseSearchDateYmd(searchDateYmd));
  const fetchLimit = dayScoped ? 16 : (fullSync || manual ? Math.max(limit, 36) : limit);
  const searchDays = fullSync
    ? EZGO_MAIL_FULL_SYNC_SEARCH_DAYS
    : (dayScoped ? null : resolveEzgoMailSearchDays());

  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.password },
    logger: false,
    emitLogs: false,
  });

  const meta = emptyFetchMeta(config.user);
  meta.searchDateYmd = dayScoped ? searchDateYmd : null;
  let messages: EzgoInboundMail[] = [];

  await client.connect();
  try {
    const pass1 = await runEzgoFetchPass(client, allowlist, knownMessageIds, meta, {
      fetchLimit,
      searchDays,
      searchDateYmd: dayScoped ? searchDateYmd : null,
      supplementLimit: dayScoped ? 10 : (manual ? 16 : 10),
      supplementScanCap: dayScoped ? 48 : (manual ? 120 : 60),
      perSenderCap: dayScoped
        ? 16
        : ((manual || fullSync) ? EZGO_MAIL_PER_SENDER_MANUAL_CAP : undefined),
      skipSupplement: !(manual || fullSync),
    });
    messages = pass1.messages;
    meta.searchMethod = pass1.method;
    meta.searchUids = pass1.uids.length;

    const needsEscalation = shouldEscalate({
      manual,
      fullSync,
      messagesFound: messages.length,
      downloadedSource: meta.downloadedSource,
      searchDateYmd: dayScoped ? searchDateYmd : null,
      skippedKnown: meta.skippedKnown,
      searchUids: pass1.uids.length,
    });
    if (needsEscalation) {
      const pass2 = await runEzgoFetchPass(client, allowlist, knownMessageIds, meta, {
        fetchLimit: Math.max(fetchLimit, 48),
        searchDays: EZGO_MAIL_FULL_SYNC_SEARCH_DAYS,
        searchDateYmd: null,
        supplementLimit: 20,
        supplementScanCap: 180,
        perSenderCap: EZGO_MAIL_PER_SENDER_MANUAL_CAP,
        skipSupplement: false,
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
        meta.searchMethod = `${pass1.method}+escalated_${EZGO_MAIL_FULL_SYNC_SEARCH_DAYS}d`;
      }
    }
  } finally {
    await client.logout();
  }

  messages.sort(
    (a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime(),
  );

  meta.reportQueriesUsed = [...new Set(meta.reportQueriesUsed)];
  meta.searchErrors = [...new Set(meta.searchErrors)].slice(0, 8);
  for (const m of messages) {
    meta.foundByReportType[classifySubjectReportType(m.subject, (m.csvAttachments?.length ?? 0) > 0)] += 1;
  }

  return { messages, meta };
}

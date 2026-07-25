import type { ImapFlow } from "npm:imapflow@1.0.168";
import {
  buildDreamIslandReportSearchQueries,
  buildEzgoReportSearchQueries,
  buildSenderSearchQueryPlan,
  DEFAULT_EZGO_MAIL_SENDERS,
  EZGO_MAIL_FULL_SYNC_SEARCH_DAYS,
  EZGO_MAIL_PER_SENDER_MANUAL_CAP,
  EZGO_MAIL_PER_SENDER_MIN,
  EZGO_MAIL_SEARCH_DAYS_DEFAULT,
  extractBodiesFromSource,
  extractEmailFromHeaderValue,
  isSenderAllowed,
  normalizeMessageId,
  parseAllowlist,
  resolveEzgoMailGmailLabel,
  resolveEzgoMailSearchDays,
  resolveSupplementMailboxCandidates,
  searchUidsForSender,
  shouldEscalate,
} from "./ezgoMailImap.ts";

const EZGO_NOREPLY = "noreply@ezgo.co.il";
const HAGAR = "hagar.mesilati@dream-island.co.il";
const RECEPTION = "reception@dream-island.co.il";
const MIKE = "tzalamnadlan@gmail.com";

Deno.test("dream-island.co.il domain allowed when reception is on allowlist", () => {
  const ok = isSenderAllowed(RECEPTION, DEFAULT_EZGO_MAIL_SENDERS);
  if (!ok) throw new Error("expected reception@dream-island.co.il");
  const other = isSenderAllowed("other@dream-island.co.il", DEFAULT_EZGO_MAIL_SENDERS);
  if (!other) throw new Error("expected @dream-island.co.il domain sender");
});

Deno.test("ezgo.co.il domain allowed when noreply is on allowlist", () => {
  const ok = isSenderAllowed("operations@ezgo.co.il", DEFAULT_EZGO_MAIL_SENDERS);
  if (!ok) throw new Error("expected @ezgo.co.il domain sender");
});

Deno.test("extractEmailFromHeaderValue parses angle-bracket address", () => {
  const email = extractEmailFromHeaderValue("EZGO Operations <noreply@ezgo.co.il>");
  if (email !== "noreply@ezgo.co.il") {
    throw new Error(`expected noreply@ezgo.co.il, got ${email}`);
  }
});

Deno.test("normalizeMessageId strips angle brackets and lowercases", () => {
  const id = normalizeMessageId("<ABC@ezgo.co.il>");
  if (id !== "abc@ezgo.co.il") {
    throw new Error(`expected abc@ezgo.co.il, got ${id}`);
  }
});

Deno.test("resolveEzgoMailSearchDays defaults to 7", () => {
  const prev = Deno.env.get("EZGO_MAIL_SEARCH_DAYS");
  try {
    Deno.env.delete("EZGO_MAIL_SEARCH_DAYS");
    if (resolveEzgoMailSearchDays() !== EZGO_MAIL_SEARCH_DAYS_DEFAULT) {
      throw new Error("expected default search days");
    }
  } finally {
    if (prev === undefined) Deno.env.delete("EZGO_MAIL_SEARCH_DAYS");
    else Deno.env.set("EZGO_MAIL_SEARCH_DAYS", prev);
  }
});

Deno.test("per-sender scan budget is at least 21 for three direct senders", () => {
  if (EZGO_MAIL_PER_SENDER_MIN < 21) {
    throw new Error(`expected per-sender min >= 21, got ${EZGO_MAIL_PER_SENDER_MIN}`);
  }
  if (DEFAULT_EZGO_MAIL_SENDERS.length < 4) {
    throw new Error("expected four primary EZGO senders");
  }
});

Deno.test("manual/full_sync per-sender cap is wider than the default min", () => {
  if (EZGO_MAIL_PER_SENDER_MANUAL_CAP < 36) {
    throw new Error(`expected manual cap >= 36, got ${EZGO_MAIL_PER_SENDER_MANUAL_CAP}`);
  }
  if (EZGO_MAIL_PER_SENDER_MANUAL_CAP <= EZGO_MAIL_PER_SENDER_MIN) {
    throw new Error("manual cap must exceed the default per-sender min");
  }
});

Deno.test("buildEzgoReportSearchQueries is attachment-only (subject search moved to native)", () => {
  const queries = buildEzgoReportSearchQueries(EZGO_NOREPLY, 7);
  const joined = queries.map((q) => q.gmailRaw).join(" | ");
  if (!queries.length) throw new Error("expected attachment queries for ezgo.co.il sender");
  if (!joined.includes("has:attachment filename:xlsx")) {
    throw new Error("expected xlsx attachment query");
  }
  if (!joined.includes("has:attachment filename:csv")) {
    throw new Error("expected csv attachment query");
  }
  if (!joined.includes("from:ezgo.co.il")) throw new Error("expected domain-scoped from clause");
  if (joined.includes("subject:")) {
    throw new Error(
      "subject search moved to buildSenderSearchQueryPlan's native from/or query — " +
        "this gmailRaw-only builder should stay attachment-only now",
    );
  }
});

Deno.test("buildEzgoReportSearchQueries merges all report clauses into a single query", () => {
  const queries = buildEzgoReportSearchQueries(EZGO_NOREPLY, 7);
  if (queries.length !== 1) {
    throw new Error(
      `expected exactly 1 combined query (each extra one is a real IMAP round trip), got ${queries.length}`,
    );
  }
});

Deno.test("buildEzgoReportSearchQueries returns nothing for non-EZGO senders", () => {
  const queries = buildEzgoReportSearchQueries(HAGAR, 7);
  if (queries.length !== 0) {
    throw new Error(`expected no report queries for non-ezgo.co.il sender, got ${queries.length}`);
  }
});

Deno.test("buildSenderSearchQueryPlan's report_subject_native query is extension-independent", () => {
  const plan = buildSenderSearchQueryPlan(EZGO_NOREPLY, 7);
  const entry = plan.find((p) => p.kind === "report_subject_native");
  if (!entry) throw new Error("expected a report_subject_native entry in the plan");
  if ("gmailRaw" in entry.search) {
    throw new Error(
      "report_subject_native must use native from/subject/since criteria, not gmailRaw — " +
        "gmailRaw (X-GM-RAW) throws if the IMAP session doesn't report X-GM-EXT-1, and that " +
        "used to silently kill the entire search plan",
    );
  }
  if (entry.search.from !== "ezgo.co.il") throw new Error("expected native from:ezgo.co.il");
  const orGroup = entry.search.or as Array<{ subject: string }> | undefined;
  const subjects = (orGroup || []).map((o) => o.subject);
  for (const expected of ["כניסות", "ויציאות", "Operations"]) {
    if (!subjects.includes(expected)) {
      throw new Error(`expected native subject OR-group to include "${expected}", got ${subjects.join(",")}`);
    }
  }
});

Deno.test("buildSenderSearchQueryPlan runs report-subject queries before the generic ezgo_domain scan", () => {
  const plan = buildSenderSearchQueryPlan(EZGO_NOREPLY, 7);
  const kinds = plan.map((p) => p.kind);
  const firstReportIdx = kinds.findIndex((k) => k.startsWith("report_"));
  const domainIdx = kinds.indexOf("ezgo_domain_native");
  if (firstReportIdx === -1) throw new Error("expected report_* queries in the plan");
  if (domainIdx === -1) throw new Error("expected ezgo_domain_native query in the plan");
  if (firstReportIdx > domainIdx) {
    throw new Error(
      "report-subject queries must run before the generic ezgo_domain scan — otherwise a busy " +
        "inbox can fill the per-sender cap before the daily report's dedicated query ever runs",
    );
  }
});

Deno.test("buildSenderSearchQueryPlan runs report+domain queries before the generic imap_from fallback", () => {
  const plan = buildSenderSearchQueryPlan(EZGO_NOREPLY, 7);
  const kinds = plan.map((p) => p.kind);
  const imapFromIdx = kinds.indexOf("imap_from");
  const priorityIdxs = kinds
    .map((k, i) => (k.startsWith("report_") || k.startsWith("ezgo_domain") ? i : -1))
    .filter((i) => i >= 0);
  if (!priorityIdxs.length) throw new Error("expected priority queries in the plan");
  if (imapFromIdx < Math.max(...priorityIdxs)) {
    throw new Error("imap_from must run after all report/domain priority queries");
  }
});

Deno.test("buildDreamIslandReportSearchQueries finds attachment mail (gmailRaw, best-effort tier)", () => {
  const queries = buildDreamIslandReportSearchQueries(RECEPTION, 7);
  const joined = queries.map((q) => q.gmailRaw).join(" | ");
  if (!joined.includes("has:attachment")) {
    throw new Error("expected an attachment query for dream-island sender");
  }
});

Deno.test("buildDreamIslandReportSearchQueries merges attachment clauses into a single query", () => {
  const queries = buildDreamIslandReportSearchQueries(RECEPTION, 7);
  if (queries.length !== 1) {
    throw new Error(`expected exactly 1 combined query, got ${queries.length}`);
  }
});

Deno.test("buildSenderSearchQueryPlan's dream_island_domain_native query is extension-independent and runs first", () => {
  const plan = buildSenderSearchQueryPlan(RECEPTION, 7);
  const kinds = plan.map((p) => p.kind);
  const nativeIdx = kinds.indexOf("dream_island_domain_native");
  const gmailRawIdx = kinds.indexOf("dream_island_attachment_gmailraw");
  const imapFromIdx = kinds.indexOf("imap_from");
  if (nativeIdx === -1) throw new Error("expected dream_island_domain_native in the plan");
  const entry = plan[nativeIdx];
  if ("gmailRaw" in entry.search) throw new Error("dream_island_domain_native must not use gmailRaw");
  if (entry.search.from !== "dream-island.co.il") throw new Error("expected native from:dream-island.co.il");
  if (nativeIdx > gmailRawIdx) throw new Error("native domain query must run before the gmailRaw attachment tier");
  if (imapFromIdx < gmailRawIdx) throw new Error("imap_from must run after the dream-island priority queries");
});

Deno.test("buildSenderSearchQueryPlan has no ezgo domain/report queries for a non-ezgo.co.il sender", () => {
  const plan = buildSenderSearchQueryPlan(HAGAR, 7);
  const kinds = plan.map((p) => p.kind);
  if (kinds.some((k) => k.startsWith("report_") || k.startsWith("ezgo_domain"))) {
    throw new Error("non-ezgo.co.il sender should not get ezgo domain/report queries");
  }
  if (!kinds.some((k) => k.startsWith("dream_island_"))) {
    throw new Error("dream-island sender should get attachment/domain queries");
  }
  if (!kinds.includes("imap_from")) {
    throw new Error("expected the generic imap_from fallback for any sender");
  }
});

Deno.test("resolveSupplementMailboxCandidates prioritizes a configured Gmail label before All Mail/INBOX", () => {
  const prev = Deno.env.get("EZGO_MAIL_GMAIL_LABEL");
  try {
    Deno.env.set("EZGO_MAIL_GMAIL_LABEL", "EZGO");
    const candidates = resolveSupplementMailboxCandidates();
    if (candidates[0] !== "[Gmail]/Label/EZGO") {
      throw new Error(`expected label mailbox first, got ${candidates[0]}`);
    }
    if (!candidates.includes("[Gmail]/All Mail") || !candidates.includes("INBOX")) {
      throw new Error("expected fallback to All Mail/INBOX still present after the label");
    }
  } finally {
    if (prev === undefined) Deno.env.delete("EZGO_MAIL_GMAIL_LABEL");
    else Deno.env.set("EZGO_MAIL_GMAIL_LABEL", prev);
  }
});

Deno.test("resolveSupplementMailboxCandidates falls back to INBOX first when no label is configured", () => {
  const prev = Deno.env.get("EZGO_MAIL_GMAIL_LABEL");
  try {
    Deno.env.delete("EZGO_MAIL_GMAIL_LABEL");
    const candidates = resolveSupplementMailboxCandidates();
    if (candidates[0] !== "INBOX") throw new Error(`expected INBOX first, got ${candidates[0]}`);
  } finally {
    if (prev === undefined) Deno.env.delete("EZGO_MAIL_GMAIL_LABEL");
    else Deno.env.set("EZGO_MAIL_GMAIL_LABEL", prev);
  }
});

Deno.test("resolveEzgoMailGmailLabel reads EZGO_MAIL_GMAIL_LABEL and defaults to null", () => {
  const prev = Deno.env.get("EZGO_MAIL_GMAIL_LABEL");
  try {
    Deno.env.delete("EZGO_MAIL_GMAIL_LABEL");
    if (resolveEzgoMailGmailLabel() !== null) throw new Error("expected null when unset");
    Deno.env.set("EZGO_MAIL_GMAIL_LABEL", "EZGO");
    if (resolveEzgoMailGmailLabel() !== "EZGO") throw new Error("expected configured label");
  } finally {
    if (prev === undefined) Deno.env.delete("EZGO_MAIL_GMAIL_LABEL");
    else Deno.env.set("EZGO_MAIL_GMAIL_LABEL", prev);
  }
});

Deno.test("default allowlist includes EZGO noreply, Hagar and tzalamnadlan", () => {
  const prev = Deno.env.get("EZGO_MAIL_ALLOWLIST");
  try {
    Deno.env.delete("EZGO_MAIL_ALLOWLIST");
    const list = parseAllowlist();
    if (!list.includes(EZGO_NOREPLY) || !list.includes(HAGAR) || !list.includes(MIKE)) {
      throw new Error(`expected all primary senders, got ${list.join(",")}`);
    }
  } finally {
    if (prev === undefined) Deno.env.delete("EZGO_MAIL_ALLOWLIST");
    else Deno.env.set("EZGO_MAIL_ALLOWLIST", prev);
  }
});

Deno.test("noreply@ezgo.co.il is allowed on primary allowlist", () => {
  const ok = isSenderAllowed(EZGO_NOREPLY, DEFAULT_EZGO_MAIL_SENDERS);
  if (!ok) throw new Error("expected EZGO noreply on primary allowlist");
});

Deno.test("generic noreply outside allowlist stays blocked", () => {
  const ok = isSenderAllowed("noreply@spam.example", DEFAULT_EZGO_MAIL_SENDERS);
  if (ok) throw new Error("expected unknown noreply to be blocked");
});

Deno.test("tzalamnadlan is a primary sender without relay gates", () => {
  const ok = isSenderAllowed(MIKE, DEFAULT_EZGO_MAIL_SENDERS);
  if (!ok) throw new Error("expected tzalamnadlan on primary allowlist");
});

Deno.test("unknown sender is blocked when allowlist is set", () => {
  const ok = isSenderAllowed("spam@example.com", DEFAULT_EZGO_MAIL_SENDERS);
  if (ok) throw new Error("expected unknown sender to be blocked");
});

Deno.test("EZGO_MAIL_FULL_SYNC_SEARCH_DAYS is wide but finite (not unbounded)", () => {
  if (!Number.isFinite(EZGO_MAIL_FULL_SYNC_SEARCH_DAYS) || EZGO_MAIL_FULL_SYNC_SEARCH_DAYS <= 0) {
    throw new Error("full-sync window must be a finite positive number of days");
  }
  if (EZGO_MAIL_FULL_SYNC_SEARCH_DAYS <= EZGO_MAIL_SEARCH_DAYS_DEFAULT) {
    throw new Error("full-sync window must be wider than the default incremental window");
  }
  if (EZGO_MAIL_FULL_SYNC_SEARCH_DAYS > 120) {
    throw new Error(
      "full-sync window should stay bounded — an unbounded (null) search is what blew the IMAP budget",
    );
  }
});

type FakeSearchHandler = (criteria: Record<string, unknown>) => number[] | "throw";

function makeFakeImapClient(handler: FakeSearchHandler) {
  const calls: Record<string, unknown>[] = [];
  const client = {
    search: (criteria: Record<string, unknown>) => {
      calls.push(criteria);
      const result = handler(criteria);
      if (result === "throw") {
        const error = new Error("Server does not support X-GM-EXT-1 extension required for X-GM-RAW");
        (error as Error & { code?: string }).code = "MissingServerExtension";
        return Promise.reject(error);
      }
      return Promise.resolve(result);
    },
  };
  return { client: client as unknown as ImapFlow, calls };
}

function emptyMetaForTest() {
  return {
    mailboxTotal: 0,
    mailboxName: "INBOX",
    imapUser: "test",
    searchMethod: "none",
    searchUids: 0,
    scannedRaw: 0,
    afterAllowlist: 0,
    skippedKnown: 0,
    downloadedSource: 0,
    reportQueriesUsed: [] as string[],
    searchErrors: [] as string[],
    foundByReportType: { doc1: 0, doc2: 0, other: 0 },
  };
}

Deno.test("searchUidsForSender reuses a shared query cache across same-domain senders", async () => {
  const searchDays = 7;
  const { client, calls } = makeFakeImapClient((criteria) => {
    if (criteria.from === "dream-island.co.il") return [111, 222];
    return [];
  });
  const cache = new Map<string, number[]>();

  const hagarUids = await searchUidsForSender(client, HAGAR, 21, searchDays, undefined, cache);
  const receptionUids = await searchUidsForSender(client, RECEPTION, 21, searchDays, undefined, cache);

  if (!hagarUids.includes(111) || !hagarUids.includes(222)) {
    throw new Error("expected the shared native domain query's UIDs for the first (hagar) sender");
  }
  if (!receptionUids.includes(111) || !receptionUids.includes(222)) {
    throw new Error("expected the cached UIDs to also apply to the second (reception) sender");
  }
  const sharedQueryCallCount = calls.filter((c) => c.from === "dream-island.co.il").length;
  if (sharedQueryCallCount !== 1) {
    throw new Error(
      `expected the identical dream-island native domain query to hit the IMAP client only once ` +
        `across both senders (cache reuse), but it was called ${sharedQueryCallCount} times`,
    );
  }
});

Deno.test("searchUidsForSender still finds the report via native queries when every gmailRaw query throws", async () => {
  // Simulates the IMAP session not reporting X-GM-EXT-1 — every gmailRaw (X-GM-RAW) query
  // throws MissingServerExtension. Before this fix that error was silently swallowed and the
  // ENTIRE search plan produced zero UIDs; native from/subject/since queries must not depend
  // on this extension at all, so they should still find the report.
  const searchDays = 7;
  const { client } = makeFakeImapClient((criteria) => {
    if ("gmailRaw" in criteria) return "throw";
    if (criteria.from === "ezgo.co.il" && Array.isArray(criteria.or)) return [999];
    return [];
  });
  const meta = emptyMetaForTest();

  const uids = await searchUidsForSender(client, EZGO_NOREPLY, 21, searchDays, meta);

  if (!uids.includes(999)) {
    throw new Error("expected the native report_subject_native query to still find the report UID");
  }
  if (!meta.reportQueriesUsed.includes("report_subject_native")) {
    throw new Error("expected report_subject_native to be recorded as a successful query");
  }
});

Deno.test("searchUidsForSender records gmailRaw failures into meta.searchErrors instead of swallowing them", async () => {
  const searchDays = 7;
  const { client } = makeFakeImapClient((criteria) => {
    if ("gmailRaw" in criteria) return "throw";
    return [];
  });
  const meta = emptyMetaForTest();

  await searchUidsForSender(client, EZGO_NOREPLY, 21, searchDays, meta);

  if (!meta.searchErrors.length) {
    throw new Error(
      "expected at least one gmailRaw query failure to be recorded in meta.searchErrors — " +
        "silently swallowing every search error is what made past sync failures invisible",
    );
  }
  if (!meta.searchErrors.some((e) => e.includes("MissingServerExtension") || e.includes("X-GM-EXT-1"))) {
    throw new Error(`expected a recognizable X-GM-EXT-1 error message, got: ${meta.searchErrors.join(" | ")}`);
  }
});

Deno.test("extractBodiesFromSource picks nested forward HTML with EZGO table (base64)", async () => {
  const mime = [
    "Content-Type: multipart/alternative; boundary=abc",
    "",
    "--abc",
    "Content-Type: text/plain",
    "",
    "forward wrapper",
    "--abc",
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    btoa('<html><body><div class="gmail_quote"><table><tr><td>276034:</td></tr></table></div></body></html>'),
    "--abc--",
  ].join("\r\n");
  const { html } = await extractBodiesFromSource(mime);
  if (!html.includes("276034")) {
    throw new Error("expected EZGO table html from forwarded mime");
  }
});

Deno.test("shouldEscalate never fires on an unattended cron tick (manual=false), even with old UIDs found", () => {
  // Regression guard: escalation used to also fire on `pass1.uids.length > 0`, which is
  // true on virtually every cron tick once any report has ever been seen (old, already-
  // known UIDs keep matching the domain/subject SEARCH). That turned a rare safety net
  // into a 45-day rescan + wide mailbox scan on ~every 15-minute cron tick, forever.
  const fires = shouldEscalate({
    manual: false,
    fullSync: false,
    messagesFound: 0,
    downloadedSource: 0,
  });
  if (fires) throw new Error("cron ticks (manual=false) must never trigger escalation");
});

Deno.test("shouldEscalate fires only for a genuine manual total-miss", () => {
  const fires = shouldEscalate({
    manual: true,
    fullSync: false,
    messagesFound: 0,
    downloadedSource: 0,
  });
  if (!fires) throw new Error("expected escalation on a manual scan that found nothing at all");
});

Deno.test("shouldEscalate does not fire when full_sync already ran the wide window", () => {
  const fires = shouldEscalate({
    manual: true,
    fullSync: true,
    messagesFound: 0,
    downloadedSource: 0,
  });
  if (fires) throw new Error("full_sync already searched at the wide window — escalation would just repeat it");
});

Deno.test("shouldEscalate does not fire once anything was actually downloaded", () => {
  const fires = shouldEscalate({
    manual: true,
    fullSync: false,
    messagesFound: 0,
    downloadedSource: 3,
  });
  if (fires) throw new Error("expected no escalation once new messages were already downloaded");
});

Deno.test("extractBodiesFromSource picks nested forward HTML with EZGO table (quoted-printable)", async () => {
  const mime = [
    "Content-Type: multipart/alternative; boundary=abc",
    "",
    "--abc",
    "Content-Type: text/plain",
    "",
    "forward wrapper",
    "--abc",
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: quoted-printable",
    "",
    '<html><body><div class=3D"gmail_quote"><table><tr><td>276034:</td></tr=',
    "></table></div></body></html>",
    "--abc--",
  ].join("\r\n");
  const { html } = await extractBodiesFromSource(mime);
  if (!html.includes("276034")) {
    throw new Error("expected EZGO table html from quoted-printable forwarded mime");
  }
});

import {
  buildEzgoReportSearchQueries,
  DEFAULT_EZGO_MAIL_SENDERS,
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
} from "./ezgoMailImap.ts";

const EZGO_NOREPLY = "noreply@ezgo.co.il";
const HAGAR = "hagar.mesilati@dream-island.co.il";
const MIKE = "tzalamnadlan@gmail.com";

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
  if (DEFAULT_EZGO_MAIL_SENDERS.length < 3) {
    throw new Error("expected three primary EZGO senders");
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

Deno.test("buildEzgoReportSearchQueries returns subject-based queries for ezgo.co.il senders", () => {
  const queries = buildEzgoReportSearchQueries(EZGO_NOREPLY, 7);
  const joined = queries.map((q) => q.gmailRaw).join(" | ");
  if (!queries.length) throw new Error("expected report-type queries for ezgo.co.il sender");
  if (!joined.includes("subject:כניסות")) throw new Error("expected arrivals subject query");
  if (!joined.includes("subject:ויציאות")) throw new Error("expected departures subject query");
  if (!/subject:Operations/i.test(joined)) throw new Error("expected Operations subject query");
  if (!joined.includes("has:attachment filename:xlsx")) {
    throw new Error("expected xlsx attachment query");
  }
  if (!joined.includes("from:ezgo.co.il")) throw new Error("expected domain-scoped from clause");
});

Deno.test("buildEzgoReportSearchQueries returns nothing for non-EZGO senders", () => {
  const queries = buildEzgoReportSearchQueries(HAGAR, 7);
  if (queries.length !== 0) {
    throw new Error(`expected no report queries for non-ezgo.co.il sender, got ${queries.length}`);
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

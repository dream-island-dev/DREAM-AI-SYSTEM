import {
  DEFAULT_EZGO_MAIL_SENDERS,
  extractBodiesFromSource,
  isSenderAllowed,
  parseAllowlist,
} from "./ezgoMailImap.ts";

const EZGO_NOREPLY = "noreply@ezgo.co.il";
const HAGAR = "hagar.mesilati@dream-island.co.il";
const MIKE = "tzalamnadlan@gmail.com";

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

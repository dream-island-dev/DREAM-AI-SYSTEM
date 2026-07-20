import {
  isEzgoInboundAllowed,
  looksLikeEzgoOperationsSubject,
} from "./ezgoMailImap.ts";

const HAGAR = "hagar.mesilati@dream-island.co.il";
const MIKE = "tzalamnadlan@gmail.com";
const SAMPLE_HTML = "<html><table><tr><td><div>276034: guest</div></td></tr></table></html>";

Deno.test("relay forward from owner is allowed when payload looks like Doc1", () => {
  const ok = isEzgoInboundAllowed(
    {
      fromEmail: MIKE,
      subject: "Fwd: Dream Island - Spa & Health Resort | Operations",
      bodyHtml: SAMPLE_HTML,
      bodyText: "",
    },
    [HAGAR],
    [MIKE],
  );
  if (!ok) throw new Error("expected relay forward to be allowed");
});

Deno.test("relay forward is blocked for unrelated mail", () => {
  const ok = isEzgoInboundAllowed(
    {
      fromEmail: MIKE,
      subject: "שלום",
      bodyHtml: "<html><body>hi</body></html>",
      bodyText: "hi",
    },
    [HAGAR],
    [MIKE],
  );
  if (ok) throw new Error("expected unrelated forward to be blocked");
});

Deno.test("operations subject heuristic", () => {
  if (!looksLikeEzgoOperationsSubject("Fwd: Dream Island | Operations")) {
    throw new Error("expected operations subject match");
  }
});

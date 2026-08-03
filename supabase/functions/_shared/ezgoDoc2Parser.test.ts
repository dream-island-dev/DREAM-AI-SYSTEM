import {
  assertEquals,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  looksLikeDoc2Html,
  parseClientCell,
  parseHtmlArrivalsReport,
} from "./ezgoDoc2Parser.ts";
import { classifyEzgoMailContent } from "./ezgoDoc1Parser.ts";
import { classifyDoc2MailWorkflow } from "./ezgoDoc2MailLineWorkflow.ts";

const SAMPLE_ROW_HTML = `
<table><tr><td>כניסה</td><td>21/07/2026</td></tr>
<tr><td>..</td><td>מס. הזמנה</td><td>סוג יחידה - חדר</td><td>בסיס אירוח</td><td>שעה</td><td>לילות</td><td>מב-ילד-ת</td><td>לקוח</td><td>סכום</td><td>הערות</td></tr>
<tr><td>&nbsp;</td><td>280877</td><td>סוויטת אמטיסט - 8</td><td>HB</td><td>&nbsp;</td><td>1</td><td>2</td><td>רחל אופיר , 0545421426</td><td>2,550₪</td><td></td></tr>
</table>`;

Deno.test("looksLikeDoc2Html detects arrivals table", () => {
  assertEquals(looksLikeDoc2Html(SAMPLE_ROW_HTML), true);
});

Deno.test("parseClientCell splits name and phone", () => {
  const r = parseClientCell("רחל אופיר , 0545421426");
  assertEquals(r.guest_name, "רחל אופיר");
  assertEquals(r.phone, "+972545421426");
});

Deno.test("parseHtmlArrivalsReport extracts suite row", () => {
  const rows = parseHtmlArrivalsReport(SAMPLE_ROW_HTML);
  assertEquals(rows.length, 1);
  assertEquals(rows[0].order_number, "280877");
  assertEquals(rows[0].room, "אמטיסט 8");
  assertEquals(rows[0].guest_name, "רחל אופיר");
  assertEquals(rows[0].meal_location, "חצי פנסיון");
  assertEquals(rows[0].arrival_date, "2026-07-21");
  assertEquals(rows[0].departure_date, "2026-07-22");
});

const GROUP_COORD_HTML = `
<table><tr><td>כניסה</td><td>03/08/2026</td></tr>
<tr><td>..</td><td>מס. הזמנה</td><td>סוג יחידה - חדר</td><td>בסיס אירוח</td><td>שעה</td><td>לילות</td><td>מב-ילד-ת</td><td>לקוח</td><td>סכום</td><td>הערות</td></tr>
<tr><td></td><td>262984</td><td>סוויטת ג'ספר - 1</td><td>HB</td><td></td><td>2</td><td>1</td><td>בנק לאומי ועד תיכון-ארז זלקטה , 0502005820</td><td>3,680₪</td><td>אורטל בנטורה 050-3302020 - א. ערב 20:00 - בעלה חוגג 40</td></tr>
<tr><td></td><td>262984</td><td>סוויטת ג'ספר - 2</td><td>HB</td><td></td><td>2</td><td>1</td><td>בנק לאומי ועד תיכון-ארז זלקטה , 0502005820</td><td>2,440₪</td><td>אנגלמן אמיר 054-7902278 - א. ערב 19:30</td></tr>
</table>`;

Deno.test("parseHtmlArrivalsReport: duplicate coordinator → occupant from הערות", () => {
  const rows = parseHtmlArrivalsReport(GROUP_COORD_HTML);
  assertEquals(rows.length, 2);
  assertEquals(rows[0].guest_name, "אורטל בנטורה");
  assertEquals(rows[0].phone, "+972503302020");
  assertEquals(rows[0].order_number, "262984");
  assertEquals(rows[1].guest_name, "אנגלמן אמיר");
  assertEquals(rows[1].phone, "+972547902278");
  assertEquals(rows[1].order_number, "262984");
});

Deno.test("parseHtmlArrivalsReport: solo row ignores remark occupant", () => {
  const html = `
<table><tr><td>כניסה</td><td>03/08/2026</td></tr>
<tr><td>..</td><td>מס. הזמנה</td><td>סוג יחידה - חדר</td><td>בסיס אירוח</td><td>שעה</td><td>לילות</td><td>מב-ילד-ת</td><td>לקוח</td><td>סכום</td><td>הערות</td></tr>
<tr><td></td><td>300310</td><td>סוויטת אמטיסט - 8</td><td>HB</td><td></td><td>1</td><td>2</td><td>שמרית אדרי , 0521234567</td><td>2,550₪</td><td>חוגגים יום הולדת לפנק</td></tr>
</table>`;
  const rows = parseHtmlArrivalsReport(html);
  assertEquals(rows.length, 1);
  assertEquals(rows[0].guest_name, "שמרית אדרי");
  assertEquals(rows[0].phone, "+972521234567");
});

Deno.test("fixture EML (דוח כניסות ויציאות 2026-07-25) → doc2_html, >=14 rows, room-less row creates", async () => {
  const { readFileSync } = await import("node:fs");
  const postalMimeMod = await import("https://esm.sh/postal-mime@2.4.3");
  const PostalMime = (postalMimeMod as { default?: { parse: (s: Uint8Array) => Promise<{ html?: string; text?: string }> } })
    .default ?? postalMimeMod;

  const raw = readFileSync(
    new URL("../../../scripts/fixtures/ezgo-doc2-arrivals-2026-07-25.eml", import.meta.url),
  );
  const email = await (PostalMime as { parse: (s: Uint8Array) => Promise<{ html?: string; text?: string }> })
    .parse(raw);

  const classified = classifyEzgoMailContent(email.html ?? "", email.text ?? "");
  assertEquals(classified.reportType, "doc2_html");

  const rows = parseHtmlArrivalsReport(classified.html ?? "");
  if (rows.length < 14) {
    throw new Error(`expected >=14 rows, got ${rows.length}`);
  }

  const noRoomRow = rows.find((r) => !r.room);
  if (!noRoomRow) throw new Error("expected at least one room-less row in fixture");

  const wf = classifyDoc2MailWorkflow(noRoomRow, null);
  if (wf.workflow !== "suite_arrival_create") {
    throw new Error(`expected suite_arrival_create for room-less row, got ${wf.workflow}`);
  }
});

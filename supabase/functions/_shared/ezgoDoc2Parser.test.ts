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

Deno.test("parseHtmlArrivalsReport: group occupants → automation_scope=muted, meal_time extracted — P0 2026-08-05", () => {
  const rows = parseHtmlArrivalsReport(GROUP_COORD_HTML);
  assertEquals(rows[0].automation_scope, "muted");
  assertEquals(rows[0].automation_muted, true);
  assertEquals(rows[0].is_remark_group_occupant, true);
  assertEquals(rows[0].meal_time, "20:00");
  assertEquals(rows[1].meal_time, "19:30");
});

Deno.test("parseHtmlArrivalsReport: solo row → automation_scope=full, not muted", () => {
  const rows = parseHtmlArrivalsReport(SAMPLE_ROW_HTML);
  assertEquals(rows[0].automation_scope, "full");
  assertEquals(rows[0].automation_muted, false);
  assertEquals(rows[0].is_remark_group_occupant, false);
});

const MUNICIPAL_GROUP_3ROW_HTML = `
<table><tr><td>כניסה</td><td>04/08/2026</td></tr>
<tr><td>..</td><td>מס. הזמנה</td><td>סוג יחידה - חדר</td><td>בסיס אירוח</td><td>שעה</td><td>לילות</td><td>מב-ילד-ת</td><td>לקוח</td><td>סכום</td><td>הערות</td></tr>
<tr><td></td><td>301111</td><td>סוויטת ג'ספר - 1</td><td>HB</td><td></td><td>1</td><td>2</td><td>עיריית תל אביב , 0501112222</td><td>2,000₪</td><td>דנה לוי 050-1112222 - א. ערב 19:00</td></tr>
<tr><td></td><td>301111</td><td>סוויטת ג'ספר - 2</td><td>HB</td><td></td><td>1</td><td>2</td><td>עיריית תל אביב , 0501112222</td><td>2,000₪</td><td>יוסי כהן 052-3334444 - א. ערב 19:30</td></tr>
<tr><td></td><td>301111</td><td>סוויטת ג'ספר - 3</td><td>HB</td><td></td><td>1</td><td>2</td><td>עיריית תל אביב , 0501112222</td><td>2,000₪</td><td>רונית עמר 054-5556666 - א. ערב 20:00</td></tr>
</table>`;

Deno.test("parseHtmlArrivalsReport: municipal 3-row group → 3 profiles, all automation_scope=muted — P0 2026-08-05", () => {
  const rows = parseHtmlArrivalsReport(MUNICIPAL_GROUP_3ROW_HTML);
  assertEquals(rows.length, 3);
  assertEquals(rows.map((r) => r.guest_name), ["דנה לוי", "יוסי כהן", "רונית עמר"]);
  assertEquals(rows.map((r) => r.phone), ["+972501112222", "+972523334444", "+972545556666"]);
  assertEquals(rows.every((r) => r.automation_scope === "muted"), true);
  assertEquals(rows.every((r) => r.automation_muted === true), true);
  assertEquals(rows.every((r) => r.is_remark_group_occupant === true), true);
  assertEquals(rows.map((r) => r.room), ["ג׳ספר 1", "ג׳ספר 2", "ג׳ספר 3"]);
});

const COORD_ILYA_GROUP_HTML = `
<table><tr><td>כניסה</td><td>07/08/2026</td></tr>
<tr><td>..</td><td>מס. הזמנה</td><td>סוג יחידה - חדר</td><td>בסיס אירוח</td><td>שעה</td><td>לילות</td><td>מב-ילד-ת</td><td>לקוח</td><td>סכום</td><td>הערות</td></tr>
<tr><td></td><td>301222</td><td>סוויטת אוניקס - 12</td><td>HB</td><td></td><td>1</td><td>2</td><td>ישראל ישראלי , 0500000000</td><td>2,000₪</td><td>דוד כהן 052-1111111</td></tr>
<tr><td></td><td>301222</td><td>סוויטת אוניקס - 7</td><td>HB</td><td></td><td>1</td><td>2</td><td>ישראל ישראלי , 0500000000</td><td>2,000₪</td><td>משה לוי 052-2222222</td></tr>
</table>`;

Deno.test("parseHtmlArrivalsReport: coordinator איליה → separate occupants from הערות — P0 2026-08-05", () => {
  const rows = parseHtmlArrivalsReport(COORD_ILYA_GROUP_HTML);
  assertEquals(rows.length, 2);
  assertEquals(rows[0].guest_name, "דוד כהן");
  assertEquals(rows[0].phone, "+972521111111");
  assertEquals(rows[0].room, "אוניקס 12");
  assertEquals(rows[1].guest_name, "משה לוי");
  assertEquals(rows[1].phone, "+972522222222");
  assertEquals(rows[1].room, "אוניקס 7");
  assertEquals(rows.every((r) => r.is_remark_group_occupant === true), true);
  assertEquals(rows[0].coord_name, "ישראל ישראלי");
});

const SUITE_WITH_DAYPASS_SUFFIX_HTML = `
<table><tr><td>כניסה</td><td>04/08/2026</td></tr>
<tr><td>..</td><td>מס. הזמנה</td><td>סוג יחידה - חדר</td><td>בסיס אירוח</td><td>שעה</td><td>לילות</td><td>מב-ילד-ת</td><td>לקוח</td><td>סכום</td><td>הערות</td></tr>
<tr><td></td><td>301999</td><td>אמטיסט 11 - בילוי יומי</td><td>BB</td><td></td><td>1</td><td>2</td><td>רותם שגיא , 0521234567</td><td>1,500₪</td><td></td></tr>
</table>`;

Deno.test("parseHtmlArrivalsReport: 'אמטיסט 11 - בילוי יומי' → suite room, is_day_guest=false, NOT daypass — P0 2026-08-05", () => {
  const rows = parseHtmlArrivalsReport(SUITE_WITH_DAYPASS_SUFFIX_HTML);
  assertEquals(rows.length, 1);
  assertEquals(rows[0].room, "אמטיסט 11");
  assertEquals(rows[0].is_day_guest, false);
  assertEquals(rows[0].is_premium_day, false);
});

const MUNICIPAL_SOLO_HTML = `
<table><tr><td>כניסה</td><td>03/08/2026</td></tr>
<tr><td>..</td><td>מס. הזמנה</td><td>סוג יחידה - חדר</td><td>בסיס אירוח</td><td>שעה</td><td>לילות</td><td>מב-ילד-ת</td><td>לקוח</td><td>סכום</td><td>הערות</td></tr>
<tr><td></td><td>270111</td><td>סוויטת רובי - 14</td><td>HB</td><td></td><td>1</td><td>2</td><td>עיריית תל אביב , 0501112222</td><td>2,000₪</td><td></td></tr>
</table>`;

Deno.test("parseHtmlArrivalsReport: single-row municipal coordinator (no remark occupant) → automation_scope=muted", () => {
  const rows = parseHtmlArrivalsReport(MUNICIPAL_SOLO_HTML);
  assertEquals(rows.length, 1);
  assertEquals(rows[0].is_remark_group_occupant, false);
  assertEquals(rows[0].automation_scope, "muted");
  assertEquals(rows[0].room, "רובי 14");
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

const SUITE_MISSING_NIGHTS_HTML = `
<table><tr><td>כניסה</td><td>05/08/2026</td></tr>
<tr><td>..</td><td>מס. הזמנה</td><td>סוג יחידה - חדר</td><td>בסיס אירוח</td><td>שעה</td><td>לילות</td><td>מב-ילד-ת</td><td>לקוח</td><td>סכום</td><td>הערות</td></tr>
<tr><td></td><td>290001</td><td>סוויטת רובי - 13</td><td>HB</td><td></td><td>..</td><td>2</td><td>דנה כהן , 0501234567</td><td>2,000₪</td><td></td></tr>
</table>`;

Deno.test("parseHtmlArrivalsReport: suite row with missing nights → departure_date null + departure_missing_nights flag, NOT same-day — P0 2026-08-05", () => {
  const rows = parseHtmlArrivalsReport(SUITE_MISSING_NIGHTS_HTML);
  assertEquals(rows.length, 1);
  assertEquals(rows[0].nights, null);
  assertEquals(rows[0].arrival_date, "2026-08-05");
  assertEquals(rows[0].departure_date, null);
  assertEquals(rows[0].departure_missing_nights, true);
});

const SUITE_TWO_NIGHTS_ROBI_HTML = `
<table><tr><td>כניסה</td><td>05/08/2026</td></tr>
<tr><td>..</td><td>מס. הזמנה</td><td>סוג יחידה - חדר</td><td>בסיס אירוח</td><td>שעה</td><td>לילות</td><td>מב-ילד-ת</td><td>לקוח</td><td>סכום</td><td>הערות</td></tr>
<tr><td></td><td>290002</td><td>סוויטת רובי - 13</td><td>HB</td><td></td><td>2</td><td>2</td><td>דנה כהן , 0501234567</td><td>2,000₪</td><td></td></tr>
</table>`;

Deno.test("parseHtmlArrivalsReport: suite row with valid nights → departure_missing_nights false — P0 2026-08-05", () => {
  const rows = parseHtmlArrivalsReport(SUITE_TWO_NIGHTS_ROBI_HTML);
  assertEquals(rows[0].departure_date, "2026-08-07");
  assertEquals(rows[0].departure_missing_nights, false);
});

const DAYPASS_ROW_HTML = `
<table><tr><td>כניסה</td><td>05/08/2026</td></tr>
<tr><td>..</td><td>מס. הזמנה</td><td>סוג יחידה - חדר</td><td>בסיס אירוח</td><td>שעה</td><td>לילות</td><td>מב-ילד-ת</td><td>לקוח</td><td>סכום</td><td>הערות</td></tr>
<tr><td></td><td>290555</td><td>בילוי יומי</td><td>BB</td><td></td><td>0</td><td>2</td><td>יעל שרון , 0521112222</td><td>500₪</td><td></td></tr>
</table>`;

Deno.test("parseHtmlArrivalsReport: day-guest row → departure_date === arrival_date regardless of nights — P0 2026-08-05", () => {
  const rows = parseHtmlArrivalsReport(DAYPASS_ROW_HTML);
  assertEquals(rows.length, 1);
  assertEquals(rows[0].is_day_guest, true);
  assertEquals(rows[0].arrival_date, "2026-08-05");
  assertEquals(rows[0].departure_date, "2026-08-05");
  assertEquals(rows[0].departure_missing_nights, false);
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

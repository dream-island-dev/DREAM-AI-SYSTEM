import {
  assertEquals,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  looksLikeDoc2Html,
  parseClientCell,
  parseHtmlArrivalsReport,
} from "./ezgoDoc2Parser.ts";

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

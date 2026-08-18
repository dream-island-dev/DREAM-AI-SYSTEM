import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  findGuestForDoc2Record,
  isCertainDoc2SuiteAutoApply,
  type Doc2MatchResult,
} from "./ezgoDoc2MailMatch.ts";
import { doc2RecordMatchesGuest } from "./ezgoDoc2RecordMatch.ts";
import type { Doc2Record } from "./ezgoDoc2Parser.ts";
import { parseHtmlArrivalsReport } from "./ezgoDoc2Parser.ts";
import { classifyDoc2MailWorkflow } from "./ezgoDoc2MailLineWorkflow.ts";

const GROUP_COORD_HTML = `
<table><tr><td>כניסה</td><td>03/08/2026</td></tr>
<tr><td>..</td><td>מס. הזמנה</td><td>סוג יחידה - חדר</td><td>בסיס אירוח</td><td>שעה</td><td>לילות</td><td>מב-ילד-ת</td><td>לקוח</td><td>סכום</td><td>הערות</td></tr>
<tr><td></td><td>262984</td><td>סוויטת ג'ספר - 1</td><td>HB</td><td></td><td>2</td><td>1</td><td>בנק לאומי ועד תיכון-ארז זלקטה , 0502005820</td><td>3,680₪</td><td>אורטל בנטורה 050-3302020 - א. ערב 20:00</td></tr>
<tr><td></td><td>262984</td><td>סוויטת ג'ספר - 2</td><td>HB</td><td></td><td>2</td><td>1</td><td>בנק לאומי ועד תיכון-ארז זלקטה , 0502005820</td><td>2,440₪</td><td>אנגלמן אמיר 054-7902278 - א. ערב 19:30</td></tr>
</table>`;

const ortalGuest = {
  id: 101,
  name: "אורטל בנטורה",
  phone: "+972503302020",
  order_number: "262984",
  arrival_date: "2026-08-03",
  departure_date: "2026-08-05",
  room: "ג׳ספר 1",
  room_type: "suite",
  meal_location: null,
};

Deno.test("doc2RecordMatchesGuest: same phone on shared order", () => {
  const rec: Doc2Record = {
    _report: "doc2",
    section: "arrival",
    order_number: "262984",
    room_raw: null,
    room: "ג׳ספר 1",
    board_basis: null,
    meal_location: null,
    arrival_time: null,
    nights: 2,
    guest_count: null,
    guest_name: "אורטל בנטורה",
    phone: "+972503302020",
    amount: null,
    notes: null,
    arrival_date: "2026-08-03",
    departure_date: "2026-08-05",
    is_day_guest: false,
    is_premium_day: false,
  };
  assertEquals(doc2RecordMatchesGuest(rec, ortalGuest), true);
});

Deno.test("doc2RecordMatchesGuest: different occupant phone on same order → no match", () => {
  const rec = {
    phone: "+972547902278",
  };
  assertEquals(doc2RecordMatchesGuest(rec, ortalGuest), false);
});

Deno.test("findGuestForDoc2Record: second group occupant does not match first by order alone", () => {
  const rows = parseHtmlArrivalsReport(GROUP_COORD_HTML);
  assertEquals(rows.length, 2);
  const second = rows[1];
  const hit = findGuestForDoc2Record([ortalGuest], second);
  assertEquals(hit, null);
});

Deno.test("findGuestForDoc2Record: first occupant still matches by order+phone", () => {
  const rows = parseHtmlArrivalsReport(GROUP_COORD_HTML);
  const first = rows[0];
  const hit = findGuestForDoc2Record([ortalGuest], first);
  assertEquals(hit?.id, ortalGuest.id);
});

Deno.test("classifyDoc2MailWorkflow: second group row → create when no guest match", () => {
  const rows = parseHtmlArrivalsReport(GROUP_COORD_HTML);
  const r = classifyDoc2MailWorkflow(rows[1], null);
  assertEquals(r.workflow, "suite_arrival_create");
  assertEquals(r.action, "create");
});

function autoMatch(over: Partial<Doc2MatchResult> & { patch: Record<string, unknown> }): Doc2MatchResult {
  return {
    guest: null,
    method: "none",
    confidence: 0,
    label: "",
    action: "create",
    ...over,
  };
}

Deno.test("isCertainDoc2SuiteAutoApply: suite create with phone is eligible", () => {
  const rows = parseHtmlArrivalsReport(GROUP_COORD_HTML);
  const rec = rows[0];
  const classified = classifyDoc2MailWorkflow(rec, null);
  assertEquals(
    isCertainDoc2SuiteAutoApply(rec, autoMatch({
      action: classified.action,
      patch: classified.patch,
    })),
    true,
  );
});

Deno.test("isCertainDoc2SuiteAutoApply: daypass create is never eligible", () => {
  const rec = {
    ...ortalGuest,
    _report: "doc2" as const,
    section: "arrival" as const,
    room_raw: "Premium Day 1",
    room: "Premium Day 1",
    board_basis: "HB",
    arrival_time: null,
    nights: 0,
    guest_count: null,
    guest_name: "אורח יום",
    phone: "+972501111111",
    amount: null,
    notes: null,
    is_day_guest: true,
    is_premium_day: true,
    order_number: "1",
  } as unknown as Doc2Record;
  assertEquals(
    isCertainDoc2SuiteAutoApply(rec, autoMatch({
      action: "create",
      patch: { _workflow: "daypass_create" },
    })),
    false,
  );
});

Deno.test("isCertainDoc2SuiteAutoApply: missing nights stays manual", () => {
  const rec = {
    _report: "doc2" as const,
    section: "arrival" as const,
    order_number: "1",
    room_raw: "אמטיסט 8",
    room: "אמטיסט 8",
    board_basis: "HB",
    meal_location: "חצי פנסיון",
    arrival_time: null,
    nights: null,
    guest_count: null,
    guest_name: "יעל",
    phone: "+972501234567",
    amount: null,
    notes: null,
    arrival_date: "2026-08-18",
    departure_date: null,
    is_day_guest: false,
    is_premium_day: false,
    departure_missing_nights: true,
  } as Doc2Record;
  assertEquals(
    isCertainDoc2SuiteAutoApply(rec, autoMatch({
      action: "create",
      patch: { _workflow: "suite_arrival_create" },
    })),
    false,
  );
});

Deno.test("isCertainDoc2SuiteAutoApply: fuzzy enrich stays manual", () => {
  const rec = {
    _report: "doc2" as const,
    section: "arrival" as const,
    order_number: "1",
    room_raw: "אמטיסט 8",
    room: "אמטיסט 8",
    board_basis: "HB",
    meal_location: "חצי פנסיון",
    arrival_time: null,
    nights: 2,
    guest_count: null,
    guest_name: "יעל",
    phone: "+972501234567",
    amount: null,
    notes: null,
    arrival_date: "2026-08-18",
    departure_date: "2026-08-20",
    is_day_guest: false,
    is_premium_day: false,
  } as Doc2Record;
  assertEquals(
    isCertainDoc2SuiteAutoApply(rec, autoMatch({
      guest: { id: 9 } as never,
      method: "fuzzy",
      confidence: 0.78,
      action: "enrich",
      patch: { meal_location: "חצי פנסיון", _workflow: "suite_arrival_enrich" },
    })),
    false,
  );
});

Deno.test("isCertainDoc2SuiteAutoApply: conflict stays manual", () => {
  const rec = {
    _report: "doc2" as const,
    section: "arrival" as const,
    order_number: "1",
    room_raw: "אמטיסט 8",
    room: "אמטיסט 8",
    board_basis: "HB",
    meal_location: null,
    arrival_time: null,
    nights: 2,
    guest_count: null,
    guest_name: "יעל",
    phone: "+972501234567",
    amount: null,
    notes: null,
    arrival_date: "2026-08-18",
    departure_date: "2026-08-20",
    is_day_guest: false,
    is_premium_day: false,
  } as Doc2Record;
  assertEquals(
    isCertainDoc2SuiteAutoApply(rec, autoMatch({
      guest: { id: 9 } as never,
      method: "order",
      confidence: 0.95,
      action: "conflict",
      patch: { _workflow: "conflict" },
    })),
    false,
  );
});

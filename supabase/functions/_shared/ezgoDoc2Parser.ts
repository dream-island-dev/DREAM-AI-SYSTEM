// EZGO Doc2 (arrivals / departures HTML mail) parser — shared Edge + tests.

import {
  extractPhoneFromOpsText,
  parseSlashDate,
  sanitizeE164,
} from "./ezgoDoc1Parser.ts";
import {
  isPremiumDayRoom,
  resolveSuiteRoomFromEzgoLabel,
} from "./suiteNames.ts";

export type Doc2Section = "arrival" | "departure";

export type Doc2Record = {
  _report: "doc2";
  section: Doc2Section;
  order_number: string | null;
  room_raw: string | null;
  room: string | null;
  board_basis: string | null;
  meal_location: string | null;
  arrival_time: string | null;
  nights: number | null;
  guest_count: string | null;
  guest_name: string | null;
  phone: string | null;
  amount: string | null;
  notes: string | null;
  arrival_date: string | null;
  departure_date: string | null;
  is_day_guest: boolean;
  is_premium_day: boolean;
};

function htmlCellText(html: string): string {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<div[^>]*>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function boardBasisToMealLocation(board: string): string | null {
  const b = String(board || "").trim().toUpperCase();
  if (/\bFB\b/.test(b)) return "פנסיון מלא";
  if (/\bHB\b/.test(b)) return "חצי פנסיון";
  if (/\bBB\b/.test(b)) return "רק ארוחת בוקר";
  return null;
}

function addDaysYmd(ymd: string, nights: number): string {
  const d = new Date(`${ymd}T12:00:00`);
  d.setDate(d.getDate() + Math.max(nights, 0));
  return d.toISOString().slice(0, 10);
}

export function parseClientCell(raw: string): {
  guest_name: string | null;
  phone: string | null;
} {
  const text = htmlCellText(raw);
  if (!text) return { guest_name: null, phone: null };

  const commaParts = text.split(",").map((s) => s.trim()).filter(Boolean);
  if (commaParts.length >= 2) {
    const phonePart = commaParts[commaParts.length - 1];
    const phone = sanitizeE164(extractPhoneFromOpsText(phonePart) || phonePart);
    if (phone) {
      const guest_name = commaParts.slice(0, -1).join(", ").trim() || null;
      return { guest_name, phone };
    }
  }

  const phone = extractPhoneFromOpsText(text);
  let guest_name = text;
  if (phone) {
    guest_name = text.replace(phone, "").replace(/\+972[\d\s-]+/g, "").trim();
    guest_name = guest_name.replace(/\s*,\s*$/, "").trim();
  }
  return { guest_name: guest_name || null, phone };
}

function isHeaderRow(cells: string[]): boolean {
  const joined = cells.join(" ");
  return joined.includes("מס. הזמנה") || joined.includes("מספר הזמנה");
}

function isSectionRow(cells: string[]): boolean {
  const first = cells[0]?.trim();
  return first === "כניסה" || first === "יציאה";
}

function isSummaryRow(cells: string[]): boolean {
  if (!cells.some((c) => /^\d{5,}$/.test(c))) return false;
  const orderIdx = cells.findIndex((c) => /^\d{5,}$/.test(c));
  if (orderIdx < 0) return false;
  return cells.slice(orderIdx + 1).every((c) => !c || c === ".." || /^\d+(\s*\+\s*\d+)*$/.test(c));
}

export function looksLikeDoc2Html(text: string): boolean {
  const s = String(text || "");
  if (!/<table[\s>]/i.test(s)) return false;
  const plain = s.replace(/<[^>]+>/g, " ");
  return /מס\.?\s*הזמנה/.test(plain)
    && /סוג יחידה/.test(plain)
    && /(כניסה|יציאה)/.test(plain);
}

export function parseHtmlArrivalsReport(htmlText: string): Doc2Record[] {
  let arrivalDate: string | null = null;
  const thMatches = [...htmlText.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)];
  for (const m of thMatches) {
    if (arrivalDate) break;
    arrivalDate = parseSlashDate(htmlCellText(m[1]));
  }
  if (!arrivalDate) arrivalDate = parseSlashDate(htmlText);

  let currentSection: Doc2Section = "arrival";
  const records: Doc2Record[] = [];

  const trMatches = [...htmlText.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  for (const tr of trMatches) {
    const cells = [...tr[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map((m) => htmlCellText(m[1]));

    if (!cells.length) continue;
    if (isHeaderRow(cells)) continue;

    if (isSectionRow(cells)) {
      currentSection = cells[0] === "יציאה" ? "departure" : "arrival";
      const sectionDate = parseSlashDate(cells.join(" "));
      if (sectionDate) arrivalDate = sectionDate;
      continue;
    }

    if (isSummaryRow(cells)) continue;

    const orderIdx = cells.findIndex((c) => /^\d{5,}$/.test(c));
    if (orderIdx < 0) continue;

    const order_number = cells[orderIdx];
    const room_raw = cells[orderIdx + 1] || null;
    const board_basis = cells[orderIdx + 2] || null;
    const arrival_time = cells[orderIdx + 3] || null;
    const nightsRaw = cells[orderIdx + 4] || "";
    const nights = /^\d+$/.test(nightsRaw) ? Number(nightsRaw) : null;
    const guest_count = cells[orderIdx + 5] || null;
    const clientRaw = cells[orderIdx + 6] || "";
    const amount = cells[orderIdx + 7] || null;
    const notes = cells[orderIdx + 8] || null;

    const { guest_name, phone } = parseClientCell(clientRaw);
    const room = resolveSuiteRoomFromEzgoLabel(room_raw);
    const is_premium_day = isPremiumDayRoom(room);
    const is_day_guest = room === "בילוי יומי" || is_premium_day;
    const meal_location = boardBasisToMealLocation(board_basis || "");
    const departure_date = arrivalDate && nights != null
      ? addDaysYmd(arrivalDate, nights)
      : arrivalDate;

    records.push({
      _report: "doc2",
      section: currentSection,
      order_number,
      room_raw,
      room: room || null,
      board_basis: board_basis || null,
      meal_location,
      arrival_time: arrival_time && arrival_time !== ".." ? arrival_time : null,
      nights,
      guest_count,
      guest_name,
      phone,
      amount: amount || null,
      notes: notes || null,
      arrival_date: arrivalDate,
      departure_date,
      is_day_guest,
      is_premium_day,
    });
  }

  return records;
}

export function parseDoc2FromClassification(
  classified: { reportType: string; html?: string },
): Doc2Record[] {
  if (classified.reportType === "doc2_html" && classified.html) {
    return parseHtmlArrivalsReport(classified.html);
  }
  return [];
}

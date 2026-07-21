// EZGO Doc1 (daily operations report) parser — shared Edge + tests.
// Mirrors ArrivalImportPanel.js parseComprehensiveReport / parseHtmlDailyReport.

import {
  addSpaSlot,
  buildGuestProfileDoc1SlotsPatch,
  earliestSpaTime,
  mergeSpaSlotArrays,
  type SpaSlot,
  totalTreatmentCount,
} from "./doc1SpaSlots.ts";

export type { SpaSlot };

export type Doc1Record = {
  order_number: string | null;
  guest_name: string | null;
  phone: string | null;
  arrival_date: string | null;
  spa_time: string | null;
  spa_slots: SpaSlot[];
  treatment_count: number;
  meal_time: string | null;
  meal_location: string | null;
  extras_note?: string | null;
};

export type Doc1ParseOpts = {
  suiteSpaOnly?: boolean;
  strictSuiteLabel?: boolean;
  dedupeBy?: "order" | "phone";
  spaRecordsOnly?: boolean;
};

const SOURCE_RE = /^(Hotel\s+WebSite|Booking\s+Collect|Booking\.com|Booking|Expedia|Hotels\.com)\s*-\s*/i;
const SUITE_SPA_RE = /לאורחי הסוויטות|לשובר סוויטה|שובר סוויטה/i;
const SUITE_GUEST_SPA_LABEL_RE = /לאורחי הסוויטות/;
const GROUP_SPA_RE = /לקבוצות|קבוצות בלבד/i;
/** Same IL-mobile dialect as ezgoParser.js / guestImportIntelligence.js */
const IL_MOBILE_RE = /(0(?:5[0-9])[-. ]?\d{3}[-. ]?\d{4})(?!\d)/g;

export function extractPhoneFromOpsText(text: string): string | null {
  if (!text?.trim()) return null;
  const dashTail = text.match(/\s+-\s+([+\d?][\d\s\-+?]{7,})\s*$/);
  if (dashTail) {
    const p = sanitizeE164(dashTail[1]);
    if (p) return p;
  }
  IL_MOBILE_RE.lastIndex = 0;
  for (const m of text.matchAll(IL_MOBILE_RE)) {
    const p = sanitizeE164(m[1]);
    if (p) return p;
  }
  const intl = text.match(/(?:\+972|972)[\s\-]?(5\d{8})/);
  if (intl) {
    const p = sanitizeE164(intl[0].replace(/\s/g, ""));
    if (p) return p;
  }
  return null;
}

function phoneLocalVariants(phone: string): string[] {
  const out = new Set<string>([phone]);
  if (phone.startsWith("+972")) {
    const local = `0${phone.slice(4)}`;
    out.add(local);
    out.add(local.replace(/-/g, ""));
  }
  return [...out];
}

function extractNameFromOpsTail(tail: string, phone: string | null): string {
  let name = tail.trim();
  if (phone) {
    for (const variant of phoneLocalVariants(phone)) {
      const idx = name.lastIndexOf(variant);
      if (idx >= 0) {
        name = name.slice(0, idx).trim();
        break;
      }
    }
  }
  // Dangling separator left behind once the phone (or its synthetic " - {phone}" suffix
  // from the two-pass parse) was sliced off — e.g. "דור חליף -" → "דור חליף".
  // Must run before SOURCE_RE so "Hotel WebSite -" alone doesn't eat the real name.
  name = name.replace(/\s*-\s*$/, "").trim();
  return name.replace(SOURCE_RE, "").trim();
}

/** Parse order# + name + phone from a Doc1 order cell (supports multiline cells). */
export function parseOrderIdentityFromCell(cellRaw: string): {
  order_number: string | null;
  guest_name: string | null;
  phone: string | null;
} {
  const raw = String(cellRaw || "").trim();
  if (!raw) return { order_number: null, guest_name: null, phone: null };
  const lines = raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const orderLine = lines.find((s) => /^\d+:/.test(s)) ?? raw;
  if (!/^\d+:/.test(orderLine)) {
    return { order_number: null, guest_name: null, phone: null };
  }
  const orderMatch = orderLine.match(/^(\d+):/);
  const order_number = orderMatch ? orderMatch[1] : null;
  const afterId = orderLine.replace(/^\d+:\s*/, "").trim();
  const siblingText = lines.filter((l) => l !== orderLine).join("\n");
  const phoneSource = [afterId, siblingText].filter(Boolean).join("\n");
  const phone = extractPhoneFromOpsText(phoneSource);
  const guest_name = extractNameFromOpsTail(afterId, phone) || null;
  return { order_number, guest_name, phone };
}

export function sanitizeE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const c = String(raw).replace(/[^\d+?]/g, "").replace(/\?/g, "");
  if (!c || /^0+$/.test(c)) return null;
  if (c.startsWith("+")) return c.length >= 10 ? c : null;
  if (/^5\d{8}$/.test(c)) return `+972${c}`;
  if (/^05\d{8}$/.test(c)) return `+972${c.slice(1)}`;
  if (c.startsWith("972") && c.length >= 11) return `+${c}`;
  return c.length >= 9 ? `+${c}` : null;
}

export function parseSlashDate(raw: string): string | null {
  const m = raw.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const [, a, b, y] = m;
  const nA = Number(a);
  const nB = Number(b);
  let day: string;
  let month: string;
  if (nB > 12) {
    month = a;
    day = b;
  } else if (nA > 12) {
    day = a;
    month = b;
  } else {
    day = a;
    month = b;
  }
  return `${y}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function parseDateYmd(raw: unknown): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (/^\d{4}[-/]\d{2}[-/]\d{2}/.test(s)) return s.slice(0, 10).replace(/\//g, "-");
  const slash = parseSlashDate(s);
  if (slash) return slash;
  const serial = parseFloat(s);
  if (!isNaN(serial) && serial > 40000) {
    const dt = new Date(Math.round((serial - 25569) * 86_400_000));
    return isNaN(dt.getTime()) ? null : dt.toISOString().slice(0, 10);
  }
  return null;
}

function splitReportLines(raw: string): string[] {
  return String(raw).split(/\r?\n|<BR\s*\/?>/gi);
}

function applySpaSlotToBlock(block: Doc1Record, time: string, count: number): void {
  block.spa_slots = addSpaSlot(block.spa_slots ?? [], time, count);
  block.treatment_count = totalTreatmentCount(block.spa_slots);
  const earliest = earliestSpaTime(block.spa_slots);
  if (earliest) block.spa_time = earliest;
}

function extractExtras(
  block: Doc1Record,
  raw: string,
  extractOpts: { suiteSpaOnly?: boolean; strictSuiteLabel?: boolean },
): void {
  const { suiteSpaOnly = false, strictSuiteLabel = false } = extractOpts;
  const suiteLabelRe = strictSuiteLabel ? SUITE_GUEST_SPA_LABEL_RE : SUITE_SPA_RE;
  for (const line of splitReportLines(raw)) {
    const clean = line.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
    if (!clean) continue;
    const m = clean.match(/^(\d+)\s*-\s*(\d{1,2}):(\d{2})/);
    if (!m) continue;
    if (GROUP_SPA_RE.test(clean)) continue;
    if (suiteSpaOnly && !suiteLabelRe.test(clean)) continue;
    const count = parseInt(m[1], 10);
    const time = `${m[2].padStart(2, "0")}:${m[3]}`;
    applySpaSlotToBlock(block, time, count);
  }
}

function extractMealTime(block: Doc1Record, raw: string): void {
  for (const line of splitReportLines(raw)) {
    const clean = line.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
    if (!clean) continue;
    if (/^\d+\s*-\s*\d{1,2}:\d{2}/.test(clean)) continue;
    let m = clean.match(/ארוחה[ת]?\s*(?:ערב|בוקר|צהריים)?\s*[-:]?\s*(\d{1,2}):(\d{2})/);
    if (!m && /(?:ערב|א\.?\s*ערב|צהריים|א\.?\s*צהריים)/i.test(clean)) {
      m = clean.match(/מ-?\s*(\d{1,2}):(\d{2})/);
    }
    if (!m && /\b(?:HB|Half[\s-]?Board)\b/i.test(clean)) {
      m = clean.match(/(\d{1,2}):(\d{2})/);
    }
    if (!m) continue;
    const time = `${m[1].padStart(2, "0")}:${m[2]}`;
    if (!block.meal_time || time < block.meal_time) block.meal_time = time;
  }
}

function orderLineFromCell(c1: string): string {
  const lines = String(c1).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  return lines.find((s) => /^\d+:/.test(s)) ?? String(c1).trim();
}

type RowTuple = [unknown, unknown, unknown];

export function parseComprehensiveReport(
  rows: RowTuple[],
  opts: Doc1ParseOpts = {},
): Doc1Record[] {
  const {
    suiteSpaOnly = false,
    strictSuiteLabel = false,
    dedupeBy = "phone",
    spaRecordsOnly = false,
  } = opts;
  const extractOpts = { suiteSpaOnly, strictSuiteLabel };
  let arrivalDate: string | null = null;
  let current: Doc1Record | null = null;
  const blocks: Doc1Record[] = [];

  for (const row of rows) {
    const [c0, c1, c2] = row;

    if (!arrivalDate) {
      if (typeof c0 === "number" && c0 > 40000) {
        arrivalDate = parseDateYmd(c0);
      } else if (typeof c0 === "string" && c0.trim()) {
        arrivalDate = parseDateYmd(c0);
      }
    }

    const orderCell = c1 && typeof c1 === "string" ? c1 : null;
    const orderLine = orderCell ? orderLineFromCell(orderCell) : null;

    if (orderLine && /^\d+:/.test(orderLine)) {
      if (current) blocks.push(current);
      const identity = parseOrderIdentityFromCell(orderCell!);
      current = {
        order_number: identity.order_number,
        guest_name: identity.guest_name,
        phone: identity.phone,
        arrival_date: arrivalDate,
        spa_time: null,
        spa_slots: [],
        treatment_count: 0,
        meal_time: null,
        meal_location: null,
      };
      if (c2 && typeof c2 === "string") {
        extractExtras(current, c2, extractOpts);
        extractMealTime(current, c2);
      }
      continue;
    }
    if (!current) continue;
    if (orderCell && !/^\d+:/.test(orderLine!)) {
      const phoneOnly = extractPhoneFromOpsText(orderCell);
      if (phoneOnly && !current.phone) current.phone = phoneOnly;
    }
    if (c2 && typeof c2 === "string") {
      extractExtras(current, c2, extractOpts);
      extractMealTime(current, c2);
    }
  }
  if (current) blocks.push(current);

  const mergeBlock = (ex: Doc1Record, b: Doc1Record) => {
    if (b.spa_slots?.length) {
      ex.spa_slots = mergeSpaSlotArrays(ex.spa_slots ?? [], b.spa_slots);
      ex.treatment_count = totalTreatmentCount(ex.spa_slots);
      const earliest = earliestSpaTime(ex.spa_slots);
      if (earliest) ex.spa_time = earliest;
    } else {
      ex.treatment_count += b.treatment_count;
      if (b.spa_time && (!ex.spa_time || b.spa_time < ex.spa_time)) ex.spa_time = b.spa_time;
    }
    if (b.meal_time && (!ex.meal_time || b.meal_time < ex.meal_time)) ex.meal_time = b.meal_time;
    if (!ex.phone && b.phone) ex.phone = b.phone;
    if (!ex.guest_name && b.guest_name) ex.guest_name = b.guest_name;
  };

  if (dedupeBy === "order") {
    const byOrder: Record<string, Doc1Record> = {};
    for (const b of blocks) {
      if (!b.order_number) continue;
      if (spaRecordsOnly && !b.spa_time) continue;
      if (!byOrder[b.order_number]) byOrder[b.order_number] = { ...b };
      else mergeBlock(byOrder[b.order_number], b);
    }
    return Object.values(byOrder);
  }

  const byPhone: Record<string, Doc1Record> = {};
  for (const b of blocks) {
    if (!b.phone) continue;
    if (spaRecordsOnly && !b.spa_time) continue;
    if (!byPhone[b.phone]) byPhone[b.phone] = { ...b };
    else mergeBlock(byPhone[b.phone], b);
  }
  return Object.values(byPhone);
}

function htmlCellText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/div>\s*<div[^>]*>/gi, "\n")
    .replace(/<\/p>\s*<p[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/\u00a0/g, " ")
    .trim();
}

function appendToLastPseudoOrderCell(pseudoRows: RowTuple[], fragment: string): void {
  if (!pseudoRows.length || !fragment.trim()) return;
  const last = pseudoRows[pseudoRows.length - 1];
  const prev = String(last[1] ?? "").trim();
  last[1] = prev ? `${prev}\n${fragment.trim()}` : fragment.trim();
}

function extractArrivalDateFromHtml(htmlText: string): string | null {
  return parseSlashDate(htmlText);
}

export function parseHtmlDailyReport(htmlText: string, opts: Doc1ParseOpts = {}): Doc1Record[] {
  let arrivalDate: string | null = null;
  const thMatches = [...htmlText.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)];
  for (const m of thMatches) {
    if (arrivalDate) break;
    const txt = htmlCellText(m[1]);
    const parsed = parseSlashDate(txt);
    if (parsed) arrivalDate = parsed;
  }
  if (!arrivalDate) arrivalDate = extractArrivalDateFromHtml(htmlText);

  const pseudoRows: RowTuple[] = [];
  const boardDefaults = new Map<string, { meal_time: string | null; meal_location: string }>();

  const trMatches = [...htmlText.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  for (const tr of trMatches) {
    const tdMatches = [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
    if (tdMatches.length < 2) continue;

    const orderRaw = htmlCellText(tdMatches[0][1]);
    const extras = htmlCellText(tdMatches[1][1]);
    const board = tdMatches.length > 2 ? htmlCellText(tdMatches[2][1]) : "";
    const meals = tdMatches.length > 3 ? htmlCellText(tdMatches[3][1]) : "";

    const identity = parseOrderIdentityFromCell(orderRaw);
    if (!identity.order_number) {
      const phoneOnly = extractPhoneFromOpsText(orderRaw);
      if (phoneOnly) {
        appendToLastPseudoOrderCell(pseudoRows, orderRaw);
      } else if (extras && pseudoRows.length) {
        const last = pseudoRows[pseudoRows.length - 1];
        const prevExtras = String(last[2] ?? "");
        last[2] = prevExtras ? `${prevExtras}\n${extras}` : extras;
      }
      continue;
    }

    const bUpper = `${board} ${meals}`.trim().toUpperCase();
    let mealDefault: { meal_time: string | null; meal_location: string } | null = null;
    if (/\bFB\b/.test(bUpper)) mealDefault = { meal_time: null, meal_location: "פנסיון מלא" };
    else if (/\bHB\b/.test(bUpper)) mealDefault = { meal_time: null, meal_location: "חצי פנסיון" };
    else if (/\bBB\b/.test(bUpper)) mealDefault = { meal_time: null, meal_location: "רק ארוחת בוקר" };

    if (mealDefault && identity.phone) {
      boardDefaults.set(identity.phone, mealDefault);
    }

    const orderLine = `${identity.order_number}: ${identity.guest_name || ""}${identity.phone ? ` - ${identity.phone}` : ""}`.trim();
    pseudoRows.push([null, orderLine, extras || null]);
  }

  const records = parseComprehensiveReport(pseudoRows, opts);
  if (arrivalDate) {
    for (const r of records) {
      if (!r.arrival_date) r.arrival_date = arrivalDate;
    }
  }
  for (const r of records) {
    const def = r.phone ? boardDefaults.get(r.phone) : null;
    if (def && !r.meal_location && def.meal_location) {
      r.meal_location = def.meal_location;
    }
  }
  return records;
}

/** Tab-separated paste from EZGO grid (columns: date | order | extras | board | meals). */
export function parseTsvDailyReport(tsvText: string, opts: Doc1ParseOpts = {}): Doc1Record[] {
  const lines = String(tsvText).split(/\r?\n/).filter((l) => l.trim());
  const pseudoRows: RowTuple[] = [];
  const boardDefaults = new Map<string, { meal_location: string }>();
  let arrivalDate: string | null = null;

  for (const line of lines) {
    const cols = line.split("\t");
    if (!cols.length) continue;

    const c0 = cols[0]?.trim() ?? "";
    const c1 = cols[1]?.trim() ?? "";
    const c2 = cols[2]?.trim() ?? "";
    const board = cols[3]?.trim() ?? "";
    const meals = cols[4]?.trim() ?? "";

    if (!arrivalDate && c0 && /\d{1,2}\/\d{1,2}\/\d{4}/.test(c0)) {
      arrivalDate = parseDateYmd(c0);
    }

    const orderInC1 = c1 && /^\d+:/.test(orderLineFromCell(c1));
    const orderInC0 = !orderInC1 && c0 && /^\d+:/.test(orderLineFromCell(c0));
    const orderCell = orderInC1 ? c1 : (orderInC0 ? c0 : null);
    const extrasCol = orderInC1 ? c2 : (orderInC0 ? (c1 || c2) : null);

    if (orderCell) {
      const identity = parseOrderIdentityFromCell(orderCell);
      const bUpper = `${board} ${meals} ${extrasCol || ""}`.trim().toUpperCase();
      let mealDefault: { meal_location: string } | null = null;
      if (/\bFB\b/.test(bUpper)) mealDefault = { meal_location: "פנסיון מלא" };
      else if (/\bHB\b/.test(bUpper)) mealDefault = { meal_location: "חצי פנסיון" };
      else if (/\bBB\b/.test(bUpper)) mealDefault = { meal_location: "רק ארוחת בוקר" };
      if (mealDefault && identity.phone) {
        boardDefaults.set(identity.phone, mealDefault);
      }
      const syntheticLine = `${identity.order_number}: ${identity.guest_name || ""}${identity.phone ? ` - ${identity.phone}` : ""}`.trim();
      const rowDateCell = orderInC0 ? null : (c0 || null);
      pseudoRows.push([rowDateCell, syntheticLine, extrasCol || null]);
      continue;
    }

    if (pseudoRows.length > 0) {
      const extraChunk = c2 || c1;
      if (extraChunk) {
        const last = pseudoRows[pseudoRows.length - 1];
        const prevExtras = String(last[2] ?? "");
        last[2] = prevExtras ? `${prevExtras}\n${extraChunk}` : extraChunk;
      }
    }
  }

  const records = parseComprehensiveReport(pseudoRows, opts);
  if (arrivalDate) {
    for (const r of records) {
      if (!r.arrival_date) r.arrival_date = arrivalDate;
    }
  }
  for (const r of records) {
    const def = r.phone ? boardDefaults.get(r.phone) : null;
    if (def && !r.meal_location) r.meal_location = def.meal_location;
  }
  return records;
}

export function defaultDoc1ParseOpts(fullReport = true): Doc1ParseOpts {
  if (!fullReport) {
    return {
      suiteSpaOnly: true,
      strictSuiteLabel: true,
      dedupeBy: "order",
      spaRecordsOnly: true,
    };
  }
  return { suiteSpaOnly: false, dedupeBy: "order" };
}

export function looksLikeDoc1Html(text: string): boolean {
  const s = String(text || "").trimStart().replace(/^\uFEFF/, "");
  const plain = s.replace(/<[^>]+>/g, " ");
  // Order cells are often inside <DIV>276034: — not at line start after tag strip.
  return /<!DOCTYPE\s+html|<html[\s>]|<table[\s>]/i.test(s) && /(?:^|\s)\d+:/m.test(plain);
}

export function looksLikeDoc1Tsv(text: string): boolean {
  const s = String(text || "");
  if (!s.includes("\t")) return false;
  return /^\d+:/m.test(s) && /(הזמנה|תוספות|לאורחי|HB|BB|טיפול)/.test(s);
}

function looksLikeDoc2Html(text: string): boolean {
  const s = String(text || "");
  if (!/<table[\s>]/i.test(s)) return false;
  const plain = s.replace(/<[^>]+>/g, " ");
  return /מס\.?\s*הזמנה/.test(plain)
    && /סוג יחידה/.test(plain)
    && /(כניסה|יציאה)/.test(plain);
}

export type EzgoMailClassification = {
  reportType: "doc1_html" | "doc1_tsv" | "doc1_excel" | "doc2_html" | "unknown";
  html?: string;
  tsv?: string;
  excelFilename?: string;
};

export function classifyEzgoMailContent(bodyHtml: string, bodyText: string): EzgoMailClassification {
  const html = (bodyHtml || "").trim();
  const text = (bodyText || "").trim();
  // Doc2 arrivals table must be checked before Doc1 (both are HTML tables).
  if (html && looksLikeDoc2Html(html)) {
    return { reportType: "doc2_html", html };
  }
  if (html && looksLikeDoc1Html(html)) {
    return { reportType: "doc1_html", html };
  }
  if (looksLikeDoc1Tsv(text)) {
    return { reportType: "doc1_tsv", tsv: text };
  }
  if (looksLikeDoc2Html(text)) {
    return { reportType: "doc2_html", html: text };
  }
  if (looksLikeDoc1Html(text)) {
    return { reportType: "doc1_html", html: text };
  }
  return { reportType: "unknown" };
}

export function parseDoc1FromClassification(
  classified: EzgoMailClassification,
  opts: Doc1ParseOpts = defaultDoc1ParseOpts(true),
): Doc1Record[] {
  if (classified.reportType === "doc1_html" && classified.html) {
    return parseHtmlDailyReport(classified.html, opts);
  }
  if (classified.reportType === "doc1_tsv" && classified.tsv) {
    return parseTsvDailyReport(classified.tsv, opts);
  }
  return [];
}

/** Fill missing phones (and names) on primary rows from Excel/secondary Doc1 parse — keyed by order_number. */
export function mergeDoc1PhoneFromSecondary(
  primary: Doc1Record[],
  secondary: Doc1Record[],
): Doc1Record[] {
  if (!primary.length || !secondary.length) return primary;
  const byOrder = new Map<string, Doc1Record>();
  for (const rec of secondary) {
    if (!rec.order_number) continue;
    const prev = byOrder.get(rec.order_number);
    if (!prev) {
      byOrder.set(rec.order_number, rec);
      continue;
    }
    if (!prev.phone && rec.phone) prev.phone = rec.phone;
    if (!prev.guest_name && rec.guest_name) prev.guest_name = rec.guest_name;
  }
  return primary.map((rec) => {
    if (rec.phone || !rec.order_number) return rec;
    const hit = byOrder.get(rec.order_number);
    if (!hit?.phone) return rec;
    return {
      ...rec,
      phone: hit.phone,
      guest_name: rec.guest_name || hit.guest_name,
    };
  });
}

export function countDoc1RecordsMissingPhone(records: Doc1Record[]): number {
  return records.filter((r) => r.order_number && !r.phone).length;
}

type XlsxModule = {
  read: (data: Uint8Array, opts: { type: string; raw?: boolean }) => { Sheets: Record<string, unknown>; SheetNames: string[] };
  utils: {
    sheet_to_json: (ws: unknown, opts: { defval: null; header: 1 }) => unknown[];
  };
};

let xlsxLoader: Promise<XlsxModule> | null = null;

function loadXlsx(): Promise<XlsxModule> {
  if (!xlsxLoader) {
    xlsxLoader = import("https://esm.sh/xlsx@0.18.5") as Promise<XlsxModule>;
  }
  return xlsxLoader;
}

/** EZGO operations Excel — order cells like `269731: Name - 05...` in column B. */
export function looksLikeDoc1ExcelRows(rows: unknown[]): boolean {
  if (!rows?.length) return false;
  let orderHits = 0;
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    for (const cell of row) {
      if (cell == null) continue;
      const s = String(cell).trim();
      if (/^\d+:/.test(s) || /\n\d+:/.test(s)) orderHits += 1;
    }
    if (orderHits >= 2) return true;
  }
  return orderHits >= 1;
}

export async function parseDoc1FromExcelBuffer(
  buf: Uint8Array,
  opts: Doc1ParseOpts = defaultDoc1ParseOpts(true),
): Promise<Doc1Record[]> {
  const XLSX = await loadXlsx();
  const wb = XLSX.read(buf, { type: "array", raw: false });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const ws = wb.Sheets[sheetName];
  if (!ws) return [];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: null, header: 1 }) as RowTuple[];
  if (!looksLikeDoc1ExcelRows(rows)) return [];
  return parseComprehensiveReport(rows, opts);
}

/** Doc1 enrichment patch — never overwrites stay dates or room. */
export function buildDoc1EnrichmentPatch(
  rec: Doc1Record,
  existing: { order_number?: string | null; guest_profile?: unknown },
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (rec.spa_time) {
    patch.spa_time = rec.spa_time;
    if (rec.arrival_date) patch.spa_date = rec.arrival_date;
  }
  if (rec.meal_time) patch.meal_time = rec.meal_time;
  if (rec.meal_location) patch.meal_location = rec.meal_location;
  if (rec.treatment_count) patch.treatment_count = rec.treatment_count;
  if (rec.order_number && !existing?.order_number) patch.order_number = rec.order_number;
  if (rec.spa_slots?.length) {
    const spaDate = rec.arrival_date ? String(rec.arrival_date).slice(0, 10) : null;
    patch.guest_profile = buildGuestProfileDoc1SlotsPatch(
      existing?.guest_profile as Record<string, unknown> | null,
      rec.spa_slots,
      spaDate,
    );
  }
  return patch;
}

export function reportDateWithinGuestStay(
  guest: { arrival_date?: string | null; departure_date?: string | null },
  reportDateYmd: string | null,
): boolean {
  if (!guest?.arrival_date || !reportDateYmd) return false;
  const arr = String(guest.arrival_date).slice(0, 10);
  const dep = String(guest.departure_date || guest.arrival_date).slice(0, 10);
  const day = String(reportDateYmd).slice(0, 10);
  return day >= arr && day <= dep;
}

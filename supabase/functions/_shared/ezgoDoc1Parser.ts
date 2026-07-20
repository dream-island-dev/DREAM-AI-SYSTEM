// EZGO Doc1 (daily operations report) parser — shared Edge + tests.
// Mirrors ArrivalImportPanel.js parseComprehensiveReport / parseHtmlDailyReport.

export type Doc1Record = {
  order_number: string | null;
  guest_name: string | null;
  phone: string | null;
  arrival_date: string | null;
  spa_time: string | null;
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

export function sanitizeE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const c = String(raw).replace(/[^\d+?]/g, "").replace(/\?/g, "");
  if (!c) return null;
  if (c.startsWith("+")) return c.length >= 10 ? c : null;
  if (/^5\d{8}$/.test(c)) return `+972${c}`;
  if (/^05\d{8}$/.test(c)) return `+972${c.slice(1)}`;
  if (c.startsWith("972") && c.length >= 11) return `+${c}`;
  return c.length >= 9 ? `+${c}` : null;
}

function parseDateYmd(raw: unknown): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (/^\d{4}[-/]\d{2}[-/]\d{2}/.test(s)) return s.slice(0, 10).replace(/\//g, "-");
  const dmy = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (dmy) {
    const [, d, m, y] = dmy;
    const year = y.length === 2 ? `20${y}` : y;
    return `${year}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
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
    block.treatment_count += count;
    if (!block.spa_time || time < block.spa_time) block.spa_time = time;
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

    const orderLine = c1 && typeof c1 === "string" ? orderLineFromCell(c1) : null;

    if (orderLine && /^\d+:/.test(orderLine)) {
      if (current) blocks.push(current);
      const orderMatch = orderLine.match(/^(\d+):/);
      const phoneMatch = orderLine.match(/\s+-\s+([+\d?][\d\s\-+?]{7,})\s*$/);
      const phone = phoneMatch ? sanitizeE164(phoneMatch[1]) : null;
      const afterId = orderLine.replace(/^\d+:\s*/, "");
      const nameRaw = phoneMatch
        ? afterId.slice(0, afterId.lastIndexOf(phoneMatch[0])).trim()
        : afterId.trim();
      current = {
        order_number: orderMatch ? orderMatch[1] : null,
        guest_name: nameRaw.replace(SOURCE_RE, "").trim() || null,
        phone,
        arrival_date: arrivalDate,
        spa_time: null,
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
    if (c2 && typeof c2 === "string") {
      extractExtras(current, c2, extractOpts);
      extractMealTime(current, c2);
    }
  }
  if (current) blocks.push(current);

  const mergeBlock = (ex: Doc1Record, b: Doc1Record) => {
    ex.treatment_count += b.treatment_count;
    if (b.spa_time && (!ex.spa_time || b.spa_time < ex.spa_time)) ex.spa_time = b.spa_time;
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
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/\u00a0/g, " ")
    .trim();
}

function extractArrivalDateFromHtml(htmlText: string): string | null {
  const dmY = htmlText.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!dmY) return null;
  const [, d, m, y] = dmY;
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

export function parseHtmlDailyReport(htmlText: string, opts: Doc1ParseOpts = {}): Doc1Record[] {
  let arrivalDate: string | null = null;
  const thMatches = [...htmlText.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)];
  for (const m of thMatches) {
    if (arrivalDate) break;
    const txt = htmlCellText(m[1]);
    const dateM = txt.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (dateM) arrivalDate = `${dateM[3]}-${dateM[2].padStart(2, "0")}-${dateM[1].padStart(2, "0")}`;
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

    const orderLine = orderRaw.split(/\r?\n/).map((s) => s.trim()).find((s) => /^\d+:/.test(s));
    if (!orderLine) continue;

    const bUpper = `${board} ${meals}`.trim().toUpperCase();
    let mealDefault: { meal_time: string | null; meal_location: string } | null = null;
    if (/\bFB\b/.test(bUpper)) mealDefault = { meal_time: null, meal_location: "פנסיון מלא" };
    else if (/\bHB\b/.test(bUpper)) mealDefault = { meal_time: null, meal_location: "חצי פנסיון" };
    else if (/\bBB\b/.test(bUpper)) mealDefault = { meal_time: null, meal_location: "רק ארוחת בוקר" };

    if (mealDefault) {
      const pm = orderLine.match(/\s+-\s+([+\d?][\d\s\-+?]{7,})\s*$/);
      const e164 = pm ? sanitizeE164(pm[1]) : null;
      if (e164) boardDefaults.set(e164, mealDefault);
    }

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

    const orderLine = c1 ? orderLineFromCell(c1) : "";
    if (orderLine && /^\d+:/.test(orderLine)) {
      const bUpper = `${board} ${meals} ${c2}`.trim().toUpperCase();
      let mealDefault: { meal_location: string } | null = null;
      if (/\bFB\b/.test(bUpper)) mealDefault = { meal_location: "פנסיון מלא" };
      else if (/\bHB\b/.test(bUpper)) mealDefault = { meal_location: "חצי פנסיון" };
      else if (/\bBB\b/.test(bUpper)) mealDefault = { meal_location: "רק ארוחת בוקר" };
      if (mealDefault) {
        const pm = orderLine.match(/\s+-\s+([+\d?][\d\s\-+?]{7,})\s*$/);
        const e164 = pm ? sanitizeE164(pm[1]) : null;
        if (e164) boardDefaults.set(e164, mealDefault);
      }
      pseudoRows.push([c0 || null, orderLine, c2 || null]);
      continue;
    }

    if (pseudoRows.length > 0 && c2) {
      const last = pseudoRows[pseudoRows.length - 1];
      const prevExtras = String(last[2] ?? "");
      last[2] = prevExtras ? `${prevExtras}\n${c2}` : c2;
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

export type EzgoMailClassification = {
  reportType: "doc1_html" | "doc1_tsv" | "unknown";
  html?: string;
  tsv?: string;
};

export function classifyEzgoMailContent(bodyHtml: string, bodyText: string): EzgoMailClassification {
  const html = (bodyHtml || "").trim();
  const text = (bodyText || "").trim();
  if (html && looksLikeDoc1Html(html)) {
    return { reportType: "doc1_html", html };
  }
  if (looksLikeDoc1Tsv(text)) {
    return { reportType: "doc1_tsv", tsv: text };
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

/** Doc1 enrichment patch — never overwrites stay dates or room. */
export function buildDoc1EnrichmentPatch(
  rec: Doc1Record,
  existing: { order_number?: string | null },
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

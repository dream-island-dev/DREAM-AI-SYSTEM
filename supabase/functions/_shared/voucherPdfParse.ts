// Parse Hever / Police Funds combined PDF exports (iCenter / חבר וקרנות format).

import { inferHeverPolicePackage } from "./voucherProviderConfig.ts";

export type HeverPdfRow = {
  voucher_number: string;
  amount: number;
  purchase_date: string | null;
  package_type: string | null;
  org: string;
  raw_line: string;
};

const ROW_RE = /(\d{5})(\d{2}\/\d{2}\/\d{2})\s+(\d{2}:\d{2})\s+(.+?)(שוטרים|חבר)/g;

/** Known per-person prices in חבר/השוטרים PDFs (₪). */
const KNOWN_UNIT_PRICES = [455, 544, 695, 780, 1544, 760.5, 530.4, 2535];

function parseTailAmounts(tail: string): { unit: number | null; total: number | null } {
  const chunks = [...tail.matchAll(/\d+\.\d{2}/g)];
  if (!chunks.length) return { unit: null, total: null };
  const totalEntry = chunks[chunks.length - 1];
  const total = parseMoney(totalEntry[0]);
  const before = tail.slice(0, totalEntry.index ?? 0);
  const sorted = [...KNOWN_UNIT_PRICES].sort((a, b) => b - a);
  for (const price of sorted) {
    const needle = price % 1 === 0 ? `${Math.trunc(price)}.00` : price.toFixed(2);
    if (before.includes(needle)) return { unit: price, total };
  }
  return { unit: null, total };
}

function parseMoney(raw: string): number {
  const n = Number(String(raw).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function parseDmyToIso(dmy: string): string | null {
  const m = dmy.match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
  if (!m) return null;
  return `20${m[3]}-${m[2]}-${m[1]}`;
}

/** Extract redemption rows from flattened PDF text. */
export function parseHeverPolicePdfText(text: string): HeverPdfRow[] {
  const flat = String(text ?? "").replace(/\s+/g, " ");
  const rows: HeverPdfRow[] = [];
  let m: RegExpExecArray | null;
  ROW_RE.lastIndex = 0;
  while ((m = ROW_RE.exec(flat)) !== null) {
    const voucher = m[1];
    const tail = m[4];
    const org = m[5];
    const unitPrice = parseTailAmounts(tail).unit ?? 0;
    rows.push({
      voucher_number: voucher,
      amount: unitPrice,
      purchase_date: parseDmyToIso(m[2]),
      org,
      package_type: inferHeverPolicePackage(unitPrice, org),
      raw_line: m[0],
    });
  }
  return rows;
}

/** Convert parsed PDF rows to matrix for unified XLSX-style pipeline. */
export function heverPdfRowsToMatrix(rows: HeverPdfRow[]): unknown[][] {
  const headers = ["מספר שובר", "סכום", "תאריך מימוש", "סוג שובר", "ארגון"];
  const matrix: unknown[][] = [headers];
  for (const r of rows) {
    matrix.push([r.voucher_number, r.amount, r.purchase_date ?? "", r.package_type ?? "", r.org]);
  }
  return matrix;
}

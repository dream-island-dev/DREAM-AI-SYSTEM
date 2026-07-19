// supabase/functions/_shared/voucherImport.ts
// Voucher Reconciliation — shared parsing, preset column detection, and
// fuzzy package matching. Used by reconcile-vouchers/index.ts.

import {
  resolveVoucherProviderProfile,
  resolveVoucherStrategy,
  type VoucherProviderProfile,
} from "./voucherReconciliationStrategy.ts";

export type VoucherMapping = Record<string, string | null>;
export type VoucherRow = Record<string, unknown>;

const INVISIBLE_RE = /[\u200B-\u200F\u202A-\u202E\uFEFF]/g;

export function normalizeImportHeaderKey(raw: unknown): string {
  return String(raw ?? "").replace(INVISIBLE_RE, "").trim();
}

function headerKeyLower(h: string): string {
  return normalizeImportHeaderKey(h).toLowerCase();
}

/** First header whose normalized form matches any alias (case-insensitive). */
export function findHeaderByAliases(headers: string[], aliases: string[]): string | null {
  const want = new Set(aliases.map((a) => normalizeImportHeaderKey(a).toLowerCase()));
  for (const h of headers ?? []) {
    const key = normalizeImportHeaderKey(h);
    if (want.has(headerKeyLower(key))) return key;
  }
  // Substring fallback — e.g. "מספר שובר / קופון"
  for (const h of headers ?? []) {
    const key = normalizeImportHeaderKey(h);
    const low = headerKeyLower(key);
    for (const alias of aliases) {
      const al = normalizeImportHeaderKey(alias).toLowerCase();
      if (al.length >= 4 && low.includes(al)) return key;
    }
  }
  return null;
}

function buildPreset(headers: string[], spec: Record<string, string[]>): VoucherMapping {
  const out: VoucherMapping = {};
  for (const [field, aliases] of Object.entries(spec)) {
    out[field] = findHeaderByAliases(headers, aliases);
  }
  return out;
}

const EASYGO_VOUCHER_ALIASES: Record<string, string[]> = {
  voucherNumber: [
    "מספר שובר", "מס שובר", "מס. שובר", "מספר השובר", "מספר קופון", "קוד שובר",
    "קוד קופון", "voucher", "coupon", "voucher number", "coupon code",
    "מספר תו", "מספר תווים", "couponno", "מזהה שובר",
  ],
  packageType: [
    "חבילה", "סוג חבילה", "שם חבילה", "סוג שובר", "שם שובר", "מוצר", "סוג מוצר",
    "package", "package type", "product", "תיאור חבילה", "תיאור שובר", "פריט",
    "coupondesc", "siname",
  ],
  guestName: [
    "שם מלא", "שם האורח", "שם הלקוח", "לקוח", "guest", "guest name", "client", "שם מזמין",
    "שם לקוח",
  ],
  phone: ["טלפון", "טלפון נייד", "נייד", "phone", "mobile", "טלפון 1"],
  orderNumber: ["מספר הזמנה", "מס. הזמנה", "מס הזמנה", "הזמנה", "order", "order number", "iorderid"],
  amount: ["סכום", "מחיר", "שולם", "amount", "price", "סכום שולם", "ערך שובר"],
  arrivalDate: ["תאריך הגעה", "ת. הגעה", "הגעה", "arrival", "arrival date", "ת. התחלה", "תאריך"],
  voucherCompany: ["חברת שוברים", "חברה", "ספק", "ארגון"],
};

const PROVIDER_VOUCHER_ALIASES: Record<string, string[]> = {
  voucherNumber: [
    ...EASYGO_VOUCHER_ALIASES.voucherNumber,
    "מזהה לקוח", "מספר לקוח", "תעודת זהות", "ת.ז", "תז", "מספר זהות",
  ],
  packageType: [
    ...EASYGO_VOUCHER_ALIASES.packageType,
    "וריאנט", "שם קופון הטבה", "סוג שובר",
  ],
  guestName: EASYGO_VOUCHER_ALIASES.guestName,
  amount: [...EASYGO_VOUCHER_ALIASES.amount, "שווי הטבות", "מחיר פריט"],
  purchaseDate: [
    "תאריך רכישה", "ת. רכישה", "תאריך מימוש", "תאריך", "date", "purchase date", "redeemed",
    "תאריך שימוש", "שעת מימוש",
  ],
};

function headerHas(headers: string[], name: string): boolean {
  return headers.some((h) => normalizeImportHeaderKey(h) === normalizeImportHeaderKey(name));
}

function isMostlyNumericColumn(rows: VoucherRow[], col: string, sample = 8): boolean {
  let numeric = 0;
  let seen = 0;
  for (const row of rows.slice(0, sample)) {
    const v = normalizeVoucherNumber(row[col]);
    if (!v) continue;
    seen++;
    if (/^\d{5,}$/.test(v.replace(/[^0-9]/g, ""))) numeric++;
  }
  return seen >= 2 && numeric / seen >= 0.75;
}

/** Multi-Pass aggregate CSV — `שם` column holds voucher id, not guest name. */
function detectMultipassProviderPreset(headers: string[], rows: VoucherRow[]): VoucherMapping | null {
  const packageCol = findHeaderByAliases(headers, ["שם קופון הטבה", "קופון הטבה"]);
  const nameCol = findHeaderByAliases(headers, ["שם"]);
  if (!packageCol || !nameCol) return null;
  if (!isMostlyNumericColumn(rows, nameCol)) return null;
  return {
    voucherNumber: nameCol,
    packageType: packageCol,
    guestName: null,
    amount: findHeaderByAliases(headers, ["שווי הטבות", "מחיר פריט", "סכום"]),
    purchaseDate: null,
  };
}

/** Nofshonit redemption xlsx — "מזהה לקוח" is the voucher/coupon number (↔ EZGO CouponNo); אסמכתא → raw_extras. */
function detectNofshonitProviderPreset(headers: string[]): VoucherMapping | null {
  const idCol = findHeaderByAliases(headers, ["מזהה לקוח", "תעודת זהות", "מספר זהות"]);
  const variantCol = findHeaderByAliases(headers, ["וריאנט", "חבילה", "סוג חבילה"]);
  if (!idCol) return null;
  return {
    voucherNumber: idCol,
    packageType: variantCol,
    guestName: null,
    amount: null,
    purchaseDate: findHeaderByAliases(headers, ["שעת מימוש", "תאריך מימוש"]),
  };
}

/** PDF-derived matrix for Hever/Police. */
function detectHeverPdfProviderPreset(headers: string[]): VoucherMapping | null {
  if (!headerHas(headers, "מספר שובר")) return null;
  return {
    voucherNumber: "מספר שובר",
    packageType: findHeaderByAliases(headers, ["סוג שובר", "חבילה"]),
    guestName: null,
    amount: findHeaderByAliases(headers, ["סכום"]),
    purchaseDate: findHeaderByAliases(headers, ["תאריך מימוש"]),
  };
}

function applyEasygoProfilePreset(
  headers: string[],
  profile: VoucherProviderProfile | null,
): VoucherMapping | null {
  const mapping = buildPreset(headers, EASYGO_VOUCHER_ALIASES);
  if (!profile) {
    // Generic EZGO coupons export — prefer CouponNo, fall back to מזהה
    if (headerHas(headers, "CouponNo")) mapping.voucherNumber = "CouponNo";
    else if (headerHas(headers, "מזהה")) mapping.voucherNumber = "מזהה";
    if (headerHas(headers, "CouponDesc")) mapping.packageType = "CouponDesc";
    if (headerHas(headers, "שם לקוח")) mapping.guestName = "שם לקוח";
    if (headerHas(headers, "טלפון")) mapping.phone = "טלפון";
    if (headerHas(headers, "מס. הזמנה")) mapping.orderNumber = "מס. הזמנה";
    if (headerHas(headers, "מחיר")) mapping.amount = "מחיר";
    if (headerHas(headers, "ת. התחלה")) mapping.arrivalDate = "ת. התחלה";
  } else {
    if (headerHas(headers, profile.easygoVoucherHeader)) mapping.voucherNumber = profile.easygoVoucherHeader;
    if (headerHas(headers, profile.easygoPackageHeader)) mapping.packageType = profile.easygoPackageHeader;
    if (headerHas(headers, profile.easygoGuestHeader)) mapping.guestName = profile.easygoGuestHeader;
    if (headerHas(headers, profile.easygoPhoneHeader)) mapping.phone = profile.easygoPhoneHeader;
    if (headerHas(headers, profile.easygoOrderHeader)) mapping.orderNumber = profile.easygoOrderHeader;
    if (headerHas(headers, profile.easygoAmountHeader)) mapping.amount = profile.easygoAmountHeader;
    if (headerHas(headers, profile.easygoArrivalHeader)) mapping.arrivalDate = profile.easygoArrivalHeader;
  }
  return mapping.voucherNumber ? mapping : null;
}

export function detectVoucherEasygoPreset(
  headers: string[],
  providerName?: string | null,
): VoucherMapping | null {
  if (!headers?.length) return null;
  const profile = providerName ? resolveVoucherProviderProfile(providerName) : null;
  return applyEasygoProfilePreset(headers, profile);
}

export function detectVoucherProviderPreset(
  headers: string[],
  rows: VoucherRow[] = [],
  providerName?: string | null,
): VoucherMapping | null {
  if (!headers?.length) return null;

  const strategy = providerName ? resolveVoucherStrategy(providerName) : null;

  // Provider-selected strategy runs first — each report style on its own path.
  if (strategy) {
    switch (strategy.presetKind) {
      case "nofshonit": {
        const p = detectNofshonitProviderPreset(headers);
        if (p?.voucherNumber) return p;
        break;
      }
      case "multipass": {
        const p = detectMultipassProviderPreset(headers, rows);
        if (p?.voucherNumber) return p;
        break;
      }
      case "hever_pdf": {
        const p = detectHeverPdfProviderPreset(headers);
        if (p?.voucherNumber) return p;
        break;
      }
      default:
        break;
    }
  }

  const pdfPreset = detectHeverPdfProviderPreset(headers);
  if (pdfPreset?.voucherNumber) return pdfPreset;

  const nofshonit = detectNofshonitProviderPreset(headers);
  if (nofshonit?.voucherNumber) return nofshonit;

  const multipass = detectMultipassProviderPreset(headers, rows);
  if (multipass?.voucherNumber) return multipass;

  const mapping = buildPreset(headers, PROVIDER_VOUCHER_ALIASES);
  if (mapping.voucherNumber) return mapping;

  const profile = strategy?.profile ?? (providerName ? resolveVoucherProviderProfile(providerName) : null);
  if (profile?.easygoVoucherHeader && headerHas(headers, profile.easygoVoucherHeader)) {
    mapping.voucherNumber = profile.easygoVoucherHeader;
  }
  return mapping.voucherNumber ? mapping : null;
}

export function isVoucherMappingUsable(mapping: VoucherMapping | null | undefined): boolean {
  return !!(mapping && String(mapping.voucherNumber ?? "").trim());
}

const SUMMARY_ROW_RE = /סה[״"']?כ|total|סיכום/i;

/** Strip leading zeros for numeric id comparison (Nofshonit ת.ז.). */
export function normalizeVoucherIdDigits(raw: string): string {
  const digits = raw.replace(/[^0-9]/g, "");
  if (!digits) return raw;
  const trimmed = digits.replace(/^0+/, "") || "0";
  return trimmed;
}

/** Clean voucher number from Excel/CSV quirks (scientific notation, floats, spaces). */
export function normalizeVoucherNumber(raw: unknown): string | null {
  if (raw == null) return null;
  let s = String(raw).replace(INVISIBLE_RE, "").trim();
  if (!s) return null;
  if (SUMMARY_ROW_RE.test(s)) return null;

  // Trailing dots from EZGO (e.g. 027825629.)
  s = s.replace(/\.+$/, "");

  // Excel float artifact: 9998884321.0
  if (/^\d+\.0+$/.test(s)) s = s.replace(/\.0+$/, "");

  // Scientific notation from Excel
  if (/^\d+(\.\d+)?[eE][+-]?\d+$/.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n)) s = String(Math.trunc(n));
  }

  s = s.replace(/\s+/g, "").toUpperCase();
  return s.length ? s : null;
}

/** Compare voucher keys in application layer (mirrors DB voucher_numbers_match). */
export function voucherNumbersMatchLocal(
  matchMode: string,
  providerVoucher: string | null | undefined,
  easygoVoucher: string | null | undefined,
): boolean {
  const p = normalizeVoucherNumber(providerVoucher);
  const e = normalizeVoucherNumber(easygoVoucher);
  if (!p || !e) return false;

  const pAlnum = p.replace(/[^A-Z0-9]/g, "");
  const eAlnum = e.replace(/[^A-Z0-9]/g, "");
  if (!pAlnum || !eAlnum) return false;

  if (matchMode === "truncate_4") {
    if (eAlnum.length <= 4) return false;
    if (eAlnum === pAlnum) return true;
    if (left(eAlnum, eAlnum.length - 4) === pAlnum) return true;
    if (pAlnum.length === 4 && right(eAlnum, 4) === pAlnum) return true;
    return false;
  }

  if (matchMode === "suffix_5") {
    if (eAlnum.length >= 6 && pAlnum.length === 5 && right(eAlnum, 5) === pAlnum) return true;
    if (eAlnum === pAlnum) return true;
    if (normalizeVoucherIdDigits(eAlnum) === normalizeVoucherIdDigits(pAlnum)) return true;
    return false;
  }

  // exact — numeric ids tolerate leading zeros
  if (p === e) return true;
  if (pAlnum === eAlnum) return true;
  if (/^\d+$/.test(pAlnum) && /^\d+$/.test(eAlnum)) {
    return normalizeVoucherIdDigits(pAlnum) === normalizeVoucherIdDigits(eAlnum);
  }
  return false;
}

function left(s: string, n: number): string { return s.slice(0, n); }
function right(s: string, n: number): string { return s.slice(-n); }

/** Filter EasyGo rows to the selected voucher company. */
export function filterEasygoRowsByProvider(
  rows: VoucherRow[],
  providerName: string,
  companyHeader = "חברת שוברים",
): VoucherRow[] {
  const profile = resolveVoucherProviderProfile(providerName);
  if (!profile?.easygoCompanyPatterns.length) return rows;
  const patterns = profile.easygoCompanyPatterns;
  return rows.filter((row) => {
    const direct = String(row[companyHeader] ?? row["חברת שוברים"] ?? "").trim();
    if (direct && patterns.some((re) => re.test(direct))) return true;
    // Duplicate-header EZGO CSV — company name may land in any column value
    return Object.values(row).some((v) => {
      const s = String(v ?? "").trim();
      return s.length >= 4 && patterns.some((re) => re.test(s));
    });
  });
}

/** Normalize package label for fuzzy comparison (Hebrew variants). */
export function normalizePackageLabel(raw: unknown): string | null {
  if (raw == null) return null;
  let s = String(raw).replace(INVISIBLE_RE, "").trim().toLowerCase();
  if (!s) return null;
  s = s
    .replace(/[״"']/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*\+\s*/g, " ")
    .replace(/\s*ו\s*/g, " ")
    .replace(/[.,\-–—/\\|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return s.length ? s : null;
}

const CLASSIC_RE = /classic|קלאסיק|קלאסי/i;
const DELUXE_RE = /deluxe|דלקס|דלאקס/i;

/** Fuzzy package match — handles ו/+, spacing, classic/deluxe tiers, substring. */
export function packageTypesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizePackageLabel(a);
  const nb = normalizePackageLabel(b);
  if (!na || !nb) return true;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;

  const aClassic = CLASSIC_RE.test(na);
  const bClassic = CLASSIC_RE.test(nb);
  const aDeluxe = DELUXE_RE.test(na);
  const bDeluxe = DELUXE_RE.test(nb);
  if ((aClassic && bClassic) || (aDeluxe && bDeluxe)) return true;

  const ta = new Set(na.split(" ").filter((t) => t.length >= 2));
  const tb = new Set(nb.split(" ").filter((t) => t.length >= 2));
  if (!ta.size || !tb.size) return false;
  let overlap = 0;
  for (const t of ta) if (tb.has(t)) overlap++;
  const minSize = Math.min(ta.size, tb.size);
  return overlap >= minSize && overlap >= 1;
}

function rowHasData(row: VoucherRow): boolean {
  return Object.values(row).some((v) => String(v ?? "").trim().length > 0);
}

/** Parse one CSV line — supports quoted fields and doubled-quote escapes (`""`). */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i++;
        continue;
      }
      inQ = !inQ;
      continue;
    }
    if (c === "," && !inQ) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

/**
 * UTF-8 CSV → matrix. EZGO exports use BOM, embedded quotes in `בע"מ`, and
 * duplicate header names (`חברת שוברים` twice) — XLSX.read on .csv garbles Hebrew.
 */
export function csvUtf8BytesToMatrix(bytes: Uint8Array): unknown[][] {
  const text = new TextDecoder("utf-8").decode(bytes).replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (!lines.length) return [];
  const headerCells = parseCsvLine(lines[0]).map((h) => normalizeImportHeaderKey(h.replace(/^"|"$/g, "")));
  const colKeys = headerCells.map((h, i) => {
    const base = h || `col_${i}`;
    return headerCells.slice(0, i).filter((x) => x === h).length ? `${base}__${i}` : base;
  });
  const matrix: unknown[][] = [headerCells];
  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line).map((c) => c.replace(/^"|"$/g, ""));
    matrix.push(cells);
  }
  return matrix;
}

/** Build row objects from matrix; resolves duplicate EZGO headers (חברת שוברים, מזהה). */
export function matrixToVoucherRows(matrix: unknown[][]): { headers: string[]; rows: VoucherRow[] } {
  if (!matrix?.length) return { headers: [], rows: [] };
  const headerCells = (matrix[0] ?? []).map((c) => normalizeImportHeaderKey(c));
  const colKeys = headerCells.map((h, i) => {
    const base = h || `col_${i}`;
    return headerCells.slice(0, i).filter((x) => x === h).length ? `${base}__${i}` : base;
  });
  const rows = matrix.slice(1).map((row) => {
    const obj: VoucherRow = {};
    colKeys.forEach((h, col) => { obj[h] = (row as unknown[])?.[col] ?? ""; });
    const companyCols = colKeys.filter((k) => k === "חברת שוברים" || k.startsWith("חברת שוברים__"));
    if (companyCols.length) {
      const vals = companyCols.map((k) => String(obj[k] ?? "").trim()).filter(Boolean);
      obj["חברת שוברים"] = vals.find((v) => /נופשונית|חבר|שוטר|פיס|דולצ|hightech|הייטק/i.test(v)) ?? vals[vals.length - 1] ?? "";
    }
    const idCols = colKeys.filter((k) => k === "מזהה" || k.startsWith("מזהה__"));
    if (idCols.length) {
      const vals = idCols.map((k) => String(obj[k] ?? "").trim()).filter(Boolean);
      obj["מזהה"] = vals[vals.length - 1] ?? "";
    }
    return obj;
  }).filter(rowHasData);
  return { headers: headerCells, rows: normalizeRowKeys(rows) };
}

function matrixToObjects(matrix: unknown[][], headerCells: string[]): VoucherRow[] {
  return matrix
    .map((row) => {
      const obj: VoucherRow = {};
      headerCells.forEach((h, col) => { obj[h] = (row as unknown[])?.[col] ?? ""; });
      return obj;
    })
    .filter(rowHasData);
}

function normalizeRowKeys(rows: VoucherRow[]): VoucherRow[] {
  return rows.map((row) => {
    const out: VoucherRow = {};
    for (const [k, v] of Object.entries(row ?? {})) {
      out[normalizeImportHeaderKey(k)] = v;
    }
    return out;
  });
}

type PresetDetector = (headers: string[]) => VoucherMapping | null;

/**
 * Scan first rows for a header line that matches voucher column presets.
 * EZGO/provider exports often have title rows before the real header.
 */
export function matrixRowsFromVoucherHeaderScan(
  matrix: unknown[][],
  detectPreset: PresetDetector,
  maxScan = 30,
): { headers: string[]; rows: VoucherRow[]; headerIdx: number } | null {
  if (!matrix?.length) return null;
  const limit = Math.min(matrix.length, maxScan);
  for (let i = 0; i < limit; i++) {
    const headerCells = (matrix[i] ?? []).map((c) => normalizeImportHeaderKey(c));
    if (!headerCells.some(Boolean)) continue;
    if (!detectPreset(headerCells)) continue;
    const rows = normalizeRowKeys(matrixToObjects(matrix.slice(i + 1), headerCells));
    return { headers: headerCells, rows, headerIdx: i };
  }
  return null;
}

export function filterVoucherDataRows(rows: VoucherRow[], mapping: VoucherMapping): VoucherRow[] {
  const voucherCol = mapping.voucherNumber;
  return rows.filter((row) => {
    if (!rowHasData(row)) return false;
    if (!voucherCol) return true;
    const vn = normalizeVoucherNumber(row[voucherCol]);
    if (!vn) {
      const hasOther = !!(mapping.packageType && String(row[mapping.packageType] ?? "").trim())
        || !!(mapping.guestName && String(row[mapping.guestName] ?? "").trim());
      return hasOther;
    }
    return !SUMMARY_ROW_RE.test(vn);
  });
}

/** Quality gate — warn when mapping missed the voucher column for most rows. */
export function assessVoucherParseQuality(
  rows: VoucherRow[],
  mapping: VoucherMapping,
): { ok: boolean; parsedRatio: number; message?: string } {
  const col = mapping.voucherNumber;
  if (!col || !rows.length) {
    return { ok: false, parsedRatio: 0, message: "לא זוהתה עמודת מספר שובר בקובץ" };
  }
  let parsed = 0;
  for (const row of rows) {
    if (normalizeVoucherNumber(row[col])) parsed++;
  }
  const ratio = parsed / rows.length;
  if (ratio < 0.3) {
    return {
      ok: false,
      parsedRatio: ratio,
      message: `רק ${Math.round(ratio * 100)}% מהשורות מכילות מספר שובר — ייתכן שמיפוי העמודות שגוי`,
    };
  }
  return { ok: true, parsedRatio: ratio };
}

type MappedVoucherRow = { voucher_number: string | null; package_type: string | null };

function mapSideForJoin(
  rows: VoucherRow[],
  mapping: VoucherMapping,
): MappedVoucherRow[] {
  const vCol = mapping.voucherNumber;
  const pCol = mapping.packageType;
  return rows.map((row) => ({
    voucher_number: vCol ? normalizeVoucherNumber(row[vCol]) : null,
    package_type: pCol ? String(row[pCol] ?? "").trim() || null : null,
  }));
}

/**
 * Pre-flight join estimate — catches wrong column mapping before DB write.
 */
export function estimateReconciliationJoin(
  providerRows: VoucherRow[],
  easygoRows: VoucherRow[],
  providerMapping: VoucherMapping,
  easygoMapping: VoucherMapping,
  matchMode: string,
): {
  providerSample: number;
  providerHits: number;
  hitRate: number;
  packageMismatches: number;
  ok: boolean;
  warning?: string;
} {
  const prov = mapSideForJoin(providerRows, providerMapping).filter((r) => r.voucher_number);
  const ez = mapSideForJoin(easygoRows, easygoMapping).filter((r) => r.voucher_number);

  if (!prov.length || !ez.length) {
    return {
      providerSample: prov.length,
      providerHits: 0,
      hitRate: 0,
      packageMismatches: 0,
      ok: false,
      warning: "אין מספיק שורות עם מספר שובר לבדיקת הצלבה",
    };
  }

  const sample = prov.slice(0, Math.min(prov.length, 40));
  let hits = 0;
  let pkgMismatch = 0;

  for (const p of sample) {
    const candidates = ez.filter((e) =>
      voucherNumbersMatchLocal(matchMode, p.voucher_number, e.voucher_number)
    );
    if (!candidates.length) continue;
    hits++;
    const partner = candidates[0];
    if (
      p.package_type && partner.package_type
      && !packageTypesMatch(p.package_type, partner.package_type)
    ) {
      pkgMismatch++;
    }
  }

  const hitRate = sample.length ? hits / sample.length : 0;
  const ok = hitRate >= 0.15 || sample.length < 5;

  return {
    providerSample: sample.length,
    providerHits: hits,
    hitRate,
    packageMismatches: pkgMismatch,
    ok,
    warning: ok
      ? undefined
      : `רק ${Math.round(hitRate * 100)}% משורות הספק (${hits}/${sample.length}) נמצאו באיזיגו — ייתכן שמיפוי העמודות או בחירת הספק שגויים`,
  };
}

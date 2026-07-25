// EZGO Suite / arrivals CSV attachment parser for mail sync (Doc2 workflow).

import {
  extractPhoneFromOpsText,
  parseSlashDate,
  sanitizeE164,
} from "./ezgoDoc1Parser.ts";
import type { Doc2Record } from "./ezgoDoc2Parser.ts";
import {
  isPremiumDayRoom,
  resolveSuiteRoomFromEzgoLabel,
} from "./suiteNames.ts";

const IL_MOBILE_RE = /(0(?:5[0-9])[-. ]?\d{3}[-. ]?\d{4})(?!\d)/g;
const DUMMY_DATE_RE = /^01[/.-]01[/.-](1900|1970|2001)/;

const EZGO_CORE_HEADERS = [
  "iOrderId",
  "sTel1",
  "sRemark",
  "sClientFullName",
  "sSubItemName",
  "sRoomName",
] as const;

const EZGO_LINE_ID_HEADERS = ["iReservationsLineId", "iResLineId", "KIDrowID", "LineIndex", "SUBitemid", "SUBItemId"] as const;

/** EZGO sometimes exports ItemID / SUBItemName instead of iOrderId / sSubItemName. */
const EZGO_HEADER_ALIASES: Record<string, string[]> = {
  iOrderId: ["iOrderId", "ItemID", "OrderID", "OrderId"],
  sSubItemName: ["sSubItemName", "SUBItemName", "SubItemName"],
  sRoomName: ["sRoomName", "RoomName", "sRoom"],
  sClientFullName: ["sClientFullName", "ClientFullName", "sGroupName"],
  sTel1: ["sTel1", "Tel1", "sPhone"],
  sRemark: ["sRemark", "Remark", "sComments"],
  KIDrowID: ["KIDrowID", "KIDRowID"],
  LineIndex: ["LineIndex", "lineindex"],
  SUBitemid: ["SUBitemid", "SUBItemId", "SUBItemID"],
};

export type SuiteCsvColumnMapping = Record<string, string>;

function normalizeHeaderKey(raw: unknown): string {
  return String(raw ?? "")
    .replace(/[\u200B-\u200F\u202A-\u202E\uFEFF]/g, "")
    .trim();
}

function findHeaderKey(headers: string[], canonical: string): string | null {
  const aliases = EZGO_HEADER_ALIASES[canonical] ?? [canonical];
  for (const alias of aliases) {
    const want = normalizeHeaderKey(alias).toLowerCase();
    for (const h of headers) {
      if (normalizeHeaderKey(h).toLowerCase() === want) return normalizeHeaderKey(h);
    }
  }
  return null;
}

function resolveEzgoHeaderKeys(headers: string[]): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const name of EZGO_CORE_HEADERS) {
    const key = findHeaderKey(headers, name);
    if (!key) return null;
    out[name] = key;
  }
  let resLineKey: string | null = null;
  for (const alias of EZGO_LINE_ID_HEADERS) {
    resLineKey = findHeaderKey(headers, alias);
    if (resLineKey) break;
  }
  if (!resLineKey) return null;
  out.resLineId = resLineKey;
  return out;
}

export function detectEzgoArrivalsPreset(headers: string[]): SuiteCsvColumnMapping | null {
  const keys = resolveEzgoHeaderKeys(headers);
  if (!keys) return null;
  const mapping: SuiteCsvColumnMapping = {
    orderNumber: keys.iOrderId,
    resLineId: keys.resLineId,
    coordName: keys.sClientFullName,
    coordPhone: keys.sTel1,
    remark: keys.sRemark,
    suiteType: keys.sSubItemName,
    roomName: keys.sRoomName,
    groupId: findHeaderKey(headers, "Group_Id") ?? "Group_Id",
    nights: findHeaderKey(headers, "iNights") ?? "iNights",
    price: findHeaderKey(headers, "cPrice") ?? "cPrice",
  };
  const opRemark = findHeaderKey(headers, "sOperationRemark");
  const arrival = findHeaderKey(headers, "dtCheckIn");
  if (opRemark) mapping.opRemark = opRemark;
  if (arrival) mapping.arrivalDate = arrival;
  return mapping;
}

/** EZGO exports with LineIndex/ItemID/SUBItemName but non-standard column names. */
export function detectEzgoLooseArrivalsPreset(headers: string[]): SuiteCsvColumnMapping | null {
  const orderKey = findHeaderKey(headers, "iOrderId");
  const suiteKey = findHeaderKey(headers, "sSubItemName");
  if (!orderKey || !suiteKey) return null;

  let resLineKey: string | null = null;
  for (const alias of EZGO_LINE_ID_HEADERS) {
    resLineKey = findHeaderKey(headers, alias);
    if (resLineKey) break;
  }
  if (!resLineKey) return null;

  const coordName = findHeaderKey(headers, "sClientFullName");
  const remark = findHeaderKey(headers, "sRemark");
  const tel = findHeaderKey(headers, "sTel1");
  const room = findHeaderKey(headers, "sRoomName");
  if (!coordName && !remark && !tel) return null;

  const mapping: SuiteCsvColumnMapping = {
    orderNumber: orderKey,
    resLineId: resLineKey,
    coordName: coordName ?? remark ?? orderKey,
    coordPhone: tel ?? "",
    remark: remark ?? "",
    suiteType: suiteKey,
    roomName: room ?? "",
    groupId: findHeaderKey(headers, "Group_Id") ?? "Group_Id",
    nights: findHeaderKey(headers, "iNights") ?? "iNights",
    price: findHeaderKey(headers, "cPrice") ?? "cPrice",
  };
  const arrival = findHeaderKey(headers, "dtCheckIn");
  if (arrival) mapping.arrivalDate = arrival;
  return mapping;
}

export function detectSuiteArrivalsPreset(headers: string[]): SuiteCsvColumnMapping | null {
  const set = new Set(headers.map(normalizeHeaderKey));
  if (!set.has("מקור הגעה") || !set.has("שם מלא") || !set.has("טלפון")
    || !set.has("מס. הזמנה") || !set.has("מס. לקוח") || !set.has("ת. התחלה")) {
    return null;
  }
  const priceCol = headers.find((h) => {
    const n = normalizeHeaderKey(h);
    return n === "מחיר" || /^מחיר/.test(n);
  });
  return {
    orderNumber: "מס. הזמנה",
    resLineId: "מס. לקוח",
    coordName: "שם מלא",
    coordPhone: "טלפון",
    guestPhone: "טלפון",
    roomName: "חדרים",
    nights: "לילות",
    price: priceCol ? normalizeHeaderKey(priceCol) : "מחיר",
    arrivalDate: "ת. התחלה",
    leadSource: "מקור הגעה",
  };
}

function cleanCsvCell(raw: string): string {
  return String(raw ?? "").replace(/\r/g, "").trim();
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let inQuotes = false;
  const s = String(line ?? "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      continue;
    }
    if (c === ",") {
      fields.push(cleanCsvCell(field));
      field = "";
      continue;
    }
    field += c;
  }
  fields.push(cleanCsvCell(field));
  return fields;
}

export function parseCsvText(text: string): string[][] {
  const normalized = String(text ?? "").replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let line = "";
  let inQuotes = false;
  for (let i = 0; i < normalized.length; i++) {
    const c = normalized[i];
    if (c === '"') {
      inQuotes = !inQuotes;
      line += c;
      continue;
    }
    if (!inQuotes && (c === "\n" || (c === "\r" && normalized[i + 1] === "\n"))) {
      if (c === "\r") i++;
      if (line.trim()) rows.push(parseCsvLine(line));
      line = "";
      continue;
    }
    line += c;
  }
  if (line.trim()) rows.push(parseCsvLine(line));
  return rows;
}

function normalizeImportRows(rows: Record<string, unknown>[]): Record<string, string>[] {
  return rows.map((row) => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(row ?? {})) {
      out[normalizeHeaderKey(k)] = String(v ?? "");
    }
    return out;
  });
}

export function matrixRowsFromHeaderScan(matrix: string[][], maxScan = 50): {
  rows: Record<string, string>[];
  headerIdx: number;
} | null {
  if (!matrix?.length) return null;
  const limit = Math.min(matrix.length, maxScan);
  for (let i = 0; i < limit; i++) {
    const headerCells = (matrix[i] ?? []).map((c) => normalizeHeaderKey(c));
    if (!headerCells.some(Boolean)) continue;
    if (!detectEzgoArrivalsPreset(headerCells)
      && !detectSuiteArrivalsPreset(headerCells)
      && !detectEzgoLooseArrivalsPreset(headerCells)) continue;
    const rows = matrix.slice(i + 1)
      .map((row) => {
        const obj: Record<string, string> = {};
        headerCells.forEach((h, col) => { obj[h] = row?.[col] ?? ""; });
        return obj;
      })
      .filter((row) => Object.values(row).some((v) => String(v ?? "").trim()));
    return { rows: normalizeImportRows(rows), headerIdx: i };
  }
  return null;
}

export function parseDateFromCsvFilename(filename: string): string | null {
  const base = String(filename || "").replace(/\.(csv|xlsx|xls|txt)$/i, "");
  const m = base.match(/(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})/);
  if (!m) return null;
  const [, d, mo, yRaw] = m;
  let y = Number(yRaw);
  if (y < 100) y += 2000;
  const iso = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null;
}

function parseArrivalDateCell(raw: unknown): string | null {
  if (raw == null || raw === "") return null;
  const s = String(raw).trim();
  if (!s || DUMMY_DATE_RE.test(s)) return null;
  const slash = parseSlashDate(s);
  if (slash) return slash;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return null;
}

function extractPhonesFromText(text: string): string[] {
  const out: string[] = [];
  const s = String(text || "");
  for (const m of s.matchAll(IL_MOBILE_RE)) {
    const e164 = sanitizeE164(extractPhoneFromOpsText(m[1]) || m[1]);
    if (e164 && !out.includes(e164)) out.push(e164);
  }
  return out;
}

function extractNameFromRemark(remark: string): string | null {
  const s = String(remark || "").trim();
  if (!s) return null;
  const phones = extractPhonesFromText(s);
  let name = s;
  for (const p of phones) {
    name = name.replace(p, "").replace(/0\d{2}[-. ]?\d{3}[-. ]?\d{4}/g, "");
  }
  name = name.replace(/[,;|]+/g, " ").replace(/\s+/g, " ").trim();
  return name || null;
}

function isDummyPhone(phone: string | null): boolean {
  if (!phone) return true;
  const digits = phone.replace(/\D/g, "");
  return digits.length < 9 || /^0{9,}$/.test(digits);
}

function normalizeCoordPhone(raw: string): string | null {
  const s = String(raw || "").trim();
  if (!s) return null;
  const normalized = /^\d{9}$/.test(s) && s.startsWith("5") ? `0${s}` : s;
  return sanitizeE164(extractPhoneFromOpsText(normalized) || normalized);
}

type ExtractedRow = {
  orderNumber: string;
  guestName: string | null;
  guestPhone: string | null;
  roomName: string;
  suiteType: string;
  nights: number | null;
  arrivalDate: string | null;
  groupId: number;
};

function extractSuiteRow(
  row: Record<string, string>,
  mapping: SuiteCsvColumnMapping,
  coordNameDuplicated: boolean,
  fallbackDate: string | null,
): ExtractedRow | null {
  const val = (role: string) => {
    const h = mapping[role];
    return h ? String(row[h] ?? "").trim() : "";
  };

  const orderNumber = val("orderNumber");
  if (!orderNumber) return null;

  const roomName = val("roomName");
  const suiteType = val("suiteType");
  const coordName = val("coordName") || null;
  const remark = val("remark");
  const opRemark = val("opRemark");
  const coordPhone = normalizeCoordPhone(val("coordPhone"));
  const directPhone = normalizeCoordPhone(val("guestPhone") || val("coordPhone"));
  const nightsRaw = parseInt(val("nights") || "0", 10);
  const nights = Number.isFinite(nightsRaw) ? nightsRaw : null;
  const groupId = parseInt(val("groupId") || "0", 10) || 0;
  const arrivalDate = parseArrivalDateCell(val("arrivalDate")) ?? fallbackDate;

  const remarkPhones = extractPhonesFromText(remark);
  const remarkName = coordNameDuplicated ? extractNameFromRemark(remark) ?? extractNameFromRemark(opRemark) : null;

  let guestPhone: string | null = null;
  let guestName: string | null = coordName;

  if (coordNameDuplicated) {
    if (remarkPhones.length > 0 && remarkName) {
      guestPhone = remarkPhones[0];
      guestName = remarkName;
    } else if (remarkName && directPhone && !isDummyPhone(directPhone)) {
      guestPhone = directPhone;
      guestName = remarkName;
    } else if (directPhone && !isDummyPhone(directPhone)) {
      guestPhone = directPhone;
    } else if (remarkPhones.length > 0) {
      guestPhone = remarkPhones[0];
    } else if (coordPhone && !isDummyPhone(coordPhone)) {
      guestPhone = coordPhone;
    }
  } else if (directPhone && !isDummyPhone(directPhone)) {
    guestPhone = directPhone;
  } else if (coordPhone && !isDummyPhone(coordPhone)) {
    guestPhone = coordPhone;
  }

  if (!guestName && !guestPhone && !roomName && !suiteType) return null;

  return {
    orderNumber,
    guestName,
    guestPhone,
    roomName,
    suiteType,
    nights,
    arrivalDate,
    groupId,
  };
}

function buildRoomRaw(suiteType: string, roomName: string): string | null {
  const suite = String(suiteType || "").trim();
  const room = String(roomName || "").trim();
  if (suite && room) return `${suite} ${room}`.trim();
  return suite || room || null;
}

function extractedToDoc2Record(extracted: ExtractedRow): Doc2Record {
  const room_raw = buildRoomRaw(extracted.suiteType, extracted.roomName);
  const room = resolveSuiteRoomFromEzgoLabel(room_raw);
  const is_premium_day = isPremiumDayRoom(room);
  const is_day_guest = extracted.groupId === 1
    || extracted.nights === 0
    || room === "בילוי יומי"
    || is_premium_day
    || /premium\s*day|בילוי.*יומי/i.test(extracted.suiteType);

  let departure_date: string | null = null;
  if (extracted.arrivalDate && extracted.nights != null && extracted.nights > 0) {
    const d = new Date(`${extracted.arrivalDate}T12:00:00`);
    d.setDate(d.getDate() + extracted.nights);
    departure_date = d.toISOString().slice(0, 10);
  }

  return {
    _report: "doc2",
    section: "arrival",
    order_number: extracted.orderNumber,
    room_raw,
    room: room || null,
    board_basis: null,
    meal_location: null,
    arrival_time: null,
    nights: extracted.nights,
    guest_count: null,
    guest_name: extracted.guestName,
    phone: extracted.guestPhone,
    amount: null,
    notes: null,
    arrival_date: extracted.arrivalDate,
    departure_date,
    is_day_guest,
    is_premium_day,
  };
}

export function looksLikeSuiteArrivalsCsv(text: string): boolean {
  const matrix = parseCsvText(text);
  if (!matrix.length) return false;
  const limit = Math.min(matrix.length, 50);
  for (let i = 0; i < limit; i++) {
    const headers = (matrix[i] ?? []).map((c) => normalizeHeaderKey(c));
    if (detectEzgoArrivalsPreset(headers)
      || detectSuiteArrivalsPreset(headers)
      || detectEzgoLooseArrivalsPreset(headers)) return true;
  }
  return false;
}

export function parseSuiteArrivalsCsvText(
  text: string,
  filename = "attachment.csv",
): Doc2Record[] {
  const matrix = parseCsvText(text);
  const scanned = matrixRowsFromHeaderScan(matrix);
  if (!scanned?.rows.length) return [];

  const headerCells = matrix[scanned.headerIdx].map((c) => normalizeHeaderKey(c));
  const mapping = detectEzgoArrivalsPreset(headerCells)
    || detectSuiteArrivalsPreset(headerCells)
    || detectEzgoLooseArrivalsPreset(headerCells);
  if (!mapping) return [];

  const fallbackDate = parseDateFromCsvFilename(filename);
  const coordKey = mapping.coordName;
  const nameCounts = new Map<string, number>();
  if (coordKey) {
    for (const row of scanned.rows) {
      const name = String(row[coordKey] ?? "").trim();
      if (!name) continue;
      nameCounts.set(name, (nameCounts.get(name) || 0) + 1);
    }
  }

  const records: Doc2Record[] = [];
  for (const row of scanned.rows) {
    const coordName = coordKey ? String(row[coordKey] ?? "").trim() : "";
    const coordNameDuplicated = coordName ? (nameCounts.get(coordName) || 0) > 1 : false;
    const extracted = extractSuiteRow(row, mapping, coordNameDuplicated, fallbackDate);
    if (!extracted) continue;
    records.push(extractedToDoc2Record(extracted));
  }
  return records;
}

export function parseSuiteArrivalsCsvBuffer(
  data: Uint8Array,
  filename = "attachment.csv",
): Doc2Record[] {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(data);
  return parseSuiteArrivalsCsvText(text, filename);
}

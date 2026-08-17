// Live occupancy forecast (דוח צפי) — suites from guests, day packages from Operations HTML.

import { israelLocalHour, israelYmd } from "./automationSchedule.ts";
import {
  classifyOpsRow,
  extractOpsTableRows,
  sumSpaTreatmentsFromExtras,
  type OpsPackageRow,
} from "./forecastOpsClassify.ts";
import { isEffectiveDayPassGuest, isEffectiveSuiteGuest } from "./suiteNames.ts";
import { sendWhapiTextGuarded } from "./whapiVelocityGuard.ts";
import { cleanPhoneForMention } from "./whapiSend.ts";

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

export const FORECAST_CONFIG_KEY = "forecast_daily";
export const FORECAST_PAGE_PATH = "/?page=forecast_daily";
export const FORECAST_APP_ORIGIN = "https://dream-ai-system.vercel.app";

export type ForecastGroupRow = {
  name: string;
  arrival: string;
  entry: string;
  meals: string;
  qty: number;
};

export type ForecastDailyConfig = {
  enabled: boolean;
  send_hour: number;
  yelena_phone: string;
  last_sent_ymd: string;
  groups_by_date: Record<string, ForecastGroupRow[]>;
};

export type ForecastPackageCount = { label: string; guests: number };

export type ForecastReport = {
  prepDate: string;
  targetDate: string;
  morning: ForecastPackageCount[];
  morningTotal: number;
  evening: ForecastPackageCount[];
  eveningTotal: number;
  groups: ForecastGroupRow[];
  groupsTotal: number;
  arrivals: { rooms: number; guests: number };
  departures: { rooms: number; guests: number };
  stayovers: { rooms: number; guests: number };
  capsules: { rooms: number; guests: number };
  totalWithDepartures: number;
  totalOnSite: number;
  spaTreatments: number | null;
  meals: {
    breakfast: { suites: number | null; resort: number | null; groups: number | null };
    lunch: { suites: number | null; resort: number | null; groups: number | null };
    dinner: { suites: number | null; resort: number | null; groups: number | null };
  };
  sources: {
    operationsIngestId: string | null;
    operationsReceivedAt: string | null;
    guestsScanned: number;
    missingOperations: boolean;
    missingDoc2: boolean;
    doc2IngestId: string | null;
    doc2PendingLines: number;
    doc2Arrivals: { rooms: number; guests: number } | null;
    doc2Departures: { rooms: number; guests: number } | null;
    doc2Capsules: { rooms: number; guests: number } | null;
    suiteArrivalGap: boolean;
    ezgoDirectGroup: { rooms: number; guests: number } | null;
    ezgoSegmentUnmapped: number;
    ezgoSegmentUnmappedIds: number;
  };
  notes: string[];
};

const DEFAULT_CONFIG: ForecastDailyConfig = {
  enabled: true,
  send_hour: 21,
  yelena_phone: "",
  last_sent_ymd: "",
  groups_by_date: {},
};

export function addYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function defaultForecastDates(now = new Date()): { prepDate: string; targetDate: string } {
  const prepDate = israelYmd(now);
  return { prepDate, targetDate: addYmd(prepDate, 1) };
}

export function parseForecastConfig(raw: unknown): ForecastDailyConfig {
  const o = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const hour = Number(o.send_hour);
  const groupsIn = o.groups_by_date && typeof o.groups_by_date === "object"
    ? o.groups_by_date as Record<string, unknown>
    : {};
  const groups_by_date: Record<string, ForecastGroupRow[]> = {};
  for (const [k, v] of Object.entries(groupsIn)) {
    if (!Array.isArray(v)) continue;
    groups_by_date[k] = v.map((g) => {
      const row = g && typeof g === "object" ? g as Record<string, unknown> : {};
      return {
        name: String(row.name ?? "").trim(),
        arrival: String(row.arrival ?? "").trim(),
        entry: String(row.entry ?? row.spa ?? "").trim(),
        meals: String(row.meals ?? "").trim(),
        qty: Math.max(0, parseInt(String(row.qty ?? "0"), 10) || 0),
      };
    }).filter((g) => g.name || g.qty);
  }
  return {
    enabled: o.enabled !== false,
    send_hour: Number.isFinite(hour) && hour >= 0 && hour <= 23 ? Math.round(hour) : 21,
    yelena_phone: String(o.yelena_phone ?? "").replace(/\D/g, ""),
    last_sent_ymd: String(o.last_sent_ymd ?? "").trim(),
    groups_by_date,
  };
}

function addPair(a: { rooms: number; guests: number }, b: { rooms: number; guests: number }) {
  a.rooms += b.rooms;
  a.guests += b.guests;
}

export function forecastDeepLink(): string {
  return `${FORECAST_APP_ORIGIN}${FORECAST_PAGE_PATH}`;
}

export function paxFromDoc2GuestCount(raw: unknown, fallback = 2): number {
  const n = parseInt(String(raw ?? "").replace(/[^\d]/g, ""), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function summarizeDoc2MailOccupancy(
  records: Array<{
    section?: string | null;
    room?: string | null;
    room_raw?: string | null;
    guest_count?: string | null;
    is_day_guest?: boolean;
    is_premium_day?: boolean;
  }>,
): {
  arrivals: { rooms: number; guests: number };
  departures: { rooms: number; guests: number };
  capsules: { rooms: number; guests: number };
} {
  const arrivals = { rooms: 0, guests: 0 };
  const departures = { rooms: 0, guests: 0 };
  const capsules = { rooms: 0, guests: 0 };
  const seenArr = new Set<string>();
  const seenDep = new Set<string>();
  const seenCap = new Set<string>();
  records.forEach((rec, i) => {
    const section = String(rec.section ?? "arrival");
    const pax = paxFromDoc2GuestCount(rec.guest_count);
    const key = String(rec.room || rec.room_raw || `line-${i}`).trim() || `line-${i}`;
    const day = rec.is_day_guest === true || rec.is_premium_day === true;
    if (section === "departure") {
      if (seenDep.has(key)) return;
      seenDep.add(key);
      addPair(departures, { rooms: 1, guests: pax });
      return;
    }
    if (day) {
      if (seenCap.has(key)) return;
      seenCap.add(key);
      addPair(capsules, { rooms: 1, guests: pax });
      return;
    }
    if (seenArr.has(key)) return;
    seenArr.add(key);
    addPair(arrivals, { rooms: 1, guests: pax });
  });
  return { arrivals, departures, capsules };
}

export function mergeForecastGroups(
  opsGroups: Array<{ qty: number }>,
  saved: ForecastGroupRow[],
): ForecastGroupRow[] {
  const blank = (qty: number): ForecastGroupRow => ({
    name: "",
    arrival: "09:00",
    entry: "קבלה",
    meals: "",
    qty,
  });
  const opsTotal = opsGroups.reduce((s, g) => s + (g.qty || 0), 0);
  const savedNamed = saved.filter((g) => g.name || g.qty);
  const savedTotal = savedNamed.reduce((s, g) => s + (g.qty || 0), 0);
  if (opsGroups.length === 0) return savedNamed;
  if (savedNamed.length > 0 && savedTotal === opsTotal) return savedNamed;
  if (savedNamed.length === opsGroups.length) {
    return opsGroups.map((o, i) => ({ ...savedNamed[i], qty: o.qty }));
  }
  if (savedNamed.length === 0) return opsGroups.map((o) => blank(o.qty));
  const n = Math.max(savedNamed.length, opsGroups.length);
  const out: ForecastGroupRow[] = [];
  for (let i = 0; i < n; i++) {
    const o = opsGroups[i];
    const s = savedNamed[i];
    if (o && s) out.push({ ...s, qty: o.qty });
    else if (o) out.push(blank(o.qty));
    else if (s) out.push(s);
  }
  return out;
}

export function composeForecastPingText(report: ForecastReport): string {
  const missing = report.sources.missingOperations ? "\n⚠ דוח תפעול ליום היעד לא נמצא במייל — בדקי בלוח." : "";
  const gap = report.sources.suiteArrivalGap ? "\n⚠ פער הגעות סוויטות מול דוח כניסות — אשרי שורות במייל EZGO." : "";
  return [
    `דוח צפי ל-${report.targetDate}`,
    `סה״כ במתחם: ${report.totalOnSite} · כולל עזיבות: ${report.totalWithDepartures}`,
    report.spaTreatments == null ? "ספא: לא נמצא מידע" : `ספא (טיפולים): ${report.spaTreatments}`,
    "לצפייה בדוח החי בממשק — ההודעה הבאה היא הקישור.",
    missing,
    gap,
  ].filter(Boolean).join("\n");
}

type GuestRow = {
  id: number;
  room: string | null;
  room_type: string | null;
  status: string | null;
  arrival_date: string | null;
  departure_date: string | null;
  order_number: string | null;
  meal_plan: string | null;
  sales_segment_kind?: string | null;
};

function ymd(v: unknown): string {
  return String(v ?? "").slice(0, 10);
}

function paxFromRooms(rooms: Array<{ adults?: unknown }>, fallback = 2): { rooms: number; guests: number } {
  if (!rooms.length) return { rooms: 1, guests: fallback };
  const guests = rooms.reduce((s, r) => {
    const n = Number(r.adults);
    return s + (Number.isFinite(n) && n > 0 ? n : 1);
  }, 0);
  return { rooms: rooms.length, guests };
}

export function classifySuiteOccupancy(
  guests: GuestRow[],
  roomsByGuest: Map<number, Array<{ adults?: unknown }>>,
  targetDate: string,
): {
  arrivals: { rooms: number; guests: number };
  departures: { rooms: number; guests: number };
  stayovers: { rooms: number; guests: number };
  capsules: { rooms: number; guests: number };
  suiteOrderNumbers: Set<string>;
  breakfast: number;
  dinner: number;
} {
  const arrivals = { rooms: 0, guests: 0 };
  const departures = { rooms: 0, guests: 0 };
  const stayovers = { rooms: 0, guests: 0 };
  const capsules = { rooms: 0, guests: 0 };
  const suiteOrderNumbers = new Set<string>();
  let breakfast = 0;
  let dinner = 0;

  for (const g of guests) {
    if (String(g.status ?? "") === "cancelled") continue;
    const arr = ymd(g.arrival_date);
    const dep = ymd(g.departure_date);
    const pair = paxFromRooms(roomsByGuest.get(g.id) ?? [], 2);
    const plan = String(g.meal_plan ?? "");
    const eatsDinner = plan === "half_board" || plan === "full_board" || plan === "dinner_only";

    if (isEffectiveDayPassGuest(g) && arr === targetDate) {
      addPair(capsules, pair);
      continue;
    }
    if (!isEffectiveSuiteGuest(g)) continue;
    if (g.order_number) suiteOrderNumbers.add(String(g.order_number));

    if (arr === targetDate) {
      addPair(arrivals, pair);
      if (eatsDinner) dinner += pair.guests;
      continue;
    }
    if (dep === targetDate) {
      addPair(departures, pair);
      breakfast += pair.guests;
      continue;
    }
    if (arr && arr < targetDate && (!dep || dep > targetDate)) {
      addPair(stayovers, pair);
      breakfast += pair.guests;
      if (eatsDinner) dinner += pair.guests;
    }
  }

  return { arrivals, departures, stayovers, capsules, suiteOrderNumbers, breakfast, dinner };
}

export function countDirectGroupOccupancy(
  guests: GuestRow[],
  roomsByGuest: Map<number, Array<{ adults?: unknown }>>,
  targetDate: string,
): { rooms: number; guests: number } {
  const out = { rooms: 0, guests: 0 };
  for (const g of guests) {
    if (String(g.status ?? "") === "cancelled") continue;
    if (g.sales_segment_kind !== "direct_group") continue;
    const arr = ymd(g.arrival_date);
    const dep = ymd(g.departure_date);
    const onDay = arr === targetDate || dep === targetDate
      || (arr && arr < targetDate && (!dep || dep > targetDate));
    if (!onDay) continue;
    addPair(out, paxFromRooms(roomsByGuest.get(g.id) ?? [], 2));
  }
  return out;
}

function sumSpaTreatmentsFromOps(rows: OpsPackageRow[]): number {
  let n = 0;
  for (const row of rows) n += sumSpaTreatmentsFromExtras(row.extras);
  return n;
}

function rollPackages(rows: OpsPackageRow[], dayPart: "morning" | "evening"): ForecastPackageCount[] {
  const map = new Map<string, ForecastPackageCount>();
  for (const row of rows) {
    if (row.dayPart !== dayPart) continue;
    const prev = map.get(row.bucket);
    if (prev) prev.guests += row.guests;
    else map.set(row.bucket, { label: row.label, guests: row.guests });
  }
  return [...map.values()].sort((a, b) => b.guests - a.guests);
}

export function shouldDispatchForecastPing(
  cfg: ForecastDailyConfig,
  now: Date,
): { due: boolean; reason: string } {
  if (!cfg.enabled) return { due: false, reason: "disabled" };
  const phone = cleanPhoneForMention(cfg.yelena_phone);
  if (phone.length < 10) return { due: false, reason: "missing_phone" };
  if (israelLocalHour(now) !== cfg.send_hour) return { due: false, reason: "wrong_hour" };
  const today = israelYmd(now);
  if (cfg.last_sent_ymd === today) return { due: false, reason: "already_sent" };
  return { due: true, reason: "due" };
}

async function loadConfig(supabase: SupabaseClient): Promise<ForecastDailyConfig> {
  const { data } = await supabase
    .from("bot_config")
    .select("config_value")
    .eq("config_key", FORECAST_CONFIG_KEY)
    .maybeSingle();
  let raw: unknown = data?.config_value;
  if (typeof raw === "string") {
    try { raw = JSON.parse(raw); } catch { raw = {}; }
  }
  return parseForecastConfig(raw);
}

export async function saveForecastConfig(
  supabase: SupabaseClient,
  patch: Partial<ForecastDailyConfig>,
): Promise<ForecastDailyConfig> {
  const current = await loadConfig(supabase);
  const next: ForecastDailyConfig = {
    ...current,
    ...patch,
    yelena_phone: patch.yelena_phone != null
      ? String(patch.yelena_phone).replace(/\D/g, "")
      : current.yelena_phone,
    groups_by_date: patch.groups_by_date ?? current.groups_by_date,
  };
  const { error } = await supabase.from("bot_config").upsert(
    { config_key: FORECAST_CONFIG_KEY, config_value: JSON.stringify(next) },
    { onConflict: "config_key" },
  );
  if (error) throw new Error(error.message);
  return next;
}

async function fetchAllGuests(supabase: SupabaseClient): Promise<GuestRow[]> {
  const out: GuestRow[] = [];
  const page = 500;
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("guests")
      .select("id, room, room_type, status, arrival_date, departure_date, order_number, meal_plan, sales_segment_kind")
      .neq("status", "cancelled")
      .range(from, from + page - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as GuestRow[];
    out.push(...rows);
    if (rows.length < page) break;
    from += page;
  }
  return out;
}

async function fetchRoomsByGuest(
  supabase: SupabaseClient,
  guestIds: number[],
): Promise<Map<number, Array<{ adults?: unknown }>>> {
  const map = new Map<number, Array<{ adults?: unknown }>>();
  if (!guestIds.length) return map;
  const chunk = 200;
  for (let i = 0; i < guestIds.length; i += chunk) {
    const slice = guestIds.slice(i, i + chunk);
    const { data, error } = await supabase
      .from("suite_rooms")
      .select("guest_id, adults")
      .in("guest_id", slice);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      const gid = Number(row.guest_id);
      const list = map.get(gid) ?? [];
      list.push({ adults: row.adults });
      map.set(gid, list);
    }
  }
  return map;
}

export async function computeForecastReport(
  supabase: SupabaseClient,
  opts?: { targetDate?: string; now?: Date },
): Promise<{ report: ForecastReport; config: ForecastDailyConfig }> {
  const now = opts?.now ?? new Date();
  const dates = defaultForecastDates(now);
  const targetDate = opts?.targetDate || dates.targetDate;
  const prepDate = addYmd(targetDate, -1);
  const config = await loadConfig(supabase);

  const guests = await fetchAllGuests(supabase);
  const relevant = guests.filter((g) => {
    const arr = ymd(g.arrival_date);
    const dep = ymd(g.departure_date);
    if (arr === targetDate || dep === targetDate) return true;
    if (arr && arr < targetDate && (!dep || dep > targetDate)) return true;
    return false;
  });
  const roomsByGuest = await fetchRoomsByGuest(supabase, relevant.map((g) => g.id));
  const occ = classifySuiteOccupancy(relevant, roomsByGuest, targetDate);
  const ezgoDirectGroup = countDirectGroupOccupancy(relevant, roomsByGuest, targetDate);
  const { data: segmentMapRows } = await supabase
    .from("ezgo_sales_segment_map")
    .select("ezgo_segment_id, kind");
  const ezgoSegmentUnmappedIds = (segmentMapRows ?? []).filter((r: { kind?: string }) => r.kind === "unmapped").length;
  const ezgoSegmentUnmapped = relevant.filter((g) => g.sales_segment_kind === "unmapped").length;

  const { data: ingestRows } = await supabase
    .from("ezgo_mail_ingest")
    .select("id, body_html, received_at, report_date_ymd")
    .in("report_type", ["doc1_html", "doc1_excel", "doc1_tsv"])
    .eq("report_date_ymd", targetDate)
    .eq("parse_status", "parsed")
    .order("received_at", { ascending: false })
    .limit(1);
  const ingest = ingestRows?.[0] ?? null;

  const { data: doc2Rows } = await supabase
    .from("ezgo_mail_ingest")
    .select("id, pending_count")
    .eq("report_type", "doc2_arrivals")
    .eq("report_date_ymd", targetDate)
    .eq("parse_status", "parsed")
    .order("received_at", { ascending: false })
    .limit(1);
  const doc2Ingest = doc2Rows?.[0] ?? null;

  const notes: string[] = [];
  let morning: ForecastPackageCount[] = [];
  let evening: ForecastPackageCount[] = [];
  let morningTotal = 0;
  let eveningTotal = 0;
  let spaTreatments: number | null = null;
  let resortLunch: number | null = null;
  let resortDinner: number | null = null;
  let opsGroupRows: Array<{ qty: number }> = [];

  if (ingest?.body_html) {
    const rawRows = extractOpsTableRows(String(ingest.body_html));
    const classified = rawRows.map((r) => classifyOpsRow(r, occ.suiteOrderNumbers));
    morning = rollPackages(classified, "morning");
    evening = rollPackages(classified, "evening");
    morningTotal = morning.reduce((s, p) => s + p.guests, 0);
    eveningTotal = evening.reduce((s, p) => s + p.guests, 0);
    resortLunch = classified
      .filter((r) => r.dayPart === "morning" && r.lunch)
      .reduce((s, r) => s + r.guests, 0);
    resortDinner = classified
      .filter((r) => r.dayPart === "evening")
      .reduce((s, r) => s + r.guests, 0);
    spaTreatments = sumSpaTreatmentsFromOps(classified);
    opsGroupRows = classified
      .filter((r) => r.dayPart === "group")
      .map((r) => ({ qty: r.guests }));
  } else {
    notes.push("לא נמצא מייל Operations ליום היעד — ריזורט/ספא ריקים.");
  }

  const savedGroups = (config.groups_by_date[targetDate] ?? []).filter((g) => g.qty > 0 || g.name);
  const groups = mergeForecastGroups(opsGroupRows, savedGroups);
  const groupsTotal = groups.reduce((s, g) => s + (g.qty || 0), 0);
  const groupsLunch = groupsTotal || null;

  let doc2Mail = {
    arrivals: { rooms: 0, guests: 0 },
    departures: { rooms: 0, guests: 0 },
    capsules: { rooms: 0, guests: 0 },
  };
  let doc2PendingLines = Number(doc2Ingest?.pending_count) || 0;
  if (doc2Ingest?.id) {
    const { data: lines } = await supabase
      .from("ezgo_mail_import_lines")
      .select("parsed_json, status")
      .eq("ingest_id", doc2Ingest.id);
    const recs = (lines ?? []).map((row: { parsed_json?: unknown }) => row.parsed_json ?? {});
    doc2Mail = summarizeDoc2MailOccupancy(recs as Parameters<typeof summarizeDoc2MailOccupancy>[0]);
    if (!doc2PendingLines) {
      doc2PendingLines = (lines ?? []).filter((row: { status?: string }) => row.status === "pending_review").length;
    }
  } else {
    notes.push("לא נמצא דוח כניסות במייל ליום היעד.");
  }

  const suiteArrivalGap = Boolean(doc2Ingest?.id) && (
    doc2Mail.arrivals.rooms !== occ.arrivals.rooms
    || doc2Mail.arrivals.guests !== occ.arrivals.guests
  );
  if (suiteArrivalGap) {
    notes.push(
      `פער הגעות: XOS ${occ.arrivals.rooms}/${occ.arrivals.guests} · מייל כניסות ${doc2Mail.arrivals.rooms}/${doc2Mail.arrivals.guests} — אשרי שורות, בלי יצירה אוטומטית.`,
    );
  }
  if (ezgoSegmentUnmappedIds > 0) {
    notes.push(`⚠ ${ezgoSegmentUnmappedIds} קודי סגמנט מכירות באיזיגו בלי מיפוי — סנכרון נתונים → EZGO API.`);
  }

  const totalWithDepartures = morningTotal + eveningTotal + groupsTotal
    + occ.arrivals.guests + occ.departures.guests + occ.stayovers.guests + occ.capsules.guests;
  const totalOnSite = totalWithDepartures - occ.departures.guests;

  const report: ForecastReport = {
    prepDate,
    targetDate,
    morning,
    morningTotal,
    evening,
    eveningTotal,
    groups,
    groupsTotal,
    arrivals: occ.arrivals,
    departures: occ.departures,
    stayovers: occ.stayovers,
    capsules: occ.capsules,
    totalWithDepartures,
    totalOnSite,
    spaTreatments,
    meals: {
      breakfast: { suites: occ.breakfast || null, resort: null, groups: null },
      lunch: { suites: null, resort: resortLunch, groups: groupsLunch || null },
      dinner: { suites: occ.dinner || null, resort: resortDinner, groups: null },
    },
    sources: {
      operationsIngestId: ingest?.id ?? null,
      operationsReceivedAt: ingest?.received_at ?? null,
      guestsScanned: relevant.length,
      missingOperations: !ingest?.body_html,
      missingDoc2: !doc2Ingest?.id,
      doc2IngestId: doc2Ingest?.id ?? null,
      doc2PendingLines,
      doc2Arrivals: doc2Ingest?.id ? doc2Mail.arrivals : null,
      doc2Departures: doc2Ingest?.id ? doc2Mail.departures : null,
      doc2Capsules: doc2Ingest?.id ? doc2Mail.capsules : null,
      suiteArrivalGap,
      ezgoDirectGroup: ezgoDirectGroup.guests > 0 || ezgoDirectGroup.rooms > 0 ? ezgoDirectGroup : null,
      ezgoSegmentUnmapped,
      ezgoSegmentUnmappedIds,
    },
    notes,
  };
  return { report, config };
}

export async function sendForecastPing(
  supabase: SupabaseClient,
  report: ForecastReport,
  phoneRaw: string,
): Promise<{ sent: boolean; error?: string }> {
  const phone = cleanPhoneForMention(phoneRaw);
  if (phone.length < 10) return { sent: false, error: "חסר טלפון של ילנה" };
  const body = composeForecastPingText(report);
  try {
    const wamid = await sendWhapiTextGuarded(supabase, phone, body, {
      sendClass: "staff",
      trigger: "forecast_daily",
      source: "forecast-daily",
      noLinkPreview: true,
    });
    if (!wamid) return { sent: false, error: "שליחת Whapi נכשלה" };
    const urlId = await sendWhapiTextGuarded(supabase, phone, forecastDeepLink(), {
      sendClass: "staff",
      trigger: "forecast_daily_link",
      source: "forecast-daily",
      noLinkPreview: true,
    });
    if (!urlId) return { sent: false, error: "הטקסט נשלח אך הקישור נכשל" };
    return { sent: true };
  } catch (e) {
    return { sent: false, error: (e as Error).message };
  }
}

export async function dispatchForecastEveningIfDue(
  supabase: SupabaseClient,
  now = new Date(),
): Promise<{ attempted: boolean; sent: boolean; reason: string }> {
  const cfg = await loadConfig(supabase);
  const gate = shouldDispatchForecastPing(cfg, now);
  if (!gate.due) return { attempted: false, sent: false, reason: gate.reason };
  const { report } = await computeForecastReport(supabase, { now });
  const result = await sendForecastPing(supabase, report, cfg.yelena_phone);
  if (result.sent) {
    await saveForecastConfig(supabase, { last_sent_ymd: israelYmd(now) });
  }
  return { attempted: true, sent: result.sent, reason: result.error || "sent" };
}

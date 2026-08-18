// Pure EZGO Activities → spa board matching. Orchestration (DB) stays in
// ezgo-guest-sync. CSV import still seeds rooms + therapist names; this
// layer applies later webhook snapshots (time change / cancel / worker).

import { ddmmyyyyToIso, parseInnerValue } from "./ezgoGuestSyncLogic.ts";

export interface ParsedSpaActivity {
  ingestId: string;
  orderId: string;
  activityKey: string;
  itemId: string;
  index: number;
  status: number | null;
  cancelled: boolean;
  appointmentDate: string | null;
  startTime: string | null;
  endTime: string | null;
  workerId: number | null;
  guestName: string | null;
  roomRaw: string | null;
}

export interface SpaApptCandidate {
  id: number;
  ezgo_activity_key: string | null;
  ezgo_order_id: string | null;
  appointment_date: string;
  start_time: string;
  status: string;
  therapist_id: number | null;
  guest_id: number;
}

export type SpaActivityMatchKind = "activity_key" | "order_date_time" | "order_date_unique" | "none";

export function clockFromEzgoDateTime(raw: unknown): { date: string; time: string | null } | null {
  const s = String(raw ?? "").trim();
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  const date = ddmmyyyyToIso(s);
  if (!date) return null;
  if (!m[4]) return { date, time: null };
  return { date, time: `${m[4].padStart(2, "0")}:${m[5]}` };
}

function pickRoomRaw(timing: Record<string, unknown>, inner: Record<string, unknown>): string | null {
  const keys = ["Activity", "ActivityDesc", "RoomName", "Room", "sActivityDesc"];
  for (const k of keys) {
    const v = timing[k] ?? inner[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (v && typeof v === "object" && "Name" in (v as Record<string, unknown>)) {
      const name = (v as Record<string, unknown>).Name;
      if (typeof name === "string" && name.trim()) return name.trim();
    }
  }
  return null;
}

export function extractSpaActivity(ingestRow: {
  id: string;
  raw_payload: Record<string, unknown>;
}): ParsedSpaActivity | null {
  const root = ingestRow.raw_payload;
  if (root.Entity !== "Activities") return null;
  const inner = parseInnerValue(root);
  const timing = inner?.Timing as Record<string, unknown> | undefined;
  if (!timing) return null;

  const orderId = String(root.OrderId ?? "").trim();
  const itemId = String(root.ItemId ?? "").trim();
  if (!orderId || !itemId) return null;

  const index = typeof timing.Index === "number" ? timing.Index : 0;
  const status = typeof timing.Status === "number" ? timing.Status : null;
  const start = clockFromEzgoDateTime(timing.Start);
  const end = clockFromEzgoDateTime(timing.End);
  const worker = timing.Worker as Record<string, unknown> | undefined;
  const workerId = typeof worker?.WorkerId === "number" ? worker.WorkerId : null;
  const guestName = timing.Guest != null ? String(timing.Guest).trim() : "";

  return {
    ingestId: ingestRow.id,
    orderId,
    activityKey: `${orderId}:${itemId}:${index}`,
    itemId,
    index,
    status,
    cancelled: status === 0,
    appointmentDate: start?.date ?? end?.date ?? null,
    startTime: start?.time ?? null,
    endTime: end?.time ?? null,
    workerId,
    guestName: guestName || null,
    roomRaw: pickRoomRaw(timing, inner ?? {}),
  };
}

function isOpen(a: SpaApptCandidate): boolean {
  return a.status !== "cancelled";
}

/** Prefer a guest whose name tokens overlap Timing.Guest; else the sole candidate. */
export function pickGuestIdForActivity(
  guests: { id: number; name: string | null }[],
  guestName: string | null,
): number | null {
  if (!guests.length) return null;
  if (guests.length === 1) return guests[0].id;
  const needle = (guestName ?? "").trim().toLowerCase();
  if (!needle) return null;
  const tokens = needle.split(/\s+/).filter((t) => t.length >= 2);
  const hits = guests.filter((g) => {
    const n = (g.name ?? "").trim().toLowerCase();
    if (!n) return false;
    if (n === needle || n.includes(needle) || needle.includes(n)) return true;
    return tokens.some((t) => n.includes(t));
  });
  if (hits.length === 1) return hits[0].id;
  return null;
}

export function matchSpaAppointment(
  activity: ParsedSpaActivity,
  candidates: SpaApptCandidate[],
): { kind: SpaActivityMatchKind; appointment: SpaApptCandidate | null } {
  const byKey = candidates.find((c) => c.ezgo_activity_key === activity.activityKey);
  if (byKey) return { kind: "activity_key", appointment: byKey };

  const sameOrder = candidates.filter((c) =>
    c.ezgo_order_id === activity.orderId || !c.ezgo_order_id
  );
  const pool = sameOrder.length ? sameOrder : candidates;
  const dated = pool.filter((c) => c.appointment_date === activity.appointmentDate);
  const open = dated.filter(isOpen);

  if (activity.startTime) {
    const timeHits = open.filter((c) => String(c.start_time).slice(0, 5) === activity.startTime);
    if (timeHits.length === 1) return { kind: "order_date_time", appointment: timeHits[0] };
  }

  if (open.length === 1) return { kind: "order_date_unique", appointment: open[0] };
  return { kind: "none", appointment: null };
}

export type SpaActivityDecision =
  | { action: "ignore"; notes: string }
  | { action: "retry"; notes: string }
  | { action: "skip"; notes: string }
  | { action: "update"; notes: string }
  | { action: "create"; notes: string }
  | { action: "unresolved"; notes: string };

export function classifySpaActivityApply(input: {
  activity: ParsedSpaActivity | null;
  guestId: number | null;
  matched: SpaApptCandidate | null;
  roomId: number | null;
}): SpaActivityDecision {
  const { activity, guestId, matched, roomId } = input;
  if (!activity) return { action: "ignore", notes: "spa_unparseable" };
  if (!activity.appointmentDate || !activity.startTime || !activity.endTime) {
    return { action: "unresolved", notes: "spa_invalid_times" };
  }
  if (activity.startTime >= activity.endTime) {
    return { action: "unresolved", notes: "spa_invalid_times" };
  }
  if (activity.cancelled) {
    if (matched) return { action: "update", notes: "spa_cancelled" };
    return { action: "skip", notes: "spa_cancel_no_row" };
  }
  if (matched) return { action: "update", notes: "spa_updated" };
  if (!guestId) return { action: "retry", notes: "spa_waiting_guest" };
  if (!roomId) return { action: "unresolved", notes: "spa_no_room" };
  return { action: "create", notes: "spa_created" };
}

/** Fill-empty stamp of WorkerId onto the CSV-named therapist. Never overwrite. */
export function shouldStampTherapistWorkerId(
  existingWorkerId: number | null | undefined,
  incomingWorkerId: number | null,
): boolean {
  if (incomingWorkerId == null) return false;
  if (existingWorkerId == null) return true;
  return false;
}

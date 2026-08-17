// supabase/functions/_shared/ezgoGuestSyncLogic.ts
//
// Pure logic extracted from ezgo-guest-sync/index.ts so it's importable by
// deno test without executing serve() (index.ts stays a thin orchestration
// layer that imports from here, matching this repo's convention of keeping
// testable logic in _shared and Edge Function entrypoints thin).

import {
  resolveDoc2GuestIdentity,
  type Doc2ClientIdentity,
} from "./ezgoDoc2RemarkIdentity.ts";

// ── Board (Order.Board) -> guests.meal_plan, restricted to the live CHECK
// constraint's actual enum (none/half_board/full_board). BB(3) has no
// equivalent and is deliberately left unmapped.
export const BOARD_TO_MEAL_PLAN: Record<number, string> = {
  0: "none",
  1: "none", // RoomOnly
  11: "half_board", // HalfBoard
  15: "full_board", // FullBoard
};

export function ddmmyyyyToIso(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm}-${dd}`;
}

export interface OrderClientInfo {
  orderId: string;
  ingestId: string;
  createdAt: string;
  status: number | null;
  board: number | null;
  fullName: string | null;
  tel1: string | null;
  email: string | null;
  /** Client.ClientId — the payer/coordinator this Order is registered under.
   * NOT scoped to one order: EZGO splits a group booking into multiple
   * OrderIds that all share this same ClientId (confirmed live, 2026-08-16 —
   * see migration 298). 0/absent means EZGO didn't set it. */
  clientId: number | null;
}

export interface ReservationInfo {
  orderId: string;
  ingestId: string;
  roomId: number;
  lineId: string | null;
  status: number | null;
  lineStatus: number | null;
  checkin: string | null;
  checkout: string | null;
  remark: string;
  operationRemark: string;
}

export function parseInnerValue(rawPayload: Record<string, unknown>): Record<string, unknown> | null {
  const raw = rawPayload.Value;
  if (typeof raw !== "string") return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Handles both the Data-Webhook Entity=Orders shape and the plain
 * Type=Insert/Update full-order-snapshot shape — both carry the same
 * Order+Client fields, just nested differently. */
export function extractOrderClient(ingestRow: {
  id: string;
  created_at: string;
  raw_payload: Record<string, unknown>;
}): OrderClientInfo | null {
  const root = ingestRow.raw_payload;
  const entity = root.Entity as string | undefined;
  const type = root.Type as string | null | undefined;

  let order: Record<string, unknown> | null = null;
  let client: Record<string, unknown> | null = null;

  if (entity === "Orders") {
    const value = parseInnerValue(root);
    if (value) {
      order = (value.Order as Record<string, unknown>) ?? null;
      client = (value.Client as Record<string, unknown>) ?? null;
    }
  } else if (!entity && (type === "Insert" || type === "Update")) {
    order = (root.Order as Record<string, unknown>) ?? null;
    client = (root.Client as Record<string, unknown>) ?? null;
  }

  if (!order) return null;
  const orderId = String(root.OrderId ?? order.OrderId ?? "").trim();
  if (!orderId) return null;

  const clientIdRaw = client?.ClientId;
  const clientId = typeof clientIdRaw === "number" && clientIdRaw > 0 ? clientIdRaw : null;

  return {
    orderId,
    ingestId: ingestRow.id,
    createdAt: ingestRow.created_at,
    status: typeof order.Status === "number" ? order.Status : null,
    board: typeof order.Board === "number" ? order.Board : null,
    fullName: client?.FullName ? String(client.FullName).trim() : null,
    tel1: client?.Tel1 ? String(client.Tel1).trim() : null,
    email: client?.Email ? String(client.Email).trim() : null,
    clientId,
  };
}

/**
 * Whether an Orders/plain-snapshot payload's own Order.Rooms array has any
 * entries. Both live shapes carry Order.Rooms: [] identically for a
 * room-less booking (day-pass/spa-only) -- confirmed live, 2026-08-16: EZGO
 * never pushes an Entity=Reservations event for these at all, so pairing
 * every Orders/Client snapshot against a same-batch Reservations line (the
 * only way ezgo-guest-sync currently resolves an order) retries them
 * forever with nothing that will ever arrive. 1041 of 1144 stuck OrderIds
 * in the live backlog had NEVER had a Reservations row in the table's
 * entire history at the time this was found.
 *
 * Returns null (not 0) when the shape can't be read at all -- the caller
 * must never treat "couldn't tell" as "definitely room-less" (Zero Data
 * Loss: only give up on an order when this positively confirms Rooms:[],
 * never on an unparseable payload).
 */
export function extractOrderRoomsCount(rawPayload: Record<string, unknown>): number | null {
  const entity = rawPayload.Entity as string | undefined;
  const type = rawPayload.Type as string | null | undefined;

  let order: Record<string, unknown> | null = null;
  if (entity === "Orders") {
    const value = parseInnerValue(rawPayload);
    order = (value?.Order as Record<string, unknown>) ?? null;
  } else if (!entity && (type === "Insert" || type === "Update")) {
    order = (rawPayload.Order as Record<string, unknown>) ?? null;
  }
  if (!order) return null;
  const rooms = order.Rooms;
  return Array.isArray(rooms) ? rooms.length : null;
}

export function extractReservation(ingestRow: {
  id: string;
  raw_payload: Record<string, unknown>;
}): ReservationInfo | null {
  const root = ingestRow.raw_payload;
  if (root.Entity !== "Reservations") return null;
  const value = parseInnerValue(root);
  const room = value?.Room as Record<string, unknown> | undefined;
  if (!room) return null;
  const orderId = String(root.OrderId ?? "").trim();
  const roomId = typeof room.RoomId === "number" ? room.RoomId : null;
  if (!orderId || roomId == null) return null;

  return {
    orderId,
    ingestId: ingestRow.id,
    roomId,
    lineId: room.LineId != null ? String(room.LineId) : null,
    status: typeof room.Status === "number" ? room.Status : null,
    lineStatus: typeof room.LineStatus === "number" ? room.LineStatus : null,
    checkin: ddmmyyyyToIso(room.Checkin),
    checkout: ddmmyyyyToIso(room.Checkout),
    remark: room.Remark ? String(room.Remark).trim() : "",
    operationRemark: room.OperationRemark ? String(room.OperationRemark).trim() : "",
  };
}

/**
 * Per-room-line occupant identity for the EZGO live API path — a thin
 * wrapper over resolveDoc2GuestIdentity, the SAME function the Doc2 mail/
 * CSV pipeline uses (Mike, product rule shipped 2026-08-16, commit f85f2f8:
 * reuse it, don't invent a second group detector).
 *
 * Doc2's "coordNameDuplicated" means the same coordinator name repeats
 * across 2+ parsed report rows. Here that maps structurally onto "this
 * OrderId has 2+ room-lines" — Order.Client is one value shared by every
 * room-line under an order, so a multi-room order IS the shared-coordinator
 * case. A single-room order never even attempts a remark swap (matches
 * Doc2 exactly: a lone booking's remark is just notes/preferences, not a
 * different occupant's contact info).
 *
 * resolveDoc2GuestIdentity itself only swaps identity when the remark has
 * BOTH a name and a full Israeli mobile — a name-only remark ("דגנית ושיר
 * מוריה 7787", hearts, birthday text) or a phone-only remark keeps the
 * coordinator's identity, so the extra room merges onto one profile instead
 * of splitting into a phantom "no name" guest.
 */
export function resolveApiRoomOccupantIdentity(
  orderClient: { fullName: string | null; tel1: string | null },
  remarkText: string,
  totalLinesInOrder: number,
): Doc2ClientIdentity {
  return resolveDoc2GuestIdentity(
    orderClient.fullName,
    orderClient.tel1,
    remarkText,
    totalLinesInOrder > 1,
  );
}

/** Fill-empty-only: returns the patch value, or undefined to leave untouched,
 * or flags a conflict when the API disagrees with an existing non-empty value. */
export function pickFillEmpty<T>(
  apiVal: T | null | undefined,
  existingVal: T | null | undefined,
): { value: T | undefined; conflict: boolean } {
  if (apiVal === null || apiVal === undefined || apiVal === "") return { value: undefined, conflict: false };
  if (existingVal === null || existingVal === undefined || existingVal === "") return { value: apiVal, conflict: false };
  if (existingVal === apiVal) return { value: undefined, conflict: false };
  return { value: undefined, conflict: true };
}

// ── Trusted room-mapping gate (Mike, sync-management follow-up part 1) ─────
// ezgo_suite_room_map.matched_via tiers, lowest to highest confidence:
// manual (staff panel pick, not yet confirmed) / auto_bootstrap (inferred
// from our own DB, unconfirmed) / csv_verified (cross-checked against
// EZGO's own arrivals CSV export) / staff_verified (staff confirmed
// directly in EZGO's room catalog). Only the latter two are trusted enough
// to drive guest creation/enrichment — mirrors
// EzgoApiCodeMappingPanel.js's isTrustedMatch exactly (same two tiers). A
// manual/auto_bootstrap row is still a GUESS until staff clicks "אשר נכון"
// in the mapping panel; using it here would let a wrong inference silently
// write a guest's room field before anyone confirmed it.
export const TRUSTED_ROOM_MAP_MATCHED_VIA: readonly string[] = ["csv_verified", "staff_verified"];

export interface RoomMapRow {
  ezgo_room_id: number;
  suite_name: string;
  matched_via: string;
}

/**
 * Builds the RoomId -> suite name lookup ezgo-guest-sync uses to resolve a
 * room-line, keeping ONLY trusted tiers. Filtering again here (not just in
 * the query that fetches these rows) is defense-in-depth against a future
 * caller forgetting the query-side filter — same discipline as
 * assertNoDuplicateGuest backstopping findGuestForDoc2SuiteCreate.
 */
export function buildTrustedRoomMap(rows: RoomMapRow[]): Map<number, string> {
  const map = new Map<number, string>();
  for (const row of rows) {
    if (!TRUSTED_ROOM_MAP_MATCHED_VIA.includes(row.matched_via)) continue;
    map.set(row.ezgo_room_id, row.suite_name);
  }
  return map;
}

// ── Terminal park for unresolved orders (Mike, sync-management follow-up
// part 2) ────────────────────────────────────────────────────────────────
// Without this, an order stuck on a bad phone / unmapped room / duplicate
// guest / bad dates cycled staged->processing->staged forever, reclaimed
// every single cron run with zero persisted trace of why — the exact same
// bug class the grace-period fix (2026-08-16) closed for room-less orders,
// just never extended to these four reasons. no_checkin_date is
// deliberately NOT in this set: it's a real race (a Reservations line can
// still arrive with a Checkin date next run), not a blocker a human needs
// to act on, same for a genuine {kind:"error"} — both should keep retrying.

const PARKABLE_UNRESOLVED_REASONS = new Set([
  "no_usable_phone",
  "room_not_mapped", // includes a mapping that exists but was filtered out by the trust gate above
  "duplicate_guest_same_phone_date",
  "invalid_dates",
]);

export type OrderLineResolutionKind = "created" | "enriched" | "unresolved" | "error";

export interface OrderLineResolution {
  kind: OrderLineResolutionKind;
  /** Only meaningful when kind === "unresolved" (matches RoomLineOutcome's reason in ezgo-guest-sync/index.ts). */
  reason?: string;
}

export type OrderResolutionAction =
  | { action: "parsed" }
  | { action: "park"; notes: string }
  | { action: "retry" };

/**
 * Decides what to do with an order's ingest rows once every room-line has
 * been resolved (or not) for this cron run:
 *   - every line created/enriched -> "parsed" (existing behavior, unchanged)
 *   - every remaining unresolved line's reason is in PARKABLE_UNRESOLVED_REASONS,
 *     with NOT ONE line still in a genuinely-retriable state -> "park" with
 *     a notes slug covering every distinct reason seen. status='failed' (not
 *     'ignored') is the caller's job -- 'failed' rows are excluded from
 *     purge_stale_ezgo_api_ingest (migration 296), so a parked order stays
 *     visible for however long it takes staff to fix the underlying cause
 *     (map the room, correct the phone in EZGO, etc.) or for Stage 3's
 *     retry action to re-run it.
 *   - anything else (a no_checkin_date race, a genuine processing error, or
 *     a mix that includes one of those) -> "retry", unchanged from before:
 *     stays claimed, released back to 'staged' by the caller, tried again
 *     next run.
 */
export interface IngestCandidateRow {
  id: string;
  created_at: string;
  raw_payload: Record<string, unknown>;
}

/**
 * Batch claim prioritization (Mike, 2026-08-17, live incident): oldest-first
 * alone lets a large volume of room-less/day-pass Orders snapshots (which
 * only ever cost a cheap grace-period check + eventual park — never
 * processRoomLine's full multi-query chain) crowd real suite orders out of
 * a batch when the staged queue backs up. A real suite Reservations row
 * sitting behind thousands of day-pass rows by created_at would otherwise
 * wait ticks longer than necessary while the DB connection budget is spent
 * on room-less housekeeping instead.
 *
 * Zero Data Loss: this never drops or skips a row — every candidate is
 * still eventually claimed, oldest-first within its own tier. It only
 * REORDERS which rows a size-limited batch picks first. Rows belonging to
 * an OrderId that has at least one Entity=Reservations row IN THIS
 * CANDIDATE POOL go first (still oldest-first within that group);
 * everything else (pure Orders-only/room-less snapshots, Delete/Activities
 * rows, or an order whose Reservations row fell outside the pool) fills
 * whatever's left, also oldest-first. Caller is expected to fetch a
 * candidate pool larger than batchLimit so a Reservations row has a chance
 * to be visible in the same pool as its Orders/Client sibling.
 */
export function selectPrioritizedBatch(
  candidates: IngestCandidateRow[],
  batchLimit: number,
): string[] {
  const orderIdsWithReservation = new Set<string>();
  for (const row of candidates) {
    const rp = row.raw_payload || {};
    if (rp.Entity === "Reservations") {
      const oid = rp.OrderId != null ? String(rp.OrderId).trim() : "";
      if (oid) orderIdsWithReservation.add(oid);
    }
  }
  const priority: IngestCandidateRow[] = [];
  const rest: IngestCandidateRow[] = [];
  for (const row of candidates) {
    const rp = row.raw_payload || {};
    const oid = rp.OrderId != null ? String(rp.OrderId).trim() : "";
    if (oid && orderIdsWithReservation.has(oid)) priority.push(row);
    else rest.push(row);
  }
  return [...priority, ...rest].slice(0, batchLimit).map((r) => r.id);
}

export function classifyOrderResolution(lines: OrderLineResolution[]): OrderResolutionAction {
  if (lines.every((l) => l.kind === "created" || l.kind === "enriched")) {
    return { action: "parsed" };
  }

  const parkable = new Set<string>();
  let hasRetriable = false;
  for (const line of lines) {
    if (line.kind === "unresolved" && line.reason && PARKABLE_UNRESOLVED_REASONS.has(line.reason)) {
      parkable.add(line.reason);
    } else if (line.kind === "unresolved" || line.kind === "error") {
      hasRetriable = true;
    }
  }

  if (parkable.size && !hasRetriable) {
    const reasons = [...parkable].sort();
    const notes = reasons.length === 1 ? `unresolved_${reasons[0]}` : `unresolved_multiple:${reasons.join(",")}`;
    return { action: "park", notes };
  }

  return { action: "retry" };
}

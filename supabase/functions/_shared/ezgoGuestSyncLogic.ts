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

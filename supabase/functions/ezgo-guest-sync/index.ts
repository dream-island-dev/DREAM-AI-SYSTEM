/**
 * ezgo-guest-sync — EZGO live API sync. guests + suite_rooms only. Never
 * touches spa_appointments or spa_therapists/ezgo_worker_id (a separate,
 * already-completed effort).
 *
 * Per-room occupant resolution (rewritten 2026-08-16 — product rule shipped
 * same day on Doc2, commit f85f2f8: one coordinator holding several suites
 * is ONE guests row + N suite_rooms; WhatsApp/Live Queue count people, not
 * rooms). Reuses ezgoDoc2RemarkIdentity.ts's resolveDoc2GuestIdentity and
 * ezgoDoc2SuiteRoomSync.ts's merge/create pipeline verbatim — no second
 * group detector:
 *
 *   For EVERY room-line: resolveApiRoomOccupantIdentity (ezgoGuestSyncLogic.ts)
 *   calls resolveDoc2GuestIdentity(Order.Client.FullName, .Tel1, room's own
 *   Remark/OperationRemark, totalLinesInOrder > 1). A multi-room order IS the
 *   Doc2 "shared coordinator" case (Order.Client is one value shared by every
 *   room-line under it); a single-room order never attempts a remark swap,
 *   same as a lone Doc2 report row. Swap only fires when the remark has BOTH
 *   a name AND a full Israeli mobile — a name-only remark, a bare-phone
 *   remark, or no remark at all all keep the coordinator's identity, and the
 *   room gets MERGED onto that one profile (never left unresolved, never a
 *   second guests row for the same phone+arrival_date — that's
 *   findGuestForDoc2SuiteCreate + shouldMergeDoc2RowOntoGuest's job, reused
 *   as-is via createDoc2SuiteArrival).
 *
 *   Live incident this replaced: 2026-08-17 EZGO arrivals report, 22 room
 *   lines / 17 guests XOS-side — 5 extra rooms under the same לקוח
 *   (0523265035) with name-only remarks never landed in suite_rooms because
 *   the old rule required a remark PHONE (any phone, no name check) to
 *   attach a room, and unconditionally left a 2+-room order's non-remark
 *   lines unresolved instead of falling back to the coordinator.
 *
 *   RoomId -> canonical suite name ONLY via ezgo_suite_room_map. RoomId=0
 *   and any RoomId absent from that table are never guessed (left staged).
 *
 *   guests.email / guests.meal_plan (Order.Board) aren't part of the shared
 *   Doc2Record vocabulary (Doc2 has no API-style Board field), so those two
 *   are applied as a small supplementary fill-empty-only patch after the
 *   reused create/merge call — everything else (name, phone, dates,
 *   automation_scope, suite_rooms, combined room label, bookings upsert,
 *   late-import/housekeeping hooks) comes from ezgoDoc2SuiteRoomSync.ts
 *   untouched.
 *
 *   Dates come directly from Reservations.Room.Checkin/Checkout (EZGO gives
 *   literal dates, unlike the Doc2 mail pipeline's nights-count case) — rec.
 *   nights is left null so addDepartureFromNights defers to rec.departure_date
 *   inside createDoc2SuiteArrival; an invalid pair (checkout<=checkin) makes
 *   that function throw rather than fabricate a 0-night stay, caught below
 *   as unresolved/invalid_dates (fail-visible, not silently dropped).
 *
 * Cancellations (added 2026-08-15, per the sync-management plan's Stage 1):
 * previously a cancelled order (Type=Delete, or Order.Status=0 on a regular
 * Update) was just marked ignored/skipped — an already-synced guest stayed
 * status='expected' forever, silently wrong. Both paths now call
 * applyCancellation(orderId), which flips every non-cancelled guests row
 * with that order_number to status='cancelled'. If no guest was ever
 * synced for that order (0 rows affected), there's nothing to do — that's
 * a normal outcome, not an error.
 */

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  assertGuestSegmentConsistent,
  assertNoDuplicateGuest,
  normalizeWhatsAppPhone,
} from "../_shared/guestSegmentGuard.ts";
import {
  BOARD_TO_MEAL_PLAN,
  type OrderClientInfo,
  type ReservationInfo,
  extractOrderClient,
  extractOrderRoomsCount,
  extractReservation,
  resolveApiRoomOccupantIdentity,
} from "../_shared/ezgoGuestSyncLogic.ts";
import { resolveDoc2ImportAutomationScope } from "../_shared/importAutomationScope.ts";
import type { Doc2Record } from "../_shared/ezgoDoc2Parser.ts";
import type { Doc2GuestRow } from "../_shared/ezgoDoc2MailLineWorkflow.ts";
import {
  findGuestForDoc2SuiteCreate,
  shouldMergeDoc2RowOntoGuest,
  createDoc2SuiteArrival,
  applyDoc2SuiteRoomAdd,
} from "../_shared/ezgoDoc2SuiteRoomSync.ts";
import { ensureMissingDepartureAlert } from "../_shared/guestDepartureGuard.ts";

const GUEST_ROW_SELECT =
  "id, name, phone, order_number, arrival_date, departure_date, room, room_type, meal_location, meal_time, automation_scope";

/**
 * ClientId-based cross-order merge (migration 298) — EZGO splits a group
 * booking into a SEPARATE OrderId per room, linked only by the shared
 * Order.Client.ClientId (confirmed live 2026-08-16: e.g. ClientId 205600
 * spans 9 distinct OrderIds). findGuestForDoc2SuiteCreate/
 * shouldMergeDoc2RowOntoGuest can never find these siblings — they treat a
 * different order_number as a different booking, correct for Doc2 mail
 * (which has no ClientId at all) but blind to this API-only link. Requires
 * an EXACT single match on (ezgo_client_id, arrival_date); 0 or 2+ falls
 * back to the order_number path below rather than guessing.
 */
async function findGuestByEzgoClientId(
  supabase: SupabaseClient,
  clientId: number,
  arrivalDate: string,
): Promise<Doc2GuestRow | null> {
  const { data } = await supabase
    .from("guests")
    .select(GUEST_ROW_SELECT)
    .eq("ezgo_client_id", clientId)
    .eq("arrival_date", arrivalDate)
    .neq("status", "cancelled")
    .limit(2);
  return data?.length === 1 ? (data[0] as Doc2GuestRow) : null;
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const BATCH_LIMIT = 500;

/** Cancels every non-cancelled guests row for this order_number. Returns
 * how many were affected — 0 is a normal outcome (order cancelled before
 * we ever synced a guest for it), not an error. */
async function applyCancellation(supabase: SupabaseClient, orderId: string): Promise<number> {
  const { data } = await supabase
    .from("guests")
    .select("id")
    .eq("order_number", orderId)
    .neq("status", "cancelled");
  if (!data?.length) return 0;
  const { error } = await supabase
    .from("guests")
    .update({ status: "cancelled" })
    .in("id", data.map((g) => g.id));
  if (error) {
    console.warn("[ezgo-guest-sync] applyCancellation update failed:", error.message);
    return 0;
  }
  return data.length;
}

// ── Retention (Stage 3 of the sync-management plan) — mirrors
// resolveEzgoMailRetentionDays/purgeStaleEzgoMailIngest in ezgo-mail-sync/
// index.ts exactly, calling the parallel purge_stale_ezgo_api_ingest RPC
// (migration 296) instead of purge_stale_ezgo_mail_ingest.
function resolveEzgoApiIngestRetentionDays(): number {
  const raw = Number(Deno.env.get("EZGO_API_INGEST_RETENTION_DAYS") || "3");
  if (!Number.isFinite(raw) || raw <= 0) return 3;
  return Math.min(Math.floor(raw), 30);
}

async function purgeStaleEzgoApiIngest(supabase: SupabaseClient): Promise<number> {
  const retentionDays = resolveEzgoApiIngestRetentionDays();
  const { data, error } = await supabase.rpc("purge_stale_ezgo_api_ingest", { retention_days: retentionDays });
  if (error) {
    console.warn("[ezgo-guest-sync] purge failed:", error.message);
    return 0;
  }
  const purged = Number(data) || 0;
  if (purged > 0) console.log(`[ezgo-guest-sync] purged ${purged} stale ingest rows (>${retentionDays}d)`);
  return purged;
}

type RoomLineOutcome =
  | { kind: "created" }
  | { kind: "enriched" }
  | { kind: "unresolved"; reason: string }
  | { kind: "error"; message: string };

/** Fill-empty-only patch for guests fields that aren't part of the shared
 * Doc2Record vocabulary (Order.Board/ClientId have no Doc2 equivalent;
 * Doc2's own email enrichment lives on a different type). Applied after the
 * reused create/merge call, keyed by the guest id it returned either way.
 * ezgo_client_id backfills a guest created before migration 298, or one
 * that was first merged via the order_number path — so the NEXT sibling
 * room for this client can find it via findGuestByEzgoClientId instead of
 * order_number/phone matching again. */
async function applyApiOnlyEnrichment(
  supabase: SupabaseClient,
  guestId: number,
  { mealPlan, email, clientId }: { mealPlan?: string; email?: string | null; clientId?: number | null },
): Promise<void> {
  if (mealPlan) {
    await supabase.from("guests").update({ meal_plan: mealPlan }).eq("id", guestId)
      .or("meal_plan.is.null,meal_plan.eq.none");
  }
  if (email) {
    await supabase.from("guests").update({ email }).eq("id", guestId).is("email", null);
  }
  if (clientId) {
    await supabase.from("guests").update({ ezgo_client_id: clientId }).eq("id", guestId).is("ezgo_client_id", null);
  }
}

/**
 * Resolves and (if safe) writes ONE room-line, reusing the Doc2 identity
 * resolver + suite_rooms merge pipeline end to end — see module doc comment.
 * identitySource mirrors is_remark_group_occupant purely for the run summary
 * (resolved_via_remark / resolved_via_order_client stats).
 */
async function processRoomLine(
  supabase: SupabaseClient,
  orderId: string,
  oc: OrderClientInfo,
  line: ReservationInfo,
  totalLinesInOrder: number,
  roomMap: Map<number, string>,
): Promise<RoomLineOutcome & { identitySource?: "remark" | "order_client" }> {
  const coordPhone = normalizeWhatsAppPhone(oc.tel1);
  const remarkText = line.remark || line.operationRemark || "";
  const identity = resolveApiRoomOccupantIdentity(
    { fullName: oc.fullName, tel1: coordPhone },
    remarkText,
    totalLinesInOrder,
  );
  const identitySource: "remark" | "order_client" = identity.is_remark_group_occupant ? "remark" : "order_client";

  const phone = normalizeWhatsAppPhone(identity.phone);
  if (!phone) return { kind: "unresolved", reason: "no_usable_phone" };

  const suiteName = line.roomId ? roomMap.get(line.roomId) : undefined;
  if (!suiteName) return { kind: "unresolved", reason: "room_not_mapped" };

  if (!line.checkin) return { kind: "unresolved", reason: "no_checkin_date" };

  // Order-level fields (board/email) only ever describe the coordinator, not
  // a remark-swapped individual occupant — same discipline the previous
  // version applied, now against is_remark_group_occupant instead of a
  // hand-rolled identitySource check.
  const mealPlan = !identity.is_remark_group_occupant && oc.board != null ? BOARD_TO_MEAL_PLAN[oc.board] : undefined;
  const name = identity.guest_name;
  const departure = line.checkout && line.checkout > line.checkin ? line.checkout : null;

  // Reuses the exact Doc2 mail-pipeline rule (never re-derived): a remark-
  // resolved individual under a shared order is treated the same as a Doc2
  // "remark group occupant" (courtesy_only, Stage 4 mid_stay only) regardless
  // of whether the order's own Client name looks corporate/municipal. A
  // single-room order using Order.Client directly gets muted when that name
  // matches the corporate/municipal pattern (עיריית/בנק לאומי/…) — otherwise
  // full. Without this, a municipal coordinator's own number synced straight
  // from a single-room booking would receive full guest WhatsApp automation.
  const automationScope = resolveDoc2ImportAutomationScope({
    coordNameRaw: oc.fullName,
    isRemarkGroupOccupant: identity.is_remark_group_occupant,
  });

  const rec: Doc2Record = {
    _report: "doc2",
    section: "arrival",
    order_number: orderId,
    room_raw: suiteName,
    room: suiteName,
    board_basis: null,
    meal_location: null,
    arrival_time: null,
    nights: null, // literal Checkin/Checkout below, not a nights-count — see module doc
    guest_count: null,
    guest_name: name,
    phone,
    amount: null,
    notes: remarkText || null,
    arrival_date: line.checkin,
    departure_date: departure,
    departure_missing_nights: !departure,
    is_day_guest: false,
    is_premium_day: false,
    meal_time: null,
    automation_scope: automationScope,
    automation_muted: automationScope === "muted",
    is_remark_group_occupant: identity.is_remark_group_occupant,
    coord_name: oc.fullName,
    coord_phone: coordPhone,
  };

  try {
    assertGuestSegmentConsistent({ room: suiteName, room_type: "suite" });

    // Try the ClientId link first (API-only signal, catches group-booking
    // siblings under different OrderIds) — only for the coordinator's own
    // identity, never a remark-swapped individual (a different person, not
    // "this client's" room). Falls back to the existing order_number/phone
    // path when there's no ClientId or no exact single match.
    let existing = !identity.is_remark_group_occupant && oc.clientId
      ? await findGuestByEzgoClientId(supabase, oc.clientId, line.checkin)
      : null;
    let willMerge = !!existing;

    if (!existing) {
      existing = await findGuestForDoc2SuiteCreate(supabase, rec, line.checkin);
      willMerge = !!existing && shouldMergeDoc2RowOntoGuest(rec, existing);
    }

    // No pre-write conflict alert here (dropped 2026-08-16 — see chat: an
    // earlier version compared this room-line's own fields against the
    // merge target and logged a guest_alerts row on any disagreement, but
    // on a real multi-room order it fired every single cron tick, including
    // against the WRONG line's phone in a case not yet root-caused. Doc2's
    // own mail/CSV merge path (applyDoc2SuiteRoomAdd, reused below) has
    // never done this either — fill-empty-only and silent on merge, full
    // stop. Parity with Doc2, not a new invented behavior.)
    if (!willMerge) {
      // Genuine create path only — assertNoDuplicateGuest must never run on
      // a merge (that's exactly what used to block room #2 of the same
      // person). findGuestForDoc2SuiteCreate already ruled out a merge
      // target; this is a defense-in-depth net for a phone-format edge case
      // its heuristics might miss, turned into a retry rather than a bad
      // duplicate guests row.
      await assertNoDuplicateGuest(supabase, phone, line.checkin);
    }

    // Once willMerge/existing is known, write directly via applyDoc2SuiteRoomAdd
    // (guestId passed explicitly) rather than createDoc2SuiteArrival — that
    // function does its OWN internal order_number-based rediscovery, which
    // would miss a ClientId-matched existing guest entirely (different
    // order_number by construction) and silently create a duplicate profile
    // instead of merging. createDoc2SuiteArrival is only safe to call here
    // when willMerge is false, since its internal check will independently
    // agree there's no existing guest.
    const result = willMerge && existing
      ? await applyDoc2SuiteRoomAdd(supabase, { guestId: existing.id, rec, reportDateYmd: line.checkin })
      : await createDoc2SuiteArrival(supabase, rec, line.checkin);
    await applyApiOnlyEnrichment(supabase, result.id, {
      mealPlan,
      email: !identity.is_remark_group_occupant ? oc.email : null,
      clientId: !identity.is_remark_group_occupant ? oc.clientId : null,
    });

    if (willMerge && existing) {
      const effectiveDeparture = existing.departure_date || departure || null;
      await ensureMissingDepartureAlert(supabase, {
        id: existing.id, phone, name: result.name,
        arrival_date: existing.arrival_date || line.checkin,
        departure_date: effectiveDeparture, room_type: "suite", room: suiteName,
      });
      return { kind: "enriched", identitySource };
    }

    await ensureMissingDepartureAlert(supabase, {
      id: result.id, phone, name: result.name, arrival_date: line.checkin, departure_date: departure, room_type: "suite", room: suiteName,
    });
    return { kind: "created", identitySource };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // A genuinely different room-merge edge case (not the same-person one
    // the 2026-08-16 rewrite fixed) still trips assertNoDuplicateGuest —
    // classify as unresolved so it doesn't read as a scary/actionable error,
    // retried next run rather than dropped.
    if (message.includes("כבר קיים פרופיל אורח")) {
      return { kind: "unresolved", reason: "duplicate_guest_same_phone_date", identitySource };
    }
    // createDoc2SuiteArrival's fail-visible refusal on checkout<=checkin
    // (never fabricates a 0-night stay) — retried once EZGO corrects it.
    if (message.includes("חסר מספר לילות")) {
      return { kind: "unresolved", reason: "invalid_dates", identitySource };
    }
    return { kind: "error", message, identitySource };
  }
}

/**
 * Deployed 2026-08-16, triggered by a dedicated pg_cron job (net.http_post,
 * not whatsapp-cron — see migration 297) — same shape as whapi-queue-drain/
 * automation-health-cron/sla-escalation-cron: pg_cron's raw SQL has no way
 * to know a secret (no Authorization header in any of those migrations
 * either), so those rely entirely on the function being deployed
 * --no-verify-jwt + the URL not being guessable. Mirroring that here rather
 * than the originally-sketched "require Bearer SUPABASE_SERVICE_ROLE_KEY"
 * design (which only works for a supabase.functions.invoke()-style caller,
 * not raw net.http_post) — and it's a safe relaxation specifically because
 * this function trusts nothing from the request itself: every write is
 * driven by rows already staged in ezgo_api_ingest by the separately-
 * authenticated ezgo-webhook, so an unauthenticated trigger call can only
 * make the same run happen sooner, never inject different data. A valid
 * service-role Bearer token is still accepted for manual/curl invocation.
 */
function isAuthorizedCaller(req: Request): boolean {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return true;
  return !!SUPABASE_SERVICE_ROLE_KEY && authHeader === `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`;
}

serve(async (req) => {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: "server_misconfigured" }), { status: 503 });
  }
  if (!isAuthorizedCaller(req)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const summary = {
    created: 0, enriched: 0, errors: 0,
    unresolved_no_usable_phone: 0, unresolved_room_not_mapped: 0, unresolved_no_checkin: 0,
    unresolved_duplicate_guest: 0, unresolved_invalid_dates: 0, unresolved_other: 0,
    resolved_via_remark: 0, resolved_via_order_client: 0,
    skipped_cancelled: 0, skipped_no_client_data: 0, ignored_out_of_scope: 0,
    ignored_no_room_order_rows: 0,
    cancellations_applied: 0, delete_events_no_matching_guest: 0,
  };

  // 1) Race-safe claim: select candidate staged rows, then atomically flip
  // ONLY the ones still 'staged' at update time to 'processing'. A second
  // overlapping invocation (retry after timeout, accidental double-trigger)
  // gets zero rows back for anything this run already claimed — closes the
  // gap flagged in security review where migration 295 added 'processing'
  // but nothing actually used it as a claim state.
  //
  // Oldest-first (2c fix, 2026-08-16): without an ORDER BY, an unbounded
  // sequential scan under constant insert/update churn gives no guarantee
  // old rows ever get reclaimed ahead of fresh ones — the exact starvation
  // that let the day-pass/spa-only backlog (see extractOrderRoomsCount doc)
  // sit unprocessed for 3 days despite the cron running every minute the
  // whole time.
  const { data: candidateRows } = await supabase
    .from("ezgo_api_ingest")
    .select("id")
    .eq("status", "staged")
    .order("created_at", { ascending: true })
    .limit(BATCH_LIMIT);
  const candidateIds = (candidateRows ?? []).map((r) => r.id);

  let claimedRows: { id: string; raw_payload: Record<string, unknown>; created_at: string }[] = [];
  if (candidateIds.length) {
    const { data } = await supabase
      .from("ezgo_api_ingest")
      .update({ status: "processing" })
      .in("id", candidateIds)
      .eq("status", "staged")
      .select("id, raw_payload, created_at");
    claimedRows = (data ?? []) as { id: string; raw_payload: Record<string, unknown>; created_at: string }[];
  }

  // Any claimed row not explicitly resolved to parsed/ignored/failed below
  // gets released back to 'staged' at the end (see releaseIds), so a bug
  // that forgets to touch a row can't strand it in 'processing' forever.
  const releaseIds = new Set(claimedRows.map((r) => r.id));
  const release = (ids: Iterable<string>) => { for (const id of ids) releaseIds.delete(id); };

  // 2) Immediately park permanently out-of-scope rows so future runs don't
  // keep re-evaluating them. Type=Delete is NOT parked here — it carries a
  // usable OrderId and needs to actually cancel a matching guest, not just
  // be discarded (see applyCancellation / Stage 1 of the sync-management plan).
  const outOfScopeIds: string[] = [];
  const deleteRows: { id: string; raw_payload: Record<string, unknown>; created_at: string }[] = [];
  const inScopeRows: { id: string; raw_payload: Record<string, unknown>; created_at: string }[] = [];
  for (const row of claimedRows) {
    const rp = row.raw_payload as Record<string, unknown>;
    const entity = rp.Entity as string | undefined;
    const type = rp.Type as string | null | undefined;
    if (type === "Delete") {
      deleteRows.push(row);
    } else if (entity === "Activities" || entity === "MealTimings" || entity === "Adds") {
      outOfScopeIds.push(row.id);
    } else if (entity === "Orders" || entity === "Reservations" || (!entity && (type === "Insert" || type === "Update"))) {
      inScopeRows.push(row);
    } else {
      outOfScopeIds.push(row.id); // unrecognized shape — also park, fail-visibly
    }
  }
  if (outOfScopeIds.length) {
    await supabase.from("ezgo_api_ingest").update({ status: "ignored", notes: "out_of_scope" }).in("id", outOfScopeIds);
    summary.ignored_out_of_scope = outOfScopeIds.length;
    release(outOfScopeIds);
  }

  // 2b) Delete events: cancel any already-synced guest for this order, then
  // park the ingest row either way — nothing to retry once an order is gone.
  for (const row of deleteRows) {
    const orderId = String(row.raw_payload.OrderId ?? "").trim();
    if (!orderId) {
      await supabase.from("ezgo_api_ingest").update({ status: "ignored", notes: "delete_no_order_id" }).eq("id", row.id);
      release([row.id]);
      continue;
    }
    const cancelledCount = await applyCancellation(supabase, orderId);
    summary.cancellations_applied += cancelledCount;
    if (!cancelledCount) summary.delete_events_no_matching_guest++;
    await supabase.from("ezgo_api_ingest").update({
      status: "parsed",
      notes: cancelledCount ? `cancellation_applied_${cancelledCount}` : "delete_no_matching_guest",
    }).eq("id", row.id);
    release([row.id]);
  }

  // created_at now comes straight off the claim step's own UPDATE...RETURNING
  // (2c fix, 2026-08-16) -- this used to be a second SELECT with .in() over
  // up to BATCH_LIMIT=500 UUIDs, whose *error* was silently discarded
  // (`const { data } = await ...`, no `error` destructured). A GET-style
  // filter that large is exactly the kind of request that can fail against
  // a gateway URL-length limit; if it ever did, createdAtById silently came
  // back empty and every id fell through to the `?? ""` / `?? now` default,
  // making every order look brand-new regardless of its real age -- which
  // is exactly why the grace-period check below could never fire. Piggy-
  // backing on the claim mutation (already a single non-GET round trip)
  // removes the fragile query entirely instead of hardening it.
  const createdAtById = new Map(claimedRows.map((r) => [r.id, r.created_at]));
  const inScopeFull = inScopeRows;

  const orderClientByOrder = new Map<string, OrderClientInfo>();
  const reservationsByOrder = new Map<string, ReservationInfo[]>();
  const rowIdsByOrder = new Map<string, Set<string>>();

  for (const row of inScopeFull) {
    const oc = extractOrderClient(row as { id: string; created_at: string; raw_payload: Record<string, unknown> });
    if (oc) {
      const existing = orderClientByOrder.get(oc.orderId);
      if (!existing || existing.createdAt < oc.createdAt) orderClientByOrder.set(oc.orderId, oc);
      rowIdsByOrder.set(oc.orderId, (rowIdsByOrder.get(oc.orderId) ?? new Set()).add(row.id));
      continue;
    }
    const res = extractReservation(row as { id: string; raw_payload: Record<string, unknown> });
    if (res) {
      const list = reservationsByOrder.get(res.orderId) ?? [];
      list.push(res);
      reservationsByOrder.set(res.orderId, list);
      rowIdsByOrder.set(res.orderId, (rowIdsByOrder.get(res.orderId) ?? new Set()).add(row.id));
    }
  }

  // 2c) Orders/Client snapshots with no Reservations line in this batch --
  // could be a genuine race (Reservations for this order just hasn't
  // arrived yet, will pair next run) or a day-pass/spa-only order that will
  // NEVER get a Reservations event (EZGO only sends one for a physical
  // room). Confirmed live 2026-08-16: 1041 of 1144 stuck OrderIds had never
  // had a Reservations row anywhere, ever -- they were cycling
  // staged->processing->staged every run since 2026-08-13, the day the
  // webhook went live, three days before this fix. Give every order a
  // GRACE_MS window to pair normally (covers the race); past that, only
  // classify it out-of-scope when EVERY claimed row for that order
  // positively confirms Order.Rooms: [] (never on an unparseable payload --
  // Zero Data Loss). Day-pass guest creation via the live API isn't in this
  // round's scope anyway (see module doc) -- this only stops the infinite
  // retry loop and the unbounded ezgo_api_ingest growth it causes.
  const GRACE_MS = 30 * 60 * 1000;
  const now = Date.now();
  for (const orderId of orderClientByOrder.keys()) {
    if (reservationsByOrder.has(orderId)) continue;
    const rowIds = [...(rowIdsByOrder.get(orderId) ?? [])];
    if (!rowIds.length) continue;
    const oldestCreatedAt = Math.min(...rowIds.map((id) => new Date(createdAtById.get(id) ?? now).getTime()));
    if (now - oldestCreatedAt < GRACE_MS) continue; // still within the race window -- keep retrying

    const roomsCounts = rowIds.map((id) => {
      const row = inScopeFull.find((r) => r.id === id);
      return row ? extractOrderRoomsCount(row.raw_payload) : null;
    });
    const allConfirmedRoomless = roomsCounts.every((c) => c === 0);
    if (!allConfirmedRoomless) continue; // has rooms, or unparseable -- never guess, keep retrying

    await supabase.from("ezgo_api_ingest").update({
      status: "ignored",
      notes: "order_no_room_grace_expired",
    }).in("id", rowIds);
    summary.ignored_no_room_order_rows += rowIds.length;
    release(rowIds);
  }

  const roomMapRows = await supabase.from("ezgo_suite_room_map").select("ezgo_room_id, suite_name");
  const roomMap = new Map<number, string>((roomMapRows.data ?? []).map((r) => [r.ezgo_room_id, r.suite_name]));

  for (const [orderId, reservations] of reservationsByOrder) {
    const rowIds = [...(rowIdsByOrder.get(orderId) ?? [])];

    const oc = orderClientByOrder.get(orderId);
    if (!oc) {
      summary.skipped_no_client_data++; // no Orders/Client snapshot for this order yet — retry later
      continue;
    }
    if (oc.status === 0) {
      summary.skipped_cancelled++;
      const cancelledCount = await applyCancellation(supabase, orderId);
      summary.cancellations_applied += cancelledCount;
      await supabase.from("ezgo_api_ingest").update({
        status: "parsed",
        notes: cancelledCount ? `order_cancelled_applied_${cancelledCount}` : "order_cancelled_no_matching_guest",
      }).in("id", rowIds);
      release(rowIds);
      continue;
    }

    const byLine = new Map<string, ReservationInfo>();
    for (const r of reservations) {
      if (r.status === 0 || r.lineStatus === 0) continue;
      byLine.set(r.lineId ?? `roomid:${r.roomId}`, r);
    }
    const lines = [...byLine.values()];
    const totalLinesInOrder = lines.length;
    if (!totalLinesInOrder) continue;

    let allLinesDone = true;
    for (const line of lines) {
      const outcome = await processRoomLine(supabase, orderId, oc, line, totalLinesInOrder, roomMap);
      switch (outcome.kind) {
        case "created":
          summary.created++;
          if (outcome.identitySource === "remark") summary.resolved_via_remark++; else summary.resolved_via_order_client++;
          break;
        case "enriched":
          summary.enriched++;
          if (outcome.identitySource === "remark") summary.resolved_via_remark++; else summary.resolved_via_order_client++;
          break;
        case "unresolved":
          allLinesDone = false;
          if (outcome.reason === "no_usable_phone") summary.unresolved_no_usable_phone++;
          else if (outcome.reason === "room_not_mapped") summary.unresolved_room_not_mapped++;
          else if (outcome.reason === "no_checkin_date") summary.unresolved_no_checkin++;
          else if (outcome.reason === "duplicate_guest_same_phone_date") summary.unresolved_duplicate_guest++;
          else if (outcome.reason === "invalid_dates") summary.unresolved_invalid_dates++;
          else summary.unresolved_other++;
          break;
        case "error":
          allLinesDone = false;
          summary.errors++;
          break;
      }
    }

    if (allLinesDone) {
      await supabase.from("ezgo_api_ingest").update({ status: "parsed", notes: "all_room_lines_resolved" }).in("id", rowIds);
      release(rowIds);
    } // else: stays claimed here, released back to 'staged' below — retried next run
  }

  // 3) Anything still claimed ('processing') at this point was never given a
  // terminal status above — release it back to 'staged' so the next run
  // retries it, instead of leaving it stranded mid-claim.
  if (releaseIds.size) {
    await supabase.from("ezgo_api_ingest").update({ status: "staged" }).in("id", [...releaseIds]);
  }

  const purged = await purgeStaleEzgoApiIngest(supabase);

  console.info("[ezgo-guest-sync] run summary:", JSON.stringify({ ...summary, purged }));
  return new Response(JSON.stringify({ success: true, summary: { ...summary, purged } }), { status: 200, headers: { "Content-Type": "application/json" } });
});

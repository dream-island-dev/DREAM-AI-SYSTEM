/**
 * ezgo-guest-sync — EZGO live API sync. Partial, single-guest only.
 *
 * NOT YET DEPLOYED / NOT WIRED TO CRON — "בלי deploy בלי תעלה". This is not
 * a claim that the system is ready for full live sync: it resolves one
 * guest profile at a time (per room-line), nothing about spa, nothing
 * about restaurant, and group orders where no room has a resolvable
 * per-occupant remark yet are simply left unresolved (retried later), not
 * approximated.
 *
 * Scope:
 *   - guests + suite_rooms only. Never touches spa_appointments or
 *     spa_therapists/ezgo_worker_id (a separate, already-completed effort).
 *
 * Per-room occupant resolution (corrected 2026-08-13 — see chat: the
 * previous version used "2+ room-lines under one order" as its own signal
 * for "this is a group," which was the wrong test. tel1="111" is not a
 * group signal either — it's just a dummy value front-desk staff types in
 * when they don't have a real number yet, on single-room bookings too):
 *
 *   For EVERY room-line, regardless of how many rooms its order has:
 *     1. Try that room's OWN Remark / OperationRemark via
 *        ezgoDoc2RemarkIdentity.ts's extractPhonesFromRemarkText +
 *        extractNameFromRemarkText / extractNameFromRemarkWithoutPhone —
 *        no new parser. A real phone found INSIDE that room's remark makes
 *        this the room's occupant identity, full stop.
 *     2. Only if the room has no such remark signal AND this order has
 *        EXACTLY ONE room-line total (no ambiguity possible — Order.Client
 *        is structurally the only person on the order) does Order.Client
 *        (FullName/Tel1) get used as that room's identity.
 *     3. Any other case (no remark signal, order has 2+ room-lines) is left
 *        unresolved — Order.Client is never used as a fallback there, since
 *        it would be the same coordinator identity duplicated across every
 *        sibling room ("blob on the coordinator"). Retried next run.
 *
 *   This is the actual definition of "group" that matters here: not a room
 *   count, but whether Order.Client is safe to attribute to a specific
 *   room. It's unsafe exactly when 2+ rooms share it and none of them has
 *   its own remark identity to disambiguate.
 *
 *   Verified against live data (2026-08-13): 19 multi-room orders / 228
 *   room-lines currently in ezgo_api_ingest, zero of which have ANY remark
 *   text (Order- or Room-level) yet — these are far-future (2027) bookings
 *   where per-room assignment clearly hasn't happened on EZGO's side yet.
 *   So today this resolves 0 group profiles, which is correct, not a bug —
 *   the mechanism will fire once EZGO populates that data, without needing
 *   another code change.
 *
 *   RoomId -> canonical suite name ONLY via ezgo_suite_room_map. RoomId=0
 *   and any RoomId absent from that table are never guessed (left staged).
 *
 *   Fill-empty-only enrichment (mirrors ezgoDoc2MailLineWorkflow.ts's
 *   pickEnrichValue) — a real disagreement against an existing non-empty
 *   field goes to guest_alerts (alert_type='ezgo_api_conflict'), never
 *   overwritten and never silently dropped.
 *
 *   Dates come directly from Reservations.Room.Checkin/Checkout (EZGO gives
 *   literal dates here, unlike the Doc2 mail pipeline's nights-count case) —
 *   addDepartureFromNights isn't the derivation path for that reason, but
 *   guestDepartureGuard.ts's fail-visible ensureMissingDepartureAlert IS
 *   reused for the invalid-date case (checkout<=checkin).
 *
 *   meal_plan: Order.Board -> guests.meal_plan via the existing CHECK
 *   constraint's enum only (none/half_board/full_board). BB(3) has no
 *   matching value and is deliberately left unset.
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
import { ensureMissingDepartureAlert } from "../_shared/guestDepartureGuard.ts";
import {
  BOARD_TO_MEAL_PLAN,
  type OrderClientInfo,
  type ReservationInfo,
  extractOrderClient,
  extractReservation,
  resolveRemarkOccupant,
  pickFillEmpty,
} from "../_shared/ezgoGuestSyncLogic.ts";
import {
  resolveDoc2ImportAutomationScope,
  mergeAutomationScope,
} from "../_shared/importAutomationScope.ts";

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

async function logConflict(
  supabase: SupabaseClient,
  guestId: number | null,
  phone: string,
  message: string,
): Promise<void> {
  const { error } = await supabase.from("guest_alerts").insert({
    guest_id: guestId,
    phone,
    alert_type: "ezgo_api_conflict",
    message,
    resolved: false,
  });
  if (error) console.warn("[ezgo-guest-sync] guest_alerts insert failed:", error.message);
}

type RoomLineOutcome =
  | { kind: "created" }
  | { kind: "enriched"; conflict: boolean }
  | { kind: "unresolved"; reason: string }
  | { kind: "error"; message: string };

/**
 * Resolves and (if safe) writes ONE room-line. identitySource is
 * 'remark' when the room's own Remark/OperationRemark yielded a real
 * phone, or 'order_client' when this is the ONLY room-line on its order
 * (Order.Client is unambiguous there). Any other case is 'unresolved' —
 * see the module doc comment for why Order.Client is never used as a
 * fallback when 2+ rooms share an order and none has its own remark.
 */
async function processRoomLine(
  supabase: SupabaseClient,
  orderId: string,
  oc: OrderClientInfo,
  line: ReservationInfo,
  totalLinesInOrder: number,
  roomMap: Map<number, string>,
): Promise<RoomLineOutcome & { identitySource?: "remark" | "order_client" }> {
  const remarkOccupant = resolveRemarkOccupant(line.remark || line.operationRemark);

  let rawName: string | null;
  let rawPhone: string | null;
  let identitySource: "remark" | "order_client";

  if (remarkOccupant) {
    rawName = remarkOccupant.name;
    rawPhone = remarkOccupant.phone;
    identitySource = "remark";
  } else if (totalLinesInOrder === 1) {
    rawName = oc.fullName;
    rawPhone = oc.tel1;
    identitySource = "order_client";
  } else {
    return { kind: "unresolved", reason: "multi_room_no_remark_signal" };
  }

  const phone = normalizeWhatsAppPhone(rawPhone);
  if (!phone) return { kind: "unresolved", reason: "no_usable_phone" };

  const suiteName = line.roomId ? roomMap.get(line.roomId) : undefined;
  if (!suiteName) return { kind: "unresolved", reason: "room_not_mapped" };

  if (!line.checkin) return { kind: "unresolved", reason: "no_checkin_date" };

  const mealPlan = identitySource === "order_client" && oc.board != null ? BOARD_TO_MEAL_PLAN[oc.board] : undefined;
  const name = rawName;
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
    isRemarkGroupOccupant: identitySource === "remark",
  });

  try {
    assertGuestSegmentConsistent({ room: suiteName, room_type: "suite" });

    // Multiple guests can legitimately share order_number once remark-based
    // per-room identities are in play — key the existing-row lookup by
    // (order_number, room), not order_number alone.
    const { data: existingRows } = await supabase
      .from("guests")
      .select("id, name, phone, email, room, room_type, arrival_date, departure_date, meal_plan, order_number, status, automation_scope")
      .eq("order_number", orderId)
      .eq("room", suiteName)
      .neq("status", "cancelled");

    if ((existingRows?.length ?? 0) > 1) {
      return { kind: "unresolved", reason: "ambiguous_existing_rows", identitySource };
    }
    const existing = existingRows?.[0] ?? null;

    if (existing) {
      const patch: Record<string, unknown> = {};
      let hadConflict = false;

      // Phone gets the same fill-empty-only treatment as every other field —
      // previously computed only for the conflict flag and never actually
      // written, so a pre-existing no-phone guest (blocked from WhatsApp
      // automation by the missing_phone gate) could never get backfilled
      // even when the correct phone was sitting right there in the API data.
      const phoneP = pickFillEmpty(phone, existing.phone);
      if (phoneP.value !== undefined) patch.phone = phoneP.value;
      hadConflict = hadConflict || phoneP.conflict;

      const nameP = pickFillEmpty(name, existing.name);
      if (nameP.value !== undefined) patch.name = nameP.value;
      hadConflict = hadConflict || nameP.conflict;

      if (identitySource === "order_client") {
        const emailP = pickFillEmpty(oc.email, existing.email);
        if (emailP.value !== undefined) patch.email = emailP.value;
        hadConflict = hadConflict || emailP.conflict;
      }

      const arrP = pickFillEmpty(line.checkin, existing.arrival_date);
      if (arrP.value !== undefined) patch.arrival_date = arrP.value;
      hadConflict = hadConflict || arrP.conflict;

      const depP = pickFillEmpty(departure ?? undefined, existing.departure_date);
      if (depP.value !== undefined) patch.departure_date = depP.value;
      hadConflict = hadConflict || depP.conflict;

      if (mealPlan) {
        const mpP = pickFillEmpty(mealPlan, existing.meal_plan === "none" ? undefined : existing.meal_plan);
        if (mpP.value !== undefined) patch.meal_plan = mpP.value;
      }

      // Never loosens an already-muted/courtesy_only guest back toward full
      // (mergeAutomationScope escalates toward the more restrictive side).
      const mergedScope = mergeAutomationScope(existing.automation_scope, automationScope);
      if (mergedScope !== (existing.automation_scope ?? "full")) {
        patch.automation_scope = mergedScope;
        patch.automation_muted = mergedScope === "muted";
      }

      if (hadConflict) {
        await logConflict(supabase, existing.id, phone,
          `⚠️ EZGO API מדווח נתונים שונים מהקיים להזמנה #${orderId} — נבדק ולא נדרס אוטומטית`);
      }
      if (Object.keys(patch).length) {
        const { error } = await supabase.from("guests").update(patch).eq("id", existing.id);
        if (error) throw error;
      }
      await ensureMissingDepartureAlert(supabase, { ...existing, ...patch });
      return { kind: "enriched", conflict: hadConflict, identitySource };
    }

    await assertNoDuplicateGuest(supabase, phone, line.checkin);
    const insert: Record<string, unknown> = {
      phone,
      name: name || null,
      arrival_date: line.checkin,
      departure_date: departure,
      room: suiteName,
      room_type: "suite",
      status: "expected",
      order_number: orderId,
      guest_index: 1,
      automation_scope: automationScope,
      automation_muted: automationScope === "muted",
    };
    if (identitySource === "order_client" && oc.email) insert.email = oc.email;
    if (mealPlan) insert.meal_plan = mealPlan;

    const { data: inserted, error: insErr } = await supabase.from("guests").insert(insert).select("id").maybeSingle();
    if (insErr) throw insErr;

    await supabase.from("suite_rooms").insert({
      guest_id: inserted!.id,
      guest_phone: phone,
      guest_name: name || null,
      order_number: orderId,
      res_line_id: line.lineId ?? String(line.roomId),
      room_name: suiteName,
      room_display: suiteName,
      arrival_date: line.checkin,
      nights: departure
        ? Math.round((new Date(`${departure}T12:00:00`).getTime() - new Date(`${line.checkin}T12:00:00`).getTime()) / 86400000)
        : 0,
      adults: 1,
      is_day_guest: false,
    });

    await ensureMissingDepartureAlert(supabase, {
      id: inserted!.id, phone, name, arrival_date: line.checkin, departure_date: departure, room_type: "suite", room: suiteName,
    });
    return { kind: "created", identitySource };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // A legitimate single guest across 2+ physical rooms under one order
    // (existing multi-room-stay support elsewhere in the app) trips
    // assertNoDuplicateGuest on the second room, since it keys on
    // phone+arrival_date only, not room. That's a real, known limitation of
    // this phase (not corruption) — classify it as unresolved so it doesn't
    // read as a scary/actionable error, but it genuinely won't resolve on
    // retry until multi-room-per-guest is explicitly scoped.
    if (message.includes("כבר קיים פרופיל אורח")) {
      return { kind: "unresolved", reason: "duplicate_guest_same_phone_date", identitySource };
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
    created: 0, enriched: 0, conflicts: 0, errors: 0,
    unresolved_no_remark_multi_room: 0, unresolved_no_usable_phone: 0,
    unresolved_room_not_mapped: 0, unresolved_no_checkin: 0, unresolved_duplicate_guest: 0, unresolved_other: 0,
    resolved_via_remark: 0, resolved_via_order_client: 0,
    skipped_cancelled: 0, skipped_no_client_data: 0, ignored_out_of_scope: 0,
    cancellations_applied: 0, delete_events_no_matching_guest: 0,
  };

  // 1) Race-safe claim: select candidate staged rows, then atomically flip
  // ONLY the ones still 'staged' at update time to 'processing'. A second
  // overlapping invocation (retry after timeout, accidental double-trigger)
  // gets zero rows back for anything this run already claimed — closes the
  // gap flagged in security review where migration 295 added 'processing'
  // but nothing actually used it as a claim state.
  const { data: candidateRows } = await supabase
    .from("ezgo_api_ingest")
    .select("id")
    .eq("status", "staged")
    .limit(BATCH_LIMIT);
  const candidateIds = (candidateRows ?? []).map((r) => r.id);

  let claimedRows: { id: string; raw_payload: Record<string, unknown> }[] = [];
  if (candidateIds.length) {
    const { data } = await supabase
      .from("ezgo_api_ingest")
      .update({ status: "processing" })
      .in("id", candidateIds)
      .eq("status", "staged")
      .select("id, raw_payload");
    claimedRows = (data ?? []) as { id: string; raw_payload: Record<string, unknown> }[];
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
  const deleteRows: { id: string; raw_payload: Record<string, unknown> }[] = [];
  const inScopeRows: { id: string; raw_payload: Record<string, unknown> }[] = [];
  for (const row of claimedRows) {
    const rp = row.raw_payload as Record<string, unknown>;
    const entity = rp.Entity as string | undefined;
    const type = rp.Type as string | null | undefined;
    if (type === "Delete") {
      deleteRows.push(row as { id: string; raw_payload: Record<string, unknown> });
    } else if (entity === "Activities" || entity === "MealTimings" || entity === "Adds") {
      outOfScopeIds.push(row.id);
    } else if (entity === "Orders" || entity === "Reservations" || (!entity && (type === "Insert" || type === "Update"))) {
      inScopeRows.push(row as { id: string; raw_payload: Record<string, unknown> });
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

  // inScopeRows already carries raw_payload from the claim step; we only
  // need created_at (for "latest wins") in addition, so pull just that
  // rather than re-selecting raw_payload a second time.
  const { data: createdAtRows } = await supabase
    .from("ezgo_api_ingest")
    .select("id, created_at")
    .in("id", inScopeRows.map((r) => r.id));
  const createdAtById = new Map((createdAtRows ?? []).map((r) => [r.id, r.created_at as string]));
  const inScopeFull = inScopeRows.map((r) => ({ id: r.id, raw_payload: r.raw_payload, created_at: createdAtById.get(r.id) ?? "" }));

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
          if (outcome.conflict) summary.conflicts++;
          if (outcome.identitySource === "remark") summary.resolved_via_remark++; else summary.resolved_via_order_client++;
          break;
        case "unresolved":
          allLinesDone = false;
          if (outcome.reason === "multi_room_no_remark_signal") summary.unresolved_no_remark_multi_room++;
          else if (outcome.reason === "no_usable_phone") summary.unresolved_no_usable_phone++;
          else if (outcome.reason === "room_not_mapped") summary.unresolved_room_not_mapped++;
          else if (outcome.reason === "no_checkin_date") summary.unresolved_no_checkin++;
          else if (outcome.reason === "duplicate_guest_same_phone_date") summary.unresolved_duplicate_guest++;
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

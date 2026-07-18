// supabase/functions/_shared/createGuestOpsTask.ts
//
// Single writer for guest-initiated physical in-house ops tasks (amenity /
// maintenance / cleaning) — extracted from whatsapp-webhook's former
// createPendingOpsApprovalTask so Meta, Whapi guest DM, and the Guest Portal
// all produce byte-identical `tasks` rows: same room resolution, same
// sla_category/department classification, same source tag, same fields
// notify-manual-task + _shared/taskCard.ts already expect. Do not duplicate
// this insert block at a new call site — call this instead.
//
// Human-in-the-Loop gate (2026-07-07, unchanged here): always inserts
// status='pending_approval'. Never dispatches to Whapi directly — staff
// review/edit/approve in OperationsBoard.js is what triggers notify-manual-task.
// Failsafe (2026-07-11): sla-escalation-cron auto-invokes that same function
// after PENDING_APPROVAL_AUTO_APPROVE_MINUTES if reception never approves.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveGuestOpsDepartment, guessGuestOpsSlaCategory, isInstantAmenityOpsDispatch } from "./automationSchedule.ts";
import { isAmbiguousCombinedRoomLabel } from "./guestSelectedSuiteRoom.ts";
import { resolveGuestRoomLabel } from "./guestRoomResolve.ts";

export interface CreateGuestOpsTaskArgs {
  supabase: SupabaseClient;
  guestId: number;
  phone: string;
  guestName?: string | null;
  room?: string | null;
  /** Staff-facing Hebrew summary — becomes tasks.description. Quantity taps
   * bake the count in here as "{itemLabel} × {qty}" (portal contract);
   * free-text requests keep natural phrasing untouched. */
  summary: string;
  /** Full original guest text (or portal upsellLabel) — stored verbatim in
   * reporter_raw_text (Zero Data Loss, CLAUDE.md §0.1). */
  rawText: string;
  /** Isolated relevant line(s) driving department/SLA classification when
   * rawText is a multi-line burst (see extractAllowlistedRequestLines) —
   * falls back to rawText when omitted. */
  dispatchText?: string;
}

export type CreateGuestOpsTaskResult =
  | { created: true; duplicate: false; taskId: number }
  | { created: false; duplicate: true; taskId: number }
  | { created: false; duplicate: false; error: string };

/**
 * Guest+department duplicate guard — an unresolved task already open for the
 * same guest and department means this is a repeat ask (double-tap, guest
 * re-sending the same request before staff has acted) — skip creating a
 * second ticket instead of flooding the Ops Board. Silent to the guest: the
 * caller still sends its normal warm ack either way, same as a fresh create.
 *
 * Keyed on department (תפעול/משק), NOT sla_category: guessGuestOpsSlaCategory
 * has only 3 buckets and defaults everything that isn't a pest/amenity
 * keyword hit to "maintenance" — a room-cleaning ask and a broken-AC ask
 * would both land in that bucket, so keying the guard on sla_category could
 * silently swallow a genuinely different request as a false "duplicate".
 * department is coarser than the full 4-way split (cleaning and amenity both
 * map to משק) but never conflates a different department's job, which is the
 * failure mode that matters here.
 */
async function findOpenDuplicateTask(
  supabase: SupabaseClient,
  guestId: number,
  department: string,
): Promise<number | null> {
  const { data, error } = await supabase
    .from("tasks")
    .select("id")
    .eq("guest_id", guestId)
    .eq("department", department)
    .in("status", ["pending_approval", "open", "in_progress"])
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn("[createGuestOpsTask] duplicate lookup failed:", error.message);
    return null;
  }
  return (data?.id as number | undefined) ?? null;
}

export async function createGuestOpsTask(
  args: CreateGuestOpsTaskArgs,
): Promise<CreateGuestOpsTaskResult> {
  const { supabase, guestId, phone, guestName, room, summary, rawText } = args;
  const dispatchSrc = (args.dispatchText ?? rawText).trim();
  if (args.dispatchText && args.dispatchText !== rawText) {
    console.info(
      `[createGuestOpsTask] dispatch text narrowed — full:"${rawText.slice(0, 120)}" → dispatch:"${dispatchSrc.slice(0, 120)}"`,
    );
  }

  const department  = resolveGuestOpsDepartment(dispatchSrc);
  const slaCategory  = guessGuestOpsSlaCategory(dispatchSrc);
  const priority     = slaCategory === "pest_control" ? "urgent" : "normal";

  const dupTaskId = await findOpenDuplicateTask(supabase, guestId, department);
  if (dupTaskId) {
    console.info(
      `[createGuestOpsTask] duplicate — guest:${guestId} department:${department} existing task:${dupTaskId}`,
    );
    return { created: false, duplicate: true, taskId: dupTaskId };
  }

  const resolvedRoom = await resolveGuestRoomLabel(supabase, {
    guestId, phone, roomHint: room, guestName,
  });
  let roomForDb = resolvedRoom.startsWith("TBD") ? null : resolvedRoom;
  if (roomForDb && isAmbiguousCombinedRoomLabel(roomForDb)) roomForDb = null;

  const { data: task, error: insertErr } = await supabase
    .from("tasks")
    .insert([{
      room_number:         roomForDb,
      department,
      description:         summary,
      priority,
      status:              "pending_approval",
      source:              "guest_request",
      guest_id:            guestId,
      reporter_raw_text:   rawText,
      action_token:        crypto.randomUUID(),
      sla_category:        slaCategory,
      sla_deadline:        null,
    }])
    .select("id")
    .maybeSingle();

  if (insertErr || !task) {
    const msg = insertErr?.message ?? "insert_returned_no_row";
    console.error("[createGuestOpsTask] insert failed:", msg);
    return { created: false, duplicate: false, error: msg };
  }

  console.info(
    `[createGuestOpsTask] task ${task.id} guest:${guestId} room=${resolvedRoom} dept=${department} sla=${slaCategory} PENDING APPROVAL — awaiting staff review in OperationsBoard`,
  );
  return { created: true, duplicate: false, taskId: task.id as number };
}

/** Same Approve & Dispatch path as OperationsBoard / sla-escalation-cron. */
export async function dispatchGuestOpsTaskImmediately(
  taskId: number,
): Promise<{ ok: boolean; notified: boolean; reason?: string }> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    console.warn("[createGuestOpsTask] instant dispatch skipped — missing Supabase env");
    return { ok: false, notified: false, reason: "missing_supabase_env" };
  }
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/notify-manual-task`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ taskId, reviewerId: null }),
    });
    const json = await res.json().catch(() => ({})) as {
      ok?: boolean;
      notified?: boolean;
      reason?: string;
      error?: string;
    };
    const ok = res.ok && json?.ok !== false;
    const notified = json?.notified === true;
    if (ok && notified) {
      console.info(`[createGuestOpsTask] instant amenity dispatch OK — task ${taskId}`);
    } else {
      console.warn(
        `[createGuestOpsTask] instant amenity dispatch task ${taskId} — ok:${ok} notified:${notified} reason:${json?.reason ?? json?.error ?? "unknown"}`,
      );
    }
    return { ok, notified, reason: json?.reason ?? json?.error };
  } catch (e) {
    const reason = (e as Error).message;
    console.error(`[createGuestOpsTask] instant dispatch failed task ${taskId}:`, reason);
    return { ok: false, notified: false, reason };
  }
}

/** Creates task + auto-dispatches Whapi card for instant-amenity asks (ice, towels, …). */
export async function createGuestOpsTaskWithInstantAmenityDispatch(
  args: CreateGuestOpsTaskArgs,
): Promise<CreateGuestOpsTaskResult> {
  const result = await createGuestOpsTask(args);
  const dispatchSrc = (args.dispatchText ?? args.rawText).trim();
  if (result.created && isInstantAmenityOpsDispatch(dispatchSrc)) {
    await dispatchGuestOpsTaskImmediately(result.taskId);
  }
  return result;
}

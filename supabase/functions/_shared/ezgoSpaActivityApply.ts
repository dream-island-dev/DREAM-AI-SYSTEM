import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { extractOrderClient } from "./ezgoGuestSyncLogic.ts";
import { normalizeWhatsAppPhone, phoneLookupVariants } from "./guestSegmentGuard.ts";
import {
  classifySpaActivityApply,
  extractSpaActivity,
  matchSpaAppointment,
  pickGuestIdForActivity,
  shouldStampTherapistWorkerId,
  type ParsedSpaActivity,
  type SpaApptCandidate,
} from "./ezgoSpaActivitySync.ts";

export type SpaSyncSummary = {
  spa_updated: number;
  spa_created: number;
  spa_cancelled: number;
  spa_skipped: number;
  spa_waiting_guest: number;
  spa_unresolved: number;
  spa_worker_stamped: number;
  spa_restaged: number;
};

export function emptySpaSyncSummary(): SpaSyncSummary {
  return {
    spa_updated: 0,
    spa_created: 0,
    spa_cancelled: 0,
    spa_skipped: 0,
    spa_waiting_guest: 0,
    spa_unresolved: 0,
    spa_worker_stamped: 0,
    spa_restaged: 0,
  };
}

function normalizeSpaRoomLabel(raw: string | null): string | null {
  if (!raw) return null;
  const s = raw.replace(/\s+/g, " ").replace(/\s*\([^)]*\)\s*$/, "").trim();
  return s || null;
}

async function restageIgnoredActivities(supabase: SupabaseClient, summary: SpaSyncSummary) {
  const { data, error } = await supabase
    .from("ezgo_api_ingest")
    .select("id")
    .eq("status", "ignored")
    .eq("notes", "out_of_scope")
    .eq("raw_payload->>Entity", "Activities")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) {
    console.error("[ezgo-guest-sync] spa restage select failed:", error.message);
    return;
  }
  const ids = (data ?? []).map((r) => r.id as string);
  if (!ids.length) return;
  const { error: upErr } = await supabase
    .from("ezgo_api_ingest")
    .update({ status: "staged", notes: null })
    .in("id", ids)
    .eq("status", "ignored");
  if (upErr) {
    console.error("[ezgo-guest-sync] spa restage update failed:", upErr.message);
    return;
  }
  summary.spa_restaged = ids.length;
}

async function findGuestsForActivity(
  supabase: SupabaseClient,
  activity: ParsedSpaActivity,
): Promise<{ id: number; name: string | null }[]> {
  const { data: byOrder, error: orderErr } = await supabase
    .from("guests")
    .select("id, name")
    .eq("order_number", activity.orderId)
    .neq("status", "cancelled");
  if (orderErr) {
    console.error("[ezgo-guest-sync] spa guest-by-order query failed:", orderErr.message);
  }
  if (byOrder?.length) return byOrder as { id: number; name: string | null }[];

  const { data: ingestRows, error: ingestErr } = await supabase
    .from("ezgo_api_ingest")
    .select("id, created_at, raw_payload")
    .eq("raw_payload->>Entity", "Orders")
    .eq("raw_payload->>OrderId", activity.orderId)
    .order("created_at", { ascending: false })
    .limit(3);
  if (ingestErr) {
    console.error("[ezgo-guest-sync] spa order-ingest lookup failed:", ingestErr.message);
    return [];
  }
  let tel: string | null = null;
  for (const row of ingestRows ?? []) {
    const oc = extractOrderClient(row as { id: string; created_at: string; raw_payload: Record<string, unknown> });
    if (oc?.tel1) {
      tel = oc.tel1;
      break;
    }
  }
  const e164 = normalizeWhatsAppPhone(tel);
  if (!e164) return [];
  const { data: byPhone, error: phoneErr } = await supabase
    .from("guests")
    .select("id, name")
    .in("phone", phoneLookupVariants(e164))
    .neq("status", "cancelled");
  if (phoneErr) {
    console.error("[ezgo-guest-sync] spa guest-by-phone query failed:", phoneErr.message);
    return [];
  }
  return (byPhone ?? []) as { id: number; name: string | null }[];
}

async function resolveSpaRoomId(
  supabase: SupabaseClient,
  roomRaw: string | null,
): Promise<number | null> {
  const label = normalizeSpaRoomLabel(roomRaw);
  if (!label) return null;
  const { data, error } = await supabase
    .from("spa_room_aliases")
    .select("room_id")
    .eq("ezgo_name", label)
    .maybeSingle();
  if (error) {
    console.error("[ezgo-guest-sync] spa room alias lookup failed:", error.message);
    return null;
  }
  return data?.room_id != null ? Number(data.room_id) : null;
}

async function loadCandidates(
  supabase: SupabaseClient,
  activity: ParsedSpaActivity,
  guestIds: number[],
): Promise<SpaApptCandidate[]> {
  const select =
    "id, ezgo_activity_key, ezgo_order_id, appointment_date, start_time, status, therapist_id, guest_id";
  const byId = new Map<number, SpaApptCandidate>();
  const add = (rows: SpaApptCandidate[] | null | undefined) => {
    for (const r of rows ?? []) byId.set(r.id, r);
  };

  const { data: byKey, error: keyErr } = await supabase
    .from("spa_appointments")
    .select(select)
    .eq("ezgo_activity_key", activity.activityKey);
  if (keyErr) console.error("[ezgo-guest-sync] spa appt-by-key query failed:", keyErr.message);
  add(byKey as SpaApptCandidate[]);

  const { data: byOrder, error: orderErr } = await supabase
    .from("spa_appointments")
    .select(select)
    .eq("ezgo_order_id", activity.orderId);
  if (orderErr) console.error("[ezgo-guest-sync] spa appt-by-order query failed:", orderErr.message);
  add(byOrder as SpaApptCandidate[]);

  if (guestIds.length && activity.appointmentDate) {
    const { data: byGuest, error: guestErr } = await supabase
      .from("spa_appointments")
      .select(select)
      .in("guest_id", guestIds)
      .eq("appointment_date", activity.appointmentDate);
    if (guestErr) console.error("[ezgo-guest-sync] spa appt-by-guest query failed:", guestErr.message);
    add(byGuest as SpaApptCandidate[]);
  }
  return [...byId.values()];
}

async function therapistIdForWorker(
  supabase: SupabaseClient,
  workerId: number | null,
): Promise<{ id: number; ezgo_worker_id: number | null } | null> {
  if (workerId == null) return null;
  const { data, error } = await supabase
    .from("spa_therapists")
    .select("id, ezgo_worker_id")
    .eq("ezgo_worker_id", workerId)
    .maybeSingle();
  if (error) {
    console.error("[ezgo-guest-sync] spa therapist-by-worker query failed:", error.message);
    return null;
  }
  return data ? { id: Number(data.id), ezgo_worker_id: data.ezgo_worker_id } : null;
}

async function stampWorkerOnTherapist(
  supabase: SupabaseClient,
  therapistId: number,
  workerId: number,
  summary: SpaSyncSummary,
) {
  const { data, error } = await supabase
    .from("spa_therapists")
    .select("ezgo_worker_id")
    .eq("id", therapistId)
    .maybeSingle();
  if (error || !data) return;
  if (!shouldStampTherapistWorkerId(data.ezgo_worker_id as number | null, workerId)) return;
  const { error: upErr } = await supabase
    .from("spa_therapists")
    .update({ ezgo_worker_id: workerId })
    .eq("id", therapistId)
    .is("ezgo_worker_id", null);
  if (upErr) {
    console.warn("[ezgo-guest-sync] spa worker stamp skipped:", upErr.message);
    return;
  }
  summary.spa_worker_stamped++;
}

async function writeThroughGuestSpa(
  supabase: SupabaseClient,
  guestId: number,
  appointmentDate: string,
) {
  const { data: earliestRows } = await supabase
    .from("spa_appointments")
    .select("start_time")
    .eq("guest_id", guestId)
    .eq("appointment_date", appointmentDate)
    .neq("status", "cancelled")
    .order("start_time")
    .limit(1);
  const earliest = earliestRows?.[0]?.start_time;
  if (!earliest) return;
  const { error } = await supabase
    .from("guests")
    .update({ spa_date: appointmentDate, spa_time: earliest })
    .eq("id", guestId);
  if (error) console.warn("[ezgo-guest-sync] spa guest write-through failed:", error.message);
}

async function finalizeIngest(
  supabase: SupabaseClient,
  id: string,
  status: "parsed" | "failed" | "ignored",
  notes: string,
  release: (ids: Iterable<string>) => void,
) {
  const { error } = await supabase.from("ezgo_api_ingest").update({ status, notes }).eq("id", id);
  if (error) {
    console.error(`[ezgo-guest-sync] spa ingest finalize ${id} failed:`, error.message);
    return;
  }
  release([id]);
}

export async function restageIgnoredSpaActivities(
  supabase: SupabaseClient,
): Promise<number> {
  const summary = emptySpaSyncSummary();
  await restageIgnoredActivities(supabase, summary);
  return summary.spa_restaged;
}

export async function processClaimedSpaActivities(
  supabase: SupabaseClient,
  claimedRows: { id: string; raw_payload: Record<string, unknown>; created_at: string }[],
  release: (ids: Iterable<string>) => void,
): Promise<{ activityIds: Set<string>; summary: SpaSyncSummary }> {
  const summary = emptySpaSyncSummary();

  const activityIds = new Set<string>();
  const activityRows: { id: string; raw_payload: Record<string, unknown>; created_at: string }[] = [];
  for (const row of claimedRows) {
    if ((row.raw_payload as Record<string, unknown>).Entity === "Activities") {
      activityIds.add(row.id);
      activityRows.push(row);
    }
  }

  for (const row of activityRows) {
    const activity = extractSpaActivity({
      id: row.id,
      raw_payload: row.raw_payload as Record<string, unknown>,
    });
    if (!activity) {
      await finalizeIngest(supabase, row.id, "ignored", "spa_unparseable", release);
      continue;
    }

    const guests = await findGuestsForActivity(supabase, activity);
    const guestId = pickGuestIdForActivity(guests, activity.guestName);
    const candidates = await loadCandidates(
      supabase,
      activity,
      guests.map((g) => g.id),
    );
    const match = matchSpaAppointment(activity, candidates);
    const mappedTherapist = await therapistIdForWorker(supabase, activity.workerId);
    const resolvedRoomId = match.appointment ? null : await resolveSpaRoomId(supabase, activity.roomRaw);
    const decided = classifySpaActivityApply({
      activity,
      guestId: match.appointment?.guest_id ?? guestId,
      matched: match.appointment,
      roomId: match.appointment ? 1 : resolvedRoomId,
    });
    const roomId = resolvedRoomId;

    if (decided.action === "retry") {
      summary.spa_waiting_guest++;
      continue;
    }
    if (decided.action === "ignore") {
      await finalizeIngest(supabase, row.id, "ignored", decided.notes, release);
      continue;
    }
    if (decided.action === "skip") {
      summary.spa_skipped++;
      await finalizeIngest(supabase, row.id, "parsed", decided.notes, release);
      continue;
    }
    if (decided.action === "unresolved") {
      summary.spa_unresolved++;
      await finalizeIngest(supabase, row.id, "failed", decided.notes, release);
      continue;
    }

    const targetGuestId = match.appointment?.guest_id ?? guestId;
    if (!targetGuestId || !activity.appointmentDate || !activity.startTime || !activity.endTime) {
      summary.spa_unresolved++;
      await finalizeIngest(supabase, row.id, "failed", "spa_invalid_times", release);
      continue;
    }

    const therapistId = mappedTherapist?.id ?? match.appointment?.therapist_id ?? null;
    const payload: Record<string, unknown> = {
      appointment_date: activity.appointmentDate,
      start_time: activity.startTime,
      end_time: activity.endTime,
      status: activity.cancelled ? "cancelled" : "scheduled",
      ezgo_activity_key: activity.activityKey,
      ezgo_order_id: activity.orderId,
    };
    if (therapistId != null) payload.therapist_id = therapistId;

    if (decided.action === "update" && match.appointment) {
      const { error } = await supabase.from("spa_appointments").update(payload).eq("id", match.appointment.id);
      if (error) {
        const notes = error.code === "23P01" ? "spa_conflict_23P01" : `spa_write_failed:${error.message}`;
        console.error("[ezgo-guest-sync] spa update failed:", error.message);
        summary.spa_unresolved++;
        await finalizeIngest(supabase, row.id, "failed", notes, release);
        continue;
      }
      if (activity.cancelled) summary.spa_cancelled++;
      else summary.spa_updated++;
      if (match.appointment.therapist_id && activity.workerId != null) {
        await stampWorkerOnTherapist(supabase, match.appointment.therapist_id, activity.workerId, summary);
      }
    } else if (decided.action === "create") {
      if (!roomId) {
        summary.spa_unresolved++;
        await finalizeIngest(supabase, row.id, "failed", "spa_no_room", release);
        continue;
      }
      const { error } = await supabase.from("spa_appointments").insert({
        ...payload,
        guest_id: targetGuestId,
        room_id: roomId,
      });
      if (error) {
        const notes = error.code === "23P01" ? "spa_conflict_23P01" : `spa_write_failed:${error.message}`;
        console.error("[ezgo-guest-sync] spa insert failed:", error.message);
        summary.spa_unresolved++;
        await finalizeIngest(supabase, row.id, "failed", notes, release);
        continue;
      }
      summary.spa_created++;
    }

    if (!activity.cancelled) {
      await writeThroughGuestSpa(supabase, targetGuestId, activity.appointmentDate);
    }
    await finalizeIngest(supabase, row.id, "parsed", decided.notes, release);
  }

  return { activityIds, summary };
}

// Guest Club WA invite — queued after positive review path (survey / מושלם button).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  loadGuestClubWaSettings,
  shouldOfferClubViaWa,
} from "./guestClubWaSettings.ts";

export type GuestClubInviteQueueRow = {
  id: number;
  guest_id: number;
  source: string;
  send_after: string;
  status: string;
};

async function isGuestClubInviteStageActive(supabase: SupabaseClient): Promise<boolean> {
  const { data } = await supabase
    .from("automation_stages")
    .select("is_active")
    .eq("stage_key", "guest_club_invite")
    .maybeSingle();
  return data?.is_active !== false;
}

async function guestBlocksClubInvite(
  supabase: SupabaseClient,
  guestId: number,
): Promise<string | null> {
  const { data: guest } = await supabase
    .from("guests")
    .select("id, status, club_status, msg_club_invite_sent, phone")
    .eq("id", guestId)
    .maybeSingle();
  if (!guest) return "guest_not_found";
  if (guest.status === "cancelled") return "guest_cancelled";
  if (!String(guest.phone ?? "").trim()) return "missing_phone";
  if (guest.msg_club_invite_sent === true) return "already_sent";
  const clubSt = String(guest.club_status ?? "").trim();
  if (clubSt === "active" || clubSt === "declined" || clubSt === "opted_out") {
    return `club_${clubSt}`;
  }
  const { data: clubRow } = await supabase
    .from("guest_club_members")
    .select("status")
    .eq("guest_id", guestId)
    .maybeSingle();
  const memberSt = String(clubRow?.status ?? "").trim();
  if (memberSt === "active" || memberSt === "declined" || memberSt === "opted_out") {
    return `club_member_${memberSt}`;
  }
  return null;
}

/** Queue WA club invite after positive review — idempotent per guest (one pending row). */
export async function enqueueGuestClubWaInvite(
  supabase: SupabaseClient,
  opts: { guestId: number; source?: string; delayMinutes?: number },
): Promise<{ queued: boolean; reason?: string }> {
  const settings = await loadGuestClubWaSettings(supabase);
  if (!shouldOfferClubViaWa(settings)) {
    return { queued: false, reason: "wa_invite_disabled" };
  }
  if (!(await isGuestClubInviteStageActive(supabase))) {
    return { queued: false, reason: "stage_inactive" };
  }

  const block = await guestBlocksClubInvite(supabase, opts.guestId);
  if (block) return { queued: false, reason: block };

  const delayMinutes = opts.delayMinutes ?? settings.wa_invite_delay_minutes;
  const sendAfter = new Date(Date.now() + delayMinutes * 60_000).toISOString();

  const { error: cancelErr } = await supabase
    .from("guest_club_invite_queue")
    .update({ status: "cancelled" })
    .eq("guest_id", opts.guestId)
    .eq("status", "pending");
  if (cancelErr) {
    console.warn("[guestClubWaInvite] cancel prior pending failed:", cancelErr.message);
  }

  const { error: insertErr } = await supabase.from("guest_club_invite_queue").insert({
    guest_id: opts.guestId,
    source: opts.source ?? "positive_feedback_wa",
    send_after: sendAfter,
    status: "pending",
  });
  if (insertErr) {
    if (insertErr.code === "23505") return { queued: false, reason: "already_queued" };
    console.error("[guestClubWaInvite] enqueue failed:", insertErr.message);
    return { queued: false, reason: "insert_error" };
  }

  console.log(
    `[guestClubWaInvite] queued guest=${opts.guestId} send_after=${sendAfter} source=${opts.source ?? "positive_feedback_wa"}`,
  );
  return { queued: true };
}

export async function processDueGuestClubWaInvites(
  supabase: SupabaseClient,
  supabaseUrl: string,
  anonKey: string,
): Promise<Array<{ queueId: number; guestId: number; ok: boolean; error?: string }>> {
  const settings = await loadGuestClubWaSettings(supabase);
  if (!shouldOfferClubViaWa(settings)) return [];
  if (!(await isGuestClubInviteStageActive(supabase))) return [];

  const nowIso = new Date().toISOString();
  const { data: dueRows, error } = await supabase
    .from("guest_club_invite_queue")
    .select("id, guest_id, source")
    .eq("status", "pending")
    .lte("send_after", nowIso)
    .order("send_after", { ascending: true })
    .limit(20);
  if (error) {
    console.error("[guestClubWaInvite] due lookup failed:", error.message);
    return [];
  }

  const results: Array<{ queueId: number; guestId: number; ok: boolean; error?: string }> = [];

  for (const row of (dueRows ?? []) as GuestClubInviteQueueRow[]) {
    const queueId = row.id;
    const guestId = row.guest_id;

    const block = await guestBlocksClubInvite(supabase, guestId);
    if (block) {
      await supabase.from("guest_club_invite_queue").update({
        status: "cancelled",
        error_text: block,
      }).eq("id", queueId);
      results.push({ queueId, guestId, ok: false, error: block });
      continue;
    }

    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/whatsapp-send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
        },
        body: JSON.stringify({
          guestId,
          trigger: "guest_club_invite",
          force: true,
        }),
      });
      const body = await res.json().catch(() => ({})) as Record<string, unknown>;
      const sent =
        res.ok &&
        (body.ok === true || body.status === "sent" || body.status === "simulated") &&
        body.skipped !== true;
      const ok =
        sent ||
        (body.skipped === true && body.reason === "already_sent") ||
        body.status === "duplicate_blocked";
      if (ok) {
        await supabase.from("guest_club_invite_queue").update({
          status: "sent",
          sent_at: new Date().toISOString(),
        }).eq("id", queueId);
        results.push({ queueId, guestId, ok: true });
      } else {
        const errText = [
          body.error,
          body.reason,
          body.duplicate_reason,
          body.status,
          body.skipped === true ? "skipped" : null,
        ]
          .filter((v) => v != null && String(v).trim() !== "")
          .map(String)
          .join(" | ")
          .slice(0, 500) || `http_${res.status}`;
        await supabase.from("guest_club_invite_queue").update({
          status: "failed",
          error_text: errText,
        }).eq("id", queueId);
        results.push({ queueId, guestId, ok: false, error: errText });
      }
    } catch (e) {
      const errText = (e as Error).message;
      await supabase.from("guest_club_invite_queue").update({
        status: "failed",
        error_text: errText,
      }).eq("id", queueId);
      results.push({ queueId, guestId, ok: false, error: errText });
    }
  }

  return results;
}

// Suite post-checkout survey — enqueued when housekeeping group confirms Co,
// dispatched by whatsapp-cron after a configurable delay (default 15 min).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { israelYmd } from "./automationSchedule.ts";
import { isEffectiveSuiteGuest } from "./suiteNames.ts";

export const DEFAULT_POST_CHECKOUT_SURVEY_DELAY_MINUTES = 15;

export type PostCheckoutSurveyQueueRow = {
  id: number;
  guest_id: number;
  room_id: string | null;
  source: string;
  send_after: string;
  status: string;
};

export async function loadPostCheckoutSurveyDelayMinutes(
  supabase: SupabaseClient,
): Promise<number> {
  const { data } = await supabase
    .from("bot_config")
    .select("config_value")
    .eq("config_key", "post_checkout_survey_delay_minutes")
    .maybeSingle();
  const n = parseInt(String(data?.config_value ?? ""), 10);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_POST_CHECKOUT_SURVEY_DELAY_MINUTES;
  return Math.min(n, 120);
}

/** Queue suite survey after housekeeping Co — idempotent per guest (one pending row). */
export async function enqueueSuitePostCheckoutSurvey(
  supabase: SupabaseClient,
  opts: {
    guestId: number;
    roomId: string | null;
    source?: string;
    delayMinutes?: number;
  },
): Promise<{ queued: boolean; reason?: string }> {
  const { guestId, roomId } = opts;

  const { data: guest, error: guestErr } = await supabase
    .from("guests")
    .select("id, status, room_type, room, msg_checkout_fb_sent, msg_survey_invite_sent")
    .eq("id", guestId)
    .maybeSingle();
  if (guestErr || !guest) {
    return { queued: false, reason: "guest_not_found" };
  }
  if (guest.status === "cancelled") {
    return { queued: false, reason: "guest_cancelled" };
  }
  if (!isEffectiveSuiteGuest(guest)) {
    return { queued: false, reason: "not_suite_guest" };
  }
  if (guest.msg_checkout_fb_sent === true || guest.msg_survey_invite_sent === true) {
    return { queued: false, reason: "already_sent" };
  }

  const delayMinutes = opts.delayMinutes ?? await loadPostCheckoutSurveyDelayMinutes(supabase);
  const sendAfter = new Date(Date.now() + delayMinutes * 60_000).toISOString();

  const { error: cancelErr } = await supabase
    .from("post_checkout_survey_queue")
    .update({ status: "cancelled" })
    .eq("guest_id", guestId)
    .eq("status", "pending");
  if (cancelErr) {
    console.warn("[postCheckoutSurvey] cancel prior pending failed:", cancelErr.message);
  }

  const { error: insertErr } = await supabase.from("post_checkout_survey_queue").insert({
    guest_id: guestId,
    room_id: roomId,
    source: opts.source ?? "housekeeping_wa",
    send_after: sendAfter,
    status: "pending",
  });
  if (insertErr) {
    if (insertErr.code === "23505") return { queued: false, reason: "already_queued" };
    console.error("[postCheckoutSurvey] enqueue failed:", insertErr.message);
    return { queued: false, reason: "insert_error" };
  }

  console.log(
    `[postCheckoutSurvey] queued guest=${guestId} room=${roomId ?? "—"} send_after=${sendAfter}`,
  );
  return { queued: true };
}

export async function processDuePostCheckoutSurveys(
  supabase: SupabaseClient,
  supabaseUrl: string,
  anonKey: string,
): Promise<Array<{ queueId: number; guestId: number; ok: boolean; error?: string }>> {
  const nowIso = new Date().toISOString();
  const { data: dueRows, error } = await supabase
    .from("post_checkout_survey_queue")
    .select("id, guest_id, room_id, source")
    .eq("status", "pending")
    .lte("send_after", nowIso)
    .order("send_after", { ascending: true })
    .limit(20);
  if (error) {
    console.error("[postCheckoutSurvey] due lookup failed:", error.message);
    return [];
  }

  const results: Array<{ queueId: number; guestId: number; ok: boolean; error?: string }> = [];

  for (const row of (dueRows ?? []) as PostCheckoutSurveyQueueRow[]) {
    const queueId = row.id;
    const guestId = row.guest_id;

    const { data: guest } = await supabase
      .from("guests")
      .select("id, status, msg_checkout_fb_sent, room_type, room")
      .eq("id", guestId)
      .maybeSingle();

    if (!guest || guest.status === "cancelled") {
      await supabase.from("post_checkout_survey_queue").update({
        status: "cancelled",
        error_text: "guest_cancelled_or_missing",
      }).eq("id", queueId);
      results.push({ queueId, guestId, ok: false, error: "guest_cancelled_or_missing" });
      continue;
    }
    if (guest.msg_checkout_fb_sent === true) {
      await supabase.from("post_checkout_survey_queue").update({
        status: "cancelled",
        error_text: "already_sent",
      }).eq("id", queueId);
      results.push({ queueId, guestId, ok: false, error: "already_sent" });
      continue;
    }
    if (guest.status !== "checked_out") {
      results.push({ queueId, guestId, ok: false, error: "guest_not_checked_out_yet" });
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
          trigger: "checkout_fb",
          housekeeping_co: true,
          // Bypass stage_inactive / closed Meta window / duplicate guards — enqueue
          // already dedupes msg_checkout_fb_sent + one pending row per guest.
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
        await supabase.from("post_checkout_survey_queue").update({
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
          body.halted === true ? "halted" : null,
        ]
          .filter((v) => v != null && String(v).trim() !== "")
          .map(String)
          .join(" | ")
          .slice(0, 500) || `http_${res.status}`;
        await supabase.from("post_checkout_survey_queue").update({
          status: "failed",
          error_text: errText,
        }).eq("id", queueId);
        results.push({ queueId, guestId, ok: false, error: errText });
      }
    } catch (e) {
      const errText = (e as Error).message;
      await supabase.from("post_checkout_survey_queue").update({
        status: "failed",
        error_text: errText,
      }).eq("id", queueId);
      results.push({ queueId, guestId, ok: false, error: errText });
    }
  }

  return results;
}

/**
 * Same-day catch-up: suite guests who already checked_out today (cron / UI / Co
 * before deploy) but never received checkout_fb — enqueue with no extra delay.
 */
export async function catchUpDepartedTodaySuiteCheckoutSurveys(
  supabase: SupabaseClient,
): Promise<{ scanned: number; queued: number; retried: number }> {
  const today = israelYmd(new Date());

  // After a deploy fix, reopen today's failed catch-up rows (guest still unsent).
  const { data: retriedRows } = await supabase
    .from("post_checkout_survey_queue")
    .update({
      status: "pending",
      send_after: new Date().toISOString(),
      error_text: null,
    })
    .eq("status", "failed")
    .in("source", ["catchup_departed_today", "housekeeping_wa"])
    .gte("created_at", `${today}T00:00:00.000Z`)
    .select("id");
  const retried = retriedRows?.length ?? 0;
  if (retried > 0) {
    console.log(`[postCheckoutSurvey] reopened ${retried} failed row(s) for retry`);
  }
  const { data: rows, error } = await supabase
    .from("guests")
    .select(
      "id, status, room, room_type, phone, msg_checkout_fb_sent, msg_survey_invite_sent, departure_date",
    )
    .eq("status", "checked_out")
    .eq("departure_date", today)
    .eq("msg_checkout_fb_sent", false)
    .not("phone", "is", null)
    .limit(50);
  if (error) {
    console.error("[postCheckoutSurvey] catch-up lookup failed:", error.message);
    return { scanned: 0, queued: 0, retried };
  }

  let queued = 0;
  for (const guest of rows ?? []) {
    if (!isEffectiveSuiteGuest(guest)) continue;
    if (guest.msg_survey_invite_sent === true) continue;

    const { data: pending } = await supabase
      .from("post_checkout_survey_queue")
      .select("id")
      .eq("guest_id", guest.id)
      .eq("status", "pending")
      .maybeSingle();
    if (pending) continue;

    const result = await enqueueSuitePostCheckoutSurvey(supabase, {
      guestId: guest.id,
      roomId: guest.room ? String(guest.room) : null,
      source: "catchup_departed_today",
      delayMinutes: 0,
    });
    if (result.queued) queued += 1;
  }

  if (queued > 0) {
    console.log(`[postCheckoutSurvey] catch-up departed_today=${today} queued=${queued}`);
  }
  return { scanned: rows?.length ?? 0, queued, retried };
}

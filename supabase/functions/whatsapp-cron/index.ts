// supabase/functions/whatsapp-cron/index.ts
// Scheduled scanner (invoked by pg_cron ~every 15 min). Decides which
// time-based WhatsApp triggers are due and delegates each to whatsapp-send
// (which templates, sends/simulates, and dedupes via notification_log).
//
// Phase 4 (Automation Control Center): timing now comes from the
// automation_stages table (migration 065) via the shared resolver in
// _shared/automationSchedule.ts, instead of a hardcoded day-offset/UTC-hour
// if/else. Eligibility guards (cancelled/flag-already-sent/room_type/status)
// are preserved exactly — only the NUMBERS (which day,
// which hour) moved from source code to an admin-editable table. Stages
// with schedule_mode='event_immediate' (stage_2_arrival) are intentionally
// excluded from this scan — they fire synchronously from whatsapp-webhook,
// not from cron polling.
//
// room_ready is NOT in automation_stages (event-driven from the RoomBoard/
// AICopilot UI toggle) — it has no row here and is not part of this scan.
//
// Dispatch throttling: due items are sent sequentially (never Promise.all) with
// INTER_SEND_DELAY_MS (2.5s) between each whatsapp-send call, grouped in batches
// of DISPATCH_BATCH_SIZE for logging — burst protection against Meta rate limits.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  resolveStageSchedule,
  CORE_PIPELINE_STAGE_KEYS,
  isPastAutoCheckinGateway,
  isPastAutoCheckoutGateway,
  israelYmd,
  AUTO_CHECKIN_ELIGIBLE_STATUSES,
  AUTO_CHECKOUT_ELIGIBLE_STATUSES,
  type AutomationStage,
  type GuestForSchedule,
} from "../_shared/automationSchedule.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Sends per batch — logged for observability; still sequential, not parallel. */
const DISPATCH_BATCH_SIZE = 10;
/** Pause between individual whatsapp-send calls (Meta burst rate-limit safety). */
const INTER_SEND_DELAY_MS = 2500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // ── EMERGENCY KILL SWITCH ───────────────────────────────────────────────────
  // ALL automated outbound sends are halted until CRON_ENABLED=true is set
  // explicitly in Supabase Secrets (Project → Settings → Edge Functions → Secrets).
  // Deploying without this secret is the off switch. Set it to re-enable.
  if (Deno.env.get("CRON_ENABLED") !== "true") {
    console.log("[whatsapp-cron] 🚫 HALTED — CRON_ENABLED not set to 'true'. Zero messages dispatched.");
    return new Response(
      JSON.stringify({ ok: true, halted: true, reason: "CRON_ENABLED_not_set" }),
      { headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const now = new Date();
    const todayIsrael = israelYmd(now);
    const checkinEligible = [...AUTO_CHECKIN_ELIGIBLE_STATUSES];
    const checkoutEligible = [...AUTO_CHECKOUT_ELIGIBLE_STATUSES];

    // ── 11:00 Israel auto checkout — departure day (or catch-up if overdue) ──
    let autoCheckoutCount = 0;
    const { data: overdueCheckout, error: overdueErr } = await supabase
      .from("guests")
      .update({ status: "checked_out", room_ready_notified: false, msg_room_ready_sent: false })
      .lt("departure_date", todayIsrael)
      .in("status", checkoutEligible)
      .select("id");
    if (overdueErr) {
      console.error("[whatsapp-cron] auto_checkout (overdue) FAILED:", overdueErr.message);
    } else {
      autoCheckoutCount += overdueCheckout?.length ?? 0;
    }

    if (isPastAutoCheckoutGateway(now)) {
      const { data: todayCheckout, error: todayCheckoutErr } = await supabase
        .from("guests")
        .update({ status: "checked_out", room_ready_notified: false, msg_room_ready_sent: false })
        .eq("departure_date", todayIsrael)
        .in("status", checkoutEligible)
        .select("id");
      if (todayCheckoutErr) {
        console.error("[whatsapp-cron] auto_checkout (today) FAILED:", todayCheckoutErr.message);
      } else {
        autoCheckoutCount += todayCheckout?.length ?? 0;
      }
    }
    if (autoCheckoutCount > 0) {
      console.log(`[whatsapp-cron] auto_checkout archived ${autoCheckoutCount} guest(s) (today=${todayIsrael})`);
    }

    // ── 15:00 Israel auto check-in — pending/expected/room_ready arriving today ──
    let autoCheckinCount = 0;
    if (isPastAutoCheckinGateway(now)) {
      const { data: promoted, error: promoteErr } = await supabase
        .from("guests")
        .update({ status: "checked_in", checkin_time: now.toISOString() })
        .eq("arrival_date", todayIsrael)
        .in("status", checkinEligible)
        .select("id");
      if (promoteErr) {
        console.error("[whatsapp-cron] auto_checkin update FAILED:", promoteErr.message);
      } else {
        autoCheckinCount = promoted?.length ?? 0;
        if (autoCheckinCount > 0) {
          console.log(`[whatsapp-cron] auto_checkin promoted ${autoCheckinCount} guest(s) for ${todayIsrael}`);
        }
      }
    }

    const { data: stagesData, error: stagesErr } = await supabase
      .from("automation_stages")
      .select("*")
      .eq("is_active", true)
      .neq("schedule_mode", "event_immediate")
      .order("sequence_order");
    if (stagesErr) throw new Error(`stages_lookup_error: ${stagesErr.message}`);
    const stages = (stagesData ?? []) as AutomationStage[];

    // Same explicit column list as before this refactor — every flag column
    // any stage might reference, plus the resolver's anchor/eligibility fields.
    // needs_callback is selected for observability only — NOT used in eligibility
    // (checkEligibility in automationSchedule.ts; session 59 decouple).
    const { data: guests = [] } = await supabase
      .from("guests")
      .select("id, name, phone, arrival_date, departure_date, room_type, status, checkin_time, needs_callback, automation_muted, msg_pre_arrival_2d_sent, msg_pre_arrival_sent, msg_morning_suite_sent, msg_morning_welcome_sent, msg_mid_stay_sent, msg_checkout_fb_sent");

    const activeStageKeys = stages.map((s) => s.stage_key);
    console.log(`[whatsapp-cron] scan_start guests=${guests?.length ?? 0} active_stages=[${activeStageKeys.join(", ")}]`);

    const missingCoreStages = CORE_PIPELINE_STAGE_KEYS.filter((k) => !activeStageKeys.includes(k));
    if (missingCoreStages.length > 0) {
      console.warn(
        `[whatsapp-cron] core pipeline stages missing from active_stages: [${missingCoreStages.join(", ")}]. ` +
        "Re-enable via: UPDATE automation_stages SET is_active=true WHERE stage_key IN ('" +
        missingCoreStages.join("','") + "');",
      );
    }

    if (!activeStageKeys.includes("night_before")) {
      console.warn(
        "[whatsapp-cron] night_before NOT in active_stages — Stage 2.5 (suites) will never dispatch. " +
        "Re-enable: UPDATE automation_stages SET is_active=true WHERE stage_key='night_before';",
      );
    }

    const NIGHT_BEFORE_STAGE_KEYS = new Set(["night_before", "night_before_daypass"]);
    const MID_STAY_STAGE_KEYS = new Set(["mid_stay", "mid_stay_daypass"]);
    const due: { guestId: number; trigger: string }[] = [];
    for (const guest of (guests ?? []) as GuestForSchedule[]) {
      for (const stage of stages) {
        const result = resolveStageSchedule(stage, guest, now);
        if (NIGHT_BEFORE_STAGE_KEYS.has(stage.stage_key) || MID_STAY_STAGE_KEYS.has(stage.stage_key)) {
          const flagCol = stage.guest_flag_column;
          const flagVal = flagCol ? guest[flagCol] : null;
          console.log(
            `[whatsapp-cron] stage_eval stage=${stage.stage_key} guest_id=${guest.id} ` +
            `room_type=${guest.room_type ?? "null"} arrival=${guest.arrival_date ?? "null"} ` +
            `applies_to=${stage.applies_to} ${flagCol ?? "flag"}=${String(flagVal)} ` +
            `dueNow=${result.dueNow} skipReason=${result.skipReason ?? "none"}`,
          );
        }
        if (result.dueNow) {
          console.log(`[whatsapp-cron] QUEUED guest_id=${guest.id} trigger=${stage.stage_key}`);
          due.push({ guestId: guest.id as number, trigger: stage.stage_key });
        }
      }
    }

    // Delegate each to whatsapp-send (idempotent there), throttled in batches.
    const results: any[] = [];
    const batchCount = Math.max(1, Math.ceil(due.length / DISPATCH_BATCH_SIZE));
    console.log(
      `[whatsapp-cron] dispatch_start queued=${due.length} batches=${batchCount} ` +
      `batch_size=${DISPATCH_BATCH_SIZE} inter_send_delay_ms=${INTER_SEND_DELAY_MS}`,
    );

    for (let i = 0; i < due.length; i++) {
      if (i > 0 && i % DISPATCH_BATCH_SIZE === 0) {
        const batchNum = Math.floor(i / DISPATCH_BATCH_SIZE) + 1;
        console.log(`[whatsapp-cron] dispatch_batch_start batch=${batchNum}/${batchCount} index=${i}`);
      }

      const d = due[i];
      try {
        const res = await fetch(`${supabaseUrl}/functions/v1/whatsapp-send`, {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: anon, Authorization: `Bearer ${anon}` },
          body: JSON.stringify(d),
        });
        results.push({ ...d, ok: res.ok });
      } catch (e) {
        results.push({ ...d, ok: false, error: (e as Error).message });
      }

      if (i < due.length - 1) {
        await sleep(INTER_SEND_DELAY_MS);
      }
    }

    // ── Push notifications: alert reception manager when new WhatsApp triggers fire ──
    if (results.some((r) => r.ok)) {
      try {
        await fetch(`${supabaseUrl}/functions/v1/push-notify`, {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: anon, Authorization: `Bearer ${anon}` },
          body: JSON.stringify({
            department: "reception",
            title: "עדכון WhatsApp",
            body: `נשלחו ${results.filter((r) => r.ok).length} הודעות אוטומטיות לאורחים`,
            tag: "whatsapp-cron",
            url: "/",
          }),
        });
      } catch { /* best-effort — push failure must not break cron */ }
    }

    return new Response(JSON.stringify({
      ok: true,
      scanned: guests?.length ?? 0,
      auto_checkin_promoted: autoCheckinCount,
      auto_checkout_archived: autoCheckoutCount,
      fired: results.length,
      throttled: due.length > 1,
      dispatch_batch_size: DISPATCH_BATCH_SIZE,
      inter_send_delay_ms: INTER_SEND_DELAY_MS,
      results,
    }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 400, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});

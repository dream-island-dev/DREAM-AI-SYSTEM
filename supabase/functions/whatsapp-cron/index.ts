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
  checkEligibility,
  CORE_PIPELINE_STAGE_KEYS,
  isPastAutoCheckoutGateway,
  isPastDayPassAutoCheckoutGateway,
  israelYmd,
  isGuestStaffClaimActive,
  resolveAutomationScope,
  AUTO_CHECKOUT_ELIGIBLE_STATUSES,
  type AutomationStage,
  type GuestForSchedule,
} from "../_shared/automationSchedule.ts";
import { reconcileMissedArrivalConfirmations } from "../_shared/arrivalConfirmation.ts";
import { loadGuestByIdForPipeline } from "../_shared/guestOutboundGuard.ts";
import { isStageEffectivelyActive, primeGuestChannelConfig, isWhapiGuestSosActive } from "../_shared/guestWhapiRouting.ts";
import { buildRetryStateMap, evaluateRetryGate, RETRY_LOOKBACK_HOURS, type RetryState } from "../_shared/automationRetryGate.ts";
import { probeWhapiDeviceHealth, persistWhapiHealthToBotConfig } from "../_shared/whapiHealth.ts";
import { INTER_SEND_DELAY_MS, sleep } from "../_shared/outboundThrottle.ts";
import { processDuePostCheckoutSurveys, catchUpDepartedTodaySuiteCheckoutSurveys } from "../_shared/postCheckoutSurvey.ts";
import { runWeeklyGuestHallucinationAudit } from "../_shared/guestHallucinationAudit.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Sends per batch — logged for observability; still sequential, not parallel. */
const DISPATCH_BATCH_SIZE = 10;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // ── Health-watchdog heartbeat ────────────────────────────────────────────
  // Written BEFORE the kill switch below and never allowed to throw — this proves
  // "pg_cron → this function" is still firing, independent of whether CRON_ENABLED
  // is deliberately off. automation-health-cron (migration 162) reads this row;
  // a stale timestamp means the cron plumbing itself died, not just that sends
  // are paused (that state is already visible via CRON_ENABLED in ACC systemStatus).
  try {
    await createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    ).from("cron_heartbeats").upsert(
      { job_name: "whatsapp-cron", last_run_at: new Date().toISOString() },
      { onConflict: "job_name" },
    );
  } catch (e) {
    console.warn("[whatsapp-cron] heartbeat upsert failed (non-blocking):", (e as Error).message);
  }

  // ── Manual hallucination audit — URL ?audit=1 OR POST body {audit:true} ────
  // supabase.functions.invoke() can't pass a query string cleanly, so the
  // BotSettings "בריאות המוח" card sends {audit:true} in the body instead.
  // The audit is deterministic and sends ZERO guest messages, so an explicit
  // audit call runs BEFORE the CRON_ENABLED kill switch and returns immediately
  // — it must never trigger the outbound dispatch pipeline off-schedule.
  let bodyAudit = false;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    bodyAudit = body?.audit === true || body?.audit === "1" || body?.audit === 1;
  } catch { /* no JSON body — scheduled invocation */ }
  const forceAudit = bodyAudit || new URL(req.url).searchParams.get("audit") === "1";
  if (forceAudit) {
    try {
      const auditClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      const report = await runWeeklyGuestHallucinationAudit(auditClient);
      return new Response(
        JSON.stringify({ ok: true, audit_only: true, report }),
        { headers: { ...CORS, "Content-Type": "application/json" } },
      );
    } catch (e) {
      return new Response(
        JSON.stringify({ ok: false, audit_only: true, error: (e as Error).message }),
        { status: 500, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }
  }

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
    await primeGuestChannelConfig(supabase);

    // Weekly Sunday auto-run — forced audit (?audit=1 / body {audit:true}) is
    // handled as an early return above the kill switch and never reaches here.
    const isSundayIsrael = new Date().toLocaleString("en-US", { timeZone: "Asia/Jerusalem", weekday: "short" }) === "Sun";
    if (isSundayIsrael) {
      try {
        const auditReport = await runWeeklyGuestHallucinationAudit(supabase);
        console.info(
          `[whatsapp-cron] guest hallucination audit — passed ${auditReport.passed}/${auditReport.total}`,
        );
      } catch (e) {
        console.warn("[whatsapp-cron] guest hallucination audit failed (non-blocking):", (e as Error).message);
      }
    }

    // Whapi device probe (non-blocking) — persists bot_config for auto-failover.
    try {
      const whapiSnap = await probeWhapiDeviceHealth({ wakeup: false });
      await persistWhapiHealthToBotConfig(supabase, whapiSnap);
      await primeGuestChannelConfig(supabase);
      console.log(
        `[whatsapp-cron] whapi_health status=${whapiSnap.statusText} healthy=${whapiSnap.healthy} ` +
        `sos_effective=${isWhapiGuestSosActive()}`,
      );
    } catch (e) {
      console.warn("[whatsapp-cron] whapi_health probe failed (non-blocking):", (e as Error).message);
    }

    const now = new Date();
    const todayIsrael = israelYmd(now);
    const checkoutEligible = [...AUTO_CHECKOUT_ELIGIBLE_STATUSES];

    // Suite checkout: housekeeping WA group only (2026-07-17). No silent cron archival.
    let autoCheckoutCount = 0;
    const checkoutPatch = {
      status: "checked_out",
      checked_out_at: now.toISOString(),
      room_ready_notified: false,
      msg_room_ready_sent: false,
      room_ready_at: null,
    };

    // Day-pass same-day visit — 19:00 Israel (never 11:00 suite checkout).
    if (isPastDayPassAutoCheckoutGateway(now)) {
      const { data: dayPassToday, error: dayPassTodayErr } = await supabase
        .from("guests")
        .update(checkoutPatch)
        .in("room_type", ["day_guest", "premium_day_guest"])
        .eq("arrival_date", todayIsrael)
        .in("status", checkoutEligible)
        .select("id");
      if (dayPassTodayErr) {
        console.error("[whatsapp-cron] auto_checkout (daypass today) FAILED:", dayPassTodayErr.message);
      } else {
        autoCheckoutCount += dayPassToday?.length ?? 0;
      }

      const { data: dayPassOverdue, error: dayPassOverdueErr } = await supabase
        .from("guests")
        .update(checkoutPatch)
        .in("room_type", ["day_guest", "premium_day_guest"])
        .lt("arrival_date", todayIsrael)
        .in("status", checkoutEligible)
        .select("id");
      if (dayPassOverdueErr) {
        console.error("[whatsapp-cron] auto_checkout (daypass overdue) FAILED:", dayPassOverdueErr.message);
      } else {
        autoCheckoutCount += dayPassOverdue?.length ?? 0;
      }
    }

    const catchUp = await catchUpDepartedTodaySuiteCheckoutSurveys(supabase);
    if (catchUp.queued > 0 || catchUp.retried > 0) {
      console.log(
        `[whatsapp-cron] post_checkout_survey catch-up queued=${catchUp.queued} retried=${catchUp.retried}`,
      );
    }

    const postCheckoutSurveyResults = await processDuePostCheckoutSurveys(supabase, supabaseUrl, anon);
    if (postCheckoutSurveyResults.length > 0) {
      console.log(
        `[whatsapp-cron] post_checkout_survey processed=${postCheckoutSurveyResults.length} ` +
        `ok=${postCheckoutSurveyResults.filter((r) => r.ok).length}`,
      );
    }

    // is_active is NOT filtered in SQL anymore — a stage paused only because
    // its Meta template isn't approved yet must still reach Whapi-eligible
    // suite guests (isStageEffectivelyActive, per-guest, in the scan loop
    // below). Meta-bound guests are unaffected: the loop still skips them
    // exactly like the old `.eq("is_active", true)` filter did.
    const { data: stagesData, error: stagesErr } = await supabase
      .from("automation_stages")
      .select("*")
      .neq("schedule_mode", "event_immediate")
      .order("sequence_order");
    if (stagesErr) throw new Error(`stages_lookup_error: ${stagesErr.message}`);
    const stages = (stagesData ?? []) as AutomationStage[];

    // Same explicit column list as before this refactor — every flag column
    // any stage might reference, plus the resolver's anchor/eligibility fields.
    // needs_callback is selected for observability only — NOT used in eligibility
    // (checkEligibility in automationSchedule.ts; session 59 decouple).
    const GUEST_SELECT =
      "id, name, phone, arrival_date, departure_date, room, room_type, status, checkin_time, needs_callback, automation_muted, automation_scope, claimed_by, arrival_confirmed, arrival_confirmed_at, spa_date, spa_time, msg_stage_2_arrival_sent, msg_pre_arrival_2d_sent, msg_pre_arrival_sent, msg_morning_suite_sent, msg_morning_welcome_sent, msg_mid_stay_sent, msg_checkout_fb_sent, msg_spa_warmup_sent, msg_survey_invite_sent";

    const { data: guests = [] } = await supabase.from("guests").select(GUEST_SELECT);

    let guestsList = (guests ?? []) as GuestForSchedule[];

    const guestIdsForSuppress = guestsList.map((g) => g.id as number);
    const { data: suppressionRows } = await supabase
      .from("guest_pipeline_stage_suppressions")
      .select("guest_id, stage_key")
      .in("guest_id", guestIdsForSuppress.length ? guestIdsForSuppress : [-1]);
    const suppressedByGuestId = new Map<number, string[]>();
    for (const row of suppressionRows ?? []) {
      const gid = row.guest_id as number;
      const list = suppressedByGuestId.get(gid) ?? [];
      list.push(row.stage_key as string);
      suppressedByGuestId.set(gid, list);
    }
    if (suppressedByGuestId.size > 0) {
      guestsList = guestsList.map((g) => {
        const stages = suppressedByGuestId.get(g.id as number);
        return stages?.length ? { ...g, pipeline_suppressed_stages: stages } : g;
      });
    }

    // Anti-spam/anti-race latch (2026-07-13) — recent timeout/failed/
    // blocked_by_meta/processing attempts per (guest, trigger), attached the
    // same way as suppressions above so checkEligibility (automationSchedule.ts)
    // can gate a re-fire without any per-trigger duplication here. Narrower
    // than the existing automation-queue 7-day/all-status read (24h + 4
    // statuses only) — same table/shape, strictly cheaper.
    const retrySinceIso = new Date(now.getTime() - RETRY_LOOKBACK_HOURS * 3600 * 1000).toISOString();
    const { data: retryRows, error: retryErr } = await supabase
      .from("notification_log")
      .select("guest_id, trigger_type, status, sent_at")
      .in("guest_id", guestIdsForSuppress.length ? guestIdsForSuppress : [-1])
      .in("status", ["timeout", "failed", "blocked_by_meta", "processing"])
      .gte("sent_at", retrySinceIso);
    if (retryErr) {
      console.warn("[whatsapp-cron] retry_state lookup failed (non-blocking, no gate applied this tick):", retryErr.message);
    } else {
      const retryStateByKey = buildRetryStateMap(retryRows ?? []);
      if (retryStateByKey.size > 0) {
        guestsList = guestsList.map((g) => {
          const perStage: Record<string, RetryState> = {};
          for (const stage of stages) {
            const state = retryStateByKey.get(`${g.id}::${stage.stage_key}`);
            if (state) perStage[stage.stage_key] = state;
          }
          return Object.keys(perStage).length ? { ...g, automation_retry_state: perStage } : g;
        });
      }
    }

    const missedConfirmFixed = await reconcileMissedArrivalConfirmations(supabase, guestsList);
    if (missedConfirmFixed > 0) {
      console.log(`[whatsapp-cron] arrival_confirm_reconcile fixed=${missedConfirmFixed}`);
      const { data: refreshed, error: refreshErr } = await supabase.from("guests").select(GUEST_SELECT);
      if (refreshErr) {
        console.warn("[whatsapp-cron] guest refresh after confirm reconcile failed:", refreshErr.message);
      } else {
        guestsList = (refreshed ?? []) as GuestForSchedule[];
      }
    }

    // Truly-active (is_active=true) only — for the diagnostic warnings below,
    // which are specifically about the Meta path. `stages` itself now also
    // carries paused rows through to the scan loop (isStageEffectivelyActive
    // decides per-guest whether a paused row still applies via Whapi).
    const activeStageKeys = stages.filter((s) => s.is_active === true).map((s) => s.stage_key);
    console.log(`[whatsapp-cron] scan_start guests=${guestsList.length} active_stages=[${activeStageKeys.join(", ")}]`);

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
        "[whatsapp-cron] night_before is_active=false — Meta template path paused; " +
        "Whapi-eligible suite guests still dispatch via isStageEffectivelyActive. " +
        "Re-enable Meta: UPDATE automation_stages SET is_active=true WHERE stage_key='night_before';",
      );
    }

    const NIGHT_BEFORE_STAGE_KEYS = new Set(["night_before", "night_before_daypass"]);
    const MID_STAY_STAGE_KEYS = new Set(["mid_stay", "mid_stay_daypass"]);
    const MORNING_STAGE_KEYS = new Set(["morning_suite", "morning_welcome"]);
    type DueItem = { guestId: number; trigger: string; pipeline_reconcile?: boolean; staffScheduled?: boolean };

    const { data: staffSchedRows, error: staffSchedErr } = await supabase
      .from("scheduled_tasks")
      .select("guest_id, stage_key, scheduled_for")
      .eq("status", "pending")
      .eq("staff_scheduled", true);
    if (staffSchedErr) {
      console.warn("[whatsapp-cron] scheduled_tasks staff lookup failed:", staffSchedErr.message);
    }
    const staffScheduleByKey = new Map<string, string>();
    for (const row of staffSchedRows ?? []) {
      staffScheduleByKey.set(`${row.guest_id}::${row.stage_key}`, row.scheduled_for as string);
    }

    const due: DueItem[] = [];
    for (const guest of guestsList) {
      for (const stage of stages) {
        // Stage paused (is_active=false) and this guest isn't Whapi-eligible
        // → identical to the old `.eq("is_active", true)` SQL filter for
        // this guest. Whapi-eligible suite guests bypass a Meta-template-only
        // pause (isStageEffectivelyActive, _shared/guestWhapiRouting.ts).
        if (!isStageEffectivelyActive(stage, guest)) continue;

        const staffKey = `${guest.id}::${stage.stage_key}`;
        const staffSchedIso = staffScheduleByKey.get(staffKey);
        const result = resolveStageSchedule(stage, guest, now);
        if (
          NIGHT_BEFORE_STAGE_KEYS.has(stage.stage_key) ||
          MID_STAY_STAGE_KEYS.has(stage.stage_key) ||
          MORNING_STAGE_KEYS.has(stage.stage_key)
        ) {
          const flagCol = stage.guest_flag_column;
          const flagVal = flagCol ? guest[flagCol] : null;
          console.log(
            `[whatsapp-cron] stage_eval stage=${stage.stage_key} guest_id=${guest.id} ` +
            `room_type=${guest.room_type ?? "null"} arrival=${guest.arrival_date ?? "null"} ` +
            `local_time=${stage.local_time ?? "null"} israel_hour=${new Date().toLocaleString("en-GB", { timeZone: "Asia/Jerusalem", hour: "numeric", hour12: false })} ` +
            `applies_to=${stage.applies_to} ${flagCol ?? "flag"}=${String(flagVal)} ` +
            `dueNow=${result.dueNow} skipReason=${result.skipReason ?? "none"}`,
          );
        }
        if (staffSchedIso) {
          const schedMs = new Date(staffSchedIso).getTime();
          if (schedMs > now.getTime()) {
            continue;
          }
          const skipReason = checkEligibility(stage, guest, now);
          if (!skipReason) {
            console.log(
              `[whatsapp-cron] staff_schedule QUEUED guest_id=${guest.id} trigger=${stage.stage_key} at=${staffSchedIso}`,
            );
            due.push({ guestId: guest.id as number, trigger: stage.stage_key, staffScheduled: true });
          }
          continue;
        }
        if (result.dueNow) {
          console.log(`[whatsapp-cron] QUEUED guest_id=${guest.id} trigger=${stage.stage_key}`);
          due.push({ guestId: guest.id as number, trigger: stage.stage_key });
        }
      }
    }

    // ── Stage 2 reconciliation: ✓ אישר but Stage 2 never actually sent ──
    // stage_2_arrival is event_immediate — excluded from `stages` scan above; check row directly.
    const { data: stage2StageRow } = await supabase
      .from("automation_stages")
      .select("is_active")
      .eq("stage_key", "stage_2_arrival")
      .maybeSingle();
    const stage2InPipeline = stage2StageRow?.is_active !== false;
    let stage2ReconcileQueued = 0;
    if (stage2InPipeline) {
      await supabase
        .from("guests")
        .update({ arrival_confirmed_at: new Date().toISOString() })
        .eq("arrival_confirmed", true)
        .is("arrival_confirmed_at", null)
        .eq("msg_stage_2_arrival_sent", false);

      const dueKey = (gId: number, tr: string) =>
        due.some((d) => d.guestId === gId && d.trigger === tr);

      const confirmedGuestIds = guestsList
        .filter((g) => g.arrival_confirmed || g.arrival_confirmed_at)
        .map((g) => g.id as number);

      // QA audit fix (2026-07-06): this lookup used to be read without checking
      // `error` — a failed query left `stage2ActuallySent` empty, which the loop
      // below read as "NOBODY has received Stage 2 yet", causing it to reset
      // msg_stage_2_arrival_sent=false and re-queue EVERY confirmed guest for a
      // fresh send on incomplete/wrong data. Fail closed instead: on lookup
      // failure, skip the whole reconcile pass this tick (no flag resets, no
      // re-queues) and retry on the next cron tick (~15 min later) once the
      // table is readable again.
      const stage2ActuallySent = new Set<number>();
      let stage2LogLookupFailed = false;
      if (confirmedGuestIds.length > 0) {
        const { data: sentLogs, error: sentLogsErr } = await supabase
          .from("notification_log")
          .select("guest_id")
          .in("guest_id", confirmedGuestIds)
          .eq("trigger_type", "stage_2_arrival")
          .in("status", ["sent", "simulated"]);
        if (sentLogsErr) {
          stage2LogLookupFailed = true;
          console.error(
            "[whatsapp-cron] stage_2_reconcile ABORTED — notification_log lookup failed; " +
            "refusing to reset flags or re-queue sends on incomplete data:",
            sentLogsErr.message,
          );
        } else {
          for (const row of sentLogs ?? []) {
            if (row.guest_id != null) stage2ActuallySent.add(row.guest_id as number);
          }
        }
      }

      if (!stage2LogLookupFailed) {
        for (const guest of guestsList) {
          if (guest.status === "cancelled" || guest.status === "checked_out") continue;
          if (resolveAutomationScope(guest) !== "full") continue;
          if (!guest.arrival_confirmed && !guest.arrival_confirmed_at) continue;
          if (isGuestStaffClaimActive(guest)) continue;
          const gId = guest.id as number;
          if (stage2ActuallySent.has(gId)) continue;
          if (dueKey(gId, "stage_2_arrival")) continue;
          // stage_2_arrival is schedule_mode='event_immediate' — excluded
          // from the main due-loop above (and its checkEligibility retry-gate
          // check) by design, so this separate reconcile pass needs its own
          // anti-spam latch on the exact same automation_retry_state map.
          if (evaluateRetryGate(guest.automation_retry_state?.stage_2_arrival, now)) continue;

          if (guest.msg_stage_2_arrival_sent === true) {
            await supabase.from("guests").update({ msg_stage_2_arrival_sent: false }).eq("id", gId);
            console.log(`[whatsapp-cron] stage_2_reconcile reset false-positive flag guest_id=${gId}`);
          }

          console.log(
            `[whatsapp-cron] stage_2_reconcile QUEUED guest_id=${gId} ` +
            `arrival_confirmed=${guest.arrival_confirmed} no_successful_notification_log`,
          );
          due.push({ guestId: gId, trigger: "stage_2_arrival", pipeline_reconcile: true });
          stage2ReconcileQueued++;
        }
      }
    }

    // 15:00 Israel auto check-in DISABLED (2026-07-11) — the housekeeping WA
    // group ("N צ'ק אין") is now the sole check-in source for suites; this
    // sweep used to race ahead of staff and made the group ack falsely read
    // "כבר מסומן כצ'ק-אין". See docs/changelog.md.

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
      const liveGuest = await loadGuestByIdForPipeline(supabase, d.guestId, d.trigger);
      if (!liveGuest) {
        console.warn(`[whatsapp-cron] skip dispatch — guest ${d.guestId} deleted or inactive (trigger=${d.trigger})`);
        results.push({ ...d, ok: false, skipped: true, reason: "guest_not_active" });
        if (i < due.length - 1) await sleep(INTER_SEND_DELAY_MS);
        continue;
      }
      try {
        const res = await fetch(`${supabaseUrl}/functions/v1/whatsapp-send`, {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: anon, Authorization: `Bearer ${anon}` },
          body: JSON.stringify(d),
        });
        const resOk = res.ok;
        results.push({ ...d, ok: resOk });
        if (resOk && d.staffScheduled) {
          const { error: markErr } = await supabase.rpc("mark_scheduled_task_dispatched", {
            p_guest_id: d.guestId,
            p_stage_key: d.trigger,
          });
          if (markErr) {
            console.warn(
              `[whatsapp-cron] mark_scheduled_task_dispatched guest=${d.guestId} stage=${d.trigger}:`,
              markErr.message,
            );
          }
        }
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
      auto_checkout_archived: autoCheckoutCount,
      fired: results.length,
      stage2_reconcile_queued: stage2ReconcileQueued,
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

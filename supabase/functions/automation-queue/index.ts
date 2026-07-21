// supabase/functions/automation-queue/index.ts
//
// Read-only Live Queue + Pulse monitor for the Automation Control Center
// (Phase 2). Computes, for every active automation_stages row × every
// operationally-relevant guest, the predicted next-dispatch instant using
// the EXACT SAME resolver whatsapp-cron will use once Phase 4 wires it up
// (supabase/functions/_shared/automationSchedule.ts) — so what the admin
// sees here can never silently drift from what actually fires.
//
// This function makes NO writes anywhere and does not send any message —
// it is purely a projection over guests + automation_stages + notification_log.
//
// Returns:
//   {
//     ok: true,
//     systemStatus: { cronEnabled, automationEnabled, simulation },
//     queue: [{ guestId, guestName, phone, room, stageKey, displayName, journeyPhase,
//               nodeType, scheduledFor, dueNow, predictedChannel, status, skipReason }],
//     attentionRequired: [{ guestId, guestName, phone, stageKey, status, sentAt, payload }],
//   }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  resolveStageSchedule,
  type AutomationStage,
  type GuestForSchedule,
} from "../_shared/automationSchedule.ts";
import {
  getMissingRoomAssignmentSkipReason,
  hasPremiumDayRoomTypeConflict,
  hasSuiteRoomTypeConflict,
  isEffectiveDayPassGuest,
  isEffectiveSuiteGuest,
} from "../_shared/suiteNames.ts";
import {
  isStageEffectivelyActive,
  shouldRouteGuestOutboundViaWhapiSuites,
  isWhapiGuestSosActive,
  primeGuestChannelConfig,
  getGuestSuitesChannel,
  getGuestDaypassChannel,
  getWhapiDeviceStatusSnapshot,
} from "../_shared/guestWhapiRouting.ts";
import {
  buildRetryStateMap,
  RETRY_LOOKBACK_HOURS,
  type RetryState,
} from "../_shared/automationRetryGate.ts";
import {
  pipelineSegmentFromAppliesTo,
  stageAppliesToGuestPipeline,
} from "../_shared/automationCohort.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** Guests matching these reasons must never appear in the live queue preview. */
const PERMANENT_SKIP_REASONS = new Set([
  "wrong_room_type",
  "missing_room_assignment",
  "missing_phone",
  "guest_cancelled",
  "automation_muted",
  "automation_courtesy_only",
  "already_sent",
  "guest_already_departed",
  "missing_anchor_date",
  "missing_anchor_timestamp",
  "unknown_schedule_mode",
  // checkout_fb_daypass yields to survey_invite_daypass for spa-cohort guests
  // (2026-07-13 dedupe) — guest IS being contacted, just via the other stage.
  "superseded_by_survey",
  "date_passed",
]);

/** Temporal guards — show in Live Queue (like Stage 4 not_checked_in), never omit. */
const QUEUE_PREVIEW_VISIBLE_SKIP_REASONS = new Set([
  "awaiting_confirmation",
  "not_checked_in",
  "not_arrival_day",
  "not_on_property",
  "quiet_hours_passed",
  "staff_claim_active",
  "stage_suppressed",
  "already_checked_in",
  // Stage 1 late-import catch-up — still dispatchable manually / Whapi bulk.
  "missed_window",
  // Anti-spam/anti-race latch (automationRetryGate.ts, 2026-07-13) — all three
  // need staff visibility, never silent omission: cooldown/in_flight resolve
  // on their own, exhausted needs a human (manual/Override dispatch).
  "cooldown",
  "exhausted",
  "in_flight",
  // Suite Stage 5 — always visible; send_after merged from post_checkout_survey_queue.
  "suite_checkout_survey_via_housekeeping",
]);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    // Must prime before any isStageEffectivelyActive/shouldRouteGuestOutboundViaWhapiSuites call below.
    await primeGuestChannelConfig(supabase);

    const now = await (async () => {
      if (req.method === "POST") {
        try {
          const body = await req.json();
          if (body?.previewAt) {
            const parsed = new Date(body.previewAt);
            if (!Number.isNaN(parsed.getTime())) return parsed;
          }
        } catch {
          /* empty body — use live clock */
        }
      }
      return new Date();
    })();

    // Same kill-switches that gate the live functions — exposing them here
    // is the entire "Pulse" feature, no new infra required.
    const systemStatus = {
      cronEnabled: Deno.env.get("CRON_ENABLED") === "true",
      automationEnabled: Deno.env.get("AUTOMATION_ENABLED") === "true",
      simulation:
        Deno.env.get("WHATSAPP_SIMULATION") === "true" ||
        !(Deno.env.get("META_WHATSAPP_TOKEN") ?? Deno.env.get("WHATSAPP_TOKEN")) ||
        !(Deno.env.get("META_PHONE_NUMBER_ID") ?? Deno.env.get("WHATSAPP_PHONE_NUMBER_ID")),
      // P0 SOS (2026-07-13) — WHAPI_GUEST_SOS_META. When true, every guest
      // automation that would route via the Suites Whapi device falls back
      // to Meta Dream Bot instead (guestWhapiRouting.ts). FAIL VISIBLE badge.
      whapiGuestSosActive: isWhapiGuestSosActive(),
      whapiDevice: getWhapiDeviceStatusSnapshot(),
      // P0 channel control (2026-07-13) — current ACC selector state, so the
      // frontend dropdowns can render the live value without a second query.
      guestSuitesChannel: getGuestSuitesChannel(),
      guestDaypassChannel: getGuestDaypassChannel(),
      previewAt: now.toISOString(),
    };

    // is_active is NOT filtered in SQL — a stage paused only because its Meta
    // template isn't approved yet must still surface for Whapi-eligible suite
    // guests in the Live Queue (isStageEffectivelyActive, per-guest, below) —
    // same gate whatsapp-cron uses, so the queue can never show a row that
    // won't actually fire, or hide one that will.
    const { data: stagesData, error: stagesErr } = await supabase
      .from("automation_stages")
      .select("*")
      .order("sequence_order");
    if (stagesErr) throw new Error(`stages_lookup_error: ${stagesErr.message}`);
    const stages = (stagesData ?? []) as AutomationStage[];

    // Operationally-relevant window: guests whose arrival or departure is
    // recent-past-to-future. Excludes long-departed guests (those live in
    // the separate Past Guests view) — keeps this projection bounded.
    const cutoff = ymd(new Date(now.getTime() - 3 * 24 * 3600 * 1000));
    const { data: guestsData, error: guestsErr } = await supabase
      .from("guests")
      .select("*")
      .or(`arrival_date.gte.${cutoff},departure_date.gte.${cutoff}`);
    if (guestsErr) throw new Error(`guests_lookup_error: ${guestsErr.message}`);
    const guests = (guestsData ?? []) as GuestForSchedule[];

    const guestIds = guests.map((g) => g.id);
    const stageKeys = stages.map((s) => s.stage_key);

    // Last 7 days of notification_log for these guests/stages — gives the
    // queue its actual sent/failed/timeout status instead of only a
    // prediction, and feeds the separate "attentionRequired" list.
    const sinceWindow = new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString();
    const { data: logRows, error: logErr } = await supabase
      .from("notification_log")
      .select("guest_id, trigger_type, status, sent_at, payload, recipient")
      .in("guest_id", guestIds.length ? guestIds : [-1])
      .in("trigger_type", stageKeys.length ? stageKeys : ["__none__"])
      .gte("sent_at", sinceWindow)
      .order("sent_at", { ascending: false });
    if (logErr) throw new Error(`notification_log_lookup_error: ${logErr.message}`);

    // Most recent log row per (guest_id, trigger_type) — rows are already
    // ordered newest-first above.
    const latestByKey = new Map<string, (typeof logRows)[number]>();
    for (const row of logRows ?? []) {
      const key = `${row.guest_id}::${row.trigger_type}`;
      if (!latestByKey.has(key)) latestByKey.set(key, row);
    }

    const guestById = new Map(guests.map((g) => [g.id, g]));

    const { data: schedRows, error: schedErr } = await supabase
      .from("scheduled_tasks")
      .select("guest_id, stage_key, scheduled_for, staff_scheduled")
      .eq("status", "pending")
      .in("guest_id", guestIds.length ? guestIds : [-1]);
    if (schedErr) throw new Error(`scheduled_tasks_lookup_error: ${schedErr.message}`);

    const pendingScheduleByKey = new Map<string, { scheduled_for: string; staff_scheduled: boolean }>();
    for (const row of schedRows ?? []) {
      pendingScheduleByKey.set(`${row.guest_id}::${row.stage_key}`, {
        scheduled_for: row.scheduled_for as string,
        staff_scheduled: row.staff_scheduled === true,
      });
    }

    const { data: surveyQueueRows, error: surveyQueueErr } = await supabase
      .from("post_checkout_survey_queue")
      .select("guest_id, send_after, source")
      .eq("status", "pending")
      .in("guest_id", guestIds.length ? guestIds : [-1]);
    if (surveyQueueErr) {
      throw new Error(`post_checkout_survey_queue_lookup_error: ${surveyQueueErr.message}`);
    }
    const pendingSurveyByGuestId = new Map<number, { send_after: string; source: string }>();
    for (const row of surveyQueueRows ?? []) {
      pendingSurveyByGuestId.set(row.guest_id as number, {
        send_after: row.send_after as string,
        source: String(row.source ?? "housekeeping_wa"),
      });
    }

    const { data: suppressionRows, error: suppressErr } = await supabase
      .from("guest_pipeline_stage_suppressions")
      .select("guest_id, stage_key")
      .in("guest_id", guestIds.length ? guestIds : [-1]);
    if (suppressErr) throw new Error(`suppressions_lookup_error: ${suppressErr.message}`);

    const suppressedByGuestId = new Map<number, string[]>();
    for (const row of suppressionRows ?? []) {
      const gid = row.guest_id as number;
      const list = suppressedByGuestId.get(gid) ?? [];
      list.push(row.stage_key as string);
      suppressedByGuestId.set(gid, list);
    }

    const attachSuppressions = (guest: GuestForSchedule): GuestForSchedule => {
      const stages = suppressedByGuestId.get(guest.id as number);
      if (!stages?.length) return guest;
      return { ...guest, pipeline_suppressed_stages: stages };
    };

    // Anti-spam/anti-race latch (automationRetryGate.ts, 2026-07-13) — derived
    // from the notification_log rows already fetched above (no new query).
    // Same gate whatsapp-cron applies before dispatching, so the Live Queue
    // can never show "pending" for a guest cron is actually holding back.
    const retryLookbackSinceMs = now.getTime() - RETRY_LOOKBACK_HOURS * 3600 * 1000;
    const retryEligibleRows = (logRows ?? []).filter((r) =>
      (r.status === "timeout" || r.status === "failed" || r.status === "blocked_by_meta" || r.status === "processing") &&
      r.sent_at != null && new Date(r.sent_at as string).getTime() >= retryLookbackSinceMs
    );
    const retryStateByKey = buildRetryStateMap(retryEligibleRows);
    const attachRetryState = (guest: GuestForSchedule): GuestForSchedule => {
      const perStage: Record<string, RetryState> = {};
      for (const stage of stages) {
        const state = retryStateByKey.get(`${guest.id}::${stage.stage_key}`);
        if (state) perStage[stage.stage_key] = state;
      }
      return Object.keys(perStage).length ? { ...guest, automation_retry_state: perStage } : guest;
    };

    /** Hard pipeline gate — never surface the wrong journey in Live Queue. */
    const stageMatchesGuestPipeline = (stage: AutomationStage, guest: GuestForSchedule): boolean =>
      stageAppliesToGuestPipeline(stage.applies_to, guest);

    const queue: Record<string, unknown>[] = [];
    for (const stage of stages) {
      for (const guest of guests) {
        const guestRow = attachRetryState(attachSuppressions(guest));
        if (!stageMatchesGuestPipeline(stage, guestRow)) continue;
        if (!isStageEffectivelyActive(stage, guestRow)) continue;

        const result = resolveStageSchedule(stage, guestRow, now);
        const logRow = latestByKey.get(`${guest.id}::${stage.stage_key}`);

        // Omit rows that can never fire for this guest/stage combo.
        if (!logRow && result.skipReason && PERMANENT_SKIP_REASONS.has(result.skipReason)) continue;
        if (
          !logRow
          && result.scheduledFor === null
          && result.skipReason !== null
          && !QUEUE_PREVIEW_VISIBLE_SKIP_REASONS.has(result.skipReason)
        ) continue;

        const pendingSched = pendingScheduleByKey.get(`${guest.id}::${stage.stage_key}`);
        let scheduledForIso = result.scheduledFor ? result.scheduledFor.toISOString() : null;
        let dueNow = result.dueNow;
        let staffScheduled = false;

        if (pendingSched) {
          scheduledForIso = pendingSched.scheduled_for;
          staffScheduled = pendingSched.staff_scheduled;
          if (staffScheduled) {
            const timeDue = new Date(pendingSched.scheduled_for).getTime() <= now.getTime();
            dueNow = timeDue
              && !logRow
              && (!result.skipReason || QUEUE_PREVIEW_VISIBLE_SKIP_REASONS.has(result.skipReason));
          }
        }

        // Suite checkout_fb — real send time lives in post_checkout_survey_queue (Co + delay).
        if (
          stage.stage_key === "checkout_fb"
          && isEffectiveSuiteGuest(guest)
          && !staffScheduled
        ) {
          const pendingSurvey = pendingSurveyByGuestId.get(guest.id as number);
          if (pendingSurvey) {
            scheduledForIso = pendingSurvey.send_after;
            dueNow = new Date(pendingSurvey.send_after).getTime() <= now.getTime()
              && guest.status === "checked_out"
              && !logRow;
          }
        }

        queue.push({
          guestId: guest.id,
          guestName: (guest as Record<string, unknown>).name ?? null,
          phone: (guest as Record<string, unknown>).phone ?? null,
          room: (guest as Record<string, unknown>).room ?? null,
          room_type: (guest as Record<string, unknown>).room_type ?? null,
          // Effective routing truth (suiteNames.ts) — the ACC chips/gates must
          // segment by THIS, not raw room_type, to match cron/send routing.
          effectiveSuite: isEffectiveSuiteGuest(guest),
          effectiveDayPass: isEffectiveDayPassGuest(guest),
          missingRoomAssignment: getMissingRoomAssignmentSkipReason(guest) != null,
          // Real outbound-channel truth (guestWhapiRouting.ts) — suite OR
          // day-pass when GUEST_WHAPI_SUITES_ENABLED, same gate whatsapp-send
          // actually dispatches on. effectiveSuite above is suite-only and
          // under-reports Whapi-eligible day-pass guests in ACC chips/gates.
          effectiveWhapiGuest: shouldRouteGuestOutboundViaWhapiSuites(guest),
          // FAIL VISIBLE: suite room + day-pass room_type — ⚠ badge in ACC.
          roomTypeConflict: hasSuiteRoomTypeConflict(guest),
          premiumDayRoomTypeConflict: hasPremiumDayRoomTypeConflict(guest),
          arrivalDate: (guest as Record<string, unknown>).arrival_date ?? null,
          departureDate: (guest as Record<string, unknown>).departure_date ?? null,
          stageKey: stage.stage_key,
          appliesTo: stage.applies_to,
          pipelineSegment: pipelineSegmentFromAppliesTo(stage.applies_to),
          sequenceOrder: stage.sequence_order ?? 999,
          displayName: stage.display_name,
          journeyPhase: stage.journey_phase,
          nodeType: stage.node_type,
          scheduledFor: scheduledForIso,
          dueNow,
          staffScheduled,
          // "predicted" — the real channel decision happens at actual send
          // time (Phase 4); this is a best-effort projection, not a promise.
          predictedChannel:
            stage.node_type === "session_message"
              ? "session_message"
              : stage.node_type === "meta_template"
              ? "meta_template"
              : (guest as Record<string, unknown>).wa_window_expires_at &&
                  new Date((guest as Record<string, unknown>).wa_window_expires_at as string) > now
                ? "session_message"
                : "meta_template",
          // Temporal guards (e.g. not_checked_in for Stage 4) stay "pending" so
          // the Live Queue never hides a future-scheduled stage as "skipped".
          status: logRow?.status ?? (
            result.skipReason && PERMANENT_SKIP_REASONS.has(result.skipReason) ? "skipped" : "pending"
          ),
          skipReason: logRow ? null : result.skipReason,
          checkoutSurveyQueued: stage.stage_key === "checkout_fb"
            && isEffectiveSuiteGuest(guest)
            && pendingSurveyByGuestId.has(guest.id as number),
          // Additive, independent of skipReason's existing "null once a log
          // row exists" semantics above (other consumers may depend on that) —
          // this is the one place "why isn't cron retrying right now" survives
          // past the first logged attempt, for the ACC badge.
          retryGate: (result.skipReason === "cooldown" || result.skipReason === "exhausted" || result.skipReason === "in_flight")
            ? result.skipReason
            : null,
          lastAttemptAt: logRow?.sent_at ?? null,
        });
      }
    }

    // Sort: due-now first, then soonest-scheduled, then no-prediction last.
    queue.sort((a, b) => {
      const aTime = a.scheduledFor ? new Date(a.scheduledFor as string).getTime() : Infinity;
      const bTime = b.scheduledFor ? new Date(b.scheduledFor as string).getTime() : Infinity;
      return aTime - bTime;
    });

    const attentionRequired = (logRows ?? [])
      .filter((r) =>
        r.status === "failed" || r.status === "timeout" || r.status === "blocked_by_meta"
        || r.status === "failed_missing_link" || r.status === "duplicate_blocked"
      )
      .map((r) => ({
        guestId: r.guest_id,
        guestName: (guestById.get(r.guest_id) as Record<string, unknown> | undefined)?.name ?? null,
        phone: r.recipient,
        stageKey: r.trigger_type,
        status: r.status,
        sentAt: r.sent_at,
        payload: r.payload,
      }));

    return new Response(
      JSON.stringify({ ok: true, systemStatus, queue, attentionRequired }),
      { headers: { ...CORS, "Content-Type": "application/json" } },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[automation-queue] error:", msg);
    // Same convention as the rest of the codebase: always 200, error in body
    // (see whatsapp-send/get-wa-templates header comments for why).
    return new Response(
      JSON.stringify({ ok: false, error: msg }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
    );
  }
});

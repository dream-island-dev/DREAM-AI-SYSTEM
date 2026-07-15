// supabase/functions/sla-escalation-cron/index.ts
// SLA escalation scanner (pg_cron, every 1 min — see migration 074).
//
// Scans FOUR queues for overdue items in English (dual-language framework:
// guests Hebrew, staff English):
//   • guest_alerts (Guest Requests Board) — flat 10-min threshold, unchanged —
//     notifies Adir (SLA_GUEST_ALERT_PHONE) via Meta (whatsapp-send inbox_reply).
//   • pending_approval guest_request tasks (HITL stuck) — after 7 min with no
//     reception Approve, auto-invoke notify-manual-task (pending→open + Whapi
//     ops card) and page Mike/Eliad/Adir. Fixes the red-dot-ignored gap where
//     the guest waited forever because sla only watched status='open'.
//   • tasks status='open' unassigned SLA — unchanged (category 10/15/30 or
//     flat SLA_UNASSIGNED_MINUTES). Claimed (in_progress) stops escalating.
//   • soft Inbox handoffs (human_requested, non-ops types: spa / late checkout /
//     finance / staff_handoff) — after 20 min, ping duty reception only. Never
//     opens a field-ops card (migration 186 handoff_escalated_at idempotency).
//
// Same dedicated kill switch: deploying this does nothing until
// SLA_ESCALATION_ENABLED=true is set explicitly in Supabase Secrets.
//
// Delivery split: guest_alerts + soft handoffs → whatsapp-send "inbox_reply"
// (Meta). pending auto-approve → notify-manual-task + Whapi DM to management.
// open unassigned → Whapi ops group; guest_request may also DM SLA_OPS_ALERT_PHONE
// when SLA_OPS_PERSONAL_ALERT_ENABLED=true (off by default — Lidor personal pings).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendWhapiText } from "../_shared/whapiSend.ts";
import { containsHebrew, translateTextForFieldOps } from "../_shared/fieldOpsTranslation.ts";
import {
  isFutureSuiteRoomServiceTask,
  SUITES_ROOM_SERVICE_GROUP_ID,
} from "../_shared/futureSuiteRoomServiceRouting.ts";
import {
  resolveRouting,
  taskIntentType,
  alertIntentType,
} from "../_shared/routingConfig.ts";
import { listKnownExecutivePhoneDigits } from "../_shared/executiveIdentity.ts";
import {
  PENDING_APPROVAL_AUTO_APPROVE_MINUTES,
  SOFT_HANDOFF_SLA_MINUTES,
  pendingApprovalCutoffIso,
  softHandoffCutoffIso,
  isSoftHandoffHumanRequestType,
  dedupePhoneDigits,
  buildPendingAutoApproveManagerText,
  buildSoftHandoffManagerText,
} from "../_shared/handoffEscalation.ts";
import {
  buildGuestAlertSlaEscalationText,
  formatAdirGuestLabel,
} from "../_shared/adirNotifyMessages.ts";
import { loadStaffNotifyTemplates } from "../_shared/staffNotifyTemplates.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GUEST_ALERT_SLA_MINUTES = 10;
const OPS_UNASSIGNED_SLA_MINUTES = Number(Deno.env.get("SLA_UNASSIGNED_MINUTES") ?? 7);
const PUSH_DEPARTMENT = "הנהלה";

// Same canonical category→minutes map as whapi-webhook/staff-ops-webhook's
// SLA_THRESHOLDS — duplicated, not imported (this repo's established
// "small constants duplicated across the front/back boundary" convention,
// CLAUDE.md §3 OperationsBoard.js's SLA_CATEGORY_OPTIONS header comment).
// Session 30 Sprint 5.3b: a task with one of these categories escalates on
// ITS OWN window, not the flat OPS_UNASSIGNED_SLA_MINUTES fallback below.
const SLA_CATEGORY_MINUTES: Record<string, number> = {
  pest_control:    10,
  guest_amenities: 15,
  maintenance:      30,
};
function unassignedThresholdMinutes(slaCategory: string | null): number {
  if (slaCategory && slaCategory in SLA_CATEGORY_MINUTES) return SLA_CATEGORY_MINUTES[slaCategory];
  return OPS_UNASSIGNED_SLA_MINUTES;
}

async function notifyWhatsapp(supabaseUrl: string, anon: string, phone: string, message: string): Promise<boolean> {
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/whatsapp-send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: anon, Authorization: `Bearer ${anon}` },
      body: JSON.stringify({ trigger: "inbox_reply", phone, message }),
    });
    const json = await res.json().catch(() => ({}));
    return res.ok && json?.ok !== false;
  } catch (e) {
    console.error(`[sla-escalation-cron] failed to notify ${phone}:`, (e as Error).message);
    return false;
  }
}

async function pushAlert(supabaseUrl: string, anon: string, title: string, body: string): Promise<void> {
  try {
    await fetch(`${supabaseUrl}/functions/v1/push-notify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: anon, Authorization: `Bearer ${anon}` },
      body: JSON.stringify({ department: PUSH_DEPARTMENT, title, body, tag: "sla-breach" }),
    });
  } catch (e) {
    console.warn("[sla-escalation-cron] push-notify call failed (non-blocking):", (e as Error).message);
  }
}

/** Personal 1:1 SLA pings to SLA_OPS_ALERT_PHONE (Lidor) — disabled unless explicitly enabled. */
function isOpsPersonalAlertEnabled(): boolean {
  return Deno.env.get("SLA_OPS_PERSONAL_ALERT_ENABLED") === "true";
}

function opsPersonalAlertPhone(): string {
  if (!isOpsPersonalAlertEnabled()) return "";
  return (Deno.env.get("SLA_OPS_ALERT_PHONE") ?? "").trim();
}

/** Mike + Eliad (KNOWN_EXECUTIVES) + Adir phones + optional MANAGEMENT_ESCALATION_PHONES. */
function managementEscalationPhones(): string[] {
  const extra = (Deno.env.get("MANAGEMENT_ESCALATION_PHONES") ?? "").split(",");
  return dedupePhoneDigits([
    ...listKnownExecutivePhoneDigits(),
    opsPersonalAlertPhone(),
    Deno.env.get("SLA_GUEST_ALERT_PHONE"),
    ...extra,
  ]);
}

async function pingPhonesWhapi(phones: string[], message: string): Promise<number> {
  let ok = 0;
  for (const phone of phones) {
    try {
      await sendWhapiText(phone, message, { noLinkPreview: true });
      ok++;
    } catch (e) {
      console.error(`[sla-escalation-cron] management Whapi ping failed for ${phone}:`, (e as Error).message);
    }
  }
  return ok;
}

/** Same Approve & Dispatch path OperationsBoard uses — flips pending_approval→open + Whapi card. */
async function invokeNotifyManualTask(
  supabaseUrl: string,
  serviceKey: string,
  taskId: string | number,
): Promise<{ ok: boolean; notified: boolean; reason?: string }> {
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
    return {
      ok: res.ok && json?.ok !== false,
      notified: json?.notified === true,
      reason: json?.reason ?? json?.error,
    };
  } catch (e) {
    return { ok: false, notified: false, reason: (e as Error).message };
  }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // ── EMERGENCY KILL SWITCH ───────────────────────────────────────────────────
  if (Deno.env.get("SLA_ESCALATION_ENABLED") !== "true") {
    console.log("[sla-escalation-cron] 🚫 HALTED — SLA_ESCALATION_ENABLED not set to 'true'. Zero messages dispatched.");
    return new Response(
      JSON.stringify({ ok: true, halted: true, reason: "SLA_ESCALATION_ENABLED_not_set" }),
      { headers: { ...CORS, "Content-Type": "application/json" } },
    );
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const staffTemplates = await loadStaffNotifyTemplates(supabase);

    const guestAlertPhone = Deno.env.get("SLA_GUEST_ALERT_PHONE") ?? "";
    if (!guestAlertPhone) console.warn("[sla-escalation-cron] ⚠️ SLA_GUEST_ALERT_PHONE not set — overdue guest alerts will be marked escalated with nobody notified.");

    // ════════════════════════════════════════════════════════════════════════
    // 1. Guest Requests Board — guest_alerts, flat 10-min threshold
    // ════════════════════════════════════════════════════════════════════════
    const guestThresholdIso = new Date(Date.now() - GUEST_ALERT_SLA_MINUTES * 60 * 1000).toISOString();
    // arrival_date/status added so the breach text can flag a not-yet-arrived
    // guest (portal requests can land days before check-in) — same comparison
    // as src/utils/guestTiming.js's isFutureArrival, duplicated here rather
    // than imported (Deno functions don't import frontend modules in this repo).
    const { data: overdueAlerts, error: alertsErr } = await supabase
      .from("guest_alerts")
      .select("id, phone, message, alert_type, created_at, guest_id, guests(name, room, arrival_date, status)")
      .eq("resolved", false)
      .is("escalated_at", null)
      .lt("created_at", guestThresholdIso);
    if (alertsErr) throw new Error(`guest_alerts_lookup_error: ${alertsErr.message}`);

    const guestResults: Array<{ alertId: number; notified: boolean }> = [];
    for (const alert of overdueAlerts ?? []) {
      // Guest Requests channel gate (migration 121, routing_config): spa /
      // upsell asks (alert_request / alert_upsell_opportunity) default to
      // enable_sla=false — a future order shouldn't page Adir on a rigid
      // 10-min clock the same way a genuine callback/complaint does.
      const alertRouting = await resolveRouting(
        supabase,
        alertIntentType(alert.alert_type as string | null | undefined),
        { destination_board: "requests", whatsapp_group_id: null, enable_sla: true },
      );
      if (!alertRouting.enable_sla) continue;

      const alertGuest = (alert as any).guests as { name?: string; room?: string; arrival_date?: string; status?: string } | null;
      const guestLabel = alertGuest
        ? `${alertGuest.name ?? "אורח"} (${alertGuest.room ?? "—"})`
        : alert.phone;
      // Same exact tag format as guest-portal-upsell/guest-portal-ops-request's
      // futureArrivalTag() — "PORTAL CTAS & ADIR'S FUTURE CONTEXT" session —
      // duplicated here rather than imported (Deno function boundary).
      let arrivalNote = "";
      if (alertGuest?.arrival_date && alertGuest.status !== "checked_in") {
        const today = new Date(); today.setUTCHours(0, 0, 0, 0);
        const arrival = new Date(`${alertGuest.arrival_date}T00:00:00Z`);
        const daysAway = Math.round((arrival.getTime() - today.getTime()) / 86400000);
        if (daysAway > 0) arrivalNote = `⚠️ בקשה עתידית — הגעה ב-${alertGuest.arrival_date} (בעוד ${daysAway} ימים)`;
      }
      const ageMinutes = Math.round((Date.now() - new Date(alert.created_at as string).getTime()) / 60000);
      const hebrewText = buildGuestAlertSlaEscalationText({
        ageMinutes,
        thresholdMinutes: GUEST_ALERT_SLA_MINUTES,
        guestLabel,
        alertType: String(alert.alert_type ?? "request"),
        message: String(alert.message ?? ""),
        phone: String(alert.phone ?? ""),
        guestName: alertGuest?.name ?? null,
        futureArrivalNote: arrivalNote || null,
        templates: staffTemplates,
      });

      const notified = guestAlertPhone ? await notifyWhatsapp(supabaseUrl, anon, guestAlertPhone, hebrewText) : false;

      const { error: markErr } = await supabase
        .from("guest_alerts")
        .update({ escalated_at: new Date().toISOString() })
        .eq("id", alert.id);
      if (markErr) console.error(`[sla-escalation-cron] failed to mark guest_alerts ${alert.id} escalated (will re-fire next run):`, markErr.message);

      guestResults.push({ alertId: alert.id as number, notified });
    }
    if (guestResults.length > 0) {
      await pushAlert(supabaseUrl, anon, "⚠️ SLA Breach — Guest Request", `${guestResults.length} guest request(s) unresolved past ${GUEST_ALERT_SLA_MINUTES} min.`);
    }

    // ════════════════════════════════════════════════════════════════════════
    // 1b. HITL stuck — pending_approval guest_request auto-approve (7 min).
    //     Reception ignored the red dot / Ops Board queue → auto-dispatch to
    //     field ops via notify-manual-task, then page Mike/Eliad/Adir.
    // ════════════════════════════════════════════════════════════════════════
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const pendingCutoffIso = pendingApprovalCutoffIso(PENDING_APPROVAL_AUTO_APPROVE_MINUTES);
    const { data: stuckPending, error: pendingErr } = await supabase
      .from("tasks")
      .select("id, room_number, description, created_at, source, status")
      .eq("status", "pending_approval")
      .eq("source", "guest_request")
      .lt("created_at", pendingCutoffIso)
      .limit(25);
    if (pendingErr) throw new Error(`pending_approval_lookup_error: ${pendingErr.message}`);

    const managementPhones = managementEscalationPhones();
    if ((stuckPending ?? []).length > 0 && managementPhones.length === 0) {
      console.warn("[sla-escalation-cron] ⚠️ no management phones — auto-approve will still dispatch ops card, but nobody gets the personal ping.");
    }

    const pendingAutoResults: Array<{ taskId: string | number; dispatched: boolean; managementPinged: number; reason?: string }> = [];
    for (const task of stuckPending ?? []) {
      const ageMinutes = Math.round((Date.now() - new Date(task.created_at as string).getTime()) / 60000);
      const dispatch = await invokeNotifyManualTask(supabaseUrl, serviceKey, task.id as string | number);
      if (!dispatch.ok && dispatch.reason !== "already_processed") {
        console.error(
          `[sla-escalation-cron] pending auto-approve failed for task ${task.id}: ${dispatch.reason ?? "unknown"}`,
        );
        pendingAutoResults.push({
          taskId: task.id as string | number,
          dispatched: false,
          managementPinged: 0,
          reason: dispatch.reason,
        });
        continue; // retry next minute — status still pending_approval
      }

      const managerText = buildPendingAutoApproveManagerText({
        room: task.room_number as string | null,
        description: task.description as string | null,
        ageMinutes,
        taskId: task.id as string | number,
      });
      const pinged = managementPhones.length > 0
        ? await pingPhonesWhapi(managementPhones, managerText)
        : 0;

      console.info(
        `[sla-escalation-cron] pending task ${task.id} AUTO-APPROVED after ${ageMinutes} min — notified=${dispatch.notified} management_pings=${pinged}`,
      );
      pendingAutoResults.push({
        taskId: task.id as string | number,
        dispatched: dispatch.notified || dispatch.reason === "already_processed",
        managementPinged: pinged,
        reason: dispatch.reason,
      });
    }
    if (pendingAutoResults.some((r) => r.dispatched)) {
      await pushAlert(
        supabaseUrl,
        anon,
        "🚨 Auto-dispatch — Guest room request",
        `${pendingAutoResults.filter((r) => r.dispatched).length} pending_approval task(s) auto-approved after ${PENDING_APPROVAL_AUTO_APPROVE_MINUTES} min.`,
      );
    }

    // ════════════════════════════════════════════════════════════════════════
    // 2. Operations & Maintenance Board — STRICT unassigned-SLA escalation.
    //    "Unassigned" = still status='open' (nobody tapped Accept → in_progress,
    //    or — for source='guest_request' — nobody reacted 👍🏼 yet, Session 26
    //    Sprint 2/3). Window = created_at + SLA_UNASSIGNED_MINUTES (default 7).
    //    Delivery branches by source:
    //      • guest_request  → personal 1:1 Whapi DM to SLA_OPS_ALERT_PHONE, with
    //        a "Bump Task" link (task-action?action=bump) — the luxury-tier
    //        "someone with authority gets paged personally" path (Session 26
    //        Sprint 3.3). Resolution still only happens via the 👍🏼 reaction.
    //      • everything else (whatsapp_staff/manual/inbox_routed/legacy) →
    //        unchanged group alert into the Whapi ops group
    //        (SLA_ALERT_GROUP_ID → WHAPI_GROUP_ID).
    // ════════════════════════════════════════════════════════════════════════
    // Per-task threshold varies by sla_category now (see unassignedThresholdMinutes
    // above), so the cutoff can no longer be expressed as a single SQL .lt() —
    // fetch every still-open, not-yet-escalated task and filter in JS instead.
    // Open+unassigned tasks are a small set at any given moment, so this is cheap.
    const { data: candidateTasks, error: tasksErr } = await supabase
      .from("tasks")
      .select("id, room_number, description, created_at, source, action_token, sla_category, department")
      .eq("status", "open")                 // unassigned only — a claimed (in_progress) task stops escalating
      .is("escalated_at", null);
    if (tasksErr) throw new Error(`tasks_lookup_error: ${tasksErr.message}`);

    const nowMs = Date.now();
    const overdueByAge = (candidateTasks ?? []).filter((t) => {
      const thresholdMin = unassignedThresholdMinutes(t.sla_category as string | null);
      return nowMs - new Date(t.created_at as string).getTime() > thresholdMin * 60 * 1000;
    });

    // Guest Requests channel gate (migration 121, routing_config): a task whose
    // source maps to an intent_type with enable_sla=false (e.g. portal_room_service)
    // is a future guest order, not a physical field task — it must never generate
    // an "SLA BREACH" card, no matter how long it sits unassigned. This is the
    // fix for the "בקשות אורחים" group getting both the request card AND a
    // follow-up breach card for the same Room Service tap.
    const overdueTasks: typeof overdueByAge = [];
    for (const t of overdueByAge) {
      const routing = await resolveRouting(
        supabase,
        taskIntentType(t.source as string | null | undefined),
        { destination_board: "operations", whatsapp_group_id: null, enable_sla: true },
      );
      if (routing.enable_sla) overdueTasks.push(t);
    }

    const alertGroupId  = (Deno.env.get("SLA_ALERT_GROUP_ID") ?? Deno.env.get("WHAPI_GROUP_ID") ?? "").trim();
    // SLA_OPS_ALERT_PHONE — provisioned back in session 21 alongside
    // SLA_GUEST_ALERT_PHONE but never wired into code until now (Session 26
    // Sprint 3.3 finally gives it a job: the personal-manager half of the
    // guest_request escalation path).
    const managerPhone  = opsPersonalAlertPhone();
    const functionsBase = `${supabaseUrl}/functions/v1/task-action`;
    const needsGroupAlert = (overdueTasks ?? []).some(
      (t) => t.source !== "guest_request" || !managerPhone,
    );
    if (needsGroupAlert && !alertGroupId) {
      console.warn("[sla-escalation-cron] ⚠️ no SLA_ALERT_GROUP_ID/WHAPI_GROUP_ID set — ops breaches NOT marked escalated, will retry next run.");
    }
    if ((overdueTasks ?? []).some((t) => t.source === "guest_request") && isOpsPersonalAlertEnabled() && !managerPhone) {
      console.warn("[sla-escalation-cron] ⚠️ SLA_OPS_PERSONAL_ALERT_ENABLED but SLA_OPS_ALERT_PHONE not set — guest-request breaches NOT marked escalated, will retry next run.");
    }

    const opsResults: Array<{ taskId: string; notified: boolean }> = [];
    for (const task of overdueTasks ?? []) {
      const ageMinutes = Math.round((Date.now() - new Date(task.created_at as string).getTime()) / 60000);
      const isGuestRequest = task.source === "guest_request";

      let notified = false;
      if (isGuestRequest && managerPhone) {
        const bumpUrl = `${functionsBase}?id=${task.id}&action=bump&token=${task.action_token}`;
        const managerText =
          `🚨 SLA ALERT: Room ${task.room_number ?? "—"} request (${task.description}) is UNRESOLVED for ${ageMinutes} minutes!\n` +
          `⚡ Bump Task: ${bumpUrl}`;
        try {
          await sendWhapiText(managerPhone, managerText, { noLinkPreview: true });
          notified = true;
        } catch (e) {
          console.error(`[sla-escalation-cron] manager SLA alert failed for guest-request task ${task.id} (will retry next run):`, (e as Error).message);
        }
      } else {
        // Ops-group card translation only — tasks.description in the DB (already
        // written by whapi-webhook/notify-manual-task) stays untouched. A task
        // whose description is already English (Tier-1 AI classification, or a
        // department already covered by notify-manual-task's translation) skips
        // the call entirely via containsHebrew().
        let breachDescription = String(task.description ?? "");
        if (containsHebrew(breachDescription)) {
          breachDescription = await translateTextForFieldOps(breachDescription, {
            room: task.room_number as string | null,
            style: "description_only",
          });
        }
        const englishText =
          `🚨 SLA BREACH: Task for Suite ${task.room_number ?? "—"} is unassigned after ${ageMinutes} minutes!\n` +
          `📋 ${breachDescription}\n` +
          `Please tap "Accept" on the task card to claim it.`;
        const futureSuiteRoomService = isFutureSuiteRoomServiceTask({
          source:      task.source as string | null,
          department:  task.department as string | null,
          description: task.description as string | null,
        });
        // routing_config's whatsapp_group_id (if an admin has configured one via
        // RoutingControlCenter.js) wins over the hardcoded Suites/ops fallback —
        // lets Mike repoint any intent_type at a specific group without a redeploy.
        const taskRouting = await resolveRouting(
          supabase,
          taskIntentType(task.source as string | null | undefined),
          { destination_board: "operations", whatsapp_group_id: null, enable_sla: true },
        );
        const targetGroupId =
          taskRouting.whatsapp_group_id ||
          (futureSuiteRoomService ? SUITES_ROOM_SERVICE_GROUP_ID : alertGroupId);
        if (targetGroupId) {
          try {
            await sendWhapiText(targetGroupId, englishText, { noLinkPreview: true });
            notified = true;
          } catch (e) {
            console.error(`[sla-escalation-cron] Whapi SLA alert failed for task ${task.id} (will retry next run):`, (e as Error).message);
          }
        }
      }

      // Mark escalated ONLY after a successful alert. A transient Whapi failure
      // (or missing group id / manager phone) then retries next minute — cheap
      // at 1-min cadence. This intentionally differs from the guest_alerts
      // branch (mark-regardless): a missed CRITICAL breach is worse than a
      // rare duplicate, and we must never silently mark every open task
      // escalated on a misconfigured channel.
      if (notified) {
        const { error: markErr } = await supabase
          .from("tasks")
          .update({ escalated_at: new Date().toISOString() })
          .eq("id", task.id);
        if (markErr) console.error(`[sla-escalation-cron] failed to mark task ${task.id} escalated:`, markErr.message);
      }

      opsResults.push({ taskId: task.id as string, notified });
    }
    if ((overdueTasks ?? []).length > 0) {
      // Per-task threshold now varies by category (Sprint 5.3b) — the summary
      // can't quote one number for the whole batch, so it names the categories
      // involved instead of a single flat minute count.
      await pushAlert(supabaseUrl, anon, "🚨 SLA Breach — Unassigned Task", `${(overdueTasks ?? []).length} task(s) unassigned past their SLA window.`);
    }

    // ════════════════════════════════════════════════════════════════════════
    // 3. Soft Inbox handoffs — human_requested, non-ops types (20 min).
    //    Spa / late checkout / finance / generic staff_handoff → ping Adir
    //    (SLA_GUEST_ALERT_PHONE) only. Never create a field-ops task.
    // ════════════════════════════════════════════════════════════════════════
    const softCutoffIso = softHandoffCutoffIso(SOFT_HANDOFF_SLA_MINUTES);
    const { data: softCandidates, error: softErr } = await supabase
      .from("whatsapp_conversations")
      .select("id, phone, message, human_request_type, created_at, guest_id, guests(name, room)")
      .eq("human_requested", true)
      .eq("direction", "inbound")
      .is("handoff_escalated_at", null)
      .lt("created_at", softCutoffIso)
      .order("created_at", { ascending: true })
      .limit(40);
    if (softErr) throw new Error(`soft_handoff_lookup_error: ${softErr.message}`);

    const softResults: Array<{ conversationId: string | number; notified: boolean }> = [];
    for (const row of softCandidates ?? []) {
      if (!isSoftHandoffHumanRequestType(row.human_request_type as string | null)) continue;

      const softGuest = (row as { guests?: { name?: string; room?: string } | null }).guests;
      const guestLabel = softGuest
        ? formatAdirGuestLabel(softGuest.name, softGuest.room)
        : String(row.phone);
      const ageMinutes = Math.round((Date.now() - new Date(row.created_at as string).getTime()) / 60000);
      const preview = String(row.message ?? "").replace(/\s+/g, " ").trim().slice(0, 160);
      const softText = buildSoftHandoffManagerText({
        phone: String(row.phone),
        requestType: row.human_request_type as string | null,
        guestLabel,
        ageMinutes,
        preview,
        templates: staffTemplates,
      });

      const notified = guestAlertPhone
        ? await notifyWhatsapp(supabaseUrl, anon, guestAlertPhone, softText)
        : false;

      // Mark regardless (same as guest_alerts) so a missing Adir phone does not
      // re-scan the same soft row forever. Duty manager still sees Inbox red dot.
      const { error: softMarkErr } = await supabase
        .from("whatsapp_conversations")
        .update({ handoff_escalated_at: new Date().toISOString() })
        .eq("id", row.id);
      if (softMarkErr) {
        console.error(
          `[sla-escalation-cron] failed to mark soft handoff ${row.id} escalated (will re-fire next run):`,
          softMarkErr.message,
        );
      }

      softResults.push({ conversationId: row.id as string | number, notified });
    }
    if (softResults.length > 0) {
      await pushAlert(
        supabaseUrl,
        anon,
        "⚠️ Soft handoff unanswered",
        `${softResults.length} Inbox handoff(s) past ${SOFT_HANDOFF_SLA_MINUTES} min (non-ops).`,
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        guestAlerts: { scanned: overdueAlerts?.length ?? 0, results: guestResults },
        pendingAutoApprove: {
          scanned: stuckPending?.length ?? 0,
          results: pendingAutoResults,
        },
        opsTasks: { scanned: overdueTasks?.length ?? 0, results: opsResults },
        softHandoffs: { scanned: softCandidates?.length ?? 0, results: softResults },
      }),
      { headers: { ...CORS, "Content-Type": "application/json" } },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[sla-escalation-cron] error:", msg);
    return new Response(
      JSON.stringify({ ok: false, error: msg }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
    );
  }
});

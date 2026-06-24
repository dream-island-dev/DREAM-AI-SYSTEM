// supabase/functions/sla-escalation-cron/index.ts
// SLA escalation scanner (pg_cron, every 1 min — see migration 074).
//
// Scans TWO boards for overdue items in English (dual-language framework:
// guests Hebrew, staff English):
//   • guest_alerts (Guest Requests Board) — flat 10-min threshold, unchanged —
//     notifies Adir (SLA_GUEST_ALERT_PHONE) via Meta (whatsapp-send inbox_reply).
//   • tasks (Operations & Maintenance Board) — "unassigned" SLA: any task still
//     status='open' (nobody tapped Accept → in_progress) past its threshold →
//     🚨 alert posted straight into the Whapi ops group (SLA_ALERT_GROUP_ID,
//     falls back to WHAPI_GROUP_ID). A claimed task (in_progress) stops
//     escalating. Session 30 Sprint 5.3b — DYNAMIC routing: the unassigned
//     threshold is now read from the task's own sla_category (SLA_THRESHOLDS
//     below — same 10/15/30-min values whapi-webhook/NewTaskForm already use
//     for the completion deadline) when one was set at creation; a task with
//     no category (e.g. a manual task where the admin left "ללא מעקב SLA")
//     falls back to the flat SLA_UNASSIGNED_MINUTES default (7). Previously
//     this was a SINGLE flat 7-min window for every task regardless of
//     category — a pest-control report and a towel request escalated on the
//     same clock, which under-served the categories configured for a tighter
//     window (10 min) and over-alerted on slower ones (30 min).
// Both also broadcast a push-notify alert to the "הנהלה" department so the
// dashboard surfaces it, not just WhatsApp.
//
// Same dedicated kill switch: deploying this does nothing until
// SLA_ESCALATION_ENABLED=true is set explicitly in Supabase Secrets.
//
// Delivery split: guest_alerts → whatsapp-send "inbox_reply" (Meta, the one
// trigger exempt from AUTOMATION_ENABLED — direct staff notification). tasks →
// Whapi straight into the ops group (_shared/whapiSend.ts) — the same channel
// the Sprint-2 task cards use, so breaches land where the team already works.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendWhapiText } from "../_shared/whapiSend.ts";

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

    const guestAlertPhone = Deno.env.get("SLA_GUEST_ALERT_PHONE") ?? "";
    if (!guestAlertPhone) console.warn("[sla-escalation-cron] ⚠️ SLA_GUEST_ALERT_PHONE not set — overdue guest alerts will be marked escalated with nobody notified.");

    // ════════════════════════════════════════════════════════════════════════
    // 1. Guest Requests Board — guest_alerts, flat 10-min threshold
    // ════════════════════════════════════════════════════════════════════════
    const guestThresholdIso = new Date(Date.now() - GUEST_ALERT_SLA_MINUTES * 60 * 1000).toISOString();
    const { data: overdueAlerts, error: alertsErr } = await supabase
      .from("guest_alerts")
      .select("id, phone, message, alert_type, created_at, guest_id, guests(name, room)")
      .eq("resolved", false)
      .is("escalated_at", null)
      .lt("created_at", guestThresholdIso);
    if (alertsErr) throw new Error(`guest_alerts_lookup_error: ${alertsErr.message}`);

    const guestResults: Array<{ alertId: number; notified: boolean }> = [];
    for (const alert of overdueAlerts ?? []) {
      const guestLabel = (alert as Record<string, unknown>).guests
        ? `${(alert as any).guests.name ?? "Guest"} (Room ${(alert as any).guests.room ?? "—"})`
        : alert.phone;
      const ageMinutes = Math.round((Date.now() - new Date(alert.created_at as string).getTime()) / 60000);
      const englishText =
        `⚠️ SLA BREACH — Guest request unresolved for ${ageMinutes} min (limit: ${GUEST_ALERT_SLA_MINUTES} min).\n` +
        `Guest: ${guestLabel}\n` +
        `Type: ${alert.alert_type}\n` +
        `Message: "${alert.message}"\n` +
        `Please check the Requests Board.`;

      const notified = guestAlertPhone ? await notifyWhatsapp(supabaseUrl, anon, guestAlertPhone, englishText) : false;

      const { error: markErr } = await supabase
        .from("guest_alerts")
        .update({ escalated_at: new Date().toISOString() })
        .eq("id", alert.id);
      if (markErr) console.error(`[sla-escalation-cron] failed to mark guest_alerts ${alert.id} escalated (will re-fire next run):`, markErr.message);

      guestResults.push({ alertId: alert.id as number, notified });
    }
    if ((overdueAlerts ?? []).length > 0) {
      await pushAlert(supabaseUrl, anon, "⚠️ SLA Breach — Guest Request", `${(overdueAlerts ?? []).length} guest request(s) unresolved past ${GUEST_ALERT_SLA_MINUTES} min.`);
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
      .select("id, room_number, description, created_at, source, action_token, sla_category")
      .eq("status", "open")                 // unassigned only — a claimed (in_progress) task stops escalating
      .is("escalated_at", null);
    if (tasksErr) throw new Error(`tasks_lookup_error: ${tasksErr.message}`);

    const nowMs = Date.now();
    const overdueTasks = (candidateTasks ?? []).filter((t) => {
      const thresholdMin = unassignedThresholdMinutes(t.sla_category as string | null);
      return nowMs - new Date(t.created_at as string).getTime() > thresholdMin * 60 * 1000;
    });

    const alertGroupId  = (Deno.env.get("SLA_ALERT_GROUP_ID") ?? Deno.env.get("WHAPI_GROUP_ID") ?? "").trim();
    // SLA_OPS_ALERT_PHONE — provisioned back in session 21 alongside
    // SLA_GUEST_ALERT_PHONE but never wired into code until now (Session 26
    // Sprint 3.3 finally gives it a job: the personal-manager half of the
    // guest_request escalation path).
    const managerPhone  = (Deno.env.get("SLA_OPS_ALERT_PHONE") ?? "").trim();
    const functionsBase = `${supabaseUrl}/functions/v1/task-action`;
    if ((overdueTasks ?? []).some((t) => t.source !== "guest_request") && !alertGroupId) {
      console.warn("[sla-escalation-cron] ⚠️ no SLA_ALERT_GROUP_ID/WHAPI_GROUP_ID set — ops breaches NOT marked escalated, will retry next run.");
    }
    if ((overdueTasks ?? []).some((t) => t.source === "guest_request") && !managerPhone) {
      console.warn("[sla-escalation-cron] ⚠️ SLA_OPS_ALERT_PHONE not set — guest-request breaches NOT marked escalated, will retry next run.");
    }

    const opsResults: Array<{ taskId: string; notified: boolean }> = [];
    for (const task of overdueTasks ?? []) {
      const ageMinutes = Math.round((Date.now() - new Date(task.created_at as string).getTime()) / 60000);
      const isGuestRequest = task.source === "guest_request";

      let notified = false;
      if (isGuestRequest) {
        if (managerPhone) {
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
        }
      } else {
        const englishText =
          `🚨 SLA BREACH: Task for Suite ${task.room_number ?? "—"} is unassigned after ${ageMinutes} minutes!\n` +
          `📋 ${task.description}\n` +
          `Please tap "Accept" on the task card to claim it.`;
        if (alertGroupId) {
          try {
            await sendWhapiText(alertGroupId, englishText, { noLinkPreview: true });
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

    return new Response(
      JSON.stringify({
        ok: true,
        guestAlerts: { scanned: overdueAlerts?.length ?? 0, results: guestResults },
        opsTasks:    { scanned: overdueTasks?.length ?? 0, results: opsResults },
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

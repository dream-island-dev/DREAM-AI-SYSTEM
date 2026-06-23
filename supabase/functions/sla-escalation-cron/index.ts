// supabase/functions/sla-escalation-cron/index.ts
// SLA escalation scanner (pg_cron, every 5 min — see migration 066).
//
// Scans TWO boards for overdue items and notifies one named person per
// board in English (dual-language framework: guests Hebrew, staff English):
//   • guest_alerts (Guest Requests Board) — flat 10-min threshold, unchanged
//     from the original design — notifies Adir (SLA_GUEST_ALERT_PHONE).
//   • tasks (Operations & Maintenance Board) — per-category threshold via
//     sla_deadline (10/15/30 min, set at creation time by staff-ops-webhook
//     or NewTaskForm) — notifies Lidor (SLA_OPS_ALERT_PHONE).
// Both also broadcast a push-notify alert to the "הנהלה" department so the
// dashboard surfaces it, not just WhatsApp.
//
// Same dedicated kill switch as before: deploying this function does nothing
// until SLA_ESCALATION_ENABLED=true is set explicitly in Supabase Secrets.
//
// Reuses whatsapp-send's existing "inbox_reply" trigger to actually deliver
// the WhatsApp message — inbox_reply is the one trigger exempt from the
// AUTOMATION_ENABLED gate (direct staff notification, not guest automation),
// already deployed/proven safe. No new Meta API code needed here.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GUEST_ALERT_SLA_MINUTES = 10;
const PUSH_DEPARTMENT = "הנהלה";

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
    const opsAlertPhone   = Deno.env.get("SLA_OPS_ALERT_PHONE") ?? "";
    if (!guestAlertPhone) console.warn("[sla-escalation-cron] ⚠️ SLA_GUEST_ALERT_PHONE not set — overdue guest alerts will be marked escalated with nobody notified.");
    if (!opsAlertPhone)   console.warn("[sla-escalation-cron] ⚠️ SLA_OPS_ALERT_PHONE not set — overdue ops tasks will be marked escalated with nobody notified.");

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
    // 2. Operations & Maintenance Board — tasks, per-category sla_deadline
    // ════════════════════════════════════════════════════════════════════════
    const nowIso = new Date().toISOString();
    const { data: overdueTasks, error: tasksErr } = await supabase
      .from("tasks")
      .select("id, room_number, department, description, sla_category, sla_deadline, created_at")
      .neq("status", "done")
      .is("escalated_at", null)
      .not("sla_deadline", "is", null)
      .lt("sla_deadline", nowIso);
    if (tasksErr) throw new Error(`tasks_lookup_error: ${tasksErr.message}`);

    const opsResults: Array<{ taskId: string; notified: boolean }> = [];
    for (const task of overdueTasks ?? []) {
      const ageMinutes = Math.round((Date.now() - new Date(task.created_at as string).getTime()) / 60000);
      const englishText =
        `⚠️ SLA BREACH — Operations task unresolved for ${ageMinutes} min (category: ${task.sla_category ?? "uncategorized"}).\n` +
        `Room: ${task.room_number ?? "—"}\n` +
        `Description: "${task.description}"\n` +
        `Please check the Operations Board.`;

      const notified = opsAlertPhone ? await notifyWhatsapp(supabaseUrl, anon, opsAlertPhone, englishText) : false;

      const { error: markErr } = await supabase
        .from("tasks")
        .update({ escalated_at: new Date().toISOString() })
        .eq("id", task.id);
      if (markErr) console.error(`[sla-escalation-cron] failed to mark task ${task.id} escalated (will re-fire next run):`, markErr.message);

      opsResults.push({ taskId: task.id as string, notified });
    }
    if ((overdueTasks ?? []).length > 0) {
      await pushAlert(supabaseUrl, anon, "⚠️ SLA Breach — Operations Task", `${(overdueTasks ?? []).length} operations task(s) past their SLA deadline.`);
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

// supabase/functions/sla-escalation-cron/index.ts
// Tier 2 SLA escalation scanner (pg_cron, every 5 min — see migration 066).
//
// Scans guest_alerts for requests that have sat unresolved past the 10-minute
// SLA threshold and notifies Tier 2 staff directly via WhatsApp, once per
// alert (guarded by guest_alerts.escalated_at — see migration 066 for why).
//
// Dedicated kill switch, same convention as CRON_ENABLED/AUTOMATION_ENABLED
// elsewhere in this codebase: deploying this function does nothing until
// SLA_ESCALATION_ENABLED=true is set explicitly in Supabase Secrets.
//
// Staff numbers come from WHATSAPP_STAFF_TIER_2_NUMBERS (comma-separated
// E.164 numbers, e.g. "972501234567,972529876543") — not configured anywhere
// in this codebase yet. If unset/empty, the scan still runs (and still marks
// alerts as escalated, so they don't pile up once numbers ARE configured—
// actually: see note below) but logs a visible warning instead of silently
// doing nothing (FAIL VISIBLE, CLAUDE.md §0.3).
//
// Reuses whatsapp-send's existing "inbox_reply" trigger to actually deliver
// the message — inbox_reply is the one trigger exempt from the
// AUTOMATION_ENABLED gate (it's a direct staff notification, not part of the
// guest-facing automation pipeline), and it's already deployed/proven safe.
// No new Meta API code needed here.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SLA_MINUTES = 10;

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // ── EMERGENCY KILL SWITCH ───────────────────────────────────────────────────
  // Off by default — deploying this function sends nothing until this secret
  // is explicitly set, same convention as CRON_ENABLED/AUTOMATION_ENABLED.
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

    const staffNumbersRaw = Deno.env.get("WHATSAPP_STAFF_TIER_2_NUMBERS") ?? "";
    const staffNumbers = staffNumbersRaw.split(",").map((s) => s.trim()).filter(Boolean);
    if (staffNumbers.length === 0) {
      console.warn("[sla-escalation-cron] ⚠️ WHATSAPP_STAFF_TIER_2_NUMBERS is not set — overdue alerts will be marked escalated with zero staff notified. Set this secret before relying on this feature.");
    }

    const thresholdIso = new Date(Date.now() - SLA_MINUTES * 60 * 1000).toISOString();

    const { data: overdueAlerts, error: fetchErr } = await supabase
      .from("guest_alerts")
      .select("id, phone, message, alert_type, created_at, guest_id, guests(name, room)")
      .eq("resolved", false)
      .is("escalated_at", null)
      .lt("created_at", thresholdIso);
    if (fetchErr) throw new Error(`guest_alerts_lookup_error: ${fetchErr.message}`);

    const results: Array<{ alertId: number; notified: number; failed: number }> = [];

    for (const alert of overdueAlerts ?? []) {
      const guestLabel = (alert as Record<string, unknown>).guests
        ? `${(alert as any).guests.name ?? "אורח"} (${(alert as any).guests.room ?? "ללא חדר"})`
        : alert.phone;
      const ageMinutes = Math.round((Date.now() - new Date(alert.created_at as string).getTime()) / 60000);
      const escalationText =
        `🚨 בקשת אורח לא טופלה מעל ${SLA_MINUTES} דקות (${ageMinutes} דק׳)\n` +
        `אורח: ${guestLabel}\n` +
        `סוג: ${alert.alert_type}\n` +
        `הודעה: ${alert.message}\n` +
        `נדרש טיפול דחוף — לוח בקשות ←`;

      let notified = 0;
      let failed = 0;
      for (const staffPhone of staffNumbers) {
        try {
          const res = await fetch(`${supabaseUrl}/functions/v1/whatsapp-send`, {
            method: "POST",
            headers: { "Content-Type": "application/json", apikey: anon, Authorization: `Bearer ${anon}` },
            body: JSON.stringify({ trigger: "inbox_reply", phone: staffPhone, message: escalationText }),
          });
          const json = await res.json().catch(() => ({}));
          if (res.ok && json?.ok !== false) notified++; else failed++;
        } catch (e) {
          failed++;
          console.error(`[sla-escalation-cron] failed to notify ${staffPhone} for alert ${alert.id}:`, (e as Error).message);
        }
      }

      // Mark escalated regardless of per-number outcome — the SLA gate is
      // "did we ATTEMPT to escalate", same as how a pipeline trigger's
      // GUEST_FLAG is the sole-writer idempotency marker elsewhere in this
      // codebase. A staff number being unreachable shouldn't cause this
      // alert to re-fire forever; check notified/failed counts in the
      // response (and console logs) to catch a misconfigured number.
      const { error: markErr } = await supabase
        .from("guest_alerts")
        .update({ escalated_at: new Date().toISOString() })
        .eq("id", alert.id);
      if (markErr) console.error(`[sla-escalation-cron] failed to mark alert ${alert.id} escalated (will re-fire next run):`, markErr.message);

      results.push({ alertId: alert.id as number, notified, failed });
    }

    return new Response(
      JSON.stringify({ ok: true, scanned: overdueAlerts?.length ?? 0, staffNumbersConfigured: staffNumbers.length, results }),
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

// supabase/functions/whatsapp-cron/index.ts
// Scheduled scanner (invoked by pg_cron ~every 15 min). Decides which
// time-based WhatsApp triggers are due and delegates each to whatsapp-send
// (which templates, sends/simulates, and dedupes via notification_log).
//
// Phase 4 (Automation Control Center): timing now comes from the
// automation_stages table (migration 065) via the shared resolver in
// _shared/automationSchedule.ts, instead of a hardcoded day-offset/UTC-hour
// if/else. Eligibility guards (cancelled/needs_callback/flag-already-sent/
// room_type/status) are preserved exactly — only the NUMBERS (which day,
// which hour) moved from source code to an admin-editable table. Stages
// with schedule_mode='event_immediate' (stage_2_arrival) are intentionally
// excluded from this scan — they fire synchronously from whatsapp-webhook,
// not from cron polling.
//
// room_ready is NOT in automation_stages (event-driven from the RoomBoard/
// AICopilot UI toggle) — it has no row here and is not part of this scan.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  resolveStageSchedule,
  type AutomationStage,
  type GuestForSchedule,
} from "../_shared/automationSchedule.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
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
    const { data: guests = [] } = await supabase
      .from("guests")
      .select("id, name, phone, arrival_date, departure_date, room_type, status, checkin_time, needs_callback, msg_pre_arrival_2d_sent, msg_pre_arrival_sent, msg_morning_suite_sent, msg_morning_welcome_sent, msg_post_checkin_sent, msg_mid_stay_sent, msg_checkout_fb_sent");

    const due: { guestId: number; trigger: string }[] = [];
    for (const guest of (guests ?? []) as GuestForSchedule[]) {
      for (const stage of stages) {
        const result = resolveStageSchedule(stage, guest, now);
        if (result.dueNow) due.push({ guestId: guest.id as number, trigger: stage.stage_key });
      }
    }

    // Delegate each to whatsapp-send (idempotent there).
    const results: any[] = [];
    for (const d of due) {
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

    return new Response(JSON.stringify({ ok: true, scanned: guests?.length ?? 0, fired: results.length, results }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 400, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});

// supabase/functions/whatsapp-cron/index.ts
// Scheduled scanner (invoked by pg_cron ~every 15 min). Decides which
// time-based WhatsApp triggers are due and delegates each to whatsapp-send
// (which templates, sends/simulates, and dedupes via notification_log).
//
//   pre_arrival_2d  — ALL guests, T-2 days before arrival (any hour)
//   night_before    — ALL guests, day before arrival (any hour)
//   morning_welcome — non-suite guests, morning of arrival (Israel 08:00+)
//   morning_suite   — suite guests, morning of arrival (Israel 06:00+)
//   mid_stay        — checked-in guests, day after arrival (Israel 10:00+)
//   checkout_fb     — all guests, day after departure (Israel 09:00+)
//   butler_1h       — suite guests, 1h+ after check-in
// (room_ready is event-driven from the UI toggle, not here.)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ymd = (d: Date) => d.toISOString().slice(0, 10);

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
    const today      = ymd(now);
    const tomorrow   = ymd(new Date(now.getTime() +     24 * 3600 * 1000));
    const twoDaysOut = ymd(new Date(now.getTime() + 2 * 24 * 3600 * 1000));
    const hourUTC = now.getUTCHours(); // ~Israel = UTC+2/3

    const { data: guests = [] } = await supabase
      .from("guests")
      .select("id, name, phone, arrival_date, departure_date, room_type, status, checkin_time, msg_pre_arrival_2d_sent, msg_pre_arrival_sent, msg_morning_suite_sent, msg_morning_welcome_sent, msg_post_checkin_sent, msg_mid_stay_sent, msg_checkout_fb_sent");

    // yesterday = day after departure that triggers checkout feedback
    const yesterday = ymd(new Date(now.getTime() - 24 * 3600 * 1000));

    const due: { guestId: number; trigger: string }[] = [];
    for (const g of guests ?? []) {
      // T-2 — pre-arrival confirmation request (all guests, any hour)
      if (g.arrival_date === twoDaysOut && !g.msg_pre_arrival_2d_sent)
        due.push({ guestId: g.id, trigger: "pre_arrival_2d" });

      // T-1 night — check-in reminder (all guests), only between UTC 17-21 = Israel 19-23
      if (g.arrival_date === tomorrow && hourUTC >= 17 && hourUTC <= 21 && !g.msg_pre_arrival_sent)
        due.push({ guestId: g.id, trigger: "night_before" });

      // Arrival morning — welcome message for non-suite guests (UTC 06+ ≈ Israel 08+)
      if (g.arrival_date === today && g.room_type !== "suite" && hourUTC >= 6 && !g.msg_morning_welcome_sent)
        due.push({ guestId: g.id, trigger: "morning_welcome" });

      // Mid-stay check — day after arrival, while still on property (UTC 08+ ≈ Israel 10+)
      // Only fires once (flag guard) and only for checked-in guests.
      if (
        g.arrival_date === yesterday &&
        g.departure_date && g.departure_date >= today &&
        g.status === "checked_in" &&
        !g.msg_mid_stay_sent &&
        hourUTC >= 8
      ) due.push({ guestId: g.id, trigger: "mid_stay" });

      // Checkout feedback — day after departure (UTC 07+ ≈ Israel 09+)
      if (g.departure_date === yesterday && !g.msg_checkout_fb_sent && hourUTC >= 7)
        due.push({ guestId: g.id, trigger: "checkout_fb" });

      if (g.room_type === "suite") {
        // Arrival morning for suites (UTC 04+ ≈ Israel 06+)
        if (g.arrival_date === today && hourUTC >= 4 && !g.msg_morning_suite_sent)
          due.push({ guestId: g.id, trigger: "morning_suite" });

        // 1h after check-in (suites) — flag guard prevents re-firing every 15 min
        if (g.status === "checked_in" && g.checkin_time && !g.msg_post_checkin_sent) {
          const mins = (now.getTime() - new Date(g.checkin_time).getTime()) / 60000;
          if (mins >= 60) due.push({ guestId: g.id, trigger: "butler_1h" });
        }
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

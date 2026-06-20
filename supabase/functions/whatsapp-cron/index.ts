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
      .select("id, name, phone, arrival_date, departure_date, room_type, status, checkin_time, needs_callback, msg_pre_arrival_2d_sent, msg_pre_arrival_sent, msg_morning_suite_sent, msg_morning_welcome_sent, msg_post_checkin_sent, msg_mid_stay_sent, msg_checkout_fb_sent");

    // yesterday = day after departure that triggers checkout feedback
    const yesterday = ymd(new Date(now.getTime() - 24 * 3600 * 1000));

    const due: { guestId: number; trigger: string }[] = [];
    for (const g of guests ?? []) {
      // Skip cancelled guests entirely — they should never receive automated messages
      if (g.status === 'cancelled') continue;

      // T-2 — pre-arrival confirmation request (all guests, any hour)
      // needs_callback guard: don't send if guest flagged for human follow-up
      if (g.arrival_date === twoDaysOut && !g.msg_pre_arrival_2d_sent && !g.needs_callback)
        due.push({ guestId: g.id, trigger: "pre_arrival_2d" });

      // T-1 night — check-in reminder (all guests), only between UTC 17-21 = Israel 19-23
      // needs_callback guard: don't send if guest flagged for human follow-up
      if (g.arrival_date === tomorrow && hourUTC >= 17 && hourUTC <= 21 && !g.msg_pre_arrival_sent && !g.needs_callback)
        due.push({ guestId: g.id, trigger: "night_before" });

      // Arrival morning — welcome message for non-suite guests (UTC 06+ ≈ Israel 08+)
      // needs_callback guard: a guest who tapped "לא,שינוי בתאריך" (or otherwise
      // got flagged for human follow-up) must NOT get a "welcome, we're waiting
      // for you!" message — their arrival date itself may no longer be today.
      if (g.arrival_date === today && g.room_type !== "suite" && hourUTC >= 6 && !g.msg_morning_welcome_sent && !g.needs_callback)
        due.push({ guestId: g.id, trigger: "morning_welcome" });

      // Mid-stay check — day after arrival, while still on property (UTC 08+ ≈ Israel 10+)
      // Only fires once (flag guard) and only for checked-in guests.
      // needs_callback guard: don't send if guest has open callback request
      if (
        g.arrival_date === yesterday &&
        g.departure_date && g.departure_date >= today &&
        g.status === "checked_in" &&
        !g.msg_mid_stay_sent &&
        !g.needs_callback &&
        hourUTC >= 8
      ) due.push({ guestId: g.id, trigger: "mid_stay" });

      // Checkout feedback — day after departure (UTC 07+ ≈ Israel 09+)
      // needs_callback guard: don't auto-request feedback if they left with unresolved issues
      if (g.departure_date === yesterday && !g.msg_checkout_fb_sent && !g.needs_callback && hourUTC >= 7)
        due.push({ guestId: g.id, trigger: "checkout_fb" });

      if (g.room_type === "suite") {
        // Arrival morning for suites (UTC 04+ ≈ Israel 06+) — same needs_callback
        // guard as morning_welcome above; both send dream_welcome_morning.
        if (g.arrival_date === today && hourUTC >= 4 && !g.msg_morning_suite_sent && !g.needs_callback)
          due.push({ guestId: g.id, trigger: "morning_suite" });

        // 1h after check-in (suites) — flag guard prevents re-firing every 15 min
        // needs_callback guard: don't send automated butler intro if guest needs human attention
        if (g.status === "checked_in" && g.checkin_time && !g.msg_post_checkin_sent && !g.needs_callback) {
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

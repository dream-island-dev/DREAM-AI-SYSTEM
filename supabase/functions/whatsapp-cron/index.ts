// supabase/functions/whatsapp-cron/index.ts
// Scheduled scanner (invoked by pg_cron ~every 15 min). Decides which
// time-based WhatsApp triggers are due and delegates each to whatsapp-send
// (which templates, sends/simulates, and dedupes via notification_log).
//
//   night_before  — ALL guests, the day before arrival
//   morning_suite — SUITES, morning of arrival
//   butler_1h     — SUITES, 1h+ after check-in
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
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const now = new Date();
    const today = ymd(now);
    const tomorrow = ymd(new Date(now.getTime() + 24 * 3600 * 1000));
    const hourUTC = now.getUTCHours(); // ~Israel = UTC+2/3

    const { data: guests = [] } = await supabase.from("guests").select("*");

    const due: { guestId: number; trigger: string }[] = [];
    for (const g of guests ?? []) {
      // T1 — night before (all guests)
      if (g.arrival_date === tomorrow) due.push({ guestId: g.id, trigger: "night_before" });

      if (g.room_type === "suite") {
        // T2 — morning of arrival (suites), only during morning window (>=04 UTC ≈ 07 IL)
        if (g.arrival_date === today && hourUTC >= 4) due.push({ guestId: g.id, trigger: "morning_suite" });

        // T4 — 1h after check-in (suites)
        if (g.status === "checked_in" && g.checkin_time) {
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

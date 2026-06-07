// supabase/functions/whatsapp-send/index.ts
// Central WhatsApp dispatcher. Builds Hebrew message from a template, then
// either SENDS via Meta WhatsApp Cloud API or SIMULATES (logs only), based on
// env. Every guest trigger is idempotent via notification_log.
//
// Env:
//   WHATSAPP_SIMULATION = "true"  → never calls Meta, logs status='simulated'
//   WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID → required for real sending
//
// Body: { trigger, guestId?, assignments?, weekStart? }
//   trigger ∈ night_before | morning_suite | room_ready | butler_1h | shift_assignment

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Hebrew message templates ──────────────────────────────────────────────────
const T = {
  night_before: (g: any) =>
    `שלום ${g.name}! 🌙 כאן Dream Island. אנו מצפים לבואך מחר — הצ'ק-אין מהשעה 15:00. ` +
    `נשמח לדעת שעת הגעה משוערת כדי להכין הכל עבורך. נסיעה טובה! 🏝️`,
  morning_suite: (g: any) =>
    `בוקר טוב ${g.name}! ☀️ צוות Dream Island שמח לארח אותך היום בסוויטה. ` +
    `מוזמן/ת ליהנות ממתקני הנופש ומטרקלין הסימפוניה ה-VIP שלנו. נתראה בקרוב! 👑`,
  room_ready: (g: any) =>
    `${g.name}, חדרך מוכן! 🛎️ הסוויטה שלך${g.room ? ` (${g.room})` : ""} ממתינה לך. ` +
    `גש/י לקבלה לקבלת המפתח ותחילת חופשה מושלמת ב-Dream Island. 👑`,
  butler_1h: (g: any) =>
    `${g.name}, ברוך/ה הבא/ה לסוויטה! 🥂 הבטלר האישי שלך לרשותך. נשמח להציע: ` +
    `שירות חדרים 24/7, הזמנת מסעדה וטיפולי ספא מפנקים. השב/י להודעה זו או חייג/י 9 מהחדר. שהייה נעימה! 🌸`,
};

function shiftMsg(name: string, weekStart: string, shifts: any[]) {
  const lines = shifts
    .map((s) => `• ${s.date} ${s.start}-${s.end}${s.department ? ` (${s.department})` : ""}`)
    .join("\n");
  return `שלום ${name}! 📅 סודר עבורך סידור משמרות חדש לשבוע ${weekStart}:\n${lines}\n` +
    `לשינויים פנה/י למנהל המשמרת. תודה! — Dream Island`;
}

// ── Meta WhatsApp Cloud API (live) ────────────────────────────────────────────
async function sendViaMeta(to: string, body: string) {
  const token = Deno.env.get("WHATSAPP_TOKEN");
  const phoneId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  if (!token || !phoneId) throw new Error("missing_whatsapp_creds");
  const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    // NOTE: business-initiated messages require an APPROVED TEMPLATE in production.
    // This free-text body works inside the 24h window / for testing. Swap to a
    // { type:"template", template:{...} } payload once templates are approved.
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body } }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`meta_http_${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

const isSimulation = () =>
  Deno.env.get("WHATSAPP_SIMULATION") === "true" ||
  !Deno.env.get("WHATSAPP_TOKEN") ||
  !Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const { trigger, guestId, assignments, weekStart } = await req.json();
    if (!trigger) throw new Error("trigger is required");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const sim = isSimulation();
    const results: any[] = [];

    // ── Staff shift assignments (no guest) ──────────────────────────────────
    if (trigger === "shift_assignment") {
      const map = assignments ?? {};
      for (const [name, shifts] of Object.entries<any>(map)) {
        const body = shiftMsg(name, weekStart ?? "", shifts as any[]);
        let status = "simulated";
        try {
          if (!sim) { await sendViaMeta((shifts as any[])[0]?.phone ?? "", body); status = "sent"; }
        } catch { status = "failed"; }
        await supabase.from("notification_log").insert({
          guest_id: null, recipient: name, trigger_type: "shift_assignment",
          channel: "whatsapp", status, payload: { body },
        });
        results.push({ name, status });
      }
      return new Response(JSON.stringify({ ok: true, simulation: sim, results }), {
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    // ── Guest triggers ───────────────────────────────────────────────────────
    if (!guestId) throw new Error("guestId is required for guest triggers");
    if (!(trigger in T)) throw new Error("unknown trigger: " + trigger);

    // Idempotency: skip if already sent for this guest+trigger.
    const { data: existing } = await supabase
      .from("notification_log").select("id")
      .eq("guest_id", guestId).eq("trigger_type", trigger).maybeSingle();
    if (existing) {
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: "already_sent" }), {
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const { data: guest, error: gErr } = await supabase
      .from("guests").select("*").eq("id", guestId).single();
    if (gErr || !guest) throw new Error("guest_not_found");

    const body = (T as any)[trigger](guest);
    let status = "simulated";
    try {
      if (!sim) { await sendViaMeta(guest.phone, body); status = "sent"; }
    } catch (e) {
      console.error("[whatsapp] send failed:", (e as Error).message);
      status = "failed";
    }

    await supabase.from("notification_log").insert({
      guest_id: guestId, recipient: guest.phone, trigger_type: trigger,
      channel: "whatsapp", status, payload: { body },
    });

    return new Response(JSON.stringify({ ok: true, simulation: sim, status, body }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 400, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});

// supabase/functions/whatsapp-send/index.ts  v5
// Central WhatsApp dispatcher for Dream Island.
//
// Supported triggers:
//   night_before     — pre-arrival greeting (idempotent)
//   morning_suite    — day-of VIP welcome (idempotent)
//   room_ready       — room is ready, proceed to reception (idempotent)
//   butler_1h        — post check-in butler touch (idempotent)
//   shift_assignment — staff schedule notification (not idempotent)
//   broadcast        — manager-composed free-form message (not idempotent)
//                      supports {{guest_name}}, {{room}}, {{room_type}} placeholders
//
// Env (Supabase secrets):
//   META_WHATSAPP_TOKEN       — Meta Cloud API bearer token (replaces WHATSAPP_TOKEN)
//   META_PHONE_NUMBER_ID      — From-number ID in Meta Business Suite (replaces WHATSAPP_PHONE_NUMBER_ID)
//   META_BUSINESS_ACCOUNT_ID  — Business Account ID (reserved; used for analytics/insights API)
//   WHATSAPP_SIMULATION=true  — When set, skips real sends; logs status='simulated'
//
// Backward-compat: WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID are still read as fallback.
//
// API: Meta WhatsApp Cloud API v20.0
//   POST https://graph.facebook.com/v20.0/{META_PHONE_NUMBER_ID}/messages
//   NOTE: Business-initiated messages require an APPROVED TEMPLATE in production.
//         Free-text body works within the 24h customer-service window / sandbox testing.
//         Swap to { type:"template", template:{...} } when Meta approves your templates.
//
// Pipeline flag ownership (single source of truth — Edge Function only):
//   night_before  → guests.msg_pre_arrival_sent  = true
//   room_ready    → guests.msg_room_ready_sent   = true
//   butler_1h     → guests.msg_post_checkin_sent = true
//   broadcast     → no pipeline flag (ad-hoc sends)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Hebrew message templates (EZGO pipeline triggers) ──────────────────────────
const T: Record<string, (g: Record<string, unknown>) => string> = {
  night_before: (g) =>
    `שלום ${g.name}! 🌙 כאן Dream Island. אנו מצפים לבואך מחר — הצ'ק-אין מהשעה 15:00. ` +
    `נשמח לדעת שעת הגעה משוערת כדי להכין הכל עבורך. נסיעה טובה! 🏝️`,
  morning_suite: (g) =>
    `בוקר טוב ${g.name}! ☀️ צוות Dream Island שמח לארח אותך היום בסוויטה. ` +
    `מוזמן/ת ליהנות ממתקני הנופש ומטרקלין הסימפוניה ה-VIP שלנו. נתראה בקרוב! 👑`,
  room_ready: (g) =>
    `היי ${g.name}, הסוויטה שלכם בדרים איילנד מוכנה!` +
    `${g.room ? ` (חדר ${g.room})` : ""} מחכים לכם בקבלה. 🏨`,
  butler_1h: (g) =>
    `${g.name}, ברוך/ה הבא/ה לסוויטה! 🥂 הבטלר האישי שלך לרשותך. נשמח להציע: ` +
    `שירות חדרים 24/7, הזמנת מסעדה וטיפולי ספא מפנקים. השב/י להודעה זו או חייג/י 9 מהחדר. שהייה נעימה! 🌸`,
};

// Maps each EZGO pipeline trigger to the DB flag it atomically stamps.
// morning_suite has no dedicated pipeline column (supplementary VIP touch).
const GUEST_FLAG: Record<string, string> = {
  night_before: "msg_pre_arrival_sent",
  room_ready:   "msg_room_ready_sent",
  butler_1h:    "msg_post_checkin_sent",
};

// ── Placeholder interpolation ─────────────────────────────────────────────────
// Replaces {{guest_name}}, {{room}}, {{room_type}} etc. in broadcast templates.
// Unknown keys are left as-is so managers can see un-resolved placeholders.
function interpolate(template: string, vars: Record<string, unknown>): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_, key: string) => {
    const val = vars[key.trim()];
    return val !== null && val !== undefined ? String(val) : `{{${key}}}`;
  });
}

// ── Staff shift assignment message ────────────────────────────────────────────
function shiftMsg(name: string, weekStart: string, shifts: Array<Record<string, unknown>>): string {
  const lines = shifts
    .map((s) => `• ${s.date} ${s.start}-${s.end}${s.department ? ` (${s.department})` : ""}`)
    .join("\n");
  return `שלום ${name}! 📅 סודר עבורך סידור משמרות חדש לשבוע ${weekStart}:\n${lines}\n` +
    `לשינויים פנה/י למנהל המשמרת. תודה! — Dream Island`;
}

// ── Meta WhatsApp Cloud API (live) ────────────────────────────────────────────
// POST https://graph.facebook.com/v20.0/{META_PHONE_NUMBER_ID}/messages
// Requires META_WHATSAPP_TOKEN + META_PHONE_NUMBER_ID (or legacy WHATSAPP_* names).
async function sendViaMeta(to: string, body: string): Promise<void> {
  // New env var names first, legacy as fallback (backward-compatible transition)
  const token   = Deno.env.get("META_WHATSAPP_TOKEN")    ?? Deno.env.get("WHATSAPP_TOKEN");
  const phoneId = Deno.env.get("META_PHONE_NUMBER_ID")   ?? Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  if (!token || !phoneId) throw new Error("missing_meta_whatsapp_creds");

  const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body, preview_url: false },
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    throw new Error(`meta_http_${res.status}: ${detail}`);
  }
}

// Simulation: true when explicitly set OR when Meta credentials are absent.
const isSimulation = (): boolean =>
  Deno.env.get("WHATSAPP_SIMULATION") === "true" ||
  !(Deno.env.get("META_WHATSAPP_TOKEN")   ?? Deno.env.get("WHATSAPP_TOKEN")) ||
  !(Deno.env.get("META_PHONE_NUMBER_ID")  ?? Deno.env.get("WHATSAPP_PHONE_NUMBER_ID"));

// ── Main handler ──────────────────────────────────────────────────────────────
serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body = await req.json();
    const { trigger, guestId, assignments, weekStart, messageTemplate } = body as {
      trigger:         string;
      guestId?:        string;
      assignments?:    Record<string, unknown[]>;
      weekStart?:      string;
      messageTemplate?: string;   // broadcast only — may contain {{placeholders}}
    };

    if (!trigger) throw new Error("trigger is required");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const sim = isSimulation();

    // ─────────────────────────────────────────────────────────────────────────
    // BRANCH A: Staff shift assignment (no guest record)
    // ─────────────────────────────────────────────────────────────────────────
    if (trigger === "shift_assignment") {
      const map = assignments ?? {};
      const results: Array<{ name: string; status: string }> = [];
      for (const [name, shifts] of Object.entries(map)) {
        const msg = shiftMsg(name, weekStart ?? "", shifts as Array<Record<string, unknown>>);
        let status = "simulated";
        try {
          if (!sim) { await sendViaMeta((shifts as Array<Record<string, unknown>>)[0]?.phone as string ?? "", msg); status = "sent"; }
        } catch { status = "failed"; }
        await supabase.from("notification_log").insert({
          guest_id: null, recipient: name, trigger_type: "shift_assignment",
          channel: "whatsapp", status, payload: { body: msg },
        });
        results.push({ name, status });
      }
      return new Response(
        JSON.stringify({ ok: true, simulation: sim, results }),
        { headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // BRANCH B: Broadcast — manager-composed free-form message
    //   • No idempotency: managers may send multiple campaigns to the same guest
    //   • messageTemplate is interpolated server-side against the guest's data
    //   • 200ms throttle between iterations is handled on the frontend
    //   • No GUEST_FLAG update: broadcasts do not advance the EZGO pipeline
    // ─────────────────────────────────────────────────────────────────────────
    if (trigger === "broadcast") {
      if (!guestId) throw new Error("guestId required for broadcast trigger");
      if (!messageTemplate || !messageTemplate.trim()) throw new Error("messageTemplate is required for broadcast");

      const { data: guest, error: gErr } = await supabase
        .from("guests").select("*").eq("id", guestId).single();
      if (gErr || !guest) throw new Error("guest_not_found");
      if (!guest.phone) throw new Error("guest_no_phone");

      // Resolve {{guest_name}}, {{room}}, {{room_type}}, {{phone}}, {{arrival_date}}
      const rendered = interpolate(messageTemplate, {
        guest_name:   guest.name,
        room:         guest.room         ?? "",
        room_type:    guest.room_type    ?? "",
        phone:        guest.phone        ?? "",
        arrival_date: guest.arrival_date ?? "",
      });

      let status = "simulated";
      let sendError: string | null = null;
      try {
        if (!sim) { await sendViaMeta(guest.phone as string, rendered); status = "sent"; }
      } catch (e) {
        sendError = (e as Error).message;
        console.error("[whatsapp] broadcast send failed:", sendError);
        status = "failed";
      }

      await supabase.from("notification_log").insert({
        guest_id: guestId,
        recipient: guest.phone,
        trigger_type: "broadcast",
        channel: "whatsapp",
        status,
        payload: { body: rendered, template: messageTemplate, ...(sendError ? { error: sendError } : {}) },
      });

      // ok:false when status=failed so the frontend can count it as an error
      return new Response(
        JSON.stringify({
          ok: status !== "failed",
          simulation: sim,
          status,
          body: rendered,
          ...(sendError ? { error: sendError } : {}),
        }),
        { headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // BRANCH C: EZGO pipeline triggers (idempotent via notification_log)
    // ─────────────────────────────────────────────────────────────────────────
    if (!guestId) throw new Error("guestId is required for guest triggers");
    if (!(trigger in T)) throw new Error("unknown trigger: " + trigger);

    // Idempotency: skip if already sent for this guest+trigger
    const { data: existing } = await supabase
      .from("notification_log").select("id")
      .eq("guest_id", guestId).eq("trigger_type", trigger).maybeSingle();
    if (existing) {
      return new Response(
        JSON.stringify({ ok: true, skipped: true, reason: "already_sent" }),
        { headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const { data: guest, error: gErr } = await supabase
      .from("guests").select("*").eq("id", guestId).single();
    if (gErr || !guest) throw new Error("guest_not_found");

    const msg = T[trigger](guest);
    let status = "simulated";
    try {
      if (!sim) { await sendViaMeta(guest.phone as string, msg); status = "sent"; }
    } catch (e) {
      console.error("[whatsapp] pipeline send failed:", (e as Error).message);
      status = "failed";
    }

    await supabase.from("notification_log").insert({
      guest_id: guestId, recipient: guest.phone, trigger_type: trigger,
      channel: "whatsapp", status, payload: { body: msg },
    });

    // Atomically stamp the pipeline flag — this is the SOLE writer of these flags.
    if (GUEST_FLAG[trigger]) {
      await supabase
        .from("guests")
        .update({ [GUEST_FLAG[trigger]]: true })
        .eq("id", guestId);
    }

    return new Response(
      JSON.stringify({ ok: true, simulation: sim, status, body: msg }),
      { headers: { ...CORS, "Content-Type": "application/json" } }
    );

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ ok: false, error: msg }),
      { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
});

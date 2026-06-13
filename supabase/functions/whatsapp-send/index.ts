// supabase/functions/whatsapp-send/index.ts  v5
// Central WhatsApp dispatcher for Dream Island.
//
// Supported triggers:
//   pre_arrival_2d   — T-2 confirmation request (idempotent)
//   night_before     — T-1 pre-arrival greeting (idempotent)
//   morning_suite    — day-of VIP welcome for suites (idempotent)
//   morning_welcome  — day-of welcome for standard rooms (idempotent)
//   mid_stay         — mid-stay check after first night (idempotent)
//   checkout_fb      — feedback request day after departure (idempotent)
//   butler_1h        — post check-in butler touch (idempotent)
//   room_ready       — manual UI: room ready notification (idempotent)
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
//
// Pipeline flag ownership (single source of truth — Edge Function only):
//   pre_arrival_2d   → guests.msg_pre_arrival_2d_sent  = true
//   night_before     → guests.msg_pre_arrival_sent     = true
//   morning_welcome  → guests.msg_morning_welcome_sent = true
//   room_ready       → guests.msg_room_ready_sent      = true
//   butler_1h        → guests.msg_post_checkin_sent    = true
//   mid_stay         → guests.msg_mid_stay_sent        = true
//   checkout_fb      → guests.msg_checkout_fb_sent     = true
//   broadcast        → no pipeline flag (ad-hoc sends)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Resort contact phone for {{2}} in templates that include a callback number.
// Set RESORT_CONTACT_PHONE in Supabase Secrets to replace this placeholder.
const RESORT_CONTACT_PHONE = Deno.env.get("RESORT_CONTACT_PHONE") ?? "054-0000000";

// Workshop signup URL for dream_workshop_signup {{2}}.
// Set WORKSHOP_SIGNUP_URL in Supabase Secrets once the user provides the link.
const WORKSHOP_SIGNUP_URL = Deno.env.get("WORKSHOP_SIGNUP_URL") ?? "dream-island.co.il/workshops";

// ── Pipeline trigger → approved WA template name ─────────────────────────────
// Each key maps to a template registered & approved in Meta WhatsApp Manager.
const PIPELINE_TEMPLATE: Record<string, string> = {
  pre_arrival_2d:  "dream_arrival_confirmation",  // T-2 days    → confirmation + Quick Reply buttons
  night_before:    "dream_checkin_reminder_v2",     // T-1 night   → "מחר מגיעים" + contact number
  morning_suite:   "dream_welcome_morning",        // suite AM    → "בוקר אור, היום מגיעים"
  morning_welcome: "dream_welcome_morning",        // standard AM → same template
  room_ready:      "dream_welcome_morning",        // manual UI   → morning welcome (idempotent)
  mid_stay:        "dream_mid_stay_check",         // day 2       → mid-stay check + Quick Reply buttons
  checkout_fb:     "dream_checkout_feedback",      // day after departure → feedback + Quick Reply buttons
  butler_1h:       "dream_handover_agent_v2",       // 1h post check-in
};

// Variables passed as {{1}}, {{2}}, … to each pipeline template.
const PIPELINE_VARS: Record<string, (g: Record<string, unknown>) => string[]> = {
  pre_arrival_2d:  (g) => [String(g.name ?? "")],
  night_before:    (g) => [String(g.name ?? ""), RESORT_CONTACT_PHONE],
  morning_suite:   (g) => [String(g.name ?? "")],
  morning_welcome: (g) => [String(g.name ?? "")],
  room_ready:      (g) => [String(g.name ?? "")],
  mid_stay:        (g) => [String(g.name ?? "")],
  checkout_fb:     (g) => [String(g.name ?? "")],
  butler_1h:       (g) => [String(g.name ?? "")],
};

// Maps each pipeline trigger to the DB flag it atomically stamps.
const GUEST_FLAG: Record<string, string> = {
  pre_arrival_2d:  "msg_pre_arrival_2d_sent",
  night_before:    "msg_pre_arrival_sent",
  morning_welcome: "msg_morning_welcome_sent",
  room_ready:      "msg_room_ready_sent",
  butler_1h:       "msg_post_checkin_sent",
  mid_stay:        "msg_mid_stay_sent",
  checkout_fb:     "msg_checkout_fb_sent",
};

// ── Staff shift assignment message ────────────────────────────────────────────
function shiftMsg(name: string, weekStart: string, shifts: Array<Record<string, unknown>>): string {
  const lines = shifts
    .map((s) => `• ${s.date} ${s.start}-${s.end}${s.department ? ` (${s.department})` : ""}`)
    .join("\n");
  return `שלום ${name}! 📅 סודר עבורך סידור משמרות חדש לשבוע ${weekStart}:\n${lines}\n` +
    `לשינויים פנה/י למנהל המשמרת. תודה! — Dream Island`;
}

// ── Meta WhatsApp Cloud API (live) ────────────────────────────────────────────
async function sendViaMeta(to: string, body: string): Promise<void> {
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

// ── Meta WhatsApp Template message ───────────────────────────────────────────
// Used for all business-initiated messages (required outside the 24h window).
// templateName must match an APPROVED template in WhatsApp Manager.
// variables maps to {{1}}, {{2}}, ... body parameters in the template.
// buttonUrlParam: dynamic suffix for the first URL button (index 0) — used by
//   dream_payment_and_workshops whose payment link ends with /r/{{1}}.
async function sendViaTemplate(
  to: string,
  templateName: string,
  variables: string[] = [],
  langCode = "he",
  buttonUrlParam?: string,
): Promise<void> {
  const token   = Deno.env.get("META_WHATSAPP_TOKEN")  ?? Deno.env.get("WHATSAPP_TOKEN");
  const phoneId = Deno.env.get("META_PHONE_NUMBER_ID") ?? Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  if (!token || !phoneId) throw new Error("missing_meta_whatsapp_creds");

  const components: unknown[] = [];
  if (variables.length > 0) {
    components.push({ type: "body", parameters: variables.map((v) => ({ type: "text", text: v })) });
  }
  if (buttonUrlParam !== undefined) {
    components.push({ type: "button", sub_type: "url", index: 0, parameters: [{ type: "text", text: buttonUrlParam }] });
  }

  const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: templateName,
        language: { code: langCode },
        ...(components.length > 0 ? { components } : {}),
      },
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    throw new Error(`meta_template_${res.status}: ${detail}`);
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
    const { trigger, guestId, assignments, weekStart, waTemplateName, templateVariables } = body as {
      trigger:             string;
      guestId?:            string;
      assignments?:        Record<string, unknown[]>;
      weekStart?:          string;
      waTemplateName?:     string;    // approved WA template name
      templateVariables?:  string[];  // values for {{1}}, {{2}}, … in the template body
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
      if (!guestId)        throw new Error("guestId required for broadcast trigger");
      if (!waTemplateName) throw new Error("waTemplateName is required for broadcast");

      const { data: guest, error: gErr } = await supabase
        .from("guests").select("*").eq("id", guestId).single();
      if (gErr || !guest) throw new Error("guest_not_found");
      if (!guest.phone)   throw new Error("guest_no_phone");

      const vars = templateVariables ?? [];

      let status = "simulated";
      let sendError: string | null = null;
      try {
        if (!sim) {
          await sendViaTemplate(guest.phone as string, waTemplateName, vars);
          status = "sent";
        }
      } catch (e) {
        sendError = (e as Error).message;
        console.error("[whatsapp] broadcast send failed:", sendError);
        status = "failed";
      }

      await supabase.from("notification_log").insert({
        guest_id:     guestId,
        recipient:    guest.phone,
        trigger_type: "broadcast",
        channel:      "whatsapp",
        status,
        payload: {
          template:  waTemplateName,
          variables: vars,
          ...(sendError ? { error: sendError } : {}),
        },
      });

      return new Response(
        JSON.stringify({
          ok: status !== "failed",
          simulation: sim,
          status,
          ...(sendError ? { error: sendError } : {}),
        }),
        { headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // BRANCH C: inbox_reply — manual reply typed in WhatsApp Inbox UI
    //   • Sends free-text directly to a phone number (no guest lookup needed)
    //   • Inserts an outbound row into whatsapp_conversations so the thread
    //     reflects the sent message without waiting for the next webhook event
    // ─────────────────────────────────────────────────────────────────────────
    if (trigger === "inbox_reply") {
      const b = body as Record<string, unknown>;
      const targetPhone = (b.phone as string | undefined)?.trim();
      const inboxMsg    = (b.message as string | undefined)?.trim();

      if (!targetPhone) throw new Error("phone is required for inbox_reply");
      if (!inboxMsg)    throw new Error("message is required for inbox_reply");

      let replyStatus = "simulated";
      let replyErr: string | null = null;

      try {
        if (!sim) { await sendViaMeta(targetPhone, inboxMsg); replyStatus = "sent"; }
      } catch (e) {
        replyErr = (e as Error).message;
        console.error("[whatsapp] inbox_reply send failed:", replyErr);
        replyStatus = "failed";
      }

      // Insert outbound row so the inbox thread shows the message immediately
      await supabase.from("whatsapp_conversations").insert({
        phone:         targetPhone,
        direction:     "outbound",
        message:       inboxMsg,
        wa_message_id: null,
      });

      return new Response(
        JSON.stringify({
          ok:         replyStatus !== "failed",
          simulation: sim,
          status:     replyStatus,
          ...(replyErr ? { error: replyErr } : {}),
        }),
        { headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // BRANCH E: payment_and_workshops — manual trigger from GuestsPage dashboard
    //   Sends dream_payment_and_workshops template with URL button suffix.
    //   Not in the pipeline map because it needs a buttonUrlParam.
    //   Not idempotent: staff may intentionally resend after updating the amount.
    // ─────────────────────────────────────────────────────────────────────────
    if (trigger === "payment_and_workshops") {
      if (!guestId) throw new Error("guestId required for payment_and_workshops");

      const { data: guest, error: gErr } = await supabase
        .from("guests")
        .select("id, name, phone, payment_amount, payment_link_url")
        .eq("id", guestId)
        .single();
      if (gErr || !guest) throw new Error("guest_not_found");
      if (!guest.phone)            throw new Error("guest_no_phone");
      if (!guest.payment_amount)   throw new Error("payment_amount_not_set");
      if (!guest.payment_link_url) throw new Error("payment_link_url_not_set");

      const safeName = (String(guest.name ?? "").trim()) || "אורח יקר";
      const amount   = String(guest.payment_amount);
      const fullUrl  = String(guest.payment_link_url);
      const urlToken = fullUrl.split("/").pop() ?? fullUrl;

      let status = "simulated";
      let sendError: string | null = null;
      try {
        if (!sim) {
          await sendViaTemplate(
            String(guest.phone),
            "dream_payment_and_workshops",
            [safeName, amount],
            "he",
            urlToken,
          );
          status = "sent";
        }
      } catch (e) {
        sendError = (e as Error).message;
        console.error("[whatsapp] payment_and_workshops send failed:", sendError);
        status = "failed";
      }

      await supabase.from("notification_log").insert({
        guest_id:     guestId,
        recipient:    guest.phone,
        trigger_type: "payment_and_workshops",
        channel:      "whatsapp",
        status,
        payload: { template: "dream_payment_and_workshops", amount, urlToken, ...(sendError ? { error: sendError } : {}) },
      });

      return new Response(
        JSON.stringify({ ok: status !== "failed", simulation: sim, status, ...(sendError ? { error: sendError } : {}) }),
        { headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // BRANCH D: Pipeline triggers (idempotent via notification_log)
    // ─────────────────────────────────────────────────────────────────────────
    if (!guestId) throw new Error("guestId is required for guest triggers");
    if (!(trigger in PIPELINE_TEMPLATE)) throw new Error("unknown trigger: " + trigger);

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

    const tmplName = PIPELINE_TEMPLATE[trigger];
    const tmplVars = PIPELINE_VARS[trigger]?.(guest) ?? [];
    let status = "simulated";
    try {
      if (!sim) {
        await sendViaTemplate(guest.phone as string, tmplName, tmplVars);
        status = "sent";
      }
    } catch (e) {
      console.error("[whatsapp] pipeline send failed:", (e as Error).message);
      status = "failed";
    }

    await supabase.from("notification_log").insert({
      guest_id: guestId, recipient: guest.phone, trigger_type: trigger,
      channel: "whatsapp", status,
      payload: { template: tmplName, variables: tmplVars },
    });

    // Atomically stamp the pipeline flag — this is the SOLE writer of these flags.
    if (GUEST_FLAG[trigger]) {
      await supabase
        .from("guests")
        .update({ [GUEST_FLAG[trigger]]: true })
        .eq("id", guestId);
    }

    return new Response(
      JSON.stringify({ ok: true, simulation: sim, status, template: tmplName }),
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

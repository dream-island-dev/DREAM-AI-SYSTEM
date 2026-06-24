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
//   room_ready       — manual UI: room ready notification (idempotent) — dedicated
//                      dream_room_ready template, isolated from morning_* alerts
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
//   mid_stay         → guests.msg_mid_stay_sent        = true
//   checkout_fb      → guests.msg_checkout_fb_sent     = true
//   broadcast        → no pipeline flag (ad-hoc sends)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendInteractiveButtons } from "../_shared/interactiveSend.ts";

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
//
// ⚠️ SEASONAL/WORDING CHANGES — READ BEFORE EDITING TEMPLATE BODY TEXT:
// These are Meta-approved TEMPLATES, not free text — they're the only way to
// message a guest outside the 24h customer-service window (which is most of
// this pipeline: T-2, T-1, morning-of, mid-stay, checkout). The body text you
// see in BroadcastDashboard's preview is a LOCAL COPY of what Meta approved.
// Changing it here (or in Meta Business Manager) — e.g. swapping "השמש בחוץ"
// for a winter line — does NOT take effect until Meta RE-APPROVES the edited
// template (hours, sometimes longer). Sending to an un-approved edit either
// silently uses the OLD approved text or gets rejected outright. Any seasonal
// wording change to dream_welcome_morning (or any template here) must go
// through Meta Business Manager → WhatsApp Manager → edit + resubmit, and
// should NOT be assumed live until its status shows APPROVED again in the
// "📋 ניהול תבניות" tab. See CLAUDE.md §6 for the same note.
const PIPELINE_TEMPLATE: Record<string, string> = {
  pre_arrival_2d:  "dream_arrival_confirmation",  // T-2 days    → confirmation + Quick Reply buttons
  night_before:    "dream_checkin_reminder_v2",     // T-1 night   → "מחר מגיעים" + contact number
  morning_suite:   "dream_welcome_morning",        // suite AM    → "בוקר אור, היום מגיעים"
  morning_welcome: "dream_welcome_morning",        // standard AM → same template
  room_ready:      "dream_room_ready",             // manual UI   → dedicated key-handover template
                                                     // (Sprint 5.1 — was dream_welcome_morning, which
                                                     // cross-fired the same wording as the scheduled
                                                     // morning alert; now isolated)
  mid_stay:        "dream_mid_stay_check",         // day 2       → mid-stay check + Quick Reply buttons
  checkout_fb:     "dream_checkout_feedback",      // day after departure → feedback + Quick Reply buttons
};

// Variables passed as {{1}}, {{2}}, … to each pipeline template.
// All values pass through sanitizeTemplateVars() at send time — these lambdas
// produce raw values; sanitization is applied in BRANCH D before the API call.
const PIPELINE_VARS: Record<string, (g: Record<string, unknown>) => string[]> = {
  pre_arrival_2d:  (g) => [String(g.name ?? "")],
  night_before:    (g) => [String(g.name ?? ""), RESORT_CONTACT_PHONE],
  morning_suite:   (g) => [String(g.name ?? "")],
  morning_welcome: (g) => [String(g.name ?? "")],
  room_ready:      (g) => [String(g.name ?? ""), String(g.room ?? g.suite_name ?? "")],
  mid_stay:        (g) => [String(g.name ?? "")],
  checkout_fb:     (g) => [String(g.name ?? "")],
};

// Maps each pipeline trigger to the DB flag it atomically stamps.
const GUEST_FLAG: Record<string, string> = {
  pre_arrival_2d:  "msg_pre_arrival_2d_sent",
  night_before:    "msg_pre_arrival_sent",
  morning_suite:   "msg_morning_suite_sent",
  morning_welcome: "msg_morning_welcome_sent",
  room_ready:      "msg_room_ready_sent",
  mid_stay:        "msg_mid_stay_sent",
  checkout_fb:     "msg_checkout_fb_sent",
};

// ── Template variable sanitizer — prevents Meta error 131008 (empty param) ────
// Meta rejects any template variable that is an empty string or whitespace.
// Position 0 is always the guest name → fallback to "אורח יקר".
// All other positions fall back to "-" (a safe non-empty placeholder).
function sanitizeTemplateVars(vars: string[]): string[] {
  return vars.map((v, i) => {
    const t = String(v ?? "").trim();
    if (t) return t;
    return i === 0 ? "אורח יקר" : "-";
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

// A timeout/network abort means we genuinely don't know whether Meta processed
// the request before the connection was cut — it is NOT the same thing as Meta
// rejecting the message. Tagging it distinctly lets callers report "outcome
// unknown" instead of a confident-but-possibly-wrong "failed" (FAIL VISIBLE,
// CLAUDE.md §0.3) — this is the root cause of broadcasts showing as failed
// when the message demonstrably arrived.
function _isAbortError(e: unknown): boolean {
  return e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError");
}

// ── Meta WhatsApp Cloud API (live) ────────────────────────────────────────────
async function sendViaMeta(to: string, body: string): Promise<void> {
  const token   = Deno.env.get("META_WHATSAPP_TOKEN")    ?? Deno.env.get("WHATSAPP_TOKEN");
  const phoneId = Deno.env.get("META_PHONE_NUMBER_ID")   ?? Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  if (!token || !phoneId) throw new Error("missing_meta_whatsapp_creds");

  try {
    const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body, preview_url: false },
      }),
      signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      throw new Error(`meta_http_${res.status}: ${detail}`);
    }
  } catch (e) {
    if (_isAbortError(e)) throw new Error("timeout_no_response: Meta did not respond within 25s — message may have still been delivered");
    throw e;
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

  try {
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
      signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      throw new Error(`meta_template_${res.status}: ${detail}`);
    }
  } catch (e) {
    if (_isAbortError(e)) throw new Error("timeout_no_response: Meta did not respond within 25s — message may have still been delivered");
    throw e;
  }
}

// sendInteractiveButtons (Meta interactive reply-buttons message, Phase 4
// hybrid fallback) now lives in ../_shared/interactiveSend.ts — shared with
// whatsapp-webhook's Stage 2 Pay so both call the same code instead of two
// copies that could drift. Imported above; behavior unchanged.

// ── 24-Hour Interaction Window Guard ──────────────────────────────────────────
// Meta only accepts free-form session text (sendViaMeta/sendInteractiveButtons)
// inside the 24h customer-service window opened by the guest's last inbound
// message — guests.wa_window_expires_at is set to now()+24h by whatsapp-webhook
// on every inbound message, so it IS the "last guest interaction" marker, just
// stored pre-offset rather than raw. Outside that window Meta requires an
// approved template (sendViaTemplate) — business-initiated free text is simply
// rejected. Centralized here so both call sites (BRANCH C inbox_reply, BRANCH D
// hybrid pipeline) make the identical decision instead of drifting.
function isWindowOpen(expiresAt: unknown): boolean {
  if (!expiresAt) return false;
  return new Date(expiresAt as string).getTime() > Date.now();
}

// Simulation: true when explicitly set OR when Meta credentials are absent.
const isSimulation = (): boolean =>
  Deno.env.get("WHATSAPP_SIMULATION") === "true" ||
  !(Deno.env.get("META_WHATSAPP_TOKEN")   ?? Deno.env.get("WHATSAPP_TOKEN")) ||
  !(Deno.env.get("META_PHONE_NUMBER_ID")  ?? Deno.env.get("WHATSAPP_PHONE_NUMBER_ID"));

// ── Manual (human-initiated) triggers — always permitted ─────────────────────
// The AUTOMATION_ENABLED kill switch exists to stop the system from messaging
// guests AUTONOMOUSLY (the scheduled pipeline triggers driven by whatsapp-cron:
// pre_arrival_2d / night_before / morning_* / mid_stay / checkout_fb /
// room_ready). It must NOT block a human deliberately clicking "send" in a UI.
//
// Session 24 root cause: only `inbox_reply` was exempt, so the entire
// "📣 שידור הודעות / Send Messages" tab (trigger `broadcast`) — and the manual
// payment-link button (`payment_and_workshops`) — failed entirely whenever
// AUTOMATION_ENABLED wasn't "true", while manual inbox replies worked. Both
// `broadcast` and `payment_and_workshops` send ONLY pre-approved Meta templates
// via sendViaTemplate(), which are valid OUTSIDE the 24h customer-service window
// by definition — so there is no 24h-window risk in permitting them, and they
// are explicit, throttled, manager-initiated actions (not autonomous blasts).
const MANUAL_TRIGGERS = new Set(["inbox_reply", "broadcast", "payment_and_workshops"]);

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

    // ── KILL SWITCH — gates AUTONOMOUS sends only ─────────────────────────────
    // Manual, human-initiated triggers (MANUAL_TRIGGERS: inbox_reply, broadcast,
    // payment_and_workshops) are always allowed — they are deliberate staff
    // clicks and (for broadcast/payment) use pre-approved Meta templates that
    // are window-independent. Only the scheduled/autonomous pipeline triggers
    // (and shift_assignment) stay blocked until AUTOMATION_ENABLED=true. The
    // periodic cron has its own independent CRON_ENABLED gate, so enabling
    // manual broadcasts here does NOT unleash the scheduled pipeline.
    if (!MANUAL_TRIGGERS.has(trigger) && Deno.env.get("AUTOMATION_ENABLED") !== "true") {
      console.log(`[whatsapp-send] 🚫 HALTED — trigger "${trigger}" blocked. Set AUTOMATION_ENABLED=true in Supabase Secrets to re-enable.`);
      return new Response(
        JSON.stringify({ ok: false, halted: true, reason: "automation_disabled", trigger }),
        { headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

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
      // DIAGNOSTIC (session 11): the only way this branch produces the generic
      // "Edge Function returned a non-2xx status code" is one of the throws
      // below firing before any Meta call happens — none of them are specific
      // to template variables. This pins down exactly which one fires, instead
      // of guessing, the next time a manual broadcast test fails.
      console.log(`[whatsapp-send] 🩺 broadcast request — guestId:${JSON.stringify(guestId)} waTemplateName:"${waTemplateName}" varsLen:${templateVariables?.length ?? 0}`);

      if (!guestId)        throw new Error("guestId required for broadcast trigger");
      if (!waTemplateName) throw new Error("waTemplateName is required for broadcast");

      // .maybeSingle() — never .single() (CLAUDE.md red line): .single() throws
      // a Postgrest error (not a clean null) on zero OR multiple rows, which is
      // exactly the kind of thing that was surfacing as an opaque "guest_not_found"
      // with no detail on what actually went wrong.
      const { data: guest, error: gErr } = await supabase
        .from("guests").select("*").eq("id", guestId).maybeSingle();
      if (gErr)    throw new Error(`guest_lookup_error: ${gErr.message}`);
      if (!guest)  throw new Error(`guest_not_found: no guest row for id=${JSON.stringify(guestId)}`);
      if (!guest.phone) throw new Error(`guest_no_phone: guest id=${guestId} (${guest.name ?? "?"}) has no phone on file`);

      // Anti-loop guard: arrival confirmation is a one-time pipeline step.
      // If the guest already confirmed, skip silently — prevents re-sending when
      // a manager clicks "שלח לכולם" again after a guest tapped "כן, מגיעים!".
      if (waTemplateName === "dream_arrival_confirmation" && guest.arrival_confirmed === true) {
        console.info(`[whatsapp] broadcast skip — ${guest.name} already confirmed arrival`);
        return new Response(
          JSON.stringify({ ok: true, skipped: true, reason: "already_confirmed" }),
          { headers: { ...CORS, "Content-Type": "application/json" } },
        );
      }

      const vars = sanitizeTemplateVars(templateVariables ?? []);

      let status = "simulated";
      let sendError: string | null = null;
      try {
        if (!sim) {
          await sendViaTemplate(guest.phone as string, waTemplateName, vars);
          status = "sent";
        }
      } catch (e) {
        sendError = (e as Error).message;
        // A timeout means Meta never confirmed OR rejected — not the same as a
        // real rejection. Reporting it as "failed" is exactly the misleading
        // signal that showed messages as failed after they'd actually arrived.
        status = sendError.startsWith("timeout_no_response") ? "timeout" : "failed";
        console.error(`[whatsapp] broadcast send ${status}:`, sendError);
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

      // Log to conversation history so inbox shows the template message.
      // Non-blocking by design — a logging failure must never break the broadcast.
      // NOTE: the Postgrest query builder is PromiseLike (implements .then()) but
      // does NOT implement .catch() — chaining .catch() directly on it throws
      // "...insert(...).catch is not a function" instead of swallowing the error.
      if (status === "sent" || status === "simulated") {
        try {
          const { error: convErr } = await supabase.from("whatsapp_conversations").insert({
            phone:         guest.phone as string,
            guest_id:      guestId,
            direction:     "outbound",
            message:       `[תבנית: ${waTemplateName}]`,
            wa_message_id: null,
          });
          if (convErr) console.warn("[whatsapp-send] broadcast conversation log failed (non-blocking):", convErr.message);
        } catch (e) {
          console.warn("[whatsapp-send] broadcast conversation log failed (non-blocking):", (e as Error).message);
        }
      }

      return new Response(
        JSON.stringify({
          // "timeout" is NOT treated as ok — we have no confirmation either way —
          // but it's reported via a distinct `status` so the caller doesn't lump
          // it in with a confirmed Meta rejection.
          ok: status === "sent" || status === "simulated",
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

      // ── 24-Hour Interaction Window Guard ─────────────────────────────────
      // inbox_reply sends raw free text — previously unchecked here, so a
      // manager replying to a stale thread just hit a possibly-cryptic Meta
      // rejection AFTER attempting the send (CLAUDE.md §CORE BUSINESS LOGIC
      // point 3 flagged this as open). Checking first turns the same
      // inevitable outcome (Meta would reject either way — free text outside
      // the window is a hard Meta rule, not a preference we control) into a
      // fast, clear, pre-send signal instead of an after-the-fact API error.
      // Only enforced when the phone matches a known guest row; an untracked
      // number (no guest record) keeps today's permissive behavior, since we
      // have no window data to check.
      const { data: windowGuest } = await supabase
        .from("guests")
        .select("wa_window_expires_at")
        .eq("phone", targetPhone)
        .maybeSingle();
      if (windowGuest && !isWindowOpen(windowGuest.wa_window_expires_at)) {
        return new Response(
          JSON.stringify({
            ok: false,
            status: "window_closed",
            error: "window_closed: חלון 24 השעות סגור — האורח לא הגיב ב-24 השעות האחרונות, לא ניתן לשלוח הודעה חופשית. נדרשת תבנית מאושרת.",
          }),
          { headers: { ...CORS, "Content-Type": "application/json" } },
        );
      }

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
        .maybeSingle();
      if (gErr)   throw new Error(`guest_lookup_error: ${gErr.message}`);
      if (!guest) throw new Error(`guest_not_found: no guest row for id=${JSON.stringify(guestId)}`);
      if (!guest.phone) throw new Error("guest_no_phone");
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

    // Phase 4 (Automation Control Center): automation_stages (migration 065)
    // is now consulted for template name / session-message / buttons routing.
    // The original hardcoded PIPELINE_TEMPLATE/PIPELINE_VARS/GUEST_FLAG maps
    // remain the fallback whenever a stage has no row — room_ready is the one
    // pipeline trigger that is intentionally NOT in automation_stages (it's
    // event-driven from the RoomBoard/AICopilot UI toggle, not a timeline
    // stage), so it always falls through to the hardcoded map, unchanged.
    // Same "DB overrides, hardcoded fallback" pattern already proven for
    // bot_settings.system_prompt overriding FALLBACK_SYSTEM_PROMPT.
    const { data: stageRow } = await supabase
      .from("automation_stages")
      .select("meta_template_name, session_message_script_key, interactive_buttons, guest_flag_column")
      .eq("stage_key", trigger)
      .eq("is_active", true)
      .maybeSingle();

    if (!(trigger in PIPELINE_TEMPLATE) && !stageRow?.meta_template_name) {
      throw new Error("unknown trigger: " + trigger);
    }

    // Idempotency: skip ONLY if a genuinely successful (or simulated) send already
    // exists for this guest+trigger. A prior "failed"/"timeout" row must NOT block
    // a retry — that was the exact bug that made a failed pipeline send permanent
    // (flagged session 9, fixed here together with the GUEST_FLAG gate below).
    // .limit(1) instead of .maybeSingle(): retries can legitimately accumulate
    // multiple failed/timeout rows for the same guest+trigger, which maybeSingle()
    // would error on.
    const { data: existingSent } = await supabase
      .from("notification_log").select("id")
      .eq("guest_id", guestId).eq("trigger_type", trigger)
      .in("status", ["sent", "simulated"])
      .limit(1);
    if (existingSent && existingSent.length > 0) {
      return new Response(
        JSON.stringify({ ok: true, skipped: true, reason: "already_sent" }),
        { headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    const { data: guest, error: gErr } = await supabase
      .from("guests").select("*").eq("id", guestId).maybeSingle();
    if (gErr)   throw new Error(`guest_lookup_error: ${gErr.message}`);
    if (!guest) throw new Error(`guest_not_found: no guest row for id=${JSON.stringify(guestId)}`);

    const tmplName = stageRow?.meta_template_name ?? PIPELINE_TEMPLATE[trigger];
    const flagColumn = stageRow?.guest_flag_column ?? GUEST_FLAG[trigger];

    // ── Hybrid fallback (req #4) ───────────────────────────────────────────
    // Only attempted when a stage actually has a session message configured
    // — true for none of them today (every automation_stages row seeded by
    // migration 065 has session_message_script_key = NULL except the
    // event-driven stage_2_arrival, which never reaches this branch). This
    // makes the branch below provably a no-op until an admin opts a stage
    // into a session message via the Automation Control Center UI — at
    // which point it sends the rich free-text reply (+ buttons) instead of
    // the Meta template ONLY if the guest's 24h window happens to be open.
    let usedSessionMessage = false;
    let sessionBody: string | null = null;
    let sessionButtons: Array<{ type: string; label: string; url?: string }> = [];

    if (stageRow?.session_message_script_key) {
      if (isWindowOpen(guest.wa_window_expires_at)) {
        const { data: scriptRow } = await supabase
          .from("bot_scripts")
          .select("message_text")
          .eq("script_key", stageRow.session_message_script_key)
          .maybeSingle();
        const rawText = scriptRow?.message_text?.trim();
        if (rawText) {
          const guestName = (String(guest.name ?? "").trim()) || "אורח יקר";
          // Scope-limited on purpose: PIPELINE_VARS today only ever passes the
          // guest's name to pipeline templates, so {{GUEST_NAME}} is the only
          // placeholder this path needs to support. If a future stage's
          // session message needs richer placeholders (spa time, workshop
          // url, etc.), port the relevant pieces of whatsapp-webhook's
          // resolvePlaceholders() here rather than guessing at a generic shape.
          sessionBody = rawText.replace(/\{\{\s*GUEST_NAME\s*\}\}/gi, guestName);
          sessionButtons = (stageRow.interactive_buttons ?? []) as typeof sessionButtons;
          usedSessionMessage = true;
        } else {
          console.warn(`[whatsapp-send] stage "${trigger}" has session_message_script_key="${stageRow.session_message_script_key}" but bot_scripts has no text — falling back to Meta template`);
        }
      }
    }

    let status = "simulated";
    let sendError: string | null = null;
    let tmplVars: string[] = [];

    let sessionFailureNote: string | null = null;

    if (usedSessionMessage) {
      try {
        if (!sim) {
          await sendInteractiveButtons(guest.phone as string, sessionBody!, sessionButtons);
          status = "sent";
        }
      } catch (e) {
        // ── 24-Hour Interaction Window Guard — failure fallback ────────────
        // A session-message attempt can fail for reasons unrelated to window
        // state (transient Meta error, malformed button payload, etc.). This
        // is a scheduled automation stage — leaving the guest with NO message
        // at all defeats the whole pipeline. Retry once via the
        // window-independent Meta template instead of just recording failure.
        sessionFailureNote = (e as Error).message;
        console.error(`[whatsapp] pipeline session-message send failed — falling back to Meta template:`, sessionFailureNote);
        usedSessionMessage = false;
      }
    }

    if (!usedSessionMessage) {
      tmplVars = sanitizeTemplateVars(PIPELINE_VARS[trigger]?.(guest) ?? []);
      try {
        if (!sim) {
          await sendViaTemplate(guest.phone as string, tmplName, tmplVars);
          status = "sent";
        }
      } catch (e) {
        sendError = (e as Error).message;
        status = sendError.startsWith("timeout_no_response") ? "timeout" : "failed";
        console.error(`[whatsapp] pipeline send ${status}:`, sendError);
      }
    }

    await supabase.from("notification_log").insert({
      guest_id: guestId, recipient: guest.phone, trigger_type: trigger,
      channel: "whatsapp", status,
      payload: usedSessionMessage
        ? { channel: "session_message", scriptKey: stageRow!.session_message_script_key, ...(sendError ? { error: sendError } : {}) }
        : {
            channel: "meta_template", template: tmplName, variables: tmplVars,
            ...(sendError ? { error: sendError } : {}),
            // Present whenever this template send is a fallback after a failed
            // session-message attempt — even on eventual success, so the history
            // log shows the stage didn't go out via its first-choice channel.
            ...(sessionFailureNote ? { sessionMessageFailureNote: sessionFailureNote } : {}),
          },
    });

    // Log to conversation history so inbox shows it.
    // Non-blocking by design — see broadcast branch above for why a bare
    // .catch() chained directly on the query builder throws instead of swallowing.
    if (status === "sent" || status === "simulated") {
      try {
        const { error: convErr } = await supabase.from("whatsapp_conversations").insert({
          phone: guest.phone as string,
          guest_id: guestId,
          direction: "outbound",
          message: usedSessionMessage ? sessionBody! : `[תבנית: ${tmplName}]`,
          wa_message_id: null,
        });
        if (convErr) console.warn("[whatsapp-send] pipeline conversation log failed (non-blocking):", convErr.message);
      } catch (e) {
        console.warn("[whatsapp-send] pipeline conversation log failed (non-blocking):", (e as Error).message);
      }
    }

    // Atomically stamp the pipeline flag — this is the SOLE writer of these flags.
    // Only on a real success: stamping it on "failed"/"timeout" would mark a
    // message that may never have arrived as permanently "sent", with no retry.
    if (flagColumn && (status === "sent" || status === "simulated")) {
      await supabase
        .from("guests")
        .update({ [flagColumn]: true })
        .eq("id", guestId);
    }

    return new Response(
      JSON.stringify({
        ok: true, simulation: sim, status,
        channel: usedSessionMessage ? "session_message" : "meta_template",
        ...(usedSessionMessage ? {} : { template: tmplName }),
      }),
      { headers: { ...CORS, "Content-Type": "application/json" } }
    );

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[whatsapp-send] error:", msg);
    // ⚠️ Always HTTP 200 — matches the convention already established in
    // get-wa-templates/chat/suggest-import-mapping in this codebase. This
    // function was the one outlier returning 400, which meant supabase-js's
    // generic "Edge Function returned a non-2xx status code" was ALL the
    // frontend ever saw — the actual reason (e.g. guest_not_found,
    // guest_no_phone) was thrown away, masked behind that wrapper text.
    return new Response(
      JSON.stringify({ ok: false, error: msg }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
});

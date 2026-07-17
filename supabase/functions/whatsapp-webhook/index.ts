// supabase/functions/whatsapp-webhook/index.ts  v2
// ══════════════════════════════════════════════════════════════════════════════
// DREAM ISLAND — Premium AI Concierge Webhook
//
// Architecture:
//   GET  → Meta webhook verification handshake (unchanged)
//   POST → Incoming message pipeline:
//
//   message
//     │
//     ▼
//   classifyIntent()  ← keyword-based, < 1 ms, zero AI cost
//     │
//     ├── "complaint"  → pre-written empathy reply
//     │                  + flagGuestAlert() writes to guest_alerts + guests
//     │
//     ├── "upsell"     → pre-written warm upgrade offer
//     │
//     ├── "faq"        → Gemini 2.0 Flash with full concierge system prompt
//     │                  + last-5-messages conversation history injected
//     │
//     └── "fallback"   → static reception-handoff message
//
//   All messages logged with intent column in whatsapp_conversations.
//
// Required Supabase secrets:
//   META_WEBHOOK_VERIFY_TOKEN | META_APP_SECRET (POST signature) | META_WHATSAPP_TOKEN
//   META_PHONE_NUMBER_ID | GEMINI_API_KEY | SUPABASE_URL | SUPABASE_SERVICE_ROLE_KEY
//
// Ops-group 👍 task completion: whapi-webhook (not this Meta guest webhook).
// Dual lookup: bot card (tasks.whapi_message_id) → trigger text (tasks.source_message_id).
// Field-ops guest requests (operational intercept + LLM tool-calling path) no
// longer dispatch to the Whapi ops group from this file at all — they only
// create a pending_approval task (_shared/createGuestOpsTask.ts). Gemini EN
// translation + the actual Whapi send happen later, only after a staff member
// approves in OperationsBoard.js, via the extended notify-manual-task function
// (2026-07-07 Human-in-the-Loop gate — see git history for the prior
// unsupervised routeGuestRequestToOpsGroup).
// ══════════════════════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendCtaUrlButton } from "../_shared/interactiveSend.ts";
import { persistGuestWaMedia } from "../_shared/metaMedia.ts";
import {
  guardPaymentLink,
  isStage2PayAlreadyDispatched,
  isStage2PayInFlight,
  logPaymentLinkFailure,
  markStage2PayProcessing,
  PAYMENT_LINK_FAILURE_LABEL,
} from "../_shared/paymentLinkGuard.ts";
import { sendWhapiText, cleanPhoneForMention } from "../_shared/whapiSend.ts";
import { buildPreCheckinGuestRequestAdirText } from "../_shared/adirNotifyMessages.ts";
import { loadStaffNotifyTemplates } from "../_shared/staffNotifyTemplates.ts";
import { shouldRouteGuestOutboundViaWhapiSuites, primeGuestChannelConfig } from "../_shared/guestWhapiRouting.ts";
import {
  shouldApplyInRoomContextOverride,
  shouldInterceptOperationalInHouseRequest,
  shouldInterceptAdministrativeInHouseRequest,
  isAdministrativeInHouseRequest,
  isAllowlistedPhysicalTaskRequest,
  classifyGuestRequestDispatch,
  isRequestsBoardEscalation,
  buildOperationalRequestSummary,
  buildOperationalDispatchReply,
  shouldInterceptBalloonRoomRequest,
  isBalloonRoomRequest,
  buildBalloonRoomRequestReply,
  isSensitiveStayChangeRequest,
  CANONICAL_STAY_CHANGE_HANDOFF_MSG,
  isSensitiveFinancialRequest,
  CANONICAL_FINANCIAL_HANDOFF_MSG,
  isSevereComplaint,
  isLowValueCourtesyMessage,
  isGuestGreetingMessage,
  isAutoAwayMessage,
  isCheckInPolicyQuestion,
  buildCheckInPolicyReply,
  isReplyObviouslyTruncated,
  resolveTruncatedReplyFallback,
  resolveEffectiveGuestStatus,
  isGuestEligibleForInHouseOpsDispatch,
  extractAllowlistedRequestLines,
  resolveAutomationScope,
  shouldInterceptDepartureAssistRequest,
  buildDepartureAssistSummary,
  buildDepartureAssistReply,
  buildAdministrativeRequestSummary,
} from "../_shared/automationSchedule.ts";
import { createGuestOpsTask } from "../_shared/createGuestOpsTask.ts";
import {
  classifyFacilityReview,
  buildFacilityReviewReply,
  saveGuestFacilityReview,
  type FacilityReviewCapture,
} from "../_shared/guestFacilityReview.ts";
import { onGuestAlertInserted } from "../_shared/guestAlertWhapiNotify.ts";
import {
  buildOptionalSpaText,
  buildSpaLine,
  buildSpaSentence,
  buildSpaTimeSentence,
  hasSpaBooking,
  formatSpaScheduleDisplay,
} from "../_shared/spaSchedule.ts";
import {
  buildPhoneVariants,
  isArrivalConfirmationMessage,
  lookupGuestByPhone,
} from "../_shared/arrivalConfirmation.ts";
import {
  DAYPASS_WINDOW_OPENER_ACK_HE,
  isDaypassWindowOpenerMessage,
} from "../_shared/daypassWindowOpener.ts";
import {
  isServiceFallbackButtonReply,
  SERVICE_FALLBACK_OK_ACK_HE,
  SERVICE_FALLBACK_REQUEST_ACK_HE,
} from "../_shared/serviceFallbackTemplate.ts";
import { sanitizeMetaRecipientPhone } from "../_shared/metaPhone.ts";
import {
  extractArrivalTimeFromText,
  persistGuestEta,
  insertArrivalEtaBoardAlert,
} from "../_shared/guestEta.ts";
import {
  fetchAutomationStage,
  spaVarsFromGuest,
  resolvePlaceholders,
  buildPortalLink,
  canGuestConfirmArrival,
  isRecordOnlyArrivalTimeUpdate,
  RECORD_ONLY_ARRIVAL_REPLY,
  DATE_CHANGE_RE,
  patchClaimedInbound,
  dispatchStage2ViaPipeline,
  runGuestArrivalConfirmation,
  type AutomationStageRow,
  type GuestOutboundRow,
} from "../_shared/guestInboundOrchestrator.ts";
import {
  GUEST_STAFF_HANDOFF_SENTENCE,
  buildGuestHumanRequestReply,
  detectGuestHumanRequest,
  isGuestStaffHandoffReply,
} from "../_shared/guestBotHandoff.ts";
import {
  fetchGuestBotSettings,
  assembleGuestBrainPrompt,
} from "../_shared/guestBotSettings.ts";
import {
  formatGuestContextLine,
  isPendingPortalSpaRequest,
  PENDING_PORTAL_SPA_LLM_SUFFIX,
} from "../_shared/buildGuestContextForAi.ts";
import { fetchGuestChatHistory } from "../_shared/guestConversationHistory.ts";
import {
  runBalloonRoomRequestIntercept,
  runAdministrativeInHouseIntercept,
  logAdministrativeRequestAlert,
} from "../_shared/guestBalloonAdminIntercept.ts";
import {
  generateGuestChatReplyWithTools,
  filterToolLoggedRequest,
  looksLikeToolOnlyAck,
  type GuestAiReplyResult,
} from "../_shared/guestBotLlmTools.ts";
import {
  sanitizeGuestBotReply,
  shouldHardDropGuestReply,
} from "../_shared/guestBotSanitize.ts";
import {
  verifyMetaWebhookSignature,
  shouldVerifyMetaWebhookSignature,
} from "../_shared/metaWebhookSignature.ts";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ══════════════════════════════════════════════════════════════════════════════
// §1  DYNAMIC BOT CONFIG — loaded from bot_config table, cached 5 min
// ══════════════════════════════════════════════════════════════════════════════

// ── Portal spa request — guests.attention_reason set by guest-portal-spa-request.
// Portal spa — isPendingPortalSpaRequest + PENDING_PORTAL_SPA_LLM_SUFFIX in buildGuestContextForAi.ts

// Rapid burst coalescing — two webhook invocations within ~2s share one LLM reply.
const BURST_COALESCE_MS = 1800;
const BURST_WINDOW_MS   = 5000;

// Module-level cache: shared across requests within the same function instance
let _configCache: Record<string, string> = {};
let _cacheTime = 0;
const CONFIG_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ── §1b  BOT SCRIPTS — loaded from bot_scripts table, cached 5 min ──────────
interface BotScript {
  script_key:       string;
  trigger_event:    string;
  message_text:     string | null;
  ai_system_prompt: string | null;
}

let _scriptsCache: BotScript[] = [];
let _scriptsCacheTime = 0;

async function fetchBotScripts(
  supabaseClient: ReturnType<typeof createClient>
): Promise<Record<string, BotScript>> {
  const now = Date.now();
  if (_scriptsCache.length > 0 && now - _scriptsCacheTime < CONFIG_TTL_MS) {
    return Object.fromEntries(_scriptsCache.map(s => [s.script_key, s]));
  }
  try {
    const { data } = await supabaseClient
      .from("bot_scripts")
      .select("script_key, trigger_event, message_text, ai_system_prompt")
      .eq("is_active", true)
      .order("sort_order");
    _scriptsCache = (data as BotScript[] | null) ?? [];
    _scriptsCacheTime = now;
    return Object.fromEntries(_scriptsCache.map(s => [s.script_key, s]));
  } catch (e) {
    console.warn("[webhook] fetchBotScripts error:", (e as Error).message);
    return Object.fromEntries(_scriptsCache.map(s => [s.script_key, s]));
  }
}

// spaVarsFromGuest / resolvePlaceholders — moved to
// _shared/guestInboundOrchestrator.ts (§2, Whapi/Meta guest-inbound
// orchestrator unification) so whapi-webhook can build the same Stage 2 reply
// text. Imported above.

// ── Stage 2 Pay — payment/workshop placeholder resolver ─────────────────────
// Deliberately separate from resolvePlaceholders() above: zero shared code,
// so nothing here can affect the existing spa-time Stage 2 reply. Used only
// by the new payment-pending branch in the arrival-confirmation paths below.
// {{SPA_LINE}} reuses buildSpaSentence() — the exact helper stage_2_arrival
// already relies on — rather than a second spa-text mechanism.
//
// ── FAIL VISIBLE FIX (split-brain leak, CLAUDE.md §CORE #2) ─────────────────
// This resolver previously handled GUEST_NAME/PAYMENT_AMOUNT/PAYMENT_LINK/
// WORKSHOP_URL/SPA_LINE only — it silently had NO substitution at all for
// {{SPA_TIME}}, {{OPTIONAL_SPA_TEXT}}, or {{PORTAL_LINK}}/{{portal_url}},
// even though those are the exact standard placeholder vocabulary documented
// for stage_2_arrival (resolvePlaceholders() above) and staff naturally reuse
// the same tokens when editing stage_2_payment_reply in BotScriptEditor. A
// script using them would leave the tokens literally unresolved in
// `paymentReply` — and because sendStage2PayReply() sometimes dispatches via
// sendCtaUrlButton()/sendInteractiveButtons() (interactiveSend.ts), which
// (unlike sendReply()) never ran the raw text through sanitizeReply()'s final
// {{...}} safety net, the guest could receive the literal broken tokens
// verbatim. Brought to parity with resolvePlaceholders()'s graceful-fallback
// contract: substitute the real value when present, strip the containing
// sentence when absent — never leave a raw token in the outgoing text.
function resolvePaymentPlaceholders(
  template: string,
  vars: {
    guestName: string; paymentAmount: string; paymentLink: string; workshopUrl: string;
    spaTime: string | null; spaDate?: string | null; portalLink?: string;
  },
): string {
  const spaDate = vars.spaDate ?? null;
  const spaTime = vars.spaTime;
  let text = template
    .replace(/\{\{\s*GUEST_NAME\s*\}\}/gi, vars.guestName)
    .replace(/\{\{\s*PAYMENT_AMOUNT\s*\}\}/gi, vars.paymentAmount)
    .replace(/\{\{\s*PAYMENT_LINK\s*\}\}/gi, vars.paymentLink)
    .replace(/\{\{\s*WORKSHOP_URL\s*\}\}/gi, vars.workshopUrl)
    .replace(/\{\{\s*SPA_LINE\s*\}\}/gi, buildSpaLine(spaDate, spaTime))
    .replace(/\{\{\s*OPTIONAL_SPA_TEXT\s*\}\}/gi, buildOptionalSpaText(spaDate, spaTime));

  if (hasSpaBooking(spaDate, spaTime)) {
    const spaSentence = buildSpaTimeSentence(spaDate, spaTime).replace(/\.$/, "");
    text = text.replace(/\{\{\s*SPA_TIME\s*\}\}/gi, spaSentence);
  } else {
    text = text.replace(/[^\n.!?]*\{\{\s*SPA_TIME\s*\}\}[^\n.!?]*[.!?]?\s*/gi, "");
  }

  const PORTAL_PLACEHOLDER_RE = /\{\{\s*(?:PORTAL_LINK|portal_url)\s*\}\}/gi;
  if (vars.portalLink) {
    text = text.replace(PORTAL_PLACEHOLDER_RE, vars.portalLink);
  } else {
    if (PORTAL_PLACEHOLDER_RE.test(text)) {
      console.warn("[webhook] resolvePaymentPlaceholders() — guest has no portal_token; stripped portal-link sentence rather than send a blank link.");
    }
    text = text.replace(/[^\n.!?]*\{\{\s*(?:PORTAL_LINK|portal_url)\s*\}\}[^\n.!?]*[.!?]?\s*/gi, "");
  }

  return text.trim();
}

// Hardcoded fallback — same convention as buildSpaSentence's fallback — used
// only if the stage_2_payment_reply bot_scripts row is missing/empty.
// hasButton controls whether the payment link is inlined as plain text or
// left out in favor of the real WhatsApp button sendStage2PayReply() sends
// alongside this text — the guest always gets ONE way to pay, never zero
// (graceful fallback, CLAUDE.md §CORE GUARDRAILS #2) and never the same link
// twice. The workshop link always stays inline, exactly as before.
function buildPaymentReply(vars: {
  guestName: string; paymentAmount: string; paymentLink: string; workshopUrl: string;
  spaTime: string | null; spaDate?: string | null; hasButton: boolean;
}): string {
  const workshopLine = vars.workshopUrl ? `\n\n🎯 *לסדנאות שלנו — הרשמו מראש:*\n👉 ${vars.workshopUrl}` : "";
  const paymentLine = vars.hasButton
    ? `לפני ההגעה, נשארה יתרת תשלום בסך ${vars.paymentAmount} ₪ להסדרה — לחצו על הכפתור למטה כדי להסדיר בקליק אחד.`
    : `לפני ההגעה, נשארה יתרת תשלום בסך ${vars.paymentAmount} ₪ להסדרה — ניתן לסגור את זה בקליק אחד כאן:\n👉 ${vars.paymentLink}`;
  return (
    `מגיעים! 🎉 כבר מתרגשים מאד מהגעתכם, ${vars.guestName}!\n\n` +
    `הצוות שלנו בדרים איילנד מכין את הכל ומחכה לכם עם חיוך גדול 🌴\n\n` +
    buildSpaSentence(vars.spaDate ?? null, vars.spaTime) +
    `\n\n${paymentLine}` +
    workshopLine +
    `\n\nיש לכם שאלות לפני ההגעה? אני כאן לכל שאלה 😊`
  );
}

// ── Automation Control Center — single-stage lookup, 5-min TTL cache ────────
// Used today only for stage_key="stage_2_pay" — checks whether an admin has
// toggled the auto-payment branch on/off, and (since the button feature)
// which interactive_buttons are configured. Generic by stageKey so a future
// event_immediate stage can reuse it without writing a new cache.
// AutomationStageRow / fetchAutomationStage — moved to
// _shared/guestInboundOrchestrator.ts. Imported above.

// Resolves the same {{PAYMENT_LINK}}/{{WORKSHOP_URL}} tokens inside a
// configured button's URL template — mirrors resolvePaymentPlaceholders()
// above but scoped to the one field a button needs.
function resolveButtonUrl(urlTemplate: string, vars: { paymentLink: string; workshopUrl: string }): string {
  return urlTemplate
    .replace(/\{\{\s*PAYMENT_LINK\s*\}\}/gi, vars.paymentLink)
    .replace(/\{\{\s*WORKSHOP_URL\s*\}\}/gi, vars.workshopUrl)
    .trim();
}

// ── Stage 2 Pay — single send path shared by the button-tap and typed-
// confirmation arrival-confirm branches below (previously two near-identical
// copies with drifted behavior — one checked `sim` before sending and logged
// failures to notification_log, the other didn't do either). Converged on
// the safer behavior from both. The payment link becomes a real WhatsApp
// button (Meta's cta_url interactive type) when automation_stages has a
// configured button whose URL template references {{PAYMENT_LINK}} —
// otherwise falls back to the original plain-text reply with the link
// inlined, so clearing the buttons in the Control Center can never leave a
// guest with no way to pay. The workshop link always stays inline, exactly
// as before this change.
async function sendStage2PayReply(
  supabaseClient: ReturnType<typeof createClient>,
  scripts: Record<string, BotScript>,
  stage2Pay: AutomationStageRow | null,
  phone: string,
  guestId: number | string | null,
  guest: Record<string, unknown> | null,
  sim: boolean,
  buttonTitle?: string,
): Promise<void> {
  if (resolveAutomationScope(guest) !== "full") {
    console.info(`[webhook] 💳 Stage 2 Pay skipped — automation_scope=${resolveAutomationScope(guest)} guest_id=${guestId ?? "?"}`);
    return;
  }
  if (guestId != null) {
    await refreshStaffClaimMuteFromDb(supabaseClient, guestId);
  }
  if (_suppressGuestRepliesStaffClaim || isStaffClaimMutingGuest(guest)) {
    console.info(`[webhook] 💳 Stage 2 Pay skipped — staff claim active guest_id=${guestId ?? "?"}`);
    return;
  }
  const payName        = String(guest?.name ?? "").trim() || "אורח יקר";
  const payWorkshopUrl = Deno.env.get("WORKSHOP_SIGNUP_URL") ?? "";
  const payAmount      = String(guest?.payment_amount ?? "");
  const { spaTime, spaDate } = spaVarsFromGuest(guest);
  const payPortalLink  = buildPortalLink(guest?.portal_token);
  const triggerType    = "stage_2_pay";
  // Whapi has no button entity — a Whapi-eligible guest (suite/day-pass,
  // GUEST_WHAPI_SUITES_ENABLED) always gets the payment link inlined as
  // plain text, never sendCtaUrlButton's Meta interactive button.
  const whapiEligiblePay = shouldRouteGuestOutboundViaWhapiSuites(
    guest as { room?: unknown; room_type?: unknown } | null,
  );

  if (guestId != null) {
    if (await isStage2PayAlreadyDispatched(supabaseClient, guestId, triggerType)) {
      console.info(`[webhook] 💳 Stage 2 Pay skipped — already dispatched guest_id=${guestId}`);
      return;
    }
    if (await isStage2PayInFlight(supabaseClient, guestId, triggerType)) {
      console.info(`[webhook] 💳 Stage 2 Pay skipped — dispatch in flight guest_id=${guestId}`);
      return;
    }
  }

  const linkGuard = await guardPaymentLink(
    supabaseClient,
    guest ?? {},
    guestId,
    { allowInlineRecovery: true },
  );

  if (!linkGuard.ok) {
    console.warn(
      `[webhook] 💳 Stage 2 Pay aborted — ${linkGuard.reason} phone:${phone}` +
      (linkGuard.recoveryQueued ? " (recovery queued)" : ""),
    );
    if (!sim) {
      await logPaymentLinkFailure(supabaseClient, guestId, phone, triggerType, {
        reason: linkGuard.reason,
        recoveryQueued: linkGuard.recoveryQueued,
        ...(buttonTitle ? { buttonTitle } : {}),
      });
    }
    return;
  }

  const payLink = linkGuard.url;

  const paymentButton = (stage2Pay?.interactive_buttons ?? []).find(
    (b) => b.type === "url" && !!b.url && /\{\{\s*PAYMENT_LINK\s*\}\}/i.test(b.url)
  );

  const payScript    = scripts["stage_2_payment_reply"];
  const paymentReply = payScript?.message_text?.trim()
    ? resolvePaymentPlaceholders(payScript.message_text, {
        guestName: payName, paymentAmount: payAmount, paymentLink: payLink, workshopUrl: payWorkshopUrl, spaTime,
        spaDate, portalLink: payPortalLink,
      })
    : buildPaymentReply({
        guestName: payName, paymentAmount: payAmount, paymentLink: payLink, workshopUrl: payWorkshopUrl,
        spaTime, spaDate, hasButton: !!paymentButton && !whapiEligiblePay,
      });

  console.info(`[webhook] 💳 arrival confirmed (payment-pending) — phone:${phone} name="${payName}" button:${!!paymentButton && !whapiEligiblePay} whapi:${whapiEligiblePay}`);

  if (sim) {
    console.info(`[webhook] SIM — would send Stage 2 Pay reply to ${phone}, would not actually send.`);
    return;
  }

  if (guestId != null) {
    await markStage2PayProcessing(supabaseClient, guestId, phone, triggerType);
  }

  // Single source of truth (FAIL VISIBLE fix, split-brain leak) — sanitizeReply()
  // is the same final chokepoint sendReply() applies to every other guest-facing
  // reply in this file; running it here too means whichever channel actually
  // dispatches (sendCtaUrlButton's own strip below, or sendReply's internal one)
  // and the whatsapp_conversations log below both read from this ONE resolved
  // string — never a raw pre-sanitize copy for one and a cleaned copy for the
  // other. Falls back to the raw text only in the extreme case sanitizeReply()
  // strips everything (never observed with real payment-reply content).
  const finalPaymentReply = sanitizeReply(paymentReply).trim() || paymentReply;

  try {
    let payWamid: string | null = null;
    if (whapiEligiblePay) {
      payWamid = await sendWhapiText(cleanPhoneForMention(phone), finalPaymentReply);
    } else if (paymentButton?.url) {
      if (_suppressGuestRepliesStaffClaim) {
        console.info(`[webhook] 💳 Stage 2 Pay CTA suppressed — staff claim active guest_id=${guestId ?? "?"}`);
        return;
      }
      const resolvedUrl = resolveButtonUrl(paymentButton.url, { paymentLink: payLink, workshopUrl: payWorkshopUrl });
      if (!resolvedUrl || resolvedUrl.includes("{{")) {
        throw new Error("payment_button_url_unresolved");
      }
      await sendCtaUrlButton(phone, finalPaymentReply, paymentButton.label, resolvedUrl);
    } else {
      await sendReply(phone, finalPaymentReply, { scripted: true });
    }
    if (_suppressGuestRepliesStaffClaim) {
      console.info(`[webhook] 💳 Stage 2 Pay outbound skipped — staff claim active guest_id=${guestId ?? "?"}`);
      return;
    }
    await insertGuestOutboundIfNotMuted(supabaseClient, {
      phone, guest_id: guestId as number | null, message: finalPaymentReply, wa_message_id: payWamid, intent: "stage_2_pay",
      channel: whapiEligiblePay ? "whapi" : "meta",
    });
    const { error: logErr } = await supabaseClient.from("notification_log").insert({
      guest_id: guestId, recipient: phone,
      trigger_type: triggerType, channel: "whatsapp",
      status: "sent",
      payload: { channel: whapiEligiblePay ? "whapi_session" : "session_message", paymentUrlValidated: true, ...(buttonTitle ? { buttonTitle } : {}) },
    });
    if (logErr) console.warn("[webhook] notification_log insert error:", logErr.message);
    console.info(`[webhook] ✅ payment reply sent to ${phone}`);
  } catch (e) {
    const errMsg = (e as Error).message;
    const replyStatus = errMsg.startsWith("timeout_no_response") ? "timeout" : "failed";
    console.error(`[webhook] ❌ payment reply ${replyStatus} to ${phone}:`, errMsg);
    try {
      const { error: logErr } = await supabaseClient.from("notification_log").insert({
        guest_id: guestId, recipient: phone,
        trigger_type: triggerType, channel: "whatsapp",
        status: replyStatus,
        payload: { error: errMsg || PAYMENT_LINK_FAILURE_LABEL, ...(buttonTitle ? { buttonTitle } : {}) },
      });
      if (logErr) console.warn("[webhook] notification_log insert error:", logErr.message);
    } catch (logEx) { console.warn("[webhook] notification_log insert error:", (logEx as Error).message); }
  }
}

// ── Stage 2 Arrival — single send path for button / typed / post-burst confirm ──
// Thin Meta-specific wrapper — the actual duplicate/eligibility/script/send
// orchestration lives once in _shared/guestInboundOrchestrator.ts
// (runGuestArrivalConfirmation), shared with whapi-webhook's guest DM
// handler. All 5 call sites of this function below are UNCHANGED.
async function handleStage2ArrivalConfirmation(
  supabaseClient: ReturnType<typeof createClient>,
  ctx: {
    scripts: Record<string, BotScript>;
    phone: string;
    guestId: number | null;
    guest: Record<string, unknown> | null;
    sim: boolean;
    source: "button" | "text" | "burst";
    buttonTitle?: string;
    claimedConversationId?: number | null;
    msgId?: string;
  },
): Promise<void> {
  const { scripts, guest, phone, guestId, sim, source, buttonTitle } = ctx;

  const result = await runGuestArrivalConfirmation(
    supabaseClient,
    {
      stage2ScriptText: scripts["stage_2_arrival"]?.message_text ?? null,
      phone: ctx.phone,
      guestId: ctx.guestId,
      guest: ctx.guest,
      sim: ctx.sim,
      source: ctx.source,
      buttonTitle: ctx.buttonTitle,
      claimedConversationId: ctx.claimedConversationId,
      msgId: ctx.msgId,
      channel: "meta",
    },
    {
      sendMessage: (p, body, useWhapi) =>
        useWhapi ? sendWhapiText(cleanPhoneForMention(p), body) : sendReply(p, body, { scripted: true }),
      insertOutboundIfNotMuted: (row) => insertGuestOutboundIfNotMuted(supabaseClient, row),
      dispatchFallbackPipeline: dispatchStage2ViaPipeline,
      withStaffMuteSuspended: async (fn) => {
        // Pipeline Stage 2 must deliver on guest confirm — staff-claim mute blocks
        // bot/LLM only, not this scheduled arrival reply (cron catch-up relies on
        // msg_stage_2_arrival_sent staying false when Meta send did not happen).
        const prevStaffMute = _suppressGuestRepliesStaffClaim;
        setSuppressGuestRepliesStaffClaim(false);
        try {
          return await fn();
        } finally {
          setSuppressGuestRepliesStaffClaim(prevStaffMute);
        }
      },
    },
  );

  if (!result.proceeded) return;

  const hasPendingPayment = !!(guest?.payment_amount);
  const stage2Pay = await fetchAutomationStage(supabaseClient, "stage_2_pay");
  if (hasPendingPayment && stage2Pay?.is_active === true) {
    await sendStage2PayReply(
      supabaseClient, scripts, stage2Pay, phone, guestId, guest, sim, buttonTitle,
    );
    console.info(`[webhook] ✅ arrival confirmed (${source}, payment follow-up) — phone:${phone}`);
  }
}

async function fetchBotConfig(
  supabaseClient: ReturnType<typeof createClient>
): Promise<Record<string, string>> {
  const now = Date.now();
  if (now - _cacheTime < CONFIG_TTL_MS && Object.keys(_configCache).length > 0) {
    return _configCache;
  }
  try {
    const { data, error } = await supabaseClient
      .from("bot_config")
      .select("config_key, config_value");
    if (error || !data?.length) {
      console.warn("[webhook] bot_config not available:", error?.message ?? "empty");
      return _configCache; // return stale cache rather than fail
    }
    const map: Record<string, string> = {};
    data.forEach((r: { config_key: string; config_value: string }) => {
      map[r.config_key] = r.config_value;
    });
    _configCache = map;
    _cacheTime   = now;
    return map;
  } catch (e) {
    console.warn("[webhook] fetchBotConfig error:", (e as Error).message);
    return _configCache;
  }
}

// resolveGuestModelRoute — assembleGuestBrainPrompt handles model routing internally.

function isUniqueViolation(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "23505" || /duplicate key|unique constraint/i.test(error.message ?? "");
}

/** Insert-first dedup claim — unique index on wa_message_id is the ledger of record. */
async function claimInboundWaMessage(
  supabase: ReturnType<typeof createClient>,
  row: {
    phone: string;
    guest_id: number | null;
    message: string;
    wa_message_id: string;
    push_name: string | null;
    intent?: string;
    human_requested?: boolean;
    human_request_type?: string | null;
    message_type?: string;
    media_url?: string | null;
    media_mime?: string | null;
    media_caption?: string | null;
  },
): Promise<{ claimed: boolean; conversationId: number | null }> {
  const { data, error } = await supabase
    .from("whatsapp_conversations")
    .insert({
      phone: row.phone,
      guest_id: row.guest_id,
      inbox_channel: "meta",
      direction: "inbound",
      message: row.message,
      wa_message_id: row.wa_message_id,
      intent: row.intent ?? "received",
      push_name: row.push_name,
      ...(row.message_type ? { message_type: row.message_type } : {}),
      ...(row.media_url ? { media_url: row.media_url } : {}),
      ...(row.media_mime ? { media_mime: row.media_mime } : {}),
      ...(row.media_caption ? { media_caption: row.media_caption } : {}),
      ...(row.human_requested ? { human_requested: true, human_request_type: row.human_request_type } : {}),
    })
    .select("id")
    .maybeSingle();

  if (error) {
    if (isUniqueViolation(error)) return { claimed: false, conversationId: null };
    console.error(
      "[webhook] claimInboundWaMessage failed:",
      error.code,
      error.message,
      error.details ?? "",
      error.hint ?? "",
    );
    // FAIL VISIBLE — do not continue the guest pipeline when the inbox ledger
    // row was never written (staff would see bot reply but empty Inbox thread).
    return { claimed: false, conversationId: null };
  }
  return { claimed: true, conversationId: (data?.id as number) ?? null };
}

// patchClaimedInbound — moved to _shared/guestInboundOrchestrator.ts. Imported above.

/** Leader of a rapid burst orchestrates one LLM reply; followers log only. */
async function coalesceBurstIfLeader(
  supabase: ReturnType<typeof createClient>,
  phone: string,
  msgId: string,
): Promise<{ proceed: boolean; coalescedText: string }> {
  await new Promise((r) => setTimeout(r, BURST_COALESCE_MS));

  const since = new Date(Date.now() - BURST_WINDOW_MS).toISOString();
  const { data: recentInbound } = await supabase
    .from("whatsapp_conversations")
    .select("message, wa_message_id, created_at")
    .eq("inbox_channel", "meta")
    .eq("phone", phone)
    .eq("direction", "inbound")
    .gte("created_at", since)
    .order("created_at", { ascending: true });

  const burst = (recentInbound ?? []) as Array<{ message: string; wa_message_id: string | null }>;
  if (burst.length === 0) return { proceed: true, coalescedText: "" };

  const leaderId = burst[0]?.wa_message_id;
  if (leaderId && leaderId !== msgId) {
    console.info(
      `[webhook] burst delegate skip — msg:${msgId.slice(-8)} leader:${leaderId.slice(-8)}`,
    );
    return { proceed: false, coalescedText: "" };
  }

  const coalescedText = burst.map((b) => b.message).filter(Boolean).join("\n");
  return { proceed: true, coalescedText };
}

function applyInRoomStatusOverride(
  supabase: ReturnType<typeof createClient>,
  guestId: number,
  phone: string,
): void {
  supabase
    .from("guests")
    .update({ status: "checked_in" })
    .eq("id", guestId)
    .then(({ error }: { error: { message: string } | null }) => {
      if (error) {
        console.error(`[webhook] in-room status override FAILED phone:${phone}:`, error.message);
      }
    });
}

// ══════════════════════════════════════════════════════════════════════════════
// §2  INTENT CLASSIFICATION — keyword-based, zero-latency routing
// ══════════════════════════════════════════════════════════════════════════════
type Intent = "complaint" | "upsell" | "faq" | "fallback";

/** Complaint = maintenance fault, service failure, waiting too long */
const COMPLAINT_PATTERNS: RegExp[] = [
  // Hebrew — infrastructure
  /מים\s*(חמים|קרים|בוילר)|אין\s*מים|מים\s*לא/i,
  /מיזוג|מזגן|קר\s*מדי|חם\s*מדי|אוורור|זיעה/i,
  /רעש|רועש|רעשני|מפריע|הפרעה|רעש\s*(מ)?השכנ/i,
  /שבור|מקולקל|לא\s*עובד|תקול|מקרטע|לא\s*מתפקד/i,
  /מלוכלך|לכלוך|זוהמה|ריח\s*(רע|לא\s*נעים|מוזר|מגעיל)|עובש/i,
  /דלף|נזילה|רטיבות|שיטפון|מים\s*על\s*הרצפה/i,
  /חשמל|תאורה|חשכה|אור\s*(לא|אין|כבה|כבוי)/i,
  /ממתין|מחכה|זמן\s*רב|הרבה\s*זמן|שעה\s*(ו|כבר|ומשהו)/i,
  /שירות\s*(גרוע|איטי|גרועה|נורא|נוראי)/i,
  /לא\s*(הגיע|קיבלתי|הובא|הביאו|סיפקו)/i,
  /תלונה|תלונות|מאוכזב|מאוכזבת|לא\s*מרוצה|לא\s*מרוצ/i,
  /בעיה|תקלה|בעיות|אי\s*נוחות|לא\s*נעים\s*לי/i,
  /חסר|חסרה|לא\s*תקין|לא\s*מסודר/i,
  // English
  /no\s*hot\s*water|cold\s*(shower|water)/i,
  /noisy|loud\s*(ac|noise|neighbor)|air\s*con(dition)?/i,
  /broken|not\s*work(ing)?|doesn'?t\s*work|out\s*of\s*order/i,
  /dirty|smells?\s*bad|odor|leak(ing)?|flood/i,
  /waiting\s*too\s*long|slow\s*service|been\s*waiting/i,
  /complaint|complain|problem|issue|horrible|disappointed|terrible/i,
];

/** Upsell = day-pass→overnight, room upgrade (NOT late checkout / extension — see sensitive stay shield) */
const UPSELL_PATTERNS: RegExp[] = [
  // Hebrew
  /ללון|לינה|לישון\s*(כאן|פה|איתכם)/i,
  /לשדרג|שדרוג|חדר\s*(יותר\s*)?(גדול|טוב|יוקרתי)|לעבור\s*(ל)?סוויטה/i,
  /בילוי\s*יומי.*לינ|day\s*pass.*stay/i,
  // English
  /stay\s*(over|the\s*night|overnight)/i,
  /upgrade(\s+my\s+room)?|better\s+room|larger\s+room|move\s+to\s+(a\s+)?suite/i,
];

// ── Guest Feedback & Sentiment Dashboard — holistic stay/service reflections ──
// Deliberately DISTINCT from COMPLAINT_PATTERNS above: those catch a specific
// service-fault report ("the AC is broken") that belongs on the operational
// Requests/Ops board. This catches a guest reflecting on the stay/experience
// as a whole ("the stay was amazing", "we'll definitely come back") — that is
// feedback/testimonial content, not an actionable fault, and clutters the ops
// board without ever needing staff dispatch. Narrow vocabulary on purpose —
// low overlap with maintenance-complaint wording keeps both classifiers clean.
const REFLECTION_GATE_PATTERN =
  /(ה)?שהות|(ה)?חופשה|(ה)?אירוח|(ה)?חוויה|(ה)?ביקור|(ה)?צוות\s*(היה|היו)|ממליצים|נחזור|(the\s*)?(stay|vacation|experience|visit)/i;

/** Excludes plain questions about the stay ("when does the stay start?") from the reflection gate. */
const REFLECTION_QUESTION_EXCLUSION = /^(?:מה|מתי|איך|למה|האם|כמה|איפה)\b/u;

const POSITIVE_REFLECTION_PATTERNS: RegExp[] = [
  /תודה\s*(רבה|ענקית|מהלב)?\s*על\s*(הכל|השהות|האירוח|החוויה|הכנסת\s*האורחים|הכנסת\s*אורחים)/i,
  /(ה)?שהות\s*(שלנו\s*)?(הייתה|היתה)\s*(מדהימה|נהדרת|מושלמת|מעולה|פנטסטית|חלומית|מושקעת)/i,
  /(ה)?(צוות|שירות)\s*(היה|היו)\s*(מדהים|נהדר|מעולה|מקצועי|אדיב|חם|קשוב)/i,
  /ממליצים\s*(בחום|לכולם|מאוד)?/i,
  /חוויה\s*(מדהימה|נהדרת|בלתי\s*נשכחת|מיוחדת)/i,
  /נחזור\s*(בוודאות|בשמחה|בהחלט)|בטוח\s*נחזור/i,
  /best\s*(hotel|stay|vacation|experience)|amazing\s*(stay|experience|service)|highly\s*recommend/i,
];

const NEGATIVE_REFLECTION_PATTERNS: RegExp[] = [
  /(ה)?שהות\s*(שלנו\s*)?(הייתה|היתה)\s*(מאכזבת|גרועה|לא\s*טובה|לא\s*מספקת|לא\s*ברמה)/i,
  /לא\s*(נחזור|נמליץ|נבוא\s*שוב)/i,
  /(ה)?(צוות|שירות)\s*(היה|היו)\s*(גרוע|לא\s*מקצועי|לא\s*אדיב|מזלזל)/i,
  /לא\s*היה\s*שווה\s*(את\s*)?ה(כסף|מחיר)/i,
  /worst\s*(stay|experience|hotel|vacation)|disappointing\s*(stay|experience)|would\s*not\s*recommend/i,
];

/**
 * Returns the sentiment of a holistic stay/service reflection, or null if the
 * message isn't one (a plain FAQ, an operational ask, small talk, etc.).
 * Severe complaints and every other Tier-0 intercept already ran and `continue`d
 * before this is ever reached — this only sees what's left.
 */
function classifyGuestReflection(text: string): "positive" | "negative" | "neutral" | null {
  const t = text.trim();
  if (t.length < 6 || t.endsWith("?") || REFLECTION_QUESTION_EXCLUSION.test(t)) return null;
  if (!REFLECTION_GATE_PATTERN.test(t)) return null;
  if (POSITIVE_REFLECTION_PATTERNS.some((p) => p.test(t))) return "positive";
  if (NEGATIVE_REFLECTION_PATTERNS.some((p) => p.test(t))) return "negative";
  return "neutral";
}

/** Deterministic ack only — never the LLM, same reasoning as every other Tier-0 shield reply. */
function buildReflectionReply(sentiment: "positive" | "negative" | "neutral"): string {
  if (sentiment === "positive") {
    const reviewUrl = GOOGLE_REVIEW_URL || "dream-island.co.il";
    return `איזה כיף לשמוע! 🌟 שמחים מאוד שנהניתם. אם תרצו לשתף את החוויה שלכם עם עוד אורחים — זה יעשה לנו את היום:\n${reviewUrl}\nתודה רבה ומחכים לראותכם שוב! 💫`;
  }
  if (sentiment === "negative") {
    return "תודה שסיפרתם לנו על כך. 🙏 אנחנו מצטערים שהיה חלק מהשהות שלא עמד בציפיות, והדברים חשובים לנו מאוד. הצוות שלנו יבחן את זה כדי שנשתפר.";
  }
  return "תודה רבה ששיתפתם אותנו! 🙏 נשמח תמיד לשמוע עוד על השהות שלכם.";
}

/** Non-blocking-safe insert into guest_feedback — never throws into the caller. */
async function saveGuestFeedback(
  supabase: ReturnType<typeof createClient>,
  opts: {
    guestId: number | null;
    phone: string;
    sentiment: "positive" | "negative" | "neutral";
    text: string;
    source: "freeform_reflection" | "post_stay_button" | "severe_complaint";
  },
): Promise<void> {
  const { error } = await supabase.from("guest_feedback").insert({
    guest_id:      opts.guestId,
    phone:         opts.phone,
    sentiment:     opts.sentiment,
    feedback_text: opts.text,
    source:        opts.source,
  });
  if (error) {
    console.error("[webhook] 📝 guest_feedback insert FAILED:", error.message);
  }
}

function classifyIntent(text: string): Intent {
  if (isSensitiveStayChangeRequest(text)) return "fallback"; // shield handles reply — never upsell/LLM enthusiasm
  if (isSensitiveFinancialRequest(text))  return "fallback"; // shield handles reply — never LLM/upsell on billing disputes
  if (COMPLAINT_PATTERNS.some((p) => p.test(text))) return "complaint";
  if (UPSELL_PATTERNS.some((p) => p.test(text)))    return "upsell";
  if (text.trim().length >= 3)                       return "faq";
  return "fallback";
}

// Human-agent request detection → _shared/guestBotHandoff.ts
// (detectGuestHumanRequest + buildGuestHumanRequestReply) — same brain as Whapi.

// DATE_CHANGE_RE / RECORD_ONLY_ARRIVAL_REPLY / isRecordOnlyArrivalTimeUpdate —
// moved to _shared/guestInboundOrchestrator.ts so whapi-webhook shares the
// exact same record-only ETA classifier. All three imported above (2026-07-10
// P0: DATE_CHANGE_RE was defined there but never exported/imported here,
// throwing ReferenceError on every non-intercepted inbound message — fixed by
// exporting it and adding it to the import list).
// ARRIVAL_TIME_QUESTION_RE / ARRIVAL_TIME_UPDATE_RE remain private to that
// module (used only inside isRecordOnlyArrivalTimeUpdate there) — NOT
// imported here, not referenced anywhere in this file.

// ── Critical-event safety net (Phase 2 request-handling) ────────────────────
// Deterministic backstop for the "faq" branch when the model skips log_guest_request
// on critical human/price/manager keywords — see criticalKeywordHit below (allowlist-gated).

// ══════════════════════════════════════════════════════════════════════════════
// §3  PRE-WRITTEN REPLIES — deterministic, instant, always correct Hebrew
// ══════════════════════════════════════════════════════════════════════════════
const FALLBACK_REPLY =
  "תודה רבה על פנייתך. 🙏 " +
  "אני אעביר אותה לצוות הקבלה שלנו, שישמח לסייע לך בהקדם האפשרי.";

const DEFAULT_GREETING_REPLY =
  "שלום! 😊 ברוכים הבאים לדרים איילנד. במה אוכל לעזור לכם היום?";

function buildGreetingReply(guestName: string | null, scriptText: string | null): string {
  const base = scriptText?.trim() || DEFAULT_GREETING_REPLY;
  return resolvePlaceholders(base, {
    guestName: guestName ?? "אורח יקר",
    spaTime: null,
    workshopUrl: "",
  });
}

function buildComplaintReply(guestName: string | null): string {
  const salutation = guestName ? `${guestName} היקר/ה, ` : "";
  return (
    `${salutation}אנו מתנצלים בכנות על אי הנוחות שנגרמה לך. ` +
    `אני מעדכן מיד את מנהל המשמרת כדי שיטפל בזה עבורכם. ` +
    `נחזור אליך בהקדם האפשרי.`
  );
}

function buildUpsellReply(guestName: string | null): string {
  const salutation = guestName ? `${guestName} היקר/ה, ` : "";
  return (
    `${salutation}שמחים לשמוע שאתם נהנים מהשהות! 🌟 ` +
    `שדרוגים, הארכת שהות ו-late check-out זמינים בכפוף לתפוסה הנוכחית. ` +
    `האם תרצו שנציג מהצוות שלנו יצור איתכם קשר לתיאום אישי?`
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// §4  DB ALERT — fires on every complaint, non-blocking
// ══════════════════════════════════════════════════════════════════════════════
async function flagGuestAlert(
  supabase: ReturnType<typeof createClient>,
  phone: string,
  guestId: number | null,
  originalMessage: string,
  conversationId: number | null,
): Promise<void> {
  // a) Insert alert row — visible immediately on staff dashboard
  const { error: insertErr } = await supabase.from("guest_alerts").insert({
    guest_id:        guestId,
    phone,
    alert_type:      "complaint",
    message:         originalMessage,
    conversation_id: conversationId,
    resolved:        false,
  });
  if (insertErr) {
    console.error("[webhook] guest_alerts insert error:", insertErr.message);
    return;
  }

  // b) If guest is registered → flip requires_attention flag for dashboard badge
  if (guestId) {
    const { error: updateErr } = await supabase
      .from("guests")
      .update({
        requires_attention:       true,
        requires_attention_since: new Date().toISOString(),
      })
      .eq("id", guestId);
    if (updateErr) {
      console.error("[webhook] guests update error:", updateErr.message);
    }
  }

  // c) Global Red Alert + Whapi requests group — every Requests Board row.
  onGuestAlertInserted(supabase, {
    phone,
    guestId,
    conversationId,
    message: originalMessage,
    alertType: "complaint",
    sourceLabel: "WhatsApp Bot",
  }).catch((e: Error) =>
    console.warn("[webhook] flagGuestAlert staff notify failed:", e.message),
  );

  console.info(
    `[webhook] 🚨 ALERT — phone:${phone} guest:${guestId ?? "unknown"} conv:${conversationId ?? "?"}`
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// §4b  DUAL-ROUTING TRIGGER — Session 26 Sprint 3.1. Bridges a guest's
//      log_guest_request tool call straight into the staff ops Whapi group
//      (the same `tasks` table + group the Ops & Maintenance Board already
//      uses, CLAUDE.md §0.4 Universal Architecture — not a parallel ticket
//      system). guest_alerts (flagGuestAlert's sibling insert at the call
//      site) keeps logging every request to the dashboard regardless; this
//      is purely an ADDITIONAL fast-path for suite guests so staff see it
//      in WhatsApp without anyone opening the dashboard.
//
//      Suite-Only Profile Filter: day-guest ("בילוי יומי") and standard-room
//      requests never call this — they stay dashboard-only by design (the
//      ops group is a 24/7-reachable real-time channel; flooding it with
//      every day-pass ask would erode its signal for the genuinely time-
//      sensitive suite-guest case this exists for).
//
//      Non-blocking / best-effort: a Whapi failure here must never affect
//      the guest's own reply (already sent by the time this runs) or the
//      guest_alerts dashboard row (already inserted independently).
// ══════════════════════════════════════════════════════════════════════════════
// Human-in-the-Loop approval gate (2026-07-07): guest-initiated physical
// requests only ever create a pending_approval task; the bot has no
// authority to dispatch this route unsupervised. A staff member reviews
// (and can edit) the description in OperationsBoard.js and taps "✅ אשר ושגר"
// (Approve & Dispatch), which invokes the extended notify-manual-task Edge
// Function — that is the ONLY place translation + the actual Whapi send now
// happen for this source. The actual insert (room resolution, department/SLA
// classification, duplicate guard) lives in the shared
// _shared/createGuestOpsTask.ts — Meta, Whapi guest DM, and the Guest Portal
// all call that one helper so every surface produces an identical task row.

// logAdministrativeRequestAlert → _shared/guestBalloonAdminIntercept.ts

// ══════════════════════════════════════════════════════════════════════════════
// §4a  DEFENSIVE SHIELD — Layer 2.1: emoji/courtesy-only pass. A message that
//      is nothing but an emoji ("👍", "🙏🏼") or a one-word courtesy closer
//      ("תודה", "אוקי", "סגור") carries zero routing intent — sending the
//      fallback/apology script on these makes the bot look robotic and
//      spammy. Conversation metadata is still logged, but NO reply goes out —
//      silence is the correct human reaction to "thanks 🙏" AFTER the bot already
//      spoke — never on a thread opener (see guestThreadHasPriorOutbound).
//      Greetings (היי/שלום) are handled by handleGuestGreeting() instead.
//      Runs before every other Tier-0 classifier and before the LLM — zero token cost.
// ══════════════════════════════════════════════════════════════════════════════
/** True when the guest already received at least one outbound in this phone thread. */
async function guestThreadHasPriorOutbound(
  supabase: ReturnType<typeof createClient>,
  phone: string,
): Promise<boolean> {
  const { count, error } = await supabase
    .from("whatsapp_conversations")
    .select("id", { count: "exact", head: true })
    .in("inbox_channel", ["meta", "whapi"])
    .eq("phone", phone)
    .eq("direction", "outbound")
    .not("message", "like", "[SYSTEM]%");
  if (error) {
    console.warn("[webhook] guestThreadHasPriorOutbound failed:", error.message);
    return false;
  }
  return (count ?? 0) > 0;
}

async function handleGuestGreeting(
  supabase: ReturnType<typeof createClient>,
  opts: {
    phone: string;
    guestId: number | null;
    guestName: string | null;
    msgId: string;
    claimedConversationId: number | null;
    sim: boolean;
    scripts: Record<string, BotScript>;
  },
): Promise<void> {
  const { phone, guestId, guestName, msgId, claimedConversationId, sim, scripts } = opts;
  const reply = buildGreetingReply(
    guestName,
    scripts["greeting_reply"]?.message_text ?? null,
  );
  await patchClaimedInbound(supabase, claimedConversationId, msgId, {
    guest_id: guestId,
    intent: "greeting",
  });
  if (!sim) {
    try {
      await sendReply(phone, reply, { scripted: true });
      await insertGuestOutboundIfNotMuted(supabase, {
        phone,
        guest_id: guestId,
        message: reply,
        wa_message_id: null,
        intent: "greeting",
      });
    } catch (e) {
      console.error("[webhook] greeting reply failed:", (e as Error).message);
    }
  } else {
    console.info(`[webhook] SIM — greeting to ${phone}`);
  }
  console.info(`[webhook] 👋 greeting (Tier-0) — phone:${phone}`);
}

async function handleCourtesyAck(
  supabase: ReturnType<typeof createClient>,
  opts: {
    phone: string;
    guestId: number | null;
    msgId: string;
    claimedConversationId: number | null;
  },
): Promise<void> {
  const { phone, guestId, msgId, claimedConversationId } = opts;
  await patchClaimedInbound(supabase, claimedConversationId, msgId, {
    guest_id: guestId,
    intent: "courtesy_ack",
  });
  console.info(`[webhook] 🤫 courtesy/emoji-only message — silent exit, no fallback sent — phone:${phone}`);
}

// Guest's own WhatsApp Business away-message auto-reply (see
// isAutoAwayMessage doc-comment) — logged for staff visibility with a
// distinct intent, never answered by the LLM. Same silent-exit contract as
// handleCourtesyAck.
async function handleAutoAwayMessage(
  supabase: ReturnType<typeof createClient>,
  opts: {
    phone: string;
    guestId: number | null;
    msgId: string;
    claimedConversationId: number | null;
  },
): Promise<void> {
  const { phone, guestId, msgId, claimedConversationId } = opts;
  await patchClaimedInbound(supabase, claimedConversationId, msgId, {
    guest_id: guestId,
    intent: "auto_away_message",
  });
  console.info(`[webhook] 🤖 guest's own away-message auto-reply detected — silent exit, no LLM — phone:${phone}`);
}

/** Tier-0 — check-in / entry policy FAQ. Zero LLM tokens; complete hours from bot_config. */
async function handleCheckInPolicyFaq(
  supabase: ReturnType<typeof createClient>,
  opts: {
    phone: string;
    guestId: number | null;
    guest: Record<string, unknown> | null;
    msgId: string;
    claimedConversationId: number | null;
    sim: boolean;
    cfg: Record<string, string>;
  },
): Promise<void> {
  const { phone, guestId, guest, msgId, claimedConversationId, sim, cfg } = opts;
  const reply = buildCheckInPolicyReply(cfg, (guest?.arrival_date as string) ?? null);
  await patchClaimedInbound(supabase, claimedConversationId, msgId, {
    guest_id: guestId,
    intent: "check_in_policy_faq",
  });
  if (!sim) {
    try {
      await sendReply(phone, reply, { scripted: true });
      await insertGuestOutboundIfNotMuted(supabase, {
        phone, guest_id: guestId, message: reply, wa_message_id: null, intent: "check_in_policy_faq",
      });
    } catch (e) {
      console.error("[webhook] check_in_policy_faq reply failed:", (e as Error).message);
    }
  } else {
    console.info(`[webhook] SIM — check_in_policy_faq to ${phone}`);
  }
  console.info(`[webhook] ✅ check-in policy FAQ (Tier-0) — phone:${phone}`);
}

// ══════════════════════════════════════════════════════════════════════════════
// §4b.1  IMMEDIATE OPERATIONAL ROUTING — Tier-0 keyword intercept for guests
//        already checked_in. Runs after wa_message_id dedup, before burst/LLM.
//        No LLM — deterministic luxury dispatch reply + tasks + guest flags.
// ══════════════════════════════════════════════════════════════════════════════
async function handleOperationalInHouseIntercept(
  supabase: ReturnType<typeof createClient>,
  opts: {
    phone: string;
    guestId: number;
    guest: Record<string, unknown>;
    text: string;
    msgId: string;
    claimedConversationId: number | null;
    sim: boolean;
  },
): Promise<void> {
  const { phone, guestId, guest, text, msgId, claimedConversationId, sim } = opts;
  // text can be burst-coalesced (multiple guest messages within a 5s window,
  // see coalesceBurstIfLeader) — buildOperationalRequestSummary intentionally
  // still scores the full blob (drives the guest-facing reply + internal
  // attention_reason, a separate concern from the ops-group card). dispatchText
  // isolates just the line(s) that independently pass the allowlist, so an
  // unrelated adjacent message never dominates/confuses the translated Whapi
  // card (root cause of the "אמרו לנו שאפשר ב-11" false-positive incident).
  const summary = buildOperationalRequestSummary(text);
  const dispatchText = extractAllowlistedRequestLines(text);
  const guestName = (guest.name as string | null) ?? null;
  const guestRoom = (guest.room as string | null) ?? null;
  const reply = buildOperationalDispatchReply(summary, guestName);

  // human_requested/human_request_type also flag the SAME inbound row so
  // WhatsAppInbox.js's red "🔴 מבקש מענה אנושי" dot lights up here too — this
  // path only ever reached guests.requires_attention (a different badge, on
  // GuestsPage/GuestDashboard) and the Ops Board's own pending_approval queue,
  // never the Inbox's per-message flag, unlike every guest_alerts-based Tier-0
  // shield (severe complaint / stay-change / financial / balloon / admin) which
  // already gets it for free via onGuestAlertInserted→triggerInboxRedAlert.
  await patchClaimedInbound(supabase, claimedConversationId, msgId, {
    guest_id: guestId,
    intent: "operational_in_house_request",
    human_requested: true,
    human_request_type: "operational_request",
  });

  const { error: guestErr } = await supabase.from("guests").update({
    requires_attention:       true,
    requires_attention_since: new Date().toISOString(),
    attention_reason:         summary,
  }).eq("id", guestId);
  if (guestErr) {
    console.error("[webhook] 🛎️ operational intercept guest update FAILED:", guestErr.message);
  }

  // Operations Board (tasks) — pending_approval, same path as log_guest_request.
  // Awaits staff review/Approve in OperationsBoard.js before any Whapi dispatch.
  createGuestOpsTask({
    supabase,
    guestId,
    phone,
    guestName,
    room: guestRoom,
    summary,
    rawText: text,
    dispatchText,
  }).catch((e: Error) =>
    console.error("[webhook] 🛎️ operational intercept createGuestOpsTask error:", e.message)
  );

  if (!sim) {
    try {
      await sendReply(phone, reply, { scripted: true });
      await insertGuestOutboundIfNotMuted(supabase, {
        phone,
        guest_id:      guestId,
        message:       reply,
        wa_message_id: null,
        intent:        "operational_in_house_request",
      });
    } catch (e) {
      console.error("[webhook] 🛎️ operational intercept reply failed:", (e as Error).message);
    }
  } else {
    console.info(`[webhook] SIM — operational in-house intercept from ${phone}: ${summary}`);
  }

  console.info(
    `[webhook] 🛎️ operational in-house intercept — dispatch=operational_field_ops phone:${phone} guest:${guestId} summary:${summary}`,
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// §4b.1c DEPARTURE / PORTER ASSIST — checkout+luggage help, Tier-0, before LLM.
//        Distinct from the sensitive stay-change shield (late checkout /
//        extension): this guest IS leaving on schedule and needs someone to
//        carry bags to reception — an Ops Board task, same path as towels/AC
//        (session 2026-07-11 hallucination incident: this used to fall
//        through to the LLM, which invented a "towels & robe" ack from stale
//        history instead of routing the actual luggage request).
// ══════════════════════════════════════════════════════════════════════════════
async function handleDepartureAssistIntercept(
  supabase: ReturnType<typeof createClient>,
  opts: {
    phone: string;
    guestId: number;
    guest: Record<string, unknown>;
    text: string;
    msgId: string;
    claimedConversationId: number | null;
    sim: boolean;
  },
): Promise<void> {
  const { phone, guestId, guest, text, msgId, claimedConversationId, sim } = opts;
  const summary = buildDepartureAssistSummary(text);
  const guestName = (guest.name as string | null) ?? null;
  const guestRoom = (guest.room as string | null) ?? null;
  const reply = buildDepartureAssistReply(guestName);

  await patchClaimedInbound(supabase, claimedConversationId, msgId, {
    guest_id: guestId,
    intent: "departure_assist_request",
    human_requested: true,
    human_request_type: "operational_request",
  });

  const { error: guestErr } = await supabase.from("guests").update({
    requires_attention:       true,
    requires_attention_since: new Date().toISOString(),
    attention_reason:         summary,
  }).eq("id", guestId);
  if (guestErr) {
    console.error("[webhook] 🧳 departure assist intercept guest update FAILED:", guestErr.message);
  }

  // Operations Board (tasks) — pending_approval, same path as the operational
  // in-house intercept. Awaits staff review/Approve in OperationsBoard.js.
  createGuestOpsTask({
    supabase,
    guestId,
    phone,
    guestName,
    room: guestRoom,
    summary,
    rawText: text,
  }).catch((e: Error) =>
    console.error("[webhook] 🧳 departure assist intercept createGuestOpsTask error:", e.message)
  );

  if (!sim) {
    try {
      await sendReply(phone, reply, { scripted: true });
      await insertGuestOutboundIfNotMuted(supabase, {
        phone,
        guest_id:      guestId,
        message:       reply,
        wa_message_id: null,
        intent:        "departure_assist_request",
      });
    } catch (e) {
      console.error("[webhook] 🧳 departure assist intercept reply failed:", (e as Error).message);
    }
  } else {
    console.info(`[webhook] SIM — departure assist intercept from ${phone}: ${summary}`);
  }

  console.info(
    `[webhook] 🧳 departure assist intercept — dispatch=operational_field_ops phone:${phone} guest:${guestId} summary:${summary}`,
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// §4b.1b BALLOON + ADMIN — _shared/guestBalloonAdminIntercept.ts (Meta + Whapi)

// ══════════════════════════════════════════════════════════════════════════════
// §4b.1b SEVERE COMPLAINT KILL-SWITCH — guest is furious / reports serious
//        damage. The LLM is never allowed to free-text a response here — the
//        guest gets the fixed "תשובה לתלונה" (complaint_reply) BotScriptEditor
//        template (same copy as an ordinary complaint), sent deterministically,
//        while a manager is flagged in parallel. Checked before every other
//        Tier-0 classifier so anger never gets routed into date-change/
//        upsell/generic-complaint copy instead.
// ══════════════════════════════════════════════════════════════════════════════
async function handleSevereComplaintKillSwitch(
  supabase: ReturnType<typeof createClient>,
  opts: {
    phone: string;
    guestId: number | null;
    guestName: string | null;
    scripts: Record<string, BotScript>;
    text: string;
    msgId: string;
    claimedConversationId: number | null;
    sim: boolean;
  },
): Promise<void> {
  const { phone, guestId, guestName, scripts, text, msgId, claimedConversationId, sim } = opts;

  await patchClaimedInbound(supabase, claimedConversationId, msgId, {
    guest_id: guestId,
    intent: "severe_complaint",
  });

  if (guestId) {
    const { error: guestErr } = await supabase.from("guests").update({
      requires_attention:       true,
      requires_attention_since: new Date().toISOString(),
      needs_callback:           true,
      attention_reason:         "severe_complaint",
    }).eq("id", guestId);
    if (guestErr) {
      console.error("[webhook] 🚨 severe_complaint guest update FAILED:", guestErr.message);
    }
  }

  const { error: alertErr } = await supabase.from("guest_alerts").insert({
    guest_id:        guestId,
    phone,
    alert_type:      "severe_complaint",
    message:         text,
    conversation_id: claimedConversationId,
    resolved:        false,
  });
  if (alertErr) {
    console.error("[webhook] 🚨 severe_complaint guest_alerts insert FAILED:", alertErr.message);
    return;
  }

  onGuestAlertInserted(supabase, {
    guestId,
    phone,
    conversationId: claimedConversationId,
    message: text,
    alertType: "severe_complaint",
    guestName,
    sourceLabel: "WhatsApp Bot",
  }).catch((e: Error) => console.warn("[webhook] 🚨 severe_complaint staff notify failed:", e.message));

  // Existing rules unchanged (requires_attention + guest_alerts above) — this
  // ALSO logs to the Guest Feedback & Sentiment Dashboard as negative, per
  // explicit product requirement: a severe complaint is both an urgent staff
  // alert AND a sentiment record.
  await saveGuestFeedback(supabase, {
    guestId, phone, sentiment: "negative", text, source: "severe_complaint",
  });

  // Deterministic template only — never the LLM. Same source as the regular
  // "complaint" intent branch (BotScriptEditor's complaint_reply, editable by
  // staff), so there is exactly one place that owns this copy.
  const complaintScript = scripts["complaint_reply"];
  const templateReply = complaintScript?.message_text?.trim()
    ? resolvePlaceholders(complaintScript.message_text, {
        guestName: guestName ?? "אורח יקר", spaTime: null, workshopUrl: "",
      })
    : buildComplaintReply(guestName);

  if (!sim) {
    try {
      await sendReply(phone, templateReply, { scripted: true });
      await insertGuestOutboundIfNotMuted(supabase, {
        phone,
        guest_id:      guestId,
        message:       templateReply,
        wa_message_id: null,
        intent:        "severe_complaint",
      });
    } catch (e) {
      console.error("[webhook] 🚨 severe_complaint reply failed:", (e as Error).message);
    }
  }

  console.info(
    `[webhook] 🚨 SEVERE_COMPLAINT kill-switch — canned template sent, manager flagged — phone:${phone} guest:${guestId ?? "unknown"} text:"${text.slice(0, 80)}"`,
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// §4b.2  SENSITIVE STAY-CHANGE SHIELD — late checkout / extension / early
//        check-in / room change. Never imply approval; canonical staff handoff.
// ══════════════════════════════════════════════════════════════════════════════
async function handleSensitiveStayChangeHandoff(
  supabase: ReturnType<typeof createClient>,
  opts: {
    phone: string;
    guestId: number | null;
    guestRoom?: string | null;
    text: string;
    msgId: string;
    claimedConversationId: number | null;
    sim: boolean;
    auditSource: string;
  },
): Promise<void> {
  const { phone, guestId, guestRoom, text, msgId, claimedConversationId, sim, auditSource } = opts;

  await patchClaimedInbound(supabase, claimedConversationId, msgId, {
    guest_id: guestId,
    intent: "sensitive_stay_change_request",
    human_requested: true,
    human_request_type: "date_change",
  });

  if (guestId) {
    const { error: guestErr } = await supabase.from("guests").update({
      requires_attention:       true,
      requires_attention_since: new Date().toISOString(),
      needs_callback:           true,
      attention_reason:         "date_change",
    }).eq("id", guestId);
    if (guestErr) {
      console.error("[webhook] 🛡️ sensitive_stay_change guest update FAILED:", guestErr.message);
    }
  }

  (async () => {
    const { error } = await supabase.from("guest_alerts").insert({
      guest_id: guestId,
      phone,
      alert_type: "date_change_request",
      message: text,
      conversation_id: claimedConversationId,
      resolved: false,
    });
    if (error) {
      console.warn("[webhook] guest_alerts (sensitive_stay_change) error:", error.message);
      return;
    }
    onGuestAlertInserted(supabase, {
      guestId,
      phone,
      conversationId: claimedConversationId,
      message: text,
      alertType: "date_change_request",
      room: guestRoom ?? null,
      sourceLabel: "WhatsApp Bot",
    }).catch((e: Error) => console.warn("[webhook] stay_change staff notify failed:", e.message));
  })().catch((e: Error) =>
    console.warn("[webhook] guest_alerts (sensitive_stay_change) error:", e.message)
  );

  if (!sim) {
    try {
      await sendReply(phone, CANONICAL_STAY_CHANGE_HANDOFF_MSG, { scripted: true });
      await insertGuestOutboundIfNotMuted(supabase, {
        phone,
        guest_id:      guestId,
        message:       CANONICAL_STAY_CHANGE_HANDOFF_MSG,
        wa_message_id: null,
        intent:        "sensitive_stay_change_request",
      });
    } catch (e) {
      console.error("[webhook] 🛡️ sensitive_stay_change reply failed:", (e as Error).message);
    }
  }

  console.info(
    `[webhook] 🛡️ SENSITIVE_STAY_CHANGE mitigation — source:${auditSource} phone:${phone} guest:${guestId ?? "unknown"} text:"${text.slice(0, 80)}"`,
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// §4b.2b SENSITIVE FINANCIAL SHIELD — billing dispute, double charge, refund
//        ask. Same "never imply approval" reasoning as the stay-change shield
//        above, but routed/worded separately: this is a money question, not a
//        suite-team question, so it must not name the suite team or promise a
//        specific resolution. Neutral handoff only, staff verifies the charge.
// ══════════════════════════════════════════════════════════════════════════════
async function handleSensitiveFinancialHandoff(
  supabase: ReturnType<typeof createClient>,
  opts: {
    phone: string;
    guestId: number | null;
    guestRoom?: string | null;
    text: string;
    msgId: string;
    claimedConversationId: number | null;
    sim: boolean;
    auditSource: string;
  },
): Promise<void> {
  const { phone, guestId, guestRoom, text, msgId, claimedConversationId, sim, auditSource } = opts;

  await patchClaimedInbound(supabase, claimedConversationId, msgId, {
    guest_id: guestId,
    intent: "sensitive_financial_request",
    human_requested: true,
    human_request_type: "financial_issue",
  });

  if (guestId) {
    const { error: guestErr } = await supabase.from("guests").update({
      requires_attention:       true,
      requires_attention_since: new Date().toISOString(),
      needs_callback:           true,
      attention_reason:         "financial_issue",
    }).eq("id", guestId);
    if (guestErr) {
      console.error("[webhook] 💳 sensitive_financial guest update FAILED:", guestErr.message);
    }
  }

  (async () => {
    const { error } = await supabase.from("guest_alerts").insert({
      guest_id: guestId,
      phone,
      alert_type: "financial_issue",
      message: text,
      conversation_id: claimedConversationId,
      resolved: false,
    });
    if (error) {
      console.warn("[webhook] guest_alerts (sensitive_financial) error:", error.message);
      return;
    }
    onGuestAlertInserted(supabase, {
      guestId,
      phone,
      conversationId: claimedConversationId,
      message: text,
      alertType: "financial_issue",
      room: guestRoom ?? null,
      sourceLabel: "WhatsApp Bot",
    }).catch((e: Error) => console.warn("[webhook] financial staff notify failed:", e.message));
  })().catch((e: Error) =>
    console.warn("[webhook] guest_alerts (sensitive_financial) error:", e.message)
  );

  if (!sim) {
    try {
      await sendReply(phone, CANONICAL_FINANCIAL_HANDOFF_MSG, { scripted: true });
      await insertGuestOutboundIfNotMuted(supabase, {
        phone,
        guest_id:      guestId,
        message:       CANONICAL_FINANCIAL_HANDOFF_MSG,
        wa_message_id: null,
        intent:        "sensitive_financial_request",
      });
    } catch (e) {
      console.error("[webhook] 💳 sensitive_financial reply failed:", (e as Error).message);
    }
  }

  console.info(
    `[webhook] 💳 SENSITIVE_FINANCIAL mitigation — source:${auditSource} phone:${phone} guest:${guestId ?? "unknown"} text:"${text.slice(0, 80)}"`,
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// §4c DAY-GUEST UPSELL GATE — Session 27 Sprint 4.3. "Premium Suite" maps onto
//      the two real Premium Day inventory slots (guests.room IN 'Premium Day 1'
//      / 'Premium Day 2' — AddGuestModal/ArrivalImportPanel's day-package
//      values). It's the only "Premium ___" concept that actually exists in
//      this schema — there is no literal "Premium Suite" row in
//      src/data/suiteRegistry.js's 26 physical suites. Fails closed (treats a
//      lookup error as "taken") — never oversell a slot the system isn't sure
//      is free.
// ══════════════════════════════════════════════════════════════════════════════
async function isPremiumDaySlotAvailableToday(supabase: ReturnType<typeof createClient>): Promise<boolean> {
  const today = new Date().toISOString().split("T")[0];
  const { data, error } = await supabase
    .from("guests")
    .select("room")
    .eq("arrival_date", today)
    .neq("status", "cancelled")
    .in("room", ["Premium Day 1", "Premium Day 2"]);
  if (error) {
    console.warn("[webhook] isPremiumDaySlotAvailableToday lookup failed — defaulting to 'taken' (fail-closed):", error.message);
    return false;
  }
  const takenSlots = new Set((data ?? []).map((g) => g.room as string));
  return takenSlots.size < 2;
}


// ══════════════════════════════════════════════════════════════════════════════
// §5b PRE-ARRIVAL CONFIRMATION — detect "כן" reply, send payment + workshop
// ══════════════════════════════════════════════════════════════════════════════

/** Matches affirmative replies to the pre-arrival confirmation request.
 *  Handles typed variants: "כן", "כן מגיעים", "מגיעים!", "אנחנו מגיעים", etc.
 *  ⚠️ Deliberately EXCLUDES generic courtesy/acknowledgement words ("בסדר", "ok",
 *  "מצוין", "נראה מצוין", bare "1") — those were removed after a production bug
 *  where a pre-arrival guest replying "בסדר"/"מצוין" to an UNRELATED message
 *  (e.g. a spa/portal note) was misread as arrival confirmation and triggered
 *  the arrival-confirmed reply (which mentions spa_time). Those words are
 *  exactly the vocabulary of COURTESY_ONLY_PATTERN (_shared/automationSchedule.ts)
 *  — see also the reordered Defensive Shield check below, which now runs
 *  BEFORE this block so any future overlap fails safe (silence) instead of
 *  fails loud (a misdirected confirmation reply).
 */
// canGuestConfirmArrival — moved to _shared/guestInboundOrchestrator.ts. Imported above.

/** Early intercept — runs before auto-checkin / staff-mute can skew routing. */
async function tryArrivalConfirmationIntercept(
  supabaseClient: ReturnType<typeof createClient>,
  ctx: {
    scripts: Record<string, BotScript>;
    phone: string;
    guestId: number | null;
    guest: Record<string, unknown> | null;
    sim: boolean;
    isButtonReply: boolean;
    buttonTitle: string;
    buttonId: string;
    text: string;
    claimedConversationId: number | null;
    msgId: string;
    lane: "early" | "text" | "burst" | "button";
  },
): Promise<boolean> {
  const isConfirm = ctx.isButtonReply
    ? isArrivalConfirmationMessage(ctx.buttonTitle, { buttonTitle: ctx.buttonTitle, buttonId: ctx.buttonId })
    : isArrivalConfirmationMessage(ctx.text);
  if (!isConfirm || !canGuestConfirmArrival(ctx.guest)) return false;

  await handleStage2ArrivalConfirmation(supabaseClient, {
    scripts: ctx.scripts,
    phone: ctx.phone,
    guestId: ctx.guestId,
    guest: ctx.guest,
    sim: ctx.sim,
    source: ctx.isButtonReply ? "button" : (ctx.lane === "burst" ? "burst" : "text"),
    buttonTitle: ctx.isButtonReply ? ctx.buttonTitle : undefined,
    claimedConversationId: ctx.claimedConversationId,
    msgId: ctx.msgId,
  });
  console.info(`[webhook] ✅ arrival confirmed (${ctx.lane}) — phone:${ctx.phone} guest:${ctx.guestId}`);
  return true;
}

const GOOGLE_REVIEW_URL   = Deno.env.get("GOOGLE_REVIEW_URL")   ?? "";

// Same number as task-action.ts's ACTOR_PHONES.Adir, whapi-webhook's reverse
// lookup map, and guest-portal-ops-request's ADIR_PHONE — duplicated, not
// imported (Deno functions don't share modules across function boundaries
// in this repo).
const ADIR_PERSONAL_PHONE = "972546294885";

// Pre-Arrival Guest Portal magic-link (migration 083, session 35) — base URL
// for {{PORTAL_LINK}} below. Defaults to the documented live Vercel URL
// (CLAUDE.md §1) so this works with zero secret configuration; override via
// PORTAL_BASE_URL if the deployment URL ever changes.
// buildPortalLink moved to _shared/guestInboundOrchestrator.ts and IS imported
// above. PORTAL_BASE_URL itself stays private to that module (read once via
// Deno.env.get there) — it is not exported and not referenced in this file.

// A timeout/abort means we never learned whether Meta processed the request —
// not the same as Meta rejecting it. Tagged distinctly so callers (notification_log
// writers, AICopilot, etc.) can report "outcome unknown" instead of a confident
// but possibly-wrong "failed" (FAIL VISIBLE, CLAUDE.md §0.3).
function _isAbortError(e: unknown): boolean {
  return e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError");
}

// buttonUrlParam: if set, passes a dynamic URL suffix to button index 0
// Templates with a Media Header (IMAGE) require a `header` component —
// Meta error without it: "Format mismatch, expected IMAGE, received UNKNOWN".
const _TEMPLATE_IMAGE_HEADERS: Record<string, string> = {
  dream_suite_reminder:        "https://tzalamnadlan.co.il/wp-content/uploads/2026/default-resort.jpg",
  night_before_suites:         "https://tzalamnadlan.co.il/wp-content/uploads/2026/default-resort.jpg",
  night_before_suites_shabbat: "https://tzalamnadlan.co.il/wp-content/uploads/2026/default-resort.jpg",
};

async function sendTemplate(
  to: string,
  templateName: string,
  vars: string[],
  langCode = "he",
  buttonUrlParam?: string,
): Promise<void> {
  const token   = Deno.env.get("META_WHATSAPP_TOKEN");
  const phoneId = Deno.env.get("META_PHONE_NUMBER_ID");
  if (!token || !phoneId) throw new Error("missing_meta_creds");

  const recipient = sanitizeMetaRecipientPhone(to);

  const components: unknown[] = [];
  const headerImageUrl = _TEMPLATE_IMAGE_HEADERS[templateName];
  if (headerImageUrl) {
    components.push({ type: "header", parameters: [{ type: "image", image: { link: headerImageUrl } }] });
  }
  if (vars.length > 0) {
    components.push({ type: "body", parameters: vars.map((v) => ({ type: "text", text: v })) });
  }
  if (buttonUrlParam !== undefined) {
    // index must be integer (not string) — Meta rejects "0" as string
    components.push({ type: "button", sub_type: "url", index: 0, parameters: [{ type: "text", text: buttonUrlParam }] });
  }

  try {
    const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: recipient,
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
      const errText = await res.text();
      console.error(`[sendTemplate] Meta ${res.status} for ${templateName} to ${to}:`, errText.slice(0, 400));
      throw new Error(`meta_template_${res.status}: ${errText.slice(0, 200)}`);
    }
  } catch (e) {
    if (_isAbortError(e)) throw new Error("timeout_no_response: Meta did not respond within 25s — message may have still been delivered");
    throw e;
  }
}

const SPA_MENU =
  "🌿 *תפריט ספא דרים איילנד*\n\n" +
  "💆 *טיפולים זוגיים:*\n" +
  "• ספא בואטסו — 60 דק'\n" +
  "• חמאם ושמנים — 90 דק'\n" +
  "• עיסוי לכל הגוף — 60 דק'\n\n" +
  "💆 *טיפולים אישיים:*\n" +
  "• טיפול פנים — 45 דק'\n" +
  "• עיסוי רגליים — 30 דק'\n" +
  "• עיסוי גב — 30 דק'\n\n" +
  "📞 להזמנה — שלחו לנו את שם הטיפול והשעה המועדפת ונתאם לכם. תמשיכו ליהנות! 🙏";

/**
 * Strip chain-of-thought leakage and internal tags before the reply reaches the guest.
 *
 * Handles all known patterns:
 *  • XML thinking blocks:  <thinking>…</thinking>
 *  • Labeled text blocks:  THOUGHT: …\n\n  |  Reasoning: …\n\n  |  מחשבה: …\n\n
 *  • Markdown headers:     **Thinking:** …\n\n
 *  • Lone label lines:     THOUGHT: single line (not followed by blank line)
 *  • Internal bracket tags: [תבנית:…]  |  [tag]
 *  • Unresolved placeholders: {{GUEST_NAME}} etc. (safety net per CLAUDE.md §CORE #2)
 */
function sanitizeReply(text: string): string {
  return sanitizeGuestBotReply(text);
}


// ══════════════════════════════════════════════════════════════════════════════
// §6  META CLOUD API — send WhatsApp reply
// ══════════════════════════════════════════════════════════════════════════════
type SendReplyOpts = {
  /**
   * Pre-approved BotScriptEditor / pipeline text (Stage 2, complaint_reply, etc.).
   * Skips LLM-oriented sanitizeReply + truncation guard — those were replacing
   * portal-link Stage 2 messages ending in URLs/🥰 with the generic emptyFallback.
   */
  scripted?: boolean;
};

async function sendReply(to: string, body: string, opts?: SendReplyOpts): Promise<string> {
  if (_suppressGuestRepliesStaffClaim) {
    console.info(`[webhook] 🔇 staff claim — sendReply suppressed to ${to}`);
    return "";
  }

  // ── HARD DROP guard (Mike's explicit rule) ─────────────────────────────────
  // Distinct from sanitizeReply()'s normal leak-stripping below, which removes a
  // thought block/preamble and still sends the cleaned-up remainder (or a safe
  // Hebrew apology if nothing usable is left). A raw "THOUGHT"/"REASONING" label,
  // markdown fence, or prompt-regurgitation quiz surviving to this chokepoint
  // means the generation itself was broken — send NOTHING rather than any fragment.
  if (shouldHardDropGuestReply(body)) {
    console.error(
      `[webhook] 🚨🔇 HARD DROP — raw reasoning / code fence / prompt leak detected in generated reply, message suppressed entirely (not sent) to ${to}`,
    );
    return "";
  }

  const token   = Deno.env.get("META_WHATSAPP_TOKEN");
  const phoneId = Deno.env.get("META_PHONE_NUMBER_ID");
  if (!token || !phoneId) throw new Error("missing_meta_creds");

  const emptyFallback =
    "מצטערים, נשמח לעזור 🙏 אפשר לנסח שוב? צוות דרים איילנד כאן בשבילכם.";

  let safeBody: string;
  if (opts?.scripted) {
    // Scripted pipeline — placeholders already resolved; send verbatim.
    safeBody = body.trim();
    if (!safeBody) {
      console.error(`[webhook] sendReply(scripted) empty body — not sent to ${to}`);
      return "";
    }
  } else {
    // ── FINAL CHOKEPOINT (Session 24) — LLM free-text only ───────────────────
    const safeBodyRaw = sanitizeReply(body).trim() || emptyFallback;
    safeBody = isReplyObviouslyTruncated(safeBodyRaw)
      ? resolveTruncatedReplyFallback(
          safeBodyRaw,
          "",
          _configCache,
          null,
          emptyFallback,
        )
      : safeBodyRaw;

    if (safeBody !== safeBodyRaw) {
      console.warn(
        `[webhook] 🛡️ sendReply truncation guard — replaced tail:"${safeBodyRaw.slice(-50)}"`,
      );
    }
  }

  const recipient = sanitizeMetaRecipientPhone(to);

  try {
    const res = await fetch(
      `https://graph.facebook.com/v20.0/${phoneId}/messages`,
      {
        method:  "POST",
        headers: {
          Authorization:  `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: recipient,
          type: "text",
          text: { body: safeBody, preview_url: false },
        }),
        signal: AbortSignal.timeout(25000),
      }
    );

    if (!res.ok) {
      throw new Error(`meta_send_${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    const data = await res.json();
    return data?.messages?.[0]?.id ?? "unknown";
  } catch (e) {
    if (_isAbortError(e)) throw new Error("timeout_no_response: Meta did not respond within 25s — message may have still been delivered");
    throw e;
  }
}

// dispatchStage2ViaPipeline — moved to _shared/guestInboundOrchestrator.ts. Imported above.

function guestOpsEligibility(
  guest: Record<string, unknown> | null | undefined,
  statusOverride?: string | null,
) {
  return {
    status: statusOverride ?? (guest?.status as string | null) ?? null,
    arrival_date: (guest?.arrival_date as string | null) ?? null,
    departure_date: (guest?.departure_date as string | null) ?? null,
  };
}

/** Per-message loop: staff "קח שיחה" on guests.claimed_by → suppress all guest outbound. */
let _suppressGuestRepliesStaffClaim = false;

function setSuppressGuestRepliesStaffClaim(active: boolean): void {
  _suppressGuestRepliesStaffClaim = active;
}

function isStaffClaimMutingGuest(guest: Record<string, unknown> | null | undefined): boolean {
  return guest?.claimed_by != null && guest.claimed_by !== "";
}

/** Re-read guests.claimed_by after burst wait — closes staff-claim race window. */
async function refreshStaffClaimMuteFromDb(
  supabase: ReturnType<typeof createClient>,
  guestId: number | string | null,
): Promise<boolean> {
  if (guestId == null) {
    setSuppressGuestRepliesStaffClaim(false);
    return false;
  }
  const { data, error } = await supabase
    .from("guests")
    .select("claimed_by")
    .eq("id", guestId)
    .maybeSingle();
  if (error) {
    console.warn("[webhook] claimed_by re-fetch failed:", error.message);
    return _suppressGuestRepliesStaffClaim;
  }
  const active = isStaffClaimMutingGuest(data as Record<string, unknown> | null);
  setSuppressGuestRepliesStaffClaim(active);
  if (active) {
    console.info(`[webhook] 🔇 staff claim active (re-fetch) guest_id=${guestId}`);
  }
  return active;
}

// GuestOutboundRow — moved to _shared/guestInboundOrchestrator.ts. Imported above.

/** Strip dispatch tags before quoting a message in a reaction snippet. */
function stripInboxMessageForSnippet(raw: string): string {
  let t = String(raw ?? "").replace(/\s+/g, " ").trim();
  t = t.replace(/^\[META\]\s*/i, "").replace(/^\[SESSION\]\s*/i, "");
  t = t.replace(/\n\[\+ Interactive Buttons\][\s\S]*$/i, "");
  return t;
}

function capReactionSnippet(raw: string): string {
  const clean = stripInboxMessageForSnippet(raw);
  return clean.length > 60 ? clean.slice(0, 57) + "…" : clean;
}

/** Resolve quoted text for a guest emoji reaction — exact wamid, then latest outbound. */
async function resolveReactionTargetSnippet(
  supabase: ReturnType<typeof createClient>,
  targetWaId: string,
  phone: string,
): Promise<string> {
  if (targetWaId) {
    try {
      const { data: targetRow } = await supabase
        .from("whatsapp_conversations")
        .select("message")
        .eq("wa_message_id", targetWaId)
        .maybeSingle();
      if (targetRow?.message) return capReactionSnippet(String(targetRow.message));
    } catch (e) {
      console.warn("[webhook] reaction target lookup failed (non-blocking):", (e as Error).message);
    }
  }

  try {
    const { data: recentOut } = await supabase
      .from("whatsapp_conversations")
      .select("message")
      .eq("inbox_channel", "meta")
      .eq("phone", phone)
      .eq("direction", "outbound")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (recentOut?.message) return capReactionSnippet(String(recentOut.message));
  } catch (e) {
    console.warn("[webhook] reaction outbound fallback failed (non-blocking):", (e as Error).message);
  }

  return "";
}

/** Skip inbox ghost rows when staff-claim mute suppressed the actual Meta send. */
async function insertGuestOutboundIfNotMuted(
  supabase: ReturnType<typeof createClient>,
  row: GuestOutboundRow,
): Promise<boolean> {
  if (_suppressGuestRepliesStaffClaim) return false;

  const channel = row.channel ?? "meta";
  const baseRow = { ...row, inbox_channel: channel, channel, direction: "outbound" as const };
  let { error } = await supabase.from("whatsapp_conversations").insert(baseRow);

  // FAIL VISIBLE fallback: a stale intent CHECK must never block inbox logging
  // after Meta already delivered the message (migration 157 class of bug).
  if (error?.code === "23514" && row.intent) {
    const retry = await supabase.from("whatsapp_conversations").insert({
      ...baseRow,
      intent: null,
    });
    if (!retry.error) {
      console.warn(
        "[webhook] insertGuestOutboundIfNotMuted intent rejected — logged with intent=null:",
        row.intent,
      );
      return true;
    }
    error = retry.error;
  }

  if (error) {
    console.error(
      "[webhook] insertGuestOutboundIfNotMuted failed:",
      error.code,
      error.message,
      "intent:",
      row.intent,
    );
    return false;
  }
  return true;
}

// ══════════════════════════════════════════════════════════════════════════════
// §7  MAIN HANDLER
// ══════════════════════════════════════════════════════════════════════════════
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // ── POST: log immediately so Supabase logs confirm Meta is calling us ────────
  if (req.method === "POST") {
    console.log("[webhook] 📨 POST received —", new Date().toISOString(),
      "| sim:", Deno.env.get("WHATSAPP_SIMULATION") ?? "false",
      "| token?", !!(Deno.env.get("META_WHATSAPP_TOKEN") ?? Deno.env.get("WHATSAPP_TOKEN")),
      "| phoneId?", !!Deno.env.get("META_PHONE_NUMBER_ID"),
      "| gemini?", !!Deno.env.get("GEMINI_API_KEY"),
    );
  }

  // ── GET: Meta webhook verification handshake ────────────────────────────────
  if (req.method === "GET") {
    const url       = new URL(req.url);
    const mode      = url.searchParams.get("hub.mode");
    const token     = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    const expected  = Deno.env.get("META_WEBHOOK_VERIFY_TOKEN");

    if (mode === "subscribe" && token === expected) {
      console.log("[webhook] ✅ Meta verification OK");
      return new Response(challenge ?? "ok", { status: 200 });
    }
    // Staff diagnostic — same verify token as Meta handshake (no secrets exposed).
    if (url.searchParams.get("diag") === "1" && token === expected) {
      const body = {
        ok: true,
        webhook_url: `${Deno.env.get("SUPABASE_URL") ?? ""}/functions/v1/whatsapp-webhook`,
        secrets: {
          META_WEBHOOK_VERIFY_TOKEN: !!expected,
          META_APP_SECRET: !!Deno.env.get("META_APP_SECRET"),
          META_WHATSAPP_TOKEN: !!(Deno.env.get("META_WHATSAPP_TOKEN") ?? Deno.env.get("WHATSAPP_TOKEN")),
          META_PHONE_NUMBER_ID: !!Deno.env.get("META_PHONE_NUMBER_ID"),
          SUPABASE_SERVICE_ROLE_KEY: !!Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
          GEMINI_API_KEY: !!Deno.env.get("GEMINI_API_KEY"),
        },
        hint: "Meta Business Manager → WhatsApp → Configuration → Webhook: subscribe to messages field.",
      };
      return new Response(JSON.stringify(body, null, 2), {
        status: 200,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }
    console.warn("[webhook] ❌ Meta verification FAILED — token mismatch");
    return new Response("Forbidden", { status: 403 });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const rawBody = await req.text();

  if (shouldVerifyMetaWebhookSignature()) {
    const appSecret = Deno.env.get("META_APP_SECRET")!.trim();
    const sigOk = await verifyMetaWebhookSignature(
      rawBody,
      req.headers.get("X-Hub-Signature-256"),
      appSecret,
    );
    if (!sigOk) {
      console.warn("[webhook] ❌ Meta POST signature verification FAILED");
      return new Response("Forbidden", { status: 403 });
    }
  }

  // Parse Meta payload
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return new Response("bad_json", { status: 400 });
  }

  // ── DIAGNOSTIC: dump raw payload so we can see exactly what Meta sends ───────
  console.log("[webhook] 🔬 raw payload:", JSON.stringify(payload).slice(0, 1000));

  // Drill into Meta's envelope structure
  const entry   = (payload?.entry   as Array<Record<string, unknown>>)?.[0];
  const changes = (entry?.changes   as Array<Record<string, unknown>>)?.[0];
  const value   = changes?.value    as Record<string, unknown> | undefined;
  const msgArr  = (value?.messages  as Array<Record<string, unknown>>) ?? [];

  // ── WhatsApp push name (Smart Identity Resolution fallback) ─────────────────
  // Meta's webhook envelope carries a sibling `contacts[]` array alongside
  // `messages[]`, keyed by wa_id (digits-only, same format as msg.from). This
  // is the guest's own WhatsApp profile display name — captured here once per
  // payload so WhatsAppInbox.js can show a real name even before the phone is
  // matched in `guests`. Never sent to the guest, never used for routing.
  const contactsArr = (value?.contacts as Array<Record<string, unknown>>) ?? [];
  const pushNameByWaId: Record<string, string> = {};
  for (const c of contactsArr) {
    const waId = String(c?.wa_id ?? "");
    const profileName = (c?.profile as Record<string, unknown> | undefined)?.name;
    if (waId && typeof profileName === "string" && profileName.trim()) {
      pushNameByWaId[waId] = profileName.trim();
    }
  }

  console.log(`[webhook] payload parsed — messages:${msgArr.length} statuses:${((value?.statuses as unknown[]) ?? []).length}`);
  if (msgArr.length === 0) {
    console.warn("[webhook] ⚠️ POST with zero messages — Meta may be sending status-only pings; guest traffic will not appear in Inbox.");
  }

  const UNSUPPORTED_INBOX_LABEL: Record<string, string> = {
    audio: "🎤 הודעה קולית",
    image: "📷 תמונה",
    video: "🎬 וידאו",
    sticker: "🎨 מדבקה",
    document: "📎 מסמך",
    location: "📍 מיקום",
    contacts: "👤 איש קשר",
  };

  // ── Fire-and-forget — return 200 immediately, process in background ─────────
  const processAsync = async () => {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) {
      console.error("[webhook] FATAL: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — cannot log Inbox or reply");
      return;
    }
    const supabase = createClient(supabaseUrl, serviceKey);
    await primeGuestChannelConfig(supabase);

    // Load all config in parallel — each has its own 5-min cache
    const [botConfig, botSettings, scripts] = await Promise.all([
      fetchBotConfig(supabase),
      fetchGuestBotSettings(supabase),
      fetchBotScripts(supabase),
    ]);

    // Human-handover flag: 'false' = bot paused, messages logged but not replied
    const botIsActive  = botConfig["bot_active"] !== "false"; // default true

    for (const msg of msgArr) {
      setSuppressGuestRepliesStaffClaim(false);
      const from  = String(msg.from ?? "");
      const msgId = String(msg.id   ?? "");
      const { phone, variants: phoneVariants } = buildPhoneVariants(from);
      const phoneDigits = phone.replace(/\D/g, "");
      const pushName = pushNameByWaId[phoneDigits] ?? pushNameByWaId[from] ?? null;

      // ── DIAGNOSTIC: log every message type entering the loop ─────────────
      console.log(`[webhook] 🔍 msg type:"${msg.type}" from:${phone} id:${msgId.slice(-8)}`);

      // Extract text from both plain text and interactive button_reply messages
      let text = "";
      let isButtonReply = false;
      let buttonTitle   = "";
      let buttonId      = "";

      if (msg.type === "text") {
        text = (msg.text as Record<string, unknown>)?.body as string ?? "";
        if (!text.trim()) continue;
      } else if (msg.type === "interactive") {
        const interactive = msg.interactive as Record<string, unknown>;
        if ((interactive?.type as string) === "button_reply") {
          isButtonReply = true;
          const br    = interactive?.button_reply as Record<string, unknown>;
          buttonTitle = (br?.title as string) ?? "";
          buttonId    = (br?.id    as string) ?? "";
          text        = buttonTitle;
          console.log(`[webhook] 🔘 button_reply title:"${buttonTitle}" id:"${buttonId}"`);
        } else {
          console.log(`[webhook] ⏭️ interactive sub-type "${(msg.interactive as Record<string,unknown>)?.type}" — skipped`);
          continue;
        }
      } else if (msg.type === "button") {
        // Quick Reply tap on a TEMPLATE message (type:"template" with quick-reply
        // buttons — sent via sendTemplate()/sendViaTemplate(), e.g. dream_arrival_confirmation).
        // Meta delivers these as type:"button" with { button: { text, payload } } —
        // a DIFFERENT shape than the "interactive"/button_reply case above, which is
        // only for free-standing interactive button messages. This case was previously
        // unhandled and fell into the catch-all skip below, which is why tapping
        // "כן,מגיעים!" on the broadcast template produced zero reply in production.
        isButtonReply = true;
        const btn   = msg.button as Record<string, unknown>;
        buttonTitle = (btn?.text    as string) ?? "";
        buttonId    = (btn?.payload as string) ?? "";
        text        = buttonTitle;
        console.log(`[webhook] 🔘 template button title:"${buttonTitle}" payload:"${buttonId}"`);
      } else if (msg.type === "reaction") {
        // ── Guest emoji reaction (P0, session 125) — FAIL VISIBLE, log-only ──
        // Meta payload: { type:"reaction", reaction:{ message_id, emoji } }.
        // emoji is ABSENT/empty when the guest removes a reaction. Previously
        // this fell into the generic catch-all below and logged an opaque
        // "📩 הודעה (reaction)" — emoji discarded, no target message. Staff
        // must see WHICH emoji on WHICH message. Never triggers the bot/LLM —
        // `continue` before any routing, exactly like other unsupported types.
        const reactionObj = msg.reaction as Record<string, unknown> | undefined;
        const emoji = String(reactionObj?.emoji ?? "").trim();
        const targetWaId = String(reactionObj?.message_id ?? "");

        const snippet = await resolveReactionTargetSnippet(supabase, targetWaId, phone);

        const inboxText = emoji
          ? (snippet
              ? `${emoji} תגובה על ההודעה: «${snippet}»`
              : `${emoji} תגובה על הודעה קודמת`)
          : (snippet
              ? `הוסרה תגובה מההודעה: «${snippet}»`
              : "הוסרה תגובה מהודעה קודמת");

        console.log(
          `[webhook] ${emoji ? "💟" : "🚫"} reaction from:${phone} emoji:"${emoji}"` +
          ` target:${targetWaId.slice(-10)} snippet:${snippet ? "yes" : "no"}`,
        );

        const { claimed, conversationId } = await claimInboundWaMessage(supabase, {
          phone,
          guest_id: null,
          message: inboxText,
          wa_message_id: msgId,
          push_name: pushName,
          intent: "guest_reaction",
        });
        if (!claimed) {
          console.info("[webhook] dedup skip (reaction):", msgId);
        } else {
          const guest = await lookupGuestByPhone(supabase, phoneVariants, phone);
          if (guest?.id) {
            await patchClaimedInbound(supabase, conversationId, msgId, { guest_id: guest.id as number });
          }
        }
        continue;
      } else if (msg.type === "image") {
        const imageObj = msg.image as Record<string, unknown> | undefined;
        const mediaId = String(imageObj?.id ?? "");
        const caption = String(imageObj?.caption ?? "").trim();
        const inboxLabel = UNSUPPORTED_INBOX_LABEL.image;
        const inboxText = caption || inboxLabel;

        let mediaUrl: string | null = null;
        let mediaMime: string | null = null;
        if (mediaId) {
          const persisted = await persistGuestWaMedia(supabase, {
            mediaId,
            phone,
            waMessageId: msgId,
          });
          mediaUrl = persisted.url;
          mediaMime = persisted.mime;
        } else {
          console.warn("[webhook] image message missing media id:", msgId);
        }

        console.log(
          `[webhook] 📷 image from:${phone} id:${msgId.slice(-8)}` +
          ` stored:${mediaUrl ? "yes" : "no"} caption:${caption ? "yes" : "no"}`,
        );

        const { claimed, conversationId } = await claimInboundWaMessage(supabase, {
          phone,
          guest_id: null,
          message: inboxText,
          wa_message_id: msgId,
          push_name: pushName,
          intent: "media_received",
          message_type: "image",
          media_url: mediaUrl,
          media_mime: mediaMime,
          media_caption: caption || null,
        });
        if (!claimed) {
          console.info("[webhook] dedup skip (image):", msgId);
        } else {
          const guest = await lookupGuestByPhone(supabase, phoneVariants, phone);
          if (guest?.id) {
            await patchClaimedInbound(supabase, conversationId, msgId, { guest_id: guest.id as number });
          }
        }
        continue;
      } else {
        console.log(`[webhook] ⏭️ msg type "${msg.type}" — inbox log only`);
        const label = UNSUPPORTED_INBOX_LABEL[String(msg.type)] ?? `📩 הודעה (${String(msg.type)})`;
        const { claimed, conversationId } = await claimInboundWaMessage(supabase, {
          phone,
          guest_id: null,
          message: label,
          wa_message_id: msgId,
          push_name: pushName,
          intent: "received",
        });
        if (!claimed) {
          console.info("[webhook] dedup skip (unsupported type):", msgId);
        } else {
          const guest = await lookupGuestByPhone(supabase, phoneVariants, phone);
          if (guest?.id) {
            await patchClaimedInbound(supabase, conversationId, msgId, { guest_id: guest.id as number });
          }
        }
        continue;
      }

      if (!text.trim()) continue;

      // ── Ops board claim/done buttons — staff-ops-webhook sends these via
      // sendInteractiveButtons() with custom ids ops_claim_{taskId}/
      // ops_done_{taskId} (see _shared/interactiveSend.ts's optional `id`
      // field, added alongside this). Handled here, BEFORE any guest lookup —
      // the tapping phone belongs to a staff member, not necessarily a
      // `guests` row, so none of the guest-specific gating below applies.
      if (isButtonReply && (buttonId.startsWith("ops_claim_") || buttonId.startsWith("ops_done_"))) {
        const taskId  = buttonId.replace(/^ops_(claim|done)_/, "");
        const isClaim = buttonId.startsWith("ops_claim_");
        const { data: staffProfile } = await supabase
          .from("profiles")
          .select("id")
          .in("phone", phoneVariants)
          .maybeSingle();
        const patch = isClaim
          ? { status: "in_progress", claimed_by: staffProfile?.id ?? null, claimed_at: new Date().toISOString() }
          : { status: "done", resolved_by: staffProfile?.id ?? null, resolved_at: new Date().toISOString() };
        const { error: opsErr } = await supabase.from("tasks").update(patch).eq("id", taskId);
        if (opsErr) console.error(`[webhook] ops button update failed for task ${taskId}:`, opsErr.message);
        const confirmText = opsErr
          ? "⚠️ Couldn't update the task — please check the Operations Board."
          : isClaim ? "🙋‍♂️ Got it — marked as you're handling this now." : "✅ Marked as done, thank you!";
        try {
          await sendReply(phone, confirmText, { scripted: true });
        } catch (e) {
          console.error(`[webhook] failed to send ops confirmation to ${phone}:`, (e as Error).message);
        }
        continue;
      }

      // ── Insert-first dedup claim (ledger before any slow path / LLM) ─────
      const { claimed, conversationId: claimedConversationId } = await claimInboundWaMessage(
        supabase,
        {
          phone,
          guest_id: null,
          message: text,
          wa_message_id: msgId,
          push_name: pushName,
          intent: "received",
        },
      );
      // ── Guest lookup (multi-row safe + last-9-digit suffix) ────────────
      let guest = await lookupGuestByPhone(supabase, phoneVariants, phone);

      if (!claimed) {
        console.info("[webhook] dedup skip (claim):", msgId);
        const isConfirmDedup = isButtonReply
          ? isArrivalConfirmationMessage(buttonTitle, { buttonTitle, buttonId })
          : isArrivalConfirmationMessage(text);
        if (isConfirmDedup) {
          const guestIdDedup = (guest?.id as number) ?? null;
          if (guestIdDedup && canGuestConfirmArrival(guest as Record<string, unknown> | null)) {
            await handleStage2ArrivalConfirmation(supabase, {
              scripts,
              phone,
              guestId: guestIdDedup,
              guest: guest as Record<string, unknown> | null,
              sim: Deno.env.get("WHATSAPP_SIMULATION") === "true",
              source: isButtonReply ? "button" : "text",
              buttonTitle: isButtonReply ? buttonTitle : undefined,
              claimedConversationId: null,
              msgId,
            });
            console.info(`[webhook] dedup-skip confirmation catch-up guest:${guestIdDedup} phone:${phone}`);
          } else if (!guestIdDedup) {
            console.warn(`[webhook] dedup-skip confirmation text but NO guest — phone:${phone} text:"${text}"`);
          }
        }
        continue;
      }

      const guestId   = (guest?.id   as number)     ?? null;
      const guestName = (guest?.name as string|null) ?? null;
      const sim       = Deno.env.get("WHATSAPP_SIMULATION") === "true";

      // ── Defensive Shield: this per-message body (Tier-0 intercepts, burst
      // coalescing, intent classification, LLM call, send) had no top-level
      // try/catch — any thrown exception silently killed the reply for this
      // guest with zero trace (no DB row, no visible error) since processAsync
      // itself isn't awaited by the caller. Wrapping it means a future bug
      // here degrades to "no reply + a logged reason" instead of "no reply +
      // total silence" (FAIL VISIBLE, CLAUDE.md §0.3).
      // QA audit fix (2026-07-06): the boundary used to start AFTER the early
      // arrival-confirmation intercept below — an exception inside
      // handleStage2ArrivalConfirmation() (template resolution, Meta send,
      // pipeline fallback) could escape this per-message try/catch entirely,
      // aborting the `for (const msg of msgArr)` loop and silently dropping
      // every OTHER message in the same Meta webhook delivery, not just this
      // guest's. Moved earlier so that path is covered too.
      try {
      // ── Stage 2 on «כן מגיעים» — BEFORE auto-checkin / staff-mute / LLM ──
      if (await tryArrivalConfirmationIntercept(supabase, {
        scripts,
        phone,
        guestId,
        guest: guest as Record<string, unknown> | null,
        sim,
        isButtonReply,
        buttonTitle,
        buttonId,
        text,
        claimedConversationId,
        msgId,
        lane: "early",
      })) {
        continue;
      }
      const nowForGuest = new Date();
      const guestStatusAtLookup = resolveEffectiveGuestStatus(
        {
          status: (guest?.status as string | null) ?? null,
          arrival_date: (guest?.arrival_date as string | null) ?? null,
          departure_date: (guest?.departure_date as string | null) ?? null,
        },
        nowForGuest,
      );

      // 15:00 Israel auto check-in DISABLED (2026-07-11) — housekeeping WA
      // group is the sole check-in source for suites; see whatsapp-cron.

      const staffClaimActive = isStaffClaimMutingGuest(guest as Record<string, unknown> | null);
      setSuppressGuestRepliesStaffClaim(staffClaimActive);
      if (staffClaimActive) {
        console.info(`[webhook] 🔇 staff claim active — bot muted for guest_id=${guestId} phone:${phone}`);
      }

      if (claimedConversationId && guestId) {
        patchClaimedInbound(supabase, claimedConversationId, msgId, { guest_id: guestId });
      }

      // ── In-room keyword override — DB status lags physical presence ─────
      let inRoomOverride = false;
      if (guestId && guest && shouldApplyInRoomContextOverride(text, guestStatusAtLookup)) {
        inRoomOverride = true;
        guest = { ...guest, status: "checked_in" };
        applyInRoomStatusOverride(supabase, guestId, phone);
        console.info(`[webhook] 🛏️ in-room keyword override → checked_in phone:${phone} guest:${guestId}`);
      }

      // ── DIAGNOSTIC: pre-flight state snapshot ────────────────────────────
      // status/arrival_confirmed added so a future "status stuck" report can
      // be checked against hard evidence instead of re-deriving it by reading
      // code again — this exact pair was reported stuck more than once.
      console.log(
        `[webhook] 🧭 pre-flight — phone:${phone} guestId:${guestId ?? "null"}` +
        ` needs_callback:${guest?.needs_callback ?? "null"} spa_time:${JSON.stringify(guest?.spa_time)}` +
        ` status:${guest?.status ?? "null"} arrival_confirmed:${guest?.arrival_confirmed ?? "null"}` +
        ` isButton:${isButtonReply} btnTitle:"${buttonTitle}" sim:${sim}`
      );
      // Explicit, grep-friendly lines on every message (not just faq/fallback) —
      // scoped to just these two fields rather than the full guest object,
      // which also carries payment_amount/payment_link_url (PII-noise reduced
      // deliberately in session 14; see CLAUDE.md §10).
      console.log(`[webhook] Found Spa Time: ${guest?.spa_time ?? "(none)"}`);
      console.log(`[webhook] Guest Notes: ${guest?.guest_notes ?? "(none)"}`);

      // ── Wire up migration 033's wa_window_expires_at (documented since
      //    that migration, never actually written until now) — every inbound
      //    message (re)opens the 24h free-text session window, which
      //    whatsapp-send's hybrid fallback (Phase 4) checks before deciding
      //    session-message vs Meta-template for pipeline sends. Non-blocking:
      //    a failure here must never delay/break the reply pipeline below.
      // NOTE: PostgREST query builder implements .then() but not .catch() —
      // chaining .catch() directly throws instead of swallowing (see
      // whatsapp-send's BRANCH D for the same documented gotcha). Use .then(cb).
      if (guestId) {
        supabase
          .from("guests")
          .update({ wa_window_expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString() })
          .eq("id", guestId)
          .then(({ error }: { error: { message: string } | null }) => {
            if (error) console.warn("[webhook] wa_window_expires_at update failed (non-blocking):", error.message);
          });
      }

      // needs_callback is a staff UI alert flag only — it does NOT mute the bot.
      // Staff clear it manually from WhatsAppInbox / AddGuestModal when handled.

      // ── Button reply router ───────────────────────────────────────────────
      // Handles taps on Quick Reply / URL buttons in approved templates.
      // Each branch logs the interaction and sends an appropriate response,
      // then skips normal intent classification.
      if (isButtonReply && buttonTitle) {
        // These two buttons are explicit human-attention requests, exactly like
        // the typed DATE_CHANGE_RE / "talk to a person" paths — tag the inbound
        // row with human_requested so WhatsAppInbox.js's red "🔴 מבקש מענה אנושי"
        // indicator shows for button taps too, not just typed text.
        const isDateChangeButton = buttonTitle.includes("שינוי בתאריך") || buttonTitle.includes("לא,");
        const isCallbackButton   = buttonTitle.includes("דברו איתי") || buttonTitle.includes("מענה אנושי");

        await patchClaimedInbound(supabase, claimedConversationId, msgId, {
          guest_id: guestId,
          intent: "button_reply",
          ...(isDateChangeButton ? { human_requested: true, human_request_type: "date_change" } : {}),
          ...(isCallbackButton   ? { human_requested: true, human_request_type: "callback" }    : {}),
        });

        // ── "כן, מגיעים! ✨" — arrival confirmed → stage_2_arrival script ──
        const serviceFallbackKind = isServiceFallbackButtonReply(buttonTitle, { buttonTitle });
        if (isArrivalConfirmationMessage(buttonTitle, { buttonTitle, buttonId })) {
          await handleStage2ArrivalConfirmation(supabase, {
            scripts,
            phone,
            guestId,
            guest: guest as Record<string, unknown> | null,
            sim,
            source: "button",
            buttonTitle,
            claimedConversationId,
            msgId,
          });
          console.info(`[webhook] ✅ button reply handled — "${buttonTitle}" phone:${phone}`);
          continue;

        } else if (serviceFallbackKind) {
          const ack = serviceFallbackKind === "ok" ? SERVICE_FALLBACK_OK_ACK_HE : SERVICE_FALLBACK_REQUEST_ACK_HE;
          try {
            await sendReply(phone, ack, { scripted: true });
          } catch (e) {
            console.error("[webhook] service_fallback ack error:", (e as Error).message);
          }
          await insertGuestOutboundIfNotMuted(supabase, {
            phone, guest_id: guestId, message: ack, wa_message_id: null,
            intent: serviceFallbackKind === "ok" ? "service_fallback_ok" : "service_fallback_request",
          });
          console.info(`[webhook] ✅ service_fallback ${serviceFallbackKind} — phone:${phone}`);
          continue;

        // ── Day-pass window opener («מחכים לכם!») — ack only; inbound already
        //    refreshed wa_window_expires_at for Meta free-text follow-ups.
        } else if (isDaypassWindowOpenerMessage(buttonTitle, { buttonTitle })) {
          try {
            await sendReply(phone, DAYPASS_WINDOW_OPENER_ACK_HE, { scripted: true });
          } catch (e) {
            console.error("[webhook] daypass window-opener ack error:", (e as Error).message);
          }
          await insertGuestOutboundIfNotMuted(supabase, {
            phone, guest_id: guestId, message: DAYPASS_WINDOW_OPENER_ACK_HE, wa_message_id: null, intent: "daypass_window_opener",
          });
          console.info(`[webhook] ✅ daypass window opener — phone:${phone}`);
          continue;

        // ── "לא, שינוי בתאריך" — date change → ask + flag for staff ─────────
        } else if (buttonTitle.includes("שינוי בתאריך") || buttonTitle.includes("לא,")) {
          if (guestId) {
            await supabase.from("guests").update({
              requires_attention:       true,
              requires_attention_since: new Date().toISOString(),
              needs_callback:           true,
              attention_reason:         "date_change",
            }).eq("id", guestId);
          }
          // Alert row for staff dashboard — fire-and-forget, but wrapped so a
          // bare .catch() (invalid on the PromiseLike Postgrest builder) doesn't throw.
          (async () => {
            const { error } = await supabase.from("guest_alerts").insert({
              guest_id: guestId, phone, alert_type: "date_change_request",
              message: `[כפתור: ${buttonTitle}]`, resolved: false,
            });
            if (error) {
              console.warn("[webhook] guest_alerts (button date_change) error:", error.message);
              return;
            }
            onGuestAlertInserted(supabase, {
              guestId, phone, message: `[כפתור: ${buttonTitle}]`, alertType: "date_change_request",
              sourceLabel: "WhatsApp Bot",
            }).catch((e: Error) => console.warn("[webhook] button date_change notify failed:", e.message));
          })().catch((e: Error) => console.warn("[webhook] guest_alerts (button date_change) error:", e.message));
          const dateChangeReply =
            "העברתי את בקשתך לצוות הסוויטות שלנו, בנתיים תכתוב לי באיזה תאריכים תרצו ואנחנו נבדוק זמינות עבורכם וניצור קשר בהקדם. 🙏";
          try { await sendReply(phone, dateChangeReply, { scripted: true }); } catch (e) { console.error("[webhook] reply error:", (e as Error).message); }
          await insertGuestOutboundIfNotMuted(supabase, {
            phone, guest_id: guestId, message: dateChangeReply, wa_message_id: null, intent: "date_change_request",
          });

        // ── "ספא וטיפולים 📜" — send spa menu as free text ──────────────────
        } else if (buttonTitle.includes("ספא") || buttonTitle.includes("טיפולים")) {
          const spaMenuText = scripts["spa_menu"]?.message_text?.trim() || SPA_MENU;
          try { await sendReply(phone, spaMenuText, { scripted: true }); } catch (e) { console.error("[webhook] spa menu send error:", (e as Error).message); }
          await insertGuestOutboundIfNotMuted(supabase, {
            phone, guest_id: guestId, message: "[תפריט ספא]", wa_message_id: null, intent: "button_reply",
          });

        // ── "דברו איתי 📞" — callback requested → alert staff ───────────────
        } else if (buttonTitle.includes("דברו איתי") || buttonTitle.includes("מענה אנושי")) {
          if (guestId) {
            await supabase.from("guests").update({
              needs_callback: true, requires_attention: true, requires_attention_since: new Date().toISOString(),
              attention_reason: "human_callback",
            }).eq("id", guestId);
          }
          const callbackReply = scripts["callback_reply"]?.message_text?.trim()
            || "קיבלנו! 🙏 אחד מהצוות שלנו יצור אתכם קשר בהקדם. תמשיכו ליהנות!";
          try { await sendReply(phone, callbackReply, { scripted: true }); } catch (e) { console.error("[webhook] reply error:", (e as Error).message); }
          await insertGuestOutboundIfNotMuted(supabase, {
            phone, guest_id: guestId, message: callbackReply, wa_message_id: null, intent: "button_reply",
          });

        // ── "היה מושלם! ✨" — positive feedback → send Google review link ────
        } else if (buttonTitle.includes("מושלם") || buttonTitle.includes("מושלמת")) {
          const reviewUrl = GOOGLE_REVIEW_URL || "dream-island.co.il";
          const feedbackReply = scripts["positive_feedback_reply"]?.message_text?.trim()
            ? scripts["positive_feedback_reply"]!.message_text!.replace(/\{\{\s*GOOGLE_REVIEW_URL\s*\}\}/gi, reviewUrl)
            : `שמחנו מאוד לשמוע! 🌟 אם תרצו לשתף את החוויה שלכם — זה יאיר לנו את היום:\n${reviewUrl}\nתודה ענקית ומחכים לכם בפעם הבאה! 💫`;
          try { await sendReply(phone, feedbackReply, { scripted: true }); } catch (e) { console.error("[webhook] reply error:", (e as Error).message); }
          await insertGuestOutboundIfNotMuted(supabase, {
            phone, guest_id: guestId, message: feedbackReply, wa_message_id: null, intent: "button_reply",
          });
          await saveGuestFeedback(supabase, {
            guestId, phone, sentiment: "positive", text: buttonTitle, source: "post_stay_button",
          });

        // ── "יש מקום לשיפור 💬" — negative feedback → collect + flag ────────
        } else if (buttonTitle.includes("לשיפור") || buttonTitle.includes("שיפור")) {
          if (guestId) {
            await supabase.from("guests").update({ requires_attention: true, requires_attention_since: new Date().toISOString() }).eq("id", guestId);
          }
          const improvReply = scripts["negative_feedback_reply"]?.message_text?.trim()
            || "תודה על הכנות — זה חשוב לנו מאוד. 🙏 מה היה אפשר לשפר? כתבו לנו כאן ונשתפר.";
          try { await sendReply(phone, improvReply, { scripted: true }); } catch (e) { console.error("[webhook] reply error:", (e as Error).message); }
          await insertGuestOutboundIfNotMuted(supabase, {
            phone, guest_id: guestId, message: improvReply, wa_message_id: null, intent: "button_reply",
          });
          await saveGuestFeedback(supabase, {
            guestId, phone, sentiment: "negative", text: buttonTitle, source: "post_stay_button",
          });

        // ── Therapy upsell — "Hot & Cold Restart" campaign positive replies ─
        // Buttons: "נשמע מושלם, אשמח לפרטים!" / "שריינו לי מקום 🙏"
        } else if (
          buttonTitle.includes("נשמע מושלם") ||
          buttonTitle.includes("שריינו לי מקום") ||
          buttonId.includes("upsell_yes")
        ) {
          const upsellPositiveReply =
            scripts["upsell_accepted_reply"]?.message_text?.trim() ||
            "איזה יופי! ✨ העברתי את פנייתך לצוות הספא שלנו, והם ייצרו איתך קשר בהקדם לתיאום שעה מדויקת.";
          // bookings table stores phone without leading +
          const bookingPhoneUpsell = phone.startsWith("+") ? phone.slice(1) : phone;
          supabase
            .from("bookings")
            .update({ upsell_interest: true, upsell_requested_at: new Date().toISOString() })
            .eq("phone", bookingPhoneUpsell)
            .then(({ error: uErr }) => {
              if (uErr) console.warn("[webhook] upsell_interest update error:", uErr.message);
              else console.info("[webhook] ✅ upsell_interest flagged for", bookingPhoneUpsell);
            });
          try { await sendReply(phone, upsellPositiveReply, { scripted: true }); } catch (e) { console.error("[webhook] upsell reply error:", (e as Error).message); }
          await insertGuestOutboundIfNotMuted(supabase, {
            phone, guest_id: guestId,
            message: upsellPositiveReply, wa_message_id: null, intent: "button_reply",
          });

        // ── "פחות מתאים הפעם" — therapy decline → graceful exit ────────────
        } else if (
          buttonTitle.includes("פחות מתאים") ||
          buttonId.includes("upsell_no")
        ) {
          const declineReply =
            scripts["upsell_decline_reply"]?.message_text?.trim() ||
            "הכל בסדר גמור! אנחנו כאן לכל דבר אחר שתצטרכו לקראת החופשה. 🌴";
          try { await sendReply(phone, declineReply, { scripted: true }); } catch (e) { console.error("[webhook] decline reply error:", (e as Error).message); }
          await insertGuestOutboundIfNotMuted(supabase, {
            phone, guest_id: guestId,
            message: declineReply, wa_message_id: null, intent: "button_reply",
          });

        // ── Unrecognized button — generic reply so no button is ever silent ──
        } else {
          console.warn(`[webhook] ⚠️ unmatched button title="${buttonTitle}" id="${buttonId}" — sending generic reply`);
          const genericReply = scripts["generic_button_reply"]?.message_text?.trim()
            || "תודה! 😊 קיבלנו את בחירתך. האם יש משהו נוסף שנוכל לעשות עבורכם?";
          try { await sendReply(phone, genericReply, { scripted: true }); } catch (e) { console.error("[webhook] generic button reply error:", (e as Error).message); }
          await insertGuestOutboundIfNotMuted(supabase, {
            phone, guest_id: guestId, message: genericReply, wa_message_id: null, intent: "button_reply",
          });
        }

        console.info(`[webhook] ✅ button reply handled — "${buttonTitle}" phone:${phone}`);
        continue; // skip normal intent routing
      }

      // ── Tier-0 greeting opener (היי / שלום) — before courtesy silent-exit ──
      if (!isButtonReply && isGuestGreetingMessage(text)) {
        await handleGuestGreeting(supabase, {
          phone,
          guestId,
          guestName,
          msgId,
          claimedConversationId,
          sim,
          scripts,
        });
        continue;
      }

      // ── Defensive Shield — emoji/courtesy-only pass (Layer 2.1) ────────────
      // Checked before EVERY other Tier-0 classifier, including the typed
      // arrival-confirmation fallback right below — a pure "👍"/"תודה"/"בסדר"
      // never needs date-change/complaint/operational/confirmation routing or
      // the LLM. This ordering is load-bearing: a production bug shipped when
      // this check ran AFTER the confirmation-text block (see CONFIRMATION_RE
      // comment above) — a guest's unrelated "בסדר"/"מצוין" reply was swept
      // into "arrival confirmed" and triggered the spa-mentioning confirmation
      // reply. Keep this first so any future regex overlap fails safe (silence).
      // Silence applies ONLY when the bot already spoke in this thread — an opener
      // "תודה"/"בסדר" with no prior outbound falls through to normal routing.
      if (
        !isButtonReply &&
        isLowValueCourtesyMessage(text) &&
        await guestThreadHasPriorOutbound(supabase, phone)
      ) {
        await handleCourtesyAck(supabase, { phone, guestId, msgId, claimedConversationId });
        continue;
      }

      // ── Defensive Shield — guest's own WhatsApp Business away-message ──────
      // Same "before the LLM" placement as courtesy-ack above — see
      // isAutoAwayMessage doc-comment (_shared/automationSchedule.ts).
      if (!isButtonReply && isAutoAwayMessage(text)) {
        await handleAutoAwayMessage(supabase, { phone, guestId, msgId, claimedConversationId });
        continue;
      }

      // ── Text confirmation detection (fallback for guests who type "כן" manually) ──
      // NOT gated on arrival_confirmed — a prior confirm may have set the DB flag
      // without delivering Stage 2 (staff-claim mute, send failure, manual toggle).
      // Arrival confirm always beats LLM/portal-spa context for pre-check-in guests.
      // ⚠️ session fix (2026-07-07): canGuestConfirmArrival() must NOT be checked
      // here as a pre-condition — handleStage2ArrivalConfirmation() already does
      // that check internally and exits silently on a genuine repeat (mirrors the
      // button-tap path at "isButtonReply" above, which never pre-checks either).
      // Pre-checking it here meant a guest who RE-typed "כן, מגיעים!" after Stage 2
      // was already delivered fell straight through every remaining Tier-0
      // classifier into the free-text LLM — producing an off-script improvised
      // reply ("hallucination") instead of the same safe silence the button path
      // already gets. Always intercept a confirmation text here; let the function
      // decide what (if anything) to send.
      if (
        !isButtonReply &&
        isArrivalConfirmationMessage(text)
      ) {
        await handleStage2ArrivalConfirmation(supabase, {
          scripts,
          phone,
          guestId,
          guest: guest as Record<string, unknown> | null,
          sim,
          source: "text",
          claimedConversationId,
          msgId,
        });
        console.info(`[webhook] ✅ pre-arrival confirmed (text) — phone:${phone} guest:${guestId}`);
        continue;
      }

      // Day-pass window opener typed («מחכים לכם!» / «אנחנו בדרך») — soft ack.
      // Inbound already refreshed wa_window_expires_at for Meta free-text stages.
      if (!isButtonReply && isDaypassWindowOpenerMessage(text)) {
        try {
          await sendReply(phone, DAYPASS_WINDOW_OPENER_ACK_HE, { scripted: true });
        } catch (e) {
          console.error("[webhook] daypass window-opener text ack error:", (e as Error).message);
        }
        await insertGuestOutboundIfNotMuted(supabase, {
          phone, guest_id: guestId, message: DAYPASS_WINDOW_OPENER_ACK_HE, wa_message_id: null, intent: "daypass_window_opener",
        });
        console.info(`[webhook] ✅ daypass window opener (text) — phone:${phone}`);
        continue;
      }

      // ── Arrival TIME — persist + Requests Board (arrival_eta); no ops / needs_callback ──
      if (!isButtonReply && guestId && isRecordOnlyArrivalTimeUpdate(text)) {
        const arrivalTime = extractArrivalTimeFromText(text)!;
        const previousArrivalTime = (guest as { arrival_time?: string | null }).arrival_time ?? null;
        const persistResult = await persistGuestEta(supabase, {
          guestId,
          guest: guest as Record<string, unknown>,
          timeHhMm: arrivalTime,
          source: "tier0_wa",
        });
        if (!persistResult.ok && persistResult.skipped === "ineligible_guest") {
          console.info("[webhook] arrival_time record-only — ineligible row, falling through");
        } else {
          if (!persistResult.ok && persistResult.error) {
            console.error("[webhook] arrival_time record-only update FAILED:", persistResult.error);
          }

          if (persistResult.ok && !sim) {
            const board = await insertArrivalEtaBoardAlert(supabase, {
              guestId,
              phone,
              timeHhMm: arrivalTime,
              guestMessage: text,
              conversationId: claimedConversationId,
            });
            if (board.ok) {
              onGuestAlertInserted(supabase, {
                alertType: "arrival_eta",
                message: `🕐 שעת הגעה משוערת: ${arrivalTime}`,
                phone,
                guestId,
                conversationId: claimedConversationId,
                boardOnly: true,
              }).catch((e: Error) =>
                console.warn("[webhook] arrival_eta board notify:", e.message),
              );
              const { notifyAdirArrivalEta } = await import("../_shared/arrivalEtaAdirNotify.ts");
              notifyAdirArrivalEta(supabase, {
                guest: guest as Record<string, unknown> & { arrival_date: string },
                guestId,
                timeHhMm: arrivalTime,
                previousTime: previousArrivalTime,
                guestQuote: text,
                channel: "meta",
                phone,
              }).catch((e: Error) =>
                console.warn("[webhook] arrival_eta adir notify:", e.message),
              );
            }
          }

          await patchClaimedInbound(supabase, claimedConversationId, msgId, {
            guest_id: guestId,
            intent: "arrival_time_update",
          });

          if (!sim) {
            try {
              await sendReply(phone, RECORD_ONLY_ARRIVAL_REPLY, { scripted: true });
              await insertGuestOutboundIfNotMuted(supabase, {
                phone, guest_id: guestId, message: RECORD_ONLY_ARRIVAL_REPLY, wa_message_id: null, intent: "arrival_time_update",
              });
            } catch (e) {
              console.error("[webhook] arrival_time reply failed:", (e as Error).message);
            }
          } else {
            console.info(`[webhook] SIM — arrival_time record-only ${arrivalTime} from ${phone}`);
          }

          console.info(`[webhook] 🕐 arrival_time record-only — phone:${phone} time:${arrivalTime}`);
          continue;
        }
      }

      // ── Check-in / entry policy FAQ — Tier-0, before LLM (complete hours) ──
      if (!isButtonReply && isCheckInPolicyQuestion(text)) {
        await handleCheckInPolicyFaq(supabase, {
          phone,
          guestId,
          guest: guest as Record<string, unknown> | null,
          msgId,
          claimedConversationId,
          sim,
          cfg: botConfig,
        });
        continue;
      }

      // ── Severe complaint kill-switch — checked first, before any other Tier-0
      // classifier or LLM. A furious/serious complaint must never be routed
      // into date-change/upsell/generic-complaint copy or free-text LLM output —
      // only the fixed complaint_reply template goes out, no LLM generation.
      if (!isButtonReply && isSevereComplaint(text)) {
        await handleSevereComplaintKillSwitch(supabase, {
          phone, guestId, guestName, scripts, text, msgId, claimedConversationId, sim,
        });
        continue;
      }

      // ── Sensitive stay-change shield (late checkout / extension / room change) ──
      // Before DATE_CHANGE, upsell, and LLM — canonical neutral handoff only.
      if (!isButtonReply && isSensitiveStayChangeRequest(text)) {
        await handleSensitiveStayChangeHandoff(supabase, {
          phone,
          guestId,
          guestRoom: (guest?.room as string | null) ?? null,
          text,
          msgId,
          claimedConversationId,
          sim,
          auditSource: "tier0_pre_burst",
        });
        continue;
      }

      // ── Sensitive financial shield (billing dispute / double charge / refund) ──
      // Before generic complaint copy and LLM — neutral handoff only, no promise.
      if (!isButtonReply && isSensitiveFinancialRequest(text)) {
        await handleSensitiveFinancialHandoff(supabase, {
          phone,
          guestId,
          guestRoom: (guest?.room as string | null) ?? null,
          text,
          msgId,
          claimedConversationId,
          sim,
          auditSource: "tier0_pre_burst",
        });
        continue;
      }

      // ── Date-change / cancellation request detection (typed text) ────────────
      // Guest says they can't make it, wants to change dates, or has a booking issue.
      // → Flag in DB, alert staff, send exact handoff message. No AI involved.
      if (DATE_CHANGE_RE.test(text)) {
        await patchClaimedInbound(supabase, claimedConversationId, msgId, {
          guest_id: guestId,
          intent: "date_change_request",
          human_requested: true,
          human_request_type: "date_change",
        });
        const dcConvId = claimedConversationId;

        if (guestId) {
          await supabase.from("guests").update({
            requires_attention:       true,
            requires_attention_since: new Date().toISOString(),
            needs_callback:           true,
            attention_reason:         "date_change",
          }).eq("id", guestId);
        }

        // Non-blocking alert row — visible on staff dashboard. Wrapped in an
        // async IIFE so a bare .catch() (invalid on the PromiseLike Postgrest
        // builder) doesn't throw synchronously before this even fires.
        (async () => {
          const { error } = await supabase.from("guest_alerts").insert({
            guest_id: guestId, phone,
            alert_type: "date_change_request",
            message: text, conversation_id: dcConvId, resolved: false,
          });
          if (error) {
            console.warn("[webhook] guest_alerts (date_change) error:", error.message);
            return;
          }
          onGuestAlertInserted(supabase, {
            guestId, phone, conversationId: dcConvId, message: text,
            alertType: "date_change_request", sourceLabel: "WhatsApp Bot",
          }).catch((e: Error) => console.warn("[webhook] date_change notify failed:", e.message));
        })().catch((e: Error) => console.warn("[webhook] guest_alerts (date_change) error:", e.message));

        const handoffMsg =
          "העברתי את בקשתך לצוות הסוויטות שלנו, בנתיים תכתוב לי באיזה תאריכים תרצו ואנחנו נבדוק זמינות עבורכם וניצור קשר בהקדם. 🙏";

        if (!sim) {
          try {
            await sendReply(phone, handoffMsg, { scripted: true });
            await insertGuestOutboundIfNotMuted(supabase, {
              phone, guest_id: guestId, message: handoffMsg, wa_message_id: null, intent: "date_change_request",
            });
          } catch (e) {
            console.error("[webhook] date_change reply failed:", (e as Error).message);
          }
        }
        console.info(`[webhook] 🗓️ date_change_request flagged — phone:${phone} guest:${guestId ?? "unknown"}`);
        continue;
      }

      // ── Tier-0 balloon room décor — Requests Board only (never field ops) ──
      const statusForRouting = (guest?.status as string | null) ?? guestStatusAtLookup;
      if (
        !isButtonReply &&
        guestId &&
        guest &&
        shouldInterceptBalloonRoomRequest(text)
      ) {
        await runBalloonRoomRequestIntercept(supabase, {
          phone,
          guestId,
          guest: guest as Record<string, unknown>,
          text,
          conversationId: claimedConversationId,
          sim,
        }, {
          patchInbound: async (patch) => patchClaimedInbound(supabase, claimedConversationId, msgId, patch),
          sendReply: async (replyText, intent) => {
            if (sim) return;
            await sendReply(phone, replyText, { scripted: true });
            await insertGuestOutboundIfNotMuted(supabase, {
              phone, guest_id: guestId, message: replyText, wa_message_id: null, intent,
            });
          },
          sourceLabel: "WhatsApp Bot",
          logTag: "webhook",
        });
        continue;
      }

      // ── Tier-0 administrative in-house (spa / front desk) — tasks only ─────
      if (
        !isButtonReply &&
        guestId &&
        guest &&
        shouldInterceptAdministrativeInHouseRequest(text, statusForRouting)
      ) {
        await runAdministrativeInHouseIntercept(supabase, {
          phone,
          guestId,
          guest: guest as Record<string, unknown>,
          text,
          conversationId: claimedConversationId,
          sim,
        }, {
          patchInbound: async (patch) => patchClaimedInbound(supabase, claimedConversationId, msgId, patch),
          sendReply: async (replyText, intent) => {
            if (sim) return;
            await sendReply(phone, replyText, { scripted: true });
            await insertGuestOutboundIfNotMuted(supabase, {
              phone, guest_id: guestId, message: replyText, wa_message_id: null, intent,
            });
          },
          sourceLabel: "WhatsApp Bot",
          logTag: "webhook",
        });
        continue;
      }

      // ── Tier-0 operational in-house intercept (in-house guest + amenity keyword) ──
      // After dedup claim; before burst wait / LLM — zero token cost, instant dispatch.
      if (
        !isButtonReply &&
        guestId &&
        guest &&
        shouldInterceptOperationalInHouseRequest(text, guestOpsEligibility(guest as Record<string, unknown>, statusForRouting), nowForGuest)
      ) {
        await handleOperationalInHouseIntercept(supabase, {
          phone,
          guestId,
          guest: guest as Record<string, unknown>,
          text,
          msgId,
          claimedConversationId,
          sim,
        });
        continue;
      }

      // ── Tier-0 departure / porter assist intercept (checkout + luggage help) ──
      if (
        !isButtonReply &&
        guestId &&
        guest &&
        shouldInterceptDepartureAssistRequest(text, guestOpsEligibility(guest as Record<string, unknown>, statusForRouting), nowForGuest)
      ) {
        await handleDepartureAssistIntercept(supabase, {
          phone,
          guestId,
          guest: guest as Record<string, unknown>,
          text,
          msgId,
          claimedConversationId,
          sim,
        });
        continue;
      }

      // ── Rapid burst coalescing — one LLM reply per back-to-back cluster ──
      const burst = await coalesceBurstIfLeader(supabase, phone, msgId);
      if (!burst.proceed) continue;

      let effectiveText = burst.coalescedText.trim() || text;
      if (
        !inRoomOverride && guestId && guest &&
        shouldApplyInRoomContextOverride(effectiveText, guestStatusAtLookup)
      ) {
        inRoomOverride = true;
        guest = { ...guest, status: "checked_in" };
        applyInRoomStatusOverride(supabase, guestId, phone);
        console.info(`[webhook] 🛏️ in-room keyword override (burst) → checked_in phone:${phone}`);
      }
      if (burst.coalescedText.trim() && burst.coalescedText.trim() !== text) {
        console.info(
          `[webhook] burst coalesced ${burst.coalescedText.split("\n").length} msgs — phone:${phone}`,
        );
      }

      // ── Arrival confirmation (post-burst) — before staff-claim LLM exit ──
      // Pipeline Stage 2 must fire even when Inbox "קח שיחה" is active.
      // Same fix as the pre-burst branch above: no canGuestConfirmArrival()
      // pre-check — let handleStage2ArrivalConfirmation() decide (send vs. safe
      // silent repeat), so a repeat confirm never falls through to the LLM.
      if (
        !isButtonReply &&
        isArrivalConfirmationMessage(effectiveText)
      ) {
        await handleStage2ArrivalConfirmation(supabase, {
          scripts,
          phone,
          guestId,
          guest: guest as Record<string, unknown> | null,
          sim,
          source: "burst",
          claimedConversationId,
          msgId,
        });
        console.info(`[webhook] ✅ pre-arrival confirmed (post-burst) — phone:${phone} guest:${guestId}`);
        continue;
      }

      // ── Post-burst staff-claim re-fetch (closes 1.8s race with Inbox mute) ──
      if (guestId && await refreshStaffClaimMuteFromDb(supabase, guestId)) {
        console.info(
          `[webhook] 🔇 staff claim active — post-burst early exit phone:${phone} guest:${guestId}`,
        );
        continue;
      }

      // ── Defensive Shield — emoji/courtesy-only pass (post-burst) ───────────
      if (
        !isButtonReply &&
        effectiveText !== text &&
        isLowValueCourtesyMessage(effectiveText) &&
        await guestThreadHasPriorOutbound(supabase, phone)
      ) {
        await handleCourtesyAck(supabase, { phone, guestId, msgId, claimedConversationId });
        continue;
      }

      // ── Defensive Shield — guest's own away-message auto-reply (post-burst) ─
      if (!isButtonReply && effectiveText !== text && isAutoAwayMessage(effectiveText)) {
        await handleAutoAwayMessage(supabase, { phone, guestId, msgId, claimedConversationId });
        continue;
      }

      // ── Check-in policy FAQ (post-burst) ───────────────────────────────────
      if (!isButtonReply && effectiveText !== text && isCheckInPolicyQuestion(effectiveText)) {
        await handleCheckInPolicyFaq(supabase, {
          phone,
          guestId,
          guest: guest as Record<string, unknown> | null,
          msgId,
          claimedConversationId,
          sim,
          cfg: botConfig,
        });
        continue;
      }

      // ── Severe complaint kill-switch (post-burst fragmented asks) ──────────
      if (!isButtonReply && effectiveText !== text && isSevereComplaint(effectiveText)) {
        await handleSevereComplaintKillSwitch(supabase, {
          phone, guestId, guestName, scripts, text: effectiveText, msgId, claimedConversationId, sim,
        });
        continue;
      }

      // ── Sensitive stay-change shield (post-burst fragmented asks) ──────────
      if (!isButtonReply && effectiveText !== text && isSensitiveStayChangeRequest(effectiveText)) {
        await handleSensitiveStayChangeHandoff(supabase, {
          phone,
          guestId,
          guestRoom: (guest?.room as string | null) ?? null,
          text: effectiveText,
          msgId,
          claimedConversationId,
          sim,
          auditSource: "tier0_post_burst",
        });
        continue;
      }

      // ── Sensitive financial shield (post-burst fragmented asks) ────────────
      if (!isButtonReply && effectiveText !== text && isSensitiveFinancialRequest(effectiveText)) {
        await handleSensitiveFinancialHandoff(supabase, {
          phone,
          guestId,
          guestRoom: (guest?.room as string | null) ?? null,
          text: effectiveText,
          msgId,
          claimedConversationId,
          sim,
          auditSource: "tier0_post_burst",
        });
        continue;
      }

      // ── Tier-0 balloon intercept (post-burst) ─────────────────────────────
      const statusAfterBurst = (guest?.status as string | null) ?? guestStatusAtLookup;
      if (
        !isButtonReply &&
        guestId &&
        guest &&
        effectiveText !== text &&
        shouldInterceptBalloonRoomRequest(effectiveText)
      ) {
        await runBalloonRoomRequestIntercept(supabase, {
          phone,
          guestId,
          guest: guest as Record<string, unknown>,
          text: effectiveText,
          conversationId: claimedConversationId,
          sim,
        }, {
          patchInbound: async (patch) => patchClaimedInbound(supabase, claimedConversationId, msgId, patch),
          sendReply: async (replyText, intent) => {
            if (sim) return;
            await sendReply(phone, replyText, { scripted: true });
            await insertGuestOutboundIfNotMuted(supabase, {
              phone, guest_id: guestId, message: replyText, wa_message_id: null, intent,
            });
          },
          sourceLabel: "WhatsApp Bot",
          logTag: "webhook",
        });
        continue;
      }

      // ── Tier-0 administrative intercept (post-burst) ─────────────────────
      if (
        !isButtonReply &&
        guestId &&
        guest &&
        effectiveText !== text &&
        shouldInterceptAdministrativeInHouseRequest(effectiveText, statusAfterBurst)
      ) {
        await runAdministrativeInHouseIntercept(supabase, {
          phone,
          guestId,
          guest: guest as Record<string, unknown>,
          text: effectiveText,
          conversationId: claimedConversationId,
          sim,
        }, {
          patchInbound: async (patch) => patchClaimedInbound(supabase, claimedConversationId, msgId, patch),
          sendReply: async (replyText, intent) => {
            if (sim) return;
            await sendReply(phone, replyText, { scripted: true });
            await insertGuestOutboundIfNotMuted(supabase, {
              phone, guest_id: guestId, message: replyText, wa_message_id: null, intent,
            });
          },
          sourceLabel: "WhatsApp Bot",
          logTag: "webhook",
        });
        continue;
      }

      // ── Tier-0 operational intercept (post-burst) — fragmented multi-msg asks ──
      if (
        !isButtonReply &&
        guestId &&
        guest &&
        effectiveText !== text &&
        shouldInterceptOperationalInHouseRequest(
          effectiveText,
          guestOpsEligibility(guest as Record<string, unknown>, statusAfterBurst),
          nowForGuest,
        )
      ) {
        await handleOperationalInHouseIntercept(supabase, {
          phone,
          guestId,
          guest: guest as Record<string, unknown>,
          text: effectiveText,
          msgId,
          claimedConversationId,
          sim,
        });
        continue;
      }

      // ── Tier-0 departure / porter assist intercept (post-burst) ───────────
      if (
        !isButtonReply &&
        guestId &&
        guest &&
        effectiveText !== text &&
        shouldInterceptDepartureAssistRequest(
          effectiveText,
          guestOpsEligibility(guest as Record<string, unknown>, statusAfterBurst),
          nowForGuest,
        )
      ) {
        await handleDepartureAssistIntercept(supabase, {
          phone,
          guestId,
          guest: guest as Record<string, unknown>,
          text: effectiveText,
          msgId,
          claimedConversationId,
          sim,
        });
        continue;
      }

      // ── Facility review capture (restaurant, spa, pool, etc.) — before
      // holistic stay reflections; more specific facility wins.
      if (!isButtonReply) {
        const facilityCapture = classifyFacilityReview(effectiveText);
        if (facilityCapture) {
          await saveGuestFacilityReview(supabase, { guestId, phone, capture: facilityCapture });
          await patchClaimedInbound(supabase, claimedConversationId, msgId, {
            guest_id: guestId,
            intent: "guest_feedback",
          });
          const facilityReply = buildFacilityReviewReply(
            facilityCapture.facility,
            facilityCapture.sentiment,
            facilityCapture.rating,
          );
          if (!sim) {
            try {
              await sendReply(phone, facilityReply, { scripted: true });
              await insertGuestOutboundIfNotMuted(supabase, {
                phone, guest_id: guestId, message: facilityReply, wa_message_id: null, intent: "guest_feedback",
              });
            } catch (e) {
              console.error("[webhook] 🍽️ facility review reply failed:", (e as Error).message);
            }
          }
          console.info(
            `[webhook] 🍽️ facility review captured — ${facilityCapture.facility}:${facilityCapture.sentiment} phone:${phone}`,
          );
          continue;
        }
      }

      // ── Guest feedback / sentiment reflection capture (free text) ─────────
      // Holistic stay/service reflections — NOT service-fault complaints
      // (those still flow through COMPLAINT_PATTERNS below, unchanged). Every
      // other Tier-0 intercept (severe complaint, sensitive stay/financial,
      // date-change, administrative/operational in-house) already had its
      // chance above and would have `continue`d — only genuine review-style
      // text reaches this point. Written to guest_feedback (Guest Feedback &
      // Sentiment Dashboard) instead of tasks/guest_alerts, so a "the stay was
      // amazing!" message stops showing up on the operational Requests board.
      if (!isButtonReply) {
        const reflectionSentiment = classifyGuestReflection(effectiveText);
        if (reflectionSentiment) {
          await saveGuestFeedback(supabase, {
            guestId, phone, sentiment: reflectionSentiment,
            text: effectiveText, source: "freeform_reflection",
          });
          await patchClaimedInbound(supabase, claimedConversationId, msgId, {
            guest_id: guestId,
            intent: "guest_feedback",
          });
          const reflectionReply = buildReflectionReply(reflectionSentiment);
          if (!sim) {
            try {
              await sendReply(phone, reflectionReply, { scripted: true });
              await insertGuestOutboundIfNotMuted(supabase, {
                phone, guest_id: guestId, message: reflectionReply, wa_message_id: null, intent: "guest_feedback",
              });
            } catch (e) {
              console.error("[webhook] 📝 reflection reply failed:", (e as Error).message);
            }
          }
          console.info(
            `[webhook] 📝 guest reflection captured — sentiment:${reflectionSentiment} phone:${phone} guest:${guestId ?? "unknown"}`,
          );
          continue;
        }
      }

      // ── Load conversation history early — used for context in ALL intents ──
      // Fetch last 20 rows, filter out system markers, keep last 10 real turns.
      const orderedHistory = await fetchGuestChatHistory(supabase, phone, {
        channel: "unified",
        limit: 6,
      });

      // ── Classify intent (< 1 ms, no AI cost) ─────────────────────────────
      const intent = classifyIntent(effectiveText);

      // ── Detect human-agent request (shared brain — Meta + Whapi) ─────────
      const humanReq = detectGuestHumanRequest(effectiveText);
      if (humanReq.requested) {
        console.info(`[webhook] 🙋 human_requested="${humanReq.type}" phone=${phone}`);
      }

      console.info(
        `[webhook] ${phone} | intent="${intent}" | human_req=${humanReq.requested} | "${effectiveText.slice(0, 70)}"`
      );

      // ── Patch claimed inbound row with final intent (no second insert) ───
      await patchClaimedInbound(supabase, claimedConversationId, msgId, {
        guest_id: guestId,
        intent,
        human_requested: humanReq.requested,
        human_request_type: humanReq.type,
        ...(effectiveText !== text ? { message: effectiveText } : {}),
      });
      const conversationId = claimedConversationId;

      // ── Human-handover mode: message logged, no bot reply ─────────────────
      if (!botIsActive || staffClaimActive) {
        console.info(
          `[webhook] 🤫 bot paused — inbound logged, skipping reply to ${phone}` +
          (staffClaimActive ? " (staff claim)" : ""),
        );
        continue;
      }

      // ── Route & generate reply ────────────────────────────────────────────
      // Captured once so the final deflection-detection check (near send time,
      // below) can compare the eventual `reply` against this exact default —
      // whether it came from the editable BotScriptEditor script or the
      // hardcoded constant — without re-deriving it or matching brittle text.
      const fallbackReplyText = scripts["fallback_reply"]?.message_text?.trim() || FALLBACK_REPLY;
      let reply = fallbackReplyText;
      let replyIsScripted = intent === "complaint" || intent === "upsell";
      // Set only inside the "faq" branch below when the model invokes
      // log_guest_request — drives the conditional guest_alerts gate further down.
      let toolLoggedRequest: GuestAiReplyResult["loggedRequest"] = null;
      let toolLoggedFacilityReview: FacilityReviewCapture | null = null;
      // Unfiltered tool call (before filterToolLoggedRequest's allowlist/grounding
      // gate) — kept only to detect a suppressed request that left a false
      // "העברתי את הבקשה (X)" ack baked into `reply` (see reply-integrity check
      // below, session 2026-07-11 fix).
      let rawToolLoggedRequest: GuestAiReplyResult["loggedRequest"] = null;

      // ── Tier-0 human/callback request — skip LLM on faq/fallback only.
      // Complaint/upsell keep their scripted paths. Never invent "please contact
      // us" when the guest asked staff to get back to them (2026-07-12).
      if (humanReq.requested && (intent === "faq" || intent === "fallback")) {
        reply = buildGuestHumanRequestReply(humanReq.type);
        replyIsScripted = true;
        console.info(
          `[webhook] 🙋 human-request Tier-0 reply type="${humanReq.type}" phone=${phone}`,
        );
      } else if (intent === "complaint") {
        // Use complaint_reply from BotScriptEditor if available, else fallback to hardcoded
        const complaintScript = scripts["complaint_reply"];
        if (complaintScript?.message_text?.trim()) {
          reply = resolvePlaceholders(complaintScript.message_text, {
            guestName: guestName ?? "אורח יקר", spaTime: null, workshopUrl: "",
          });
        } else {
          reply = buildComplaintReply(guestName);
        }
        // Non-blocking DB alert — duty manager dashboard picks this up
        flagGuestAlert(supabase, phone, guestId, effectiveText, conversationId)
          .catch((e: Error) =>
            console.error("[webhook] flagGuestAlert error:", e.message)
          );

      } else if (intent === "upsell") {
        if (guest && isPendingPortalSpaRequest(guest as Record<string, unknown>)) {
          reply =
            "ראינו שביקשת טיפול בספא, העברתי את הבקשה לצוות, אפשר גם לחייג למרכז ההזמנות שלנו - 08-6705600.";
        } else {
        // Use upsell_reply from BotScriptEditor if available
        const upsellScript = scripts["upsell_reply"];
        if (upsellScript?.message_text?.trim()) {
          reply = resolvePlaceholders(upsellScript.message_text, {
            guestName: guestName ?? "אורח יקר", spaTime: null, workshopUrl: "",
          });
        } else {
          reply = buildUpsellReply(guestName);
        }
        }

      } else if (intent === "faq") {
        const guestCtxLine = formatGuestContextLine(
          guest as Record<string, unknown> | null,
          orderedHistory,
          { forceInHouse: inRoomOverride },
        );
        const brain = await assembleGuestBrainPrompt(supabase, "meta", {
          guestContextLine: guestCtxLine,
          inHouse: inRoomOverride,
          userMessage: effectiveText,
        });
        console.info(`[webhook] prompt source: ${brain.promptSource} rag_conf=${brain.ragConfidence.toFixed(2)}`);

        if (brain.lowConfidenceHandoff) {
          reply = GUEST_STAFF_HANDOFF_SENTENCE;
          replyIsScripted = true;
          console.info(`[webhook] 🛡️ RAG low-confidence handoff — phone:${phone}`);
        } else {
          const enrichedPrompt = brain.systemPrompt
            + (guest && isPendingPortalSpaRequest(guest as Record<string, unknown>)
              ? `\n\n${PENDING_PORTAL_SPA_LLM_SUFFIX}` : "");

          try {
            const result = await generateGuestChatReplyWithTools({
              userMessage: effectiveText,
              guestName,
              history: orderedHistory,
              systemPrompt: enrichedPrompt,
              preferredModel: brain.preferredModel,
              toolInstructionsSuffix: brain.routingSuffix,
              logTag: "webhook",
              failoverLog: { supabase, guestPhone: phone },
            });
            reply = sanitizeReply(result.text);
            if (isReplyObviouslyTruncated(reply)) {
              console.warn(
                `[webhook] 🛡️ FAQ engine truncated — substituting check-in policy reply — phone:${phone}`,
              );
              reply = resolveTruncatedReplyFallback(
                reply,
                effectiveText,
                botConfig,
                (guest?.arrival_date as string) ?? null,
                FALLBACK_REPLY,
              );
            }
            rawToolLoggedRequest = result.loggedRequest;
            toolLoggedRequest = filterToolLoggedRequest(effectiveText, result.loggedRequest);
            toolLoggedFacilityReview = result.loggedFacilityReview;
          } catch (e) {
            console.error("[webhook] generateGuestChatReplyWithTools failed:", (e as Error).message);
            reply = FALLBACK_REPLY;
          }
        }
      }
      // else "fallback" → FALLBACK_REPLY already set

      // ── Tool-ack reply integrity (session 2026-07-11 fix) — filterToolLoggedRequest
      // only ever gated whether a task/alert gets CREATED; it never touched `reply`
      // itself. When the model's own text was empty, _buildToolOnlyReply already
      // baked "בחירה מצוינת! העברתי את הבקשה (X) לצוות שלנו…" into `result.text`
      // BEFORE the filter ran — so a suppressed/ungrounded tool call could still
      // reach the guest as a false confirmation (the exact incident: luggage/
      // checkout text, filtered tool call, but the towels-and-robe ack shipped
      // anyway). If the raw call was present and got filtered to null, and the
      // reply still carries that ack template, replace it with the canonical
      // staff handoff — truthful regardless of which board (if any) picks this up.
      if (rawToolLoggedRequest && !toolLoggedRequest && looksLikeToolOnlyAck(reply)) {
        console.warn(
          `[webhook] 🛡️ ungrounded/suppressed tool ack replaced with handoff — summary:"${rawToolLoggedRequest.summary}" text:"${effectiveText.slice(0, 80)}"`,
        );
        reply = GUEST_STAFF_HANDOFF_SENTENCE;
      }

      // ── Day-Guest Upsell Gate (Session 27 Sprint 4.3) — a day-guest ("בילוי
      // יומי") has no suite room service to fulfil, so a log_guest_request call
      // from one never becomes an ops ticket. Instead of just refusing, this
      // redirects the moment into a live-inventory upsell: check today's two
      // Premium Day slots and offer the free one, or point at "next time" if
      // both are taken. toolLoggedRequest is cleared so the blocks below (guest
      // _alerts insert, Dual-Routing Trigger) never see it — day-guest requests
      // stop here, by design (CLAUDE.md §0.4 — extend the existing gate, don't
      // bolt on a parallel "day-guest ticket" path).
      const guestRoomType = (guest as Record<string, unknown> | null)?.room_type as string | null ?? null;
      if (toolLoggedRequest && guestRoomType === "day_guest") {
        const premiumFree = await isPremiumDaySlotAvailableToday(supabase);
        reply = premiumFree
          ? "סוויטת הפרימיום שלנו פנויה היום לבילוי יומי, מעוניין לשריין לפני שיתפס? ✨"
          : "בפעם הבאה אתה מוזמן לביקור לינה בסוויטות שלנו או ב-PREMIUM DAY המפואר שלנו 🌟";
        console.info(`[webhook] 🏊 day-guest upsell gate fired — phone:${phone} premiumFree:${premiumFree}`);
        toolLoggedRequest = null;
      }

      if (toolLoggedFacilityReview) {
        await saveGuestFacilityReview(supabase, {
          guestId,
          phone,
          capture: toolLoggedFacilityReview,
        });
        console.info(
          `[webhook] 🍽️ facility review saved (LLM tool) — ${toolLoggedFacilityReview.facility} phone:${phone}`,
        );
      }

      // ── Zero-Rejection Future-Guest Routing (replaces the Session 30 Sprint
      // 5.5 "Pre-Check-In Guardrail") — "SYSTEM ARCHITECTURE, ZERO-REJECTION,
      // ROOM MASKING & UX" session. The old guardrail told a suite guest who
      // hadn't checked in yet that their request couldn't even be opened —
      // a cold rejection, and it also leaked the literal room name
      // (guestRoom) into a pre-check-in guest-facing message, which Room
      // Masking (below) now forbids regardless. Replaced: the request is
      // ALWAYS accepted gracefully and lands on the Requests Board
      // (guest_alerts — a sales/heads-up lead reviewed at staff's own pace,
      // NOT the Operations Board/tasks claim-and-SLA queue, since nobody is
      // on-site yet to fulfil it) tagged with the guest's arrival date, plus
      // a direct personal heads-up to Adir so the team isn't surprised later.
      // Day-guest already exited above via its own Upsell Gate and never
      // reaches here; this fires for suite/standard guests not yet
      // 'checked_in'.
      const guestStatus = (guest as Record<string, unknown> | null)?.status as string | null ?? null;
      const guestArrivalDate = (guest as Record<string, unknown> | null)?.arrival_date as string | null ?? null;
      const guestOpsCtx = guestOpsEligibility(guest as Record<string, unknown> | null);
      if (
        toolLoggedRequest
        && guestRoomType !== "day_guest"
        && !isGuestEligibleForInHouseOpsDispatch(guestOpsCtx, nowForGuest)
      ) {
        // Same exact tag format/day-count math as guest-portal-upsell's and
        // guest-portal-ops-request's futureArrivalTag() ("PORTAL CTAS & ADIR'S
        // FUTURE CONTEXT" session) — duplicated, not imported (Deno function
        // boundary). Self-review catch: an earlier version of this block
        // tagged a same-day-but-not-yet-checked-in guest as "🟡 הגעה עתידית"
        // too, which is misleading (they're arriving TODAY, just haven't
        // walked in yet) — null here correctly means "no future tag", not
        // "no message", the request still routes gracefully either way.
        let futureTag: string | null = null;
        if (guestArrivalDate) {
          const today = new Date(); today.setUTCHours(0, 0, 0, 0);
          const arrival = new Date(`${guestArrivalDate}T00:00:00Z`);
          const daysAway = Math.round((arrival.getTime() - today.getTime()) / 86400000);
          if (daysAway > 0) futureTag = `⚠️ בקשה עתידית לתאריך ${guestArrivalDate} - בעוד ${daysAway} ימים`;
        }
        const tagPrefix = futureTag ? `[${futureTag}] ` : "";
        (async () => {
          const guestRoomForAlert = (guest as Record<string, unknown> | null)?.room as string | null ?? null;
          const guestNameForAlert = (guest as Record<string, unknown> | null)?.name as string | null ?? null;
          const alertMsg = `${tagPrefix}${toolLoggedRequest!.summary ?? effectiveText}`;
          const { error } = await supabase.from("guest_alerts").insert({
            guest_id: guestId, phone,
            alert_type: toolLoggedRequest!.category ?? "request",
            message: alertMsg,
            conversation_id: conversationId, resolved: false,
          });
          if (error) {
            console.error("[webhook] 🚨 guest_alerts (future-guest request) insert FAILED:", error.message);
            return;
          }
          onGuestAlertInserted(supabase, {
            guestId, phone, conversationId, message: alertMsg,
            alertType: toolLoggedRequest!.category ?? "request",
            guestName: guestNameForAlert, room: guestRoomForAlert,
            sourceLabel: "WhatsApp Bot",
            alsoPersonalDm: false,
          }).catch((e: Error) => console.warn("[webhook] future-guest group notify failed:", e.message));
        })().catch((e: Error) => console.error("[webhook] 🚨 guest_alerts (future-guest request) insert FAILED:", e.message));

        // Best-effort personal heads-up — Adir gets the real room (staff need
        // it to plan; only GUEST-facing messages are masked, see Room Masking
        // below), never blocks the guest's reply on a Whapi failure.
        const guestRoomForAdir = (guest as Record<string, unknown> | null)?.room as string | null ?? "—";
        const guestNameForAdir = (guest as Record<string, unknown> | null)?.name as string | null ?? null;
        loadStaffNotifyTemplates(supabase).then((templates) =>
          sendWhapiText(
            ADIR_PERSONAL_PHONE,
            buildPreCheckinGuestRequestAdirText({
              room: guestRoomForAdir,
              guestName: guestNameForAdir,
              summary: String(toolLoggedRequest.summary ?? effectiveText),
              futureTag,
              arrivingToday: !futureTag,
              templates,
            }),
            { noLinkPreview: true },
          ),
        ).catch((e: Error) => console.warn("[webhook] future-guest Adir alert failed (non-blocking):", e.message));

        reply =
          "בשמחה רבה! העברתי את הבקשה המיוחדת שלך לצוות הריזורט כדי שנדאג שהכול יחכה לכם מוכן ומפנק " +
          "בדיוק ברגע שתפתחו את דלת הסוויטה. נתראה בקרוב!🌸";
        console.info(`[webhook] 🌴 future-guest request routed gracefully — phone:${phone} status:${guestStatus}`);
        toolLoggedRequest = null;
      }

      // ── guest_notes: blanket free-text history for every faq/fallback message ──
      // complaint/upsell already raise their own alert (flagGuestAlert / dedicated
      // reply above). This note log stays blanket on purpose — it's just an
      // append-only per-guest history, not a staff-facing ticket, so there's no
      // noise cost to capturing everything. (guest_alerts below is the selective
      // one — see Phase 2 comment further down.) Non-blocking: a logging failure
      // here must never affect the reply already being sent. .then() with a single
      // callback (not a chained .catch()) is the safe pattern for this Postgrest
      // builder — see whatsapp-send's BRANCH D note.
      // Deliberately NOT gated on arrival_confirmed: a pre-arrival request
      // ("balloons for a birthday") is the case staff most need lead time on —
      // gating this on confirmed-arrival silently dropped exactly that case.
      if (guestId && (intent === "faq" || intent === "fallback")) {
        const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
        const noteLine = `[${stamp}] ${effectiveText}`;
        const newNotes = guest?.guest_notes ? `${guest.guest_notes}\n${noteLine}` : noteLine;
        supabase
          .from("guests")
          .update({ guest_notes: newNotes })
          .eq("id", guestId)
          .then(({ error }: { error: { message: string } | null }) => {
            if (error) console.error("[webhook] guest_notes capture error:", error.message);
          });

        // ── Dispatch matrix (allowlist-gated):
        //   operational_field_ops → Whapi EN + Operations Board (tasks/תפעול)
        //   requests_board → guest_alerts only (pre-check-in / manager / price)
        //   kb_only → no staff ticket (FAQ answered in chat)
        const dispatchRoute = classifyGuestRequestDispatch(effectiveText, guestOpsCtx, nowForGuest);
        const criticalKeywordHit = intent === "faq" && !toolLoggedRequest
          && isRequestsBoardEscalation(effectiveText);

        if (toolLoggedRequest && guestId && dispatchRoute === "operational_field_ops") {
          const guestRoom = (guest as Record<string, unknown> | null)?.room as string | null ?? null;
          // effectiveText may be burst-coalesced — narrow to the allowlisted
          // line(s) before classification, same as the Tier-0 path in
          // handleOperationalInHouseIntercept (see extractAllowlistedRequestLines).
          const dispatchText = extractAllowlistedRequestLines(effectiveText);
          createGuestOpsTask({
            supabase,
            guestId,
            phone,
            guestName,
            room: guestRoom,
            summary: toolLoggedRequest.summary,
            rawText: effectiveText,
            dispatchText,
          }).catch((e: Error) => console.error("[webhook] 🛋️ createGuestOpsTask error:", e.message));
          // Same Inbox red-dot flag as the Tier-0 operational intercept above —
          // this LLM-tool path (log_guest_request) never went through guest_alerts
          // either, so it was equally invisible in WhatsAppInbox.js until now.
          patchClaimedInbound(supabase, claimedConversationId, msgId, {
            human_requested: true,
            human_request_type: "operational_request",
          }).catch((e: Error) => console.warn("[webhook] 🛋️ operational LLM-path inbox flag failed:", e.message));
          console.info(
            `[webhook] dispatch=operational_field_ops (LLM path, PENDING APPROVAL) phone:${phone} guest:${guestId} room:${guestRoom ?? "—"}`,
          );
        } else if (
          guestId
          && dispatchRoute === "admin_reception_tasks"
          && isAdministrativeInHouseRequest(effectiveText)
        ) {
          const guestRoom = (guest as Record<string, unknown> | null)?.room as string | null ?? null;
          logAdministrativeRequestAlert(supabase, {
            phone,
            guestId,
            room: guestRoom,
            summary: buildAdministrativeRequestSummary(effectiveText),
            rawText: effectiveText,
            conversationId,
            guestName,
          }).catch((e: Error) => console.error("[webhook] 📋 admin LLM-path alert error:", e.message));
          console.info(`[webhook] dispatch=admin_reception_tasks phone:${phone} guest:${guestId}`);
        } else if (criticalKeywordHit) {
          console.info(`[webhook] 🛟 dispatch=requests_board (critical keyword) phone:${phone}`);
          (async () => {
            const { error } = await supabase.from("guest_alerts").insert({
              guest_id: guestId, phone, alert_type: "request",
              message: effectiveText, conversation_id: conversationId, resolved: false,
            });
            if (error) {
              console.error("[webhook] 🚨 guest_alerts (request) insert FAILED:", error.message);
              return;
            }
            const guestRoom = (guest as Record<string, unknown> | null)?.room as string | null ?? null;
            onGuestAlertInserted(supabase, {
              guestId, phone, conversationId, message: effectiveText, alertType: "request",
              guestName, room: guestRoom, sourceLabel: "WhatsApp Bot",
            }).catch((e: Error) => console.warn("[webhook] request keyword notify failed:", e.message));
          })().catch((e: Error) => console.error("[webhook] 🚨 guest_alerts (request) insert FAILED:", e.message));
        } else if (guestId && isBalloonRoomRequest(effectiveText)) {
          console.info(`[webhook] 🎈 dispatch=requests_board (balloon LLM path) phone:${phone}`);
          (async () => {
            const guestRoom = (guest as Record<string, unknown> | null)?.room as string | null ?? null;
            const balloonMsg = `🎈 בקשת בלונים לחדר${guestRoom ? ` (${guestRoom})` : ""}: ${effectiveText}`;
            const { error } = await supabase.from("guest_alerts").insert({
              guest_id: guestId, phone, alert_type: "request",
              message: balloonMsg,
              conversation_id: conversationId, resolved: false,
            });
            if (error) {
              console.error("[webhook] 🎈 guest_alerts (balloon) insert FAILED:", error.message);
              return;
            }
            onGuestAlertInserted(supabase, {
              guestId, phone, conversationId, message: balloonMsg, alertType: "request",
              guestName, room: guestRoom, sourceLabel: "WhatsApp Bot",
            }).catch((e: Error) => console.warn("[webhook] 🎈 balloon LLM notify failed:", e.message));
          })().catch((e: Error) => console.error("[webhook] 🎈 guest_alerts (balloon) insert FAILED:", e.message));
        }
      }

      // ── Balloon room reply override — never imply field-ops dispatch ───────
      if (isBalloonRoomRequest(effectiveText)) {
        reply = buildBalloonRoomRequestReply(guestName);
      }

      // ── Pre-send safety nets — mutually exclusive, most severe first. Each
      // catches the rare case where the signal slipped past the earlier Tier-0
      // check (e.g. arrived as a button reply, or only became true once
      // combined with burst-coalesced text after that check already ran).
      // Severity order matters here — a message that is both a severe
      // complaint AND mentions billing must get the complaint handling, not
      // the financial one, so this is an if/else-if chain, not three ifs.
      if (isSevereComplaint(effectiveText)) {
        // No LLM free text here — the fixed complaint_reply template only.
        const complaintScript = scripts["complaint_reply"];
        reply = complaintScript?.message_text?.trim()
          ? resolvePlaceholders(complaintScript.message_text, {
              guestName: guestName ?? "אורח יקר", spaTime: null, workshopUrl: "",
            })
          : buildComplaintReply(guestName);
        if (guestId) {
          supabase
            .from("guests")
            .update({
              requires_attention:       true,
              requires_attention_since: new Date().toISOString(),
              needs_callback:           true,
              attention_reason:         "severe_complaint",
            })
            .eq("id", guestId)
            .then(({ error }: { error: { message: string } | null }) => {
              if (error) {
                console.error("[webhook] 🚨 pre_send severe_complaint guest update FAILED:", error.message);
              }
            });
        }
        (async () => {
          const { error } = await supabase.from("guest_alerts").insert({
            guest_id: guestId, phone,
            alert_type: "severe_complaint",
            message: effectiveText, conversation_id: conversationId, resolved: false,
          });
          if (error) {
            console.error("[webhook] 🚨 pre_send severe_complaint guest_alerts insert FAILED:", error.message);
            return;
          }
          onGuestAlertInserted(supabase, {
            guestId, phone, conversationId, message: effectiveText,
            alertType: "severe_complaint", guestName, sourceLabel: "WhatsApp Bot",
          }).catch((e: Error) => console.warn("[webhook] pre_send severe notify failed:", e.message));
        })().catch((e: Error) => console.error("[webhook] 🚨 pre_send severe_complaint guest_alerts insert FAILED:", e.message));
        saveGuestFeedback(supabase, {
          guestId, phone, sentiment: "negative", text: effectiveText, source: "severe_complaint",
        }).catch((e: Error) => console.error("[webhook] 🚨 pre_send severe_complaint guest_feedback insert FAILED:", e.message));
        console.info(
          `[webhook] 🚨 SEVERE_COMPLAINT mitigation — source:pre_send_guard, canned template sent — phone:${phone} guest:${guestId ?? "unknown"}`,
        );
      } else if (isSensitiveStayChangeRequest(effectiveText)) {
        // ── LLM/upsell must never imply stay-change approval ──
        reply = CANONICAL_STAY_CHANGE_HANDOFF_MSG;
        if (guestId) {
          supabase
            .from("guests")
            .update({
              requires_attention:       true,
              requires_attention_since: new Date().toISOString(),
              needs_callback:           true,
              attention_reason:         "date_change",
            })
            .eq("id", guestId)
            .then(({ error }: { error: { message: string } | null }) => {
              if (error) {
                console.error("[webhook] 🛡️ pre_send sensitive_stay guest update FAILED:", error.message);
              }
            });
        }
        console.info(
          `[webhook] 🛡️ SENSITIVE_STAY_CHANGE mitigation — source:pre_send_guard phone:${phone} guest:${guestId ?? "unknown"}`,
        );
      } else if (isSensitiveFinancialRequest(effectiveText)) {
        // ── LLM/upsell must never imply a billing outcome ──
        reply = CANONICAL_FINANCIAL_HANDOFF_MSG;
        if (guestId) {
          supabase
            .from("guests")
            .update({
              requires_attention:       true,
              requires_attention_since: new Date().toISOString(),
              needs_callback:           true,
              attention_reason:         "financial_issue",
            })
            .eq("id", guestId)
            .then(({ error }: { error: { message: string } | null }) => {
              if (error) {
                console.error("[webhook] 💳 pre_send sensitive_financial guest update FAILED:", error.message);
              }
            });
        }
        console.info(
          `[webhook] 💳 SENSITIVE_FINANCIAL mitigation — source:pre_send_guard phone:${phone} guest:${guestId ?? "unknown"}`,
        );
      }

      // ── Truncation guard — LLM replies only; scripted complaint/upsell must not
      // be replaced (portal URLs / 🥰 endings are valid complete messages).
      if (!replyIsScripted && isReplyObviouslyTruncated(reply)) {
        console.warn(
          `[webhook] 🛡️ truncated reply guard — phone:${phone} tail:"${reply.slice(-50)}"`,
        );
        reply = resolveTruncatedReplyFallback(
          reply,
          effectiveText,
          botConfig,
          (guest?.arrival_date as string) ?? null,
          FALLBACK_REPLY,
        );
      }

      // Explicit human/callback Tier-0 already flagged the inbound row with the
      // precise type (call/chat) — do not reclassify as staff_handoff below.
      const isLowConfidenceFaqMiss =
        !humanReq.requested && isGuestStaffHandoffReply(reply);
      // Generic "no real answer, passing this to reception" deflection — fires
      // when intent stayed "fallback" (unmatched/very short text), both AI
      // engines threw, or the truncation guard above fell all the way back to
      // the generic script instead of the check-in-policy substitute. Same bug
      // class as isLowConfidenceFaqMiss: the guest already receives a reply that
      // promises staff follow-up, but nothing told staff to expect it — neither
      // requires_attention nor the Inbox's human_requested flag were ever set.
      const isGenericFallbackHandoff =
        !isLowConfidenceFaqMiss && (reply === fallbackReplyText || reply === FALLBACK_REPLY);

      if ((isLowConfidenceFaqMiss || isGenericFallbackHandoff) && guestId) {
        supabase
          .from("guests")
          .update({
            requires_attention:       true,
            requires_attention_since: new Date().toISOString(),
            attention_reason:         isLowConfidenceFaqMiss ? "שאלה מורכבת לצוות" : "fallback_no_match",
          })
          .eq("id", guestId)
          .then(({ error }: { error: { message: string } | null }) => {
            if (error) console.error("[webhook] 🤔 deflection-handoff guest update FAILED:", error.message);
          });
      }

      if (isLowConfidenceFaqMiss || isGenericFallbackHandoff) {
        // Mirrors every guest_alerts-based Tier-0 shield, which already gets
        // this for free via onGuestAlertInserted→triggerInboxRedAlert — these
        // two deflection paths never insert a guest_alerts row, so they need
        // the same flag set directly on the inbound row.
        patchClaimedInbound(supabase, claimedConversationId, msgId, {
          human_requested: true,
          human_request_type: "staff_handoff",
        }).catch((e: Error) => console.warn("[webhook] 🤔 deflection-handoff inbox flag failed:", e.message));
      }

      if (isLowConfidenceFaqMiss) {
        console.info(
          `[webhook] 🤔 low-confidence FAQ miss — sending handoff message + staff flagged — phone:${phone} guest:${guestId ?? "unknown"}`,
        );
      }

      if (guest && (guest as Record<string, unknown>).status === "cancelled") {
        // Zero-Spam Policy (§CORE BUSINESS LOGIC): cancelled guests never receive bot messages.
        // NOTE: guestId===null (unregistered number) and status==="checked_out" must still get a
        // reply — isGuestActiveForOutbound() is for scheduled/automation outbound only (cron,
        // stage sends); applying it here silenced the bot for every unknown contact and every
        // post-stay guest who messaged back. Regression introduced in f00bae6 (2026-07-05).
        console.info(
          `[webhook] 🔕 cancelled guest — auto-reply suppressed (inbound logged) — phone:${phone}`,
        );
      } else {
        // ── Send WhatsApp reply ─────────────────────────────────────────────
        let outboundMsgId: string | null = null;
        try {
          const sendOpts =
            replyIsScripted || isLowConfidenceFaqMiss ? { scripted: true as const } : undefined;
          outboundMsgId = await sendReply(phone, reply, sendOpts);
        } catch (e) {
          console.error("[webhook] sendReply error:", (e as Error).message);
        }

        // ── Save outbound message ───────────────────────────────────────────
        await insertGuestOutboundIfNotMuted(supabase, {
          phone,
          guest_id:      guestId,
          message:       reply,
          wa_message_id: outboundMsgId,
          intent,
        });

        if (!_suppressGuestRepliesStaffClaim) {
          console.info(
            `[webhook] ✅ replied (${intent}) to ${phone} | msgId=${outboundMsgId}`
          );
        }
      }
      } catch (e) {
        const errMsg = (e as Error)?.message ?? String(e);
        console.error(`[webhook] 🛡️ per-message processing EXCEPTION phone:${phone}:`, errMsg, (e as Error)?.stack);
        try {
          await supabase.from("whatsapp_conversations").insert({
            phone, inbox_channel: "meta", direction: "outbound",
            message: `[SYSTEM] ⚠️ שגיאה פנימית בעיבוד ההודעה — הצוות טופל, לא נשלחה תשובה אוטומטית. (${errMsg.slice(0, 200)})`,
            intent: null,
          });
        } catch (_e2) { /* best-effort — never let logging failure mask the original error */ }
      }
    }
  };

  // "Fire-and-forget" is not actually guaranteed on the Supabase/Deno Deploy
  // isolate model — once the HTTP Response below is returned, the runtime may
  // freeze/terminate the isolate before an un-awaited async task finishes.
  // processAsync() routinely takes 2-5s+ (BURST_COALESCE_MS=1800 alone, plus
  // the Gemini/Claude round-trip) — comfortably longer than the best-effort
  // grace period, so replies were being silently cut off after the inbound
  // insert (which resolves fast) but before sendReply() ran. EdgeRuntime.
  // waitUntil() is the documented Supabase mechanism to keep the isolate
  // alive until the given promise settles, without delaying the response
  // Meta receives. Falls back to the old un-awaited call if the runtime
  // (e.g. local `supabase functions serve`) doesn't expose it.
  const backgroundTask = processAsync().catch((e) =>
    console.error("[webhook] processAsync error:", e)
  );
  const edgeRuntime = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (typeof edgeRuntime?.waitUntil === "function") {
    edgeRuntime.waitUntil(backgroundTask);
  } else {
    // Runtimes without EdgeRuntime (local `supabase functions serve`) — awaiting
    // is the only way to avoid the isolate freezing before sendReply() runs.
    await backgroundTask;
  }

  // Respond to Meta within 20 s window
  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...CORS, "Content-Type": "application/json" },
  });
});

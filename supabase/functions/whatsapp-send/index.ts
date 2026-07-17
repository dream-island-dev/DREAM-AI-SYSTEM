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
//   room_ready       → guests.room_ready_notified + msg_room_ready_sent = true
//   mid_stay         → guests.msg_mid_stay_sent        = true
//   checkout_fb      → guests.msg_checkout_fb_sent     = true
//   broadcast        → no pipeline flag (ad-hoc sends)
//
// Outbound logging invariant (whatsapp_conversations WYSIWYG guarantee):
//   Every branch dispatches over exactly one channel — a Meta template
//   (sendViaTemplate) or a free-text 24h session message (sendViaMeta /
//   sendStageSessionMessage / sendInteractiveButtons) — and the row written
//   to whatsapp_conversations MUST describe that same channel with the same
//   literal content, never a name-based guess or a copy tracked separately
//   from the actual send call. sendViaTemplate returns a DispatchedTemplate
//   ({templateName, variables} — the exact pair embedded in the accepted
//   Meta payload, post any internal padding/fallback correction); every call
//   site threads that return value into buildConversationLogFromTemplate
//   instead of re-using the pre-send template name/vars it happened to have
//   lying around. Session sends already log the literal string handed to the
//   Meta call, so no reconstruction step exists there to drift. The [META]/
//   [SESSION] prefix (formatOutboundConversationLog) is likewise always
//   derived from the branch that actually executed (e.g. usedSessionMessage,
//   nightBeforeDispatch.channel, dpChannel, rrDispatch.channel) — never from
//   the stage's initial/intended configuration.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendImageMessage, sendInteractiveButtons } from "../_shared/interactiveSend.ts";
import { isArrivalTodayIsrael, israelTodayYmd } from "../_shared/israelDate.ts";
import { sanitizeMetaRecipientPhone } from "../_shared/metaPhone.ts";
import { sendWhapiText, sendWhapiImage, cleanPhoneForMention } from "../_shared/whapiSend.ts";
import { ensureArrivalConfirmationCta } from "../_shared/arrivalConfirmation.ts";
import {
  DAYPASS_SESSION_FIRST_TRIGGERS,
  ensureDaypassWindowOpenerCta,
} from "../_shared/daypassWindowOpener.ts";
import { isStageEffectivelyActive } from "../_shared/guestWhapiRouting.ts";
import {
  guardPaymentLink,
  logPaymentLinkFailure,
  PAYMENT_LINK_FAILURE_LABEL,
} from "../_shared/paymentLinkGuard.ts";

import {
  getTemplateQuickReplyButtons,
  resolveMetaTemplateBodyText,
} from "../_shared/metaTemplateLog.ts";
import {
  buildTwoParamRoomVars,
  fitVarsToExpectedCount,
  resolveExpectedBodyParamCount,
  TWO_PARAM_ROOM_TEMPLATES,
} from "../_shared/metaTemplateVars.ts";
import {
  buildOptionalSpaText,
  buildSpaLine,
  buildSpaTimeSentence,
  hasSpaBooking,
  normalizeHmTime,
  normalizeSpaDateYmd,
} from "../_shared/spaSchedule.ts";
import {
  checkPipelineDuplicate,
  duplicateBlockedResponseBody,
  logDuplicateBlocked,
} from "../_shared/automationDuplicateGuard.ts";
import { claimDispatchAttempt, finalizeDispatchAttempt } from "../_shared/automationClaim.ts";
import {
  assertGuestEligibleForAutomation,
  GUEST_NOT_ACTIVE_HE,
  loadGuestByPhoneForStaffReply,
} from "../_shared/guestOutboundGuard.ts";
import { assertPipelineLifecycleForTrigger } from "../_shared/pipelineLifecycle.ts";
import { getAutomationScopeTriggerBlockReason } from "../_shared/automationSchedule.ts";
import {
  hasSuiteRoomTypeConflict,
  isCanonicalSuiteRoom,
  isEffectiveDayPassGuest,
  isEffectiveSuiteGuest,
} from "../_shared/suiteNames.ts";
import { assertMetaMessageAccepted } from "../_shared/metaWamid.ts";
import {
  isSuiteRoomReadyAlreadySent,
  markSuiteRoomReadySent,
  syncGuestRoomReadyAggregate,
} from "../_shared/suiteRoomReady.ts";
import {
  isGuestWhapiSuitesEnabled,
  shouldRouteGuestOutboundViaWhapiSuites,
  isMetaGuestTemplateAllowed,
  primeGuestChannelConfig,
  whapiDisabledReasonHe,
} from "../_shared/guestWhapiRouting.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Phase C claim-before-send, shared wrapper (2026-07-17) ────────────────────
// Wraps _shared/automationClaim.ts for every dedicated dispatch block AND the
// generic BRANCH D path: claim the (guest, trigger) slot right before the send
// attempt; on conflict return the same in_flight response everywhere so two
// overlapping cron ticks (or a cron tick racing a manual Override) can never
// dispatch the same guest+trigger concurrently. `force` (staff Override)
// bypasses the uniqueness check but still creates the audit row.
type StageClaim =
  | { claim: { claimed: true; logId: number }; conflictResponse?: undefined }
  | { claim?: undefined; conflictResponse: Response };

async function claimStageDispatch(
  supabase: ReturnType<typeof createClient>,
  opts: { guestId: number; trigger: string; recipient: string; force: boolean; tag: string },
): Promise<StageClaim> {
  const claim = await claimDispatchAttempt(supabase, {
    guestId: opts.guestId,
    triggerType: opts.trigger,
    recipient: opts.recipient,
    force: opts.force,
  });
  if (!claim.claimed) {
    console.log(
      `[whatsapp-send] ${opts.tag} claim_conflict trigger="${opts.trigger}" guestId=${opts.guestId} reason=${claim.reason}`,
    );
    return {
      conflictResponse: new Response(
        JSON.stringify({ ok: true, skipped: true, status: "in_flight", reason: "claim_conflict" }),
        { headers: { ...CORS, "Content-Type": "application/json" } },
      ),
    };
  }
  return { claim };
}

// Resort contact phone for {{2}} in templates that include a callback number.
// Set RESORT_CONTACT_PHONE in Supabase Secrets to replace this placeholder.
const RESORT_CONTACT_PHONE = Deno.env.get("RESORT_CONTACT_PHONE") ?? "054-0000000";

// Workshop signup URL for dream_workshop_signup {{2}}.
// Set WORKSHOP_SIGNUP_URL in Supabase Secrets once the user provides the link.
const WORKSHOP_SIGNUP_URL = Deno.env.get("WORKSHOP_SIGNUP_URL") ?? "dream-island.co.il/workshops";

// Guest portal base URL — used to expand {{portal_url}} in bot_script free-text bodies.
// Matches the live Vercel deployment (CLAUDE.md §1 Live URL).
const PORTAL_BASE_URL = "https://dream-ai-system.vercel.app";

function truncateConversationLog(text: string): string {
  const t = text.trim();
  return t.length > 4000 ? `${t.slice(0, 3997)}…` : t;
}

type InteractiveButtonDef = { type: string; label?: string; url?: string };

function sessionButtonsToLabels(buttons: InteractiveButtonDef[]): string[] {
  return buttons
    .filter((b) => b?.type === "quick_reply" && String(b.label ?? "").trim())
    .map((b) => String(b.label).trim());
}

/** Prefix [META]/[SESSION]/[WHAPI] + optional interactive-button footer for whatsapp_conversations. */
function formatOutboundConversationLog(opts: {
  channel: "meta_template" | "session_message" | "whapi_suites";
  body: string;
  interactiveButtonLabels?: string[];
}): string {
  const tag =
    opts.channel === "meta_template" ? "[META]" :
    opts.channel === "whapi_suites" ? "[WHAPI]" : "[SESSION]";
  const lines: string[] = [tag, truncateConversationLog(opts.body.trim())];
  const labels = opts.interactiveButtonLabels?.filter(Boolean) ?? [];
  if (labels.length > 0) {
    lines.push(`[+ Interactive Buttons: ${labels.join(" | ")}]`);
  }
  return lines.join("\n");
}

function buildSessionConversationLog(
  body: string,
  interactiveButtons?: InteractiveButtonDef[],
): string {
  const labels = sessionButtonsToLabels(interactiveButtons ?? []);
  return formatOutboundConversationLog({
    channel: "session_message",
    body,
    interactiveButtonLabels: labels.length ? labels : undefined,
  });
}

// Guest-outbound Whapi routing (Phase 1) — suite guests sent via the Suites
// device. No interactive-button concept on Whapi's plain-text send, so no
// labels param (unlike buildSessionConversationLog above).
function buildWhapiSuitesConversationLog(body: string): string {
  return formatOutboundConversationLog({ channel: "whapi_suites", body });
}

/**
 * Resolve human-readable inbox log text for a Meta template send.
 *
 * `templateName`/`vars` MUST be the literal DispatchedTemplate returned by
 * sendViaTemplate() for the send this call is logging — not the caller's
 * pre-send intent. Meta's API never echoes back the rendered body text, so
 * this reconstructs it locally (message_templates.content, falling back to
 * TEMPLATE_BODY_APPROVED) against the EXACT template name + variables that
 * were embedded in the accepted payload. Passing anything else re-introduces
 * the class of bug where the inbox shows a different message than what the
 * guest actually received.
 */
async function buildConversationLogFromTemplate(
  supabase: ReturnType<typeof createClient>,
  templateName: string,
  vars: string[],
): Promise<string> {
  const body = await resolveMetaTemplateBodyText(supabase, templateName, vars);
  return formatOutboundConversationLog({
    channel: "meta_template",
    body,
    interactiveButtonLabels: getTemplateQuickReplyButtons(templateName),
  });
}

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
// wording change to suite_welcome_morning (or any template here) must go
// through Meta Business Manager → WhatsApp Manager → edit + resubmit, and
// should NOT be assumed live until its status shows APPROVED again in the
// "📋 ניהול תבניות" tab. See CLAUDE.md §6 for the same note.
const PIPELINE_TEMPLATE: Record<string, string> = {
  pre_arrival_2d:  "dream_arrival_confirmation",  // T-2 days    → confirmation + Quick Reply buttons
  // "FINAL DEPLOYMENT & SPRINT COMMIT" session — Mike submitted dream_suite_
  // reminder directly in Meta Business Manager (Stage 2.5's production
  // template, "מה מחכה לי?" Dynamic URL button → guest portal). ⚠️ Could not
  // independently verify this template exists in our connected WABA via
  // get-wa-templates as of this session (see §10) — trusted as told, but
  // confirm it shows APPROVED/PENDING in "📋 ניהול תבניות" before relying on
  // it. dream_checkin_reminder_v2 itself flipped to APPROVED this session,
  // still carrying its OLD content (OnceHub button) — unrelated to Stage 2.5,
  // not touched here.
  night_before:    "dream_suite_reminder",
  morning_suite:   "suite_welcome_morning",        // suite AM    → "בוקר אור, היום מגיעים"
  morning_welcome: "suite_welcome_morning",        // standard AM → same template
  room_ready:      "dream_room_ready1",            // manual UI   → dedicated key-handover template
                                                     // (dream_room_ready1 is the approved Meta name;
                                                     // the fast-path below sends a free-text bot_script
                                                     // when the 24h session is open instead)
  mid_stay:            "dream_mid_stay_check",         // day 2       → mid-stay check + Quick Reply buttons
  mid_stay_daypass:    "dream_mid_stay_check",         // day-pass same-day courtesy check
  checkout_fb:         "dream_checkout_feedback",      // day after departure → feedback + Quick Reply buttons
  checkout_fb_daypass: "dream_checkout_feedback",      // day-pass post-visit feedback
  night_before_daypass: "dream_daypass_eve",           // day-pass T-1 — QR opens Meta 24h window
  survey_invite_daypass: "dream_survey_invite",        // day-pass+spa 17:00 survey — URL btn → portal/#survey
  spa_warmup_daypass: "dream_spa_warmup",              // spa_time − X min (ACC; default 30) — Meta backup when Whapi/window fails
};

/** Hardcoded bot_scripts keys when automation_stages.session_message_script_key
 * was cleared in ACC (live 2026-07-12: Stage 1 Whapi bulk → whapi_session_unavailable).
 * DB column still wins when set; this is FAIL-CLOSED fallback for Whapi/session. */
const PIPELINE_SESSION_SCRIPT: Record<string, string> = {
  pre_arrival_2d:       "pre_arrival_2d",
  night_before:         "night_before_reminder",
  night_before_daypass: "night_before_daypass",
  morning_suite:        "stage_3_morning",
  morning_welcome:      "morning_daypass",
  mid_stay:             "mid_stay",
  mid_stay_daypass:     "mid_stay_daypass",
  checkout_fb:          "checkout_fb",
  checkout_fb_daypass:  "checkout_fb_daypass",
  spa_warmup_daypass:   "spa_warmup_daypass",
  survey_invite_daypass: "survey_invite_daypass",
};

// ── Synchronous day-of-week aware timing helper ───────────────────────────────
// Used by morning_suite / morning_welcome templates whose {{2}}/{{3}} variables
// carry the guest's arrival-time window. Identical Shabbat logic as
// isSpecialNightBeforeDay() above but synchronous (no bot_config lookup needed
// because the morning-of stage fires the day the guest arrives — only Saturday
// vs weekday matters; custom holiday overrides are not evaluated here).
// Resort arrival hours — single source of truth within this function bundle.
// כניסה למתחם: 12:00 every day (weekday + Shabbat).
// קבלת חדרים/סוויטות: 15:00 weekday, 18:00 Shabbat arrival.
const RESORT_ENTRY_TIME = "12:00";
const WEEKDAY_CHECKIN_TIME = "15:00";
const SHABBAT_CHECKIN_TIME = "18:00";

function resolveArrivalTimingsFromCfg(
  cfg: Record<string, string>,
  arrivalDateStr: string,
): { entryTime: string; checkInTime: string } {
  const ymd = normalizeArrivalDateYmd(arrivalDateStr);
  const special = isSpecialNightBeforeDay(ymd, cfg["night_before_special_dates"] ?? "");
  if (special) {
    const entryTime = (cfg["night_before_entry_time_shabbat"] ?? "").trim();
    const checkInTime = (cfg["night_before_checkin_time_shabbat"] ?? "").trim();
    if (!entryTime || !checkInTime) {
      console.warn(
        `[whatsapp-send] shabbat_hours_config_missing for arrival_date=${arrivalDateStr} ` +
        `— using fallbacks entry=${RESORT_ENTRY_TIME} check-in=${SHABBAT_CHECKIN_TIME}. ` +
        `Set bot_config night_before_*_shabbat via BotConfigPanel.`,
      );
      return {
        entryTime: entryTime || RESORT_ENTRY_TIME,
        checkInTime: checkInTime || SHABBAT_CHECKIN_TIME,
      };
    }
    return { entryTime, checkInTime };
  }
  return {
    entryTime: (cfg["night_before_entry_time_weekday"] ?? "").trim() || RESORT_ENTRY_TIME,
    checkInTime: (cfg["night_before_checkin_time_weekday"] ?? "").trim() || WEEKDAY_CHECKIN_TIME,
  };
}

function resolveDayTimings(arrivalDateStr: string): { entryTime: string; checkInTime: string } {
  return resolveArrivalTimingsFromCfg(_knowledgeCache ?? {}, arrivalDateStr);
}

// Session-script safety net — bot_scripts may carry weekday check-in (15:00) literals.
function applySaturdayCheckInTimeOverride(messageText: string, arrivalDateStr: string): string {
  if (!messageText || !arrivalDateStr) return messageText;
  if (!isShabbatArrivalDate(arrivalDateStr)) return messageText;
  // Entry stays 12:00 — only promote weekday room check-in 15:00 → 18:00.
  return messageText.replace(/15:00/g, SHABBAT_CHECKIN_TIME);
}

// Variables passed as {{1}}, {{2}}, … to each pipeline template.
// All values pass through sanitizeTemplateVars() at send time — these lambdas
// produce raw values; sanitization is applied in BRANCH D before the API call.
// night_before deliberately has NO entry here — its vars are Sabbath/Holiday-
// dependent and computed async (resolveNightBeforeTimes() below, DB lookup),
// which a synchronous (g) => string[] lambda can't do. BRANCH D special-cases
// trigger==="night_before" and bypasses this map entirely for it.
const PIPELINE_VARS: Record<string, (g: Record<string, unknown>) => string[]> = {
  pre_arrival_2d:  (g) => [String(g.name ?? "")],
  // {{1}} = guest name only. Entry/check-in times are now baked into each template's
  // body text (separate weekday vs Shabbat approved templates). The morning fast-path
  // below selects the correct template deterministically — this entry is a safety net
  // for any code path that bypasses that fast-path (should never fire in practice).
  morning_suite:   (g) => [String(g.name ?? "")],
  morning_welcome: (g) => [String(g.name ?? "")],
  room_ready:      (g) => [String(g.name ?? ""), String(g.room ?? g.suite_name ?? "")],
  mid_stay:            (g) => [String(g.name ?? "")],
  mid_stay_daypass:    (g) => [String(g.name ?? "")],
  checkout_fb:         (g) => [String(g.name ?? "")],
  checkout_fb_daypass: (g) => [String(g.name ?? "")],
  night_before_daypass: (g) => [String(g.name ?? "")],
  survey_invite_daypass: (g) => [String(g.name ?? "")],
  spa_warmup_daypass: (g) => [
    String(g.name ?? ""),
    normalizeHmTime(g.spa_time) || "10:00",
  ],
};

// Maps each pipeline trigger to the DB flag it atomically stamps.
const GUEST_FLAG: Record<string, string> = {
  pre_arrival_2d:  "msg_pre_arrival_2d_sent",
  night_before:    "msg_pre_arrival_sent",
  morning_suite:   "msg_morning_suite_sent",
  morning_welcome: "msg_morning_welcome_sent",
  room_ready:      "msg_room_ready_sent",
  mid_stay:            "msg_mid_stay_sent",
  mid_stay_daypass:    "msg_mid_stay_sent",
  checkout_fb:         "msg_checkout_fb_sent",
  checkout_fb_daypass: "msg_checkout_fb_sent",
  night_before_daypass: "msg_pre_arrival_sent",
  stage_2_arrival:     "msg_stage_2_arrival_sent",
  survey_invite_daypass: "msg_survey_invite_sent",
  spa_warmup_daypass:    "msg_spa_warmup_sent",
};

// ── Stage 2.5 (night_before) — Sabbath/Holiday-aware entry/check-in times ───
// "STAGE 2.5 UPDATE, SABBATH LOGIC" session. bot_scripts row
// 'night_before_reminder' carries {{entry_time}}/{{check_in_time}} — a
// weekday-arriving guest gets the fixed 12:00/15:00 pair; a guest arriving on
// a Saturday (יום שבת) or a date listed in bot_config.night_before_special_dates
// gets the Shabbat pair instead. Computed here once per guest and threaded
// into BOTH the session-message substitution and the Meta-template fallback
// vars below, so the two channels can never disagree on the hours quoted.
//
// FAIL VISIBLE (CLAUDE.md §0.3): a Shabbat/holiday arrival with blank Shabbat
// bot_config values throws rather than guessing — the caller treats this
// exactly like any other send failure (status="failed", visible in Automation
// History) instead of ever telling a real guest the wrong gate-opening time.
let _knowledgeCache: Record<string, string> | null = null;
let _knowledgeCacheTime = 0;
const KNOWLEDGE_TTL_MS = 5 * 60 * 1000;

async function fetchNightBeforeKnowledge(
  supabaseClient: ReturnType<typeof createClient>
): Promise<Record<string, string>> {
  const now = Date.now();
  if (_knowledgeCache && now - _knowledgeCacheTime < KNOWLEDGE_TTL_MS) return _knowledgeCache;
  const keys = [
    "night_before_entry_time_weekday", "night_before_checkin_time_weekday",
    "night_before_entry_time_shabbat", "night_before_checkin_time_shabbat",
    "night_before_special_dates",
  ];
  const { data } = await supabaseClient
    .from("bot_config").select("config_key, config_value").in("config_key", keys);
  const map: Record<string, string> = {};
  for (const row of (data ?? []) as { config_key: string; config_value: string }[]) {
    map[row.config_key] = row.config_value ?? "";
  }
  _knowledgeCache = map;
  _knowledgeCacheTime = now;
  return map;
}

// arrival_date is a DATE column ("YYYY-MM-DD") — noon UTC avoids DST edge cases.
function normalizeArrivalDateYmd(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s.slice(0, 10);
  return s;
}

function isShabbatArrivalDate(arrivalDateStr: string, specialDatesCsv = ""): boolean {
  const ymd = normalizeArrivalDateYmd(arrivalDateStr);
  if (!ymd) return false;
  const d = new Date(`${ymd}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return false;
  if (d.getUTCDay() === 6) return true; // Saturday
  const listed = specialDatesCsv.split(/[,\n]+/).map((s) => s.trim()).filter(Boolean);
  return listed.includes(ymd);
}

function isSpecialNightBeforeDay(arrivalDateStr: string, specialDatesCsv: string): boolean {
  return isShabbatArrivalDate(arrivalDateStr, specialDatesCsv);
}

// night_before's Shabbat-bundle cohort — Friday OR Saturday arrival (Friday
// added 2026-07-10: Friday arrivals get the same Shabbat script/template/image
// same-day instead of the weekday reminder the day before). Scoped to
// night_before only — every other Shabbat-variant call site (morning_suite)
// keeps calling isShabbatArrivalDate directly and stays Saturday-only.
function isNightBeforeShabbatBundleArrival(arrivalDateStr: string): boolean {
  const ymd = normalizeArrivalDateYmd(arrivalDateStr);
  if (!ymd) return false;
  const d = new Date(`${ymd}T12:00:00Z`);
  const isFriday = !Number.isNaN(d.getTime()) && d.getUTCDay() === 5;
  return isFriday || isShabbatArrivalDate(ymd, _knowledgeCache?.["night_before_special_dates"] ?? "");
}

async function resolveNightBeforeTimes(
  supabaseClient: ReturnType<typeof createClient>,
  arrivalDateStr: string
): Promise<{ entryTime: string; checkInTime: string }> {
  const cfg = await fetchNightBeforeKnowledge(supabaseClient);
  return resolveArrivalTimingsFromCfg(cfg, arrivalDateStr);
}

// ── Template variable sanitizer — prevents Meta error 131008 (empty param) ────
// Meta rejects any template variable that is an empty string or whitespace.
// Position 0 is always the guest name → fallback to "אורח יקר".
// Positions 1–2 on timing templates fall back to weekday hours; others → "-".
function sanitizeTemplateVars(vars: string[]): string[] {
  return vars.map((v, i) => {
    const t = String(v ?? "").trim();
    if (t) return t;
    if (i === 0) return "אורח יקר";
    if (i === 1) return "12:00";
    if (i === 2) return "15:00";
    return "-";
  });
}

// Meta body layout for dream_suite_reminder: {{1}}=name, {{2}}=entry, {{3}}=check-in.
// night_before_suites[_shabbat] approved templates expect {{1}}=name only — times are
// baked into the static template body (weekday vs Shabbat variants).
const THREE_PARAM_TIMING_TEMPLATES = new Set([
  "dream_suite_reminder",
]);

const ONE_PARAM_NAME_TEMPLATES = new Set([
  "night_before_suites",
  "night_before_suites_shabbat",
]);

function buildNameOnlyTemplateVars(guest: Record<string, unknown>): string[] {
  return sanitizeTemplateVars([String(guest.name ?? "")]);
}

function buildThreeParamTimingVars(
  guest: Record<string, unknown>,
  entryTime: string,
  checkInTime: string,
): string[] {
  return sanitizeTemplateVars([
    String(guest.name ?? ""),
    entryTime || "12:00",
    checkInTime || "15:00",
  ]);
}

function syncTimingVarsForGuest(guest: Record<string, unknown>): string[] {
  const { entryTime, checkInTime } = resolveDayTimings(normalizeArrivalDateYmd(guest.arrival_date));
  return buildThreeParamTimingVars(guest, entryTime, checkInTime);
}

/** Pad or rebuild body vars so Meta always receives the expected param count */
function ensureTemplateBodyVars(
  templateName: string,
  vars: string[],
  guest: Record<string, unknown>,
): string[] {
  if (ONE_PARAM_NAME_TEMPLATES.has(templateName)) {
    return buildNameOnlyTemplateVars(guest);
  }
  if (THREE_PARAM_TIMING_TEMPLATES.has(templateName)) {
    const synced = syncTimingVarsForGuest(guest);
    if (vars.length >= 3) {
      return sanitizeTemplateVars([
        vars[0] || synced[0],
        vars[1] || synced[1],
        vars[2] || synced[2],
      ]);
    }
    return synced;
  }
  if (TWO_PARAM_ROOM_TEMPLATES.has(templateName)) {
    return buildTwoParamRoomVars(guest);
  }
  return sanitizeTemplateVars(vars);
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

// ── Meta template approval / not-found detector ───────────────────────────────
// Meta returns HTTP 400 with error code 132001 when a template is not found or
// is still PENDING approval. This is a recoverable, temporary state — NOT a
// real dispatch failure. Detecting it lets the pipeline log "blocked_by_meta"
// instead of "failed", keeping the guest flag un-stamped so the cron retries
// automatically once the template is approved.
// Source: Meta error JSON body embedded in the throw from sendViaTemplate,
// e.g. "meta_http_400: {...\"code\":132001...}".
function isMetaTemplateError(msg: string): boolean {
  return /132001|template_not_found|template.*not.*approved|template.*pending/i.test(msg);
}

/** Clears AICopilot «ממתין לאישור» gate once room_ready was sent (or idempotent skip). */
async function clearPendingRoomApprovalGate(
  supabase: ReturnType<typeof createClient>,
  roomId: string,
): Promise<void> {
  const trimmed = String(roomId ?? "").trim();
  if (!trimmed) return;
  const { error } = await supabase
    .from("room_status")
    .update({ status: "פנוי", updated_at: new Date().toISOString() })
    .eq("room_id", trimmed)
    .eq("status", "ממתין לאישור");
  if (error) {
    console.warn("[whatsapp-send] clearPendingRoomApprovalGate failed:", trimmed, error.message);
  }
}

function guestRoomIdForApprovalGate(guest: Record<string, unknown>): string {
  return String(guest.room ?? guest.suite_name ?? "").trim();
}

// Templates whose Meta definition includes a Media (IMAGE) header — must inject
// header component or Meta returns "Format mismatch, expected IMAGE, received UNKNOWN".
const TEMPLATE_IMAGE_HEADER_DEFAULTS: Record<string, string> = {
  dream_suite_reminder:        "https://tzalamnadlan.co.il/wp-content/uploads/2026/default-resort.jpg",
  night_before_suites:         "https://tzalamnadlan.co.il/wp-content/uploads/2026/default-resort.jpg",
  night_before_suites_shabbat: "https://tzalamnadlan.co.il/wp-content/uploads/2026/default-resort.jpg",
};

/** Confirmed text-only / no-header templates — never inject header components. */
const TEMPLATE_NO_HEADER = new Set([
  "suite_welcome_morning",
  "suite_welcome_morning_shabbat",
  "dream_arrival_confirmation",
  "dream_checkin_reminder_v2",
  "dream_mid_stay_check",
  "dream_checkout_feedback",
  "dream_payment_and_workshops",
  "dream_room_ready",
  "dream_room_ready1",
  "dream_welcome_morning",
  "dream_welcome_morning_shabbat",
  "dream_handover_agent_v2",
  "dream_survey_invite",
  "dream_spa_warmup",
  "dream_daypass_eve",
]);

function templateExpectsImageHeader(templateName: string): boolean {
  return Object.prototype.hasOwnProperty.call(TEMPLATE_IMAGE_HEADER_DEFAULTS, templateName);
}

// ── Meta payload builders — structural validation before every send ───────────
function resolveTemplateHeaderImageUrl(
  templateName: string,
  override?: string | null,
): string | undefined {
  const explicit = String(override ?? "").trim();
  if (!templateExpectsImageHeader(templateName)) {
    if (explicit) {
      console.warn(
        `[whatsapp-send] template="${templateName}": header image override ignored` +
        ` — Meta template has no IMAGE header (session images use sendViaMeta only)`,
      );
    }
    return undefined;
  }
  if (explicit) return explicit;
  return TEMPLATE_IMAGE_HEADER_DEFAULTS[templateName];
}

/** Build validated free-text or image+caption session payload for Meta API. */
function buildFreeTextPayload(
  recipient: string,
  body: string,
  imageUrl?: string | null,
): Record<string, unknown> {
  const caption = String(body ?? "").trim();
  const link = String(imageUrl ?? "").trim();

  if (link) {
    if (!caption) {
      console.warn(
        `[whatsapp-send] buildFreeTextPayload: image_url present but caption/body empty` +
        ` — sending image without caption to=${maskPhoneForLog(recipient)}`,
      );
    }
    // Meta Cloud API — image object must use `link` (or `id`), not a nested URL field.
    const image: Record<string, string> = { link };
    if (caption) image.caption = caption;
    return {
      messaging_product: "whatsapp",
      to: recipient,
      type: "image",
      image,
    };
  }

  if (!caption) {
    console.warn(`[whatsapp-send] buildFreeTextPayload: empty body and no image_url — payload may be rejected`);
  }
  return {
    messaging_product: "whatsapp",
    to: recipient,
    type: "text",
    text: { body: caption || " ", preview_url: false },
  };
}

/**
 * Build Meta template.components[] with header/body/button validation.
 *
 * Returns BOTH the components array sent to Meta AND `resolvedVars` — the
 * exact body variables actually embedded in that payload after all padding/
 * fallback logic below. `resolvedVars` is the single source of truth for
 * conversation-log reconstruction (see sendViaTemplate) so the inbox log can
 * never diverge from what Meta actually received, even in the padding edge
 * cases this function silently corrects (e.g. a caller passing fewer vars
 * than a template requires).
 */
function buildTemplateComponents(
  templateName: string,
  rawVars: string[],
  opts: { buttonUrlParam?: string; headerImageUrl?: string | null } = {},
): { components: unknown[]; resolvedVars: string[] } {
  const components: unknown[] = [];
  const headerUrl = resolveTemplateHeaderImageUrl(templateName, opts.headerImageUrl);

  if (headerUrl) {
    components.push({
      type: "header",
      parameters: [{ type: "image", image: { link: headerUrl } }],
    });
  } else if (templateExpectsImageHeader(templateName)) {
    console.warn(
      `[whatsapp-send] template="${templateName}": IMAGE header required by Meta but no URL resolved` +
      ` (check TEMPLATE_IMAGE_HEADER_DEFAULTS or pass image_url for IMAGE-header templates only)`,
    );
  } else if (TEMPLATE_NO_HEADER.has(templateName) && opts.headerImageUrl) {
    console.warn(
      `[whatsapp-send] template="${templateName}": headerImageUrl ignored — template is registered as no-header`,
    );
  }

  let variables = sanitizeTemplateVars(rawVars.map((v) => String(v ?? "")));

  if (ONE_PARAM_NAME_TEMPLATES.has(templateName) && variables.length < 1) {
    console.warn(`[whatsapp-send] template="${templateName}": missing {{1}} — padding guest name fallback`);
    variables = buildNameOnlyTemplateVars({ name: "" });
  }
  if (THREE_PARAM_TIMING_TEMPLATES.has(templateName) && variables.length < 3) {
    console.warn(
      `[whatsapp-send] template="${templateName}": expected 3 body params, got ${variables.length}` +
      ` — padding timing fallbacks`,
    );
    while (variables.length < 3) {
      variables.push(variables.length === 0 ? "אורח יקר" : variables.length === 1 ? "12:00" : "15:00");
    }
    variables = sanitizeTemplateVars(variables);
  }

  if (variables.length > 0) {
    const bodyParams = variables.map((v, i) => {
      let text = String(v ?? "").trim();
      if (!text) {
        console.warn(`[whatsapp-send] template="${templateName}": body param {{${i + 1}}} empty after sanitize`);
        text = i === 0 ? "אורח יקר" : i === 1 ? "12:00" : i === 2 ? "15:00" : "-";
      }
      // Mike-locked body is "היי{{1}}" (no space after היי). sanitizeTemplateVars
      // trims, so we inject a leading space here so guests see "היי שם".
      if (templateName === "dream_survey_invite" && i === 0 && !text.startsWith(" ")) {
        text = ` ${text}`;
      }
      return { type: "text", text };
    });
    components.push({ type: "body", parameters: bodyParams });
  } else {
    console.warn(
      `[whatsapp-send] template="${templateName}": no body parameters in payload` +
      ` — Meta may reject if template expects {{N}} placeholders`,
    );
  }

  if (opts.buttonUrlParam !== undefined) {
    const btnText = String(opts.buttonUrlParam ?? "").trim();
    if (!btnText) {
      console.warn(`[whatsapp-send] template="${templateName}": dynamic URL button param empty`);
    }
    components.push({
      type: "button",
      sub_type: "url",
      index: 0,
      parameters: [{ type: "text", text: btnText || "-" }],
    });
  }

  return { components, resolvedVars: variables };
}

// Default session image for Stage 2.5 manual "Send Now" override (force === true).
const NIGHT_BEFORE_OVERRIDE_SESSION_IMAGE =
  "https://dream-ai-system.vercel.app/images/dreamislandsuite.jpg";

// ── Stage session message helpers (Stage 2.5 + hybrid pipeline) ───────────────
type StageMediaRow = {
  session_message_image_url?: string | null;
  session_message_image_url_shabbat?: string | null;
  session_message_script_key?: string | null;
  session_message_script_key_shabbat?: string | null;
  is_active?: boolean;
} | null;

/** Image for session sends: automation_stages.session_message_image_url wins, then request body. */
function resolveStageSessionImageUrl(
  stageRow: StageMediaRow,
  requestImageUrl?: string | null,
): string | undefined {
  const link = String(stageRow?.session_message_image_url ?? requestImageUrl ?? "").trim();
  return link || undefined;
}

// isShabbat is caller-supplied (not recomputed here) so each call site can
// express its own Shabbat-ness rule — night_before treats Friday+Saturday as
// the bundle (isNightBeforeShabbatBundleArrival), every other stage stays
// Saturday-only (isShabbatArrivalDate) — while sharing the same script/image
// fallback logic.
function resolveShabbatAwareScriptKey(
  stageRow: StageMediaRow,
  isShabbat: boolean,
  fallbackKey: string,
): string {
  if (!isShabbat) {
    return stageRow?.session_message_script_key?.trim() || fallbackKey;
  }
  const shabbatKey = stageRow?.session_message_script_key_shabbat?.trim();
  return shabbatKey || stageRow?.session_message_script_key?.trim() || fallbackKey;
}

function resolveShabbatAwareSessionImageUrl(
  stageRow: StageMediaRow,
  isShabbat: boolean,
  requestImageUrl?: string | null,
): string | undefined {
  if (isShabbat) {
    const shabbatImg = String(stageRow?.session_message_image_url_shabbat ?? "").trim();
    if (shabbatImg) return shabbatImg;
  }
  return resolveStageSessionImageUrl(stageRow, requestImageUrl);
}

/** Route suite + day-pass guest automation through the Whapi Suites device —
 * applies uniformly regardless of arrival day-of-week or dispatch_channel
 * (owner decisions 2026-07-10 suite, 2026-07-12 day-pass). Meta templates are
 * not used for these guests while GUEST_WHAPI_SUITES_ENABLED is on. */
function shouldUseWhapiForGuestAutomation(
  guest: Record<string, unknown>,
): boolean {
  return shouldRouteGuestOutboundViaWhapiSuites(guest);
}

// Phase 3 hard-fail (2026-07-13) — staff explicitly forced force_channel=
// "meta_template" on a Whapi-eligible guest. ACC's Override keeps the Meta
// button enabled (not disabled) for exactly this case — a real fallback when
// the physical Suites device is down — so this refuses by default rather
// than silently sending, and names the escape hatch instead of dead-ending.
function metaTemplateBlockedForWhapiGuestResponse(): Response {
  return new Response(
    JSON.stringify({
      ok: false,
      status: "meta_blocked_whapi_eligible",
      error:
        "meta_blocked_whapi_eligible: אורח זה מנותב ל-Whapi (מכשיר הסוויטות) — " +
        "שליחת Meta Template ידנית חסומה כברירת מחדל כדי למנוע עמלה מיותרת. " +
        "אם באמת צריך Meta (למשל תקלה במכשיר הסוויטות), הגדר " +
        "ALLOW_META_GUEST_TEMPLATES=true (supabase secrets) ונסה שוב.",
    }),
    { headers: { ...CORS, "Content-Type": "application/json" } },
  );
}

async function dispatchWhapiSessionMessage(
  phone: string,
  body: string,
  imageUrl?: string,
): Promise<string | null> {
  const target = cleanPhoneForMention(phone);
  const link = String(imageUrl ?? "").trim();
  if (link) return sendWhapiImage(target, link, body);
  return sendWhapiText(target, body);
}

/** Expand bot_script placeholders for free-text session messages. */
function expandSessionPlaceholders(
  rawText: string,
  guest: Record<string, unknown>,
  extras: {
    guestName: string;
    entryTime?: string;
    checkInTime?: string;
    portalUrl?: string;
  },
): string {
  const roomName = String(guest.room ?? guest.suite_name ?? "").trim() || "-";
  return rawText
    .replace(/\{\{\s*GUEST_NAME\s*\}\}/gi, extras.guestName)
    .replace(/\{\{\s*entry_time\s*\}\}/gi, extras.entryTime ?? "")
    .replace(/\{\{\s*check_in_time\s*\}\}/gi, extras.checkInTime ?? "")
    .replace(/\{\{\s*portal_url\s*\}\}/gi, extras.portalUrl ?? "")
    .replace(/\{\{\s*ROOM_NAME\s*\}\}/gi, roomName)
    .replace(/\{\{\s*SUITE_NAME\s*\}\}/gi, roomName)
    .replace(/\{\{\s*room\s*\}\}/gi, roomName);
}

/**
 * Dispatch a 24h session message. When imageUrl is set, always uses sendImageMessage
 * (Meta type:image with caption inside image object). Throws on Meta failure — never
 * silently falls back to text-only when an image URL was provided.
 */
async function sendStageSessionMessage(
  to: string,
  caption: string,
  imageUrl: string | undefined,
  buttons: Array<{ type: string; label: string; url?: string }>,
  logContext: string,
): Promise<{ kind: "session_image" | "session_interactive" | "session_text"; wamid: string | null }> {
  const link = imageUrl?.trim();
  const body = String(caption ?? "").trim();

  if (link) {
    console.log(
      `[whatsapp-send] ${logContext}: session_image to=${maskPhoneForLog(safeGuestPhone(to))}` +
      ` link=${link.slice(0, 96)} caption_chars=${body.length}`,
    );
    try {
      const wamid = await sendViaMeta(to, body, link);
      return { kind: "session_image", wamid };
    } catch (e) {
      const msg = (e as Error).message;
      console.error(`[whatsapp-send] ${logContext}: session_image FAILED — ${msg}`);
      throw new Error(`session_image_failed: ${msg}`);
    }
  }

  if (imageUrl !== undefined && imageUrl !== null && !link && String(imageUrl).length > 0) {
    throw new Error(
      `${logContext}: session_image_url_invalid — configured image URL is empty/whitespace`,
    );
  }

  if (buttons.length > 0) {
    const wamid = await sendInteractiveButtons(to, body, buttons);
    return { kind: "session_interactive", wamid };
  }

  const wamid = await sendViaMeta(to, body, null);
  return { kind: "session_text", wamid };
}

// ── Meta WhatsApp Cloud API (live) ────────────────────────────────────────────
async function sendViaMeta(to: string, body: string, imageUrl?: string | null): Promise<string | null> {
  const recipient = sanitizeMetaRecipientPhone(to);
  const link = String(imageUrl ?? "").trim();
  const caption = String(body ?? "").trim();

  if (link) {
    const kind = "session_image";
    logMetaOutboundPayload(
      `${kind} to=${maskPhoneForLog(recipient)}`,
      buildFreeTextPayload(recipient, caption, link),
    );
    try {
      const wamid = await sendImageMessage(recipient, link, caption);
      console.log(
        `[whatsapp-send] Meta response ${kind} to=${maskPhoneForLog(recipient)} wamid=${wamid}`,
      );
      return wamid;
    } catch (e) {
      if (_isAbortError(e)) {
        throw new Error("timeout_no_response: Meta did not respond within 25s — message may have still been delivered");
      }
      throw e;
    }
  }

  const token   = Deno.env.get("META_WHATSAPP_TOKEN")    ?? Deno.env.get("WHATSAPP_TOKEN");
  const phoneId = Deno.env.get("META_PHONE_NUMBER_ID")   ?? Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  if (!token || !phoneId) throw new Error("missing_meta_whatsapp_creds");

  const payload = buildFreeTextPayload(recipient, caption, null);
  const kind = "free_text";

  try {
    logMetaOutboundPayload(`${kind} to=${maskPhoneForLog(recipient)}`, payload);
    const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(25000),
    });
    const responseText = await res.text();
    console.log(
      `[whatsapp-send] Meta response ${kind} to=${maskPhoneForLog(recipient)} ` +
      `http=${res.status} body=${responseText.slice(0, 500)}`,
    );
    if (!res.ok) {
      throw new Error(`meta_http_${res.status}: ${responseText.slice(0, 300)}`);
    }
    return assertMetaMessageAccepted(responseText, res.status, `${kind} to=${maskPhoneForLog(recipient)}`);
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
//
// Templates with a Media Header (IMAGE) require a `header` component in the
// components array — Meta rejects without it: "Format mismatch, expected IMAGE,
// received UNKNOWN". See TEMPLATE_IMAGE_HEADER_DEFAULTS above (defined before payload builders).
//
// Only names in TEMPLATE_IMAGE_HEADER_DEFAULTS get a header component injected.

// Only these approved templates have a dynamic URL button at index 0.
// night_before_suites[_shabbat] have no button component — do not inject one.
const TEMPLATE_HAS_DYNAMIC_URL_BUTTON = new Set([
  "dream_suite_reminder",
  "dream_payment_and_workshops",
  "dream_survey_invite",
]);

function resolveDynamicUrlButtonParam(
  templateName: string,
  portalToken: unknown,
  paymentButtonToken?: string,
): string | undefined {
  if (templateName === "dream_payment_and_workshops") {
    const token = String(paymentButtonToken ?? "").trim();
    return token || undefined;
  }
  if (!TEMPLATE_HAS_DYNAMIC_URL_BUTTON.has(templateName)) return undefined;
  const token = String(portalToken ?? "").trim();
  if (!token) return undefined;
  // dream_survey_invite URL is …/portal/{{1}} — suffix must land on #survey.
  if (templateName === "dream_survey_invite") return `${token}#survey`;
  return token;
}

function safeGuestPhone(phone: unknown): string {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (!digits) return "";
  return sanitizeMetaRecipientPhone(phone);
}

/** Mask phone for logs — keep country prefix + last 4 digits only. */
function maskPhoneForLog(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (d.length <= 6) return "***";
  return `${d.slice(0, 3)}***${d.slice(-4)}`;
}

const ADMIN_ALERT_PHONE_FALLBACK = "972546294885";

/** Emergency Whapi DM to admin when a guest dispatch fails (bypasses Meta). */
async function alertAdminDispatchFailure(params: {
  guestName?: string | null;
  guestPhone?: string | null;
  dispatchType: "Template" | "Session";
  errorMessage: string;
}): Promise<void> {
  const adminPhone = (
    Deno.env.get("ADMIN_PHONE_NUMBER") ??
    Deno.env.get("SLA_GUEST_ALERT_PHONE") ??
    ADMIN_ALERT_PHONE_FALLBACK
  ).replace(/\D/g, "");
  if (!adminPhone) {
    console.warn("[whatsapp-send] admin alert skipped — no ADMIN_PHONE_NUMBER configured");
    return;
  }
  const guestLabel =
    (params.guestName && String(params.guestName).trim()) ||
    maskPhoneForLog(safeGuestPhone(params.guestPhone)) ||
    "לא ידוע";
  const errText = String(params.errorMessage ?? "שגיאה לא ידועה").slice(0, 500);
  const alertBody =
    `🚨 שגיאת מערכת: כשל בשליחת הודעה לאורח ${guestLabel}.\n` +
    `סוג ההודעה: ${params.dispatchType}\n` +
    `סיבת השגיאה: ${errText}`;
  try {
    await sendWhapiText(adminPhone, alertBody, { noLinkPreview: true });
    console.log(`[whatsapp-send] admin dispatch failure alert sent to ${maskPhoneForLog(adminPhone)}`);
  } catch (e) {
    console.error("[whatsapp-send] admin dispatch alert failed (non-blocking):", (e as Error).message);
  }
}

async function notifyAdminIfDispatchFailed(params: {
  status: string;
  error: string | null | undefined;
  guestName?: string | null;
  guestPhone?: string | null;
  dispatchType: "Template" | "Session";
  /** When set, staff-initiated timeouts skip the 🚨 admin page (duplicate-risk UX). */
  trigger?: string;
}): Promise<void> {
  if (!params.error) return;
  if (params.status !== "failed" && params.status !== "blocked_by_meta" && params.status !== "timeout") return;
  // Staff room_ready / inbox_reply: Whapi timeout often means "delivered but unconfirmed"
  // — paging admin caused false alarms; UI shows uncertain-delivery copy instead.
  if (params.status === "timeout" && (params.trigger === "room_ready" || params.trigger === "inbox_reply")) {
    console.warn(
      `[whatsapp-send] uncertain delivery (no admin page) trigger=${params.trigger} guest=${params.guestName ?? "?"}`,
    );
    return;
  }
  const errText = params.status === "timeout"
    ? `לא ודאי אם ההודעה הגיעה — בדקו בוואטסאפ לפני שליחה חוזרת. (${String(params.error).slice(0, 300)})`
    : String(params.error ?? "שגיאה לא ידועה").slice(0, 500);
  await alertAdminDispatchFailure({
    guestName: params.guestName,
    guestPhone: params.guestPhone,
    dispatchType: params.dispatchType,
    errorMessage: errText,
  });
}

/** JSON-safe log string; never includes Authorization or other secrets. */
function logMetaOutboundPayload(label: string, payload: Record<string, unknown>): void {
  console.log(`[whatsapp-send] Meta outbound ${label}: ${JSON.stringify(payload)}`);
}

/** Meta may return HTTP 200 without messages[0].id — treat as failure (ghost send). */
// assertMetaMessageAccepted lives in ../_shared/metaWamid.ts

function resolvePipelineTemplateName(
  trigger: string,
  guest: Record<string, unknown>,
  stageRow: { meta_template_name?: string | null } | null,
): string {
  const fromDb = stageRow?.meta_template_name?.trim();
  const fromMap = PIPELINE_TEMPLATE[trigger]?.trim();

  if (trigger === "pre_arrival_2d") {
    // Suite-room guard: a mis-tagged day_guest occupying a real suite gets the
    // suite/standard confirmation template, not the day-pass one (P0, s125).
    if (guest.room_type === "day_guest" && !isCanonicalSuiteRoom(guest.room)) {
      return "dream_checkin_reminder_v2";
    }
    return fromDb || fromMap || "dream_arrival_confirmation";
  }

  if (trigger === "morning_suite" || trigger === "morning_welcome") {
    // Always route to the approved Shabbat-aware pair — ignore automation_stages.
    // meta_template_name (migration 102 left the weekday name there). Honoring the
    // DB value before the Shabbat check let a manual force_channel=meta_template
    // dispatch quote the weekday 15:00 check-in to a Saturday-arrival guest; the
    // autonomous morningDispatch fast-path already computes this pair directly and
    // night_before below follows the same ignore-the-DB rule.
    const isShabbat = isShabbatArrivalDate(String(guest.arrival_date ?? ""));
    return isShabbat ? "suite_welcome_morning_shabbat" : "suite_welcome_morning";
  }

  if (trigger === "night_before") {
    // Always route to the approved Shabbat-aware pair — ignore automation_stages.
    // meta_template_name may still hold legacy dream_suite_reminder / dream_checkin_reminder_v2.
    const isShabbat = isShabbatArrivalDate(String(guest.arrival_date ?? ""));
    return isShabbat ? "night_before_suites_shabbat" : "night_before_suites";
  }

  return fromDb || fromMap || "";
}

function resolveTemplateVars(
  trigger: string,
  guest: Record<string, unknown>,
  templateName: string,
): string[] {
  if (ONE_PARAM_NAME_TEMPLATES.has(templateName)) {
    return buildNameOnlyTemplateVars(guest);
  }
  if (THREE_PARAM_TIMING_TEMPLATES.has(templateName)) {
    return syncTimingVarsForGuest(guest);
  }
  if (TWO_PARAM_ROOM_TEMPLATES.has(templateName)) {
    return buildTwoParamRoomVars(guest);
  }
  if (templateName === "dream_checkin_reminder_v2") {
    return sanitizeTemplateVars([String(guest.name ?? ""), RESORT_CONTACT_PHONE]);
  }
  const fromPipeline = PIPELINE_VARS[trigger]?.(guest);
  if (fromPipeline?.length) return sanitizeTemplateVars(fromPipeline);
  return sanitizeTemplateVars([String(guest.name ?? "")]);
}

/**
 * Dispatched-template descriptor — the literal {templateName, variables} pair
 * embedded in the Meta payload that was actually POSTed. Callers MUST use
 * this return value (never a separately-tracked copy of the name/vars they
 * intended to send) when building the whatsapp_conversations log entry —
 * see buildConversationLogFromTemplate. This is the ABSOLUTE SOURCE OF TRUTH
 * invariant: what Meta received is exactly what gets logged.
 */
type DispatchedTemplate = { templateName: string; variables: string[]; wamid: string | null };

async function sendViaTemplate(
  to: string,
  templateName: string,
  variables: string[] = [],
  langCode = "he",
  buttonUrlParam?: string,
  headerImageUrlOverride?: string | null,
): Promise<DispatchedTemplate> {
  const token   = Deno.env.get("META_WHATSAPP_TOKEN")  ?? Deno.env.get("WHATSAPP_TOKEN");
  const phoneId = Deno.env.get("META_PHONE_NUMBER_ID") ?? Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  if (!token || !phoneId) throw new Error("missing_meta_whatsapp_creds");

  if (!templateName?.trim()) {
    console.warn("[whatsapp-send] sendViaTemplate: templateName empty — send will fail");
  }

  const expectedCount = await resolveExpectedBodyParamCount(templateName);
  const fittedVars = fitVarsToExpectedCount(variables, expectedCount, {
    guestName: variables[0],
  });
  if (
    TWO_PARAM_ROOM_TEMPLATES.has(templateName) &&
    variables.length > fittedVars.length &&
    expectedCount > 0
  ) {
    console.warn(
      `[whatsapp-send] template="${templateName}": room name omitted from Meta payload` +
      ` — live template expects ${expectedCount} body param(s), had ${variables.length}`,
    );
  }

  const { components, resolvedVars } = buildTemplateComponents(templateName, fittedVars, {
    buttonUrlParam,
    headerImageUrl: headerImageUrlOverride,
  });

  const recipient = sanitizeMetaRecipientPhone(to);
  const payload = {
    messaging_product: "whatsapp",
    to: recipient,
    type: "template",
    template: {
      name: templateName,
      language: { code: langCode },
      ...(components.length > 0 ? { components } : {}),
    },
  };

  const isNightBeforeSuites =
    templateName === "night_before_suites" || templateName === "night_before_suites_shabbat";
  const resolvedHeader = resolveTemplateHeaderImageUrl(templateName, headerImageUrlOverride);

  try {
    logMetaOutboundPayload(
      `template="${templateName}" to=${maskPhoneForLog(recipient)}` +
      (isNightBeforeSuites
        ? ` [Stage2.5] bodyVars=${variables.length} hasHeader=${!!resolvedHeader}` +
          ` hasButton=${buttonUrlParam !== undefined} components=${components.length}`
        : ""),
      payload,
    );
    const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(25000),
    });
    const responseText = await res.text();
    console.log(
      `[whatsapp-send] Meta response template="${templateName}" to=${maskPhoneForLog(recipient)} ` +
      `http=${res.status} body=${responseText.slice(0, 500)}`,
    );
    if (!res.ok) {
      throw new Error(`meta_template_${res.status}: ${responseText.slice(0, 300)}`);
    }
    const wamid = assertMetaMessageAccepted(
      responseText,
      res.status,
      `template="${templateName}" to=${maskPhoneForLog(recipient)}`,
    );
    return { templateName, variables: resolvedVars, wamid };
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

// ── Last inbound message timestamp — 24h compliance engine ────────────────────
// Queries whatsapp_conversations for the most recent inbound message from a
// given phone number. Returns null when there is no prior inbound record (new
// guest who has never replied) OR when the query fails — both cases are treated
// identically by the caller as "outside window" so the safe path (template send)
// is always used. Using the raw timestamp (not the pre-computed
// wa_window_expires_at column) makes the 24h math explicit and independent of
// whether the webhook had a chance to stamp the guest row.
async function getLastInboundTimestamp(
  supabaseClient: ReturnType<typeof createClient>,
  phone: string,
): Promise<Date | null> {
  const { data } = await supabaseClient
    .from("whatsapp_conversations")
    .select("created_at")
    .eq("phone", phone)
    .eq("inbox_channel", "meta")
    .eq("direction", "inbound")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.created_at ? new Date(data.created_at as string) : null;
}

const INBOX_CHANNEL_META = "meta" as const;

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
const MANUAL_TRIGGERS = new Set(["inbox_reply", "broadcast", "payment_and_workshops", "template_test", "manual_script"]);

// ── Manual script placeholder resolver ───────────────────────────────────────
// Deliberately minimal — this is NOT the full resolvePlaceholders() contract
// from whatsapp-webhook (SPA_LINE/OPTIONAL_SPA_TEXT/etc.), only the two tokens
// a staff-triggered, on-demand bot_scripts row actually needs today
// (manual_portal_link). {{PORTAL_LINK}} accepted as an alias for {{portal_url}}
// for consistency with resolvePlaceholders()'s naming tolerance. Same
// graceful-fallback contract as every other placeholder resolver in this
// codebase: substitute the real value when present, strip the containing
// sentence when absent — never leave a raw {{...}} or a dead blank link in
// the outgoing text.
function resolveManualScriptPlaceholders(
  template: string,
  vars: { guestName: string; portalLink: string }
): string {
  let text = template.replace(/\{\{\s*GUEST_NAME\s*\}\}/gi, vars.guestName);

  const PORTAL_PLACEHOLDER_RE = /\{\{\s*(?:PORTAL_LINK|portal_url)\s*\}\}/gi;
  if (vars.portalLink) {
    text = text.replace(PORTAL_PLACEHOLDER_RE, vars.portalLink);
  } else {
    text = text.replace(/[^\n.!?]*\{\{\s*(?:PORTAL_LINK|portal_url)\s*\}\}[^\n.!?]*[.!?]?\s*/gi, "");
  }

  // Safety net — same final chokepoint as every guest-facing sender in this
  // codebase (whatsapp-webhook's sanitizeReply(), interactiveSend.ts's
  // _stripUnresolvedPlaceholders()): never let an unhandled/typo'd token
  // through to the guest raw.
  return text.replace(/\{\{[^}]+\}\}/g, "").replace(/\n{3,}/g, "\n\n").trim();
}

// Full stage_2_arrival contract — mirrors whatsapp-webhook resolvePlaceholders()
// (GUEST_NAME, SPA_LINE, OPTIONAL_SPA_TEXT, SPA_TIME, PORTAL_LINK/portal_url).
// Used when staff resends Stage 2 from WhatsApp Inbox (manual_script stage_2_arrival).
function resolveStage2ArrivalPlaceholders(
  template: string,
  vars: { guestName: string; spaTime: string | null; spaDate?: string | null; portalLink: string },
): string {
  const spaDate = vars.spaDate ?? null;
  const spaTime = vars.spaTime;
  const spaLine = buildSpaLine(spaDate, spaTime);
  const optionalSpaText = buildOptionalSpaText(spaDate, spaTime);

  let text = template
    .replace(/\{\{\s*GUEST_NAME\s*\}\}/gi, vars.guestName)
    .replace(/\{\{\s*WORKSHOP_URL\s*\}\}/gi, "")
    .replace(/\{\{\s*SPA_LINE\s*\}\}/gi, spaLine)
    .replace(/\{\{\s*OPTIONAL_SPA_TEXT\s*\}\}/gi, optionalSpaText);

  const PORTAL_PLACEHOLDER_RE = /\{\{\s*(?:PORTAL_LINK|portal_url)\s*\}\}/gi;
  if (vars.portalLink) {
    text = text.replace(PORTAL_PLACEHOLDER_RE, vars.portalLink);
  } else {
    text = text.replace(/[^\n.!?]*\{\{\s*(?:PORTAL_LINK|portal_url)\s*\}\}[^\n.!?]*[.!?]?\s*/gi, "");
  }

  if (hasSpaBooking(spaDate, spaTime)) {
    const spaSentence = buildSpaTimeSentence(spaDate, spaTime).replace(/\.$/, "");
    text = text.replace(/\{\{\s*SPA_TIME\s*\}\}/gi, spaSentence);
  } else {
    text = text.replace(/[^\n.!?]*\{\{\s*SPA_TIME\s*\}\}[^\n.!?]*[.!?]?\s*/gi, "");
  }

  const hadSpaPlaceholder = /\{\{\s*(?:SPA_LINE|OPTIONAL_SPA_TEXT|SPA_TIME)\s*\}\}/i.test(template);
  if (hasSpaBooking(spaDate, spaTime) && !hadSpaPlaceholder) {
    text = `${text.trim()}\n\n${buildSpaTimeSentence(spaDate, spaTime)}`;
  }

  return text.replace(/\{\{[^}]+\}\}/g, "").replace(/\n{3,}/g, "\n\n").trim();
}

// ── Main handler ──────────────────────────────────────────────────────────────
serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body = await req.json();
    const { trigger, guestId, roomId: requestRoomId, assignments, weekStart, waTemplateName, templateVariables, force, force_channel, manual_override, scheduled_for, is_test, phone: testPhone, image_url: requestImageUrl, pipeline_reconcile, target_channel, housekeeping_co } = body as {
      trigger:             string;
      guestId?:            string;
      roomId?:             string;    // room_ready — canonical suite label (multi-room)
      assignments?:        Record<string, unknown[]>;
      weekStart?:          string;
      waTemplateName?:     string;    // approved WA template name
      templateVariables?:  string[];  // values for {{1}}, {{2}}, … in the template body
      force?:              boolean;   // Manual override: skip kill-switch + idempotency guard
      force_channel?:      "meta_template" | "session_message" | "whapi_session"; // Pin channel for manual dispatch
      manual_override?:    boolean;   // Staff Smart Override — logs context + cancels scheduled_tasks
      scheduled_for?:      string;    // ISO — audit when cancelling a future cron slot
      is_test?:            boolean;   // template_test isolation gate
      phone?:              string;    // template_test target (E.164)
      image_url?:          string;    // optional IMAGE header (templates) or session caption image
      pipeline_reconcile?: boolean;   // cron catch-up for arrival_confirmed guests missing Stage 2
      target_channel?:     "meta" | "whapi"; // Manual staff choice for inbox_reply/broadcast — see guestWhapiRouting.ts
      housekeeping_co?:    boolean;   // Suite survey after housekeeping group Co
    };

    if (!trigger) throw new Error("trigger is required");

    console.log(
      `[whatsapp-send] invoked trigger="${trigger}" guestId=${guestId ?? "n/a"} force=${!!force}` +
      (force_channel ? ` force_channel=${force_channel}` : ""),
    );

    // ── KILL SWITCH — gates AUTONOMOUS sends only ─────────────────────────────
    // Manual, human-initiated triggers (MANUAL_TRIGGERS: inbox_reply, broadcast,
    // payment_and_workshops) are always allowed — they are deliberate staff
    // clicks and (for broadcast/payment) use pre-approved Meta templates that
    // are window-independent. Only the scheduled/autonomous pipeline triggers
    // (and shift_assignment) stay blocked until AUTOMATION_ENABLED=true. The
    // periodic cron has its own independent CRON_ENABLED gate, so enabling
    // manual broadcasts here does NOT unleash the scheduled pipeline.
    if (!MANUAL_TRIGGERS.has(trigger) && !force && housekeeping_co !== true && Deno.env.get("AUTOMATION_ENABLED") !== "true") {
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
    await primeGuestChannelConfig(supabase);

    const sim = isSimulation();

    const overridePayloadExtras = (manual_override === true || force === true)
      ? { context: "Manual Override", manual_override: true }
      : {};

    async function cancelScheduledTaskForOverride(gId: string | number, stageKey: string) {
      if (!manual_override && !force) return;
      const { error } = await supabase.rpc("cancel_scheduled_task_for_override", {
        p_guest_id: gId,
        p_stage_key: stageKey,
        p_scheduled_for: scheduled_for ?? null,
      });
      if (error) console.warn("[whatsapp-send] cancel_scheduled_task_for_override:", error.message);
    }

    async function markScheduledTaskDispatched(gId: string | number, stageKey: string) {
      if (!manual_override && !force) return;
      const { error } = await supabase.rpc("mark_scheduled_task_dispatched", {
        p_guest_id: gId,
        p_stage_key: stageKey,
      });
      if (error) console.warn("[whatsapp-send] mark_scheduled_task_dispatched:", error.message);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // BRANCH T: Template test / preview — isolated, no guest pipeline mutation
    // ─────────────────────────────────────────────────────────────────────────
    if (trigger === "template_test") {
      if (is_test !== true) {
        throw new Error("template_test requires is_test:true");
      }
      if (!waTemplateName) throw new Error("waTemplateName is required for template_test");
      const targetPhone = String(testPhone ?? "").trim();
      if (!targetPhone) throw new Error("phone is required for template_test");

      let vars = templateVariables ?? [];
      if (guestId) {
        const { data: guest, error: gErr } = await supabase
          .from("guests").select("*").eq("id", guestId).maybeSingle();
        if (gErr) throw new Error(`guest_lookup_error: ${gErr.message}`);
        if (guest) {
          vars = ensureTemplateBodyVars(waTemplateName, vars, guest);
        }
      }
      if (!vars.length) {
        vars = sanitizeTemplateVars(["אורח בדיקה"]);
      }

      let status = "simulated";
      let sendError: string | null = null;
      try {
        if (!sim) {
          await sendViaTemplate(targetPhone, waTemplateName, vars, "he", undefined, requestImageUrl);
          status = "sent";
        }
      } catch (e) {
        sendError = (e as Error).message;
        status = sendError.startsWith("timeout_no_response") ? "timeout" : "failed";
        console.error(`[whatsapp-send] template_test ${status}:`, sendError);
      }

      await supabase.from("notification_log").insert({
        guest_id: guestId ?? null,
        recipient: targetPhone,
        trigger_type: "template_test",
        channel: "whatsapp",
        status,
        payload: {
          is_test: true,
          context: "Test/Preview",
          template: waTemplateName,
          variables: vars,
          ...(sendError ? { error: sendError } : {}),
        },
      });

      return new Response(
        JSON.stringify({
          ok: status === "sent" || status === "simulated",
          simulation: sim,
          status,
          template: waTemplateName,
          ...(sendError ? { error: sendError } : {}),
        }),
        { headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

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

      const targetPhone = String(testPhone ?? "").trim();
      if (!guestId && !targetPhone) {
        throw new Error("guestId or phone is required for broadcast trigger");
      }
      if (!waTemplateName) throw new Error("waTemplateName is required for broadcast");

      // Broadcast can target either an explicit guest row (guestId) or a raw phone.
      // This keeps manual template dispatch available even when an inbox thread is
      // not currently linked to a guests row.
      let guest: any = null;
      let resolvedGuestId: number | null = null;
      if (guestId) {
        const { data: byId, error: gErr } = await supabase
          .from("guests").select("*").eq("id", guestId).maybeSingle();
        if (gErr)   throw new Error(`guest_lookup_error: ${gErr.message}`);
        if (!byId)  throw new Error(`guest_not_found: no guest row for id=${JSON.stringify(guestId)}`);
        guest = byId;
        resolvedGuestId = Number(byId.id);
      } else {
        const staffGuest = await loadGuestByPhoneForStaffReply(supabase, targetPhone);
        if (staffGuest?.id) {
          const { data: byPhoneGuest, error: gpErr } = await supabase
            .from("guests")
            .select("*")
            .eq("id", staffGuest.id)
            .maybeSingle();
          if (gpErr) throw new Error(`guest_lookup_error: ${gpErr.message}`);
          if (byPhoneGuest) {
            guest = byPhoneGuest;
            resolvedGuestId = Number(byPhoneGuest.id);
          }
        }
        if (!guest) {
          guest = { id: null, name: "אורח יקר", phone: targetPhone };
        }
      }

      const guestPhone = String(guest.phone ?? "").trim();
      if (!guestPhone) {
        throw new Error(`guest_no_phone: guest id=${guestId ?? "n/a"} (${String(guest.name ?? "?")}) has no phone on file`);
      }

      // Only enforce active-status guard when we truly resolved a guests row.
      const broadcastInactive = resolvedGuestId ? assertGuestEligibleForAutomation(guest) : null;
      if (resolvedGuestId && broadcastInactive) {
        return new Response(
          JSON.stringify({ ok: false, status: "guest_not_active", reason: broadcastInactive, error: GUEST_NOT_ACTIVE_HE }),
          { headers: { ...CORS, "Content-Type": "application/json" } },
        );
      }

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

      const vars = ensureTemplateBodyVars(waTemplateName, templateVariables ?? [], guest);

      // ── Manual channel choice (same contract as inbox_reply above) ────────
      // Whapi-eligible guests (suite/day-pass, GUEST_WHAPI_SUITES_ENABLED)
      // now default to Whapi even for broadcast — a staff campaign that never
      // touches the channel toggle must not silently burn a Meta template fee
      // (the same "silent Meta by default" gap already closed for autonomous
      // cron/pipeline dispatch). target_channel="meta" stays the one
      // deliberate escape hatch — staff explicitly wants the real Meta
      // template (e.g. a button-bearing template Whapi's free-text can't
      // reproduce, or message_templates drifted from the live bot_scripts
      // text). Non-eligible guests (flag off, or genuinely non-suite/
      // non-daypass) keep the original contract: Whapi only on explicit
      // target_channel="whapi".
      if (target_channel === "whapi" && !isGuestWhapiSuitesEnabled()) {
        return new Response(
          JSON.stringify({
            ok: false,
            status: "whapi_disabled",
            error: `whapi_disabled: ${whapiDisabledReasonHe()}`,
          }),
          { headers: { ...CORS, "Content-Type": "application/json" } },
        );
      }
      const routeViaWhapi =
        target_channel === "whapi" ||
        (target_channel !== "meta" && shouldRouteGuestOutboundViaWhapiSuites(guest));

      let status = "simulated";
      let sendError: string | null = null;
      // Populated ONLY on a real, confirmed Meta dispatch — the literal
      // {templateName, variables} pair embedded in the payload Meta accepted.
      // Never fall back to `waTemplateName`/`vars` for logging: those are the
      // caller's INTENT, not proof of what was actually transmitted.
      let dispatched: DispatchedTemplate | null = null;
      let whapiWamid: string | null = null;
      // Resolved once, up front, regardless of sim mode — reused for both the
      // actual send (only when !sim) and the conversation-log fallback below,
      // so a real dispatch never renders the template body twice.
      const whapiBody = routeViaWhapi ? await resolveMetaTemplateBodyText(supabase, waTemplateName, vars) : null;
      try {
        if (!sim) {
          if (routeViaWhapi) {
            whapiWamid = await sendWhapiText(cleanPhoneForMention(guestPhone), whapiBody!);
          } else {
            dispatched = await sendViaTemplate(guestPhone, waTemplateName, vars, "he", undefined, requestImageUrl);
          }
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

      await notifyAdminIfDispatchFailed({
        status,
        error: sendError,
        guestName: guest.name as string,
        guestPhone,
        dispatchType: "Template",
      });

      await supabase.from("notification_log").insert({
        guest_id:     resolvedGuestId,
        recipient:    guestPhone,
        trigger_type: "broadcast",
        channel:      "whatsapp",
        status,
        payload: {
          template:  dispatched?.templateName ?? waTemplateName,
          variables: dispatched?.variables ?? vars,
          ...(routeViaWhapi ? { sendChannel: "whapi" } : {}),
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
          // Simulation mode never calls sendViaTemplate, so `dispatched` stays
          // null there — the caller's intended template/vars are the only
          // truth available. A real send always has `dispatched` populated;
          // it is what actually left for Meta and is what gets logged.
          const broadcastConvMsg = routeViaWhapi
            ? buildWhapiSuitesConversationLog(whapiBody!)
            : await buildConversationLogFromTemplate(
                supabase,
                dispatched?.templateName ?? waTemplateName,
                dispatched?.variables ?? vars,
              );
          const { error: convErr } = await supabase.from("whatsapp_conversations").insert({
            phone:         guest.phone as string,
            guest_id:      guestId,
            direction:     "outbound",
            message:       broadcastConvMsg,
            wa_message_id: routeViaWhapi ? whapiWamid : (dispatched?.wamid ?? null),
            inbox_channel: routeViaWhapi ? "whapi" : "meta",
            channel:       routeViaWhapi ? "whapi" : "meta",
          });
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
      const inboxChannel = String(b.inbox_channel ?? "meta").trim().toLowerCase() === "whapi"
        ? "whapi"
        : "meta";

      if (!targetPhone) throw new Error("phone is required for inbox_reply");
      if (!inboxMsg)    throw new Error("message is required for inbox_reply");

      // Staff must always be able to reply to any phone with an active WA
      // thread — guest status (checked_out, cancelled) is never a gate here,
      // only automation/cron is. A phone matching no guests row at all is
      // also allowed through (staffGuest stays null; logged with guest_id:
      // null below) — conversation history is the contract, not the profile.
      const staffGuest = await loadGuestByPhoneForStaffReply(supabase, targetPhone);

      // Thread-bound channel (inbox_channel) decides routing. Whapi still
      // requires GUEST_WHAPI_SUITES_ENABLED (FAIL VISIBLE if off).
      if (inboxChannel === "whapi" && !isGuestWhapiSuitesEnabled()) {
        return new Response(
          JSON.stringify({
            ok: false,
            status: "whapi_disabled",
            error: `whapi_disabled: ${whapiDisabledReasonHe()}`,
          }),
          { headers: { ...CORS, "Content-Type": "application/json" } },
        );
      }
      const routeViaWhapiSuites = inboxChannel === "whapi";

      let replyStatus = "simulated";
      let replyErr: string | null = null;
      let replyWamid: string | null = null;
      let replyChannel: "meta" | "whapi_suites" = "meta";
      // Set only when the Whapi attempt below hits a CONFIRMED failure (not a
      // timeout) and we fall through to Meta — surfaced only if Meta then also
      // fails, so a successful fallback stays silent to the caller (still
      // console.warn'd for anyone reading Edge Function logs).
      let whapiFallbackNote: string | null = null;

      if (routeViaWhapiSuites) {
        try {
          if (!sim) {
            // Uses the already-connected Whapi device (default WHAPI_TOKEN) —
            // not a separate Suites token/channel. See guestWhapiRouting.ts.
            // Whapi requires bare digits for a 1:1 contact "to" (no leading
            // "+", unlike guests.phone's stored E.164 form) — cleanPhoneForMention
            // is the existing digit-stripping helper, reused here for that reason.
            replyWamid = await sendWhapiText(cleanPhoneForMention(targetPhone), inboxMsg);
          }
          replyStatus = sim ? "simulated" : "sent";
          replyChannel = "whapi_suites";
        } catch (e) {
          const whapiMessage = (e as Error).message;
          if (whapiMessage.startsWith("timeout_no_response")) {
            // Delivery genuinely unknown — never auto-retry on a second real
            // WhatsApp number (risks a guest-visible double send). Surface
            // this distinctly instead of silently falling back to Meta.
            console.error("[whatsapp] inbox_reply Whapi Suites TIMED OUT (unknown delivery):", whapiMessage);
            await notifyAdminIfDispatchFailed({
              status: "timeout",
              error: whapiMessage,
              guestPhone: targetPhone,
              dispatchType: "Session",
              trigger: "inbox_reply",
            });
            return new Response(
              JSON.stringify({
                ok: false,
                status: "timeout",
                error: `whapi_timeout: ${whapiMessage}`,
              }),
              { headers: { ...CORS, "Content-Type": "application/json" } },
            );
          }
          // Confirmed failure (non-2xx, missing token, etc.) — degrade to the
          // existing Meta path below rather than hard-failing the send.
          console.warn("[whatsapp] inbox_reply Whapi Suites send failed, falling back to Meta:", whapiMessage);
          whapiFallbackNote = whapiMessage;
        }
      }

      // Meta path — unchanged behavior. Taken whenever not routing via Whapi
      // at all, OR when the Whapi attempt above hit a confirmed failure.
      if (replyChannel !== "whapi_suites") {
        // ── 24-Hour Interaction Window Guard ───────────────────────────────
        // inbox_reply sends raw free text — previously unchecked here, so a
        // manager replying to a stale thread just hit a possibly-cryptic Meta
        // rejection AFTER attempting the send (CLAUDE.md §CORE BUSINESS LOGIC
        // point 3 flagged this as open). Checking first turns the same
        // inevitable outcome (Meta would reject either way — free text outside
        // the window is a hard Meta rule, not a preference we control) into a
        // fast, clear, pre-send signal instead of an after-the-fact API error.
        // Only enforced when the phone matches a known guest row; an untracked
        // number (no guest record) keeps today's permissive behavior, since we
        // have no window data to check. Not applicable to the Whapi path
        // above — that's a real WhatsApp number, no Meta session-window exists.
        if (inboxChannel === "meta" && staffGuest && !isWindowOpen(staffGuest.wa_window_expires_at)) {
          return new Response(
            JSON.stringify({
              ok: false,
              status: "window_closed",
              error: whapiFallbackNote
                ? `whapi_failed: ${whapiFallbackNote}; window_closed: חלון 24 השעות סגור — האורח לא הגיב ב-24 השעות האחרונות, לא ניתן לשלוח הודעה חופשית. נדרשת תבנית מאושרת.`
                : "window_closed: חלון 24 השעות סגור — האורח לא הגיב ב-24 השעות האחרונות, לא ניתן לשלוח הודעה חופשית. נדרשת תבנית מאושרת.",
            }),
            { headers: { ...CORS, "Content-Type": "application/json" } },
          );
        }

        try {
          if (!sim) {
            replyWamid = await sendViaMeta(targetPhone, inboxMsg);
            replyStatus = "sent";
          }
        } catch (e) {
          replyErr = (e as Error).message;
          console.error("[whatsapp] inbox_reply send failed:", replyErr);
          replyStatus = "failed";
        }

        if (whapiFallbackNote && replyErr) {
          // Both channels were attempted and both failed — combine so the
          // admin alert and caller-visible error carry full context instead
          // of losing the Whapi attempt to a console.warn nobody reads.
          replyErr = `whapi_failed: ${whapiFallbackNote}; meta_failed: ${replyErr}`;
        }
      }

      await notifyAdminIfDispatchFailed({
        status: replyStatus,
        error: replyErr,
        guestPhone: targetPhone,
        dispatchType: inboxChannel === "whapi" ? "Whapi" : "Session",
        trigger: "inbox_reply",
      });

      // Insert outbound row so the inbox thread shows the message immediately.
      // inbox_channel reflects where the message ACTUALLY went (replyChannel,
      // post-fallback) — not the staff-requested inboxChannel — so a Whapi
      // attempt that failed and fell back to Meta files into the Meta thread,
      // matching what the guest really received.
      const deliveredChannel = replyChannel === "whapi_suites" ? "whapi" : "meta";
      await supabase.from("whatsapp_conversations").insert({
        phone:         targetPhone,
        guest_id:      staffGuest?.id ?? null,
        inbox_channel: deliveredChannel,
        direction:     "outbound",
        message:       replyStatus === "failed"
          ? inboxMsg
          : (replyChannel === "whapi_suites"
              ? buildWhapiSuitesConversationLog(inboxMsg)
              : buildSessionConversationLog(inboxMsg)),
        wa_message_id: replyWamid,
        channel:       deliveredChannel,
      });

      // Staff manual reply closes the attention loop — prevents the bot from
      // re-mentioning a topic the team already handled in a prior outbound turn.
      if (staffGuest?.id && replyStatus !== "failed") {
        const { error: guestClearErr } = await supabase.from("guests").update({
          requires_attention:       false,
          attention_reason:         null,
          needs_callback:           false,
        }).eq("id", staffGuest.id);
        if (guestClearErr) {
          console.warn("[whatsapp-send] inbox_reply guest attention clear failed:", guestClearErr.message);
        }
      }

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
        .select("id, name, phone, room, room_type, payment_amount, payment_link_url, direct_payment_url, ezgo_portal_url")
        .eq("id", guestId)
        .maybeSingle();
      if (gErr)   throw new Error(`guest_lookup_error: ${gErr.message}`);
      if (!guest) throw new Error(`guest_not_found: no guest row for id=${JSON.stringify(guestId)}`);
      if (!guest.phone) throw new Error("guest_no_phone");

      // Staff-initiated single-guest send — guest status (checked_out,
      // cancelled) is never a gate here; staff may need to collect a late
      // charge after departure. Only automation/cron enforces status.
      if (!guest.payment_amount) throw new Error("payment_amount_not_set");

      const linkGuard = await guardPaymentLink(supabase, guest, guestId, {
        allowInlineRecovery: true,
      });

      if (!linkGuard.ok) {
        await logPaymentLinkFailure(supabase, guestId, String(guest.phone), "payment_and_workshops", {
          reason: linkGuard.reason,
          recoveryQueued: linkGuard.recoveryQueued,
          manual: true,
        });
        return new Response(
          JSON.stringify({
            ok: false,
            status: "failed_missing_link",
            error: PAYMENT_LINK_FAILURE_LABEL,
            recoveryQueued: linkGuard.recoveryQueued,
          }),
          { headers: { ...CORS, "Content-Type": "application/json" } },
        );
      }

      const safeName = (String(guest.name ?? "").trim()) || "אורח יקר";
      const amount   = String(guest.payment_amount);
      const urlToken = linkGuard.buttonToken;

      // Whapi-eligible guests (suite/day-pass, GUEST_WHAPI_SUITES_ENABLED) get
      // the same approved copy as free text via the Suites device — never
      // dream_payment_and_workshops Meta template (fee + button Whapi can't
      // render anyway). resolveMetaTemplateBodyText reuses the already-synced
      // message_templates content (same helper the broadcast Whapi path
      // uses); the payment link is appended explicitly since Whapi has no
      // button entity to carry linkGuard.url the way Meta's CTA button does.
      const whapiEligiblePay = shouldRouteGuestOutboundViaWhapiSuites(guest);
      const whapiPayBody = whapiEligiblePay
        ? `${await resolveMetaTemplateBodyText(supabase, "dream_payment_and_workshops", [safeName, amount])}\n\n${linkGuard.url}`
        : null;

      let status = "simulated";
      let sendError: string | null = null;
      let payWhapiWamid: string | null = null;
      try {
        if (!sim) {
          if (whapiEligiblePay) {
            payWhapiWamid = await sendWhapiText(cleanPhoneForMention(String(guest.phone)), whapiPayBody!);
          } else {
            await sendViaTemplate(
              String(guest.phone),
              "dream_payment_and_workshops",
              [safeName, amount],
              "he",
              urlToken,
            );
          }
          status = "sent";
        }
      } catch (e) {
        sendError = (e as Error).message;
        console.error("[whatsapp] payment_and_workshops send failed:", sendError);
        status = sendError.startsWith("timeout_no_response") ? "timeout" : "failed";
      }

      await notifyAdminIfDispatchFailed({
        status,
        error: sendError,
        guestName: guest.name as string,
        guestPhone: guest.phone as string,
        dispatchType: whapiEligiblePay ? "Session" : "Template",
      });

      await supabase.from("notification_log").insert({
        guest_id:     guestId,
        recipient:    guest.phone,
        trigger_type: "payment_and_workshops",
        channel:      "whatsapp",
        status,
        payload: {
          channel:  whapiEligiblePay ? "whapi_session" : "meta_template",
          template: "dream_payment_and_workshops",
          amount,
          urlToken,
          paymentUrlValidated: true,
          ...(sendError ? { error: sendError } : {}),
        },
      });

      if (whapiEligiblePay && (status === "sent" || status === "simulated")) {
        try {
          await supabase.from("whatsapp_conversations").insert({
            phone:         guest.phone,
            guest_id:      guestId,
            direction:     "outbound",
            message:       buildWhapiSuitesConversationLog(whapiPayBody!),
            wa_message_id: payWhapiWamid,
            inbox_channel: "whapi",
            channel:       "whapi",
          });
        } catch (e) {
          console.warn("[whatsapp-send] payment_and_workshops conv log failed (non-blocking):", (e as Error).message);
        }
      }

      return new Response(
        JSON.stringify({
          ok: status === "sent" || status === "simulated",
          simulation: sim,
          status,
          channel: whapiEligiblePay ? "whapi_session" : "meta_template",
          ...(sendError ? { error: sendError } : {}),
        }),
        { headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // BRANCH F: manual_script — staff-selected bot_scripts row, on-demand
    //   "Manual Portal Link Dispatch" — lets staff fire any standalone
    //   (trigger_event='manual') bot_scripts row at a specific guest from the
    //   WhatsApp Inbox, independent of automation_stages/cron lifecycle gating.
    //   Sent as a free-text 24h session message (Meta template alternative not
    //   needed — resolves the same {{GUEST_NAME}}/{{portal_url}} placeholders
    //   the automated stage_2_arrival flow uses). Not idempotent — staff may
    //   deliberately resend (e.g. guest lost the link, asked again).
    // ─────────────────────────────────────────────────────────────────────────
    if (trigger === "manual_script") {
      const b = body as Record<string, unknown>;
      const scriptKey = (b.scriptKey as string | undefined)?.trim();
      if (!guestId)   throw new Error("guestId is required for manual_script");
      if (!scriptKey) throw new Error("scriptKey is required for manual_script");

      const { data: guest, error: gErr } = await supabase
        .from("guests")
        .select("id, name, phone, portal_token, wa_window_expires_at, spa_time, spa_date")
        .eq("id", guestId)
        .maybeSingle();
      if (gErr)   throw new Error(`guest_lookup_error: ${gErr.message}`);
      if (!guest) throw new Error(`guest_not_found: no guest row for id=${JSON.stringify(guestId)}`);
      if (!guest.phone) throw new Error(`guest_no_phone: guest id=${guestId} (${guest.name ?? "?"}) has no phone on file`);

      // Staff-initiated single-guest send — guest status (checked_out,
      // cancelled) is never a gate here. Only automation/cron enforces status.

      const { data: scriptRow, error: sErr } = await supabase
        .from("bot_scripts")
        .select("message_text, is_active")
        .eq("script_key", scriptKey)
        .maybeSingle();
      if (sErr) throw new Error(`script_lookup_error: ${sErr.message}`);
      if (!scriptRow?.message_text?.trim()) {
        throw new Error(`script_not_found: no bot_scripts row (or empty message_text) for script_key="${scriptKey}"`);
      }
      if (scriptRow.is_active === false) {
        throw new Error(`script_inactive: bot_scripts row "${scriptKey}" is disabled — enable it in BotScriptEditor first`);
      }

      // Same 24h Interaction Window Guard as BRANCH C (inbox_reply) — this is
      // free text, not an approved Meta template, so Meta rejects it outside
      // the window regardless. Fail fast with a clear reason instead of an
      // after-the-fact Meta error.
      if (!isWindowOpen(guest.wa_window_expires_at)) {
        return new Response(
          JSON.stringify({
            ok: false,
            status: "window_closed",
            error: "window_closed: חלון 24 השעות סגור — האורח לא הגיב ב-24 השעות האחרונות, לא ניתן לשלוח הודעה חופשית. נדרשת תבנית מאושרת.",
          }),
          { headers: { ...CORS, "Content-Type": "application/json" } },
        );
      }

      const safeName   = (String(guest.name ?? "").trim()) || "אורח יקר";
      const portalLink = guest.portal_token
        ? `${PORTAL_BASE_URL}/portal/${guest.portal_token as string}`
        : "";
      const spaTime = normalizeHmTime(guest.spa_time) || null;
      const spaDate = normalizeSpaDateYmd(guest.spa_date) || null;
      const isStage2Arrival = scriptKey === "stage_2_arrival";
      if (!portalLink && /\{\{\s*(?:PORTAL_LINK|portal_url)\s*\}\}/i.test(scriptRow.message_text)) {
        console.warn(`[whatsapp-send] manual_script "${scriptKey}" — guest ${guestId} has no portal_token; stripped portal-link sentence rather than send a blank link.`);
      }
      const manualReply = isStage2Arrival
        ? resolveStage2ArrivalPlaceholders(scriptRow.message_text, { guestName: safeName, spaTime, spaDate, portalLink })
        : resolveManualScriptPlaceholders(scriptRow.message_text, { guestName: safeName, portalLink });

      let status = "simulated";
      let sendError: string | null = null;
      try {
        if (!sim) { await sendViaMeta(String(guest.phone), manualReply); status = "sent"; }
      } catch (e) {
        sendError = (e as Error).message;
        console.error(`[whatsapp-send] manual_script "${scriptKey}" send failed:`, sendError);
        status = sendError.startsWith("timeout_no_response") ? "timeout" : "failed";
      }

      await notifyAdminIfDispatchFailed({
        status,
        error: sendError,
        guestName: guest.name as string,
        guestPhone: guest.phone as string,
        dispatchType: "Session",
      });

      await supabase.from("whatsapp_conversations").insert({
        phone:         guest.phone,
        guest_id:      guestId,
        direction:     "outbound",
        message:       status === "failed" ? manualReply : buildSessionConversationLog(manualReply),
        wa_message_id: null,
      });

      await supabase.from("notification_log").insert({
        guest_id: guestId, recipient: guest.phone,
        trigger_type: "manual_script", channel: "whatsapp",
        status,
        payload: { channel: "session_message", scriptKey, manual: true, ...(sendError ? { error: sendError } : {}) },
      });

      return new Response(
        JSON.stringify({ ok: status === "sent" || status === "simulated", simulation: sim, status, ...(sendError ? { error: sendError } : {}) }),
        { headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // BRANCH D: Pipeline triggers (idempotent via notification_log)
    // ─────────────────────────────────────────────────────────────────────────
    if (!guestId) throw new Error("guestId is required for guest triggers");

    console.log(`[whatsapp-send] BRANCH_D pipeline trigger="${trigger}" guestId=${guestId} force=${!!force}`);

    // Phase 4 (Automation Control Center): automation_stages (migration 065)
    // is now consulted for template name / session-message / buttons routing.
    // The original hardcoded PIPELINE_TEMPLATE/PIPELINE_VARS/GUEST_FLAG maps
    // remain the fallback whenever a stage has no row — room_ready is the one
    // pipeline trigger that is intentionally NOT in automation_stages (it's
    // event-driven from the RoomBoard/AICopilot UI toggle, not a timeline
    // stage), so it always falls through to the hardcoded map, unchanged.
    // Same "DB overrides, hardcoded fallback" pattern already proven for
    // bot_settings.system_prompt overriding FALLBACK_SYSTEM_PROMPT.
    // Manual override (force=true) reads inactive stages too — admin may test a paused stage.
    // is_active is NOT filtered here anymore (was: `.eq("is_active", true)` when
    // !force) — a stage paused only for a pending Meta template approval must
    // still reach Whapi-eligible suite guests. The is_active check now happens
    // below, once `guest` is loaded, via the shared isStageEffectivelyActive
    // gate (same one whatsapp-cron/automation-queue use).
    const { data: stageRow } = await supabase
      .from("automation_stages")
      .select("meta_template_name, session_message_script_key, session_message_script_key_shabbat, session_message_image_url, session_message_image_url_shabbat, interactive_buttons, guest_flag_column, is_active")
      .eq("stage_key", trigger)
      .maybeSingle();

    const forceMetaTemplate   = force === true && force_channel === "meta_template";
    const forceSessionMessage = force === true && force_channel === "session_message";
    // Manual dispatch of tonight's automation through the Whapi device
    // (AutomationControlCenter's ManualDispatchModal) — explicit staff choice
    // only, same two-gate contract as inbox_reply/broadcast above.
    const forceWhapiSession   = force === true && force_channel === "whapi_session";
    if (forceWhapiSession && !isGuestWhapiSuitesEnabled()) {
      throw new Error(`whapi_disabled: ${whapiDisabledReasonHe()}`);
    }
    // stage_2_arrival, night_before, morning_suite/morning_welcome, and
    // room_ready each have their own dedicated block below that explicitly
    // handles force_channel="whapi_session" (§3 — morning_suite/welcome and
    // room_ready were unsupported via Whapi until this rollout; all three now
    // have a bot_scripts-via-Whapi path with FAIL VISIBLE if the script is
    // missing). Every other trigger falls through to the generic pipeline
    // branch, which guards this itself (throws whapi_session_unavailable when
    // that stage has no session_message_script_key configured). Kept as an
    // explicit, empty allowlist-of-exceptions (not deleted) so a FUTURE stage
    // added without a Whapi path can be added back here deliberately, instead
    // of silently sending via Meta to a guest who opted out of it.
    const WHAPI_UNSUPPORTED_STAGES = new Set<string>([]);
    if (forceWhapiSession && WHAPI_UNSUPPORTED_STAGES.has(trigger)) {
      throw new Error(`whapi_session_unavailable: שלב "${trigger}" אינו נתמך עדיין דרך Whapi — נא לבחור ערוץ אחר.`);
    }

    if (!(trigger in PIPELINE_TEMPLATE) && !stageRow?.meta_template_name && !stageRow?.session_message_script_key) {
      throw new Error("unknown trigger: " + trigger);
    }

    const { data: guest, error: gErr } = await supabase
      .from("guests").select("*").eq("id", guestId).maybeSingle();
    if (gErr)   throw new Error(`guest_lookup_error: ${gErr.message}`);
    if (!guest) throw new Error(`guest_not_found: no guest row for id=${JSON.stringify(guestId)}`);

    // Stage paused (is_active=false, e.g. Meta template pending approval) and
    // this guest isn't Whapi-eligible → same effective behavior as the old
    // `.eq("is_active", true)` query filter for this guest (skip, don't send).
    // Whapi-eligible suite guests bypass a Meta-template-only pause — same
    // shared gate whatsapp-cron/automation-queue use (isStageEffectivelyActive).
    // Manual force=true is untouched (admin explicitly testing a paused stage).
    if (!force && stageRow && !isStageEffectivelyActive(stageRow as { is_active: boolean }, guest)) {
      console.log(`[whatsapp-send] skipped trigger="${trigger}" guestId=${guestId} reason=stage_inactive`);
      return new Response(
        JSON.stringify({ ok: true, skipped: true, reason: "stage_inactive" }),
        { headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    // FAIL VISIBLE (P0, session 125): suite room + day-pass room_type is a data
    // conflict — routing below treats this guest as SUITE (suiteNames.ts).
    if (hasSuiteRoomTypeConflict(guest)) {
      console.warn(
        `[whatsapp-send] room_type_conflict: guest_id=${guestId} room="${guest.room}" ` +
        `is a canonical suite but room_type=${guest.room_type} — routing as SUITE`,
      );
    }

    const pipelineInactive = !force ? assertGuestEligibleForAutomation(guest, trigger) : null;
    if (pipelineInactive) {
      console.log(`[whatsapp-send] skipped trigger="${trigger}" guestId=${guestId} reason=${pipelineInactive}`);
      return new Response(
        JSON.stringify({ ok: true, skipped: true, reason: pipelineInactive }),
        { headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    const lifecycleBlock = !force ? assertPipelineLifecycleForTrigger(trigger, guest) : null;
    if (lifecycleBlock) {
      console.warn(
        `[whatsapp-send] lifecycle_gate: trigger="${trigger}" guestId=${guestId} ` +
        `arrival=${guest.arrival_date ?? "null"} departure=${guest.departure_date ?? "null"} ` +
        `status=${guest.status ?? "null"} reason=${lifecycleBlock}`,
      );
      return new Response(
        JSON.stringify({ ok: true, skipped: true, reason: lifecycleBlock }),
        { headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    if (["night_before", "morning_suite", "morning_welcome", "night_before_daypass", "morning_daypass"].includes(trigger)) {
      await fetchNightBeforeKnowledge(supabase);
    }

    // automation_scope: muted = no pipeline; courtesy_only = mid_stay only (+ exempt).
    // room_ready + manual triggers stay exempt (AICopilot / staff dispatch).
    const AUTOMATION_MUTE_EXEMPT = new Set([...MANUAL_TRIGGERS, "room_ready"]);
    const scopeBlock = !force
      ? getAutomationScopeTriggerBlockReason(guest, trigger, AUTOMATION_MUTE_EXEMPT)
      : null;
    if (scopeBlock) {
      console.log(`[whatsapp-send] skipped trigger="${trigger}" guestId=${guestId} reason=${scopeBlock}`);
      return new Response(
        JSON.stringify({ ok: true, skipped: true, reason: scopeBlock }),
        { headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    // Staff "קח שיחה" — block autonomous pipeline/cron triggers only; manual
    // inbox/broadcast and deliberate room_ready approval still allowed.
    const STAFF_CLAIM_AUTOMATION_EXEMPT = new Set([...MANUAL_TRIGGERS, "room_ready"]);
    if (
      !force &&
      !pipeline_reconcile &&
      guest.claimed_by != null &&
      guest.claimed_by !== "" &&
      !STAFF_CLAIM_AUTOMATION_EXEMPT.has(trigger)
    ) {
      console.log(`[whatsapp-send] skipped trigger="${trigger}" guestId=${guestId} reason=staff_claim_active`);
      return new Response(
        JSON.stringify({ ok: true, skipped: true, reason: "staff_claim_active" }),
        { headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    if (force === true || manual_override === true) {
      await cancelScheduledTaskForOverride(guestId, trigger);
    }

    // ── Day Pass Safety Gate ─────────────────────────────────────────────────
    // Day Pass guests (room_type='day_guest') are entitled to:
    //   Stage 1   pre_arrival_2d      — arrival confirmation
    //   Stage 2.5 night_before_daypass — evening-before reminder (bifurcated template, see below)
    //   Stage 3   morning_welcome     — morning-of arrival (bifurcated to day-pass fast-path below)
    //   Stage 5   checkout_fb         — post-stay feedback
    // Suite-specific stages (morning_suite, mid_stay, room_ready) remain blocked as a
    // server-side authoritative guard. The UI enforces the same rule for UX clarity
    // but this is the canonical enforcement point (CLAUDE.md §0.1 Zero Data Loss —
    // a day-pass guest must never silently receive a suite welcome or mid-stay
    // message that references spa/suite amenities they don't have).
    // Stage 2.5 (night_before) is now split: suite guests receive 'night_before',
    // day-pass guests receive 'night_before_daypass' (separate automation_stages row,
    // migration 093). Stage 3 (morning_welcome) now applies to day-pass guests too.
    const DAY_PASS_ALLOWED_TRIGGERS = new Set([
      "pre_arrival_2d", "stage_2_arrival", "night_before_daypass", "morning_welcome",
      "mid_stay_daypass", "checkout_fb_daypass", "spa_warmup_daypass", "survey_invite_daypass",
    ]);
    // isEffectiveDayPassGuest (not raw room_type): a suite-room guest mis-tagged
    // day_guest must NOT be run through day-pass restrictions (P0, session 125).
    if (!force && isEffectiveDayPassGuest(guest) && !DAY_PASS_ALLOWED_TRIGGERS.has(trigger)) {
      console.warn(
        `[whatsapp-send] day_pass_stage_gate: trigger="${trigger}" blocked for ` +
        `guest_id=${guestId} (room_type=${guest.room_type}) — allowed: pre_arrival_2d, stage_2_arrival, night_before_daypass, morning_welcome, mid_stay_daypass, checkout_fb_daypass, spa_warmup_daypass, survey_invite_daypass`,
      );
      return new Response(
        JSON.stringify({
          ok: false,
          status: "blocked",
          reason: "day_pass_stage_gate",
          error: `שלב "${trigger}" אינו מורשה לאורחי יום-כיף — מותרים: אישור הגעה, שלב 2, תזכורת ערב לפני (בילוי יומי), בוקר הגעה, ומשוב`,
        }),
        { headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    // ── Suite Safety Gate (mirror of the Day Pass gate above) ───────────────
    // A true suite guest (room_type='suite' OR canonical suite room) must never
    // receive day-pass-only stages — this is the server-authoritative backstop
    // for the misrouting incident (suite guest got morning_daypass content).
    const DAYPASS_ONLY_TRIGGERS = new Set([
      "night_before_daypass", "morning_daypass", "mid_stay_daypass", "checkout_fb_daypass",
      "spa_warmup_daypass", "survey_invite_daypass",
    ]);
    if (!force && isEffectiveSuiteGuest(guest) && DAYPASS_ONLY_TRIGGERS.has(trigger)) {
      console.warn(
        `[whatsapp-send] suite_daypass_stage_gate: trigger="${trigger}" blocked for ` +
        `guest_id=${guestId} (room="${guest.room ?? ""}" room_type=${guest.room_type}) — ` +
        `suite guests use the suite counterpart stage`,
      );
      return new Response(
        JSON.stringify({
          ok: false,
          status: "blocked",
          reason: "suite_daypass_stage_gate",
          error: `שלב "${trigger}" הוא שלב יום-כיף — האורח משויך לסוויטה (${guest.room ?? guest.room_type ?? ""}) ולכן חסום. השתמש בשלב הסוויטות המקביל.`,
        }),
        { headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    // Day Pass Stage 1 template override — hardcoded router, highest priority.
    // dream_checkin_reminder_v2 is the approved template for day-pass check-in
    // confirmation. PIPELINE_TEMPLATE["pre_arrival_2d"] resolves to
    // dream_arrival_confirmation (the suite/standard template), which references
    // suite amenities (spa, room key handover) that a day-pass guest does not
    // receive. This override fires AFTER the Day Pass Safety Gate above (ensuring
    // it can only apply to an allowed trigger) and before the session-message /
    // portal-button paths below, so every dispatch path for a day-pass
    // pre_arrival_2d picks this template without exception.
    let tmplName = resolvePipelineTemplateName(trigger, guest, stageRow);
    if (guest.room_type === "day_guest" && !isCanonicalSuiteRoom(guest.room) && trigger === "pre_arrival_2d") {
      console.log(
        `[whatsapp-send] day_pass_template_override: stage=pre_arrival_2d → ` +
        `dream_checkin_reminder_v2 for guest_id=${guestId} (${String(guest.name ?? "?")})`,
      );
    }
    const flagColumn = stageRow?.guest_flag_column ?? GUEST_FLAG[trigger];

    // Duplicate shield — after guest load so we have phone for logging.
    // force=true bypasses (staff deliberate re-send from ACC).
    const dupCheck = await checkPipelineDuplicate(supabase, {
      guestId,
      triggerType: trigger,
      force: force === true,
    });
    if (dupCheck.blocked) {
      const recipient = safeGuestPhone(guest.phone) ?? String(guest.phone ?? "");
      await logDuplicateBlocked(supabase, {
        guestId,
        recipient,
        triggerType: trigger,
        reason: dupCheck.reason,
        priorSentAt: dupCheck.priorSentAt,
        source: "whatsapp-send",
      });
      console.log(
        `[whatsapp-send] duplicate_blocked trigger="${trigger}" guestId=${guestId} prior=${dupCheck.priorSentAt ?? "?"}`,
      );
      return new Response(
        JSON.stringify(duplicateBlockedResponseBody(dupCheck)),
        { headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    // ── Stage 2 Arrival — rich session message only (no Meta template) ────────
    if (trigger === "stage_2_arrival") {
      const targetPhone = safeGuestPhone(guest.phone);
      if (!targetPhone) {
        return new Response(
          JSON.stringify({
            ok: false, status: "failed",
            error: `guest_no_phone: guest id=${guestId} (${String(guest.name ?? "?")}) has no phone on file`,
          }),
          { headers: { ...CORS, "Content-Type": "application/json" } },
        );
      }

      // All autonomous suite-guest automation routes through Whapi when the
      // feature flag is on (owner decision, 2026-07-10) — no dispatch_channel
      // gate. Manual force_channel="whapi_session" still applies on top.
      const useWhapiDispatchChannel = shouldUseWhapiForGuestAutomation(guest);
      const s2Channel: "meta" | "whapi" = (forceWhapiSession || useWhapiDispatchChannel) ? "whapi" : "meta";

      const confirmFresh = !!guest.arrival_confirmed_at &&
        (Date.now() - new Date(guest.arrival_confirmed_at as string).getTime()) < 48 * 3600 * 1000;
      const windowOk = s2Channel === "whapi" || isWindowOpen(guest.wa_window_expires_at) || confirmFresh || pipeline_reconcile === true;

      if (!force && !forceSessionMessage && !windowOk) {
        return new Response(
          JSON.stringify({
            ok: false,
            status: "window_closed",
            error: "חלון 24 השעות סגור — לא ניתן לשלוח הודעת הגעה (שלב 2) עד שהאורח ישלח הודעה.",
          }),
          { headers: { ...CORS, "Content-Type": "application/json" } },
        );
      }

      const scriptKey = stageRow?.session_message_script_key ?? "stage_2_arrival";
      const { data: scriptRow } = await supabase
        .from("bot_scripts")
        .select("message_text")
        .eq("script_key", scriptKey)
        .maybeSingle();
      const rawText = scriptRow?.message_text?.trim();
      if (!rawText) throw new Error(`stage_2_arrival: bot_scripts.${scriptKey} missing or empty`);

      const guestName = (String(guest.name ?? "").trim()) || "אורח יקר";
      const portalLink = guest.portal_token
        ? `${PORTAL_BASE_URL}/portal/${guest.portal_token as string}`
        : "";
      const body = resolveStage2ArrivalPlaceholders(rawText, {
        guestName,
        spaTime: normalizeHmTime(guest.spa_time) || null,
        spaDate: normalizeSpaDateYmd(guest.spa_date) || null,
        portalLink,
      });

      const s2ClaimRes = await claimStageDispatch(supabase, {
        guestId: Number(guestId), trigger: "stage_2_arrival", recipient: targetPhone,
        force: force === true, tag: "STAGE2_ARRIVAL",
      });
      if (s2ClaimRes.conflictResponse) return s2ClaimRes.conflictResponse;

      let s2Status = "simulated";
      let s2Error: string | null = null;
      let s2WhapiWamid: string | null = null;
      try {
        if (!sim) {
          if (s2Channel === "whapi") {
            s2WhapiWamid = await sendWhapiText(cleanPhoneForMention(targetPhone), body);
          } else {
            await sendStageSessionMessage(
              targetPhone, body, undefined, [],
              `stage_2_arrival guest_id=${guestId}`,
            );
          }
          s2Status = "sent";
        }
      } catch (e) {
        s2Error = (e as Error).message;
        s2Status = s2Error.startsWith("timeout_no_response") ? "timeout" : "failed";
        console.error(`[whatsapp-send] stage_2_arrival ${s2Status}:`, s2Error);
      }

      await finalizeDispatchAttempt(supabase, s2ClaimRes.claim.logId, s2Status, {
        channel: s2Channel === "whapi" ? "whapi_session" : "session_message",
        force: !!force,
        ...(s2Error ? { error: s2Error } : {}),
      });

      if (s2Status === "sent" || s2Status === "simulated") {
        try {
          const convMsg = s2Channel === "whapi"
            ? buildWhapiSuitesConversationLog(body)
            : buildSessionConversationLog(body);
          const s2WamId = s2Channel === "whapi" ? s2WhapiWamid : null;
          let { error: convErr } = await supabase.from("whatsapp_conversations").insert({
            phone:         targetPhone,
            guest_id:      guestId,
            direction:     "outbound",
            message:       convMsg,
            intent:        "arrival_confirmed",
            wa_message_id: s2WamId,
            inbox_channel: s2Channel,
            channel:       s2Channel,
          });
          if (convErr?.code === "23514") {
            const retry = await supabase.from("whatsapp_conversations").insert({
              phone: targetPhone, guest_id: guestId, direction: "outbound",
              message: convMsg, intent: null, wa_message_id: s2WamId,
              inbox_channel: s2Channel, channel: s2Channel,
            });
            convErr = retry.error;
          }
          if (convErr) {
            console.error("[whatsapp-send] stage_2_arrival conversation log FAILED:", convErr.message);
            await supabase.from("notification_log").insert({
              guest_id: guestId,
              recipient: targetPhone,
              trigger_type: "stage_2_arrival",
              channel: "whatsapp",
              status: "failed",
              payload: { log_failure: true, conv_error: convErr.message, original_status: s2Status },
            });
          }
        } catch (e) {
          const errMsg = (e as Error).message;
          console.error("[whatsapp-send] stage_2_arrival conversation log FAILED:", errMsg);
        }

        await supabase.from("guests").update({ msg_stage_2_arrival_sent: true }).eq("id", guestId);
        if (force || manual_override) {
          await markScheduledTaskDispatched(guestId, trigger);
        }
      }

      return new Response(
        JSON.stringify({
          ok: s2Status === "sent" || s2Status === "simulated",
          simulation: sim,
          status: s2Status,
          channel: s2Channel === "whapi" ? "whapi_session" : "session_message",
          ...(s2Error ? { error: s2Error } : {}),
        }),
        { headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    // Manual override — force Meta template, bypass all window/session routing ─
    // night_before is excluded: Stage 2.5 has its own fast-path below that picks
    // night_before_suites / _shabbat (not automation_stages.meta_template_name).
    if (forceMetaTemplate && trigger !== "night_before") {
      if (shouldRouteGuestOutboundViaWhapiSuites(guest) && !isMetaGuestTemplateAllowed()) {
        return metaTemplateBlockedForWhapiGuestResponse();
      }
      const targetPhone = safeGuestPhone(guest.phone);
      if (!targetPhone) {
        console.warn(`[whatsapp-send] force meta: guest_id=${guestId} has no phone`);
        return new Response(
          JSON.stringify({
            ok: false,
            status: "failed",
            error: `guest_no_phone: guest id=${guestId} (${String(guest.name ?? "?")}) has no phone on file`,
          }),
          { headers: { ...CORS, "Content-Type": "application/json" } },
        );
      }

      const forcedTmpl = tmplName || resolvePipelineTemplateName(trigger, guest, stageRow);
      const forcedVars = resolveTemplateVars(trigger, guest, forcedTmpl);
      const forcedButton = resolveDynamicUrlButtonParam(forcedTmpl, guest.portal_token);

      let fmStatus = "simulated";
      let fmError: string | null = null;
      let fmDispatched: DispatchedTemplate | null = null;
      try {
        if (!sim) {
          fmDispatched = await sendViaTemplate(targetPhone, forcedTmpl, forcedVars, "he", forcedButton, stageRow?.session_message_image_url ?? requestImageUrl);
          fmStatus = "sent";
        }
      } catch (e) {
        fmError = (e as Error).message;
        fmStatus = fmError.startsWith("timeout_no_response") ? "timeout"
                 : isMetaTemplateError(fmError) ? "blocked_by_meta"
                 : "failed";
        console.error(`[whatsapp-send] force meta_template ${fmStatus}:`, fmError);
      }

      await notifyAdminIfDispatchFailed({
        status: fmStatus,
        error: fmError,
        guestName: guest.name as string,
        guestPhone: targetPhone,
        dispatchType: "Template",
      });

      await supabase.from("notification_log").insert({
        guest_id: guestId,
        recipient: targetPhone,
        trigger_type: trigger,
        channel: "whatsapp",
        status: fmStatus,
        payload: {
          channel: "meta_template",
          template: fmDispatched?.templateName ?? forcedTmpl,
          variables: fmDispatched?.variables ?? forcedVars,
          forced: true,
          force_channel: "meta_template",
          ...overridePayloadExtras,
          ...(fmError ? { error: fmError } : {}),
        },
      });

      if (fmStatus === "sent" || fmStatus === "simulated") {
        try {
          const fmConvMsg = await buildConversationLogFromTemplate(
            supabase,
            fmDispatched?.templateName ?? forcedTmpl,
            fmDispatched?.variables ?? forcedVars,
          );
          await supabase.from("whatsapp_conversations").insert({
            phone: targetPhone,
            guest_id: guestId,
            direction: "outbound",
            message: fmConvMsg,
            wa_message_id: fmDispatched?.wamid ?? null,
          });
        } catch { /* best-effort */ }
        if (flagColumn) {
          await supabase.from("guests").update({ [flagColumn]: true }).eq("id", guestId);
        }
        await markScheduledTaskDispatched(guestId, trigger);
      }

      return new Response(
        JSON.stringify({
          ok: fmStatus === "sent" || fmStatus === "simulated",
          simulation: sim,
          status: fmStatus,
          channel: "meta_template",
          template: forcedTmpl,
          ...(fmError ? { error: fmError } : {}),
        }),
        { headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    // ── Night-before dispatch (Stage 2.5 — suites only) ─────────────────────
    // Day-pass guests use trigger 'night_before_daypass' (generic BRANCH D below).
    //
    // Routing rule (Stage 2.5), fixed 2026-07-09 — previously force_channel was read
    // for logging only; `forceSessionImmediate = (force === true)` unconditionally won
    // whenever force was true, so `useSessionChannel`/the meta_template branch below it
    // were dead code and manual dispatch ALWAYS sent session text regardless of which
    // channel staff picked. Now a real switch on force_channel when manually dispatched:
    //   • Manual + force_channel="meta_template" → Shabbat/weekday Meta template.
    //   • Manual + force_channel="whapi_session"  → same bot_script text as session_message,
    //     sent via the Whapi Suites device instead of Meta.
    //   • Manual + force_channel="session_message" (or no force_channel at all, the
    //     pre-existing default for any caller that doesn't specify one) → Meta session text.
    //   • Autonomous cron/default (force !== true) → UNCHANGED — ALWAYS Meta template
    //     night_before_suites / _shabbat. Never hijack to session text just because the
    //     24h window is open — that path bypasses the Shabbat-approved static template
    //     bodies and caused 15:00 on Saturdays.
    type NightBeforeDispatch =
      | { channel: "text";     freeTextKey: string;   guestName: string; sessionImageUrl?: string }
      | { channel: "whapi";    freeTextKey: string;   guestName: string; sessionImageUrl?: string }
      | { channel: "template"; templateName: string;  vars: string[];   buttonUrlParam?: string };
    let nightBeforeDispatch: NightBeforeDispatch | null = null;

    if (trigger === "night_before") {
      const arrivalYmd = normalizeArrivalDateYmd(guest.arrival_date);
      const isBundleArrival = isNightBeforeShabbatBundleArrival(arrivalYmd);
      const sessionScriptKey = resolveShabbatAwareScriptKey(stageRow, isBundleArrival, "night_before_reminder");
      const windowOpen = isWindowOpen(guest.wa_window_expires_at);
      const isForceOverride = force === true;

      console.log("=== STAGE 2.5 FORCE ATTEMPT ===");
      console.log("Guest:", guest.name, "Room Type:", guest.room_type, "Arrival:", guest.arrival_date);
      console.log(
        `[whatsapp-send] night_before: Stage 2.5 dispatch guest_id=${guestId} ` +
        `room_type=${guest.room_type ?? "null"} arrival=${guest.arrival_date ?? "null"} ` +
        `msg_pre_arrival_sent=${String(guest.msg_pre_arrival_sent)} windowOpen=${windowOpen} ` +
        `isForceOverride=${isForceOverride} force_channel=${force_channel ?? "auto"} ` +
        `wa_window_expires_at=${guest.wa_window_expires_at ?? "null"}`,
      );

      const sessionImage = isForceOverride
        ? (resolveShabbatAwareSessionImageUrl(stageRow, isBundleArrival, requestImageUrl) ?? NIGHT_BEFORE_OVERRIDE_SESSION_IMAGE)
        : resolveShabbatAwareSessionImageUrl(stageRow, isBundleArrival, requestImageUrl);

      const guestName = sanitizeTemplateVars([String(guest.name ?? "")])[0];

      const buildTemplateDispatch = (): NightBeforeDispatch => {
        const arrivalDateStr = normalizeArrivalDateYmd(guest.arrival_date);
        const isShabbat = isNightBeforeShabbatBundleArrival(arrivalDateStr);
        const templateName = isShabbat ? "night_before_suites_shabbat" : "night_before_suites";
        const templateVars = buildNameOnlyTemplateVars(guest);
        console.log(
          `[whatsapp-send] night_before: route=meta_template guest_id=${guestId} ` +
          `arrival=${arrivalDateStr} template=${templateName} isShabbat=${isShabbat} ` +
          `vars=${JSON.stringify(templateVars)}`,
        );
        return { channel: "template", templateName, vars: templateVars };
      };

      if (isForceOverride && force_channel === "meta_template") {
        if (shouldRouteGuestOutboundViaWhapiSuites(guest) && !isMetaGuestTemplateAllowed()) {
          return metaTemplateBlockedForWhapiGuestResponse();
        }
        nightBeforeDispatch = buildTemplateDispatch();
      } else if (isForceOverride && force_channel === "whapi_session") {
        nightBeforeDispatch = { channel: "whapi", freeTextKey: sessionScriptKey, guestName, sessionImageUrl: sessionImage };
        console.log(
          `[whatsapp-send] night_before: route=whapi_session guest_id=${guestId} ` +
          `script=${sessionScriptKey}`,
        );
      } else if (isForceOverride) {
        // force_channel="session_message", or manual dispatch with no force_channel at
        // all (pre-existing default behavior, preserved for any caller that omits it).
        nightBeforeDispatch = { channel: "text", freeTextKey: sessionScriptKey, guestName, sessionImageUrl: sessionImage };
        console.log(
          `[whatsapp-send] night_before: route=session_message guest_id=${guestId} ` +
          `script=${sessionScriptKey} has_image=${!!sessionImage}`,
        );
      } else {
        // Autonomous cron/default. dispatch_channel="whapi" guests (migration
        // 166) now route to the session bot_script via Whapi instead of the
        // Meta template (§3 — previously ALWAYS Meta template regardless of
        // dispatch_channel, the main gap in this rollout). Whapi has no
        // template/session-window concept, so this is the only channel
        // available to them. Meta guests are completely unaffected —
        // dispatch_channel defaults to "meta" until §4's staff picker sets
        // it, so buildTemplateDispatch() (and the Shabbat anti-hijack rule
        // above) stays the only path for every guest that hasn't opted in.
        const useWhapiAutonomous = shouldUseWhapiForGuestAutomation(guest);
        nightBeforeDispatch = useWhapiAutonomous
          ? { channel: "whapi", freeTextKey: sessionScriptKey, guestName, sessionImageUrl: sessionImage }
          : buildTemplateDispatch();
      }
    }

    // ── Night-before fast-path execution — early return ───────────────────────
    // Handles the full send + log + flag-stamp for trigger === "night_before"
    // and exits, bypassing the generic session_message/Meta-template hybrid
    // below. Other triggers skip this block entirely (nightBeforeDispatch is null).
    if (nightBeforeDispatch !== null) {
      console.log(
        `[whatsapp-send] night_before: executing dispatch guest_id=${guestId} ` +
        `channel=${nightBeforeDispatch.channel}` +
        (nightBeforeDispatch.channel === "template" ? ` template=${nightBeforeDispatch.templateName}` : ""),
      );
      const nbClaimRes = await claimStageDispatch(supabase, {
        guestId: Number(guestId), trigger, recipient: String(guest.phone),
        force: force === true, tag: "NIGHT_BEFORE",
      });
      if (nbClaimRes.conflictResponse) return nbClaimRes.conflictResponse;

      let nbStatus = "simulated";
      let nbError: string | null = null;
      let nbSessionKind: string | null = null;
      let nbSessionImageUrl: string | undefined;
      let nbConvMessage = "";
      let nbWhapiWamid: string | null = null;

      try {
        if (!sim) {
          if (nightBeforeDispatch.channel === "text" || nightBeforeDispatch.channel === "whapi") {
            const isWhapi = nightBeforeDispatch.channel === "whapi";
            const nbForceSessionImmediate = force === true;
            nbSessionImageUrl =
              nightBeforeDispatch.sessionImageUrl
              ?? resolveShabbatAwareSessionImageUrl(
                stageRow,
                isNightBeforeShabbatBundleArrival(normalizeArrivalDateYmd(guest.arrival_date)),
                requestImageUrl,
              )
              ?? (nbForceSessionImmediate ? NIGHT_BEFORE_OVERRIDE_SESSION_IMAGE : undefined);
            const { data: scriptRow } = await supabase
              .from("bot_scripts")
              .select("message_text")
              .eq("script_key", nightBeforeDispatch.freeTextKey)
              .maybeSingle();
            const rawText = scriptRow?.message_text?.trim();
            if (!rawText) {
              if (isWhapi) {
                // Staff explicitly chose Whapi — never silently fall back to a Meta
                // template they didn't ask for (FAIL VISIBLE §0.3), same precedent as
                // the generic pipeline branch's whapi_session path.
                throw new Error(
                  "night_before_whapi_script_missing — הגדר טקסט ל-night_before_reminder ב-BotScriptEditor כדי לשלוח דרך Whapi",
                );
              }
              if (nbForceSessionImmediate) {
                throw new Error(
                  "night_before_session_script_missing — הגדר טקסט ל-night_before_reminder ב-BotScriptEditor",
                );
              }
              console.warn(
                `[whatsapp-send] night_before: bot_script "${nightBeforeDispatch.freeTextKey}" missing` +
                ` — falling back to template for guest_id=${guestId}`,
              );
              const arrivalDateStr = normalizeArrivalDateYmd(guest.arrival_date);
              const isShabbatFb = isNightBeforeShabbatBundleArrival(arrivalDateStr);
              const fbTemplate = isShabbatFb ? "night_before_suites_shabbat" : "night_before_suites";
              const fbVars = buildNameOnlyTemplateVars(guest);
              const fbDispatched = await sendViaTemplate(
                String(guest.phone),
                fbTemplate,
                fbVars,
                "he",
                undefined,
                nbSessionImageUrl,
              );
              nbConvMessage = await buildConversationLogFromTemplate(
                supabase,
                fbDispatched.templateName,
                fbDispatched.variables,
              );
            } else {
              // Shared body construction — identical for Meta session and Whapi, so the
              // Shabbat-aware entry/check-in times (resolveNightBeforeTimes) and the
              // applySaturdayCheckInTimeOverride safety net apply the same way regardless
              // of transport. Only the send call below differs.
              const arrivalYmd = normalizeArrivalDateYmd(guest.arrival_date);
              const nbTimes = await resolveNightBeforeTimes(supabase, arrivalYmd);
              const nbPortalUrl = guest.portal_token
                ? `${PORTAL_BASE_URL}/portal/${guest.portal_token as string}`
                : "";
              const textBody = applySaturdayCheckInTimeOverride(
                expandSessionPlaceholders(rawText, guest, {
                  guestName: nightBeforeDispatch.guestName,
                  entryTime: nbTimes.entryTime,
                  checkInTime: nbTimes.checkInTime,
                  portalUrl: nbPortalUrl,
                }),
                arrivalYmd,
              );
              if (isWhapi) {
                nbConvMessage = buildWhapiSuitesConversationLog(textBody);
                nbWhapiWamid = await dispatchWhapiSessionMessage(
                  String(guest.phone),
                  textBody,
                  nbSessionImageUrl,
                );
                nbSessionKind = "whapi";
              } else {
                nbConvMessage = buildSessionConversationLog(
                  textBody,
                  (stageRow?.interactive_buttons ?? []) as InteractiveButtonDef[],
                );
                nbSessionKind = await sendStageSessionMessage(
                  String(guest.phone),
                  textBody,
                  nbSessionImageUrl,
                  [],
                  `night_before guest_id=${guestId}`,
                );
              }
            }
          } else {
            // Template path — reachable both autonomously (cron default) and manually
            // (staff explicitly picked "🔵 Meta Template"). Same send either way.
            console.log(
              `[whatsapp-send] night_before Stage2.5 pre-send: template=${nightBeforeDispatch.templateName} ` +
              `vars=${JSON.stringify(nightBeforeDispatch.vars)} ` +
              `phone=${maskPhoneForLog(safeGuestPhone(guest.phone))} sim=${sim}`,
            );
            const nbTmplDispatched = await sendViaTemplate(
              String(guest.phone),
              nightBeforeDispatch.templateName,
              nightBeforeDispatch.vars,
              "he",
              undefined,
              stageRow?.session_message_image_url ?? requestImageUrl,
            );
            nbConvMessage = await buildConversationLogFromTemplate(
              supabase,
              nbTmplDispatched.templateName,
              nbTmplDispatched.variables,
            );
          }
          nbStatus = "sent";
        }
      } catch (e) {
        nbError = (e as Error).message;
        nbStatus = nbError.startsWith("timeout_no_response") ? "timeout"
                 : isMetaTemplateError(nbError) ? "blocked_by_meta"
                 : "failed";
        console.error(`[whatsapp-send] night_before dispatch ${nbStatus}:`, nbError);
      }

      // Three-way payload/log channel label, computed once and reused below —
      // avoids the old text-vs-everything-else binary that had no room for whapi.
      const nbPayloadChannel =
        nightBeforeDispatch.channel === "template" ? "meta_template"
        : nightBeforeDispatch.channel === "whapi"   ? "whapi_session"
        : "session_message";

      await notifyAdminIfDispatchFailed({
        status: nbStatus,
        error: nbError,
        guestName: guest.name as string,
        guestPhone: guest.phone as string,
        dispatchType: nightBeforeDispatch.channel === "template" ? "Template" : "Session",
      });

      // Log outcome — same shape as the existing pipeline log below so
      // Automation History renders it without special-casing.
      await finalizeDispatchAttempt(supabase, nbClaimRes.claim.logId, nbStatus, {
        channel: nbPayloadChannel,
        ...(nightBeforeDispatch.channel !== "template"
          ? {
              scriptKey: nightBeforeDispatch.freeTextKey,
              ...(nbSessionKind ? { sessionKind: nbSessionKind } : {}),
              ...(nbSessionImageUrl ? { image_url: nbSessionImageUrl } : {}),
            }
          : { template: nightBeforeDispatch.templateName, variables: nightBeforeDispatch.vars }),
        ...(nbError ? { error: nbError } : {}),
      });

      // Conversation thread (non-blocking).
      if (nbStatus === "sent" || nbStatus === "simulated") {
        try {
          const { error: convErr } = await supabase.from("whatsapp_conversations").insert({
            phone:         String(guest.phone),
            guest_id:      guestId,
            direction:     "outbound",
            message:       nbConvMessage || formatOutboundConversationLog({
              channel: nbPayloadChannel === "meta_template" ? "meta_template"
                     : nbPayloadChannel === "whapi_session"  ? "whapi_suites"
                     : "session_message",
              body: `[${nightBeforeDispatch.channel === "template" ? nightBeforeDispatch.templateName : nightBeforeDispatch.freeTextKey}]`,
            }),
            wa_message_id: nightBeforeDispatch.channel === "whapi" ? nbWhapiWamid : null,
            inbox_channel: nightBeforeDispatch.channel === "whapi" ? "whapi" : "meta",
            channel:       nightBeforeDispatch.channel === "whapi" ? "whapi" : "meta",
          });
          if (convErr) console.warn("[whatsapp-send] night_before conv log failed (non-blocking):", convErr.message);
        } catch (e) {
          console.warn("[whatsapp-send] night_before conv log failed (non-blocking):", (e as Error).message);
        }
        // Stamp pipeline flag — sole writer, same as the generic path below.
        if (flagColumn) {
          await supabase.from("guests").update({ [flagColumn]: true }).eq("id", guestId);
        }
        await markScheduledTaskDispatched(guestId, trigger);
      }

      return new Response(
        JSON.stringify({
          ok:         nbStatus === "sent" || nbStatus === "simulated",
          simulation: sim,
          status:     nbStatus,
          channel:    nbPayloadChannel,
          ...(nightBeforeDispatch.channel === "template"
            ? { template: nightBeforeDispatch.templateName }
            : {}),
          ...(nbError ? { error: nbError } : {}),
        }),
        { headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    // ── Morning day-pass fast-path (Stage 3 — בוקר הגעה, בילוי יומי) ──────────
    // Meta template path ONLY when Whapi routing is off. When
    // GUEST_WHAPI_SUITES_ENABLED, day-pass falls through to the shared Whapi
    // morning session block below (morning_daypass script) — same transport
    // as suites (owner 2026-07-12). Autonomous Meta here used to retry
    // forever on broken dream_checkin_reminder_v2 / URL-button templates.
    // Session morning_daypass also on manual force (force===true) for Meta-bound.
    // isEffectiveDayPassGuest — a suite-room guest mis-tagged day_guest falls
    // through to the generic (suite-template) morning path below (P0, s125).
    if (
      trigger === "morning_welcome" &&
      isEffectiveDayPassGuest(guest) &&
      !shouldUseWhapiForGuestAutomation(guest)
    ) {
      const dpGuestName = sanitizeTemplateVars([String(guest.name ?? "")])[0];
      const dpArrivalYmd = normalizeArrivalDateYmd(guest.arrival_date);
      const dpIsShabbat = isShabbatArrivalDate(dpArrivalYmd);
      const dpTemplate = dpIsShabbat ? "suite_welcome_morning_shabbat" : "suite_welcome_morning";
      // Option C: open Meta window → free-text morning_daypass + QR; else template.
      const dpUseSession =
        !forceMetaTemplate &&
        ((force === true) || isWindowOpen(guest.wa_window_expires_at));
      const dpClaimRes = await claimStageDispatch(supabase, {
        guestId: Number(guestId), trigger, recipient: String(guest.phone),
        force: force === true, tag: "MORNING_DAYPASS",
      });
      if (dpClaimRes.conflictResponse) return dpClaimRes.conflictResponse;

      let dpStatus = "simulated";
      let dpError: string | null = null;
      let dpChannel: "session_message" | "meta_template" = dpUseSession ? "session_message" : "meta_template";
      let dpConvMessage = "";

      try {
        if (!sim) {
          if (dpUseSession) {
            const { data: scriptRow } = await supabase
              .from("bot_scripts")
              .select("message_text")
              .eq("script_key", "morning_daypass")
              .maybeSingle();
            const rawText = scriptRow?.message_text?.trim();
            if (!rawText) {
              dpChannel = "meta_template";
              console.warn(
                `[whatsapp-send] morning_welcome day_pass: bot_script 'morning_daypass' missing` +
                ` — falling back to ${dpTemplate} for guest_id=${guestId}`,
              );
              const dpFbDispatched = await sendViaTemplate(
                String(guest.phone), dpTemplate, [dpGuestName], "he",
                resolveDynamicUrlButtonParam(dpTemplate, guest.portal_token),
              );
              dpConvMessage = await buildConversationLogFromTemplate(
                supabase,
                dpFbDispatched.templateName,
                dpFbDispatched.variables,
              );
            } else {
              const dpPortalUrl = guest.portal_token
                ? `${PORTAL_BASE_URL}/portal/${guest.portal_token as string}`
                : "";
              const body = applySaturdayCheckInTimeOverride(
                rawText
                  .replace(/\{\{GUEST_NAME\}\}/gi, dpGuestName)
                  .replace(/\{\{\s*portal_url\s*\}\}/gi, dpPortalUrl),
                dpArrivalYmd,
              );
              const buttons = (stageRow?.interactive_buttons ?? []) as InteractiveButtonDef[];
              dpConvMessage = buildSessionConversationLog(body, buttons);
              await sendStageSessionMessage(
                String(guest.phone),
                body,
                stageRow?.session_message_image_url ?? undefined,
                buttons,
                `morning_welcome day_pass guest_id=${guestId}`,
              );
            }
          } else {
            console.log(
              `[whatsapp-send] morning_welcome day_pass: route=meta_template guest_id=${guestId} ` +
              `arrival=${dpArrivalYmd} template=${dpTemplate} isShabbat=${dpIsShabbat}`,
            );
            const dpTmplDispatched = await sendViaTemplate(
              String(guest.phone), dpTemplate, [dpGuestName], "he",
              resolveDynamicUrlButtonParam(dpTemplate, guest.portal_token),
            );
            dpConvMessage = await buildConversationLogFromTemplate(
              supabase,
              dpTmplDispatched.templateName,
              dpTmplDispatched.variables,
            );
          }
          dpStatus = "sent";
        }
      } catch (e) {
        dpError = (e as Error).message;
        dpStatus = dpError.startsWith("timeout_no_response") ? "timeout"
                 : isMetaTemplateError(dpError) ? "blocked_by_meta"
                 : "failed";
        console.error(`[whatsapp-send] morning_welcome day_pass ${dpStatus}:`, dpError);
      }

      await notifyAdminIfDispatchFailed({
        status: dpStatus,
        error: dpError,
        guestName: guest.name as string,
        guestPhone: guest.phone as string,
        dispatchType: dpChannel === "session_message" ? "Session" : "Template",
      });

      await finalizeDispatchAttempt(supabase, dpClaimRes.claim.logId, dpStatus, {
        channel:    dpChannel,
        ...(dpChannel === "meta_template" ? { template: dpTemplate } : { scriptKey: "morning_daypass" }),
        ...(dpError ? { error: dpError } : {}),
      });

      if (dpStatus === "sent" || dpStatus === "simulated") {
        try {
          // Fallback only fires in simulation mode (dpConvMessage stays "" since
          // the real send/log-build block above never ran). Even then, the
          // fallback MUST reflect `dpChannel` — the channel actually selected —
          // not a hardcoded "meta_template" that can silently disagree with it.
          await supabase.from("whatsapp_conversations").insert({
            phone:         String(guest.phone),
            guest_id:      guestId,
            direction:     "outbound",
            message:       dpConvMessage || formatOutboundConversationLog({
              channel: dpChannel === "session_message" ? "session_message" : "meta_template",
              body: dpChannel === "session_message" ? "morning_daypass" : dpTemplate,
            }),
            wa_message_id: null,
          });
        } catch { /* best-effort */ }
        if (flagColumn) {
          await supabase.from("guests").update({ [flagColumn]: true }).eq("id", guestId);
        }
      }

      return new Response(
        JSON.stringify({
          ok:         dpStatus === "sent" || dpStatus === "simulated",
          simulation: sim,
          status:     dpStatus,
          channel:    dpChannel,
          ...(dpChannel === "meta_template" ? { template: dpTemplate } : {}),
          ...(dpError ? { error: dpError } : {}),
        }),
        { headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    // ── Morning-of session path (suite guests) ───────────────────────────────
    // Autonomous cron → Shabbat-aware Meta templates below (suite_welcome_morning /
    // suite_welcome_morning_shabbat) UNLESS the guest routes through Whapi (all
    // suite automation, owner decision 2026-07-10) — Whapi has no template
    // concept, so the session script is its ONLY path, same precedent as
    // night_before. Meta guests: never hijack to session text just because
    // the 24h window is open — stage_3_morning carries weekday 15:00 check-in
    // literals (applySaturdayCheckInTimeOverride fixes that).
    //
    // Session free-text fires when: staff explicitly forces (force===true,
    // not meta_template) OR the guest is opted into Whapi dispatch (autonomous
    // or manual — Whapi was previously in WHAPI_UNSUPPORTED_STAGES; removed
    // now that this path exists).
    const mgArrivalYmd = normalizeArrivalDateYmd(guest.arrival_date);
    const mgIsShabbat = isShabbatArrivalDate(mgArrivalYmd);
    const useWhapiForMorning =
      (trigger === "morning_suite" || trigger === "morning_welcome") &&
      shouldUseWhapiForGuestAutomation(guest);
    const useMorningSession = (force === true && !forceMetaTemplate) || useWhapiForMorning;

    // No longer gated on stageRow having a configured session_message_script_key
    // — resolveShabbatAwareScriptKey already falls back to "stage_3_morning"
    // when it's empty. Gating on it here meant a stage with NO script key at
    // all skipped this whole block (including the useWhapiForMorning FAIL
    // VISIBLE throw below) and fell straight through to sendViaTemplate for a
    // Whapi-eligible guest — the exact silent-Meta-fallback this block exists
    // to prevent.
    if ((trigger === "morning_suite" || trigger === "morning_welcome") && useMorningSession) {
      const mgScriptKey = resolveShabbatAwareScriptKey(
        stageRow,
        mgIsShabbat,
        stageRow?.session_message_script_key ?? "stage_3_morning",
      );
      let mgScriptText: string | null = null;
      try {
        const { data: mgScript } = await supabase
          .from("bot_scripts")
          .select("message_text")
          .eq("script_key", mgScriptKey)
          .maybeSingle();
        mgScriptText = mgScript?.message_text?.trim() || null;
      } catch (e) {
        console.warn(
          `[whatsapp-send] morning session-text: script fetch failed — falling through to template:`,
          (e as Error).message,
        );
      }

      // Whapi guests have no template fallback (FAIL VISIBLE) — a guest
      // opted OUT of Meta must never silently receive a Meta template because
      // the session script happened to be missing/empty.
      if (!mgScriptText && useWhapiForMorning) {
        throw new Error(
          `morning_whapi_script_missing: bot_scripts.${mgScriptKey} ` +
          `חסר או ריק — לא ניתן לשלוח דרך Whapi ללא הטקסט (ערוך ב-BotScriptEditor)`,
        );
      }

      if (mgScriptText) {
        const mgGuestName = sanitizeTemplateVars([String(guest.name ?? "")])[0];
        const mgPortalUrl = guest.portal_token
          ? `${PORTAL_BASE_URL}/portal/${guest.portal_token as string}`
          : "";
        let mgBody = applySaturdayCheckInTimeOverride(
          mgScriptText
            .replace(/\{\{\s*GUEST_NAME\s*\}\}/gi, mgGuestName)
            .replace(/\{\{\s*portal_url\s*\}\}/gi, mgPortalUrl),
          mgArrivalYmd,
        );
        if (trigger === "morning_welcome" && isEffectiveDayPassGuest(guest) && useWhapiForMorning) {
          mgBody = ensureDaypassWindowOpenerCta(mgBody);
        }
        const mgChannel: "whapi" | "meta" = useWhapiForMorning ? "whapi" : "meta";
        const mgImageUrl = resolveShabbatAwareSessionImageUrl(stageRow, mgIsShabbat, requestImageUrl);

        const mgClaimRes = await claimStageDispatch(supabase, {
          guestId: Number(guestId), trigger, recipient: String(guest.phone),
          force: force === true, tag: "MORNING_SESSION",
        });
        if (mgClaimRes.conflictResponse) return mgClaimRes.conflictResponse;

        let mgStatus = "simulated";
        let mgError: string | null = null;
        let mgWhapiWamid: string | null = null;
        try {
          if (!sim) {
            if (mgChannel === "whapi") {
              mgWhapiWamid = await dispatchWhapiSessionMessage(
                String(guest.phone),
                mgBody,
                mgImageUrl,
              );
            } else {
              await sendViaMeta(String(guest.phone), mgBody, mgImageUrl);
            }
            mgStatus = "sent";
          }
        } catch (e) {
          mgError = (e as Error).message;
          mgStatus = mgError.startsWith("timeout_no_response") ? "timeout"
                   : isMetaTemplateError(mgError) ? "blocked_by_meta"
                   : "failed";
          console.error(`[whatsapp-send] morning session-message ${mgStatus}:`, mgError);
        }

        await notifyAdminIfDispatchFailed({
          status: mgStatus,
          error: mgError,
          guestName: guest.name as string,
          guestPhone: guest.phone as string,
          dispatchType: "Session",
        });

        await finalizeDispatchAttempt(supabase, mgClaimRes.claim.logId, mgStatus, {
          channel:   mgChannel === "whapi" ? "whapi_session" : "session_message",
          scriptKey: mgScriptKey,
          ...(mgError ? { error: mgError } : {}),
        });

        if (mgStatus === "sent" || mgStatus === "simulated") {
          try {
            await supabase.from("whatsapp_conversations").insert({
              phone:         String(guest.phone),
              guest_id:      guestId,
              direction:     "outbound",
              message:       mgChannel === "whapi"
                ? buildWhapiSuitesConversationLog(mgBody)
                : buildSessionConversationLog(mgBody, (stageRow?.interactive_buttons ?? []) as InteractiveButtonDef[]),
              wa_message_id: mgChannel === "whapi" ? mgWhapiWamid : null,
              inbox_channel: mgChannel,
              channel:       mgChannel,
            });
          } catch { /* best-effort */ }
          if (flagColumn) {
            await supabase.from("guests").update({ [flagColumn]: true }).eq("id", guestId);
          }
        }

        return new Response(
          JSON.stringify({
            ok:         mgStatus === "sent" || mgStatus === "simulated",
            simulation: sim,
            status:     mgStatus,
            channel:    mgChannel === "whapi" ? "whapi_session" : "session_message",
            ...(mgError ? { error: mgError } : {}),
          }),
          { headers: { ...CORS, "Content-Type": "application/json" } },
        );
      }

      // Script not found or empty — fall through to Shabbat-aware template path.
      // (useWhapiForMorning already threw above — unreachable for Whapi guests.)
      console.warn(
        `[whatsapp-send] morning session-text: script_key="${stageRow?.session_message_script_key}"` +
        ` not found or empty for trigger="${trigger}" guest_id=${guestId} — falling through to template`,
      );
    }

    // ── Morning-of dispatch — deterministic Shabbat routing ──────────────────
    // Mirrors the night_before fast-path above. The arrival_date UTC day-of-week
    // fully determines which approved Meta template is sent — no manual variable
    // injection is required or permitted.
    //
    // Template routing:
    //   Saturday (getUTCDay() === 6) → suite_welcome_morning_shabbat
    //                                   (Shabbat entry/check-in times baked in)
    //   Sunday–Friday               → suite_welcome_morning
    //                                   (weekday times baked in)
    //
    // Variable mapping (HARDENED per task "Transition to Fully Deterministic"):
    //   {{1}} = guest name ONLY.
    //   {{2}} / {{3}} are NOT passed — they are no longer template variables;
    //   the correct times live in the template body text itself. This eliminates
    //   the variable-sync class of bugs (session 56) by design.
    //
    // Safety fallback:
    //   If the Shabbat template send fails, retry ONCE with the session script
    //   (stage_3_morning) + applySaturdayCheckInTimeOverride — never the weekday
    //   Meta template (that would quote 15:00 check-in on a Saturday arrival).
    //
    // Applies to: morning_suite + morning_welcome for NON-day_guest guests.
    // Day-pass guests (morning_welcome) are handled by the early-return above.
    // All other triggers fall through (morningDispatch stays null).
    type MorningDispatch = {
      primaryTemplate:  string;
      fallbackTemplate: string;
      vars:             string[];
      buttonUrlParam?:  string;
    };
    let morningDispatch: MorningDispatch | null = null;

    if (trigger === "morning_suite" || trigger === "morning_welcome") {
      const arrivalDateStr = normalizeArrivalDateYmd(guest.arrival_date);
      const isShabbat = isShabbatArrivalDate(arrivalDateStr);
      const guestName = sanitizeTemplateVars([String(guest.name ?? "")])[0];

      morningDispatch = {
        primaryTemplate:  isShabbat ? "suite_welcome_morning_shabbat" : "suite_welcome_morning",
        fallbackTemplate: "suite_welcome_morning",
        vars:             [guestName],
        buttonUrlParam:   resolveDynamicUrlButtonParam(
          isShabbat ? "suite_welcome_morning_shabbat" : "suite_welcome_morning",
          guest.portal_token,
        ),
      };
    }

    // ── Morning-of fast-path execution — early return ─────────────────────────
    if (morningDispatch !== null) {
      const mdClaimRes = await claimStageDispatch(supabase, {
        guestId: Number(guestId), trigger, recipient: String(guest.phone),
        force: force === true, tag: "MORNING_TEMPLATE",
      });
      if (mdClaimRes.conflictResponse) return mdClaimRes.conflictResponse;

      let mdStatus = "simulated";
      let mdError: string | null = null;
      let usedMorningTemplate = morningDispatch.primaryTemplate;
      // Populated with the LITERAL {templateName, variables} Meta accepted —
      // whichever attempt (primary Shabbat template or weekday fallback)
      // actually succeeded. The conversation log below is built from this,
      // never from `usedMorningTemplate` alone, so a future edit to the
      // fallback bookkeeping above can't silently desync the inbox log again.
      let mdDispatched: DispatchedTemplate | null = null;
      let mdSessionFallbackBody: string | null = null;

      try {
        if (!sim) {
          console.log(
            `[whatsapp-send] morning Stage3 pre-send: guest_id=${guestId} ` +
            `template=${morningDispatch.primaryTemplate} vars=${JSON.stringify(morningDispatch.vars)}`,
          );
          try {
            mdDispatched = await sendViaTemplate(
              String(guest.phone),
              morningDispatch.primaryTemplate,
              morningDispatch.vars,
              "he",
              morningDispatch.buttonUrlParam,
            );
          } catch (primaryErr) {
            // Shabbat template not yet approved or errored → session script with
            // Shabbat time override (never weekday Meta — wrong 15:00 on Saturday).
            if (morningDispatch.primaryTemplate !== morningDispatch.fallbackTemplate) {
              const scriptKey = resolveShabbatAwareScriptKey(
                stageRow,
                mgIsShabbat,
                "stage_3_morning",
              );
              const { data: fbScript } = await supabase
                .from("bot_scripts")
                .select("message_text")
                .eq("script_key", scriptKey)
                .maybeSingle();
              const fbRaw = fbScript?.message_text?.trim();
              if (!fbRaw) throw primaryErr;
              const arrivalYmd = normalizeArrivalDateYmd(guest.arrival_date);
              const fbPortal = guest.portal_token
                ? `${PORTAL_BASE_URL}/portal/${guest.portal_token as string}`
                : "";
              mdSessionFallbackBody = applySaturdayCheckInTimeOverride(
                fbRaw
                  .replace(/\{\{\s*GUEST_NAME\s*\}\}/gi, morningDispatch.vars[0])
                  .replace(/\{\{\s*portal_url\s*\}\}/gi, fbPortal),
                arrivalYmd,
              );
              console.warn(
                `[whatsapp-send] morning dispatch: Shabbat template "${morningDispatch.primaryTemplate}"` +
                ` failed — session fallback (${scriptKey}) with Shabbat time override.` +
                ` Primary error: ${(primaryErr as Error).message}`,
              );
              await sendViaMeta(
                String(guest.phone),
                mdSessionFallbackBody,
                stageRow?.session_message_image_url,
              );
              usedMorningTemplate = `${scriptKey}_session_shabbat_fallback`;
            } else {
              throw primaryErr;
            }
          }
          mdStatus = "sent";
        }
      } catch (e) {
        mdError = (e as Error).message;
        mdStatus = mdError.startsWith("timeout_no_response") ? "timeout"
                 : isMetaTemplateError(mdError) ? "blocked_by_meta"
                 : "failed";
        console.error(`[whatsapp-send] morning dispatch ${mdStatus}:`, mdError);
      }

      await notifyAdminIfDispatchFailed({
        status: mdStatus,
        error: mdError,
        guestName: guest.name as string,
        guestPhone: guest.phone as string,
        dispatchType: "Template",
      });

      await finalizeDispatchAttempt(supabase, mdClaimRes.claim.logId, mdStatus, {
        channel:   mdSessionFallbackBody ? "session_message" : "meta_template",
        template:  mdDispatched?.templateName ?? usedMorningTemplate,
        variables: mdDispatched?.variables ?? morningDispatch.vars,
        ...(mdSessionFallbackBody
          ? { shabbatSessionFallback: true, primaryAttempt: morningDispatch.primaryTemplate }
          : {}),
        ...(mdError ? { error: mdError } : {}),
      });

      if (mdStatus === "sent" || mdStatus === "simulated") {
        try {
          const mdConvMessage = mdSessionFallbackBody
            ? buildSessionConversationLog(
                mdSessionFallbackBody,
                (stageRow?.interactive_buttons ?? []) as InteractiveButtonDef[],
              )
            : await buildConversationLogFromTemplate(
                supabase,
                mdDispatched?.templateName ?? usedMorningTemplate,
                mdDispatched?.variables ?? morningDispatch.vars,
              );
          const { error: convErr } = await supabase.from("whatsapp_conversations").insert({
            phone:         String(guest.phone),
            guest_id:      guestId,
            direction:     "outbound",
            message:       mdConvMessage,
            wa_message_id: null,
          });
          if (convErr) console.warn("[whatsapp-send] morning conv log failed (non-blocking):", convErr.message);
        } catch (e) {
          console.warn("[whatsapp-send] morning conv log failed (non-blocking):", (e as Error).message);
        }
        if (flagColumn) {
          await supabase.from("guests").update({ [flagColumn]: true }).eq("id", guestId);
        }
      }

      return new Response(
        JSON.stringify({
          ok:         mdStatus === "sent" || mdStatus === "simulated",
          simulation: sim,
          status:     mdStatus,
          channel:    mdSessionFallbackBody ? "session_message" : "meta_template",
          template:   usedMorningTemplate,
          ...(mdError ? { error: mdError } : {}),
        }),
        { headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    // ── Room Ready fast-path (session-aware, event-driven) ──────────────────
    // Mirrors the night_before fast-path pattern.
    //   24h session open  → free-text from bot_script "room_ready_reminder"
    //   24h session closed → approved Meta template dream_room_ready1
    // Template variables: {{1}} = guest name, {{2}} = suite / room name.
    // This block always early-returns — the generic hybrid fallback below is
    // never reached for trigger === "room_ready".
    if (trigger === "room_ready") {
      const rrRoomNameRaw = String(
        requestRoomId ??
        (guest as Record<string, unknown>).room ??
        (guest as Record<string, unknown>).suite_name ??
        ""
      ).trim();
      const rrRoomName = rrRoomNameRaw || "-";

      const suiteRoomAlreadySent = !force && guestId
        ? await isSuiteRoomReadyAlreadySent(supabase, Number(guestId), rrRoomNameRaw)
        : false;

      if (!force && guestId) {
        if (suiteRoomAlreadySent) {
          const rrPhone = safeGuestPhone(guest.phone) ?? String(guest.phone ?? "");
          await logDuplicateBlocked(supabase, {
            guestId: Number(guestId),
            recipient: rrPhone,
            triggerType: "room_ready",
            reason: "already_sent",
            source: "whatsapp-send_room_ready_suite",
          });
          await clearPendingRoomApprovalGate(supabase, rrRoomNameRaw);
          return new Response(
            JSON.stringify({
              ok: true,
              skipped: true,
              status: "duplicate_blocked",
              reason: "room_ready_notified",
              room_id: rrRoomNameRaw,
            }),
            { headers: { ...CORS, "Content-Type": "application/json" } },
          );
        }

        const rrDup = await checkPipelineDuplicate(supabase, {
          guestId: Number(guestId),
          triggerType: "room_ready",
          roomId: rrRoomNameRaw,
          force: false,
        });
        if (rrDup.blocked) {
          const rrPhone = safeGuestPhone(guest.phone) ?? String(guest.phone ?? "");
          await logDuplicateBlocked(supabase, {
            guestId: Number(guestId),
            recipient: rrPhone,
            triggerType: "room_ready",
            reason: rrDup.reason,
            priorSentAt: rrDup.priorSentAt,
            source: "whatsapp-send_room_ready",
          });
          await clearPendingRoomApprovalGate(supabase, rrRoomNameRaw);
          return new Response(
            JSON.stringify(duplicateBlockedResponseBody(rrDup, { reason: "room_ready_notified", room_id: rrRoomNameRaw })),
            { headers: { ...CORS, "Content-Type": "application/json" } },
          );
        }
      }

      const arrivalStr = String(guest.arrival_date ?? "");
      if (!isArrivalTodayIsrael(arrivalStr)) {
        const todayIL = israelTodayYmd();
        console.warn(
          `[whatsapp-send] room_ready blocked: arrival_date=${arrivalStr || "null"} today_IL=${todayIL} guestId=${guestId}`,
        );
        return new Response(
          JSON.stringify({
            ok: false,
            status: "blocked",
            error: `room_ready רק ביום ההגעה (היום: ${todayIL}, הגעה: ${arrivalStr || "לא ידוע"})`,
          }),
          { headers: { ...CORS, "Content-Type": "application/json" } },
        );
      }

      const rrGuestName = sanitizeTemplateVars([String(guest.name ?? "")])[0];

      // Query last inbound — any error defaults to template (safe path).
      let rrLastInbound: Date | null = null;
      try {
        rrLastInbound = await getLastInboundTimestamp(supabase, String(guest.phone ?? ""));
      } catch (e) {
        console.warn(
          `[whatsapp-send] room_ready: last_inbound_message query failed for guest ${guestId}` +
          ` — defaulting to template (safe path):`,
          (e as Error).message,
        );
      }
      const MS_24H = 24 * 60 * 60 * 1000;
      const rrWithin24h = rrLastInbound !== null && (Date.now() - rrLastInbound.getTime()) < MS_24H;

      type RoomReadyDispatch =
        | { channel: "text";     freeTextKey: string; guestName: string; roomName: string }
        | { channel: "whapi";    freeTextKey: string; guestName: string; roomName: string }
        | { channel: "template"; templateName: string; vars: string[] };

      // room_ready is a suite staff event (AICopilot / GuestsPage / SuitesDashboard
      // / housekeeping N✅ → ממתין לאישור). When GUEST_WHAPI_SUITES_ENABLED is on,
      // ALWAYS use Whapi free-text — never Meta dream_room_ready1.
      // Why not shouldRouteGuestOutboundViaWhapiSuites(guest) alone: guests.room
      // denorm can lag behind suite_rooms / the roomId the UI already knows
      // (housekeeping ready signal). That dropped suite guests onto the Meta
      // template path after Whapi-first, so "חדר מוכן" failed on Facebook
      // template errors while the Suites device was healthy. Flag-off keeps
      // the legacy Meta session/template split.
      const useWhapiForRoomReady = isGuestWhapiSuitesEnabled();

      const rrDispatch: RoomReadyDispatch = useWhapiForRoomReady
        ? { channel: "whapi", freeTextKey: "room_ready_reminder", guestName: rrGuestName, roomName: rrRoomName }
        : rrWithin24h
          ? { channel: "text", freeTextKey: "room_ready_reminder", guestName: rrGuestName, roomName: rrRoomName }
          : { channel: "template", templateName: PIPELINE_TEMPLATE["room_ready"], vars: sanitizeTemplateVars([rrGuestName, rrRoomName]) };

      const rrClaimRes = await claimStageDispatch(supabase, {
        guestId: Number(guestId), trigger: "room_ready", recipient: String(guest.phone),
        force: force === true, tag: "ROOM_READY",
      });
      if (rrClaimRes.conflictResponse) return rrClaimRes.conflictResponse;

      let rrStatus = "simulated";
      let rrError: string | null = null;
      let rrConvMessage = "";
      let rrWhapiWamid: string | null = null;

      try {
        if (!sim) {
          if (rrDispatch.channel === "text" || rrDispatch.channel === "whapi") {
            const { data: rrScript } = await supabase
              .from("bot_scripts")
              .select("message_text")
              .eq("script_key", rrDispatch.freeTextKey)
              .maybeSingle();
            const rawText = rrScript?.message_text?.trim();
            if (!rawText) {
              // Whapi guests have no template fallback (FAIL VISIBLE) — a guest
              // opted OUT of Meta must never silently receive a Meta template.
              if (rrDispatch.channel === "whapi") {
                throw new Error(
                  `room_ready_whapi_script_missing: bot_scripts.${rrDispatch.freeTextKey} ` +
                  `חסר או ריק — לא ניתן לשלוח דרך Whapi ללא הטקסט (ערוך ב-BotScriptEditor)`,
                );
              }
              // Script missing — fall back to template rather than dropping the message silently.
              console.warn(
                `[whatsapp-send] room_ready: bot_script "${rrDispatch.freeTextKey}" missing` +
                ` — falling back to template for guest_id=${guestId}`,
              );
              const rrTmplVars = sanitizeTemplateVars([rrGuestName, rrRoomName]);
              const rrFbDispatched = await sendViaTemplate(
                String(guest.phone),
                PIPELINE_TEMPLATE["room_ready"],
                rrTmplVars,
                "he",
              );
              rrConvMessage = await buildConversationLogFromTemplate(
                supabase,
                rrFbDispatched.templateName,
                rrFbDispatched.variables,
              );
            } else {
              const textBody = rawText
                .replace(/\{\{\s*GUEST_NAME\s*\}\}/gi, rrDispatch.guestName)
                .replace(/\{\{\s*ROOM_NAME\s*\}\}/gi,   rrDispatch.roomName);
              if (rrDispatch.channel === "whapi") {
                rrConvMessage = buildWhapiSuitesConversationLog(textBody);
                rrWhapiWamid = await sendWhapiText(cleanPhoneForMention(String(guest.phone)), textBody);
              } else {
                rrConvMessage = buildSessionConversationLog(textBody);
                await sendViaMeta(String(guest.phone), textBody, stageRow?.session_message_image_url);
              }
            }
          } else {
            const rrTmplDispatched = await sendViaTemplate(
              String(guest.phone),
              rrDispatch.templateName,
              rrDispatch.vars,
              "he",
            );
            rrConvMessage = await buildConversationLogFromTemplate(
              supabase,
              rrTmplDispatched.templateName,
              rrTmplDispatched.variables,
            );
          }
          rrStatus = "sent";
        }
      } catch (e) {
        rrError = (e as Error).message;
        rrStatus = rrError.startsWith("timeout_no_response") ? "timeout"
                 : isMetaTemplateError(rrError) ? "blocked_by_meta"
                 : "failed";
        console.error(`[whatsapp-send] room_ready dispatch ${rrStatus}:`, rrError);
      }

      await notifyAdminIfDispatchFailed({
        status: rrStatus,
        error: rrError,
        guestName: guest.name as string,
        guestPhone: guest.phone as string,
        dispatchType: rrDispatch.channel === "template" ? "Template" : "Session",
        trigger: "room_ready",
      });

      await finalizeDispatchAttempt(supabase, rrClaimRes.claim.logId, rrStatus, {
        room_id: rrRoomNameRaw,
        channel: rrDispatch.channel === "whapi" ? "whapi_session" : rrDispatch.channel === "text" ? "session_message" : "meta_template",
        ...(rrDispatch.channel !== "template"
          ? { scriptKey: rrDispatch.freeTextKey }
          : { template: rrDispatch.templateName, variables: rrDispatch.vars }),
        ...(rrError ? { error: rrError } : {}),
      });

      if (rrStatus === "sent" || rrStatus === "simulated") {
        try {
          const { error: rrConvErr } = await supabase.from("whatsapp_conversations").insert({
            phone:         String(guest.phone),
            guest_id:      guestId,
            direction:     "outbound",
            message:       rrConvMessage || formatOutboundConversationLog({
              channel: rrDispatch.channel === "whapi" ? "whapi_suites" : rrDispatch.channel === "text" ? "session_message" : "meta_template",
              body: rrDispatch.channel === "template" ? rrDispatch.templateName : rrDispatch.freeTextKey,
            }),
            wa_message_id: rrDispatch.channel === "whapi" ? rrWhapiWamid : null,
            inbox_channel: rrDispatch.channel === "whapi" ? "whapi" : "meta",
            channel:       rrDispatch.channel === "whapi" ? "whapi" : "meta",
          });
          if (rrConvErr) console.warn("[whatsapp-send] room_ready conv log failed (non-blocking):", rrConvErr.message);
        } catch (e) {
          console.warn("[whatsapp-send] room_ready conv log failed (non-blocking):", (e as Error).message);
        }
        await markSuiteRoomReadySent(supabase, Number(guestId), rrRoomNameRaw);
        await syncGuestRoomReadyAggregate(supabase, Number(guestId));
        const { count: suiteRoomCount } = await supabase
          .from("suite_rooms")
          .select("id", { count: "exact", head: true })
          .eq("guest_id", guestId);
        if (!suiteRoomCount) {
          await supabase.from("guests").update({
            room_ready_notified: true,
            room_ready_at: new Date().toISOString(),
            ...(flagColumn ? { [flagColumn]: true } : {}),
          }).eq("id", guestId);
        } else if (flagColumn) {
          await supabase.from("guests").update({ [flagColumn]: true }).eq("id", guestId);
        }
        await clearPendingRoomApprovalGate(supabase, rrRoomNameRaw);
      }

      return new Response(
        JSON.stringify({
          ok:         rrStatus === "sent" || rrStatus === "simulated",
          simulation: sim,
          status:     rrStatus,
          channel:    rrDispatch.channel === "whapi" ? "whapi_session" : rrDispatch.channel === "text" ? "session_message" : "meta_template",
          ...(rrDispatch.channel === "template"
            ? { template: rrDispatch.templateName }
            : {}),
          ...(rrError ? { error: rrError } : {}),
        }),
        { headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    // Hybrid fallback (req #4) — Session free-text when:
    //   • manual staff dispatch, OR
    //   • guest routes through Whapi (primary day-pass/suite transport), OR
    //   • day-pass + Meta channel + open 24h window (Option C session-first —
    //     avoids templates when morning/evening opener already got a reply).
    const housekeepingCheckoutSurvey = housekeeping_co === true && trigger === "checkout_fb";
    const isManualPipelineDispatch = force === true || manual_override === true || housekeepingCheckoutSurvey;
    const pipelineArrivalYmd = normalizeArrivalDateYmd(guest.arrival_date);
    const pipelineIsShabbat = isShabbatArrivalDate(pipelineArrivalYmd);
    const useWhapiForPipeline = shouldUseWhapiForGuestAutomation(guest);
    const daypassSessionPreferred =
      !forceMetaTemplate &&
      isEffectiveDayPassGuest(guest) &&
      DAYPASS_SESSION_FIRST_TRIGGERS.has(trigger) &&
      isWindowOpen(guest.wa_window_expires_at);
    let usedSessionMessage = false;
    let sessionBody: string | null = null;
    let sessionButtons: Array<{ type: string; label: string; url?: string }> = [];
    let sessionImageUrl: string | null = null;
    let usedDreamBotFallback = false;

    // force_channel="meta_template" pins to template regardless of window state.
    // force_channel="session_message"/"whapi_session" bypasses the isWindowOpen()
    // guard so staff can send free-text to any guest on demand. useWhapiForPipeline
    // guests bypass it too — Whapi has no session-window concept at all.
    const pipelineScriptFallback = PIPELINE_SESSION_SCRIPT[trigger] ?? "";
    if ((isManualPipelineDispatch || useWhapiForPipeline || daypassSessionPreferred) && !forceMetaTemplate &&
        (stageRow?.session_message_script_key || stageRow?.session_message_script_key_shabbat || pipelineScriptFallback)) {
      if (forceSessionMessage || forceWhapiSession || useWhapiForPipeline || force === true || isManualPipelineDispatch || isWindowOpen(guest.wa_window_expires_at) || daypassSessionPreferred) {
        const pipelineScriptKey = resolveShabbatAwareScriptKey(
          stageRow,
          pipelineIsShabbat,
          pipelineScriptFallback || (stageRow?.session_message_script_key ?? ""),
        );
        const { data: scriptRow } = await supabase
          .from("bot_scripts")
          .select("message_text")
          .eq("script_key", pipelineScriptKey)
          .maybeSingle();
        const rawText = scriptRow?.message_text?.trim();
        if (rawText) {
          const guestName = (String(guest.name ?? "").trim()) || "אורח יקר";
          const portalUrl = guest.portal_token
            ? `${PORTAL_BASE_URL}/portal/${guest.portal_token as string}`
            : "";
          let body = applySaturdayCheckInTimeOverride(
            rawText
              .replace(/\{\{\s*GUEST_NAME\s*\}\}/gi, guestName)
              .replace(/\{\{\s*portal_url\s*\}\}/gi, portalUrl)
              .replace(/\{\{\s*SPA_TIME\s*\}\}/gi, normalizeHmTime(guest.spa_time) || ""),
            String(guest.arrival_date ?? ""),
          );
          // Stage 1 over Whapi has no interactive buttons (Meta's template
          // does) — the typed CTA in the body is the guest's only path to
          // confirming. Defend against an ACC edit that drops the phrase.
          if (trigger === "pre_arrival_2d" && (forceWhapiSession || useWhapiForPipeline)) {
            body = ensureArrivalConfirmationCta(body);
          }
          // Day-pass evening/morning on Whapi: no Meta QR buttons — keep typed
          // window-opener CTA so Dream Bot backup can free-text later.
          if (
            (trigger === "night_before_daypass" || trigger === "morning_welcome") &&
            (forceWhapiSession || useWhapiForPipeline)
          ) {
            body = ensureDaypassWindowOpenerCta(body);
          }
          sessionBody = body;
          sessionButtons = (stageRow.interactive_buttons ?? []) as typeof sessionButtons;
          sessionImageUrl = resolveShabbatAwareSessionImageUrl(stageRow, pipelineIsShabbat, requestImageUrl) ?? null;
          usedSessionMessage = true;
        } else {
          console.warn(`[whatsapp-send] stage "${trigger}" has session_message_script_key="${pipelineScriptKey}" but bot_scripts has no text — falling back to Meta template`);
        }
      }
    }

    // Staff explicitly picked Whapi, OR the guest is dispatch_channel=whapi —
    // never silently fall through to a Meta template send they didn't ask
    // for / opted out of (FAIL VISIBLE §0.3). If this stage has no usable
    // session body, fail loudly instead.
    // Exception (Option C): autonomous Whapi with missing script still fails
    // loudly; Dream Bot failover only applies AFTER a Whapi *send* fails.
    if ((forceWhapiSession || useWhapiForPipeline) && !usedSessionMessage) {
      throw new Error(`whapi_session_unavailable: שלב "${trigger}" אינו מוגדר עם Bot Script פעיל — לא ניתן לשלוח דרך Whapi.`);
    }

    // Phase C claim-before-send (2026-07-13) — prevents two overlapping cron
    // ticks (or a cron tick racing a manual Override) from dispatching this
    // exact guest+trigger concurrently. As of 2026-07-17 every dedicated
    // fast-path block above (stage_2_arrival, night_before, the three morning
    // blocks, room_ready) claims through the same claimStageDispatch wrapper.
    const genClaimRes = await claimStageDispatch(supabase, {
      guestId: Number(guestId), trigger, recipient: guest.phone as string,
      force: force === true, tag: "BRANCH_D",
    });
    if (genClaimRes.conflictResponse) return genClaimRes.conflictResponse;
    const claim = genClaimRes.claim;

    let status = "simulated";
    let sendError: string | null = null;
    let tmplVars: string[] = [];

    let sessionFailureNote: string | null = null;
    let dispatchedWamid: string | null = null;

    if (usedSessionMessage) {
      try {
        if (!sim) {
          if (forceWhapiSession || useWhapiForPipeline) {
            // Plain text only — Whapi has no equivalent of Meta's interactive
            // buttons/image header, so sessionButtons/sessionImageUrl are not
            // carried over here (pre-existing sendWhapiText characteristic,
            // same as the broadcast-template Whapi path above).
            dispatchedWamid = await dispatchWhapiSessionMessage(
              guest.phone as string,
              sessionBody!,
              sessionImageUrl ?? undefined,
            );
            console.log(`[whatsapp-send] ${trigger}: session dispatch via Whapi`);
          } else {
            const sessionResult = await sendStageSessionMessage(
              guest.phone as string,
              sessionBody!,
              sessionImageUrl ?? undefined,
              sessionButtons,
              `stage="${trigger}" guest_id=${guestId}`,
            );
            dispatchedWamid = sessionResult.wamid;
            console.log(`[whatsapp-send] ${trigger}: session dispatch kind=${sessionResult.kind}`);
          }
          status = "sent";
        }
      } catch (e) {
        sessionFailureNote = (e as Error).message;
        if (forceWhapiSession) {
          // Staff explicitly chose Whapi — do NOT silently fall back to Meta
          // (FAIL VISIBLE §0.3). Autonomous Whapi failure → Dream Bot below.
          console.error(`[whatsapp] pipeline Whapi session send failed for stage "${trigger}":`, sessionFailureNote);
          sendError = sessionFailureNote;
          status = sessionFailureNote.startsWith("timeout_no_response") ? "timeout" : "failed";
        } else if (useWhapiForPipeline) {
          // Option C: Whapi down / ban → Dream Bot backup.
          // Prefer Meta session when 24h window is open; else Meta template.
          console.error(
            `[whatsapp] pipeline Whapi failed for "${trigger}" — Dream Bot fallback:`,
            sessionFailureNote,
          );
          usedDreamBotFallback = true;
          if (isWindowOpen(guest.wa_window_expires_at) && sessionBody) {
            try {
              if (!sim) {
                const sessionResult = await sendStageSessionMessage(
                  guest.phone as string,
                  sessionBody!,
                  sessionImageUrl ?? undefined,
                  sessionButtons,
                  `stage="${trigger}" guest_id=${guestId} dream_bot_fallback`,
                );
                dispatchedWamid = sessionResult.wamid;
                status = "sent";
                console.log(`[whatsapp-send] ${trigger}: Dream Bot session fallback after Whapi fail`);
              }
            } catch (metaSessionErr) {
              console.error(
                `[whatsapp] Dream Bot session fallback failed — trying Meta template:`,
                (metaSessionErr as Error).message,
              );
              usedSessionMessage = false;
            }
          } else {
            usedSessionMessage = false;
          }
        } else {
          // Meta session path failure → template retry.
          console.error(`[whatsapp] pipeline session-message send failed — falling back to Meta template:`, sessionFailureNote);
          usedSessionMessage = false;
        }
      }
    }

    // Populated ONLY on a real, confirmed Meta dispatch — the literal
    // {templateName, variables} pair embedded in the payload Meta accepted.
    // Both the notification_log payload and the conversation-thread log
    // below read from this, never from `tmplName`/`tmplVars` directly, so
    // there is no path for a padded/corrected variable set (see
    // buildTemplateComponents) to diverge from what gets logged.
    let templateDispatched: DispatchedTemplate | null = null;

    if (!usedSessionMessage) {
      // All pipeline triggers except night_before (which has already returned
      // via the fast-path above). {{1}}/{{2}}/… variables from PIPELINE_VARS.
      tmplVars = resolveTemplateVars(trigger, guest, tmplName);
      // Dynamic URL button — only when the approved template actually defines one.
      const portalButtonParam = resolveDynamicUrlButtonParam(tmplName, guest.portal_token);
      try {
        if (!sim) {
          templateDispatched = await sendViaTemplate(guest.phone as string, tmplName, tmplVars, "he", portalButtonParam, stageRow?.session_message_image_url ?? requestImageUrl);
          dispatchedWamid = templateDispatched.wamid;
          status = "sent";
        }
      } catch (e) {
        sendError = (e as Error).message;
        status = sendError.startsWith("timeout_no_response") ? "timeout"
               : isMetaTemplateError(sendError) ? "blocked_by_meta"
               : "failed";
        console.error(`[whatsapp] pipeline send ${status}:`, sendError);
      }
    }

    await finalizeDispatchAttempt(supabase, claim.logId, status,
      usedSessionMessage
        ? {
            channel: usedDreamBotFallback
              ? "meta_session_whapi_fallback"
              : ((forceWhapiSession || useWhapiForPipeline) ? "whapi_session" : "session_message"),
            scriptKey: stageRow!.session_message_script_key,
            ...(sendError ? { error: sendError } : {}),
            ...(sessionFailureNote ? { whapiFailureNote: sessionFailureNote } : {}),
            ...(force ? { forced: true, force_channel, ...overridePayloadExtras } : {}),
          }
        : {
            channel: usedDreamBotFallback ? "meta_template_whapi_fallback" : "meta_template",
            template: templateDispatched?.templateName ?? tmplName,
            variables: templateDispatched?.variables ?? tmplVars,
            ...(sendError ? { error: sendError } : {}),
            ...(sessionFailureNote ? { sessionMessageFailureNote: sessionFailureNote } : {}),
            ...(force ? { forced: true, force_channel, ...overridePayloadExtras } : {}),
          },
    );

    await notifyAdminIfDispatchFailed({
      status,
      error: sendError,
      guestName: guest.name as string,
      guestPhone: guest.phone as string,
      dispatchType: usedSessionMessage ? "Session" : "Template",
    });

    // Log to conversation history so inbox shows it.
    // Non-blocking by design — see broadcast branch above for why a bare
    // .catch() chained directly on the query builder throws instead of swallowing.
    if (status === "sent" || status === "simulated") {
      try {
        const { data: liveGuest } = await supabase
          .from("guests")
          .select("id, phone")
          .eq("id", guestId)
          .maybeSingle();
        const logGuestId = liveGuest?.id ?? null;
        const logPhone = (liveGuest?.phone as string | undefined) ?? (guest.phone as string);

        const pipelineViaWhapi =
          (forceWhapiSession || useWhapiForPipeline) && !usedDreamBotFallback;
        const pipelineConvMsg = usedSessionMessage
          ? (pipelineViaWhapi
              ? buildWhapiSuitesConversationLog(sessionBody!)
              : buildSessionConversationLog(sessionBody!, sessionButtons as InteractiveButtonDef[]))
          : await buildConversationLogFromTemplate(
              supabase,
              templateDispatched?.templateName ?? tmplName,
              templateDispatched?.variables ?? tmplVars,
            );
        const { error: convErr } = await supabase.from("whatsapp_conversations").insert({
          phone: logPhone,
          guest_id: logGuestId,
          direction: "outbound",
          message: pipelineConvMsg,
          wa_message_id: dispatchedWamid,
          inbox_channel: pipelineViaWhapi ? "whapi" : "meta",
          channel: pipelineViaWhapi ? "whapi" : "meta",
        });
        if (convErr) {
          console.error("[whatsapp-send] pipeline conversation log FAILED:", convErr.message);
          await supabase.from("notification_log").insert({
            guest_id: logGuestId ?? guestId,
            recipient: logPhone,
            trigger_type: trigger,
            channel: "whatsapp",
            status: "failed",
            payload: {
              log_failure: true,
              conv_error: convErr.message,
              original_status: status,
            },
          });
        }
      } catch (e) {
        const errMsg = (e as Error).message;
        console.error("[whatsapp-send] pipeline conversation log FAILED:", errMsg);
        try {
          await supabase.from("notification_log").insert({
            guest_id: guestId,
            recipient: guest.phone as string,
            trigger_type: trigger,
            channel: "whatsapp",
            status: "failed",
            payload: { log_failure: true, conv_error: errMsg, original_status: status },
          });
        } catch { /* best-effort audit row */ }
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
      if (force || manual_override) {
        await markScheduledTaskDispatched(guestId, trigger);
      }
    }

    return new Response(
      JSON.stringify({
        ok: status === "sent" || status === "simulated",
        simulation: sim,
        status,
        channel: usedSessionMessage ? ((forceWhapiSession || useWhapiForPipeline) ? "whapi_session" : "session_message") : "meta_template",
        ...(usedSessionMessage ? {} : { template: tmplName }),
        ...(sendError ? { error: sendError } : {}),
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

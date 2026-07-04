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
import { sendWhapiText } from "../_shared/whapiSend.ts";
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
  buildOptionalSpaText,
  buildSpaLine,
  buildSpaTimeSentence,
  hasSpaBooking,
  normalizeHmTime,
  normalizeSpaDateYmd,
} from "../_shared/spaSchedule.ts";

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

/** Prefix [META]/[SESSION] + optional interactive-button footer for whatsapp_conversations. */
function formatOutboundConversationLog(opts: {
  channel: "meta_template" | "session_message";
  body: string;
  interactiveButtonLabels?: string[];
}): string {
  const tag = opts.channel === "meta_template" ? "[META]" : "[SESSION]";
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
  night_before_daypass: "dream_checkin_reminder_v2",   // day-pass T-1 evening reminder (BRANCH D hybrid)
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
      const text = String(v ?? "").trim();
      if (!text) {
        console.warn(`[whatsapp-send] template="${templateName}": body param {{${i + 1}}} empty after sanitize`);
      }
      return {
        type: "text",
        text: text || (i === 0 ? "אורח יקר" : i === 1 ? "12:00" : i === 2 ? "15:00" : "-"),
      };
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
  session_message_script_key?: string | null;
} | null;

/** Image for session sends: automation_stages.session_message_image_url wins, then request body. */
function resolveStageSessionImageUrl(
  stageRow: StageMediaRow,
  requestImageUrl?: string | null,
): string | undefined {
  const link = String(stageRow?.session_message_image_url ?? requestImageUrl ?? "").trim();
  return link || undefined;
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
): Promise<"session_image" | "session_interactive" | "session_text"> {
  const link = imageUrl?.trim();
  const body = String(caption ?? "").trim();

  if (link) {
    console.log(
      `[whatsapp-send] ${logContext}: session_image to=${maskPhoneForLog(safeGuestPhone(to))}` +
      ` link=${link.slice(0, 96)} caption_chars=${body.length}`,
    );
    try {
      await sendViaMeta(to, body, link);
    } catch (e) {
      const msg = (e as Error).message;
      console.error(`[whatsapp-send] ${logContext}: session_image FAILED — ${msg}`);
      throw new Error(`session_image_failed: ${msg}`);
    }
    return "session_image";
  }

  if (imageUrl !== undefined && imageUrl !== null && !link && String(imageUrl).length > 0) {
    throw new Error(
      `${logContext}: session_image_url_invalid — configured image URL is empty/whitespace`,
    );
  }

  if (buttons.length > 0) {
    await sendInteractiveButtons(to, body, buttons);
    return "session_interactive";
  }

  await sendViaMeta(to, body, null);
  return "session_text";
}

// ── Meta WhatsApp Cloud API (live) ────────────────────────────────────────────
async function sendViaMeta(to: string, body: string, imageUrl?: string | null): Promise<void> {
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
      const responseText = await sendImageMessage(recipient, link, caption);
      console.log(
        `[whatsapp-send] Meta response ${kind} to=${maskPhoneForLog(recipient)} body=${responseText.slice(0, 500)}`,
      );
      assertMetaMessageAccepted(responseText, 200, `${kind} to=${maskPhoneForLog(recipient)}`);
    } catch (e) {
      if (_isAbortError(e)) {
        throw new Error("timeout_no_response: Meta did not respond within 25s — message may have still been delivered");
      }
      throw e;
    }
    return;
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
    assertMetaMessageAccepted(responseText, res.status, `${kind} to=${maskPhoneForLog(recipient)}`);
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
  return token || undefined;
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
}): Promise<void> {
  if (!params.error) return;
  if (params.status !== "failed" && params.status !== "blocked_by_meta") return;
  await alertAdminDispatchFailure({
    guestName: params.guestName,
    guestPhone: params.guestPhone,
    dispatchType: params.dispatchType,
    errorMessage: params.error,
  });
}

/** JSON-safe log string; never includes Authorization or other secrets. */
function logMetaOutboundPayload(label: string, payload: Record<string, unknown>): void {
  console.log(`[whatsapp-send] Meta outbound ${label}: ${JSON.stringify(payload)}`);
}

/** Meta may return HTTP 200 without messages[0].id — treat as failure (ghost send). */
function assertMetaMessageAccepted(
  responseText: string,
  httpStatus: number,
  context: string,
): void {
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(responseText) as Record<string, unknown>;
  } catch {
    throw new Error(
      `${context}: HTTP ${httpStatus} but response is not JSON — body=${responseText.slice(0, 300)}`,
    );
  }
  const messages = data.messages as Array<{ id?: string }> | undefined;
  const wamid = messages?.[0]?.id;
  if (wamid) {
    console.log(`[whatsapp-send] Meta accepted ${context} wamid=${wamid}`);
    return;
  }
  const errObj = data.error as Record<string, unknown> | undefined;
  const errMsg = errObj
    ? String(errObj.message ?? errObj.error_user_msg ?? JSON.stringify(errObj))
    : responseText.slice(0, 300);
  throw new Error(
    `${context}: HTTP ${httpStatus} but no messages[0].id (possible ghost send) — ${errMsg}`,
  );
}

function resolvePipelineTemplateName(
  trigger: string,
  guest: Record<string, unknown>,
  stageRow: { meta_template_name?: string | null } | null,
): string {
  const fromDb = stageRow?.meta_template_name?.trim();
  const fromMap = PIPELINE_TEMPLATE[trigger]?.trim();

  if (trigger === "pre_arrival_2d") {
    if (guest.room_type === "day_guest") return "dream_checkin_reminder_v2";
    return fromDb || fromMap || "dream_arrival_confirmation";
  }

  if (trigger === "morning_suite" || trigger === "morning_welcome") {
    const isShabbat = isShabbatArrivalDate(String(guest.arrival_date ?? ""));
    if (fromDb) return fromDb;
    return isShabbat ? "suite_welcome_morning_shabbat" : (fromMap || "suite_welcome_morning");
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
type DispatchedTemplate = { templateName: string; variables: string[] };

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

  const { components, resolvedVars } = buildTemplateComponents(templateName, variables, {
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
    assertMetaMessageAccepted(
      responseText,
      res.status,
      `template="${templateName}" to=${maskPhoneForLog(recipient)}`,
    );
    return { templateName, variables: resolvedVars };
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
    .eq("direction", "inbound")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.created_at ? new Date(data.created_at as string) : null;
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
    const { trigger, guestId, assignments, weekStart, waTemplateName, templateVariables, force, force_channel, manual_override, scheduled_for, is_test, phone: testPhone, image_url: requestImageUrl } = body as {
      trigger:             string;
      guestId?:            string;
      assignments?:        Record<string, unknown[]>;
      weekStart?:          string;
      waTemplateName?:     string;    // approved WA template name
      templateVariables?:  string[];  // values for {{1}}, {{2}}, … in the template body
      force?:              boolean;   // Manual override: skip kill-switch + idempotency guard
      force_channel?:      "meta_template" | "session_message"; // Pin channel for manual dispatch
      manual_override?:    boolean;   // Staff Smart Override — logs context + cancels scheduled_tasks
      scheduled_for?:      string;    // ISO — audit when cancelling a future cron slot
      is_test?:            boolean;   // template_test isolation gate
      phone?:              string;    // template_test target (E.164)
      image_url?:          string;    // optional IMAGE header (templates) or session caption image
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
    if (!MANUAL_TRIGGERS.has(trigger) && !force && Deno.env.get("AUTOMATION_ENABLED") !== "true") {
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

      const vars = ensureTemplateBodyVars(waTemplateName, templateVariables ?? [], guest);

      let status = "simulated";
      let sendError: string | null = null;
      // Populated ONLY on a real, confirmed Meta dispatch — the literal
      // {templateName, variables} pair embedded in the payload Meta accepted.
      // Never fall back to `waTemplateName`/`vars` for logging: those are the
      // caller's INTENT, not proof of what was actually transmitted.
      let dispatched: DispatchedTemplate | null = null;
      try {
        if (!sim) {
          dispatched = await sendViaTemplate(guest.phone as string, waTemplateName, vars, "he", undefined, requestImageUrl);
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
        guestPhone: guest.phone as string,
        dispatchType: "Template",
      });

      await supabase.from("notification_log").insert({
        guest_id:     guestId,
        recipient:    guest.phone,
        trigger_type: "broadcast",
        channel:      "whatsapp",
        status,
        payload: {
          template:  dispatched?.templateName ?? waTemplateName,
          variables: dispatched?.variables ?? vars,
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
          const broadcastConvMsg = await buildConversationLogFromTemplate(
            supabase,
            dispatched?.templateName ?? waTemplateName,
            dispatched?.variables ?? vars,
          );
          const { error: convErr } = await supabase.from("whatsapp_conversations").insert({
            phone:         guest.phone as string,
            guest_id:      guestId,
            direction:     "outbound",
            message:       broadcastConvMsg,
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

      await notifyAdminIfDispatchFailed({
        status: replyStatus,
        error: replyErr,
        guestPhone: targetPhone,
        dispatchType: "Session",
      });

      // Insert outbound row so the inbox thread shows the message immediately
      await supabase.from("whatsapp_conversations").insert({
        phone:         targetPhone,
        direction:     "outbound",
        message:       replyStatus === "failed"
          ? inboxMsg
          : buildSessionConversationLog(inboxMsg),
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
        .select("id, name, phone, payment_amount, payment_link_url, direct_payment_url, ezgo_portal_url")
        .eq("id", guestId)
        .maybeSingle();
      if (gErr)   throw new Error(`guest_lookup_error: ${gErr.message}`);
      if (!guest) throw new Error(`guest_not_found: no guest row for id=${JSON.stringify(guestId)}`);
      if (!guest.phone) throw new Error("guest_no_phone");
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

      await notifyAdminIfDispatchFailed({
        status,
        error: sendError,
        guestName: guest.name as string,
        guestPhone: guest.phone as string,
        dispatchType: "Template",
      });

      await supabase.from("notification_log").insert({
        guest_id:     guestId,
        recipient:    guest.phone,
        trigger_type: "payment_and_workshops",
        channel:      "whatsapp",
        status,
        payload: {
          template: "dream_payment_and_workshops",
          amount,
          urlToken,
          paymentUrlValidated: true,
          ...(sendError ? { error: sendError } : {}),
        },
      });

      return new Response(
        JSON.stringify({ ok: status !== "failed", simulation: sim, status, ...(sendError ? { error: sendError } : {}) }),
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
    let stageQuery = supabase
      .from("automation_stages")
      .select("meta_template_name, session_message_script_key, session_message_image_url, interactive_buttons, guest_flag_column")
      .eq("stage_key", trigger);
    if (!force) stageQuery = stageQuery.eq("is_active", true);
    const { data: stageRow } = await stageQuery.maybeSingle();

    const forceMetaTemplate   = force === true && force_channel === "meta_template";
    const forceSessionMessage = force === true && force_channel === "session_message";

    if (!(trigger in PIPELINE_TEMPLATE) && !stageRow?.meta_template_name && !stageRow?.session_message_script_key) {
      throw new Error("unknown trigger: " + trigger);
    }

    // Idempotency: skip ONLY if a genuinely successful (or simulated) send already
    // exists for this guest+trigger. A prior "failed"/"timeout" row must NOT block
    // a retry — that was the exact bug that made a failed pipeline send permanent
    // (flagged session 9, fixed here together with the GUEST_FLAG gate below).
    // .limit(1) instead of .maybeSingle(): retries can legitimately accumulate
    // multiple failed/timeout rows for the same guest+trigger, which maybeSingle()
    // would error on.
    // force=true (manual override) bypasses this check entirely so staff can
    // re-send a stage that was already delivered — idempotency is a cron concern,
    // not a human one.
    if (!force) {
    const { data: existingSent } = await supabase
      .from("notification_log").select("id")
      .eq("guest_id", guestId).eq("trigger_type", trigger)
      .in("status", ["sent", "simulated"])
      .limit(1);
    if (existingSent && existingSent.length > 0) {
      console.log(`[whatsapp-send] skipped trigger="${trigger}" guestId=${guestId} reason=already_sent`);
      return new Response(
        JSON.stringify({ ok: true, skipped: true, reason: "already_sent" }),
        { headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }
    }

    const { data: guest, error: gErr } = await supabase
      .from("guests").select("*").eq("id", guestId).maybeSingle();
    if (gErr)   throw new Error(`guest_lookup_error: ${gErr.message}`);
    if (!guest) throw new Error(`guest_not_found: no guest row for id=${JSON.stringify(guestId)}`);

    if (["night_before", "morning_suite", "morning_welcome", "night_before_daypass", "morning_daypass"].includes(trigger)) {
      await fetchNightBeforeKnowledge(supabase);
    }

    if (!force && guest.automation_muted === true) {
      console.log(`[whatsapp-send] skipped trigger="${trigger}" guestId=${guestId} reason=automation_muted`);
      return new Response(
        JSON.stringify({ ok: true, skipped: true, reason: "automation_muted" }),
        { headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    // Staff "קח שיחה" — block autonomous pipeline/cron triggers only; manual
    // inbox/broadcast and deliberate room_ready approval still allowed.
    const STAFF_CLAIM_AUTOMATION_EXEMPT = new Set([...MANUAL_TRIGGERS, "room_ready"]);
    if (
      !force &&
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
      "mid_stay_daypass", "checkout_fb_daypass",
    ]);
    if (!force && (guest.room_type === "day_guest" || guest.room_type === "premium_day_guest") && !DAY_PASS_ALLOWED_TRIGGERS.has(trigger)) {
      console.warn(
        `[whatsapp-send] day_pass_stage_gate: trigger="${trigger}" blocked for ` +
        `guest_id=${guestId} (room_type=${guest.room_type}) — allowed: pre_arrival_2d, stage_2_arrival, night_before_daypass, morning_welcome, mid_stay_daypass, checkout_fb_daypass`,
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
    if (guest.room_type === "day_guest" && trigger === "pre_arrival_2d") {
      console.log(
        `[whatsapp-send] day_pass_template_override: stage=pre_arrival_2d → ` +
        `dream_checkin_reminder_v2 for guest_id=${guestId} (${String(guest.name ?? "?")})`,
      );
    }
    const flagColumn = stageRow?.guest_flag_column ?? GUEST_FLAG[trigger];

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

      if (!force && !forceSessionMessage && !isWindowOpen(guest.wa_window_expires_at)) {
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

      let s2Status = "simulated";
      let s2Error: string | null = null;
      try {
        if (!sim) {
          await sendStageSessionMessage(
            targetPhone, body, undefined, [],
            `stage_2_arrival guest_id=${guestId}`,
          );
          s2Status = "sent";
        }
      } catch (e) {
        s2Error = (e as Error).message;
        s2Status = s2Error.startsWith("timeout_no_response") ? "timeout" : "failed";
        console.error(`[whatsapp-send] stage_2_arrival ${s2Status}:`, s2Error);
      }

      await supabase.from("notification_log").insert({
        guest_id: guestId,
        recipient: targetPhone,
        trigger_type: "stage_2_arrival",
        channel: "whatsapp",
        status: s2Status,
        payload: s2Error ? { error: s2Error, force: !!force } : { force: !!force },
      });

      if (s2Status === "sent" || s2Status === "simulated") {
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
          channel: "session_message",
          ...(s2Error ? { error: s2Error } : {}),
        }),
        { headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    // Manual override — force Meta template, bypass all window/session routing ─
    // night_before is excluded: Stage 2.5 has its own fast-path below that picks
    // night_before_suites / _shabbat (not automation_stages.meta_template_name).
    if (forceMetaTemplate && trigger !== "night_before") {
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
            wa_message_id: null,
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
    // Routing rule (Stage 2.5):
    //   • Manual force (force===true) → session_message (unless force_channel=meta_template).
    //   • Autonomous cron/default → ALWAYS Meta template night_before_suites / _shabbat.
    //     Never hijack to session text just because the 24h window is open — that path
    //     bypasses the Shabbat-approved static template bodies and caused 15:00 on Saturdays.
    //   • Manual force_channel=session_message → bot_script free text (with Shabbat times).
    type NightBeforeDispatch =
      | { channel: "text";     freeTextKey: string;   guestName: string; sessionImageUrl?: string }
      | { channel: "template"; templateName: string;  vars: string[];   buttonUrlParam?: string };
    let nightBeforeDispatch: NightBeforeDispatch | null = null;

    if (trigger === "night_before") {
      const sessionScriptKey = stageRow?.session_message_script_key ?? "night_before_reminder";
      const windowOpen = isWindowOpen(guest.wa_window_expires_at);
      const isForceOverride = force === true;

      // EMERGENCY OVERRIDE: manual "שלח עכשיו" — total bypass of window + schedule gates.
      const forceSessionImmediate = isForceOverride;

      console.log("=== STAGE 2.5 FORCE ATTEMPT ===");
      console.log("Guest:", guest.name, "Room Type:", guest.room_type, "Arrival:", guest.arrival_date);
      console.log(
        `[whatsapp-send] night_before: Stage 2.5 dispatch guest_id=${guestId} ` +
        `room_type=${guest.room_type ?? "null"} arrival=${guest.arrival_date ?? "null"} ` +
        `msg_pre_arrival_sent=${String(guest.msg_pre_arrival_sent)} windowOpen=${windowOpen} ` +
        `forceSessionImmediate=${forceSessionImmediate} force_channel=${force_channel ?? "auto"} ` +
        `wa_window_expires_at=${guest.wa_window_expires_at ?? "null"}`,
      );

      const useSessionChannel =
        forceSessionImmediate
        || (force === true && forceSessionMessage);

      const sessionImage = forceSessionImmediate
        ? (resolveStageSessionImageUrl(stageRow, requestImageUrl) ?? NIGHT_BEFORE_OVERRIDE_SESSION_IMAGE)
        : resolveStageSessionImageUrl(stageRow, requestImageUrl);

      const guestName = sanitizeTemplateVars([String(guest.name ?? "")])[0];

      if (forceSessionImmediate) {
        // STRICT: session_message only — no Shabbat/weekday Meta evaluation.
        nightBeforeDispatch = {
          channel: "text",
          freeTextKey: sessionScriptKey,
          guestName,
          sessionImageUrl: sessionImage,
        };
        console.log(
          `[whatsapp-send] night_before: route=session_message FORCE guest_id=${guestId} ` +
          `script=${sessionScriptKey} image=${sessionImage?.slice(0, 64) ?? "default"}`,
        );
      } else if (useSessionChannel) {
        nightBeforeDispatch = { channel: "text", freeTextKey: sessionScriptKey, guestName, sessionImageUrl: sessionImage };
        console.log(
          `[whatsapp-send] night_before: route=session_message guest_id=${guestId} ` +
          `script=${sessionScriptKey} has_image=${!!sessionImage}`,
        );
      } else {
        const arrivalDateStr = normalizeArrivalDateYmd(guest.arrival_date);
        const isShabbat = isShabbatArrivalDate(arrivalDateStr);
        const templateName = isShabbat ? "night_before_suites_shabbat" : "night_before_suites";
        const templateVars = buildNameOnlyTemplateVars(guest);
        nightBeforeDispatch = { channel: "template", templateName, vars: templateVars };
        console.log(
          `[whatsapp-send] night_before: route=meta_template guest_id=${guestId} ` +
          `arrival=${arrivalDateStr} template=${templateName} isShabbat=${isShabbat} ` +
          `vars=${JSON.stringify(templateVars)}`,
        );
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
      let nbStatus = "simulated";
      let nbError: string | null = null;
      let nbSessionKind: string | null = null;
      let nbSessionImageUrl: string | undefined;
      let nbConvMessage = "";

      try {
        if (!sim) {
          if (nightBeforeDispatch.channel === "text") {
            const nbForceSessionImmediate = force === true;
            nbSessionImageUrl =
              nightBeforeDispatch.sessionImageUrl
              ?? resolveStageSessionImageUrl(stageRow, requestImageUrl)
              ?? (nbForceSessionImmediate ? NIGHT_BEFORE_OVERRIDE_SESSION_IMAGE : undefined);
            const { data: scriptRow } = await supabase
              .from("bot_scripts")
              .select("message_text")
              .eq("script_key", nightBeforeDispatch.freeTextKey)
              .maybeSingle();
            const rawText = scriptRow?.message_text?.trim();
            if (!rawText) {
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
              const isShabbatFb = isShabbatArrivalDate(arrivalDateStr);
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
          } else {
            if (force === true) {
              throw new Error(
                "night_before_force_meta_blocked — manual Send Now must use session_message only; " +
                "check bot_scripts.night_before_reminder has message_text",
              );
            }
            // Template path: IMAGE header from TEMPLATE_IMAGE_HEADER_DEFAULTS or session_message_image_url.
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

      await notifyAdminIfDispatchFailed({
        status: nbStatus,
        error: nbError,
        guestName: guest.name as string,
        guestPhone: guest.phone as string,
        dispatchType: nightBeforeDispatch.channel === "text" ? "Session" : "Template",
      });

      // Log outcome — same shape as the existing pipeline log below so
      // Automation History renders it without special-casing.
      await supabase.from("notification_log").insert({
        guest_id:     guestId,
        recipient:    guest.phone,
        trigger_type: trigger,
        channel:      "whatsapp",
        status:       nbStatus,
        payload: {
          channel: nightBeforeDispatch.channel === "text" ? "session_message" : "meta_template",
          ...(nightBeforeDispatch.channel === "text"
            ? {
                scriptKey: nightBeforeDispatch.freeTextKey,
                ...(nbSessionKind ? { sessionKind: nbSessionKind } : {}),
                ...(nbSessionImageUrl ? { image_url: nbSessionImageUrl } : {}),
              }
            : { template: nightBeforeDispatch.templateName, variables: nightBeforeDispatch.vars }),
          ...(nbError ? { error: nbError } : {}),
        },
      });

      // Conversation thread (non-blocking).
      if (nbStatus === "sent" || nbStatus === "simulated") {
        try {
          const { error: convErr } = await supabase.from("whatsapp_conversations").insert({
            phone:         String(guest.phone),
            guest_id:      guestId,
            direction:     "outbound",
            message:       nbConvMessage || formatOutboundConversationLog({
              channel: nightBeforeDispatch.channel === "text" ? "session_message" : "meta_template",
              body: `[${nightBeforeDispatch.channel === "template" ? nightBeforeDispatch.templateName : nightBeforeDispatch.freeTextKey}]`,
            }),
            wa_message_id: null,
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
          channel:    nightBeforeDispatch.channel === "text" ? "session_message" : "meta_template",
          ...(nightBeforeDispatch.channel === "template"
            ? { template: nightBeforeDispatch.templateName }
            : {}),
          ...(nbError ? { error: nbError } : {}),
        }),
        { headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    // ── Morning day-pass fast-path (Stage 3 — בוקר הגעה, בילוי יומי) ──────────
    // Autonomous cron → Shabbat-aware Meta template (same as suites).
    // Session morning_daypass only on manual force (force===true).
    if (trigger === "morning_welcome" && (guest.room_type === "day_guest" || guest.room_type === "premium_day_guest")) {
      const dpGuestName = sanitizeTemplateVars([String(guest.name ?? "")])[0];
      const dpArrivalYmd = normalizeArrivalDateYmd(guest.arrival_date);
      const dpIsShabbat = isShabbatArrivalDate(dpArrivalYmd);
      const dpTemplate = dpIsShabbat ? "suite_welcome_morning_shabbat" : "suite_welcome_morning";
      const dpUseSession = force === true && !forceMetaTemplate;
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
              dpConvMessage = buildSessionConversationLog(
                body,
                (stageRow?.interactive_buttons ?? []) as InteractiveButtonDef[],
              );
              await sendViaMeta(String(guest.phone), body, stageRow?.session_message_image_url);
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

      await supabase.from("notification_log").insert({
        guest_id:     guestId,
        recipient:    guest.phone,
        trigger_type: trigger,
        channel:      "whatsapp",
        status:       dpStatus,
        payload:      {
          channel:    dpChannel,
          ...(dpChannel === "meta_template" ? { template: dpTemplate } : { scriptKey: "morning_daypass" }),
          ...(dpError ? { error: dpError } : {}),
        },
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

    // ── Morning-of session path (suite guests — manual override only) ────────
    // Autonomous cron → Shabbat-aware Meta templates below (suite_welcome_morning /
    // suite_welcome_morning_shabbat). Never hijack to session text because the 24h
    // window is open — stage_3_morning carries weekday 15:00 check-in literals.
    //
    // Session free-text only when staff explicitly forces (force===true).
    const useMorningSession = force === true && !forceMetaTemplate;

    if ((trigger === "morning_suite" || trigger === "morning_welcome") &&
        useMorningSession &&
        stageRow?.session_message_script_key) {
      let mgScriptText: string | null = null;
      try {
        const { data: mgScript } = await supabase
          .from("bot_scripts")
          .select("message_text")
          .eq("script_key", stageRow.session_message_script_key)
          .maybeSingle();
        mgScriptText = mgScript?.message_text?.trim() || null;
      } catch (e) {
        console.warn(
          `[whatsapp-send] morning session-text: script fetch failed — falling through to template:`,
          (e as Error).message,
        );
      }

      if (mgScriptText) {
        const mgGuestName = sanitizeTemplateVars([String(guest.name ?? "")])[0];
        const mgArrivalYmd = normalizeArrivalDateYmd(guest.arrival_date);
        const mgPortalUrl = guest.portal_token
          ? `${PORTAL_BASE_URL}/portal/${guest.portal_token as string}`
          : "";
        const mgBody = applySaturdayCheckInTimeOverride(
          mgScriptText
            .replace(/\{\{\s*GUEST_NAME\s*\}\}/gi, mgGuestName)
            .replace(/\{\{\s*portal_url\s*\}\}/gi, mgPortalUrl),
          mgArrivalYmd,
        );

        let mgStatus = "simulated";
        let mgError: string | null = null;
        try {
          if (!sim) { await sendViaMeta(String(guest.phone), mgBody, stageRow?.session_message_image_url); mgStatus = "sent"; }
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

        await supabase.from("notification_log").insert({
          guest_id:     guestId,
          recipient:    guest.phone,
          trigger_type: trigger,
          channel:      "whatsapp",
          status:       mgStatus,
          payload: {
            channel:   "session_message",
            scriptKey: stageRow.session_message_script_key,
            ...(mgError ? { error: mgError } : {}),
          },
        });

        if (mgStatus === "sent" || mgStatus === "simulated") {
          try {
            await supabase.from("whatsapp_conversations").insert({
              phone:         String(guest.phone),
              guest_id:      guestId,
              direction:     "outbound",
              message:       buildSessionConversationLog(
                mgBody,
                (stageRow?.interactive_buttons ?? []) as InteractiveButtonDef[],
              ),
              wa_message_id: null,
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
            channel:    "session_message",
            ...(mgError ? { error: mgError } : {}),
          }),
          { headers: { ...CORS, "Content-Type": "application/json" } },
        );
      }

      // Script not found or empty — fall through to Shabbat-aware template path.
      console.warn(
        `[whatsapp-send] morning session-text: script_key="${stageRow.session_message_script_key}"` +
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
              const scriptKey = stageRow?.session_message_script_key ?? "stage_3_morning";
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

      await supabase.from("notification_log").insert({
        guest_id:     guestId,
        recipient:    guest.phone,
        trigger_type: trigger,
        channel:      "whatsapp",
        status:       mdStatus,
        payload: {
          channel:   mdSessionFallbackBody ? "session_message" : "meta_template",
          template:  mdDispatched?.templateName ?? usedMorningTemplate,
          variables: mdDispatched?.variables ?? morningDispatch.vars,
          ...(mdSessionFallbackBody
            ? { shabbatSessionFallback: true, primaryAttempt: morningDispatch.primaryTemplate }
            : {}),
          ...(mdError ? { error: mdError } : {}),
        },
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
      if (!force && (guest as Record<string, unknown>).room_ready_notified === true) {
        console.log(
          "[Idempotency Safeguard]: Guest already notified for this stay. Skipping duplicate WhatsApp message.",
        );
        await clearPendingRoomApprovalGate(
          supabase,
          guestRoomIdForApprovalGate(guest as Record<string, unknown>),
        );
        return new Response(
          JSON.stringify({ ok: true, skipped: true, reason: "room_ready_notified" }),
          { headers: { ...CORS, "Content-Type": "application/json" } },
        );
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
      const rrRoomNameRaw = String(
        (guest as Record<string, unknown>).room ??
        (guest as Record<string, unknown>).suite_name ??
        ""
      ).trim();
      const rrRoomName = rrRoomNameRaw || "-";

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
        | { channel: "template"; templateName: string; vars: string[] };

      const rrDispatch: RoomReadyDispatch = rrWithin24h
        ? { channel: "text", freeTextKey: "room_ready_reminder", guestName: rrGuestName, roomName: rrRoomName }
        : { channel: "template", templateName: PIPELINE_TEMPLATE["room_ready"], vars: sanitizeTemplateVars([rrGuestName, rrRoomName]) };

      let rrStatus = "simulated";
      let rrError: string | null = null;
      let rrConvMessage = "";

      try {
        if (!sim) {
          if (rrDispatch.channel === "text") {
            const { data: rrScript } = await supabase
              .from("bot_scripts")
              .select("message_text")
              .eq("script_key", rrDispatch.freeTextKey)
              .maybeSingle();
            const rawText = rrScript?.message_text?.trim();
            if (!rawText) {
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
              rrConvMessage = buildSessionConversationLog(textBody);
              await sendViaMeta(String(guest.phone), textBody, stageRow?.session_message_image_url);
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
        dispatchType: rrDispatch.channel === "text" ? "Session" : "Template",
      });

      await supabase.from("notification_log").insert({
        guest_id:     guestId,
        recipient:    guest.phone,
        trigger_type: trigger,
        channel:      "whatsapp",
        status:       rrStatus,
        payload: {
          channel: rrDispatch.channel === "text" ? "session_message" : "meta_template",
          ...(rrDispatch.channel === "text"
            ? { scriptKey: rrDispatch.freeTextKey }
            : { template: rrDispatch.templateName, variables: rrDispatch.vars }),
          ...(rrError ? { error: rrError } : {}),
        },
      });

      if (rrStatus === "sent" || rrStatus === "simulated") {
        try {
          const { error: rrConvErr } = await supabase.from("whatsapp_conversations").insert({
            phone:         String(guest.phone),
            guest_id:      guestId,
            direction:     "outbound",
            message:       rrConvMessage || formatOutboundConversationLog({
              channel: rrDispatch.channel === "text" ? "session_message" : "meta_template",
              body: rrDispatch.channel === "template" ? rrDispatch.templateName : rrDispatch.freeTextKey,
            }),
            wa_message_id: null,
          });
          if (rrConvErr) console.warn("[whatsapp-send] room_ready conv log failed (non-blocking):", rrConvErr.message);
        } catch (e) {
          console.warn("[whatsapp-send] room_ready conv log failed (non-blocking):", (e as Error).message);
        }
        await supabase.from("guests").update({
          room_ready_notified: true,
          ...(flagColumn ? { [flagColumn]: true } : {}),
        }).eq("id", guestId);
        await clearPendingRoomApprovalGate(supabase, rrRoomNameRaw);
      }

      return new Response(
        JSON.stringify({
          ok:         rrStatus === "sent" || rrStatus === "simulated",
          simulation: sim,
          status:     rrStatus,
          channel:    rrDispatch.channel === "text" ? "session_message" : "meta_template",
          ...(rrDispatch.channel === "template"
            ? { template: rrDispatch.templateName }
            : {}),
          ...(rrError ? { error: rrError } : {}),
        }),
        { headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    // ── Hybrid fallback (req #4) ───────────────────────────────────────────
    // Session free-text ONLY on manual staff dispatch (force / manual_override).
    // Autonomous cron MUST always use the approved Meta template — never hijack
    // to bot_scripts just because wa_window_expires_at is open (same rule as
    // night_before session 102 and morning_suite session 102b).
    const isManualPipelineDispatch = force === true || manual_override === true;
    let usedSessionMessage = false;
    let sessionBody: string | null = null;
    let sessionButtons: Array<{ type: string; label: string; url?: string }> = [];
    let sessionImageUrl: string | null = null;

    // force_channel="meta_template" pins to template regardless of window state.
    // force_channel="session_message" bypasses the isWindowOpen() guard so staff
    // can send free-text to any guest on demand. Both are only honoured when
    // force=true (manual dispatch from AutomationControlCenter).
    if (isManualPipelineDispatch && !forceMetaTemplate && stageRow?.session_message_script_key) {
      if (forceSessionMessage || force === true || isWindowOpen(guest.wa_window_expires_at)) {
        const { data: scriptRow } = await supabase
          .from("bot_scripts")
          .select("message_text")
          .eq("script_key", stageRow.session_message_script_key)
          .maybeSingle();
        const rawText = scriptRow?.message_text?.trim();
        if (rawText) {
          const guestName = (String(guest.name ?? "").trim()) || "אורח יקר";
          const portalUrl = guest.portal_token
            ? `${PORTAL_BASE_URL}/portal/${guest.portal_token as string}`
            : "";
          const body = applySaturdayCheckInTimeOverride(
            rawText
              .replace(/\{\{\s*GUEST_NAME\s*\}\}/gi, guestName)
              .replace(/\{\{\s*portal_url\s*\}\}/gi, portalUrl),
            String(guest.arrival_date ?? ""),
          );
          sessionBody = body;
          sessionButtons = (stageRow.interactive_buttons ?? []) as typeof sessionButtons;
          sessionImageUrl = resolveStageSessionImageUrl(stageRow, requestImageUrl) ?? null;
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
          const sessionKind = await sendStageSessionMessage(
            guest.phone as string,
            sessionBody!,
            sessionImageUrl ?? undefined,
            sessionButtons,
            `stage="${trigger}" guest_id=${guestId}`,
          );
          console.log(`[whatsapp-send] ${trigger}: session dispatch kind=${sessionKind}`);
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

    await supabase.from("notification_log").insert({
      guest_id: guestId, recipient: guest.phone, trigger_type: trigger,
      channel: "whatsapp", status,
      payload: usedSessionMessage
        ? { channel: "session_message", scriptKey: stageRow!.session_message_script_key, ...(sendError ? { error: sendError } : {}), ...(force ? { forced: true, force_channel, ...overridePayloadExtras } : {}) }
        : {
            channel: "meta_template",
            template: templateDispatched?.templateName ?? tmplName,
            variables: templateDispatched?.variables ?? tmplVars,
            ...(sendError ? { error: sendError } : {}),
            ...(sessionFailureNote ? { sessionMessageFailureNote: sessionFailureNote } : {}),
            ...(force ? { forced: true, force_channel, ...overridePayloadExtras } : {}),
          },
    });

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
        const pipelineConvMsg = usedSessionMessage
          ? buildSessionConversationLog(
              sessionBody!,
              sessionButtons as InteractiveButtonDef[],
            )
          : await buildConversationLogFromTemplate(
              supabase,
              templateDispatched?.templateName ?? tmplName,
              templateDispatched?.variables ?? tmplVars,
            );
        const { error: convErr } = await supabase.from("whatsapp_conversations").insert({
          phone: guest.phone as string,
          guest_id: guestId,
          direction: "outbound",
          message: pipelineConvMsg,
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
      if (force || manual_override) {
        await markScheduledTaskDispatched(guestId, trigger);
      }
    }

    return new Response(
      JSON.stringify({
        ok: status === "sent" || status === "simulated",
        simulation: sim,
        status,
        channel: usedSessionMessage ? "session_message" : "meta_template",
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

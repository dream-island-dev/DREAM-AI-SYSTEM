// supabase/functions/whapi-webhook/index.ts
// ══════════════════════════════════════════════════════════════════════════════
// XOS CORE — Whapi (whapi.cloud) inbound webhook for the staff operations group.
//
// SPRINT 1 (done): receive a Whapi group message → AI intent classification
//   (actionable task vs chitchat) → chitchat terminates with NO reply → task is
//   extracted to {room, description}.
//
// SPRINT 2 (this revision): a classified TASK is now (a) de-duplicated against
//   Whapi webhook re-deliveries, (b) written to the `tasks` table with a fresh
//   action_token + per-category SLA, and (c) answered IN THE SAME GROUP with a
//   structured English task card carrying Accept / Complete callback URLs
//   (token-guarded task-action Edge Function). no_link_preview is set so the
//   WhatsApp link-preview crawler can't pre-fetch those URLs.
//
//   ⛔ STILL deferred to Sprint 3: guest portal, check_in/nights/checkout.
//
// WHY A NEW FUNCTION, NOT a branch in whatsapp-webhook (Meta) or a fork of
//   staff-ops-webhook: see the Sprint 1 header history — Whapi reads & writes
//   the group directly, which the Meta path cannot. This function supersedes
//   staff-ops-webhook; that one is retired after this path is verified.
//
// WHAPI INBOUND SHAPE (logged raw below — verify against your channel):
//   { "messages": [ { "id","from_me","type","chat_id"(…@g.us),"from",
//                     "from_name","text":{"body"} | "image":{"caption"} |
//                     "voice":{"id","mime_type","seconds","link"?} } ] }
//
// VOICE NOTES (added — Voice/Audio Ticket Support session): a "voice" message
// has no text at all. It's downloaded by media id (GET /media/{id} — the
// `voice.link` field is only present if the channel has Auto Download
// enabled, not guaranteed, so this never depends on it — see
// _shared/whapiMedia.ts), transcribed via Gemini (Claude has no audio input),
// then fed into the exact same parseDeterministic()/classifyWithAi() pipeline
// a typed message uses below.
//
// Required secrets: WHAPI_TOKEN, ANTHROPIC_API_KEY, GEMINI_API_KEY (voice
//   transcription + guest-DM FAQ fallback), SUPABASE_URL,
//   SUPABASE_SERVICE_ROLE_KEY. Optional:
//   WHAPI_GROUP_ID (ops «קריאות» group — tasks + 👍 reactions),
//   WHAPI_HOUSEKEEPING_GROUP_ID (צ'ק אין צ'ק אאוט — ready observer →
//   room_status ממתין לאישור → AICopilot 🔔; short Hebrew ack in-group on success),
//   WHAPI_API_URL, GUEST_WHAPI_SUITES_ENABLED (see GUEST DIRECT MESSAGE
//   HANDLING below — gates guest-DM auto-reply; off = capture-only).
//   EXECUTIVE_PHONES / EXECUTIVE_PHONE (972-prefixed digits, no "+",
//   comma-separated for EXECUTIVE_PHONES) — authorized executives for the
//   Executive Voice Assistant intercept (_shared/executiveIdentity.ts);
//   KNOWN_EXECUTIVES covers Eliad + Mike without any env var, env is an
//   extra allowlist, and the profiles fallback (migrations 175 Eliad / 182
//   Mike) covers a phone change without a deploy.
// ══════════════════════════════════════════════════════════════════════════════

import { serve }         from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient }  from "https://esm.sh/@supabase/supabase-js@2";
import Anthropic         from "https://esm.sh/@anthropic-ai/sdk@0.20.0";
import { sendWhapiText, cleanPhoneForMention } from "../_shared/whapiSend.ts";
import { buildTaskCard } from "../_shared/taskCard.ts";
import { fetchWhapiMedia } from "../_shared/whapiMedia.ts";
import { containsHebrew, translateTextForFieldOps } from "../_shared/fieldOpsTranslation.ts";
import { parseHousekeepingReadyRoomNumbers } from "../_shared/housekeepingWaParse.ts";
import { parseHousekeepingCheckInRoomNumbers } from "../_shared/housekeepingWaParse.ts";
import {
  applyHousekeepingReadySignal,
  buildHousekeepingGroupAckMessage,
} from "../_shared/housekeepingReadySignal.ts";
import {
  applyHousekeepingCheckInSignal,
  buildHousekeepingCheckInAckLine,
} from "../_shared/housekeepingCheckInSignal.ts";
import { isGuestWhapiSuitesEnabled, shouldAutoReplyGuestWhapiDm } from "../_shared/guestWhapiRouting.ts";
import { type ActiveGuestRow } from "../_shared/guestOutboundGuard.ts";
import { resolveGuestByInboundPhone, isArrivalConfirmationMessage } from "../_shared/arrivalConfirmation.ts";
import { onGuestAlertInserted } from "../_shared/guestAlertWhapiNotify.ts";
import { extractArrivalTimeFromText, persistGuestEta, insertArrivalEtaBoardAlert } from "../_shared/guestEta.ts";
import { formatGuestProfileForAi } from "../_shared/guestProfile.ts";
import { formatSpaScheduleDisplay } from "../_shared/spaSchedule.ts";
import { isExecutiveInbound } from "../_shared/executiveIdentity.ts";
import { handleExecutiveVoiceMessage } from "../_shared/executiveAssistant.ts";
import {
  isGuestStaffClaimActive,
  isGuestGreetingMessage,
  isLowValueCourtesyMessage,
  isSevereComplaint,
  isSensitiveStayChangeRequest,
  CANONICAL_STAY_CHANGE_HANDOFF_MSG,
  isSensitiveFinancialRequest,
  CANONICAL_FINANCIAL_HANDOFF_MSG,
  isCheckInPolicyQuestion,
  buildCheckInPolicyReply,
  isGuestEligibleForInHouseOpsDispatch,
  isAllowlistedPhysicalTaskRequest,
  extractAllowlistedRequestLines,
  buildOperationalRequestSummary,
  buildOperationalDispatchReply,
  isDepartureAssistRequest,
  buildDepartureAssistSummary,
  buildDepartureAssistReply,
} from "../_shared/automationSchedule.ts";
import { createGuestOpsTask } from "../_shared/createGuestOpsTask.ts";
import {
  canGuestConfirmArrival,
  runGuestArrivalConfirmation,
  patchClaimedInbound,
  dispatchStage2ViaPipeline,
  isRecordOnlyArrivalTimeUpdate,
  RECORD_ONLY_ARRIVAL_REPLY,
  isWhapiBotActive,
  fetchChannelClaim,
} from "../_shared/guestInboundOrchestrator.ts";
import {
  GUEST_STAFF_HANDOFF_SENTENCE,
  isGuestStaffHandoffReply,
} from "../_shared/guestBotHandoff.ts";
import { assembleGuestBrainPrompt } from "../_shared/guestBotSettings.ts";
import { generateGuestChatReply } from "../_shared/guestBotLlm.ts";
import {
  formatWhapiSuitesConversationLog,
  stripOutboundDispatchTag,
} from "../_shared/outboundDispatchTag.ts";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CLAUDE_MODEL = "claude-sonnet-4-6";

// ── Admin whitelist — authorized internal company numbers (Mike-confirmed).
// Map form gives a free name lookup for escalation / attribution. ─────────────
const ADMIN_WHITELIST: Record<string, string> = {
  "972504654306": "Lidor",
  "972546294885": "Adir",
  "972502278833": "Osnat",
};
function adminNameFor(phoneDigits: string): string | null {
  return ADMIN_WHITELIST[phoneDigits] ?? null;
}

// ── SLA categories — kept identical to staff-ops-webhook so tickets created
// through either path are scanned the same way by sla-escalation-cron. Same
// "duplicated small constants" convention already used across this repo. ──────
const SLA_THRESHOLDS: Record<string, number> = {
  pest_control:    10,
  guest_amenities: 15,
  maintenance:     30,
};
const DEFAULT_SLA_CATEGORY = "maintenance";

const PEST_KEYWORDS = [
  "bug", "ant", "ants", "cockroach", "roach", "mouse", "mice", "rat", "rats",
  "insect", "pest", "wasp", "spider",
  "חרק", "נמלה", "נמלים", "ג'וק", "עכבר", "עכברים", "חולדה",
];
const AMENITY_KEYWORDS = [
  "towel", "towels", "pillow", "pillows", "soap", "shampoo", "amenities",
  "minibar", "slipper", "slippers", "blanket", "sheet", "sheets",
  "מגבת", "מגבות", "כרית", "כריות", "סבון", "שמפו", "מצעים", "שמיכה",
];
function guessSlaCategory(description: string): string {
  const lower = description.toLowerCase();
  if (PEST_KEYWORDS.some((k) => lower.includes(k)))    return "pest_control";
  if (AMENITY_KEYWORDS.some((k) => lower.includes(k))) return "guest_amenities";
  return DEFAULT_SLA_CATEGORY;
}

// ── Tier 0: zero-token deterministic task forms ──────────────────────────────
const STRUCTURED_RE  = /^(\d+)\s*-\s*([\s\S]+)$/;
const ROOM_PREFIX_RE = /^\s*(?:room|rm\.?|suite|חדר|סוויטה)\s*(?:number|no\.?|#|מספר)?\s*(\d+)\s*[-:.,]?\s*([\s\S]+)$/i;

interface Classification {
  is_task: boolean;
  room_number: string | null;
  task_description: string;
  tier: "structured" | "room_prefix" | "ai";
}

function parseDeterministic(text: string): Classification | null {
  const t = text.trim();
  const m1 = t.match(STRUCTURED_RE);
  if (m1) return { is_task: true, room_number: m1[1], task_description: m1[2].trim(), tier: "structured" };
  const m2 = t.match(ROOM_PREFIX_RE);
  if (m2 && m2[2].trim()) return { is_task: true, room_number: m2[1], task_description: m2[2].trim(), tier: "room_prefix" };
  return null;
}

// ── Tier 1: Claude tool-calling intent classifier (forced tool) ──────────────
const CLASSIFY_TOOL_NAME = "classify_ops_message";
const CLASSIFY_JSON_SCHEMA = {
  type: "object",
  properties: {
    is_task: {
      type: "boolean",
      description:
        "true ONLY if this is an actionable maintenance / housekeeping / service request tied to a room or hotel area " +
        "(e.g. 'room 14 towels', 'AC not working in 12', 'pillows for suite 7'). " +
        "false for general team conversation, coordination, questions, or greetings " +
        "(e.g. 'where are the keys?', 'check the front desk', 'on my way', 'good morning').",
    },
    room_number:      { type: "string", description: "The room/suite integer mentioned, or empty string if none." },
    task_description: { type: "string", description: "Short English description of the task, 2-10 words. Empty when is_task is false." },
  },
  required: ["is_task"],
};

async function classifyWithAi(text: string): Promise<Classification> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("no_anthropic_key");

  const anthropic = new Anthropic({ apiKey: key });
  const resp = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 300,
    system:
      "You triage messages posted in a hotel's internal OPERATIONS WhatsApp group. The team writes in informal " +
      "English (occasionally Hebrew). Your only job is to decide whether each message is an ACTIONABLE operational " +
      "task tied to a specific room/area, or general team chatter. Always call classify_ops_message exactly once " +
      "with your best-effort extraction — never reply with plain text.",
    messages: [{ role: "user", content: text }],
    tools: [{
      name: CLASSIFY_TOOL_NAME,
      description: "Classify and (if a task) extract the room number and task description from the staff message.",
      input_schema: CLASSIFY_JSON_SCHEMA,
    }],
    tool_choice: { type: "tool", name: CLASSIFY_TOOL_NAME },
  } as any);

  const blocks = resp.content as Array<Record<string, unknown>>;
  const toolBlock = blocks.find((b) => b.type === "tool_use" && b.name === CLASSIFY_TOOL_NAME);
  const args = (toolBlock?.input ?? {}) as Record<string, unknown>;

  const is_task = args.is_task === true;
  const room_number = typeof args.room_number === "string" && args.room_number.trim() ? args.room_number.trim() : null;
  const task_description = typeof args.task_description === "string" ? args.task_description.trim() : "";
  return { is_task, room_number, task_description, tier: "ai" };
}

// ── Voice-note transcription (Gemini only — Claude has no audio input) ───────
// Same inline_data multimodal request shape as process-knowledge/index.ts —
// the only difference is the mime type and a plain-transcription prompt
// instead of a rule-extraction one. Output is plain text, fed straight back
// into the SAME parseDeterministic()/classifyWithAi() pipeline a typed
// message uses — no parallel classification logic for voice.
//
// Model list (not a single hardcoded model): the original single model here,
// "gemini-1.5-flash", started 404ing on Google's v1beta endpoint ("not found
// ... or is not supported for generateContent") — confirmed via a real failed
// voice note's error text landing in the Inbox (whapi-webhook guest_dm path
// now logs it, see that block below). Google had deprecated it; nothing in
// this repo changed. Mirrors EXECUTIVE_GEMINI_MODELS' fallback-list pattern
// (executiveAssistant.ts, already proven live) instead of a single name, so a
// future model retirement degrades to the next entry instead of a silent 404.
const TRANSCRIBE_GEMINI_MODELS = ["gemini-2.5-flash", "gemini-2.0-flash"];
const TRANSCRIBE_PROMPT =
  "תמלל את הקובץ הקולי המצורף במדויק, מילה במילה. הצוות מדבר עברית, לעתים אנגלית. " +
  "החזר טקסט פשוט בלבד — את התמלול עצמו, בלי הערות, בלי markdown, בלי תגי שפה.";

async function transcribeVoice(apiKey: string, base64Audio: string, mimeType: string): Promise<string> {
  // Whapi sends the full codec string ("audio/ogg; codecs=opus") — the prior
  // 404 was a model-routing error (fires before Google even parses the body),
  // so whether Gemini's inline_data.mime_type tolerates that trailing
  // "; codecs=opus" parameter was never actually exercised. Gemini's
  // documented audio mime types are bare ("audio/ogg", no parameters) —
  // strip it defensively rather than find out on the next real failure.
  const bareMimeType = mimeType.split(";")[0].trim() || "audio/ogg";
  const requestBody = {
    contents: [{
      role: "user",
      parts: [
        { text: TRANSCRIBE_PROMPT },
        { inline_data: { mime_type: bareMimeType, data: base64Audio } },
      ],
    }],
    generationConfig: { maxOutputTokens: 1024, temperature: 0.0 },
  };

  let lastErr: Error | null = null;
  for (const model of TRANSCRIBE_GEMINI_MODELS) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(30_000), // audio decode can be slower than the text-mapping calls elsewhere in this repo
        },
      );

      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`gemini_transcribe_${model}_${res.status}: ${errBody.slice(0, 300)}`);
      }

      const data = await res.json();
      const text: string =
        data?.candidates?.[0]?.content?.parts
          ?.map((p: { text?: string }) => p.text ?? "")
          .join("") ?? "";

      if (!text.trim()) {
        const finishReason = data?.candidates?.[0]?.finishReason;
        throw new Error(finishReason === "SAFETY" ? "gemini_safety_filter" : `gemini_empty_transcription_${model}`);
      }
      return text.trim();
    } catch (e) {
      lastErr = e as Error;
      console.warn(`[whapi-webhook] transcribeVoice model="${model}" failed:`, lastErr.message);
    }
  }
  throw lastErr ?? new Error("gemini_transcribe_no_models_available");
}

// ── Whapi message extraction (defensive — shape varies by version) ───────────
// voiceMediaId/voiceSeconds: a "voice" message has NO text at all — `text`
// stays "" here (extraction is synchronous; transcription needs an async
// Gemini call, done later in the main loop, see transcribeVoice() below).
interface IncomingMessage {
  id: string; fromMe: boolean; chatId: string; fromPhone: string; fromName: string; text: string;
  voiceMediaId: string | null; voiceMimeType: string | null; voiceSeconds: number | null;
}
function extractMessages(payload: Record<string, unknown>): IncomingMessage[] {
  const raw = Array.isArray(payload?.messages) ? (payload.messages as Array<Record<string, unknown>>) : [];
  return raw.map((m) => {
    const type = String(m?.type ?? "");
    const textBody =
      type === "text"  ? String((m?.text  as Record<string, unknown>)?.body    ?? "")
      : type === "image" ? String((m?.image as Record<string, unknown>)?.caption ?? "")
      : "";
    const voice = type === "voice" ? (m?.voice as Record<string, unknown> | undefined) : undefined;
    return {
      id:        String(m?.id ?? ""),
      fromMe:    m?.from_me === true,
      chatId:    String(m?.chat_id ?? ""),
      fromPhone: String(m?.from ?? "").replace(/\D/g, ""),
      fromName:  String(m?.from_name ?? ""),
      text:      textBody.trim(),
      voiceMediaId:  voice?.id ? String(voice.id) : null,
      voiceMimeType: voice?.mime_type ? String(voice.mime_type) : null,
      voiceSeconds:  typeof voice?.seconds === "number" ? voice.seconds : null,
    };
  });
}

// ── Whapi reaction extraction (Sprint 2, Session 26) ──────────────────────────
// Whapi posts an emoji reaction as its own `messages[]` entry, NOT a field on
// the original message: { type:"action", action:{ target, type:"reaction",
// emoji } } (verified against live Whapi payload — see action.target = the
// id of the message being reacted to). Kept as a separate extraction from
// extractMessages() above — a reaction shares the raw envelope but nothing
// about its IncomingMessage.text contract (no text, no classification).
interface IncomingReaction {
  id: string; fromMe: boolean; chatId: string; fromPhone: string; fromName: string;
  targetMessageId: string; emoji: string;
}
function extractReactions(payload: Record<string, unknown>): IncomingReaction[] {
  const raw = Array.isArray(payload?.messages) ? (payload.messages as Array<Record<string, unknown>>) : [];
  return raw
    .filter((m) => String(m?.type ?? "") === "action" && (m?.action as Record<string, unknown> | undefined)?.type === "reaction")
    .map((m) => {
      const action = (m.action ?? {}) as Record<string, unknown>;
      return {
        id:              String(m?.id ?? ""),
        fromMe:          m?.from_me === true,
        chatId:          String(m?.chat_id ?? ""),
        fromPhone:       String(m?.from ?? "").replace(/\D/g, ""),
        fromName:        String(m?.from_name ?? ""),
        targetMessageId: String(action?.target ?? ""),
        emoji:           String(action?.emoji ?? ""),
      };
    });
}

// 👍 in any skin tone is U+1F44D followed by an optional Fitzpatrick modifier
// codepoint — checking codePointAt(0) catches all six variants in one test.
const THUMBS_UP_CODEPOINT = 0x1f44d;
function isThumbsUp(emoji: string): boolean {
  return emoji.length > 0 && emoji.codePointAt(0) === THUMBS_UP_CODEPOINT;
}

/** Dual lookup on reacted_message_id: bot card (whapi_message_id) then trigger (source_message_id). */
async function findOpenTaskForReaction(
  supabase: ReturnType<typeof createClient>,
  reactedMessageId: string,
): Promise<{ id: string; status: string; matchedOn: "whapi_message_id" | "source_message_id" } | null> {
  const OPEN_STATUSES = ["open", "in_progress"] as const;

  // Primary — 👍 on the bot task card (bot_message_id / whapi_message_id).
  const { data: byCard } = await supabase
    .from("tasks")
    .select("id, status")
    .eq("whapi_message_id", reactedMessageId)
    .in("status", [...OPEN_STATUSES])
    .maybeSingle();
  if (byCard) return { ...byCard, matchedOn: "whapi_message_id" };

  // Fallback — 👍 on the original staff/guest trigger message (original_trigger_message_id / source_message_id).
  const { data: byTrigger } = await supabase
    .from("tasks")
    .select("id, status")
    .eq("source_message_id", reactedMessageId)
    .in("status", [...OPEN_STATUSES])
    .maybeSingle();
  if (byTrigger) return { ...byTrigger, matchedOn: "source_message_id" };

  return null;
}

async function resolveTaskByReaction(
  supabase: ReturnType<typeof createClient>,
  taskId: string,
  r: IncomingReaction,
): Promise<{ ok: boolean; error?: string }> {
  const local = r.fromPhone.startsWith("972") ? "0" + r.fromPhone.slice(3) : r.fromPhone;
  const { data: resolverProfile } = await supabase
    .from("profiles").select("id").in("phone", [r.fromPhone, "+" + r.fromPhone, local]).maybeSingle();

  const { error: doneErr } = await supabase
    .from("tasks")
    .update({
      status: "done",
      resolved_by: resolverProfile?.id ?? null,
      resolved_by_phone: r.fromPhone || null,
      resolved_by_name: r.fromName || null, // completed_by_name audit (Whapi sender metadata)
      resolved_at: new Date().toISOString(),
    })
    .eq("id", taskId);

  if (doneErr) return { ok: false, error: doneErr.message };
  return { ok: true };
}

function isDirectGuestChat(chatId: string): boolean {
  return chatId.endsWith("@s.whatsapp.net") || chatId.endsWith("@c.us");
}

function canonicalGuestPhone(fromPhone: string, chatId: string): string {
  const raw = (fromPhone || chatId.split("@")[0] || "").replace(/\D/g, "");
  if (!raw) return "";
  if (raw.startsWith("972")) return raw;
  if (raw.startsWith("0")) return `972${raw.slice(1)}`;
  return raw;
}

function isUniqueViolation(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "23505" || /duplicate key|unique constraint/i.test(error.message ?? "");
}

/** Insert-first dedup for Whapi Suites 1:1 guest inbox rows. */
async function claimWhapiGuestInbound(
  supabase: ReturnType<typeof createClient>,
  row: {
    phone: string;
    guest_id: number | null;
    message: string;
    wa_message_id: string;
    push_name: string | null;
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
      inbox_channel: "whapi",
      direction: "inbound",
      message: row.message,
      wa_message_id: row.wa_message_id,
      intent: "received",
      push_name: row.push_name,
      ...(row.message_type ? { message_type: row.message_type } : {}),
      ...(row.media_url ? { media_url: row.media_url } : {}),
      ...(row.media_mime ? { media_mime: row.media_mime } : {}),
      ...(row.media_caption ? { media_caption: row.media_caption } : {}),
    })
    .select("id")
    .maybeSingle();

  if (error) {
    if (isUniqueViolation(error)) return { claimed: false, conversationId: null };
    console.error("[whapi-webhook] claimWhapiGuestInbound failed:", error.message);
    return { claimed: false, conversationId: null };
  }
  return { claimed: true, conversationId: (data?.id as number) ?? null };
}

/**
 * Mirror a from_me (device-sent) 1:1 message into the Inbox — the physical
 * Suites phone is a real WhatsApp client staff can type into directly, and
 * without this those messages exist on the phone but never appear in XOS.
 *
 * Phone resolution: on an outbound Whapi event `from`/fromPhone reflects the
 * DEVICE's own number, not the guest — canonicalGuestPhone("", chatId) forces
 * its existing chatId-fallback branch to resolve the peer instead.
 *
 * Dedup: shares the same global unique index on wa_message_id that
 * claimWhapiGuestInbound relies on for inbound. A message sent via the Inbox
 * UI (whatsapp-send inbox_reply / sendGuestDmReply) already inserted this row
 * synchronously at send time with the same wa_message_id — this insert then
 * 23505s and is absorbed as "already_logged", not duplicated. That assumption
 * (webhook echo id === send-time wamid) is unverified against a live payload;
 * flagged for the Phase 3 QA pass.
 */
async function mirrorWhapiOutboundDm(
  supabase: ReturnType<typeof createClient>,
  msg: IncomingMessage,
): Promise<{ mirrored: boolean; reason?: string }> {
  const phone = canonicalGuestPhone("", msg.chatId);
  if (!phone) return { mirrored: false, reason: "no_phone" };

  let body = msg.text?.trim() || "";
  if (!body) {
    // Zero Data Loss — a from_me voice note/photo with no caption must still
    // leave a visible trace, not vanish silently. No transcription attempted
    // here (that's for guest-authored inbound voice only, see below).
    body = msg.voiceMediaId
      ? "🎤 [הודעה קולית נשלחה מהמכשיר]"
      : "📎 [מדיה נשלחה מהמכשיר — אין טקסט]";
  }

  const guest = (await resolveGuestByInboundPhone(supabase, phone)) as ActiveGuestRow | null;

  const { error } = await supabase.from("whatsapp_conversations").insert({
    phone,
    guest_id: guest?.id ?? null,
    direction: "outbound",
    message: formatWhapiSuitesConversationLog(body),
    wa_message_id: msg.id,
    inbox_channel: "whapi",
    channel: "whapi",
  });

  if (error) {
    if (isUniqueViolation(error)) return { mirrored: false, reason: "already_logged" };
    console.error("[whapi-webhook] mirrorWhapiOutboundDm insert failed:", error.message);
    return { mirrored: false, reason: "insert_failed" };
  }
  return { mirrored: true };
}

// ══════════════════════════════════════════════════════════════════════════════
// GUEST DIRECT MESSAGE HANDLING — 1:1 (non-group) conversations on the Suites
// device (מכשיר הסוויטות), same brain as the Meta bot (whatsapp-webhook).
//
// WIRING: the "Suites device — 1:1 guest DMs" sweep in the main loop below
// ALWAYS captures the inbound message first (claimWhapiGuestInbound — ZERO
// DATA LOSS, every message lands in the Golden Profile's Inbox regardless of
// auto-reply eligibility). handleGuestDirectMessage() is then invoked exactly
// once per newly-claimed message (never on a dedup replay) to decide whether
// and how to auto-reply. This two-step split (capture, then react) is why the
// gate below only ever suppresses the REPLY, never the logging.
//
// Gate: shouldAutoReplyGuestWhapiDm() (_shared/guestWhapiRouting.ts) =
// GUEST_WHAPI_SUITES_ENABLED secret AND the guest profile is active (not
// cancelled/checked_out) — deliberately NOT gated on isEffectiveSuiteGuest
// (room/room_type): a guest who successfully DMs the Suites device has
// already proven they can reach it, including a guest with no room assigned
// yet (pre-arrival). That narrower classifier is for OUTBOUND routing
// decisions elsewhere (shouldRouteGuestOutboundViaWhapiSuites) — a different
// question. When the gate is false, the message is captured_no_autoreply —
// visible in the Inbox (intent stamped, FAIL VISIBLE), un-replied.
// Admin/staff personal numbers (ADMIN_WHITELIST) are captured the same way
// but never auto-replied to, regardless of the gate.
//
// Reuses the SAME pure Tier-0 classifiers whatsapp-webhook uses, all already
// exported from _shared/automationSchedule.ts: staff-claim mute, courtesy
// silence, severe-complaint kill-switch, sensitive stay/financial handoff,
// check-in-policy FAQ. Everything else falls through to a lightweight Gemini
// reply built from the same bot_settings/bot_config rows the Meta bot reads —
// the persona/knowledge stays in sync automatically since that's shared DB
// data, not duplicated code.
//
// Greeting opener (היי/שלום) IS ported — same Tier-0 classifier
// (isGuestGreetingMessage) and same bot_scripts['greeting_reply'] row the
// Meta bot reads, checked before the courtesy-silence shield exactly like
// whatsapp-webhook orders it.
//
// FAIL VISIBLE — explicit, documented gap vs whatsapp-webhook (Meta is
// unaffected either way, this list is Whapi-channel-only):
//   • Stage 2 / arrival-confirmation state machine — PORTED (§2, Whapi/Meta
//     parity rollout). "כן מגיעים" runs isArrivalConfirmationMessage +
//     canGuestConfirmArrival and calls the SAME
//     _shared/guestInboundOrchestrator.ts:runGuestArrivalConfirmation Meta
//     uses, before the staffMuted gate (Stage 2 must never be blocked by a
//     staff claim, same invariant as Meta). No interactive buttons on this
//     channel — text-only confirm, which is all the bot_scripts.stage_2_arrival
//     text ever asked for anyway.
//   • Record-only arrival-TIME extraction — PORTED (§2). Same
//     isRecordOnlyArrivalTimeUpdate + persistGuestEta as Meta, also ahead of
//     the staffMuted gate.
//   • bot_active_whapi — PORTED (§2, migration 170 stub ahead of §4's real
//     toggle UI). Gates only the generic LLM/FAQ reply below, same position
//     as Meta's bot_active gate.
//   • Operational / administrative in-house routing and balloon-room-decor
//     routing (Requests Board intercepts) — NOT ported. These requests reach
//     the LLM fallback instead of creating a task/board row automatically.
//   • Auto-away detection, in-room keyword override, 15:00 auto-checkin
//     promotion, date-change regex — NOT ported.
// Every one of these still works normally on the Meta channel; a guest who
// also has a Meta thread is unaffected. Revisit this list before promoting
// GUEST_WHAPI_SUITES_ENABLED beyond a pilot rollout.
// ══════════════════════════════════════════════════════════════════════════════

const GUEST_DM_HISTORY_LIMIT = 6;

async function patchGuestDmInbound(
  supabase: ReturnType<typeof createClient>,
  conversationId: number | null,
  patch: Record<string, unknown>,
): Promise<void> {
  if (!conversationId) return;
  const { error } = await supabase.from("whatsapp_conversations").update(patch).eq("id", conversationId);
  if (error) console.warn("[whapi-webhook] patchGuestDmInbound failed:", error.message);
}

async function fetchGuestDmBotConfig(supabase: ReturnType<typeof createClient>): Promise<Record<string, string>> {
  const { data, error } = await supabase.from("bot_config").select("config_key, config_value");
  if (error || !data?.length) return {};
  const map: Record<string, string> = {};
  for (const r of data as Array<{ config_key: string; config_value: string }>) map[r.config_key] = r.config_value;
  return map;
}

/** Single active bot_scripts row by key — lighter than whatsapp-webhook's
 * full-catalog fetchBotScripts() (this file only ever needs one script at a
 * time so far: greeting_reply). */
async function fetchGuestDmBotScript(
  supabase: ReturnType<typeof createClient>,
  scriptKey: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("bot_scripts")
    .select("message_text")
    .eq("script_key", scriptKey)
    .eq("is_active", true)
    .maybeSingle();
  return ((data as Record<string, unknown> | null)?.message_text as string | undefined)?.trim() || null;
}

const GUEST_DM_DEFAULT_GREETING_REPLY =
  "שלום! 😊 ברוכים הבאים ל-Dream Island. במה אוכל לעזור לכם היום?";

function buildGuestDmGreetingReply(guestName: string | null, scriptText: string | null): string {
  const base = scriptText?.trim() || GUEST_DM_DEFAULT_GREETING_REPLY;
  return base.replace(/\{\{\s*GUEST_NAME\s*\}\}/gi, guestName?.trim() || "אורח יקר");
}

function buildWhapiGuestContextLine(guest: ActiveGuestRow | null): string {
  if (!guest) return "";
  const g = guest as ActiveGuestRow & {
    arrival_date?: string | null;
    departure_date?: string | null;
    arrival_time?: string | null;
    arrival_confirmed?: boolean | null;
    spa_time?: string | null;
    spa_date?: string | null;
    guest_profile?: Record<string, unknown> | null;
  };
  const today = new Date().toISOString().split("T")[0];
  const isCheckedIn = g.status === "checked_in";

  // Same stage computation as whatsapp-webhook's buildGuestStageContext — keep
  // the two channels' guest-awareness in sync (2026-07-10 parity pass).
  let stage = "";
  if (g.arrival_date) {
    if (g.arrival_date > today) stage = "טרם הגעה";
    else if (g.arrival_date === today) stage = "יום הגעה — האורח מגיע היום";
    else stage = "בתוך השהות";
  }

  const parts: string[] = [];
  if (g.name) parts.push(`שם: ${g.name}`);
  if (stage) parts.push(`שלב האורח: ${stage}`);
  if (g.arrival_date) parts.push(`תאריך הגעה: ${g.arrival_date}`);
  if (g.departure_date) parts.push(`תאריך עזיבה: ${g.departure_date}`);
  if (g.room && isCheckedIn) {
    parts.push(`חדר: ${g.room}`);
  } else if (g.room) {
    parts.push("חדר: ייחשף בצ'ק-אין — לפני אז אסור לחשוף/להמציא שם חדר ספציפי, רק לציין שזו סוויטת יוקרה");
  }
  if (g.room_type === "suite") parts.push("סוג: סוויטה");
  if (g.status) parts.push(`סטטוס: ${g.status}`);
  if (g.arrival_confirmed) parts.push("אישר הגעה: כן");
  if (g.spa_time || g.spa_date) {
    const sched = formatSpaScheduleDisplay(g.spa_date, g.spa_time);
    if (sched) parts.push(`טיפול ספא: ${sched}`);
  }

  const profileLine = formatGuestProfileForAi(g.guest_profile ?? null, g.arrival_time ?? null);
  if (profileLine) parts.push(profileLine);

  return parts.length ? `\n\nפרטי האורח הנוכחי: ${parts.join(" | ")}` : "";
}

async function fetchGuestDmHistory(
  supabase: ReturnType<typeof createClient>,
  phone: string,
): Promise<Array<{ direction: string; message: string }>> {
  const { data } = await supabase
    .from("whatsapp_conversations")
    .select("direction, message, created_at")
    .eq("phone", phone)
    .eq("inbox_channel", "whapi") // never blend in Meta-channel history for the same phone (migration 164)
    .order("created_at", { ascending: false })
    .limit(GUEST_DM_HISTORY_LIMIT);
  return ((data ?? []) as Array<{ direction: string; message: string }>)
    .map((h) => ({
      direction: h.direction,
      message: stripOutboundDispatchTag(h.message),
    }))
    .reverse();
}

/** staffMuted mirrors whatsapp-webhook's _suppressGuestRepliesStaffClaim contract
 * exactly: when staff has claimed the conversation, the SEND (and its outbound
 * log row) is skipped, but the caller's other DB side-effects (guest_alerts,
 * requires_attention) still happen — a staffer on the thread doesn't hide the
 * urgency flag from everyone else. */
async function sendGuestDmReply(
  supabase: ReturnType<typeof createClient>,
  phone: string,
  guestId: number | null,
  replyText: string,
  staffMuted = false,
): Promise<void> {
  if (staffMuted) {
    console.info("[whapi-webhook] guest_dm reply suppressed — staff claim active:", phone);
    return;
  }
  const guestBody = stripOutboundDispatchTag(replyText);
  const taggedMessage = formatWhapiSuitesConversationLog(guestBody);
  let wamid: string | null = null;
  try {
    wamid = await sendWhapiText(cleanPhoneForMention(phone), guestBody);
  } catch (e) {
    console.error("[whapi-webhook] sendGuestDmReply send failed:", (e as Error).message);
  }
  const { error } = await supabase.from("whatsapp_conversations").insert({
    phone, guest_id: guestId, direction: "outbound", message: taggedMessage, wa_message_id: wamid,
    inbox_channel: "whapi", channel: "whapi",
  });
  if (error) console.warn("[whapi-webhook] sendGuestDmReply log insert failed:", error.message);
}

/** Shared escalation writer for the three "hand off to staff" Tier-0 shields
 * below — same requires_attention/needs_callback/guest_alerts shape
 * whatsapp-webhook's Meta-side handlers use, so the Inbox red-dot and
 * GuestAttentionBadge behave identically regardless of channel. Escalation
 * writes always run (even if staff has claimed the thread — see staffMuted
 * doc above); only the reply send is conditionally suppressed. */
async function escalateGuestDm(
  supabase: ReturnType<typeof createClient>,
  opts: {
    phone: string; guestId: number | null; guestName: string | null; text: string;
    conversationId: number | null; attentionReason: string; alertType: string;
    humanRequestType?: string; replyText: string; staffMuted: boolean;
  },
): Promise<void> {
  const { phone, guestId, guestName, text, conversationId, attentionReason, alertType, humanRequestType, replyText, staffMuted } = opts;

  await patchGuestDmInbound(supabase, conversationId, {
    guest_id: guestId,
    intent: attentionReason,
    ...(humanRequestType ? { human_requested: true, human_request_type: humanRequestType } : {}),
  });

  if (guestId) {
    const { error } = await supabase.from("guests").update({
      requires_attention: true,
      requires_attention_since: new Date().toISOString(),
      needs_callback: true,
      attention_reason: attentionReason,
    }).eq("id", guestId);
    if (error) console.error(`[whapi-webhook] guest_dm ${attentionReason} guest update failed:`, error.message);
  }

  const { error: alertErr } = await supabase.from("guest_alerts").insert({
    guest_id: guestId, phone, alert_type: alertType, message: text,
    conversation_id: conversationId, resolved: false,
  });
  if (alertErr) {
    console.warn(`[whapi-webhook] guest_dm ${attentionReason} guest_alerts insert failed:`, alertErr.message);
  } else {
    onGuestAlertInserted(supabase, {
      guestId, phone, conversationId, message: text, alertType, guestName,
      sourceLabel: "WhatsApp Bot (Whapi)",
    }).catch((e: Error) => console.warn(`[whapi-webhook] guest_dm ${attentionReason} staff notify failed:`, e.message));
  }

  await sendGuestDmReply(supabase, phone, guestId, replyText, staffMuted);
}

/** Staff handoff copy → Inbox red dot + guest attention badge (Meta parity). */
async function flagGuestDmStaffHandoff(
  supabase: ReturnType<typeof createClient>,
  opts: {
    phone: string;
    guestId: number | null;
    conversationId: number | null;
    replyText: string;
  },
): Promise<void> {
  if (!isGuestStaffHandoffReply(opts.replyText)) return;

  await patchGuestDmInbound(supabase, opts.conversationId, {
    guest_id: opts.guestId,
    human_requested: true,
    human_request_type: "staff_handoff",
  });

  if (opts.guestId) {
    const { error } = await supabase.from("guests").update({
      requires_attention:       true,
      requires_attention_since: new Date().toISOString(),
      needs_callback:           true,
      attention_reason:         "שאלה מורכבת לצוות",
    }).eq("id", opts.guestId);
    if (error) {
      console.error("[whapi-webhook] guest_dm staff_handoff guest update failed:", error.message);
    }
  }

  console.info(
    `[whapi-webhook] 🤔 staff handoff — red alert flagged — phone:${opts.phone} guest:${opts.guestId ?? "unknown"}`,
  );
}

/**
 * Called exactly once per newly-claimed (non-duplicate) inbound Suites-device
 * DM — the sweep in the main loop has already inserted the inbox row via
 * claimWhapiGuestInbound() before this runs, so every early-return here is a
 * "captured, no auto-reply" outcome, never a "dropped" one.
 */
async function handleGuestDirectMessage(
  supabase: ReturnType<typeof createClient>,
  opts: {
    msgId: string;
    phone: string; // canonical digits, no leading "+" (matches claimWhapiGuestInbound's stored phone)
    text: string;
    conversationId: number | null;
    guest: ActiveGuestRow | null; // already loaded by the sweep via resolveGuestByInboundPhone
  },
  results: Array<Record<string, unknown>>,
): Promise<void> {
  const { msgId, phone, text, conversationId, guest } = opts;
  const guestId = guest?.id ?? null;
  const base = { id: msgId, channel: "guest_dm", phone, guest_id: guestId };

  try {
    if (adminNameFor(phone)) {
      await patchGuestDmInbound(supabase, conversationId, { intent: "admin_personal_dm" });
      results.push({ ...base, action: "captured_no_autoreply", reason: "admin_personal_dm" });
      return;
    }

    if (!shouldAutoReplyGuestWhapiDm(guest)) {
      const reason = !isGuestWhapiSuitesEnabled() ? "feature_disabled" : (guest ? "guest_inactive" : "no_guest_match");
      await patchGuestDmInbound(supabase, conversationId, { intent: "captured_no_autoreply" });
      results.push({ ...base, action: "captured_no_autoreply", reason });
      return;
    }

    const guestName = guest?.name ?? null;
    // Per-channel claim (migration 171, §4) — Whapi's OWN claim, never
    // guests.claimed_by (that's the Meta claim; claiming a Meta thread must
    // not mute this channel, and vice versa).
    const guestRecord = (guest as unknown) as Record<string, unknown> | null;
    if (guestRecord) {
      guestRecord.claimed_by_whapi = await fetchChannelClaim(supabase, guestId, "whapi");
    }
    // Mirrors whatsapp-webhook's staff-claim contract: mute the REPLY, not the
    // shields' DB side-effects (guest_alerts/requires_attention still fire —
    // other staff must still see the urgency even if one staffer has claimed
    // the thread). Only the expensive LLM call is skipped outright when muted
    // (matches Meta's own cost-saving gate — no point generating a reply that
    // will be discarded).
    const staffMuted = isGuestStaffClaimActive(guestRecord, "whapi");

    // ── Tier-0 greeting opener (היי / שלום) — before courtesy silent-exit,
    // same ordering whatsapp-webhook uses (a bare "היי" must never be swept
    // into courtesy silence — the guest expects a hello back). ──────────────
    if (isGuestGreetingMessage(text)) {
      const scriptText = await fetchGuestDmBotScript(supabase, "greeting_reply");
      await patchGuestDmInbound(supabase, conversationId, { intent: "greeting" });
      await sendGuestDmReply(supabase, phone, guestId, buildGuestDmGreetingReply(guestName, scriptText), staffMuted);
      results.push({ ...base, action: "greeting_reply", muted: staffMuted });
      return;
    }

    if (isLowValueCourtesyMessage(text)) {
      await patchGuestDmInbound(supabase, conversationId, { intent: "courtesy_ack" });
      results.push({ ...base, action: "courtesy_ack_silent" });
      return;
    }

    if (isSevereComplaint(text)) {
      await escalateGuestDm(supabase, {
        phone, guestId, guestName, text, conversationId,
        attentionReason: "severe_complaint", alertType: "severe_complaint", staffMuted,
        replyText: "אנחנו מצטערים מאוד לשמוע זאת — העברתי את זה ישירות לצוות הבכיר, ויחזרו אליך בהקדם. 🙏",
      });
      results.push({ ...base, action: "severe_complaint_escalated", muted: staffMuted });
      return;
    }

    if (isSensitiveStayChangeRequest(text)) {
      await escalateGuestDm(supabase, {
        phone, guestId, guestName, text, conversationId,
        attentionReason: "date_change", alertType: "date_change_request", humanRequestType: "date_change", staffMuted,
        replyText: CANONICAL_STAY_CHANGE_HANDOFF_MSG,
      });
      results.push({ ...base, action: "stay_change_escalated", muted: staffMuted });
      return;
    }

    if (isSensitiveFinancialRequest(text)) {
      await escalateGuestDm(supabase, {
        phone, guestId, guestName, text, conversationId,
        attentionReason: "financial_issue", alertType: "financial_issue", humanRequestType: "financial_issue", staffMuted,
        replyText: CANONICAL_FINANCIAL_HANDOFF_MSG,
      });
      results.push({ ...base, action: "financial_escalated", muted: staffMuted });
      return;
    }

    if (isCheckInPolicyQuestion(text)) {
      await patchGuestDmInbound(supabase, conversationId, { intent: "check_in_policy_faq" });
      const cfg = await fetchGuestDmBotConfig(supabase);
      await sendGuestDmReply(supabase, phone, guestId, buildCheckInPolicyReply(cfg), staffMuted);
      results.push({ ...base, action: "checkin_policy_faq", muted: staffMuted });
      return;
    }

    // ── "כן מגיעים" → Stage 2 arrival confirmation (P0 — ported from
    // whatsapp-webhook via _shared/guestInboundOrchestrator.ts). Must fire
    // regardless of staffMuted — same "Stage 2 not blocked by staff claim"
    // guarantee the Meta path has, which is why this check runs BEFORE the
    // staffMuted gate below applies to anything. ───────────────────────────
    if (isArrivalConfirmationMessage(text) && canGuestConfirmArrival(guestRecord)) {
      const stage2ScriptText = await fetchGuestDmBotScript(supabase, "stage_2_arrival");
      const result = await runGuestArrivalConfirmation(
        supabase,
        {
          stage2ScriptText,
          phone, guestId, guest: guestRecord, sim: false, source: "text",
          claimedConversationId: conversationId, msgId, channel: "whapi",
        },
        {
          sendMessage: (p, body) => sendWhapiText(cleanPhoneForMention(p), body),
          insertOutboundIfNotMuted: async (row) => {
            const { error } = await supabase.from("whatsapp_conversations").insert({
              phone: row.phone, guest_id: row.guest_id, inbox_channel: "whapi", channel: "whapi",
              direction: "outbound", message: row.message, wa_message_id: row.wa_message_id, intent: row.intent,
            });
            if (error) {
              console.error("[whapi-webhook] stage2 outbound log failed:", error.message);
              return false;
            }
            return true;
          },
          dispatchFallbackPipeline: dispatchStage2ViaPipeline,
          withStaffMuteSuspended: (fn) => fn(),
        },
      );
      results.push({ ...base, action: "stage2_arrival_confirmed", proceeded: result.proceeded });
      return;
    }

    // ── Arrival TIME — persist + Requests Board (arrival_eta); no ops / needs_callback ──
    if (guestId && isRecordOnlyArrivalTimeUpdate(text)) {
      const arrivalTime = extractArrivalTimeFromText(text)!;
      const persistResult = await persistGuestEta(supabase, {
        guestId,
        guest: guestRecord ?? {},
        timeHhMm: arrivalTime,
        source: "tier0_whapi",
      });
      if (persistResult.ok || persistResult.skipped !== "ineligible_guest") {
        if (persistResult.ok) {
          const board = await insertArrivalEtaBoardAlert(supabase, {
            guestId,
            phone,
            timeHhMm: arrivalTime,
            guestMessage: text,
            conversationId,
          });
          if (board.ok) {
            onGuestAlertInserted(supabase, {
              alertType: "arrival_eta",
              message: `🕐 שעת הגעה משוערת: ${arrivalTime}`,
              phone,
              guestId,
              conversationId,
              boardOnly: true,
            }).catch((e: Error) =>
              console.warn("[whapi-webhook] arrival_eta board notify:", e.message),
            );
          }
        }
        await patchClaimedInbound(supabase, conversationId, msgId, { intent: "arrival_time_update" });
        await sendGuestDmReply(supabase, phone, guestId, RECORD_ONLY_ARRIVAL_REPLY, false);
        results.push({ ...base, action: "arrival_time_record_only" });
        return;
      }
      console.info("[whapi-webhook] arrival_time record-only — ineligible row, falling through");
    }

    // ── Physical in-house ops request (Tier-0) — parity with Meta's
    // handleOperationalInHouseIntercept (whatsapp-webhook). A checked-in / on-
    // property-arrival-day suite guest asking for an allowlisted amenity,
    // maintenance, or cleaning item creates a pending_approval Operations
    // Board task via the shared _shared/createGuestOpsTask.ts helper — same
    // room/department/SLA classification and task shape Meta already
    // produces. Runs before the LLM fallback so this never costs a model
    // call. DB side effects always run (matches every shield above); only
    // the guest-facing reply is suppressed when staff has claimed this
    // Whapi thread (staffMuted contract, see sendGuestDmReply doc above).
    if (
      guestId
      && isGuestEligibleForInHouseOpsDispatch(
        {
          status:         (guestRecord?.status as string | null) ?? null,
          arrival_date:   (guestRecord?.arrival_date as string | null) ?? null,
          departure_date: (guestRecord?.departure_date as string | null) ?? null,
        },
        new Date(),
      )
      && isAllowlistedPhysicalTaskRequest(text)
    ) {
      const dispatchText = extractAllowlistedRequestLines(text);
      const summary = buildOperationalRequestSummary(text);
      const guestRoom = (guest?.room as string | null | undefined) ?? null;

      createGuestOpsTask({
        supabase, guestId, phone, guestName, room: guestRoom,
        summary, rawText: text, dispatchText,
      }).catch((e: Error) =>
        console.error("[whapi-webhook] guest_dm operational intercept createGuestOpsTask error:", e.message),
      );

      await patchGuestDmInbound(supabase, conversationId, {
        guest_id: guestId,
        intent: "operational_in_house_request",
        human_requested: true,
        human_request_type: "operational_request",
      });

      const { error: guestUpdErr } = await supabase.from("guests").update({
        requires_attention:       true,
        requires_attention_since: new Date().toISOString(),
        attention_reason:         summary,
      }).eq("id", guestId);
      if (guestUpdErr) {
        console.error("[whapi-webhook] guest_dm operational intercept guest update failed:", guestUpdErr.message);
      }

      await sendGuestDmReply(supabase, phone, guestId, buildOperationalDispatchReply(summary, guestName), staffMuted);
      results.push({ ...base, action: "operational_in_house_request", muted: staffMuted });
      return;
    }

    // ── Departure / porter assist (Tier-0) — parity with Meta's
    // handleDepartureAssistIntercept (whatsapp-webhook). A checkout+luggage
    // help request from an on-property guest — distinct from the stay-change
    // shield above (late checkout/extension), which already returned if
    // matched. Creates the same pending_approval Ops Board task as the
    // physical in-house intercept, never a fake "forwarded" ack (session
    // 2026-07-11 hallucination incident).
    if (
      guestId
      && isGuestEligibleForInHouseOpsDispatch(
        {
          status:         (guestRecord?.status as string | null) ?? null,
          arrival_date:   (guestRecord?.arrival_date as string | null) ?? null,
          departure_date: (guestRecord?.departure_date as string | null) ?? null,
        },
        new Date(),
      )
      && isDepartureAssistRequest(text)
    ) {
      const summary = buildDepartureAssistSummary(text);
      const guestRoom = (guest?.room as string | null | undefined) ?? null;

      createGuestOpsTask({
        supabase, guestId, phone, guestName, room: guestRoom,
        summary, rawText: text,
      }).catch((e: Error) =>
        console.error("[whapi-webhook] guest_dm departure assist createGuestOpsTask error:", e.message),
      );

      await patchGuestDmInbound(supabase, conversationId, {
        guest_id: guestId,
        intent: "departure_assist_request",
        human_requested: true,
        human_request_type: "operational_request",
      });

      const { error: guestUpdErr } = await supabase.from("guests").update({
        requires_attention:       true,
        requires_attention_since: new Date().toISOString(),
        attention_reason:         summary,
      }).eq("id", guestId);
      if (guestUpdErr) {
        console.error("[whapi-webhook] guest_dm departure assist guest update failed:", guestUpdErr.message);
      }

      await sendGuestDmReply(supabase, phone, guestId, buildDepartureAssistReply(guestName), staffMuted);
      results.push({ ...base, action: "departure_assist_request", muted: staffMuted });
      return;
    }

    // bot_active_whapi — stub gate ahead of §4's real toggle UI (migration
    // 170 seeds bot_config.bot_active_whapi default 'true'). Mirrors where
    // Meta's bot_active gates (whatsapp-webhook.js) — only the generic
    // LLM/FAQ reply below is gated; Stage 2 and record-only ETA above always
    // fire regardless, same invariant as Meta.
    const botCfg = await fetchGuestDmBotConfig(supabase);
    if (!isWhapiBotActive(botCfg)) {
      await patchGuestDmInbound(supabase, conversationId, { intent: "faq" });
      results.push({ ...base, action: "captured_bot_off_whapi" });
      return;
    }

    // General LLM fallback — everything not caught by a Tier-0 shield above.
    await patchGuestDmInbound(supabase, conversationId, { intent: "faq" });
    if (staffMuted) {
      results.push({ ...base, action: "captured_staff_claimed_faq" });
      return;
    }
    const inHouse = guest?.status === "checked_in";
    const brain = await assembleGuestBrainPrompt(supabase, "whapi", {
      guestContextLine: buildWhapiGuestContextLine(guest),
      inHouse,
    });
    console.info(`[whapi-webhook] guest_dm prompt source: ${brain.promptSource} model_pref=${brain.preferredModel ?? "(default)"}`);

    let replyText: string;
    try {
      const history = await fetchGuestDmHistory(supabase, phone);
      replyText = await generateGuestChatReply({
        userMessage: text,
        guestName: guestName,
        history,
        systemPrompt: brain.systemPrompt,
        preferredModel: brain.preferredModel,
        logTag: "whapi-webhook",
      });
    } catch (e) {
      console.error("[whapi-webhook] guest DM LLM reply failed:", (e as Error).message);
      replyText = GUEST_STAFF_HANDOFF_SENTENCE;
    }
    await flagGuestDmStaffHandoff(supabase, { phone, guestId, conversationId, replyText });
    await sendGuestDmReply(supabase, phone, guestId, replyText, staffMuted);
    results.push({ ...base, action: staffMuted ? "captured_staff_claimed_faq" : "llm_reply_sent" });
  } catch (e) {
    console.error("[whapi-webhook] handleGuestDirectMessage failed:", (e as Error).message);
    results.push({ ...base, error: "guest_dm_failed", detail: (e as Error).message });
  }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const payload = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    console.log("[whapi-webhook] raw payload:", JSON.stringify(payload).slice(0, 2000));

    const messages = extractMessages(payload);
    if (messages.length === 0) {
      return new Response(JSON.stringify({ ok: true, ignored: "no_messages" }),
        { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const lockGroup = Deno.env.get("WHAPI_GROUP_ID")?.trim() || null;
    const hkGroup   = Deno.env.get("WHAPI_HOUSEKEEPING_GROUP_ID")?.trim() || null;
    const results: Array<Record<string, unknown>> = [];

    // ── Suites device — 1:1 guest DMs (מכשיר הסוויטות) ─────────────────────
    // Every inbound message is captured to the Inbox first (ZERO DATA LOSS,
    // inbox_channel='whapi'), then — on a fresh (non-duplicate) claim only —
    // handed to handleGuestDirectMessage() for Tier-0 shields + Gemini
    // auto-reply, same brain as the Meta bot. See that function's header
    // comment above for the gating rule and the documented gap list.
    for (const msg of messages) {
      if (msg.fromMe) {
        if (isDirectGuestChat(msg.chatId)) {
          const mirror = await mirrorWhapiOutboundDm(supabase, msg);
          results.push({ id: msg.id, channel: "guest_dm", from_me: true, ...mirror });
        } else {
          results.push({ id: msg.id, channel: "guest_dm", ignored: "from_me" });
        }
        continue;
      }
      if (!isDirectGuestChat(msg.chatId)) continue;

      const phone = canonicalGuestPhone(msg.fromPhone, msg.chatId);
      if (!phone) {
        results.push({ id: msg.id, channel: "guest_dm", ignored: "no_phone" });
        continue;
      }

      let body = msg.text;
      let fromVoice = false;
      if (!body && msg.voiceMediaId) {
        // A failure here used to `continue` with nothing but an internal
        // results[] entry nobody reads — total silence to the sender AND no
        // Inbox trace (violates the "ALWAYS captures the inbound message
        // first" invariant documented below). Mirror the graceful-fallback
        // reply the staff-group voice path already sends (~line 1252/1265)
        // plus a placeholder Inbox row, so this pipeline fails the same way.
        if ((msg.voiceSeconds ?? 0) > 180) {
          await claimWhapiGuestInbound(supabase, {
            phone, guest_id: null, message: "🎤 [הקלטה קולית ארוכה מ-3 דקות — לא תומללה]",
            wa_message_id: msg.id, push_name: msg.fromName || null,
          });
          await sendGuestDmReply(supabase, phone, null, "🎤 ההודעה הקולית ארוכה מ-3 דקות — אפשר לכתוב לי בטקסט? 🙏");
          results.push({ id: msg.id, channel: "guest_dm", phone, ignored: "voice_too_long" });
          continue;
        }
        try {
          const geminiKey = Deno.env.get("GEMINI_API_KEY");
          if (!geminiKey) throw new Error("no_gemini_key");
          const base64Audio = await fetchWhapiMedia(msg.voiceMediaId);
          body = await transcribeVoice(geminiKey, base64Audio, msg.voiceMimeType || "audio/ogg");
          fromVoice = true;
        } catch (e) {
          // FAIL VISIBLE: no live function-log access from this environment,
          // so the real cause has to surface in the Inbox itself, not just
          // console.error — otherwise a repeat failure is undiagnosable.
          const errDetail = (e as Error).message?.slice(0, 200) || "unknown_error";
          console.error(`[whapi-webhook] guest_dm voice failed ${msg.id}:`, errDetail);
          await claimWhapiGuestInbound(supabase, {
            phone, guest_id: null,
            message: `🎤 [תמלול נכשל: ${errDetail} | media=${msg.voiceMediaId} mime=${msg.voiceMimeType} sec=${msg.voiceSeconds}]`,
            wa_message_id: msg.id, push_name: msg.fromName || null,
          });
          await sendGuestDmReply(supabase, phone, null, "🎤 לא הצלחתי להבין את ההקלטה — אפשר לכתוב לי בטקסט? 🙏");
          results.push({ id: msg.id, channel: "guest_dm", phone, error: "voice_transcription_failed", detail: errDetail });
          continue;
        }
      }

      if (!body?.trim()) {
        results.push({ id: msg.id, channel: "guest_dm", ignored: "no_text" });
        continue;
      }

      const guest = (await resolveGuestByInboundPhone(supabase, phone)) as ActiveGuestRow | null;
      const inboxText = fromVoice ? `🎤 ${body.trim()}` : body.trim();
      const { claimed, conversationId } = await claimWhapiGuestInbound(supabase, {
        phone,
        guest_id: guest?.id ?? null,
        message: inboxText,
        wa_message_id: msg.id,
        push_name: msg.fromName || null,
      });

      if (!claimed) {
        results.push({
          id: msg.id, channel: "guest_dm", phone, guest_id: guest?.id ?? null,
          claimed: false, conversation_id: conversationId, fromVoice,
        });
        // Voice/LLM paths can exceed Whapi's webhook wait — it retries the
        // same wa_message_id. The first attempt already claimed inbound; if it
        // died before a successful outbound, executives would get permanent
        // silence (Inbox may still show a failed/partial reply). Re-enter the
        // executive handler idempotently; guest LLM stays skip-on-dedup.
        if (await isExecutiveInbound(phone, supabase)) {
          await handleExecutiveVoiceMessage(
            supabase,
            {
              phone,
              text: body.trim(),
              fromVoice,
              conversationId,
              msgId: msg.id,
              chatId: msg.chatId,
              unclaimedRetry: true,
            },
            results,
          );
        }
        continue;
      }

      console.log(
        `[whapi-webhook] guest_dm inbound phone:${phone} guest:${guest?.id ?? "unlinked"} conv:${conversationId ?? "?"}`,
      );

      // ── Executive Voice Assistant (Eliad Co-Pilot) — CEO-only intercept ──
      // Runs AFTER claimWhapiGuestInbound (ZERO DATA LOSS — already logged to
      // the Inbox above) and BEFORE handleGuestDirectMessage, so a CEO message
      // never reaches the guest Tier-0 shields / guest LLM brain at all.
      if (await isExecutiveInbound(phone, supabase)) {
        await handleExecutiveVoiceMessage(
          supabase,
          {
            phone,
            text: body.trim(),
            fromVoice,
            conversationId,
            msgId: msg.id,
            chatId: msg.chatId,
          },
          results,
        );
        continue;
      }

      await handleGuestDirectMessage(
        supabase,
        { msgId: msg.id, phone, text: body.trim(), conversationId, guest },
        results,
      );
    }

    // ── Reaction sweep (Sprint 2, Session 26) — 👍🏼 on a task card = done.
    // Session 77c — dual lookup: staff often react to the ORIGINAL trigger
    // message (source_message_id) instead of the bot card (whapi_message_id).
    // Processed before the text-message loop: zero LLM cost, fully independent
    // of classification. Any other emoji is silently ignored (No-Bloat Rule —
    // no group reply either way, success or no-op).
    for (const r of extractReactions(payload)) {
      if (r.fromMe)                            { results.push({ id: r.id, ignored: "from_me_reaction" });        continue; }
      if (!r.chatId.endsWith("@g.us"))         { results.push({ id: r.id, ignored: "not_a_group_reaction" });    continue; }
      if (lockGroup && r.chatId !== lockGroup) { results.push({ id: r.id, ignored: "other_group_reaction" });    continue; }
      if (!isThumbsUp(r.emoji))                { results.push({ id: r.id, ignored: "non_thumbsup_reaction" });   continue; }
      if (!r.targetMessageId)                  { results.push({ id: r.id, ignored: "no_target" });               continue; }

      const task = await findOpenTaskForReaction(supabase, r.targetMessageId);
      if (!task) {
        results.push({ id: r.id, reaction: "thumbs_up", target: r.targetMessageId, ignored: "no_matching_open_task" });
        continue;
      }
      if (task.status === "done") {
        results.push({ id: r.id, reaction: "thumbs_up", taskId: task.id, ignored: "already_done" });
        continue;
      }

      const { ok, error: doneErr } = await resolveTaskByReaction(supabase, task.id, r);

      if (!ok) console.error(`[whapi-webhook] 👍 reaction resolve failed for task ${task.id}:`, doneErr);
      else console.log(
        `[whapi-webhook] 👍 task ${task.id} resolved by reaction — matched=${task.matchedOn} from=${r.fromName || r.fromPhone}`,
      );
      results.push({
        id: r.id,
        reaction: "thumbs_up",
        taskId: task.id,
        matchedOn: task.matchedOn,
        resolved: ok,
      });
    }

    // ── Housekeeping group (Phase 1) — parse ready signals, write room_status →
    // ממתין לאישור, optional Hebrew ack in-group when a new bell fires. Parallel
    // to the ops group; no tasks / no LLM.
    if (hkGroup) {
      for (const msg of messages) {
        if (msg.fromMe) continue;
        if (!msg.chatId.endsWith("@g.us") || msg.chatId !== hkGroup) continue;

        if (!msg.text) {
          results.push({ id: msg.id, channel: "housekeeping", ignored: "no_text" });
          continue;
        }

        const readyRooms = parseHousekeepingReadyRoomNumbers(msg.text);
        const checkInRooms = parseHousekeepingCheckInRoomNumbers(msg.text);
        if (readyRooms.length === 0 && checkInRooms.length === 0) {
          results.push({
            id: msg.id,
            channel: "housekeeping",
            ignored: "no_housekeeping_pattern",
            chat_id: msg.chatId,
          });
          continue;
        }

        const readySignals = [];
        for (const roomNumber of readyRooms) {
          readySignals.push(await applyHousekeepingReadySignal(supabase, {
            roomNumber,
            waMessageId: msg.id,
            sourceLine: msg.text,
          }));
        }

        const checkInSignals = [];
        for (const roomNumber of checkInRooms) {
          checkInSignals.push(await applyHousekeepingCheckInSignal(supabase, {
            roomNumber,
            waMessageId: msg.id,
            sourceLine: msg.text,
          }));
        }

        const ackLines = [
          ...buildHousekeepingGroupAckMessage(
            readySignals
              .filter((s) => s.action === "updated" && s.roomId)
              .map((s) => ({ roomId: s.roomId as string, guestName: s.guestName })),
          ).split("\n").filter(Boolean),
          ...checkInSignals.map(buildHousekeepingCheckInAckLine).filter((l): l is string => !!l),
        ];
        const ackText = ackLines.join("\n");
        let ackSent = false;
        if (ackText) {
          try {
            await sendWhapiText(msg.chatId, ackText, { noLinkPreview: true });
            ackSent = true;
          } catch (e) {
            console.warn(`[whapi-webhook] housekeeping ack failed for ${msg.id}:`, (e as Error).message);
          }
        }

        console.log(
          `[whapi-webhook] housekeeping ${msg.id} chat=${msg.chatId} ready=${readyRooms.join(",")} checkin=${checkInRooms.join(",")} ack=${ackSent}`,
        );
        results.push({
          id: msg.id,
          channel: "housekeeping",
          chat_id: msg.chatId,
          readyRooms,
          checkInRooms,
          readySignals,
          checkInSignals,
          ackSent,
        });
      }
    }

    for (const msg of messages) {
      // ── Guards ────────────────────────────────────────────────────────────
      if (msg.fromMe)                  { results.push({ id: msg.id, ignored: "from_me" });     continue; } // never react to our own sends → no loops
      if (isDirectGuestChat(msg.chatId)) continue; // handled by guest_dm sweep above
      if (!msg.chatId.endsWith("@g.us")) { results.push({ id: msg.id, ignored: "not_a_group" }); continue; }
      if (hkGroup && msg.chatId === hkGroup) continue; // handled by housekeeping sweep — never ops-classify
      if (lockGroup && msg.chatId !== lockGroup) { results.push({ id: msg.id, ignored: "other_group" }); continue; }

      // ── Voice note → transcribe, then rejoin the SAME pipeline a typed
      // message uses below (parseDeterministic/classifyWithAi never know the
      // difference). Claude has no audio input, so this step is Gemini-only —
      // a failure here has no same-call fallback, which is exactly why it
      // replies in-group instead of silently dropping (a failed *text*
      // classification still leaves the original message visible in the chat
      // for a human to notice; a dropped voice note leaves nothing). ─────────
      let fromVoice = false;
      if (!msg.text && msg.voiceMediaId) {
        if ((msg.voiceSeconds ?? 0) > 180) {
          try { await sendWhapiText(msg.chatId, "🎤 ההודעה הקולית ארוכה מ-3 דקות — נא להקליד את הבקשה.", { noLinkPreview: true }); } catch {}
          results.push({ id: msg.id, ignored: "voice_too_long" });
          continue;
        }
        try {
          const geminiKey = Deno.env.get("GEMINI_API_KEY");
          if (!geminiKey) throw new Error("no_gemini_key");
          const base64Audio = await fetchWhapiMedia(msg.voiceMediaId);
          msg.text = await transcribeVoice(geminiKey, base64Audio, msg.voiceMimeType || "audio/ogg");
          fromVoice = true;
          console.log(`[whapi-webhook] 🎤 transcribed ${msg.id}: "${msg.text.slice(0, 120)}"`);
        } catch (e) {
          console.error(`[whapi-webhook] voice transcription failed for ${msg.id}:`, (e as Error).message);
          try { await sendWhapiText(msg.chatId, "🎤 לא הצלחנו לתמלל את ההודעה הקולית — נא להקליד את הבקשה.", { noLinkPreview: true }); } catch {}
          results.push({ id: msg.id, error: "voice_transcription_failed", detail: (e as Error).message });
          continue;
        }
      }
      if (!msg.text)                   { results.push({ id: msg.id, ignored: "no_text" });     continue; }

      // ── Idempotency: one ticket per inbound message id. Checked BEFORE the
      // LLM so a webhook re-delivery of a task message costs zero tokens. ─────
      const { data: dup } = await supabase.from("tasks").select("id").eq("source_message_id", msg.id).maybeSingle();
      if (dup) { results.push({ id: msg.id, ignored: "duplicate", taskId: dup.id }); continue; }

      const adminName = adminNameFor(msg.fromPhone);

      // ── Classify: deterministic fast-path, AI only on a miss ───────────────
      let cls: Classification;
      try {
        cls = parseDeterministic(msg.text) ?? await classifyWithAi(msg.text);
      } catch (e) {
        console.error("[whapi-webhook] classification failed:", (e as Error).message);
        results.push({ id: msg.id, error: "classify_failed", detail: (e as Error).message });
        continue;
      }

      // ── CHITCHAT → silence (no group reply, no DB) ─────────────────────────
      if (!cls.is_task) {
        console.log(`[whapi-webhook] CHITCHAT ignored — from=${msg.fromName || msg.fromPhone} text="${msg.text}"`);
        results.push({ id: msg.id, is_task: false, action: "ignored_chitchat" });
        continue;
      }

      // ── TASK → log + reply in-group ────────────────────────────────────────
      // Reporter profile (phone → profiles) for department + attribution.
      const local = msg.fromPhone.startsWith("972") ? "0" + msg.fromPhone.slice(3) : msg.fromPhone;
      const { data: reporterProfile } = await supabase
        .from("profiles").select("id, department").in("phone", [msg.fromPhone, "+" + msg.fromPhone, local]).maybeSingle();

      const slaCategory = guessSlaCategory(cls.task_description);
      const slaDeadline = new Date(Date.now() + (SLA_THRESHOLDS[slaCategory] ?? SLA_THRESHOLDS[DEFAULT_SLA_CATEGORY]) * 60000).toISOString();
      const actionToken = crypto.randomUUID();
      // Session 27 Sprint 4.2 — a Room/חדר/סוויטה-prefixed manual message (Tier 0
      // room_prefix parse) gets its own source so it's distinguishable on the Ops
      // Board from the digit-dash shorthand and the AI-classified fallback, both
      // of which stay 'whatsapp_staff'.
      const taskSource = cls.tier === "room_prefix" ? "manual_group" : "whatsapp_staff";
      const taskDepartment = (reporterProfile?.department as string) || "תפעול";

      const { data: task, error: insertErr } = await supabase
        .from("tasks")
        .insert([{
          room_number:         cls.room_number,
          department:          taskDepartment,
          description:         cls.task_description,
          priority:            slaCategory === "pest_control" ? "urgent" : "normal",
          status:              "open",
          sla_category:        slaCategory,
          sla_deadline:        slaDeadline,
          source:              taskSource,
          reporter_profile_id: reporterProfile?.id ?? null,
          reporter_raw_text:   fromVoice ? `🎤 ${msg.text}` : msg.text,
          action_token:        actionToken,
          source_message_id:   msg.id,
        }])
        .select()
        .maybeSingle();

      if (insertErr) {
        // A race re-delivery may trip the source_message_id unique index — treat
        // as an already-handled duplicate, not a hard failure.
        console.error("[whapi-webhook] task insert error:", insertErr.message);
        results.push({ id: msg.id, error: "task_insert_failed", detail: insertErr.message });
        continue;
      }
      if (!task) {
        // Insert succeeded with no error but the select-back returned nothing
        // (e.g. RLS gap) — CLAUDE.md §5 forbids .single(), which would have
        // thrown here instead of surfacing FAIL VISIBLE.
        console.error("[whapi-webhook] task insert returned no row (RLS?) — source_message_id:", msg.id);
        results.push({ id: msg.id, error: "task_insert_no_row" });
        continue;
      }

      // Whapi card translation only — tasks.description (already written above,
      // `cls.task_description`) stays in whatever language it was reported in
      // for the DB/board UI. classifyWithAi() already forces English (its tool
      // schema demands it), so this only ever fires for a Tier-0 regex report
      // ("11- מגבות" / "חדר 5 מזגן לא עובד") that never touched an LLM.
      // No 👤 Assigned line — department→profiles lookup mislabeled leadership.
      let cardDescription = cls.task_description;
      if (containsHebrew(cardDescription)) {
        cardDescription = await translateTextForFieldOps(cardDescription, {
          room: cls.room_number,
          style: "description_only",
        });
      }
      const card = buildTaskCard(cls.room_number, cardDescription, null, fromVoice);

      // Reply into the SAME group. no_link_preview stops the crawler pre-fetch.
      // Non-blocking: the ticket already exists — a failed reply must not lose it.
      let replied = true;
      let cardMsgId: string | null = null;
      try {
        cardMsgId = await sendWhapiText(msg.chatId, card, { noLinkPreview: true });
      } catch (e) {
        replied = false;
        console.warn(`[whapi-webhook] task ${task.id} created but group reply failed:`, (e as Error).message);
      }
      // Persist the outbound card's message id — Sprint 2's reaction sweep
      // above matches an inbound 👍🏼's action.target against whapi_message_id
      // (primary) or source_message_id (fallback — reaction on trigger text).
      if (cardMsgId) {
        const { error: msgIdErr } = await supabase.from("tasks").update({ whapi_message_id: cardMsgId }).eq("id", task.id);
        if (msgIdErr) console.warn(`[whapi-webhook] failed to store whapi_message_id for task ${task.id}:`, msgIdErr.message);
      }

      console.log(
        `[whapi-webhook] TASK #${task.id} — room=${cls.room_number ?? "?"} sla=${slaCategory} tier=${cls.tier} source=${taskSource} ` +
        `from=${msg.fromName || msg.fromPhone}${adminName ? `(admin:${adminName})` : ""} replied=${replied}${fromVoice ? " fromVoice=true" : ""}`,
      );
      results.push({
        id: msg.id, is_task: true, taskId: task.id, room_number: cls.room_number,
        task_description: cls.task_description, sla_category: slaCategory, tier: cls.tier, replied, fromVoice,
      });
    }

    return new Response(JSON.stringify({ ok: true, results }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[whapi-webhook] error:", msg);
    // Always HTTP 200 + error in body — repo-wide convention (CLAUDE.md §10 s11).
    return new Response(JSON.stringify({ ok: false, error: msg }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } });
  }
});

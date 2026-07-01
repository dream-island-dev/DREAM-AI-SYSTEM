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
//   transcription only), SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. Optional:
//   WHAPI_GROUP_ID (lock to one group; also used by task-action as the
//   confirmation target), WHAPI_API_URL.
// ══════════════════════════════════════════════════════════════════════════════

import { serve }         from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient }  from "https://esm.sh/@supabase/supabase-js@2";
import Anthropic         from "https://esm.sh/@anthropic-ai/sdk@0.20.0";
import { sendWhapiText, cleanPhoneForMention } from "../_shared/whapiSend.ts";
import { fetchWhapiMedia } from "../_shared/whapiMedia.ts";

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
// Mirrors process-knowledge/index.ts's exact inline_data multimodal request
// shape (same model, same temperature:0 for deterministic output) — the only
// difference is the mime type and a plain-transcription prompt instead of a
// rule-extraction one. Output is plain text, fed straight back into the SAME
// parseDeterministic()/classifyWithAi() pipeline a typed message uses — no
// parallel classification logic for voice.
const GEMINI_MODEL = "gemini-1.5-flash";
const TRANSCRIBE_PROMPT =
  "תמלל את הקובץ הקולי המצורף במדויק, מילה במילה. הצוות מדבר עברית, לעתים אנגלית. " +
  "החזר טקסט פשוט בלבד — את התמלול עצמו, בלי הערות, בלי markdown, בלי תגי שפה.";

async function transcribeVoice(apiKey: string, base64Audio: string, mimeType: string): Promise<string> {
  const requestBody = {
    contents: [{
      role: "user",
      parts: [
        { text: TRANSCRIBE_PROMPT },
        { inline_data: { mime_type: mimeType, data: base64Audio } },
      ],
    }],
    generationConfig: { maxOutputTokens: 1024, temperature: 0.0 },
  };

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(30_000), // audio decode can be slower than the text-mapping calls elsewhere in this repo
    },
  );

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`gemini_transcribe_${res.status}: ${errBody.slice(0, 300)}`);
  }

  const data = await res.json();
  const text: string =
    data?.candidates?.[0]?.content?.parts
      ?.map((p: { text?: string }) => p.text ?? "")
      .join("") ?? "";

  if (!text.trim()) {
    const finishReason = data?.candidates?.[0]?.finishReason;
    throw new Error(finishReason === "SAFETY" ? "gemini_safety_filter" : "gemini_empty_transcription");
  }
  return text.trim();
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

// ── The structured English task card sent back into the group ────────────────
// Session 27 Sprint 4.1: the old Accept/Complete link-tap flow (task-action
// GET/POST interstitial) is replaced by a single reaction gesture — no link,
// no crawler-safety dance, just 👍🏼 on this card. task-action.ts itself stays
// alive (the manager "Bump" action, sla-escalation-cron, still uses it).
// Session — Dynamic Native Mentions. `assignedPhone` (already-cleaned bare
// digits, e.g. "972504721760") is optional: when no profiles row has a phone
// for the task's department, the card renders exactly as before (no dead
// "Assigned:" line). The "@<digits>" substring must appear verbatim in the
// body — that's what Whapi's `mentions` array binds to — so it's built from
// the SAME cleaned variable passed to sendWhapiText below, never a separately
// formatted display string.
function buildTaskCard(room: string | null, desc: string, assignedPhone: string | null, fromVoice = false): string {
  return [
    `📌 New Task Opened: Suite ${room ?? "—"}`,
    ...(fromVoice ? [`🎤 Transcribed from voice:`] : []),
    `📋 Task: ${desc}`,
    `⏰ Status: Pending`,
    ...(assignedPhone ? [`👤 Assigned: @${assignedPhone}`] : []),
    `👉 Please react with 👍🏼 to complete this task.`,
  ].join("\n");
}

// Department → on-duty worker, looked up live from `profiles` (phone E.164,
// migration 070) — fully dynamic, not a hardcoded name/phone map, so it picks
// up any worker added/reassigned to a department without a code change. No
// shift/availability signal exists yet, so this is "first phone on file for
// the department" — best-effort, same FAIL VISIBLE convention as every other
// lookup in this file: a miss just means the card has no assignee tag.
async function findAssignedWorkerPhone(
  supabase: ReturnType<typeof createClient>,
  department: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("phone")
    .eq("department", department)
    .not("phone", "is", null)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn(`[whapi-webhook] assigned-worker lookup failed for department "${department}":`, error.message);
    return null;
  }
  return (data?.phone as string | undefined) ?? null;
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
    const results: Array<Record<string, unknown>> = [];

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

    for (const msg of messages) {
      // ── Guards ────────────────────────────────────────────────────────────
      if (msg.fromMe)                  { results.push({ id: msg.id, ignored: "from_me" });     continue; } // never react to our own sends → no loops
      if (!msg.chatId.endsWith("@g.us")) { results.push({ id: msg.id, ignored: "not_a_group" }); continue; }
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
        .single();

      if (insertErr) {
        // A race re-delivery may trip the source_message_id unique index — treat
        // as an already-handled duplicate, not a hard failure.
        console.error("[whapi-webhook] task insert error:", insertErr.message);
        results.push({ id: msg.id, error: "task_insert_failed", detail: insertErr.message });
        continue;
      }

      const rawAssignedPhone = await findAssignedWorkerPhone(supabase, taskDepartment);
      const assignedPhone = rawAssignedPhone ? cleanPhoneForMention(rawAssignedPhone) : null;
      const card = buildTaskCard(cls.room_number, cls.task_description, assignedPhone, fromVoice);

      // Reply into the SAME group. no_link_preview stops the crawler pre-fetch.
      // Non-blocking: the ticket already exists — a failed reply must not lose it.
      let replied = true;
      let cardMsgId: string | null = null;
      try {
        cardMsgId = await sendWhapiText(msg.chatId, card, {
          noLinkPreview: true,
          ...(assignedPhone ? { mentions: [assignedPhone] } : {}),
        });
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

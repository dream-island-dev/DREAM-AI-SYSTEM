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
//                     "from_name","text":{"body"} | "image":{"caption"} } ] }
//
// Required secrets: WHAPI_TOKEN, ANTHROPIC_API_KEY, SUPABASE_URL,
//   SUPABASE_SERVICE_ROLE_KEY. Optional: WHAPI_GROUP_ID (lock to one group;
//   also used by task-action as the confirmation target), WHAPI_API_URL.
// ══════════════════════════════════════════════════════════════════════════════

import { serve }         from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient }  from "https://esm.sh/@supabase/supabase-js@2";
import Anthropic         from "https://esm.sh/@anthropic-ai/sdk@0.20.0";
import { sendWhapiText } from "../_shared/whapiSend.ts";

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
const ROOM_PREFIX_RE = /^\s*(?:room|suite|חדר|סוויטה)\s*(?:number|no\.?|#|מספר)?\s*(\d+)\s*[-:.,]?\s*([\s\S]+)$/i;

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

// ── Whapi message extraction (defensive — shape varies by version) ───────────
interface IncomingMessage {
  id: string; fromMe: boolean; chatId: string; fromPhone: string; fromName: string; text: string;
}
function extractMessages(payload: Record<string, unknown>): IncomingMessage[] {
  const raw = Array.isArray(payload?.messages) ? (payload.messages as Array<Record<string, unknown>>) : [];
  return raw.map((m) => {
    const type = String(m?.type ?? "");
    const textBody =
      type === "text"  ? String((m?.text  as Record<string, unknown>)?.body    ?? "")
      : type === "image" ? String((m?.image as Record<string, unknown>)?.caption ?? "")
      : "";
    return {
      id:        String(m?.id ?? ""),
      fromMe:    m?.from_me === true,
      chatId:    String(m?.chat_id ?? ""),
      fromPhone: String(m?.from ?? "").replace(/\D/g, ""),
      fromName:  String(m?.from_name ?? ""),
      text:      textBody.trim(),
    };
  });
}

// ── The structured English task card sent back into the group ────────────────
function buildTaskCard(room: string | null, desc: string, acceptUrl: string, completeUrl: string): string {
  return [
    `📌 New Task Opened: Suite ${room ?? "—"}`,
    `📋 Task: ${desc}`,
    `⏰ Status: Pending`,
    `🛠️ Click here to Accept Task: ${acceptUrl}`,
    `✅ Click here to Mark Completed: ${completeUrl}`,
  ].join("\n");
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
    const functionsBase = `${Deno.env.get("SUPABASE_URL")}/functions/v1/task-action`;
    const lockGroup = Deno.env.get("WHAPI_GROUP_ID")?.trim() || null;
    const results: Array<Record<string, unknown>> = [];

    for (const msg of messages) {
      // ── Guards ────────────────────────────────────────────────────────────
      if (msg.fromMe)                  { results.push({ id: msg.id, ignored: "from_me" });     continue; } // never react to our own sends → no loops
      if (!msg.chatId.endsWith("@g.us")) { results.push({ id: msg.id, ignored: "not_a_group" }); continue; }
      if (lockGroup && msg.chatId !== lockGroup) { results.push({ id: msg.id, ignored: "other_group" }); continue; }
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

      const { data: task, error: insertErr } = await supabase
        .from("tasks")
        .insert([{
          room_number:         cls.room_number,
          department:          (reporterProfile?.department as string) || "תפעול",
          description:         cls.task_description,
          priority:            slaCategory === "pest_control" ? "urgent" : "normal",
          status:              "open",
          sla_category:        slaCategory,
          sla_deadline:        slaDeadline,
          source:              "whatsapp_staff",
          reporter_profile_id: reporterProfile?.id ?? null,
          reporter_raw_text:   msg.text,
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

      const acceptUrl   = `${functionsBase}?id=${task.id}&action=accept&token=${actionToken}`;
      const completeUrl = `${functionsBase}?id=${task.id}&action=complete&token=${actionToken}`;
      const card = buildTaskCard(cls.room_number, cls.task_description, acceptUrl, completeUrl);

      // Reply into the SAME group. no_link_preview stops the crawler pre-fetch.
      // Non-blocking: the ticket already exists — a failed reply must not lose it.
      let replied = true;
      try {
        await sendWhapiText(msg.chatId, card, { noLinkPreview: true });
      } catch (e) {
        replied = false;
        console.warn(`[whapi-webhook] task ${task.id} created but group reply failed:`, (e as Error).message);
      }

      console.log(
        `[whapi-webhook] TASK #${task.id} — room=${cls.room_number ?? "?"} sla=${slaCategory} tier=${cls.tier} ` +
        `from=${msg.fromName || msg.fromPhone}${adminName ? `(admin:${adminName})` : ""} replied=${replied}`,
      );
      results.push({
        id: msg.id, is_task: true, taskId: task.id, room_number: cls.room_number,
        task_description: cls.task_description, sla_category: slaCategory, tier: cls.tier, replied,
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

// supabase/functions/_shared/executiveAssistant.ts
// XOS Executive Voice Assistant (Eliad Co-Pilot) — Phase 2.
// CEO-only secretary living inside the Whapi Suites device DM pipeline.
// Gemini 2.5 Flash primary (function calling) + Claude Sonnet 4.6 fallback.
// Learning reuses xos_ai_rules (module='executive') — no parallel playbook table.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.20.0";
import { resolveExecutiveInbound, type ExecutiveProfile } from "./executiveIdentity.ts";
import { sendWhapiText, cleanPhoneForMention } from "./whapiSend.ts";
import { formatWhapiSuitesConversationLog, stripOutboundDispatchTag } from "./outboundDispatchTag.ts";
import { CLAUDE_MODEL } from "./guestBotModelRoute.ts";
import {
  GUEST_OPS_SLA_THRESHOLDS,
  buildGuestOpsSlaDeadline,
  guessGuestOpsSlaCategory,
  resolveGuestOpsDepartment,
} from "./automationSchedule.ts";
import { translateTextForFieldOps } from "./fieldOpsTranslation.ts";
import { SUITES_ROOM_SERVICE_GROUP_ID } from "./futureSuiteRoomServiceRouting.ts";
import { loadActiveGuestById, type ActiveGuestRow } from "./guestOutboundGuard.ts";
import { fetchResortBrief, israelTodayStr } from "./resortPulseStats.ts";

const EXECUTIVE_GEMINI_MODELS = ["gemini-2.5-flash", "gemini-2.0-flash"];
// 15s — voice notes already spent wall-clock on transcription before we
// reach the LLM; tool round-trips need headroom or we silently fall through
// and still risk a late Whapi webhook retry (see handleExecutiveVoiceMessage).
const GEMINI_FETCH_TIMEOUT_MS = 15000;

const EXECUTIVE_EMPTY_REPLY_FALLBACK =
  "קיבלתי — לא הצלחתי להרכיב תשובה ברורה כרגע. אפשר לחזור בקצרה בטקסט?";

/** Prefer the inbound Whapi chat_id (exact DM thread) over reconstructed digits. */
export function resolveExecutiveReplyTo(phone: string, chatId?: string | null): string {
  const chat = String(chatId ?? "").trim();
  if (chat.endsWith("@s.whatsapp.net") || chat.endsWith("@c.us")) return chat;
  return cleanPhoneForMention(phone);
}

async function _sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

/**
 * Deliver an executive DM reply via Whapi, then ALWAYS log to Inbox.
 * FAIL VISIBLE: send failures are prefixed with ⚠ in the logged row and
 * never reported as a successful send. Retries once; falls back from chat_id
 * to bare phone digits if the chat_id path fails.
 */
export async function deliverExecutiveDmReply(
  supabase: SupabaseClient,
  opts: { phone: string; chatId?: string | null; replyText: string },
): Promise<{ sent: boolean; wamid: string | null; error?: string }> {
  const body = String(opts.replyText ?? "").trim() || EXECUTIVE_EMPTY_REPLY_FALLBACK;
  const primaryTo = resolveExecutiveReplyTo(opts.phone, opts.chatId);
  const phoneTo = cleanPhoneForMention(opts.phone);
  const targets = primaryTo === phoneTo ? [primaryTo] : [primaryTo, phoneTo];

  let wamid: string | null = null;
  let lastErr: string | undefined;

  for (const to of targets) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        wamid = await sendWhapiText(to, body);
        lastErr = undefined;
        break;
      } catch (e) {
        lastErr = (e as Error).message;
        console.error(
          `[executiveAssistant] reply send failed to=${to} attempt=${attempt}:`,
          lastErr,
        );
        if (attempt < 2) await _sleep(800);
      }
    }
    if (!lastErr) break;
  }

  const sent = !lastErr;
  const inboxBody = sent
    ? formatWhapiSuitesConversationLog(body)
    : formatWhapiSuitesConversationLog(
      `⚠ שליחה נכשלה${lastErr ? ` (${lastErr.slice(0, 180)})` : ""}:\n${body}`,
    );

  const { error } = await supabase.from("whatsapp_conversations").insert({
    phone: opts.phone,
    guest_id: null,
    direction: "outbound",
    message: inboxBody,
    wa_message_id: wamid,
    inbox_channel: "whapi",
    channel: "whapi",
  });
  if (error) console.warn("[executiveAssistant] outbound log insert failed:", error.message);

  return sent ? { sent: true, wamid } : { sent: false, wamid: null, error: lastErr };
}

/** True when a successful Whapi outbound already exists after this inbound msg. */
export async function executiveAlreadyRepliedSuccessfully(
  supabase: SupabaseClient,
  phone: string,
  inboundWaMsgId: string,
): Promise<boolean> {
  const { data: inbound, error: inErr } = await supabase
    .from("whatsapp_conversations")
    .select("created_at")
    .eq("wa_message_id", inboundWaMsgId)
    .eq("direction", "inbound")
    .eq("inbox_channel", "whapi")
    .maybeSingle();
  if (inErr || !inbound?.created_at) return false;

  const { data: outbound, error: outErr } = await supabase
    .from("whatsapp_conversations")
    .select("id")
    .eq("phone", phone)
    .eq("direction", "outbound")
    .eq("inbox_channel", "whapi")
    .gt("created_at", inbound.created_at as string)
    .not("wa_message_id", "is", null)
    .limit(1)
    .maybeSingle();
  if (outErr) {
    console.warn("[executiveAssistant] executiveAlreadyRepliedSuccessfully lookup failed:", outErr.message);
    return false;
  }
  return !!outbound;
}

// ══════════════════════════════════════════════════════════════════════════════
// §0  Base persona (DB-editable — executive_bot_settings, migration 183).
// Same singleton-row pattern as bot_settings (guest bot) — see
// ExecutivePlaybook.js for the admin textarea. {{name}}/{{title}}/{{focus}}
// are the substitution tokens — {{focus}} (executiveIdentity.ts's
// ExecutiveProfile.focus) is what makes the one shared template read
// naturally for each authorized executive's actual role instead of a
// one-size-fits-all script. DEFAULT_PERSONA_TEMPLATE is the Graceful
// Fallback when the row is missing/empty (never crash into a blank prompt).
// ══════════════════════════════════════════════════════════════════════════════

const DEFAULT_PERSONA_TEMPLATE = `
את/ה העוזר/ת האישי/ת הדיגיטלי/ת של {{name}}, {{title}} ב-Dream Island. אתה מדבר איתו ישירות
בוואטסאפ (מכשיר הסוויטות) — זו לא שיחה עם אורח, זו שיחת ניהול פנימית.

{{focus}}

תפקידך: לבצע עבורו פעולות ניהוליות בפועל (פתיחת משימות, בדיקת מצב הריזורט, שליחת
הודעות לאורחים/למנהלים, עדכון פרטי אורח, לימוד העדפות קבועות) ולדווח לו בקצרה.

כללי תשובה (חובה):
• עברית בלבד, 2–4 משפטים לכל היותר. בלי פתיחים מיותרים ("שלום", "בשמחה").
• כשביצעת פעולה בפועל דרך אחד הכלים — פתח את השורה הרלוונטית ב-✅.
• כמה פעולות/עדכונים בתשובה אחת — כל אחת כשורת בולט (•) קצרה.
• אל תמציא נתונים על הריזורט או על אורחים — אם חסר לך מידע קרא לכלי המתאים
  (get_resort_brief / find_guest_by_room / list_guests_by_scope / query_open_tasks) לפני שאתה עונה.
• משפט כמו "תזכרי ש..." / "מעכשיו תמיד..." / "מהיום..." = קרא ל-learn_executive_rule
  כדי לשמור את זה כהעדפה קבועה שלך, אחרת תשכח אותה בפעם הבאה.
  זה חל גם על דוחות התפעול היומיים/שבועיים שאת שולחת לו — אם הוא מבקש לשנות
  משהו בדוח (מה להדגיש, מה להסיר), שמרי זאת ככלל ונציג את זה בדוחות הבאים.
• לעולם אל תשלח הודעה לאורח שסטטוסו 'cancelled' — הכלים חוסמים זאת; אם זה קרה ציין זאת.
• אם הבקשה לא ברורה מספיק לפעולה (לא ברור באיזה חדר/אורח/משימה מדובר) — שאל שאלת
  הבהרה קצרה אחת במקום לנחש.
• כל הודעה שאתה מקבל היא כבר טקסט רגיל — גם אם המשתמש שלח אותה בפועל כהקלטה קולית,
  היא כבר תומללה לטקסט לפני שהגיעה אליך, ואתה רואה רק את הטקסט המתומלל, בדיוק כמו
  הודעה מוקלדת. לעולם אל תגיד "אני לא מבינה הקלטות קוליות" או "אני לא מצליחה להבין
  את ההקלטה" — זה תמיד שגוי במערכת הזו; אתה מעולם לא מקבל אודיו גולמי, רק טקסט.
  אם השאלה עוסקת ביכולת שלך להבין הקלטות — פשוט ענה שכן, ותענה לתוכן שכתוב לך.
`.trim();

const PERSONA_TTL_MS = 5 * 60 * 1000;
let _personaCache: { template: string; at: number } | null = null;

export async function fetchExecutivePersonaTemplate(supabase: SupabaseClient): Promise<string> {
  const now = Date.now();
  if (_personaCache && now - _personaCache.at < PERSONA_TTL_MS) return _personaCache.template;

  const { data, error } = await supabase
    .from("executive_bot_settings")
    .select("persona_prompt")
    .eq("id", 1)
    .maybeSingle();
  if (error) {
    console.warn("[executiveAssistant] fetchExecutivePersonaTemplate failed:", error.message);
    return _personaCache?.template ?? DEFAULT_PERSONA_TEMPLATE;
  }
  const template = String((data as Record<string, unknown> | null)?.persona_prompt ?? "").trim() || DEFAULT_PERSONA_TEMPLATE;
  _personaCache = { template, at: now };
  return template;
}

// ══════════════════════════════════════════════════════════════════════════════
// §1  Learned rules (reuses xos_ai_rules, module='executive' — no new table)
// ══════════════════════════════════════════════════════════════════════════════

const RULES_TTL_MS = 5 * 60 * 1000;
let _rulesCache: { text: string; at: number } | null = null;

function _invalidateExecutiveRulesCache(): void {
  _rulesCache = null;
}

export async function fetchExecutiveRules(supabase: SupabaseClient): Promise<string> {
  const now = Date.now();
  if (_rulesCache && now - _rulesCache.at < RULES_TTL_MS) return _rulesCache.text;

  const { data, error } = await supabase
    .from("xos_ai_rules")
    .select("rule_text")
    .eq("module", "executive")
    .order("created_at", { ascending: true });
  if (error) {
    console.warn("[executiveAssistant] fetchExecutiveRules failed:", error.message);
    return _rulesCache?.text ?? "";
  }
  const bullets = ((data ?? []) as Array<{ rule_text: string }>)
    .map((r) => r.rule_text?.trim())
    .filter(Boolean)
    .map((t) => `- ${t}`);
  const text = bullets.length ? `\n\n══ כללים שנלמדו ══\n${bullets.join("\n")}` : "";
  _rulesCache = { text, at: now };
  return text;
}

// ══════════════════════════════════════════════════════════════════════════════
// §2  Conversation history (last 4 turns, [WHAPI] tag stripped)
// ══════════════════════════════════════════════════════════════════════════════

async function fetchExecutiveHistory(
  supabase: SupabaseClient,
  phone: string,
): Promise<Array<{ direction: string; message: string }>> {
  const { data, error } = await supabase
    .from("whatsapp_conversations")
    .select("direction, message, created_at")
    .eq("phone", phone)
    .eq("inbox_channel", "whapi")
    .order("created_at", { ascending: false })
    .limit(8);
  if (error) {
    console.warn("[executiveAssistant] fetchExecutiveHistory failed:", error.message);
    return [];
  }
  // The 🎤 prefix (whapi-webhook's Inbox display convention for a
  // transcribed voice note, see inboxText there) is Inbox-only — stripped
  // here for the same reason [WHAPI]/[META] tags are: left in, the model
  // sees several 🎤-prefixed turns in its own recent history and anchors on
  // that pattern, parroting "can't understand the recording" back even for
  // a freshly, successfully transcribed message (reproduced live — three
  // real voice notes in a row all transcribed fine but got that reply).
  return ((data ?? []) as Array<{ direction: string; message: string }>)
    .map((h) => ({ direction: h.direction, message: stripOutboundDispatchTag(h.message).replace(/^🎤\s*/, "") }))
    .reverse()
    .slice(-4);
}

// ══════════════════════════════════════════════════════════════════════════════
// §3  System prompt
// ══════════════════════════════════════════════════════════════════════════════

function buildExecutivePersona(profile: ExecutiveProfile, template: string): string {
  const title = profile.title || "מנהל";
  return template
    .replaceAll("{{name}}", profile.displayName)
    .replaceAll("{{title}}", title)
    .replaceAll("{{focus}}", profile.focus || "")
    .trim();
}

export function buildExecutiveSystemPrompt(
  profile: ExecutiveProfile,
  personaTemplate: string,
  rulesSuffix: string,
  briefSnapshot: string,
  recentTurns: Array<{ direction: string; message: string }>,
): string {
  const dateLine = `\n\nתאריך היום (ישראל): ${israelTodayStr()}`;
  const briefLine = briefSnapshot ? `\n\n══ מצב עדכני (לרענון: get_resort_brief) ══\n${briefSnapshot}` : "";
  const firstTurnNote = recentTurns.length === 0
    ? `\n\nזו הפנייה הראשונה של ${profile.displayName} בשיחה הזו — אפשר לפתוח בברכה קצרה אחת.`
    : "";
  return buildExecutivePersona(profile, personaTemplate) + dateLine + briefLine + rulesSuffix + firstTurnNote;
}

// ══════════════════════════════════════════════════════════════════════════════
// §4  Tools — one JSON schema per tool, shared verbatim between Gemini
// (functionDeclarations[].parameters) and Claude (tools[].input_schema) —
// same "one schema object, two callers" pattern whatsapp-webhook already uses
// for LOG_REQUEST_JSON_SCHEMA.
// ══════════════════════════════════════════════════════════════════════════════

type ToolDef = { name: string; description: string; schema: Record<string, unknown> };

const EXECUTIVE_TOOLS: ToolDef[] = [
  {
    name: "create_executive_task",
    description: "פתיחת משימת שטח/תחזוקה/משק ישירות ללוח התפעול, בסטטוס פתוח (ללא צורך באישור צוות).",
    schema: {
      type: "object",
      properties: {
        description: { type: "string", description: "תיאור המשימה בעברית, ברור ותמציתי." },
        room_number: { type: "string", description: "מספר/שם חדר או סוויטה, אם רלוונטי." },
        department: { type: "string", enum: ["תפעול", "משק", "קבלה/בקשות"], description: "מחלקה אחראית, אם ידוע." },
        priority: { type: "string", enum: ["normal", "urgent"], description: "דחיפות המשימה." },
        sla_category: { type: "string", enum: Object.keys(GUEST_OPS_SLA_THRESHOLDS), description: "קטגוריית SLA, אם ידוע." },
      },
      required: ["description"],
    },
  },
  {
    name: "get_resort_brief",
    description: "מצב הריזורט הנוכחי: הגעות היום, אורחים בריזורט, עוזבים, משימות פתוחות, התראות בתיבה.",
    schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "find_guest_by_room",
    description: "איתור פרופיל מלא של אורח פעיל לפי מספר/שם חדר או לפי שם — כולל תאריכים, הערות, ספא/ארוחות ודגלי תשומת-לב.",
    schema: {
      type: "object",
      properties: {
        room: { type: "string", description: "מספר/שם חדר או סוויטה, אם ידוע." },
        name: { type: "string", description: "שם האורח (מלא או חלקי), אם החדר לא ידוע." },
      },
      required: [],
    },
  },
  {
    name: "list_guests_by_scope",
    description: "רשימת אורחים (שם, חדר, סטטוס, שעת הגעה) לפי טווח: מגיעים היום / עוזבים היום / בריזורט כרגע. לשאלות כמו \"מי מגיע היום\".",
    schema: {
      type: "object",
      properties: {
        scope: { type: "string", enum: ["arriving_today", "departing_today", "in_resort_now"], description: "טווח האורחים המבוקש." },
      },
      required: ["scope"],
    },
  },
  {
    name: "ceo_guest_override",
    description: "עדכון הערה/החרגה ניהולית על פרופיל אורח (לא לצ'ק-אאוט/תאריכים — לכך יש כלים אחרים).",
    schema: {
      type: "object",
      properties: {
        guest_id: { type: "integer", description: "מזהה אורח, אם ידוע (עדיף על room)." },
        room: { type: "string", description: "חדר/סוויטה לאיתור האורח, אם guest_id לא ידוע." },
        override_type: { type: "string", description: "סוג ההחרגה, למשל vip_alert, dietary, special_request." },
        value: { type: "string", description: "התוכן/הערך של ההחרגה." },
        note: { type: "string", description: "הערה חופשית נוספת, אופציונלי." },
      },
      required: ["override_type", "value"],
    },
  },
  {
    name: "send_guest_message",
    description: "שליחת הודעת וואטסאפ חופשית לאורח (חסום אוטומטית לאורחים מבוטלים).",
    schema: {
      type: "object",
      properties: {
        guest_id: { type: "integer", description: "מזהה אורח, אם ידוע (עדיף על room)." },
        room: { type: "string", description: "חדר/סוויטה לאיתור האורח, אם guest_id לא ידוע." },
        message: { type: "string", description: "תוכן ההודעה בעברית שתישלח לאורח." },
      },
      required: ["message"],
    },
  },
  {
    name: "notify_managers_group",
    description: "שליחת הודעה לקבוצת המנהלות (מתורגמת אוטומטית לאנגלית).",
    schema: {
      type: "object",
      properties: { message_he: { type: "string", description: "תוכן ההודעה בעברית." } },
      required: ["message_he"],
    },
  },
  {
    name: "learn_executive_rule",
    description: "שמירת העדפה/כלל קבוע שהמנהל ביקש לזכור להבא.",
    schema: {
      type: "object",
      properties: { rule_text: { type: "string", description: "הכלל/ההעדפה לשמירה, בעברית, משפט אחד ברור." } },
      required: ["rule_text"],
    },
  },
  {
    name: "query_open_tasks",
    description: "סיכום משימות פתוחות/בטיפול/ממתינות לאישור בלוח התפעול.",
    schema: {
      type: "object",
      properties: {
        status_filter: { type: "string", enum: ["open", "in_progress", "pending_approval", "all"], description: "סינון לפי סטטוס, ברירת מחדל all." },
      },
      required: [],
    },
  },
];

// ══════════════════════════════════════════════════════════════════════════════
// §5  Tool executors — server-side gates the model cannot bypass.
// ══════════════════════════════════════════════════════════════════════════════

type ToolResult = Record<string, unknown> & { ok: boolean };
export type ToolExecCtx = { phone: string; originalText: string; msgId: string };

/** Widened row shape for the executive's own guest lookups — ActiveGuestRow
 * (guestOutboundGuard.ts) is deliberately narrow (outbound-eligibility gate
 * only); the executive assistant needs the full Golden Profile picture. */
type ExecutiveGuestDetail = ActiveGuestRow & {
  arrival_date?: string | null;
  departure_date?: string | null;
  arrival_time?: string | null;
  guest_profile?: Record<string, unknown> | null;
  guest_notes?: string | null;
  spa_time?: string | null;
  meal_time?: string | null;
  meal_location?: string | null;
  needs_callback?: boolean | null;
  requires_attention?: boolean | null;
  attention_reason?: string | null;
};

const EXECUTIVE_GUEST_DETAIL_SELECT =
  "id, phone, status, name, room, room_type, arrival_date, departure_date, arrival_time, " +
  "guest_profile, guest_notes, spa_time, meal_time, meal_location, needs_callback, requires_attention, attention_reason";

/** Best-effort active-guest lookup by guest_id (preferred), room, or name. */
async function _resolveExecutiveGuestTarget(
  supabase: SupabaseClient,
  args: { guest_id?: unknown; room?: unknown; name?: unknown },
): Promise<ExecutiveGuestDetail | null> {
  const guestId = Number(args.guest_id);
  if (Number.isFinite(guestId) && guestId > 0) {
    // loadActiveGuestById already applies the cancelled/checked_out filter
    // (isGuestActiveForOutbound) — reusing it here instead of a raw select
    // keeps that safety guarantee in one place. Its select is narrower than
    // EXECUTIVE_GUEST_DETAIL_SELECT, but none of this file's guest_id-based
    // callers (ceo_guest_override, send_guest_message) need the wider
    // fields — only the room/name path below (find_guest_by_room) does.
    return await loadActiveGuestById(supabase, guestId) as ExecutiveGuestDetail | null;
  }

  const room = String(args.room ?? "").trim();
  const name = String(args.name ?? "").trim();
  if (!room && !name) return null;

  // A room/name match can be >1 active booking (e.g. today's guest checks
  // out, the same room turns over to tomorrow's guest — completely normal
  // churn, reproduced live on a real room with both bookings simultaneously
  // active). Fetch a few candidates ordered soonest-first and prefer
  // whichever one is actually current (checked in, or today falls inside
  // [arrival_date, departure_date]) instead of just the furthest-future
  // match — "who's in this room" should mean today, not next week.
  const { data, error } = await supabase
    .from("guests")
    .select(EXECUTIVE_GUEST_DETAIL_SELECT)
    .not("status", "in", "(cancelled,checked_out)")
    .ilike(room ? "room" : "name", `%${room || name}%`)
    .order("arrival_date", { ascending: true, nullsFirst: false })
    .order("id", { ascending: false })
    .limit(5);
  if (error) {
    console.warn("[executiveAssistant] guest lookup (room/name) failed:", error.message);
    return null;
  }
  const candidates = (data ?? []) as unknown as ExecutiveGuestDetail[];
  if (!candidates.length) return null;

  const today = israelTodayStr();
  const current = candidates.find((g) =>
    g.status === "checked_in" ||
    (!!g.arrival_date && g.arrival_date <= today && (!g.departure_date || g.departure_date >= today)),
  );
  return current ?? candidates[0];
}

async function _execCreateExecutiveTask(
  supabase: SupabaseClient,
  args: Record<string, unknown>,
  ctx: ToolExecCtx,
): Promise<ToolResult> {
  const description = String(args.description ?? "").trim();
  if (!description) return { ok: false, error: "description_required" };

  const roomNumber = String(args.room_number ?? "").trim() || null;
  if (!roomNumber) {
    console.warn(`[executiveAssistant] create_executive_task with no room — desc:"${description.slice(0, 80)}"`);
  }

  const requestedSla = String(args.sla_category ?? "");
  const slaCategory = requestedSla in GUEST_OPS_SLA_THRESHOLDS ? requestedSla : guessGuestOpsSlaCategory(description);
  const department = String(args.department ?? "").trim() || resolveGuestOpsDepartment(description);
  const priority = args.priority === "urgent" || slaCategory === "pest_control" ? "urgent" : "normal";
  const slaDeadline = buildGuestOpsSlaDeadline(slaCategory, new Date());

  const { data: task, error } = await supabase
    .from("tasks")
    .insert([{
      room_number: roomNumber,
      department,
      description,
      priority,
      status: "open",
      source: "executive_voice",
      reporter_raw_text: ctx.originalText,
      source_message_id: ctx.msgId,
      action_token: crypto.randomUUID(),
      sla_category: slaCategory,
      sla_deadline: slaDeadline,
    }])
    .select("id")
    .maybeSingle();

  if (error || !task) {
    console.error("[executiveAssistant] create_executive_task insert failed:", error?.message);
    return { ok: false, error: error?.message ?? "insert_failed" };
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (supabaseUrl && serviceKey) {
    fetch(`${supabaseUrl}/functions/v1/notify-manual-task`, {
      method: "POST",
      headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: task.id }),
    }).catch((e) => console.warn("[executiveAssistant] notify-manual-task dispatch failed:", (e as Error).message));
  }

  return { ok: true, task_id: task.id, department, sla_category: slaCategory, room_number: roomNumber };
}

async function _execGetResortBrief(supabase: SupabaseClient): Promise<ToolResult> {
  const brief = await fetchResortBrief(supabase);
  return { ok: true, brief };
}

async function _execFindGuestByRoom(supabase: SupabaseClient, args: Record<string, unknown>): Promise<ToolResult> {
  if (!args.room && !args.name) return { ok: false, error: "room_or_name_required" };
  const guest = await _resolveExecutiveGuestTarget(supabase, { room: args.room, name: args.name });
  if (!guest) return { ok: false, error: "no_guest_found" };
  const guestProfile = (guest.guest_profile as Record<string, unknown> | null) ?? {};
  return {
    ok: true,
    guest_id: guest.id,
    name: guest.name ?? null,
    phone: guest.phone,
    room: guest.room ?? null,
    room_type: guest.room_type ?? null,
    status: guest.status,
    arrival_date: guest.arrival_date ?? null,
    departure_date: guest.departure_date ?? null,
    arrival_time: guest.arrival_time ?? null,
    guest_notes: guest.guest_notes ?? null,
    guest_profile: Object.keys(guestProfile).length ? guestProfile : null,
    spa_time: guest.spa_time ?? null,
    meal_time: guest.meal_time ?? null,
    meal_location: guest.meal_location ?? null,
    needs_callback: guest.needs_callback ?? false,
    requires_attention: guest.requires_attention ?? false,
    attention_reason: guest.attention_reason ?? null,
  };
}

const LIST_GUESTS_SCOPE_LABEL_HE: Record<string, string> = {
  arriving_today: "מגיעים היום",
  departing_today: "עוזבים היום",
  in_resort_now: "בריזורט כרגע",
};

async function _execListGuestsByScope(supabase: SupabaseClient, args: Record<string, unknown>): Promise<ToolResult> {
  const scope = String(args.scope ?? "");
  if (!(scope in LIST_GUESTS_SCOPE_LABEL_HE)) return { ok: false, error: "invalid_scope" };

  const today = israelTodayStr();
  let query = supabase
    .from("guests")
    .select("id, name, room, room_type, status, arrival_date, departure_date, arrival_time")
    .not("status", "eq", "cancelled");

  if (scope === "arriving_today") query = query.eq("arrival_date", today);
  else if (scope === "departing_today") query = query.eq("departure_date", today).neq("status", "checked_out");
  else query = query.lte("arrival_date", today).or(`departure_date.gte.${today},departure_date.is.null`);

  const { data, error } = await query.order("room", { ascending: true }).limit(30);
  if (error) {
    console.warn("[executiveAssistant] list_guests_by_scope failed:", error.message);
    return { ok: false, error: error.message };
  }

  const rows = (data ?? []) as Array<{ name: string | null; room: string | null; room_type: string | null; status: string; arrival_time: string | null }>;
  if (!rows.length) return { ok: true, count: 0, scope, summary: `אין אורחים ב${LIST_GUESTS_SCOPE_LABEL_HE[scope]} כרגע.` };

  const lines = rows.map((g) =>
    `• ${g.name ?? "ללא שם"} — ${g.room ?? "ללא חדר"}${g.arrival_time ? ` (${g.arrival_time})` : ""} [${g.status}]`,
  );
  return { ok: true, count: rows.length, scope, summary: lines.join("\n") };
}

async function _execCeoGuestOverride(supabase: SupabaseClient, args: Record<string, unknown>): Promise<ToolResult> {
  const overrideType = String(args.override_type ?? "").trim();
  const value = String(args.value ?? "").trim();
  if (!overrideType || !value) return { ok: false, error: "override_type_and_value_required" };
  if (!args.guest_id && !args.room) return { ok: false, error: "guest_id_or_room_required" };

  const guest = await _resolveExecutiveGuestTarget(supabase, args);
  if (!guest) return { ok: false, error: "guest_not_found_or_inactive" };

  const { data: fullGuest } = await supabase
    .from("guests")
    .select("guest_profile, guest_notes")
    .eq("id", guest.id)
    .maybeSingle();
  const guestProfile = (fullGuest?.guest_profile as Record<string, unknown>) ?? {};
  const ceoOverrides = (guestProfile.ceo_overrides as Record<string, unknown>) ?? {};
  const mergedProfile = { ...guestProfile, ceo_overrides: { ...ceoOverrides, [overrideType]: value } };

  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  const note = String(args.note ?? "").trim();
  const noteLine = `[${stamp}] CEO override (${overrideType}): ${value}${note ? ` — ${note}` : ""}`;
  const newNotes = fullGuest?.guest_notes ? `${fullGuest.guest_notes}\n${noteLine}` : noteLine;

  const { error } = await supabase
    .from("guests")
    .update({ guest_profile: mergedProfile, guest_notes: newNotes })
    .eq("id", guest.id);
  if (error) {
    console.error("[executiveAssistant] ceo_guest_override update failed:", error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true, guest_id: guest.id, guest_name: guest.name ?? null, override_type: overrideType };
}

async function _execSendGuestMessage(supabase: SupabaseClient, args: Record<string, unknown>): Promise<ToolResult> {
  const message = String(args.message ?? "").trim();
  if (!message) return { ok: false, error: "message_required" };
  if (!args.guest_id && !args.room) return { ok: false, error: "guest_id_or_room_required" };

  const guest = await _resolveExecutiveGuestTarget(supabase, args);
  if (!guest) return { ok: false, error: "guest_not_found_or_inactive" };
  if (!guest.phone) return { ok: false, error: "guest_no_phone" };

  let wamid: string | null = null;
  try {
    wamid = await sendWhapiText(cleanPhoneForMention(guest.phone), message);
  } catch (e) {
    console.error("[executiveAssistant] send_guest_message failed:", (e as Error).message);
    return { ok: false, error: (e as Error).message };
  }

  const { error } = await supabase.from("whatsapp_conversations").insert({
    phone: guest.phone,
    guest_id: guest.id,
    direction: "outbound",
    message: formatWhapiSuitesConversationLog(message),
    wa_message_id: wamid,
    inbox_channel: "whapi",
    channel: "whapi",
  });
  if (error) console.warn("[executiveAssistant] send_guest_message log insert failed:", error.message);

  return { ok: true, guest_id: guest.id, sent: true };
}

async function _execNotifyManagersGroup(args: Record<string, unknown>): Promise<ToolResult> {
  const messageHe = String(args.message_he ?? "").trim();
  if (!messageHe) return { ok: false, error: "message_he_required" };
  const english = await translateTextForFieldOps(messageHe, { style: "description_only" });
  try {
    await sendWhapiText(SUITES_ROOM_SERVICE_GROUP_ID, english);
  } catch (e) {
    console.error("[executiveAssistant] notify_managers_group failed:", (e as Error).message);
    return { ok: false, error: (e as Error).message };
  }
  return { ok: true, sent: true };
}

async function _execLearnExecutiveRule(supabase: SupabaseClient, args: Record<string, unknown>): Promise<ToolResult> {
  const ruleText = String(args.rule_text ?? "").trim();
  if (!ruleText) return { ok: false, error: "rule_text_required" };

  const { data: existing } = await supabase
    .from("xos_ai_rules")
    .select("rule_text")
    .eq("module", "executive");
  const normalized = ruleText.trim().toLowerCase();
  const isDupe = ((existing ?? []) as Array<{ rule_text: string }>).some(
    (r) => (r.rule_text ?? "").trim().toLowerCase() === normalized,
  );
  if (isDupe) return { ok: true, deduped: true };

  const { error } = await supabase.from("xos_ai_rules").insert({ module: "executive", rule_text: ruleText });
  if (error) {
    console.error("[executiveAssistant] learn_executive_rule insert failed:", error.message);
    return { ok: false, error: error.message };
  }
  _invalidateExecutiveRulesCache();
  return { ok: true, inserted: true };
}

const OPEN_TASK_STATUSES = ["open", "in_progress", "pending_approval"] as const;
const TASK_STATUS_LABEL_HE: Record<string, string> = {
  open: "פתוח",
  in_progress: "בטיפול",
  pending_approval: "ממתין לאישור",
};

async function _execQueryOpenTasks(supabase: SupabaseClient, args: Record<string, unknown>): Promise<ToolResult> {
  const filter = String(args.status_filter ?? "all");
  const statuses = filter === "all" || !OPEN_TASK_STATUSES.includes(filter as typeof OPEN_TASK_STATUSES[number])
    ? [...OPEN_TASK_STATUSES]
    : [filter];

  const { data, error } = await supabase
    .from("tasks")
    .select("room_number, description, department, status, sla_deadline")
    .in("status", statuses)
    .order("created_at", { ascending: true })
    .limit(10);
  if (error) {
    console.warn("[executiveAssistant] query_open_tasks failed:", error.message);
    return { ok: false, error: error.message };
  }

  const rows = (data ?? []) as Array<{ room_number: string | null; description: string; department: string; status: string; sla_deadline: string | null }>;
  if (!rows.length) return { ok: true, count: 0, summary: "אין משימות פתוחות כרגע." };

  const lines = rows.map((t) =>
    `• ${t.room_number ? `[${t.room_number}] ` : ""}${t.description} (${t.department}, ${TASK_STATUS_LABEL_HE[t.status] ?? t.status})`,
  );
  return { ok: true, count: rows.length, summary: lines.join("\n") };
}

/** Exported for executiveAssistant.test.ts — the tool dispatcher is the unit
 * under test for the per-tool server-side gates (description required, dedupe,
 * cancelled-guest block); it's not part of the public orchestration API. */
export async function executeExecutiveTool(
  supabase: SupabaseClient,
  name: string,
  args: Record<string, unknown>,
  ctx: ToolExecCtx,
): Promise<ToolResult> {
  switch (name) {
    case "create_executive_task": return await _execCreateExecutiveTask(supabase, args, ctx);
    case "get_resort_brief": return await _execGetResortBrief(supabase);
    case "find_guest_by_room": return await _execFindGuestByRoom(supabase, args);
    case "list_guests_by_scope": return await _execListGuestsByScope(supabase, args);
    case "ceo_guest_override": return await _execCeoGuestOverride(supabase, args);
    case "send_guest_message": return await _execSendGuestMessage(supabase, args);
    case "notify_managers_group": return await _execNotifyManagersGroup(args);
    case "learn_executive_rule": return await _execLearnExecutiveRule(supabase, args);
    case "query_open_tasks": return await _execQueryOpenTasks(supabase, args);
    default: return { ok: false, error: `unknown_tool:${name}` };
  }
}

type ToolCallReq = { name: string; args: Record<string, unknown>; id?: string };
type ToolCallOut = ToolCallReq & { result: ToolResult };

async function runExecutiveToolCalls(
  supabase: SupabaseClient,
  calls: ToolCallReq[],
  ctx: ToolExecCtx,
): Promise<ToolCallOut[]> {
  const out: ToolCallOut[] = [];
  for (const call of calls) {
    let result: ToolResult;
    try {
      result = await executeExecutiveTool(supabase, call.name, call.args, ctx);
    } catch (e) {
      result = { ok: false, error: (e as Error).message };
    }
    console.info(`[executiveAssistant] 🔧 ${call.name}`, JSON.stringify(call.args), "→", JSON.stringify(result));
    supabase
      .from("executive_action_log")
      .insert({ phone: ctx.phone, tool_name: call.name, args_json: call.args, result_json: result })
      .then(({ error }: { error: { message: string } | null }) => {
        if (error) console.warn("[executiveAssistant] executive_action_log insert failed:", error.message);
      });
    out.push({ ...call, result });
  }
  return out;
}

// ══════════════════════════════════════════════════════════════════════════════
// §6  Gemini primary — function calling, max 2 rounds.
// ══════════════════════════════════════════════════════════════════════════════

const GEMINI_TOOLS_PAYLOAD = [{
  functionDeclarations: EXECUTIVE_TOOLS.map((t) => ({ name: t.name, description: t.description, parameters: t.schema })),
}];

function _historyToGeminiTurns(history: Array<{ direction: string; message: string }>) {
  return history.map((h) => ({ role: h.direction === "inbound" ? "user" : "model", parts: [{ text: h.message }] }));
}

type GeminiPart = Record<string, unknown>;

function _extractGeminiParts(data: Record<string, unknown>): { text: string; functionCalls: Array<{ name: string; args: Record<string, unknown> }>; rawParts: GeminiPart[] } {
  const candidates = data?.candidates as Array<Record<string, unknown>> | undefined;
  const content = candidates?.[0]?.content as Record<string, unknown> | undefined;
  const rawParts = (content?.parts ?? []) as GeminiPart[];
  const text = rawParts
    .filter((p) => !p.thought && typeof p.text === "string" && String(p.text).trim())
    .map((p) => String(p.text).trim())
    .join("\n")
    .trim();
  const functionCalls = rawParts
    .filter((p) => p.functionCall)
    .map((p) => {
      const fc = p.functionCall as Record<string, unknown>;
      return { name: String(fc.name ?? ""), args: (fc.args as Record<string, unknown>) ?? {} };
    });
  return { text, functionCalls, rawParts };
}

async function _geminiCall(apiKey: string, model: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(GEMINI_FETCH_TIMEOUT_MS),
    },
  );
  if (!res.ok) throw new Error(`gemini_${res.status}: ${(await res.text()).slice(0, 300)}`);
  return await res.json();
}

async function runExecutiveGemini(
  supabase: SupabaseClient,
  systemPrompt: string,
  history: Array<{ direction: string; message: string }>,
  userMessage: string,
  ctx: ToolExecCtx,
): Promise<{ text: string; toolCalls: ToolCallOut[] } | null> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) return null;

  const contents = [..._historyToGeminiTurns(history), { role: "user", parts: [{ text: userMessage }] }];
  const baseBody = {
    contents,
    systemInstruction: { parts: [{ text: systemPrompt }] },
    generationConfig: { maxOutputTokens: 800, temperature: 0.4, candidateCount: 1 },
  };

  for (const model of EXECUTIVE_GEMINI_MODELS) {
    let round1: Record<string, unknown>;
    try {
      round1 = await _geminiCall(apiKey, model, { ...baseBody, tools: GEMINI_TOOLS_PAYLOAD });
    } catch (e) {
      console.warn(`[executiveAssistant] Gemini round1 model="${model}" failed:`, (e as Error).message);
      continue;
    }

    const parsed1 = _extractGeminiParts(round1);
    if (!parsed1.functionCalls.length) {
      if (!parsed1.text) continue;
      return { text: parsed1.text, toolCalls: [] };
    }

    const toolCalls = await runExecutiveToolCalls(supabase, parsed1.functionCalls, ctx);

    // Round 2 — feed function results back, tools omitted so the model can
    // only compose the final Hebrew reply (caps this loop at 2 rounds total).
    const round2Contents = [
      ...contents,
      { role: "model", parts: parsed1.rawParts },
      {
        role: "user",
        parts: toolCalls.map((c) => ({ functionResponse: { name: c.name, response: c.result } })),
      },
    ];

    try {
      const round2 = await _geminiCall(apiKey, model, { ...baseBody, contents: round2Contents });
      const parsed2 = _extractGeminiParts(round2);
      if (parsed2.text) return { text: parsed2.text, toolCalls };
    } catch (e) {
      console.warn(`[executiveAssistant] Gemini round2 model="${model}" failed:`, (e as Error).message);
    }

    // Round 2 produced no text (rare) — fall back to a mechanical summary
    // rather than losing a real, already-executed action (FAIL VISIBLE).
    return { text: _buildToolFallbackSummary(toolCalls), toolCalls };
  }

  return null;
}

function _buildToolFallbackSummary(toolCalls: ToolCallOut[]): string {
  if (!toolCalls.length) return "בוצע.";
  return toolCalls
    .map((c) => (c.result.ok ? `✅ ${c.name} בוצע.` : `⚠️ ${c.name} נכשל: ${c.result.error ?? "שגיאה"}`))
    .join("\n");
}

// ══════════════════════════════════════════════════════════════════════════════
// §7  Claude Sonnet 4.6 fallback — same 2-round tool-call contract.
// ══════════════════════════════════════════════════════════════════════════════

const CLAUDE_TOOLS_PAYLOAD = EXECUTIVE_TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema }));

async function runExecutiveClaude(
  supabase: SupabaseClient,
  systemPrompt: string,
  history: Array<{ direction: string; message: string }>,
  userMessage: string,
  ctx: ToolExecCtx,
): Promise<{ text: string; toolCalls: ToolCallOut[] }> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("no_anthropic_key");
  const anthropic = new Anthropic({ apiKey: key });

  // Claude requires strict user/assistant alternation — merge consecutive
  // same-role turns, same fix whatsapp-webhook's callClaude already applies.
  const rawMessages: Array<{ role: "user" | "assistant"; content: string }> = [
    ...history.map((h) => ({ role: (h.direction === "inbound" ? "user" : "assistant") as "user" | "assistant", content: h.message })),
    { role: "user" as const, content: userMessage },
  ];
  const messages: Array<{ role: "user" | "assistant"; content: unknown }> = rawMessages.reduce<
    Array<{ role: "user" | "assistant"; content: string }>
  >((acc, msg) => {
    if (acc.length && acc[acc.length - 1].role === msg.role) {
      acc[acc.length - 1] = { ...acc[acc.length - 1], content: acc[acc.length - 1].content + "\n" + msg.content };
    } else {
      acc.push(msg);
    }
    return acc;
  }, []);

  const resp1 = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 800,
    system: systemPrompt,
    messages,
    tools: CLAUDE_TOOLS_PAYLOAD,
    tool_choice: { type: "auto" },
  } as any);

  const blocks1 = resp1.content as unknown as Array<Record<string, unknown>>;
  const text1 = blocks1.filter((b) => b.type === "text").map((b) => String(b.text ?? "").trim()).filter(Boolean).join("\n");
  const toolUseBlocks = blocks1.filter((b) => b.type === "tool_use");

  if (!toolUseBlocks.length) {
    if (!text1) throw new Error("claude_empty_response");
    return { text: text1, toolCalls: [] };
  }

  const calls: ToolCallReq[] = toolUseBlocks.map((b) => ({
    name: String(b.name),
    args: (b.input as Record<string, unknown>) ?? {},
    id: String(b.id),
  }));
  const toolCalls = await runExecutiveToolCalls(supabase, calls, ctx);

  const messages2 = [
    ...messages,
    { role: "assistant" as const, content: blocks1 },
    {
      role: "user" as const,
      content: toolCalls.map((c) => ({ type: "tool_result", tool_use_id: c.id, content: JSON.stringify(c.result) })),
    },
  ];

  try {
    const resp2 = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 800,
      system: systemPrompt,
      messages: messages2,
    } as any);
    const blocks2 = resp2.content as unknown as Array<Record<string, unknown>>;
    const text2 = blocks2.filter((b) => b.type === "text").map((b) => String(b.text ?? "").trim()).filter(Boolean).join("\n");
    if (text2) return { text: text2, toolCalls };
  } catch (e) {
    console.warn("[executiveAssistant] Claude round2 failed:", (e as Error).message);
  }

  return { text: _buildToolFallbackSummary(toolCalls), toolCalls };
}

// ══════════════════════════════════════════════════════════════════════════════
// §8  Orchestrator
// ══════════════════════════════════════════════════════════════════════════════

export async function runExecutiveAssistant(
  supabase: SupabaseClient,
  opts: { phone: string; text: string; msgId: string; profile: ExecutiveProfile },
): Promise<string> {
  const ctx: ToolExecCtx = { phone: opts.phone, originalText: opts.text, msgId: opts.msgId };
  const [personaTemplate, rulesSuffix, brief, history] = await Promise.all([
    fetchExecutivePersonaTemplate(supabase),
    fetchExecutiveRules(supabase),
    fetchResortBrief(supabase),
    fetchExecutiveHistory(supabase, opts.phone),
  ]);
  const systemPrompt = buildExecutiveSystemPrompt(opts.profile, personaTemplate, rulesSuffix, brief, history);

  try {
    const geminiResult = await runExecutiveGemini(supabase, systemPrompt, history, opts.text, ctx);
    if (geminiResult) return geminiResult.text;
    console.warn("[executiveAssistant] all Gemini models unavailable — falling back to Claude");
  } catch (e) {
    console.error("[executiveAssistant] Gemini path errored — falling back to Claude:", (e as Error).message);
  }

  const claudeResult = await runExecutiveClaude(supabase, systemPrompt, history, opts.text, ctx);
  return claudeResult.text;
}

// ══════════════════════════════════════════════════════════════════════════════
// §9  Top-level entry point — called from whapi-webhook's guest_dm loop.
// ══════════════════════════════════════════════════════════════════════════════

export async function handleExecutiveVoiceMessage(
  supabase: SupabaseClient,
  opts: {
    phone: string;
    text: string;
    fromVoice: boolean;
    conversationId: number | null;
    msgId: string;
    /** Inbound Whapi chat_id — preferred send target over reconstructed digits. */
    chatId?: string | null;
    /**
     * Whapi webhook retry after a slow voice/LLM path: inbound already claimed
     * by the first attempt. Re-enter only when no successful outbound exists yet.
     */
    unclaimedRetry?: boolean;
  },
  results: Array<Record<string, unknown>>,
): Promise<void> {
  const base = {
    id: opts.msgId,
    channel: "executive_dm",
    phone: opts.phone,
    fromVoice: opts.fromVoice,
    unclaimedRetry: !!opts.unclaimedRetry,
  };
  try {
    const profile = await resolveExecutiveInbound(opts.phone, supabase);
    if (!profile) {
      results.push({ ...base, error: "executive_not_authorized" });
      return;
    }

    if (opts.unclaimedRetry) {
      if (await executiveAlreadyRepliedSuccessfully(supabase, opts.phone, opts.msgId)) {
        results.push({ ...base, action: "executive_reply_already_sent" });
        return;
      }
      console.warn(
        `[executiveAssistant] unclaimed retry — no successful outbound yet for ${opts.msgId}; re-running`,
      );
    }

    const replyText = await runExecutiveAssistant(supabase, {
      phone: opts.phone,
      text: opts.text,
      msgId: opts.msgId,
      profile,
    });

    const delivery = await deliverExecutiveDmReply(supabase, {
      phone: opts.phone,
      chatId: opts.chatId,
      replyText,
    });

    if (delivery.sent) {
      results.push({ ...base, action: "executive_reply_sent", wamid: delivery.wamid });
    } else {
      results.push({
        ...base,
        action: "executive_reply_send_failed",
        error: delivery.error ?? "send_failed",
      });
    }
  } catch (e) {
    console.error("[executiveAssistant] handleExecutiveVoiceMessage failed:", (e as Error).message);
    results.push({ ...base, error: "executive_handler_failed", detail: (e as Error).message });
  }
}

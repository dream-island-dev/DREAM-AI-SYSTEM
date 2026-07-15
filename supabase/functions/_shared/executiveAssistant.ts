// supabase/functions/_shared/executiveAssistant.ts
// XOS Executive Voice Assistant (Eliad Co-Pilot) — Phase 2.
// CEO-only secretary living inside the Whapi Suites device DM pipeline.
// Gemini 2.5 Flash primary (function calling) + Claude Sonnet 4.6 fallback.
// Learning reuses xos_ai_rules (module='executive') — no parallel playbook table.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.20.0";
import {
  resolveStaffAssistantInbound,
  type ExecutiveProfile,
  type AssistantTier,
  ARCHITECT_PHONE_DIGITS,
  CEO_PHONE_DIGITS,
  FRONT_DESK_PHONE_DIGITS,
  normalizeExecutivePhoneDigits,
  resolveAssistantTier,
} from "./executiveIdentity.ts";
import {
  primeGuestChannelConfig,
  getWhapiDeviceStatusSnapshot,
  getGuestSuitesChannel,
  getGuestDaypassChannel,
} from "./guestWhapiRouting.ts";
import { sendWhapiText, cleanPhoneForMention } from "./whapiSend.ts";
import { formatWhapiSuitesConversationLog, stripOutboundDispatchTag } from "./outboundDispatchTag.ts";
import { CLAUDE_MODEL } from "./guestBotModelRoute.ts";
import {
  GUEST_OPS_SLA_THRESHOLDS,
  ISRAEL_UTC_OFFSET_HOURS,
  buildGuestOpsSlaDeadline,
  guessGuestOpsSlaCategory,
  resolveGuestOpsDepartment,
} from "./automationSchedule.ts";
import { translateTextForFieldOps } from "./fieldOpsTranslation.ts";
import { SUITES_ROOM_SERVICE_GROUP_ID } from "./futureSuiteRoomServiceRouting.ts";
import { loadActiveGuestById, type ActiveGuestRow } from "./guestOutboundGuard.ts";
import { buildStaffAppDeepLink, phoneDigitsForDeepLink } from "./guestAlertWhapiNotify.ts";
import { fetchResortBrief, israelTodayStr, addDaysYmd } from "./resortPulseStats.ts";
import { isEffectiveSuiteGuest } from "./suiteNames.ts";
import {
  composeResortDigestMessage,
  computeResortDigestStats,
  filterDigestRelevantRules,
  resolveDigestRange,
  type DigestGuestRow,
  type DigestPeriod,
  type DigestTaskRow,
} from "./resortDigestStats.ts";

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
אני העוזרת האישית של {{name}}, {{title}} ב-Dream Island.
אני מדברת איתו ישירות בוואטסאפ (מכשיר הסוויטות) — שיחה פנימית עם {{name}}, לא עם אורח.

{{focus}}

תפקידי: לבצע עבורו פעולות ניהוליות בפועל ולדווח לו בקצרה.

מה אני עושה ישירות (דרך כלי, בלי לשאול רשות):
• מצב הריזורט / דוח תפעולי מיידי (יומי/שבועי/חודשי) / רשימת הגעות-עוזבים-אורחים בריזורט.
• רשימת אורחים לפי תאריך — היום, מחר, או כל תאריך עתידי/עבר (list_guests_by_date).
• איתור אורח לפי חדר/שם, כולל הערות, ספא/ארוחות ודגלי תשומת-לב.
• לוח הבקשות (תלונות/ספא/שינוי תאריך/חיוב) ומצב חדרים תפעולי (פנוי/ניקיון/תחזוקה).
• פתיחת משימת שטח, אישור ושיגור משימה ממתינה לצוות, סימון בטיפול/בוצעה/דחייה.
• סימון "חדר מוכן" לאורח (כולל שליחת ההודעה לאורח בפועל, ביום ההגעה, סוויטות בלבד).
• שליחת הודעה חופשית לאורח או לקבוצת המנהלות; עדכון הערה/החרגה על פרופיל אורח.
• לימוד העדפה קבועה שלך (learn_executive_rule) — פרטית לך, לא משפיעה על עוזר אחר.

מתי אני שואלת שאלת הבהרה אחת (ולא מנחשת):
• לא ברור באיזה חדר/אורח/משימה מדובר, או כלי החזיר כמה מועמדים מתאימים.

מה אני תמיד מסרבת לעשות (אין לזה כלי):
• ביטול אורח, שינוי תאריכים בפועל, מחירים, אוטומציות או מחיקת דאטה — «לזה צריך מסך הניהול».

כללי תשובה (חובה):
• עברית בלבד, 2–4 משפטים. פני אליו ישירות («{{name}}, …» / «עבורך…») — את עוזרתו האישית, לא בוט כללי.
• בלי פתיחים מיותרים («שלום», «בשמחה»).
• כשביצעתי פעולה בפועל דרך כלי — פותחת את השורה ב-✅.
• כמה עדכונים — כל אחד בשורת • קצרה.
• אל תמציאי נתונים — אם חסר מידע, קראי לכלי לפני שאת עונה.
• לשאלות על "מחר" / "ביום X" / תאריך עתידי — חשב את התאריך (ישראל) וקרא ל-list_guests_by_date;
  לעולם אל תגיד שאין לך אפשרות לבדוק ימים עתידיים.
• משפט כמו "תזכרי ש..." / "מעכשיו תמיד..." / "מהיום..." = קרא ל-learn_executive_rule
  כדי לשמור את זה כהעדפה קבועה שלך, אחרת תשכח אותה בפעם הבאה.
  זה חל גם על דוחות התפעול היומיים/שבועיים שאת שולחת לו — אם הוא מבקש לשנות
  משהו בדוח (מה להדגיש, מה להסיר), שמרי זאת ככלל ונציג את זה בדוחות הבאים.
• לעולם אל תשלחי הודעה לאורח שסטטוסו cancelled — הכלים חוסמים זאת.
• אם הבקשה לא ברורה — שאלי שאלת הבהרה קצרה אחת.
• הודעות קוליות מגיעות כבר כטקסט מתומלל — לעולם אל תגידי «לא מבינה הקלטות».
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
// Keyed by owner phone digits — Eliad and Mike must never see each other's
// private rules cached under the same slot (see fetchExecutiveRules).
const _rulesCache = new Map<string, { text: string; at: number }>();

function _invalidateExecutiveRulesCache(phoneDigits?: string, module?: string): void {
  if (!phoneDigits) {
    _rulesCache.clear();
    return;
  }
  if (module) _rulesCache.delete(`${phoneDigits}:${module}`);
  else {
    _rulesCache.delete(`${phoneDigits}:executive`);
    _rulesCache.delete(`${phoneDigits}:front_desk`);
  }
}

/**
 * Rules visible to this executive: unscoped/shared (owner_phone IS NULL — every
 * rule learned before migration 188, Graceful Fallback) plus this phone's own
 * private rules. Prevents Mike's QA-directed rules ("explain technically when I
 * ask") from bleeding into Eliad's CEO persona and vice versa (docs/active_sprint.md
 * audit finding). Digest-content rules stay intentionally unscoped — see
 * get_ops_digest_now / resort-digest-cron, which read module='executive' without
 * this filter since there's only one digest recipient regardless of who taught it.
 */
export async function fetchExecutiveRules(
  supabase: SupabaseClient,
  phoneDigits: string,
  module: "executive" | "front_desk" = "executive",
): Promise<string> {
  const now = Date.now();
  const cacheKey = `${phoneDigits}:${module}`;
  const cached = _rulesCache.get(cacheKey);
  if (cached && now - cached.at < RULES_TTL_MS) return cached.text;

  const { data, error } = await supabase
    .from("xos_ai_rules")
    .select("rule_text")
    .eq("module", module)
    .or(`owner_phone.is.null,owner_phone.eq.${phoneDigits}`)
    .order("created_at", { ascending: true });
  if (error) {
    console.warn("[executiveAssistant] fetchExecutiveRules failed:", error.message);
    return cached?.text ?? "";
  }
  const bullets = ((data ?? []) as Array<{ rule_text: string }>)
    .map((r) => r.rule_text?.trim())
    .filter(Boolean)
    .map((t) => `- ${t}`);
  const text = bullets.length ? `\n\n══ כללים שנלמדו ══\n${bullets.join("\n")}` : "";
  _rulesCache.set(cacheKey, { text, at: now });
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
  const dateLine = `\n\nתאריך היום (ישראל): ${israelTodayStr()} | מחר: ${addDaysYmd(israelTodayStr(), 1)}`;
  const briefLine = briefSnapshot ? `\n\n══ מצב עדכני (לרענון: get_resort_brief) ══\n${briefSnapshot}` : "";
  const firstTurnNote = recentTurns.length === 0
    ? `\n\nזו הפנייה הראשונה של ${profile.displayName} בשיחה הזו — פתחי בקצרה: הזכירי שאת העוזרת האישית שלו, והציעי מה אפשר לבקש (ראי סעיף ההכוונה).`
    : "";
  const overlayLine = profile.personaOverlay?.trim()
    ? `\n\n${profile.personaOverlay.trim()}`
    : "";
  return buildExecutivePersona(profile, personaTemplate) + dateLine + briefLine + rulesSuffix + overlayLine + firstTurnNote;
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
    description: "רשימת אורחים (שם, חדר, סטטוס, שעת הגעה) לפי טווח של היום בלבד: מגיעים היום / עוזבים היום / בריזורט כרגע. לשאלות כמו \"מי מגיע היום\".",
    schema: {
      type: "object",
      properties: {
        scope: { type: "string", enum: ["arriving_today", "departing_today", "in_resort_now"], description: "טווח האורחים המבוקש." },
      },
      required: ["scope"],
    },
  },
  {
    name: "list_guests_by_date",
    description:
      "רשימת אורחים לפי תאריך ספציפי (YYYY-MM-DD, ישראל) — מגיעים / עוזבים / בבית באותו יום. " +
      "לשאלות כמו \"מי מגיע מחר\", \"מי עוזב ביום ראשון\", \"מי יהיה בריזורט ב-20/7\". " +
      "למחר: arrival_date = תאריך מחר.",
    schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "תאריך בפורמט YYYY-MM-DD (לוח שנה ישראל)." },
        mode: {
          type: "string",
          enum: ["arriving", "departing", "in_house"],
          description: "arriving=מגיעים באותו יום, departing=עוזבים, in_house=נמצאים בריזורט באותו יום.",
        },
      },
      required: ["date", "mode"],
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
    description: "סיכום משימות פתוחות/בטיפול/ממתינות לאישור בלוח התפעול. מחזיר גם task_id לכל משימה, לשימוש בהמשך עם update_task_status.",
    schema: {
      type: "object",
      properties: {
        status_filter: { type: "string", enum: ["open", "in_progress", "pending_approval", "all"], description: "סינון לפי סטטוס, ברירת מחדל all." },
        room: { type: "string", description: "סינון לפי חדר/סוויטה, אופציונלי." },
      },
      required: [],
    },
  },
  {
    name: "update_task_status",
    description:
      "עדכון סטטוס משימה קיימת בלוח התפעול: אישור ושיגור לצוות (pending_approval→open), התחלת טיפול " +
      "(→in_progress), סיום (→done), או דחייה (pending_approval→rejected). איתור המשימה לפי task_id " +
      "(אם ידוע מתוצאת query_open_tasks קודמת באותה שיחה) או לפי room (+ keyword אם יש כמה משימות פתוחות " +
      "באותו חדר). אם ההתאמה לא חד-משמעית — הכלי מחזיר רשימת מועמדים במקום לנחש.",
    schema: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "מזהה משימה, אם ידוע (מוחזר מ-query_open_tasks)." },
        room: { type: "string", description: "חדר/סוויטה לאיתור המשימה, אם task_id לא ידוע." },
        keyword: { type: "string", description: "מילת מפתח מתוך תיאור המשימה, לצמצום התאמות בחדר עם כמה משימות." },
        new_status: { type: "string", enum: ["open", "in_progress", "done", "rejected"], description: "הסטטוס החדש. open על משימה ממתינה לאישור = אישור ושיגור לצוות." },
        rejection_reason: { type: "string", description: "סיבת דחייה, אופציונלי (רק אם new_status=rejected)." },
      },
      required: ["new_status"],
    },
  },
  {
    name: "list_guest_alerts",
    description:
      "רשימת בקשות/התראות פתוחות מלוח הבקשות (Requests Board) — תלונות, בקשות ספא, שינויי תאריך, " +
      "בעיות חיוב, שעות הגעה. לשאלות כמו \"יש בקשות פתוחות\", \"מה יש בלוח הבקשות\".",
    schema: {
      type: "object",
      properties: {
        alert_type: {
          type: "string",
          enum: ["complaint", "date_change_request", "request", "upsell_opportunity", "portal_room_service", "financial_issue", "spa_request", "arrival_eta"],
          description: "סינון לפי סוג, אופציונלי.",
        },
        room: { type: "string", description: "סינון לפי חדר/שם אורח, אופציונלי." },
      },
      required: [],
    },
  },
  {
    name: "get_room_status",
    description:
      "מצב חדרים תפעולי (פנוי/תפוס/ניקיון/תחזוקה) מלוח החדרים — לא סטטוס האורח. לשאלות כמו " +
      "\"מה מצב חדר 205\", \"כמה חדרים בניקיון כרגע\".",
    schema: {
      type: "object",
      properties: { room: { type: "string", description: "חדר ספציפי; אם ריק — סיכום כל החדרים." } },
      required: [],
    },
  },
  {
    name: "get_ops_digest_now",
    description:
      "דוח תפעולי מיידי (יומי/שבועי/חודשי) — הגעות, מוכנות חדרים, בקשות לפי סוויטה, עמידה ב-SLA, חריגות. " +
      "לבקשות כמו \"תן לי את הדוח היומי עכשיו\". קריאה בלבד — לא נספר כשליחת הדוח היזום של הבוקר.",
    schema: {
      type: "object",
      properties: { period: { type: "string", enum: ["daily", "weekly", "monthly"], description: "טווח הדוח, ברירת מחדל daily." } },
      required: [],
    },
  },
  {
    name: "set_guest_status",
    description:
      "סימון \"חדר מוכן\" לאורח (guests.status→room_ready) — משגר גם את הודעת ה-WhatsApp הרגילה לאורח " +
      "(רק ביום ההגעה בפועל, סוויטות בלבד, לא יום-כיף). אין כלי לצ'ק-אין/ביטול/שינוי תאריכים דרך קול — " +
      "לאלה יש מנגנונים ייעודיים אחרים או שהם דורשים גישה למסך הניהול.",
    schema: {
      type: "object",
      properties: {
        guest_id: { type: "integer", description: "מזהה אורח, אם ידוע (עדיף על room)." },
        room: { type: "string", description: "חדר/סוויטה לאיתור האורח, אם guest_id לא ידוע." },
      },
      required: [],
    },
  },
];

/** Architect-only tools — exposed to the LLM and executable only for Mike (ARCHITECT_PHONE_DIGITS). */
const ARCHITECT_TOOL_DEFS: ToolDef[] = [
  {
    name: "get_system_health",
    description:
      "סטטוס מערכת XOS למפתח: מכשיר Whapi (בריא/חסום), SOS ידני, ערוצי סוויטות/יום-כיף, בוטים פעילים, " +
      "ספירת human_requested ב-Inbox, משימות pending_approval. לשאלות כמו \"האם Whapi חסום\", \"מה מצב המערכת\".",
    schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_executive_action_log",
    description:
      "יומן קריאות כלים אחרונות של העוזרת האישית (executive_action_log) — לדיבוג ו-QA. " +
      "אפשר לסנן לפי טלפון מנהל או שם כלי.",
    schema: {
      type: "object",
      properties: {
        limit: { type: "integer", description: "מספר שורות, ברירת מחדל 15, מקסימום 30." },
        phone: { type: "string", description: "סינון לפי טלפון מנהל (כל פורמט)." },
        tool_name: { type: "string", description: "סינון לפי שם כלי, למשל list_guests_by_date." },
      },
      required: [],
    },
  },
  {
    name: "list_executive_rules_audit",
    description:
      "רשימת כללים שנלמדו (module=executive) עם בעלים — לבדיקת מה אליעד למד מול מה משותף. " +
      "scope: self=של מייק, shared=משותפים, eliad=של אליעד+משותפים, all=הכל.",
    schema: {
      type: "object",
      properties: {
        scope: { type: "string", enum: ["self", "shared", "eliad", "all"], description: "טווח הכללים." },
      },
      required: [],
    },
  },
];

const ARCHITECT_TOOL_NAMES = new Set(ARCHITECT_TOOL_DEFS.map((t) => t.name));

const FRONT_DESK_FORBIDDEN_TOOL_NAMES = new Set([
  "ceo_guest_override",
  "get_ops_digest_now",
  "notify_managers_group",
  "learn_executive_rule",
  ...ARCHITECT_TOOL_NAMES,
]);

const FRONT_DESK_EXTRA_TOOL_DEFS: ToolDef[] = [
  {
    name: "get_arrival_desk_brief",
    description:
      "לוח הגעות דלפק סוויטות — היום ומחר: מי מגיע, מי עם שעת הגעה, מי עדיין בלי שעה (⚠), VIP. " +
      "לשאלות «מי מגיע היום», «מי בלי שעה», «לוח הגעות».",
    schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "resolve_guest_alert",
    description:
      "סימון בקשה בלוח הבקשות כטופלה (resolved). לפי alert_id או חדר+מילת מפתח. " +
      "אם יש כמה התאמות — מחזיר רשימה, לא מנחש.",
    schema: {
      type: "object",
      properties: {
        alert_id: { type: "integer", description: "מזהה שורה מ-list_guest_alerts." },
        room: { type: "string", description: "חדר/סוויטה לסינון." },
        keyword: { type: "string", description: "מילה מההודעה לסינון." },
        note: { type: "string", description: "הערת סגירה אופציונלית." },
      },
      required: [],
    },
  },
  {
    name: "learn_front_desk_rule",
    description: "שמירת העדפה קבועה של אדיר (פרטית לו) — למשל סדר עדיפויות בתשובות.",
    schema: {
      type: "object",
      properties: { rule_text: { type: "string", description: "הכלל לשמור." } },
      required: ["rule_text"],
    },
  },
  {
    name: "request_missing_arrival_times",
    description:
      "שליחת הודעת וואטסאפ קצרה לכל אורחי הסוויטות שמגיעים היום ועדיין לא דיווחו שעת הגעה, לבקש מהם שעה משוערת. " +
      "להשתמש רק אחרי שאדיר אישר במפורש (למשל ענה \"כן\" להצעה בבריף הבוקר, או ביקש \"תשלחי להם הודעה לבקש שעת הגעה\"). " +
      "מדלג אוטומטית על מי שכבר קיבל את ההודעה הזו היום.",
    schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "escalate_to_eliad",
    description:
      "שליחת עדכון אישי לאליעד (מנכ\"ל) על מקרה ספציפי שדורש החלטת הנהלה — פיצוי, הנחה, מקרה VIP, או כל דבר " +
      "שאדיר לא יכול/רוצה להחליט עליו לבד. לא לשימוש עבור בקשות שגרתיות שאדיר יכול לטפל בהן בעצמו.",
    schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "תיאור קצר וברור של המצב וההחלטה הנדרשת, בעברית." },
        guest_id: { type: "integer", description: "מזהה אורח, אם ידוע (עדיף על room)." },
        room: { type: "string", description: "חדר/סוויטה, אם רלוונטי." },
      },
      required: ["summary"],
    },
  },
];

const FRONT_DESK_EXTRA_TOOL_NAMES = new Set(FRONT_DESK_EXTRA_TOOL_DEFS.map((t) => t.name));

/** Tool surface per assistant tier. */
export function resolveExecutiveToolDefs(ownerPhone: string, tier: AssistantTier = "executive"): ToolDef[] {
  if (tier === "architect") return [...EXECUTIVE_TOOLS, ...ARCHITECT_TOOL_DEFS];
  if (tier === "front_desk") {
    const base = EXECUTIVE_TOOLS.filter((t) => !FRONT_DESK_FORBIDDEN_TOOL_NAMES.has(t.name));
    return [...base, ...FRONT_DESK_EXTRA_TOOL_DEFS];
  }
  return EXECUTIVE_TOOLS;
}

function _buildGeminiToolsPayload(toolDefs: ToolDef[]) {
  return [{
    functionDeclarations: toolDefs.map((t) => ({ name: t.name, description: t.description, parameters: t.schema })),
  }];
}

function _buildClaudeToolsPayload(toolDefs: ToolDef[]) {
  return toolDefs.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema }));
}

function _isToolAllowedForCaller(name: string, ownerPhone: string, tier: AssistantTier): boolean {
  if (ARCHITECT_TOOL_NAMES.has(name)) {
    return tier === "architect";
  }
  if (FRONT_DESK_EXTRA_TOOL_NAMES.has(name)) {
    return tier === "front_desk";
  }
  if (tier === "front_desk" && FRONT_DESK_FORBIDDEN_TOOL_NAMES.has(name)) {
    return false;
  }
  return true;
}

// ══════════════════════════════════════════════════════════════════════════════
// §5  Tool executors — server-side gates the model cannot bypass.
// ══════════════════════════════════════════════════════════════════════════════

type ToolResult = Record<string, unknown> & { ok: boolean };
export type ToolExecCtx = {
  phone: string;
  originalText: string;
  msgId: string;
  /** Normalized executive phone digits (ExecutiveProfile.phoneDigits) — the
   * scoping key for private learned rules. Kept separate from `phone` (which
   * mirrors whatever raw format the inbound webhook carried) so rule scoping
   * never drifts if that raw format ever changes. */
  /** Scoping key for private learned rules + tool tier gates. */
  ownerPhone: string;
  assistantTier: AssistantTier;
};

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

const LIST_GUESTS_DATE_MODE_LABEL_HE: Record<string, string> = {
  arriving: "מגיעים",
  departing: "עוזבים",
  in_house: "בריזורט",
};

const YMD_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function _execListGuestsByDate(supabase: SupabaseClient, args: Record<string, unknown>): Promise<ToolResult> {
  const date = String(args.date ?? "").trim();
  const mode = String(args.mode ?? "");
  if (!YMD_DATE_RE.test(date)) return { ok: false, error: "invalid_date_format" };
  if (!(mode in LIST_GUESTS_DATE_MODE_LABEL_HE)) return { ok: false, error: "invalid_mode" };

  let query = supabase
    .from("guests")
    .select("id, name, room, room_type, status, arrival_date, departure_date, arrival_time, requires_attention")
    .not("status", "eq", "cancelled");

  if (mode === "arriving") query = query.eq("arrival_date", date);
  else if (mode === "departing") query = query.eq("departure_date", date).neq("status", "checked_out");
  else query = query.lte("arrival_date", date).or(`departure_date.gte.${date},departure_date.is.null`);

  const { data, error } = await query.order("room", { ascending: true }).limit(40);
  if (error) {
    console.warn("[executiveAssistant] list_guests_by_date failed:", error.message);
    return { ok: false, error: error.message };
  }

  const rows = (data ?? []) as Array<{
    name: string | null;
    room: string | null;
    room_type: string | null;
    status: string;
    arrival_time: string | null;
    requires_attention: boolean | null;
  }>;
  const label = `${LIST_GUESTS_DATE_MODE_LABEL_HE[mode]} ב-${date}`;
  if (!rows.length) return { ok: true, count: 0, date, mode, summary: `אין אורחים — ${label}.` };

  const lines = rows.map((g) => {
    const attn = g.requires_attention ? " ⚠" : "";
    return `• ${g.name ?? "ללא שם"} — ${g.room ?? "ללא חדר"}${g.arrival_time ? ` (${g.arrival_time})` : ""} [${g.status}]${attn}`;
  });
  return { ok: true, count: rows.length, date, mode, summary: lines.join("\n") };
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

/** Send one free-text WhatsApp message to a guest via the Whapi Suites device
 * + log to Inbox. Shared by send_guest_message and request_missing_arrival_times —
 * same direct-Whapi path send_guest_message already used before this helper was
 * extracted (no per-cohort channel routing here; not introducing new routing
 * logic that doesn't already exist for this assistant's guest messaging). */
async function _sendGuestWhapiMessage(
  supabase: SupabaseClient,
  guest: { id: number; phone: string },
  message: string,
): Promise<{ sent: boolean; wamid: string | null; error?: string }> {
  let wamid: string | null = null;
  try {
    wamid = await sendWhapiText(cleanPhoneForMention(guest.phone), message);
  } catch (e) {
    return { sent: false, wamid: null, error: (e as Error).message };
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
  if (error) console.warn("[executiveAssistant] guest whapi message log insert failed:", error.message);
  return { sent: true, wamid };
}

async function _execSendGuestMessage(supabase: SupabaseClient, args: Record<string, unknown>): Promise<ToolResult> {
  const message = String(args.message ?? "").trim();
  if (!message) return { ok: false, error: "message_required" };
  if (!args.guest_id && !args.room) return { ok: false, error: "guest_id_or_room_required" };

  const guest = await _resolveExecutiveGuestTarget(supabase, args);
  if (!guest) return { ok: false, error: "guest_not_found_or_inactive" };
  if (!guest.phone) return { ok: false, error: "guest_no_phone" };

  const result = await _sendGuestWhapiMessage(supabase, { id: guest.id, phone: guest.phone }, message);
  if (!result.sent) {
    console.error("[executiveAssistant] send_guest_message failed:", result.error);
    return { ok: false, error: result.error };
  }
  return { ok: true, guest_id: guest.id, sent: true };
}

const ARRIVAL_ETA_REQUEST_MESSAGE = "היי, נשמח לדעת מתי תגיעו היום בערך? 😊";
// Distinctive substring used to detect "already asked today" without a schema
// change (MVP #1 — no migration, see plan). Matched against
// whatsapp_conversations.message for today's Israel-local date.
const ARRIVAL_ETA_REQUEST_DEDUPE_MARK = "נשמח לדעת מתי תגיעו";

type MissingEtaGuestRow = {
  id: number;
  name: string | null;
  room: string | null;
  room_type: string | null;
  phone: string | null;
  status: string;
};

async function _execRequestMissingArrivalTimes(supabase: SupabaseClient): Promise<ToolResult> {
  const todayYmd = israelTodayStr();
  const { data, error } = await supabase
    .from("guests")
    .select("id, name, room, room_type, phone, status, arrival_date, arrival_time")
    .eq("arrival_date", todayYmd)
    .not("status", "eq", "cancelled")
    .is("arrival_time", null);
  if (error) {
    console.warn("[executiveAssistant] request_missing_arrival_times lookup failed:", error.message);
    return { ok: false, error: error.message };
  }

  const candidates = ((data ?? []) as unknown as MissingEtaGuestRow[]).filter(
    (g) => isEffectiveSuiteGuest(g) && g.phone,
  );
  if (!candidates.length) return { ok: true, count: 0, sent: 0, summary: "אין אורחי סוויטות בלי שעת הגעה היום." };

  // Israel-local midnight today, as a UTC instant — same fixed-offset
  // convention as resortDigestStats.ts's israelMidnightUtc (no DST
  // adjustment, consistent with the rest of the cron pipeline).
  const todayStartIso = new Date(
    new Date(`${todayYmd}T00:00:00.000Z`).getTime() - ISRAEL_UTC_OFFSET_HOURS * 3_600_000,
  ).toISOString();

  const phones = candidates.map((g) => g.phone as string);
  const { data: alreadySent, error: dedupeErr } = await supabase
    .from("whatsapp_conversations")
    .select("phone")
    .eq("direction", "outbound")
    .in("phone", phones)
    .gte("created_at", todayStartIso)
    .ilike("message", `%${ARRIVAL_ETA_REQUEST_DEDUPE_MARK}%`);
  if (dedupeErr) {
    console.warn("[executiveAssistant] request_missing_arrival_times dedupe lookup failed:", dedupeErr.message);
  }
  const alreadyAskedPhones = new Set(((alreadySent ?? []) as Array<{ phone: string }>).map((r) => r.phone));

  const toSend = candidates.filter((g) => !alreadyAskedPhones.has(g.phone as string));
  const skippedAlready = candidates.length - toSend.length;
  if (!toSend.length) {
    return {
      ok: true,
      count: candidates.length,
      sent: 0,
      already_asked: skippedAlready,
      summary: `כל ה-${candidates.length} האורחים בלי שעה כבר קיבלו את ההודעה הזו היום.`,
    };
  }

  let sentCount = 0;
  const failedNames: string[] = [];
  const sentNames: string[] = [];
  for (const g of toSend) {
    const result = await _sendGuestWhapiMessage(
      supabase,
      { id: g.id, phone: g.phone as string },
      ARRIVAL_ETA_REQUEST_MESSAGE,
    );
    if (result.sent) {
      sentCount++;
      sentNames.push(g.name ?? g.room ?? "אורח");
    } else {
      failedNames.push(g.name ?? g.room ?? "אורח");
      console.warn(`[executiveAssistant] arrival-eta request failed for guest ${g.id}:`, result.error);
    }
  }

  const summaryParts = [`נשלח ל-${sentCount} אורחים: ${sentNames.join(", ") || "—"}`];
  if (failedNames.length) summaryParts.push(`⚠ נכשל עבור: ${failedNames.join(", ")}`);
  if (skippedAlready) summaryParts.push(`(${skippedAlready} כבר קיבלו היום, לא נשלח שוב)`);

  return {
    ok: true,
    count: candidates.length,
    sent: sentCount,
    failed: failedNames.length,
    already_asked: skippedAlready,
    summary: summaryParts.join(" "),
  };
}

async function _execEscalateToEliad(supabase: SupabaseClient, args: Record<string, unknown>): Promise<ToolResult> {
  const summary = String(args.summary ?? "").trim();
  if (!summary) return { ok: false, error: "summary_required" };

  let guestName: string | null = null;
  let room: string | null = String(args.room ?? "").trim() || null;
  let guestPhoneDigits: string | null = null;
  if (args.guest_id || args.room) {
    const guest = await _resolveExecutiveGuestTarget(supabase, args);
    if (guest) {
      guestName = guest.name ?? null;
      room = guest.room ?? room;
      guestPhoneDigits = phoneDigitsForDeepLink(guest.phone) || null;
    }
  }

  const lines = ["📣 עדכון מאדיר", ""];
  if (room || guestName) lines.push(`${room ?? "—"}${guestName ? ` — ${guestName}` : ""}`);
  lines.push(
    summary,
    "",
    `💬 לפתוח באינבוקס: ${buildStaffAppDeepLink({ page: "wa_inbox", phone: guestPhoneDigits, guestName })}`,
  );

  const delivery = await deliverExecutiveDmReply(supabase, {
    phone: CEO_PHONE_DIGITS,
    replyText: lines.join("\n"),
  });
  if (!delivery.sent) return { ok: false, error: delivery.error ?? "send_failed" };
  return { ok: true, sent: true, escalated_to: "אליעד" };
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

async function _execLearnExecutiveRule(
  supabase: SupabaseClient,
  args: Record<string, unknown>,
  ctx: ToolExecCtx,
): Promise<ToolResult> {
  return _execLearnRule(supabase, args, ctx, "executive");
}

async function _execLearnRule(
  supabase: SupabaseClient,
  args: Record<string, unknown>,
  ctx: ToolExecCtx,
  module: "executive" | "front_desk",
): Promise<ToolResult> {
  const ruleText = String(args.rule_text ?? "").trim();
  if (!ruleText) return { ok: false, error: "rule_text_required" };

  const { data: existing } = await supabase
    .from("xos_ai_rules")
    .select("rule_text, owner_phone")
    .eq("module", module);
  const normalized = ruleText.trim().toLowerCase();
  const isDupe = ((existing ?? []) as Array<{ rule_text: string; owner_phone: string | null }>).some(
    (r) =>
      (r.rule_text ?? "").trim().toLowerCase() === normalized &&
      (r.owner_phone === null || r.owner_phone === ctx.ownerPhone),
  );
  if (isDupe) return { ok: true, deduped: true };

  const { error } = await supabase
    .from("xos_ai_rules")
    .insert({ module, rule_text: ruleText, owner_phone: ctx.ownerPhone });
  if (error) {
    console.error(`[executiveAssistant] learn rule (${module}) insert failed:`, error.message);
    return { ok: false, error: error.message };
  }
  _invalidateExecutiveRulesCache(ctx.ownerPhone, module);
  return { ok: true, inserted: true };
}

async function _execGetArrivalDeskBrief(supabase: SupabaseClient): Promise<ToolResult> {
  const { fetchFrontDeskMorningStats } = await import("./frontDeskMorningBrief.ts");
  try {
    const { brief } = await fetchFrontDeskMorningStats(supabase);
    if (!brief.todayTotal && !brief.tomorrowTotal) {
      return { ok: true, count: 0, summary: "אין הגעות סוויטות היום או מחר." };
    }
    return {
      ok: true,
      count: brief.todayTotal + brief.tomorrowTotal,
      with_time: brief.todayWithTime,
      missing_time: brief.todayMissingTime,
      summary: brief.summary,
      ...(brief.todayMissingTime > 0
        ? { suggestion: "אפשר להציע לאדיר לשלוח הודעה לבקש שעת הגעה מכל מי שעדיין בלי שעה (request_missing_arrival_times), אם הוא מאשר." }
        : {}),
    };
  } catch (e) {
    console.warn("[executiveAssistant] get_arrival_desk_brief failed:", (e as Error).message);
    return { ok: false, error: (e as Error).message };
  }
}

async function _execResolveGuestAlert(supabase: SupabaseClient, args: Record<string, unknown>): Promise<ToolResult> {
  const alertId = Number(args.alert_id);
  const room = String(args.room ?? "").trim().toLowerCase();
  const keyword = String(args.keyword ?? "").trim().toLowerCase();
  const note = String(args.note ?? "").trim();

  if (Number.isFinite(alertId) && alertId > 0) {
    const { data, error } = await supabase
      .from("guest_alerts")
      .update({
        resolved: true,
        resolved_at: new Date().toISOString(),
        resolution_notes: note || "סומן ע\"י עוזרת דלפק (אדיר)",
      })
      .eq("id", alertId)
      .eq("resolved", false)
      .select("id")
      .maybeSingle();
    if (error) return { ok: false, error: error.message };
    if (!data) return { ok: false, error: "alert_not_found_or_already_resolved" };
    return { ok: true, alert_id: alertId };
  }

  if (!room && !keyword) return { ok: false, error: "alert_id_or_room_or_keyword_required" };

  const { data, error } = await supabase
    .from("guest_alerts")
    .select("id, message, alert_type, guests(name, room)")
    .eq("resolved", false)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) return { ok: false, error: error.message };

  type AlertRow = { id: number; message: string; alert_type: string; guests: { name: string | null; room: string | null } | null };
  let rows = (data ?? []) as unknown as AlertRow[];
  if (room) {
    rows = rows.filter((r) => (r.guests?.room ?? "").toLowerCase().includes(room));
  }
  if (keyword) {
    rows = rows.filter((r) => `${r.message} ${r.alert_type}`.toLowerCase().includes(keyword));
  }
  if (!rows.length) return { ok: false, error: "no_matching_open_alert" };
  if (rows.length > 1) {
    return {
      ok: false,
      error: "ambiguous_alert_match",
      candidates: rows.map((r) => ({
        alert_id: r.id,
        room: r.guests?.room ?? null,
        message: (r.message ?? "").slice(0, 80),
      })),
    };
  }

  const target = rows[0];
  const { error: updErr } = await supabase
    .from("guest_alerts")
    .update({
      resolved: true,
      resolved_at: new Date().toISOString(),
      resolution_notes: note || "סומן ע\"י עוזרת דלפק (אדיר)",
    })
    .eq("id", target.id);
  if (updErr) return { ok: false, error: updErr.message };
  return { ok: true, alert_id: target.id, room: target.guests?.room ?? null };
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
  const room = String(args.room ?? "").trim();

  let query = supabase
    .from("tasks")
    .select("id, room_number, description, department, status, sla_deadline")
    .in("status", statuses)
    .order("created_at", { ascending: true })
    .limit(10);
  if (room) query = query.ilike("room_number", `%${room}%`);

  const { data, error } = await query;
  if (error) {
    console.warn("[executiveAssistant] query_open_tasks failed:", error.message);
    return { ok: false, error: error.message };
  }

  const rows = (data ?? []) as Array<{ id: string; room_number: string | null; description: string; department: string; status: string; sla_deadline: string | null }>;
  if (!rows.length) return { ok: true, count: 0, summary: "אין משימות פתוחות כרגע." };

  const lines = rows.map((t) =>
    `• ${t.room_number ? `[${t.room_number}] ` : ""}${t.description} (${t.department}, ${TASK_STATUS_LABEL_HE[t.status] ?? t.status})`,
  );
  // tasks[] (with id) is for the model's own follow-up update_task_status call —
  // the Hebrew summary line deliberately omits the uuid, it's not for the human.
  return {
    ok: true,
    count: rows.length,
    summary: lines.join("\n"),
    tasks: rows.map((t) => ({ task_id: t.id, room_number: t.room_number, description: t.description, status: t.status })),
  };
}

type TaskCandidate = { id: string; room_number: string | null; description: string; status: string; department: string };

/**
 * Best-effort task lookup by task_id (preferred) or room (+ optional keyword
 * narrowing). Mirrors _resolveExecutiveGuestTarget's contract: returns exactly
 * one match, a candidate list when ambiguous (caller must ask, never guess —
 * CLAUDE.md persona rule), or null on a true miss.
 */
async function _resolveExecutiveTaskTarget(
  supabase: SupabaseClient,
  args: { task_id?: unknown; room?: unknown; keyword?: unknown },
): Promise<{ task: TaskCandidate } | { candidates: TaskCandidate[] } | null> {
  const taskId = String(args.task_id ?? "").trim();
  if (taskId) {
    const { data, error } = await supabase
      .from("tasks")
      .select("id, room_number, description, status, department")
      .eq("id", taskId)
      .maybeSingle();
    if (error || !data) return null;
    return { task: data as TaskCandidate };
  }

  const room = String(args.room ?? "").trim();
  if (!room) return null;
  const keyword = String(args.keyword ?? "").trim().toLowerCase();

  const { data, error } = await supabase
    .from("tasks")
    .select("id, room_number, description, status, department")
    .in("status", [...OPEN_TASK_STATUSES])
    .ilike("room_number", `%${room}%`)
    .order("created_at", { ascending: true })
    .limit(10);
  if (error) {
    console.warn("[executiveAssistant] task lookup (room) failed:", error.message);
    return null;
  }
  let candidates = (data ?? []) as TaskCandidate[];
  if (keyword) {
    const narrowed = candidates.filter((t) => (t.description ?? "").toLowerCase().includes(keyword));
    if (narrowed.length) candidates = narrowed;
  }
  if (!candidates.length) return null;
  if (candidates.length === 1) return { task: candidates[0] };
  return { candidates };
}

function _taskCandidatesResult(candidates: TaskCandidate[]): ToolResult {
  return {
    ok: false,
    error: "ambiguous_task",
    candidates: candidates.map((c) => ({
      task_id: c.id,
      room_number: c.room_number,
      description: c.description,
      status: c.status,
    })),
  };
}

async function _execUpdateTaskStatus(
  supabase: SupabaseClient,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const newStatus = String(args.new_status ?? "");
  if (!["open", "in_progress", "done", "rejected"].includes(newStatus)) {
    return { ok: false, error: "invalid_new_status" };
  }
  if (!args.task_id && !args.room) return { ok: false, error: "task_id_or_room_required" };

  const resolved = await _resolveExecutiveTaskTarget(supabase, args);
  if (!resolved) return { ok: false, error: "task_not_found" };
  if ("candidates" in resolved) return _taskCandidatesResult(resolved.candidates);
  const task = resolved.task;

  if (newStatus === "open") {
    if (task.status !== "pending_approval") {
      return { ok: false, error: "not_pending_approval", current_status: task.status };
    }
    // Same "Approve & Dispatch" path as OperationsBoard.js's approveTask —
    // notify-manual-task performs the guarded pending_approval→open flip
    // server-side BEFORE the Whapi card send, so a retry can't double-dispatch.
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return { ok: false, error: "notify_function_unconfigured" };
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/notify-manual-task`, {
        method: "POST",
        headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: task.id }),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!data.ok) return { ok: false, error: (data.error as string) ?? "notify_manual_task_failed" };
      if (data.reason === "already_processed") return { ok: false, error: "already_processed" };
      return { ok: true, task_id: task.id, approved: true, group_card_sent: data.notified !== false, reason: data.reason as string | undefined };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  if (newStatus === "in_progress") {
    if (!["open", "pending_approval"].includes(task.status)) {
      return { ok: false, error: "invalid_transition", current_status: task.status };
    }
    const { error } = await supabase.from("tasks").update({ status: "in_progress" }).eq("id", task.id);
    if (error) return { ok: false, error: error.message };
    return { ok: true, task_id: task.id, status: "in_progress" };
  }

  if (newStatus === "done") {
    if (task.status === "done") return { ok: true, task_id: task.id, status: "done", already_done: true };
    // resolved_by_name (no resolved_by uuid — voice has no logged-in profiles.id)
    // mirrors OperationsBoard's markDone attribution convention so this reads as
    // executive-resolved, not silently indistinguishable from staff-resolved.
    const { error } = await supabase
      .from("tasks")
      .update({ status: "done", resolved_by_name: "אליעד (קול)", resolved_at: new Date().toISOString() })
      .eq("id", task.id);
    if (error) return { ok: false, error: error.message };
    return { ok: true, task_id: task.id, status: "done" };
  }

  // rejected — only valid from pending_approval, same guard as OperationsBoard's rejectTask.
  if (task.status !== "pending_approval") {
    return { ok: false, error: "not_pending_approval", current_status: task.status };
  }
  const reason = String(args.rejection_reason ?? "").trim() || null;
  const { data: rejected, error } = await supabase
    .from("tasks")
    .update({ status: "rejected", reviewed_at: new Date().toISOString(), rejection_reason: reason })
    .eq("id", task.id)
    .eq("status", "pending_approval")
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!rejected) return { ok: false, error: "already_processed" };
  return { ok: true, task_id: task.id, status: "rejected" };
}

const ALERT_TYPE_LABEL_HE: Record<string, string> = {
  complaint: "🔴 תקלה",
  date_change_request: "🗓️ שינוי תאריך",
  request: "📝 בקשה",
  upsell_opportunity: "🌴 בקשה מהפורטל",
  portal_room_service: "🍽️ שירות לחדר (פורטל)",
  financial_issue: "💳 בעיית חיוב",
  spa_request: "💆 בקשת ספא",
  arrival_eta: "🕐 שעת הגעה",
};

async function _execListGuestAlerts(supabase: SupabaseClient, args: Record<string, unknown>): Promise<ToolResult> {
  let query = supabase
    .from("guest_alerts")
    .select("id, phone, alert_type, message, created_at, guests(name, room)")
    .eq("resolved", false)
    .order("created_at", { ascending: false })
    .limit(15);

  const alertType = String(args.alert_type ?? "").trim();
  if (alertType) query = query.eq("alert_type", alertType);

  const { data, error } = await query;
  if (error) {
    console.warn("[executiveAssistant] list_guest_alerts failed:", error.message);
    return { ok: false, error: error.message };
  }

  type AlertRow = { id: number; alert_type: string; message: string; guests: { name: string | null; room: string | null } | null };
  let rows = (data ?? []) as unknown as AlertRow[];

  const room = String(args.room ?? "").trim().toLowerCase();
  if (room) rows = rows.filter((r) => (r.guests?.room ?? "").toLowerCase().includes(room));

  if (!rows.length) return { ok: true, count: 0, summary: "אין בקשות פתוחות בלוח הבקשות כרגע." };

  const lines = rows.map((r) => {
    const label = ALERT_TYPE_LABEL_HE[r.alert_type] ?? `⚠ ${r.alert_type}`;
    const who = r.guests?.name ? `${r.guests.name}${r.guests.room ? ` (${r.guests.room})` : ""}` : "אורח לא מזוהה";
    return `• ${label} — ${who}: ${(r.message ?? "").slice(0, 120)}`;
  });
  return { ok: true, count: rows.length, summary: lines.join("\n") };
}

async function _execGetRoomStatus(supabase: SupabaseClient, args: Record<string, unknown>): Promise<ToolResult> {
  const room = String(args.room ?? "").trim();

  if (room) {
    const { data, error } = await supabase
      .from("room_status")
      .select("room_id, status, notes, updated_at")
      .ilike("room_id", `%${room}%`)
      .limit(5);
    if (error) return { ok: false, error: error.message };
    const rows = (data ?? []) as Array<{ room_id: string; status: string; notes: string | null; updated_at: string }>;
    if (!rows.length) return { ok: false, error: "room_not_found" };
    return {
      ok: true,
      rooms: rows.map((r) => ({ room_id: r.room_id, status: r.status, notes: r.notes })),
      summary: rows.map((r) => `${r.room_id}: ${r.status}${r.notes ? ` (${r.notes})` : ""}`).join("\n"),
    };
  }

  const { data, error } = await supabase.from("room_status").select("status");
  if (error) return { ok: false, error: error.message };
  const counts = new Map<string, number>();
  for (const r of (data ?? []) as Array<{ status: string }>) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
  const summary = [...counts.entries()].map(([status, count]) => `${status}: ${count}`).join(" | ");
  return { ok: true, summary: summary || "אין נתוני חדרים." };
}

async function _execGetOpsDigestNow(supabase: SupabaseClient, args: Record<string, unknown>): Promise<ToolResult> {
  const period = String(args.period ?? "daily") as DigestPeriod;
  if (!["daily", "weekly", "monthly"].includes(period)) return { ok: false, error: "invalid_period" };

  const now = new Date();
  const range = resolveDigestRange(period, now);
  const rangeStartIso = range.rangeStart.toISOString();
  const rangeEndIso = range.rangeEnd.toISOString();

  // Same query shape as resort-digest-cron — kept read-only here: no
  // resort_digest_log write, so an on-demand pull can never collide with the
  // scheduled push's idempotency record for the same period.
  const [guestsRes, tasksRes, ruleRows] = await Promise.all([
    supabase
      .from("guests")
      .select("id, room, checkin_time, room_ready_at, room_ready_notified")
      .gte("checkin_time", rangeStartIso)
      .lt("checkin_time", rangeEndIso),
    supabase
      .from("tasks")
      .select("id, room_number, sla_category, status, created_at, resolved_at, sla_deadline")
      .gte("created_at", rangeStartIso)
      .lt("created_at", rangeEndIso),
    supabase.from("xos_ai_rules").select("rule_text").eq("module", "executive").order("created_at", { ascending: true }),
  ]);
  if (guestsRes.error || tasksRes.error) {
    return { ok: false, error: guestsRes.error?.message ?? tasksRes.error?.message ?? "fetch_failed" };
  }

  const stats = computeResortDigestStats({
    guests: (guestsRes.data ?? []) as DigestGuestRow[],
    tasks: (tasksRes.data ?? []) as DigestTaskRow[],
    now,
  });
  const learnedDigestNotes = filterDigestRelevantRules(
    ((ruleRows.data ?? []) as Array<{ rule_text: string | null }>).map((r) => r.rule_text ?? ""),
  );
  const body = composeResortDigestMessage(stats, period, range.label, {
    assistantForName: "אליעד",
    learnedDigestNotes,
  });
  return { ok: true, period, period_date: range.periodDate, digest: body };
}

async function _execSetGuestStatus(supabase: SupabaseClient, args: Record<string, unknown>): Promise<ToolResult> {
  if (!args.guest_id && !args.room) return { ok: false, error: "guest_id_or_room_required" };

  const guest = await _resolveExecutiveGuestTarget(supabase, args);
  if (!guest) return { ok: false, error: "guest_not_found_or_inactive" };
  if (!isEffectiveSuiteGuest(guest)) return { ok: false, error: "day_pass_guest_not_supported" };
  if (!["pending", "expected"].includes(guest.status)) {
    return { ok: false, error: "invalid_status_transition", current_status: guest.status };
  }

  const { error: updateErr } = await supabase.from("guests").update({ status: "room_ready" }).eq("id", guest.id);
  if (updateErr) return { ok: false, error: updateErr.message };

  // Same trigger GuestsPage.js's "חדר מוכן" button calls — arrival-day gate,
  // duplicate-blocked idempotency, and suite/day-pass routing all live there
  // already; this tool never duplicates that logic. Status flip above already
  // committed even if the send below fails — same UX as the reception button
  // (report ⚠ FAIL VISIBLE, never silently pretend the guest was notified).
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return { ok: true, guest_id: guest.id, status: "room_ready", guest_notified: false, notify_error: "functions_unconfigured" };
  }
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/whatsapp-send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ trigger: "room_ready", guestId: guest.id, roomId: guest.room || undefined }),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!data.ok) {
      return { ok: true, guest_id: guest.id, status: "room_ready", guest_notified: false, notify_error: (data.error as string) ?? "whatsapp_send_failed" };
    }
    return { ok: true, guest_id: guest.id, status: "room_ready", guest_notified: true };
  } catch (e) {
    return { ok: true, guest_id: guest.id, status: "room_ready", guest_notified: false, notify_error: (e as Error).message };
  }
}

async function _execGetSystemHealth(supabase: SupabaseClient): Promise<ToolResult> {
  await primeGuestChannelConfig(supabase);
  const whapi = getWhapiDeviceStatusSnapshot();

  const [inboxRes, pendingRes, botCfgRes] = await Promise.all([
    supabase
      .from("whatsapp_conversations")
      .select("phone")
      .eq("direction", "inbound")
      .eq("human_requested", true)
      .limit(200),
    supabase.from("tasks").select("id").eq("status", "pending_approval").limit(100),
    supabase
      .from("bot_config")
      .select("config_key, config_value")
      .in("config_key", ["bot_active", "bot_active_whapi", "guest_suites_channel", "guest_daypass_channel"]),
  ]);

  const inboxAlerts = new Set(
    ((inboxRes.data ?? []) as Array<{ phone: string }>).map((r) => r.phone).filter(Boolean),
  ).size;
  const pendingApproval = (pendingRes.data ?? []).length;
  const cfg = Object.fromEntries(
    ((botCfgRes.data ?? []) as Array<{ config_key: string; config_value: string }>).map((r) => [r.config_key, r.config_value]),
  );

  const whapiLine = whapi.sosEffective
    ? "⚠ Whapi SOS פעיל — כל outbound אורחים ל-Meta"
    : whapi.healthy === false
    ? "⚠ מכשיר Whapi לא בריא"
    : whapi.healthy === true
    ? "✓ מכשיר Whapi בריא"
    : "? מצב Whapi לא ידוע (עדיין לא נבדק)";

  const lines = [
    whapiLine,
    `Whapi status: ${whapi.statusText}${whapi.checkedAt ? ` (נבדק ${whapi.checkedAt.slice(0, 16).replace("T", " ")})` : ""}`,
    `ערוץ סוויטות: ${getGuestSuitesChannel()} | יום-כיף: ${getGuestDaypassChannel()}`,
    `בוט Meta: ${cfg.bot_active !== "false" ? "פעיל" : "כבוי"} | בוט Whapi: ${cfg.bot_active_whapi !== "false" ? "פעיל" : "כבוי"}`,
    `Inbox human_requested: ${inboxAlerts} שיחות`,
    `משימות pending_approval: ${pendingApproval}`,
  ];
  return { ok: true, summary: lines.join("\n"), whapi, inbox_human_requested: inboxAlerts, pending_approval_tasks: pendingApproval };
}

async function _execGetExecutiveActionLog(supabase: SupabaseClient, args: Record<string, unknown>): Promise<ToolResult> {
  const limit = Math.min(Math.max(Number(args.limit) || 15, 1), 30);
  let query = supabase
    .from("executive_action_log")
    .select("phone, tool_name, args_json, result_json, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  const phoneFilter = String(args.phone ?? "").trim();
  if (phoneFilter) query = query.eq("phone", cleanPhoneForMention(normalizeExecutivePhoneDigits(phoneFilter)));
  const toolFilter = String(args.tool_name ?? "").trim();
  if (toolFilter) query = query.eq("tool_name", toolFilter);

  const { data, error } = await query;
  if (error) {
    console.warn("[executiveAssistant] get_executive_action_log failed:", error.message);
    return { ok: false, error: error.message };
  }

  const rows = (data ?? []) as Array<{
    phone: string;
    tool_name: string;
    args_json: Record<string, unknown>;
    result_json: Record<string, unknown>;
    created_at: string;
  }>;
  if (!rows.length) return { ok: true, count: 0, summary: "אין רשומות ביומן הפעולות." };

  const lines = rows.map((r) => {
    const ok = (r.result_json as { ok?: boolean })?.ok !== false;
    const stamp = r.created_at?.slice(0, 16).replace("T", " ") ?? "";
    const err = !ok ? ` — ${String((r.result_json as { error?: string })?.error ?? "failed")}` : "";
    return `• ${stamp} | ${r.phone} | ${r.tool_name}${err}`;
  });
  return { ok: true, count: rows.length, summary: lines.join("\n"), entries: rows };
}

async function _execListExecutiveRulesAudit(
  supabase: SupabaseClient,
  args: Record<string, unknown>,
  ctx: ToolExecCtx,
): Promise<ToolResult> {
  const scope = String(args.scope ?? "all");
  if (!["self", "shared", "eliad", "all"].includes(scope)) return { ok: false, error: "invalid_scope" };

  let query = supabase
    .from("xos_ai_rules")
    .select("id, rule_text, owner_phone, created_at")
    .eq("module", "executive")
    .order("created_at", { ascending: true });

  if (scope === "self") query = query.eq("owner_phone", ctx.ownerPhone);
  else if (scope === "shared") query = query.is("owner_phone", null);
  else if (scope === "eliad") query = query.or(`owner_phone.is.null,owner_phone.eq.${CEO_PHONE_DIGITS}`);

  const { data, error } = await query;
  if (error) {
    console.warn("[executiveAssistant] list_executive_rules_audit failed:", error.message);
    return { ok: false, error: error.message };
  }

  const rows = (data ?? []) as Array<{ rule_text: string; owner_phone: string | null; created_at: string }>;
  if (!rows.length) return { ok: true, count: 0, scope, summary: "אין כללים בטווח המבוקש." };

  const ownerLabel = (phone: string | null) => {
    if (!phone) return "משותף";
    if (phone === CEO_PHONE_DIGITS) return "אליעד";
    if (phone === ARCHITECT_PHONE_DIGITS) return "מייק";
    return phone;
  };

  const lines = rows.map((r) => `• [${ownerLabel(r.owner_phone)}] ${r.rule_text?.trim() ?? ""}`);
  return { ok: true, count: rows.length, scope, summary: lines.join("\n") };
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
  if (!_isToolAllowedForCaller(name, ctx.ownerPhone, ctx.assistantTier)) {
    return { ok: false, error: "tool_forbidden_for_role" };
  }
  switch (name) {
    case "create_executive_task": return await _execCreateExecutiveTask(supabase, args, ctx);
    case "get_resort_brief": return await _execGetResortBrief(supabase);
    case "find_guest_by_room": return await _execFindGuestByRoom(supabase, args);
    case "list_guests_by_scope": return await _execListGuestsByScope(supabase, args);
    case "list_guests_by_date": return await _execListGuestsByDate(supabase, args);
    case "ceo_guest_override": return await _execCeoGuestOverride(supabase, args);
    case "send_guest_message": return await _execSendGuestMessage(supabase, args);
    case "notify_managers_group": return await _execNotifyManagersGroup(args);
    case "learn_executive_rule": return await _execLearnExecutiveRule(supabase, args, ctx);
    case "query_open_tasks": return await _execQueryOpenTasks(supabase, args);
    case "update_task_status": return await _execUpdateTaskStatus(supabase, args);
    case "list_guest_alerts": return await _execListGuestAlerts(supabase, args);
    case "get_room_status": return await _execGetRoomStatus(supabase, args);
    case "get_ops_digest_now": return await _execGetOpsDigestNow(supabase, args);
    case "set_guest_status": return await _execSetGuestStatus(supabase, args);
    case "get_system_health": return await _execGetSystemHealth(supabase);
    case "get_executive_action_log": return await _execGetExecutiveActionLog(supabase, args);
    case "list_executive_rules_audit": return await _execListExecutiveRulesAudit(supabase, args, ctx);
    case "get_arrival_desk_brief": return await _execGetArrivalDeskBrief(supabase);
    case "resolve_guest_alert": return await _execResolveGuestAlert(supabase, args);
    case "learn_front_desk_rule": return await _execLearnRule(supabase, args, ctx, "front_desk");
    case "request_missing_arrival_times": return await _execRequestMissingArrivalTimes(supabase);
    case "escalate_to_eliad": return await _execEscalateToEliad(supabase, args);
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
// §6  Gemini primary — function calling, up to 3 rounds (conditional).
// Rounds 1-2 both carry tools, so a genuine chain (e.g. "close the task for
// room 5" → look up the task, then close it) can actually complete instead of
// round 2 being forced to compose text around an unfinished action. Round 3
// never carries tools — it exists purely to force a final Hebrew reply after a
// round-2 tool call, capping worst-case latency at 3 model round-trips instead
// of letting a chain run unbounded. The common single-tool (or no-tool) case
// still finishes in 1-2 rounds exactly as before.
// ══════════════════════════════════════════════════════════════════════════════

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
  toolDefs: ToolDef[],
): Promise<{ text: string; toolCalls: ToolCallOut[] } | null> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) return null;
  const geminiTools = _buildGeminiToolsPayload(toolDefs);

  const contents = [..._historyToGeminiTurns(history), { role: "user", parts: [{ text: userMessage }] }];
  const baseBody = {
    contents,
    systemInstruction: { parts: [{ text: systemPrompt }] },
    generationConfig: { maxOutputTokens: 800, temperature: 0.4, candidateCount: 1 },
  };

  for (const model of EXECUTIVE_GEMINI_MODELS) {
    let roundContents: Array<{ role: string; parts: unknown[] }> = contents;
    let allToolCalls: ToolCallOut[] = [];
    let modelFailed = false;
    let finalText: string | null = null;

    for (let round = 1; round <= 3; round++) {
      const includeTools = round < 3;
      let resp: Record<string, unknown>;
      try {
        resp = await _geminiCall(apiKey, model, {
          ...baseBody,
          contents: roundContents,
          ...(includeTools ? { tools: geminiTools } : {}),
        });
      } catch (e) {
        console.warn(`[executiveAssistant] Gemini round${round} model="${model}" failed:`, (e as Error).message);
        modelFailed = round === 1 && !allToolCalls.length; // only bail to next model if we never got anywhere
        break;
      }

      const parsed = _extractGeminiParts(resp);
      if (!parsed.functionCalls.length) {
        if (parsed.text) finalText = parsed.text;
        break;
      }
      if (!includeTools) break; // round 3 has no tools declared — shouldn't happen, but never chain further

      const toolCalls = await runExecutiveToolCalls(supabase, parsed.functionCalls, ctx);
      allToolCalls = [...allToolCalls, ...toolCalls];
      roundContents = [
        ...roundContents,
        { role: "model", parts: parsed.rawParts },
        { role: "user", parts: toolCalls.map((c) => ({ functionResponse: { name: c.name, response: c.result } })) },
      ];
    }

    if (finalText) return { text: finalText, toolCalls: allToolCalls };
    if (allToolCalls.length) {
      // Tool(s) executed but no round ever produced closing text (rare) —
      // fall back to a mechanical summary rather than losing a real,
      // already-executed action (FAIL VISIBLE).
      return { text: _buildToolFallbackSummary(allToolCalls), toolCalls: allToolCalls };
    }
    if (modelFailed) continue; // try next model in EXECUTIVE_GEMINI_MODELS
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
// §7  Claude Sonnet 4.6 fallback — same conditional up-to-3-round contract as
// the Gemini path (see §6 header comment).
// ══════════════════════════════════════════════════════════════════════════════

async function runExecutiveClaude(
  supabase: SupabaseClient,
  systemPrompt: string,
  history: Array<{ direction: string; message: string }>,
  userMessage: string,
  ctx: ToolExecCtx,
  toolDefs: ToolDef[],
): Promise<{ text: string; toolCalls: ToolCallOut[] }> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("no_anthropic_key");
  const anthropic = new Anthropic({ apiKey: key });
  const claudeTools = _buildClaudeToolsPayload(toolDefs);

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

  let roundMessages: Array<{ role: "user" | "assistant"; content: unknown }> = messages;
  let allToolCalls: ToolCallOut[] = [];

  for (let round = 1; round <= 3; round++) {
    const includeTools = round < 3;
    let resp;
    try {
      resp = await anthropic.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 800,
        system: systemPrompt,
        messages: roundMessages,
        ...(includeTools ? { tools: claudeTools, tool_choice: { type: "auto" } } : {}),
      } as any);
    } catch (e) {
      console.warn(`[executiveAssistant] Claude round${round} failed:`, (e as Error).message);
      if (round === 1) throw e; // round 1 hard-fails exactly like before (caller has no partial work to fall back on)
      break;
    }

    const blocks = resp.content as unknown as Array<Record<string, unknown>>;
    const text = blocks.filter((b) => b.type === "text").map((b) => String(b.text ?? "").trim()).filter(Boolean).join("\n");
    const toolUseBlocks = blocks.filter((b) => b.type === "tool_use");

    if (!toolUseBlocks.length) {
      if (text) return { text, toolCalls: allToolCalls };
      if (round === 1) throw new Error("claude_empty_response");
      break;
    }
    if (!includeTools) break; // round 3 declared no tools — shouldn't happen, but never chain further

    const calls: ToolCallReq[] = toolUseBlocks.map((b) => ({
      name: String(b.name),
      args: (b.input as Record<string, unknown>) ?? {},
      id: String(b.id),
    }));
    const toolCalls = await runExecutiveToolCalls(supabase, calls, ctx);
    allToolCalls = [...allToolCalls, ...toolCalls];
    roundMessages = [
      ...roundMessages,
      { role: "assistant" as const, content: blocks },
      {
        role: "user" as const,
        content: toolCalls.map((c) => ({ type: "tool_result", tool_use_id: c.id, content: JSON.stringify(c.result) })),
      },
    ];
  }

  return { text: _buildToolFallbackSummary(allToolCalls), toolCalls: allToolCalls };
}

// ══════════════════════════════════════════════════════════════════════════════
// §8  Orchestrator
// ══════════════════════════════════════════════════════════════════════════════

export async function runExecutiveAssistant(
  supabase: SupabaseClient,
  opts: { phone: string; text: string; msgId: string; profile: ExecutiveProfile },
): Promise<string> {
  const tier = resolveAssistantTier(opts.profile);
  const rulesModule = tier === "front_desk" ? "front_desk" : "executive";
  const ctx: ToolExecCtx = {
    phone: opts.phone,
    originalText: opts.text,
    msgId: opts.msgId,
    ownerPhone: opts.profile.phoneDigits,
    assistantTier: tier,
  };
  const [personaTemplate, rulesSuffix, brief, history] = await Promise.all([
    fetchExecutivePersonaTemplate(supabase),
    fetchExecutiveRules(supabase, opts.profile.phoneDigits, rulesModule),
    tier === "front_desk" ? Promise.resolve("") : fetchResortBrief(supabase),
    fetchExecutiveHistory(supabase, opts.phone),
  ]);
  let briefSnapshot = brief;
  if (tier === "front_desk") {
    const desk = await _execGetArrivalDeskBrief(supabase);
    if (desk.ok && desk.summary) briefSnapshot = String(desk.summary);
  }
  const systemPrompt = buildExecutiveSystemPrompt(opts.profile, personaTemplate, rulesSuffix, briefSnapshot, history);
  const toolDefs = resolveExecutiveToolDefs(opts.profile.phoneDigits, tier);

  try {
    const geminiResult = await runExecutiveGemini(supabase, systemPrompt, history, opts.text, ctx, toolDefs);
    if (geminiResult) return geminiResult.text;
    console.warn("[executiveAssistant] all Gemini models unavailable — falling back to Claude");
  } catch (e) {
    console.error("[executiveAssistant] Gemini path errored — falling back to Claude:", (e as Error).message);
  }

  const claudeResult = await runExecutiveClaude(supabase, systemPrompt, history, opts.text, ctx, toolDefs);
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
    const profile = await resolveStaffAssistantInbound(opts.phone, supabase);
    if (!profile) {
      results.push({ ...base, error: "staff_assistant_not_authorized" });
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

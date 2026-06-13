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
//   META_WEBHOOK_VERIFY_TOKEN | META_WHATSAPP_TOKEN | META_PHONE_NUMBER_ID
//   GEMINI_API_KEY | SUPABASE_URL | SUPABASE_SERVICE_ROLE_KEY
// ══════════════════════════════════════════════════════════════════════════════

import { serve }        from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GEMINI_MODEL = "gemini-2.0-flash";

// ══════════════════════════════════════════════════════════════════════════════
// §1  DYNAMIC BOT CONFIG — loaded from bot_config table, cached 5 min
// ══════════════════════════════════════════════════════════════════════════════

// Fallback static prompt (used if DB is unavailable or bot_config not seeded)
const FALLBACK_SYSTEM_PROMPT = `
אתה "DREAM CONCIERGE" — הקונסיירז' הדיגיטלי הרשמי של Dream Island Resort & Spa.
פרמיום, יוקרתי, אמפתי ומקצועי ביותר — 5 כוכבים בכל משפט. עברית תקנית ואלגנטית בלבד.
תשובות קצרות ומדויקות: 2–4 משפטים בלבד. אל תחשוף שאתה AI.
אם אינך בטוח בפרט — הפנה לקבלה בנימוס.
`.trim();

// Module-level cache: shared across requests within the same function instance
let _configCache: Record<string, string> = {};
let _cacheTime = 0;
const CONFIG_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Cache for bot_settings (admin-controlled prompt override)
let _botSettingsCache: { system_prompt: string; knowledge_base: string } | null = null;
let _botSettingsCacheTime = 0;

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

async function fetchBotSettings(
  supabaseClient: ReturnType<typeof createClient>
): Promise<{ system_prompt: string; knowledge_base: string }> {
  const empty = { system_prompt: "", knowledge_base: "" };
  const now = Date.now();
  if (_botSettingsCache && now - _botSettingsCacheTime < CONFIG_TTL_MS) {
    return _botSettingsCache;
  }
  try {
    const { data, error } = await supabaseClient
      .from("bot_settings")
      .select("system_prompt, knowledge_base")
      .eq("id", 1)
      .maybeSingle();
    if (error || !data) {
      console.warn("[webhook] bot_settings not available:", error?.message ?? "empty");
      return _botSettingsCache ?? empty;
    }
    _botSettingsCache = {
      system_prompt:  ((data as Record<string, unknown>).system_prompt  as string) ?? "",
      knowledge_base: ((data as Record<string, unknown>).knowledge_base as string) ?? "",
    };
    _botSettingsCacheTime = now;
    return _botSettingsCache;
  } catch (e) {
    console.warn("[webhook] fetchBotSettings error:", (e as Error).message);
    return _botSettingsCache ?? empty;
  }
}

function buildSystemPrompt(cfg: Record<string, string>): string {
  if (!Object.keys(cfg).length) return FALLBACK_SYSTEM_PROMPT;

  const botName    = cfg["bot_name"]        ?? "DREAM CONCIERGE";
  const persona    = cfg["bot_personality"] ?? FALLBACK_SYSTEM_PROMPT;
  const checkin    = cfg["hotel_checkin_time"]      ?? "15:00";
  const checkout   = cfg["hotel_checkout_time"]     ?? "11:00";
  const pool       = cfg["hotel_pool_hours"]        ?? "08:00–20:00";
  const spa        = cfg["hotel_spa_hours"]         ?? "09:00–21:00";
  const restaurant = cfg["hotel_restaurant_hours"]  ?? "07:00–22:00";
  const wifi       = cfg["hotel_wifi"]              ?? "DreamIsland_Guest — סיסמה בקבלה";
  const special    = cfg["hotel_special_services"]  ?? "";
  const faqRule    = cfg["response_faq_rule"]       ?? "";

  return `
אתה "${botName}" — הקונסיירז' הדיגיטלי הרשמי של Dream Island Resort & Spa.

══ אישיות ונימה ══
${persona}
• emoji אחד לכל היותר — רק אם מוסיף חמימות

══ ידע הריזורט ══
▸ שעות:
  • צ'ק-אין: ${checkin} | צ'ק-אאוט: ${checkout}
  • בריכה: ${pool}
  • מסעדה: ${restaurant}
  • ספא: ${spa}
  • חדר כושר: 06:00–23:00 | Lobby Bar: 11:00–01:00

▸ שירותים ומתקנים:
  • WiFi: ${wifi}
  • חניה: חינם לאורחים | שירות חדרים: 24/7
  ${special ? `• ${special}` : ""}

══ הנחיות חשובות ══
1. לעולם אל תמציא מחירים, מספרי טלפון, או פרטים שאינם מפורשים.
2. אם אינך בטוח — הפנה לקבלה בנימוס.
3. אל תחשוף שאתה AI — אתה "הקונסיירז' הדיגיטלי של Dream Island".
4. אם האורח מציין שמחכה זמן רב לשירות / יש תקלה — אל תטפל, רק כתוב שהעברת לצוות.
${faqRule ? `5. ${faqRule}` : ""}
`.trim();
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

/** Upsell = day-pass→overnight, late checkout, room upgrade */
const UPSELL_PATTERNS: RegExp[] = [
  // Hebrew
  /ללון|לינה|לישון\s*(כאן|פה|איתכם)|להישאר\s*(הלילה|ללילה|עוד)/i,
  /עוד\s*לילה|לילה\s*נוסף|להאריך\s*(את\s*)?(השהות|ההזמנה)/i,
  /הארכ(ה|ת)\s*(ה)?(שהות|חדר|הזמנה)/i,
  /לצ.?את\s*(יותר\s*)?מאוחר|צ.?ק.?אאוט\s*(מאוחר|מאוחרת|ב)/i,
  /לשדרג|שדרוג|חדר\s*(יותר\s*)?(גדול|טוב|יוקרתי)|לעבור\s*(ל)?סוויטה/i,
  /בילוי\s*יומי.*לינ|day\s*pass.*stay/i,
  // English
  /stay\s*(over|the\s*night|overnight|an?\s*extra|longer)/i,
  /extra\s*night|additional\s*night|extend\s*(my\s*)?(stay|booking)/i,
  /late\s*check.?out|check\s*out\s*late/i,
  /upgrade(\s+my\s+room)?|better\s+room|larger\s+room|move\s+to\s+(a\s+)?suite/i,
];

function classifyIntent(text: string): Intent {
  if (COMPLAINT_PATTERNS.some((p) => p.test(text))) return "complaint";
  if (UPSELL_PATTERNS.some((p) => p.test(text)))    return "upsell";
  if (text.trim().length >= 3)                       return "faq";
  return "fallback";
}

// ── Human-agent request detection ────────────────────────────────────────────

/** Phone/callback keywords → type = "call" */
const HUMAN_CALL_PATTERNS: RegExp[] = [
  /תחייגו|תצלצלו|תתקשרו/i,
  /מספר\s*טלפון/i,
  /תחזרו\s*אל(י|יי)/i,
  /לטלפן|לצלצל/i,
];

/** Human-agent (text/chat) keywords → type = "chat" */
const HUMAN_CHAT_PATTERNS: RegExp[] = [
  /נציג[ה]?/i,
  /מענה\s*אנושי/i,
  /לדבר\s*עם\s*מישהו/i,
  /אדם\s*אנושי|עם\s*אדם/i,
  /בן\s*אדם/i,
  /עם\s*בנ?[אוי]\s*אדם/i,
];

/** Generic "human" keyword — chat type */
const HUMAN_GENERAL_PATTERNS: RegExp[] = [
  /\bאנושי\b/i,
  /\bטלפון\b/i,
];

function detectHumanRequest(text: string): { requested: boolean; type: string | null } {
  if (HUMAN_CALL_PATTERNS.some((p) => p.test(text))) return { requested: true, type: "call" };
  if (HUMAN_CHAT_PATTERNS.some((p) => p.test(text))) return { requested: true, type: "chat" };
  if (HUMAN_GENERAL_PATTERNS.some((p) => p.test(text))) {
    return { requested: true, type: /טלפון/.test(text) ? "call" : "chat" };
  }
  return { requested: false, type: null };
}

// ══════════════════════════════════════════════════════════════════════════════
// §3  PRE-WRITTEN REPLIES — deterministic, instant, always correct Hebrew
// ══════════════════════════════════════════════════════════════════════════════
const FALLBACK_REPLY =
  "תודה רבה על פנייתך. 🙏 " +
  "אני אעביר אותה לצוות הקבלה שלנו, שישמח לסייע לך בהקדם האפשרי.";

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

  console.info(
    `[webhook] 🚨 ALERT — phone:${phone} guest:${guestId ?? "unknown"} conv:${conversationId ?? "?"}`
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// §5  GEMINI — FAQ handler with conversation history context
// ══════════════════════════════════════════════════════════════════════════════
async function askGemini(
  userMessage: string,
  guestName: string | null,
  history: Array<{ direction: string; message: string }>,
  systemPrompt: string,
): Promise<string> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");

  // Build conversation context from last N messages
  const historyBlock =
    history.length > 0
      ? "\n══ שיחה קודמת (לצורך הקשר) ══\n" +
        history
          .map((h) => `${h.direction === "inbound" ? "אורח" : "קונסיירז'"}: ${h.message}`)
          .join("\n") +
        "\n══════════════════════════════\n"
      : "";

  const guestLine = guestName
    ? `\nשם האורח/ת: ${guestName}. פנה/י אליו/ה בשמו/ה.\n`
    : "";

  const fullPrompt =
    systemPrompt +
    guestLine +
    historyBlock +
    `\nהאורח כתב כעת: "${userMessage}"\n\n` +
    `תשובתך (עברית, 2–4 משפטים, נימה פרמיום):`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: fullPrompt }] }],
        generationConfig: {
          maxOutputTokens: 350,
          temperature:     0.65,
          candidateCount:  1,
        },
      }),
      signal: AbortSignal.timeout(15000),
    }
  );

  if (!res.ok) {
    throw new Error(`gemini_${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  const data = await res.json();
  const text =
    data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";
  if (!text) throw new Error("gemini_empty_response");
  return text;
}

// ══════════════════════════════════════════════════════════════════════════════
// §5b PRE-ARRIVAL CONFIRMATION — detect "כן" reply, send payment + workshop
// ══════════════════════════════════════════════════════════════════════════════

/** Matches affirmative replies to the pre-arrival confirmation request. */
const CONFIRMATION_RE = /^(כן|אישור|yes|1|מאשר|מאשרת|כן תודה|כן אישור|אישורי|בסדר|ok)\s*$/i;

const WORKSHOP_SIGNUP_URL = Deno.env.get("WORKSHOP_SIGNUP_URL") ?? "go.oncehub.com/DreamIsland";
const GOOGLE_REVIEW_URL   = Deno.env.get("GOOGLE_REVIEW_URL")   ?? "";

// buttonUrlParam: if set, passes a dynamic URL suffix to button index 0
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

  const components: unknown[] = [];
  if (vars.length > 0) {
    components.push({ type: "body", parameters: vars.map((v) => ({ type: "text", text: v })) });
  }
  if (buttonUrlParam !== undefined) {
    components.push({ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: buttonUrlParam }] });
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
  if (!res.ok) throw new Error(`meta_template_${res.status}: ${(await res.text()).slice(0, 200)}`);
}

const SPA_MENU =
  "🌿 *תפריט ספא Dream Island*\n\n" +
  "💆 *טיפולים זוגיים:*\n" +
  "• ספא בואטסו — 60 דק'\n" +
  "• חמאם ושמנים — 90 דק'\n" +
  "• עיסוי לכל הגוף — 60 דק'\n\n" +
  "💆 *טיפולים אישיים:*\n" +
  "• טיפול פנים — 45 דק'\n" +
  "• עיסוי רגליים — 30 דק'\n" +
  "• עיסוי גב — 30 דק'\n\n" +
  "📞 להזמנה — שלחו לנו את שם הטיפול והשעה המועדפת ונתאם לכם. תמשיכו ליהנות! 🙏";

// ══════════════════════════════════════════════════════════════════════════════
// §6  META CLOUD API — send WhatsApp reply
// ══════════════════════════════════════════════════════════════════════════════
async function sendReply(to: string, body: string): Promise<string> {
  const token   = Deno.env.get("META_WHATSAPP_TOKEN");
  const phoneId = Deno.env.get("META_PHONE_NUMBER_ID");
  if (!token || !phoneId) throw new Error("missing_meta_creds");

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
        to,
        type: "text",
        text: { body, preview_url: false },
      }),
      signal: AbortSignal.timeout(15000),
    }
  );

  if (!res.ok) {
    throw new Error(`meta_send_${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const data = await res.json();
  return data?.messages?.[0]?.id ?? "unknown";
}

// ══════════════════════════════════════════════════════════════════════════════
// §7  MAIN HANDLER
// ══════════════════════════════════════════════════════════════════════════════
serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

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
    console.warn("[webhook] ❌ Meta verification FAILED — token mismatch");
    return new Response("Forbidden", { status: 403 });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // Parse Meta payload
  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return new Response("bad_json", { status: 400 });
  }

  // Drill into Meta's envelope structure
  const entry   = (payload?.entry   as Array<Record<string, unknown>>)?.[0];
  const changes = (entry?.changes   as Array<Record<string, unknown>>)?.[0];
  const value   = changes?.value    as Record<string, unknown> | undefined;
  const msgArr  = (value?.messages  as Array<Record<string, unknown>>) ?? [];

  // ── Fire-and-forget — return 200 immediately, process in background ─────────
  const processAsync = async () => {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Load bot config once per batch (cached 5 min — zero-cost on repeat calls)
    const botConfig    = await fetchBotConfig(supabase);
    const systemPrompt = buildSystemPrompt(botConfig);
    // Human-handover flag: 'false' = bot paused, messages logged but not replied
    const botIsActive  = botConfig["bot_active"] !== "false"; // default true

    // Admin-controlled prompt override (from BotSettings.js UI) — also cached 5 min
    const botSettings = await fetchBotSettings(supabase);
    const kbSuffix = botSettings.knowledge_base?.trim()
      ? `\n\n══ בסיס ידע הריזורט ══\n${botSettings.knowledge_base.trim()}`
      : "";
    // If admin has written a custom system_prompt, it fully overrides the auto-built one.
    // The knowledge_base is always appended (to either source).
    const finalSystemPrompt = botSettings.system_prompt?.trim()
      ? botSettings.system_prompt.trim() + kbSuffix
      : systemPrompt + kbSuffix;

    for (const msg of msgArr) {
      const from  = String(msg.from ?? "");
      const msgId = String(msg.id   ?? "");
      const phone = from.startsWith("+") ? from : `+${from}`;

      // Extract text from both plain text and interactive button_reply messages
      let text = "";
      let isButtonReply = false;
      let buttonTitle   = "";

      if (msg.type === "text") {
        text = (msg.text as Record<string, unknown>)?.body as string ?? "";
        if (!text.trim()) continue;
      } else if (msg.type === "interactive") {
        const interactive = msg.interactive as Record<string, unknown>;
        if ((interactive?.type as string) === "button_reply") {
          isButtonReply = true;
          buttonTitle   = ((interactive?.button_reply as Record<string, unknown>)?.title as string) ?? "";
          text          = buttonTitle;
        } else {
          continue;
        }
      } else {
        continue; // skip images, audio, stickers, etc.
      }

      if (!text.trim()) continue;

      // ── Dedup ─────────────────────────────────────────────────────────────
      const { data: existing } = await supabase
        .from("whatsapp_conversations")
        .select("id")
        .eq("wa_message_id", msgId)
        .maybeSingle();
      if (existing) {
        console.info("[webhook] dedup skip:", msgId);
        continue;
      }

      // ── Lookup registered guest ───────────────────────────────────────────
      const { data: guest } = await supabase
        .from("guests")
        .select("id, name, arrival_confirmed, payment_amount, payment_link_url, msg_pre_arrival_2d_sent, needs_callback, requires_attention")
        .eq("phone", phone)
        .maybeSingle();
      const guestId   = (guest?.id   as number)     ?? null;
      const guestName = (guest?.name as string|null) ?? null;
      const sim       = Deno.env.get("WHATSAPP_SIMULATION") === "true";

      // ── Button reply router ───────────────────────────────────────────────
      // Handles taps on Quick Reply / URL buttons in approved templates.
      // Each branch logs the interaction and sends an appropriate response,
      // then skips normal intent classification.
      if (isButtonReply && buttonTitle) {
        await supabase.from("whatsapp_conversations").insert({
          phone, guest_id: guestId, direction: "inbound",
          message: `[כפתור: ${buttonTitle}]`, wa_message_id: msgId, intent: "button_reply",
        });

        const name = String(guest?.name ?? "");

        // ── "כן, מגיעים! ✨" — arrival confirmed → send payment + workshop ──
        if (buttonTitle.includes("כן, מגיעים") || buttonTitle.includes("כן מגיעים")) {
          await supabase.from("guests").update({ arrival_confirmed: true }).eq("id", guestId);
          const amount   = String((guest as Record<string,unknown>)?.payment_amount ?? "יישלח בנפרד");
          // Extract token suffix from full payment URL for the URL button parameter.
          // Until Gama redirect endpoint is live, falls back to full URL in a text message.
          const fullUrl  = String((guest as Record<string,unknown>)?.payment_link_url ?? "");
          const urlToken = fullUrl ? fullUrl.split("/").pop() ?? fullUrl : "pending";
          if (!sim) {
            try {
              await sendTemplate(phone, "dream_payment_and_workshops", [name, amount], "he", urlToken);
              await supabase.from("whatsapp_conversations").insert({
                phone, guest_id: guestId, direction: "outbound",
                message: "[תבנית: dream_payment_and_workshops]", wa_message_id: null,
              });
            } catch (e) {
              console.error("[webhook] payment_and_workshops send failed:", (e as Error).message);
            }
          } else {
            console.info(`[webhook] SIM — "כן מגיעים" from ${phone}, would send dream_payment_and_workshops`);
          }

        // ── "לא, שינוי בתאריך" — date change → ask + flag for staff ─────────
        } else if (buttonTitle.includes("שינוי בתאריך") || buttonTitle.includes("לא,")) {
          if (guestId) {
            await supabase.from("guests").update({ requires_attention: true, requires_attention_since: new Date().toISOString() }).eq("id", guestId);
          }
          const reply = "מובן לגמרי! 🗓️ מה התאריך החדש המועדף עליכם? שלחו לנו ונעדכן את ההזמנה.";
          if (!sim) {
            try { await sendReply(phone, reply); } catch (e) { console.error("[webhook] reply error:", (e as Error).message); }
          }
          await supabase.from("whatsapp_conversations").insert({
            phone, guest_id: guestId, direction: "outbound", message: reply, wa_message_id: null, intent: "button_reply",
          });

        // ── "ספא וטיפולים 📜" — send spa menu as free text ──────────────────
        } else if (buttonTitle.includes("ספא") || buttonTitle.includes("טיפולים")) {
          if (!sim) {
            try { await sendReply(phone, SPA_MENU); } catch (e) { console.error("[webhook] spa menu send error:", (e as Error).message); }
          }
          await supabase.from("whatsapp_conversations").insert({
            phone, guest_id: guestId, direction: "outbound", message: "[תפריט ספא]", wa_message_id: null, intent: "button_reply",
          });

        // ── "דברו איתי 📞" — callback requested → alert staff ───────────────
        } else if (buttonTitle.includes("דברו איתי") || buttonTitle.includes("מענה אנושי")) {
          if (guestId) {
            await supabase.from("guests").update({
              needs_callback: true, requires_attention: true, requires_attention_since: new Date().toISOString(),
            }).eq("id", guestId);
          }
          const reply = "קיבלנו! 🙏 אחד מהצוות שלנו יצור אתכם קשר בהקדם. תמשיכו ליהנות!";
          if (!sim) {
            try { await sendReply(phone, reply); } catch (e) { console.error("[webhook] reply error:", (e as Error).message); }
          }
          await supabase.from("whatsapp_conversations").insert({
            phone, guest_id: guestId, direction: "outbound", message: reply, wa_message_id: null, intent: "button_reply",
          });

        // ── "היה מושלם! ✨" — positive feedback → send Google review link ────
        } else if (buttonTitle.includes("מושלם") || buttonTitle.includes("מושלמת")) {
          const reviewUrl = GOOGLE_REVIEW_URL || "dream-island.co.il";
          const reply = `שמחנו מאוד לשמוע! 🌟 אם תרצו לשתף את החוויה שלכם — זה יאיר לנו את היום:\n${reviewUrl}\nתודה ענקית ומחכים לכם בפעם הבאה! 💫`;
          if (!sim) {
            try { await sendReply(phone, reply); } catch (e) { console.error("[webhook] reply error:", (e as Error).message); }
          }
          await supabase.from("whatsapp_conversations").insert({
            phone, guest_id: guestId, direction: "outbound", message: reply, wa_message_id: null, intent: "button_reply",
          });

        // ── "יש מקום לשיפור 💬" — negative feedback → collect + flag ────────
        } else if (buttonTitle.includes("לשיפור") || buttonTitle.includes("שיפור")) {
          if (guestId) {
            await supabase.from("guests").update({ requires_attention: true, requires_attention_since: new Date().toISOString() }).eq("id", guestId);
          }
          const reply = "תודה על הכנות — זה חשוב לנו מאוד. 🙏 מה היה אפשר לשפר? כתבו לנו כאן ונשתפר.";
          if (!sim) {
            try { await sendReply(phone, reply); } catch (e) { console.error("[webhook] reply error:", (e as Error).message); }
          }
          await supabase.from("whatsapp_conversations").insert({
            phone, guest_id: guestId, direction: "outbound", message: reply, wa_message_id: null, intent: "button_reply",
          });
        }

        console.info(`[webhook] ✅ button reply handled — "${buttonTitle}" phone:${phone}`);
        continue; // skip normal intent routing
      }

      // ── Text confirmation detection (fallback for guests who type "כן" manually) ──
      if (
        CONFIRMATION_RE.test(text.trim()) &&
        guest?.msg_pre_arrival_2d_sent &&
        !guest?.arrival_confirmed
      ) {
        await supabase.from("guests").update({ arrival_confirmed: true }).eq("id", guestId);
        await supabase.from("whatsapp_conversations").insert({
          phone, guest_id: guestId, direction: "inbound",
          message: text, wa_message_id: msgId, intent: "confirmation",
        });

        const name   = String(guest?.name ?? "");
        const amount = String((guest as Record<string,unknown>).payment_amount ?? "יישלח בנפרד");
        const fullUrl = String((guest as Record<string,unknown>).payment_link_url ?? "");
        const urlToken = fullUrl ? fullUrl.split("/").pop() ?? fullUrl : "pending";

        if (!sim) {
          try {
            await sendTemplate(phone, "dream_payment_and_workshops", [name, amount], "he", urlToken);
            await supabase.from("whatsapp_conversations").insert({
              phone, guest_id: guestId, direction: "outbound",
              message: "[תבנית: dream_payment_and_workshops]", wa_message_id: null,
            });
          } catch (e) {
            console.error("[webhook] payment_and_workshops send failed:", (e as Error).message);
          }
        } else {
          console.info(`[webhook] SIM — text confirmation from ${phone}`);
        }

        console.info(`[webhook] ✅ pre-arrival confirmed (text) — phone:${phone} guest:${guestId}`);
        continue;
      }

      // ── Classify intent (< 1 ms, no AI cost) ─────────────────────────────
      const intent = classifyIntent(text);

      // ── Detect human-agent request ────────────────────────────────────────
      const humanReq = detectHumanRequest(text);
      if (humanReq.requested) {
        console.info(`[webhook] 🙋 human_requested="${humanReq.type}" phone=${phone}`);
      }

      console.info(
        `[webhook] ${phone} | intent="${intent}" | human_req=${humanReq.requested} | "${text.slice(0, 70)}"`
      );

      // ── Save inbound message with intent ─────────────────────────────────
      const { data: savedMsg } = await supabase
        .from("whatsapp_conversations")
        .insert({
          phone,
          guest_id:           guestId,
          direction:          "inbound",
          message:            text,
          wa_message_id:      msgId,
          intent,
          human_requested:    humanReq.requested,
          human_request_type: humanReq.type,
        })
        .select("id")
        .single();
      const conversationId = (savedMsg?.id as number) ?? null;

      // ── Human-handover mode: message logged, no bot reply ─────────────────
      if (!botIsActive) {
        console.info(`[webhook] 🤫 bot paused — inbound logged, skipping reply to ${phone}`);
        continue;
      }

      // ── Route & generate reply ────────────────────────────────────────────
      let reply = FALLBACK_REPLY;

      if (intent === "complaint") {
        // Pre-written empathy reply (never let AI handle complaints)
        reply = buildComplaintReply(guestName);
        // Non-blocking DB alert — duty manager dashboard picks this up
        flagGuestAlert(supabase, phone, guestId, text, conversationId)
          .catch((e: Error) =>
            console.error("[webhook] flagGuestAlert error:", e.message)
          );

      } else if (intent === "upsell") {
        // Pre-written warm upsell response
        reply = buildUpsellReply(guestName);

      } else if (intent === "faq") {
        // Load last 5 messages for conversation context
        const { data: history } = await supabase
          .from("whatsapp_conversations")
          .select("direction, message")
          .eq("phone", phone)
          .order("created_at", { ascending: false })
          .limit(5);

        const orderedHistory = (
          history as Array<{ direction: string; message: string }> | null ?? []
        ).reverse();

        try {
          reply = await askGemini(text, guestName, orderedHistory, finalSystemPrompt);
        } catch (e) {
          console.error("[webhook] Gemini error:", (e as Error).message);
          reply = FALLBACK_REPLY;
        }
      }
      // else "fallback" → FALLBACK_REPLY already set

      // ── Send WhatsApp reply ───────────────────────────────────────────────
      let outboundMsgId: string | null = null;
      try {
        outboundMsgId = await sendReply(phone, reply);
      } catch (e) {
        console.error("[webhook] sendReply error:", (e as Error).message);
      }

      // ── Save outbound message ─────────────────────────────────────────────
      await supabase.from("whatsapp_conversations").insert({
        phone,
        guest_id:      guestId,
        direction:     "outbound",
        message:       reply,
        wa_message_id: outboundMsgId,
        intent,                        // mirror intent for inbox filtering
      });

      console.info(
        `[webhook] ✅ replied (${intent}) to ${phone} | msgId=${outboundMsgId}`
      );
    }
  };

  processAsync().catch((e) =>
    console.error("[webhook] processAsync error:", e)
  );

  // Respond to Meta within 20 s window
  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...CORS, "Content-Type": "application/json" },
  });
});

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
import Anthropic        from "https://esm.sh/@anthropic-ai/sdk@0.20.0";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CLAUDE_MODEL = "claude-sonnet-4-6"; // final fallback when all Gemini models fail

// Ordered fallback list — fastest/most reliable first, falls through on 404.
// Override ALL by setting the GEMINI_MODEL Supabase secret.
const GEMINI_MODELS: string[] = Deno.env.get("GEMINI_MODEL")
  ? [Deno.env.get("GEMINI_MODEL")!]
  : [
      "gemini-2.0-flash-lite",   // fastest, most reliable for short replies
      "gemini-2.0-flash",
      "gemini-2.5-flash",
      "gemini-1.5-flash",
    ];

// ══════════════════════════════════════════════════════════════════════════════
// §1  DYNAMIC BOT CONFIG — loaded from bot_config table, cached 5 min
// ══════════════════════════════════════════════════════════════════════════════

// ── Dynamic Spa Sentence Builder ─────────────────────────────────────────────
// Shared helper for Channel B (Interactive/Bot Script) — generates a complete
// sentence that gracefully handles guests with/without spa appointments.
// Same logic as whatsapp-send (Channel A), ensuring consistent messaging.
function buildSpaSentence(spaTime: unknown): string {
  const time = String(spaTime ?? "").trim();
  if (time && time !== "null" && time !== "undefined") {
    return `הטיפול שלך בספא מתוכנן לשעה ${time}.`;
  }
  return "נשמח לעמוד לרשותך בכל שאלה.";
}

// Fallback static prompt (used if DB is unavailable or bot_config not seeded)
const FALLBACK_SYSTEM_PROMPT = `
אתה "DREAM CONCIERGE" — הקונסיירז' הדיגיטלי הרשמי של Dream Island Resort & Spa.
פרמיום, יוקרתי, אמפתי ומקצועי ביותר — 5 כוכבים בכל משפט. עברית תקנית ואלגנטית בלבד.
תשובות קצרות ומדויקות: 2–4 משפטים בלבד. אל תחשוף שאתה AI.
אם פרט אינו ידוע לך בכלל ולא מופיע ב"פרטי האורח" שצורפו לשיחה — הפנה לקבלה בנימוס.
CRITICAL: אם האורח שואל על פרט אישי שלו (למשל שעת טיפול ספא, מספר חדר, תאריך הגעה)
והפרט הזה כן מופיע ב"פרטי האורח" שצורפו לשיחה — ענה לו ישירות עם הערך המדויק.
אל תפנה אותו לקבלה ואל תכתוב שאינך יודע כשהמידע נמצא לפניך.

══ הנחיות שיחה ══
• אל תפתח כל הודעה ב"שלום" — המשך את השיחה בצורה טבעית כאילו אתה זוכר מה שנאמר
• קרא את היסטוריית השיחה לפני שאתה עונה — אל תחזור על מידע שכבר נמסר
• אם האורח ממשיך נושא שנדון קודם — התייחס אליו ישירות, ללא הקדמות
• דבר בגוף ראשון כנציג הצוות — "נדאג", "נסדר", "נשמח לעזור"
• לעולם אל תכלול תגיות פנימיות כגון [תבנית:...] בתשובתך — הטקסט שלך נשלח ישירות לאורח.
• אם האורח מעלה בקשה, הערה או דרישה ספציפית (למשל: בלונים ליום הולדת, ציוד מיוחד, בקשה לחדר) — אשר/י לו בחמימות שזה נרשם ויועבר לצוות. המערכת שומרת זאת אוטומטית בקובץ האורח — תפקידך רק לאשר זאת בתשובה, לא "לדאוג" לשמירה בעצמך.
`.trim();

// Module-level cache: shared across requests within the same function instance
let _configCache: Record<string, string> = {};
let _cacheTime = 0;
const CONFIG_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Cache for bot_settings (admin-controlled prompt override)
let _botSettingsCache: { system_prompt: string; knowledge_base: string; preferred_model: string | null } | null = null;
let _botSettingsCacheTime = 0;

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

// Resolve template placeholders.
//
// {{SPA_LINE}}          → PRIMARY placeholder for Stage 2 reply:
//                          WITH spa:    "מתואם לכם טיפול בספא בשעה 14:00. בנוסף, "
//                          WITHOUT spa: ""   (the rest of the sentence flows naturally)
// {{OPTIONAL_SPA_TEXT}} → legacy: "מתואם לכם טיפול בספא בשעה 14:00.\n" or "".
// {{SPA_TIME}}          → raw time value, or strips containing sentence if absent.
// {{GUEST_NAME}} / {{WORKSHOP_URL}} → direct substitution.
//
// spaTime should be JUST the time value — "14:00" — not "טיפול 45 דקות בשעה 14:00".
function resolvePlaceholders(
  template: string,
  vars: { guestName: string; spaTime: string | null; workshopUrl: string }
): string {
  // SPA_LINE: "מתואם לכם טיפול בספא בשעה HH:MM. בנוסף, " or "" when no booking.
  // The trailing "בנוסף, " connects naturally to whatever follows.
  const spaLine = vars.spaTime
    ? `מתואם לכם טיפול בספא בשעה ${vars.spaTime}. בנוסף, `
    : "";

  // Legacy placeholder still supported — same optional-inline-clause contract as SPA_LINE.
  const optionalSpaText = vars.spaTime
    ? `מתואם לכם טיפול בספא בשעה ${vars.spaTime}.\n`
    : "";

  // DIAGNOSTIC: exact spa string this function received and computed, right
  // before substitution — call-site logs (search "🩺 resolvePlaceholders input")
  // already show whether the saved script contains the placeholder; this shows
  // what the function itself does with the value once it gets here.
  console.log(
    `[webhook] 🩺 resolvePlaceholders() — spaTime:${JSON.stringify(vars.spaTime)}` +
    ` spaLine:${JSON.stringify(spaLine)} optionalSpaText:${JSON.stringify(optionalSpaText)}`
  );

  // Tolerant of internal whitespace ("{{ OPTIONAL_SPA_TEXT }}") and casing —
  // a script edited by hand via BotScriptEditor is exactly where a stray space
  // or wrong case would silently break a strict literal match, leaving the
  // placeholder text either unreplaced or (worse) silently treated as "absent".
  let text = template
    .replace(/\{\{\s*GUEST_NAME\s*\}\}/gi, vars.guestName)
    .replace(/\{\{\s*WORKSHOP_URL\s*\}\}/gi, vars.workshopUrl)
    .replace(/\{\{\s*SPA_LINE\s*\}\}/gi, spaLine)
    .replace(/\{\{\s*OPTIONAL_SPA_TEXT\s*\}\}/gi, optionalSpaText);

  // Legacy {{SPA_TIME}}: substitute or strip the containing sentence
  if (vars.spaTime) {
    text = text.replace(/\{\{\s*SPA_TIME\s*\}\}/gi, vars.spaTime);
  } else {
    text = text.replace(/[^\n.!?]*\{\{\s*SPA_TIME\s*\}\}[^\n.!?]*[.!?]?\s*/gi, "");
  }

  // FORCED INJECTION (Mike's explicit requirement): a real spa booking must
  // never depend on whether the saved bot_scripts text happens to contain a
  // recognized placeholder. If none of {{SPA_LINE}}/{{OPTIONAL_SPA_TEXT}}/
  // {{SPA_TIME}} were present in the template to absorb it, append the
  // sentence deterministically rather than silently dropping it. Gated on
  // "template had nothing to substitute" so a script that DOES use one of
  // the placeholders correctly never gets a duplicate mention appended.
  const hadSpaPlaceholder = /\{\{\s*(?:SPA_LINE|OPTIONAL_SPA_TEXT|SPA_TIME)\s*\}\}/i.test(template);
  if (vars.spaTime && !hadSpaPlaceholder) {
    console.warn(
      `[webhook] resolvePlaceholders() force-injecting spa sentence — template had no ` +
      `recognized spa placeholder for spaTime="${vars.spaTime}"`
    );
    text = `${text.trim()}\n\nהטיפול שלכם בספא מוזמן לשעה ${vars.spaTime}.`;
  }

  return text.trim();
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

async function fetchBotSettings(
  supabaseClient: ReturnType<typeof createClient>
): Promise<{ system_prompt: string; knowledge_base: string; preferred_model: string | null }> {
  const empty = { system_prompt: "", knowledge_base: "", preferred_model: null };
  const now = Date.now();
  if (_botSettingsCache && now - _botSettingsCacheTime < CONFIG_TTL_MS) {
    return _botSettingsCache;
  }
  try {
    const { data, error } = await supabaseClient
      .from("bot_settings")
      .select("system_prompt, knowledge_base, preferred_model")
      .eq("id", 1)
      .maybeSingle();
    if (error || !data) {
      console.warn("[webhook] bot_settings not available:", error?.message ?? "empty");
      return _botSettingsCache ?? empty;
    }
    _botSettingsCache = {
      system_prompt:   ((data as Record<string, unknown>).system_prompt   as string) ?? "",
      knowledge_base:  ((data as Record<string, unknown>).knowledge_base  as string) ?? "",
      preferred_model: ((data as Record<string, unknown>).preferred_model as string | null) ?? null,
    };
    _botSettingsCacheTime = now;
    return _botSettingsCache;
  } catch (e) {
    console.warn("[webhook] fetchBotSettings error:", (e as Error).message);
    return _botSettingsCache ?? empty;
  }
}

// ── §1d  DYNAMIC MODEL ROUTING — preferred_model A/B testing & cost control ──
// Maps the admin-chosen bot_settings.preferred_model value to a concrete
// routing decision. Reordering (not replacing) GEMINI_MODELS preserves the
// existing 404-resilience chain underneath a cost/quality pick — and the
// "claude" branch still falls through to the full Gemini chain on failure
// (and vice versa) at the call site, so a stale/restricted ANTHROPIC_API_KEY
// can never go silent for guests, even when Claude is the chosen default.
function resolveModelRoute(
  preferredModel: string | null,
): { engine: "gemini" | "claude"; geminiOrder: string[] } {
  const normalized = (preferredModel ?? "").trim();

  if (normalized === "claude" || normalized === CLAUDE_MODEL) {
    return { engine: "claude", geminiOrder: GEMINI_MODELS };
  }

  if (GEMINI_MODELS.includes(normalized)) {
    return {
      engine: "gemini",
      geminiOrder: [normalized, ...GEMINI_MODELS.filter((m) => m !== normalized)],
    };
  }

  // Empty (no override configured) or unrecognized (typo / deprecated model id).
  // Default per Mike's decision: route to Claude first. Only warn for the
  // typo case — an empty value is the normal "no override set" state, not an error.
  if (normalized) {
    console.warn(`[webhook] unknown preferred_model "${normalized}" — ignoring, defaulting to claude`);
  }
  return { engine: "claude", geminiOrder: GEMINI_MODELS };
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
2. אם פרט אינו ידוע לך בכלל ולא מופיע ב"פרטי האורח הנוכחי" שצורפו לשיחה — הפנה לקבלה בנימוס.
3. CRITICAL: אם האורח שואל על פרט אישי שלו (למשל שעת טיפול ספא, מספר חדר, תאריך הגעה) והפרט
   הזה כן מופיע ב"פרטי האורח הנוכחי" שצורפו לשיחה — ענה לו ישירות עם הערך המדויק. אל תפנה אותו
   לקבלה ואל תכתוב שאינך יודע כשהמידע נמצא לפניך.
4. אל תחשוף שאתה AI — אתה "הקונסיירז' הדיגיטלי של Dream Island".
5. אם האורח מציין שמחכה זמן רב לשירות / יש תקלה — אל תטפל, רק כתוב שהעברת לצוות.
6. אל תפתח כל הודעה ב"שלום [שם]" — זה נראה רובוטי. המשך את השיחה בצורה אנושית וטבעית.
7. קרא את היסטוריית השיחה ואל תחזור על מידע שכבר נמסר.
8. אם ידוע לך שלב האורח (לפני הגעה / במהלך שהות) — התאם את הטון בהתאם.
${faqRule ? `9. ${faqRule}` : ""}
10. לעולם אל תכלול תגיות פנימיות כגון [תבנית:...] או [...] בתשובתך — הטקסט שלך נשלח ישירות לאורח.
11. אם האורח מעלה בקשה, הערה או דרישה ספציפית (כגון בלונים ליום הולדת, ציוד מיוחד, בקשה לחדר) — אשר/י לו בחמימות שזה נרשם ויועבר לצוות. המערכת שומרת כל הודעה כזו אוטומטית בקובץ האורח — תפקידך רק לאשר זאת בתשובה באופן טבעי.
`.trim();
}

// ── §1c  GUEST STAGE CONTEXT — injected into every AI prompt ────────────────
// Tells the AI what stage the guest is in so it can adapt tone & content.
function buildGuestStageContext(
  guest: Record<string, unknown> | null,
  conversationHistory: Array<{ direction: string; message: string }>
): string {
  if (!guest) return "";

  const today    = new Date().toISOString().split("T")[0];
  const arrDate  = guest.arrival_date as string | null;
  const room     = guest.room        as string | null;
  const roomType = guest.room_type   as string | null;
  const confirmed = guest.arrival_confirmed as boolean | null;
  const spaTime  = guest.spa_time    as string | null;

  let stage = "";
  if (arrDate) {
    if (arrDate > today)       stage = "טרם הגעה";
    else if (arrDate === today) stage = "יום הגעה — האורח מגיע היום";
    else                        stage = "בתוך השהות";
  }

  // Detect if conversation already has an opening template message so AI knows context
  const hasStage2 = conversationHistory.some(
    h => h.direction === "outbound" && h.message.includes("איזה כיף")
  );
  const hasStage3 = conversationHistory.some(
    h => h.direction === "outbound" && h.message.includes("בוקר אור")
  );

  const parts: string[] = [];
  if (stage)      parts.push(`שלב האורח: ${stage}`);
  if (arrDate)    parts.push(`תאריך הגעה: ${arrDate}`);
  if (room)       parts.push(`חדר: ${room}`);
  if (roomType === "suite") parts.push("סוג: סוויטה");
  if (confirmed)  parts.push("אישר הגעה: כן");
  if (spaTime)    parts.push(`שעת טיפול ספא: ${spaTime}`);
  if (hasStage2)  parts.push("כבר קיבל הודעת אישור+ספא");
  if (hasStage3)  parts.push("כבר קיבל הודעת בוקר הגעה");

  return parts.length > 0 ? parts.join(" | ") : "";
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

/** Date-change, cancellation, or booking issue → escalate to human staff, never AI */
const DATE_CHANGE_RE =
  /שינוי\s*(ב)?תאריכ|שינוי\s*הזמנ|לשנות\s*(את\s*)?(ה)?תאריכ|לבטל|ביטול|לא\s*נוכל??\s*להגיע|לא\s*יכול(ים|ה)?\s*להגיע|לא\s*מגיעים|דחיי?ה|להדחות|בעיה\s*עם\s*(ה)?הזמנ/i;

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

// ── Gemini model auto-discovery (used only when all hardcoded models 404) ────
let _discoveredModel: string | null = null;
let _discoveredModelTime = 0;
const DISCOVER_TTL_MS = 60 * 60 * 1000; // 1 hour

async function discoverGeminiModel(apiKey: string): Promise<string | null> {
  const now = Date.now();
  if (_discoveredModel && now - _discoveredModelTime < DISCOVER_TTL_MS) return _discoveredModel;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}&pageSize=100`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) return null;
    const data = await res.json();
    const candidates: string[] = ((data.models ?? []) as Array<{ name: string; supportedGenerationMethods?: string[] }>)
      .filter(m => m.name.includes("flash") && m.supportedGenerationMethods?.includes("generateContent"))
      .map(m => m.name.replace("models/", ""))
      .sort((a, b) => b.localeCompare(a));
    const chosen = candidates[0] ?? null;
    if (chosen) { _discoveredModel = chosen; _discoveredModelTime = now; }
    console.log(`[webhook] Gemini model discovery — candidates:${candidates.length} chosen:${chosen ?? "none"}`);
    return chosen;
  } catch (e) {
    console.warn("[webhook] model discovery failed:", (e as Error).message);
    return null;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// §5  GEMINI — FAQ handler with conversation history context
// ══════════════════════════════════════════════════════════════════════════════
async function askGemini(
  userMessage: string,
  guestName: string | null,
  history: Array<{ direction: string; message: string }>,
  systemPrompt: string,
  modelOrder: string[] = GEMINI_MODELS,
): Promise<string> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");

  // Guest name instruction — use naturally, never open with "שלום [שם]" every time
  const guestLine = guestName
    ? `\nשם האורח/ת: ${guestName}. השתמש/י בשמו/ה בטבעיות בתוך התשובה רק כשמתאים — לא בכל פתיחה.\n`
    : "";

  // Build multi-turn conversation so Gemini gets proper dialog context
  // System instructions go into the first user turn to ensure they're always respected.
  const systemTurn = {
    role: "user",
    parts: [{ text: systemPrompt + guestLine + "\nהבנת את התפקיד? ענה 'כן' בלבד." }],
  };
  const confirmTurn = { role: "model", parts: [{ text: "כן" }] };

  // History turns: inbound → user role, outbound → model role
  const historyTurns = history.map((h) => ({
    role: h.direction === "inbound" ? "user" : "model",
    parts: [{ text: h.message }],
  }));

  // Final user turn — current message
  const currentTurn = {
    role: "user",
    parts: [{ text: `${userMessage}\n\n(ענה בעברית)` }],
  };

  const contents = [systemTurn, confirmTurn, ...historyTurns, currentTurn];

  const body = JSON.stringify({
    contents,
    generationConfig: { maxOutputTokens: 1000, temperature: 0.65, candidateCount: 1 },
  });

  for (const model of modelOrder) {
    console.log(`[webhook] calling Gemini model="${model}" msgLen=${userMessage.length}`);
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body, signal: AbortSignal.timeout(8000) },
    );

    if (res.status === 404) {
      const errBody = await res.text();
      console.warn(`[webhook] Gemini model "${model}" not found — trying next. ${errBody.slice(0, 150)}`);
      continue;
    }

    if (!res.ok) {
      const errBody = await res.text();
      console.error(`[webhook] Gemini ${res.status} model="${model}":`, errBody.slice(0, 400));
      throw new Error(`gemini_${res.status}: ${errBody.slice(0, 200)}`);
    }

    const data = await res.json();
    // Skip thinking-mode parts (gemini-2.5 returns thought:true blocks before the real reply)
    const rawParts = (data?.candidates?.[0]?.content?.parts ?? []) as Array<{ thought?: boolean; text?: string }>;
    const realPart = rawParts.find(p => !p.thought && typeof p.text === "string");
    const text = (realPart?.text ?? "").trim();
    if (!text) throw new Error("gemini_empty_response");
    console.log(`[webhook] Gemini OK model="${model}"`);
    return text;
  }

  // All hardcoded models failed → query the API to find whatever is currently available
  const discovered = await discoverGeminiModel(apiKey);
  if (discovered && !modelOrder.includes(discovered)) {
    console.log(`[webhook] trying auto-discovered model="${discovered}"`);
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${discovered}:generateContent?key=${apiKey}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body, signal: AbortSignal.timeout(8000) },
    );
    if (res.ok) {
      const data = await res.json();
      const rawParts2 = (data?.candidates?.[0]?.content?.parts ?? []) as Array<{ thought?: boolean; text?: string }>;
      const realPart2 = rawParts2.find(p => !p.thought && typeof p.text === "string");
      const text = (realPart2?.text ?? "").trim();
      if (text) { console.log(`[webhook] Gemini OK (discovered) model="${discovered}"`); return text; }
    }
  }

  throw new Error("gemini_all_models_unavailable");
}

// ── Claude fallback — used when all Gemini models are unavailable ─────────────
async function callClaude(
  userMessage: string,
  guestName: string | null,
  history: Array<{ direction: string; message: string }>,
  systemPrompt: string,
): Promise<string> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("no_anthropic_key");

  const system = systemPrompt
    + (guestName ? `\n\nשם האורח/ת: ${guestName}. פנה/י אליו/ה בשמו/ה.` : "")
    + "\n\nענה תמיד בעברית.";

  // Convert history to Claude alternating user/assistant format
  const rawMessages = [
    ...history.map((h) => ({
      role: (h.direction === "inbound" ? "user" : "assistant") as "user" | "assistant",
      content: h.message,
    })),
    { role: "user" as const, content: userMessage },
  ];

  // Merge consecutive messages with the same role (Claude requires strict alternation)
  const messages = rawMessages.reduce<{ role: "user" | "assistant"; content: string }[]>(
    (acc, msg) => {
      if (acc.length && acc[acc.length - 1].role === msg.role) {
        acc[acc.length - 1] = { ...acc[acc.length - 1], content: acc[acc.length - 1].content + "\n" + msg.content };
      } else {
        acc.push(msg);
      }
      return acc;
    },
    [],
  );

  const anthropic = new Anthropic({ apiKey: key });
  const resp = await anthropic.messages.create({
    model:      CLAUDE_MODEL,
    max_tokens: 1000,
    system,
    messages,
  });

  const text = resp.content[0].type === "text" ? resp.content[0].text.trim() : "";
  if (!text) throw new Error("claude_empty_response");
  console.log(`[webhook] ✅ Claude OK (fallback) engine=${CLAUDE_MODEL}`);
  return text;
}

// ══════════════════════════════════════════════════════════════════════════════
// §5b PRE-ARRIVAL CONFIRMATION — detect "כן" reply, send payment + workshop
// ══════════════════════════════════════════════════════════════════════════════

/** Matches affirmative replies to the pre-arrival confirmation request.
 *  Handles typed variants: "כן", "כן מגיעים", "מגיעים!", "אנחנו מגיעים", etc.
 */
const CONFIRMATION_RE = /^[\s🎉✨😊🙂🙏💫🌴]*(?:כן[,!\s.]*)?(?:מגיעים|אנחנו מגיעים|כן מגיעים|כן,מגיעים|כן! מגיעים|כן|אישור|yes|1|מאשר|מאשרת|כן תודה|כן אישור|אישורי|בסדר|ok|נראה מצוין|מצוין)[\s🎉✨😊🙂🙏💫🌴!.,]*$/iu;

const WORKSHOP_SIGNUP_URL = Deno.env.get("WORKSHOP_SIGNUP_URL") ?? "go.oncehub.com/DreamIsland";
const GOOGLE_REVIEW_URL   = Deno.env.get("GOOGLE_REVIEW_URL")   ?? "";

// A timeout/abort means we never learned whether Meta processed the request —
// not the same as Meta rejecting it. Tagged distinctly so callers (notification_log
// writers, AICopilot, etc.) can report "outcome unknown" instead of a confident
// but possibly-wrong "failed" (FAIL VISIBLE, CLAUDE.md §0.3).
function _isAbortError(e: unknown): boolean {
  return e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError");
}

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
    // index must be integer (not string) — Meta rejects "0" as string
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

/** Strip internal instruction tags the LLM may echo into its reply before sending to guest. */
function sanitizeReply(text: string): string {
  return text
    // Remove explicit template-name markers like [תבנית: dream_arrival_confirmation]
    .replace(/\[תבנית[^\]]*\]/gi, "")
    // Remove short bracketed tokens that match Hebrew/alphanumeric internal tags
    .replace(/\[[֐-׿\w\-_:]{2,60}\]/g, "")
    // Collapse triple+ blank lines left after stripping
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}


// ══════════════════════════════════════════════════════════════════════════════
// §6  META CLOUD API — send WhatsApp reply
// ══════════════════════════════════════════════════════════════════════════════
async function sendReply(to: string, body: string): Promise<string> {
  const token   = Deno.env.get("META_WHATSAPP_TOKEN");
  const phoneId = Deno.env.get("META_PHONE_NUMBER_ID");
  if (!token || !phoneId) throw new Error("missing_meta_creds");

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
          to,
          type: "text",
          text: { body, preview_url: false },
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

// ══════════════════════════════════════════════════════════════════════════════
// §7  MAIN HANDLER
// ══════════════════════════════════════════════════════════════════════════════
serve(async (req: Request) => {
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

  // ── DIAGNOSTIC: dump raw payload so we can see exactly what Meta sends ───────
  console.log("[webhook] 🔬 raw payload:", JSON.stringify(payload).slice(0, 1000));

  // Drill into Meta's envelope structure
  const entry   = (payload?.entry   as Array<Record<string, unknown>>)?.[0];
  const changes = (entry?.changes   as Array<Record<string, unknown>>)?.[0];
  const value   = changes?.value    as Record<string, unknown> | undefined;
  const msgArr  = (value?.messages  as Array<Record<string, unknown>>) ?? [];

  console.log(`[webhook] payload parsed — messages:${msgArr.length} statuses:${((value?.statuses as unknown[]) ?? []).length}`);

  // ── Fire-and-forget — return 200 immediately, process in background ─────────
  const processAsync = async () => {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Load all config in parallel — each has its own 5-min cache
    const [botConfig, botSettings, scripts] = await Promise.all([
      fetchBotConfig(supabase),
      fetchBotSettings(supabase),
      fetchBotScripts(supabase),
    ]);

    const systemPrompt = buildSystemPrompt(botConfig);
    // Human-handover flag: 'false' = bot paused, messages logged but not replied
    const botIsActive  = botConfig["bot_active"] !== "false"; // default true

    const kbSuffix = botSettings.knowledge_base?.trim()
      ? `\n\n══ בסיס ידע הריזורט ══\n${botSettings.knowledge_base.trim()}`
      : "";

    // System prompt priority (highest → lowest):
    //   1. bot_settings.system_prompt (admin override via BotSettings UI)
    //   2. bot_scripts[ongoing_concierge].ai_system_prompt (BotScriptEditor)
    //   3. buildSystemPrompt(botConfig) (auto-built from bot_config values)
    const ongoingScript = scripts["ongoing_concierge"];
    const finalSystemPrompt =
      botSettings.system_prompt?.trim()
        ? botSettings.system_prompt.trim() + kbSuffix
        : (ongoingScript?.ai_system_prompt?.trim()
            ? ongoingScript.ai_system_prompt.trim() + kbSuffix
            : systemPrompt + kbSuffix);

    console.info(`[webhook] prompt source: ${
      botSettings.system_prompt?.trim() ? "bot_settings" :
      ongoingScript?.ai_system_prompt?.trim() ? "bot_scripts/ongoing_concierge" : "bot_config"
    }`);

    for (const msg of msgArr) {
      const from  = String(msg.from ?? "");
      const msgId = String(msg.id   ?? "");
      const phone = from.startsWith("+") ? from : `+${from}`;

      // Phone format variants — guests.phone SHOULD be E.164 ("+972...") per
      // documented convention, but real-world data entry (manual add, CSV
      // import) has produced local-format ("0...") rows too. Confirmed root
      // cause of a live bug: a guest stored in the "wrong" format was
      // invisible to a single-format lookup, so status/spa_time/guest_alerts
      // all silently no-op'd because guestId never resolved. Match against
      // every plausible stored variant instead of assuming one canonical one.
      const phoneDigits   = phone.replace(/\D/g, "");                                            // "972XXXXXXXXX"
      const phoneLocal    = phoneDigits.startsWith("972") ? "0" + phoneDigits.slice(3) : phoneDigits; // "0XXXXXXXXX"
      const phoneVariants = [phone, phoneDigits, phoneLocal];                                     // ["+972...","972...","0..."]

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
      } else {
        console.log(`[webhook] ⏭️ msg type "${msg.type}" — skipped`);
        continue; // skip images, audio, stickers, etc.
      }

      if (!text.trim()) continue;

      // ── Dedup + guest lookup in parallel (saves ~300ms per message) ──────
      const [{ data: existing }, { data: guest }] = await Promise.all([
        supabase
          .from("whatsapp_conversations")
          .select("id")
          .eq("wa_message_id", msgId)
          .maybeSingle(),
        supabase
          .from("guests")
          .select("id, name, arrival_confirmed, payment_amount, payment_link_url, msg_pre_arrival_2d_sent, needs_callback, requires_attention, arrival_date, room, room_type, spa_time, status, guest_notes")
          .in("phone", phoneVariants)
          .maybeSingle(),
      ]);
      if (existing) {
        console.info("[webhook] dedup skip:", msgId);
        continue;
      }
      const guestId   = (guest?.id   as number)     ?? null;
      const guestName = (guest?.name as string|null) ?? null;
      const sim       = Deno.env.get("WHATSAPP_SIMULATION") === "true";

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

      // ── Human-handoff gate — thread claimed by staff, bot is silenced ─────
      // Set when guest clicks "לא,שינוי בתאריך" or types a date-change request.
      //
      // Override rule: arrival confirmations ALWAYS break the lock, whether the
      // guest taps the button ("כן,מגיעים!") or types it ("כן", "מגיעים", etc.).
      // Staff can also reset the flag manually from the GuestsPage dashboard.
      if (guest?.needs_callback === true) {
        const _heb = (s: string) => s.replace(/[^א-ת]/g, "");
        const _th  = _heb(buttonTitle);
        const _idl = buttonId.toLowerCase();

        // Button-tap override: matches "כן,מגיעים!" and any known confirm variant
        const isButtonConfirm = isButtonReply && (
          (_th.includes("כן") && _th.includes("מגיעים")) ||
          _th === "כןמגיעים" ||
          _idl.includes("confirm") || _idl.includes("arriving") || _idl.includes("yes_arrive")
        );
        // Typed-text override: matches any affirmative in CONFIRMATION_RE
        const isTypedConfirm  = !isButtonReply && CONFIRMATION_RE.test(text.trim());
        const isArrivalOverride = isButtonConfirm || isTypedConfirm;

        if (isArrivalOverride) {
          // Clear the lock so normal routing handles the confirmation
          if (guestId) {
            const { error: cbErr } = await supabase
              .from("guests").update({ needs_callback: false }).eq("id", guestId);
            if (cbErr) console.warn("[webhook] needs_callback clear error:", cbErr.message);
            else console.info(`[webhook] 🔓 needs_callback cleared for ${phone}`);
          }
          // fall through — button router or text-confirmation path runs below
        } else {
          // Postgrest builder is PromiseLike (.then only) — not a full Promise,
          // so .catch() chained directly on it throws "...insert(...).catch is
          // not a function" instead of swallowing the error. Use try/catch.
          try {
            const { error: logErr } = await supabase.from("whatsapp_conversations").insert({
              phone, guest_id: guestId, direction: "inbound",
              message: isButtonReply ? buttonTitle : text,
              wa_message_id: msgId, intent: "human_handoff",
            });
            if (logErr) console.warn("[webhook] human_handoff log error:", logErr.message);
          } catch (e) { console.warn("[webhook] human_handoff log error:", (e as Error).message); }
          console.info(`[webhook] 🔕 thread in human-handoff (needs_callback) — silenced for ${phone}`);
          continue;
        }
      }

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

        await supabase.from("whatsapp_conversations").insert({
          phone, guest_id: guestId, direction: "inbound",
          message: buttonTitle, wa_message_id: msgId, intent: "button_reply",
          ...(isDateChangeButton ? { human_requested: true, human_request_type: "date_change" } : {}),
          ...(isCallbackButton   ? { human_requested: true, human_request_type: "callback" }    : {}),
        });

        const name = String(guest?.name ?? "");

        // ── "כן, מגיעים! ✨" — arrival confirmed → warm conversational reply ──
        // Strategy: tapping this button opens the 24h free-text window.
        // We reply with a natural message — no template needed.
        // Payment link is sent later by staff via the GuestsPage 💳 button.
        //
        // Matching strategy: strip ALL non-Hebrew characters (emoji, spaces, punctuation)
        // so "כן, מגיעים! ✨" / "כן מגיעים" / "כן,מגיעים" all become "כןמגיעים".
        const hebrewOnly = (s: string) => s.replace(/[^א-ת]/g, "");
        const titleHeb   = hebrewOnly(buttonTitle);
        const idHeb      = hebrewOnly(buttonId);
        const isArrivalConfirm =
          // Hebrew text: must contain both "כן" and "מגיעים" (or just "מגיעים")
          (titleHeb.includes("כן") && titleHeb.includes("מגיעים")) ||
          titleHeb === "כןמגיעים" ||
          // Some Meta templates use a known button ID
          idHeb.includes("כןמגיעים") ||
          buttonId.toLowerCase().includes("confirm") ||
          buttonId.toLowerCase().includes("arriving") ||
          buttonId.toLowerCase().includes("yes_arrive");
        if (isArrivalConfirm) {
          // Promote pending → expected ("ממתין" in STATUS_META/GuestsPage.js) only
          // from the pre-confirmation state — never revert a guest who is already
          // further along (room_ready/checked_in) just because a stray confirmation
          // text matched after the fact.
          if (guestId) {
            const { error: confirmErr } = await supabase.from("guests").update({
              arrival_confirmed: true,
              ...(guest?.status === "pending" ? { status: "expected" } : {}),
            }).eq("id", guestId);
            if (confirmErr) console.error(`[webhook] arrival_confirmed update FAILED phone:${phone}:`, confirmErr.message);
          } else {
            // No guest row for this phone at all — status/spa_time can never
            // update or appear, because there's nothing in `guests` to read
            // from or write to. Not a routing bug: this is what happens when
            // a phone number was never added via AddGuestModal/import.
            console.warn(`[webhook] ⚠️ arrival confirm tapped but NO guest record exists for phone:${phone} — add this guest first (GuestsPage/GuestDashboard) for status sync or spa_time to do anything.`);
          }

          const safeName    = name.trim() || "אורח יקר";
          const workshopUrl = Deno.env.get("WORKSHOP_SIGNUP_URL") ?? "";
          const spaTime     = (guest?.spa_time as string | null) ?? null;

          // Use stage_2_arrival script from BotScriptEditor if available
          const stage2Script = scripts["stage_2_arrival"];
          let arrivalReply: string;
          if (stage2Script?.message_text?.trim()) {
            // DIAGNOSTIC (session 10): pins down spa_time placeholder issues without
            // guessing — logs the exact DB value and whether the saved script text
            // contains the placeholder at all, so a future report has hard evidence.
            const hasOptionalSpaText = /\{\{\s*OPTIONAL_SPA_TEXT\s*\}\}/i.test(stage2Script.message_text);
            const hasSpaLine         = /\{\{\s*SPA_LINE\s*\}\}/i.test(stage2Script.message_text);
            const hasSpaTimeLegacy   = /\{\{\s*SPA_TIME\s*\}\}/i.test(stage2Script.message_text);
            console.log(
              `[webhook] 🩺 resolvePlaceholders input — phone:${phone} spaTime:${JSON.stringify(spaTime)}` +
              ` scriptHasOptionalSpaText:${hasOptionalSpaText} scriptHasSpaLine:${hasSpaLine} scriptHasSpaTime:${hasSpaTimeLegacy}`
            );
            // FAIL VISIBLE: a guest with a real spa booking whose saved script has
            // no spa placeholder at all will never mention it, silently, regardless
            // of DB data — this is the "Condition B with valid spa_time" report.
            if (spaTime && !hasOptionalSpaText && !hasSpaLine && !hasSpaTimeLegacy) {
              console.warn(
                `[webhook] ⚠️ guest ${phone} has spa_time="${spaTime}" but the saved ` +
                `stage_2_arrival script contains no spa placeholder ({{SPA_LINE}}/` +
                `{{OPTIONAL_SPA_TEXT}}/{{SPA_TIME}}) — reply will never mention spa. ` +
                `Check the script text in BotScriptEditor.`
              );
            }
            arrivalReply = resolvePlaceholders(stage2Script.message_text, {
              guestName: safeName, spaTime, workshopUrl,
            });
          } else {
            // Dynamic Sentence approach — single code path for both spa/no-spa cases
            const spaSentence = buildSpaSentence(spaTime);
            const workshopLine = workshopUrl
              ? `\n\n🎯 *לסדנאות שלנו — הרשמו מראש:*\n👉 ${workshopUrl}`
              : "";
            arrivalReply =
              `מגיעים! 🎉 כבר מתרגשים מאד מהגעתכם, ${safeName}!\n\n` +
              `הצוות שלנו ב-Dream Island מכין את הכל ומחכה לכם עם חיוך גדול 🌴\n\n` +
              spaSentence +
              workshopLine +
              `\n\nיש לכם שאלות לפני ההגעה? על הצ׳ק-אין, החדר — אני כאן לכל שאלה 😊`;
          }

          console.info(`[webhook] 🎉 arrival confirmed — phone:${phone} name="${safeName}"`);

          try {
            await sendReply(phone, arrivalReply);
            await supabase.from("whatsapp_conversations").insert({
              phone, guest_id: guestId, direction: "outbound",
              message: arrivalReply, wa_message_id: null,
            });
            console.info(`[webhook] ✅ arrival reply sent to ${phone}`);
          } catch (e) {
            const errMsg = (e as Error).message;
            const replyStatus = errMsg.startsWith("timeout_no_response") ? "timeout" : "failed";
            console.error(`[webhook] ❌ arrival reply ${replyStatus} to ${phone}:`, errMsg);
            try {
              const { error: logErr } = await supabase.from("notification_log").insert({
                guest_id: guestId, recipient: phone,
                trigger_type: "arrival_confirmed_reply", channel: "whatsapp",
                status: replyStatus, payload: { error: errMsg, buttonTitle },
              });
              if (logErr) console.warn("[webhook] notification_log insert error:", logErr.message);
            } catch (e) { console.warn("[webhook] notification_log insert error:", (e as Error).message); }
          }

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
            if (error) console.warn("[webhook] guest_alerts (button date_change) error:", error.message);
          })().catch((e: Error) => console.warn("[webhook] guest_alerts (button date_change) error:", e.message));
          const dateChangeReply =
            "העברתי את בקשתך לצוות הסוויטות שלנו (אדיר ואפק), והם יצרו איתך קשר בהקדם. 🙏";
          try { await sendReply(phone, dateChangeReply); } catch (e) { console.error("[webhook] reply error:", (e as Error).message); }
          await supabase.from("whatsapp_conversations").insert({
            phone, guest_id: guestId, direction: "outbound", message: dateChangeReply, wa_message_id: null, intent: "date_change_request",
          });

        // ── "ספא וטיפולים 📜" — send spa menu as free text ──────────────────
        } else if (buttonTitle.includes("ספא") || buttonTitle.includes("טיפולים")) {
          const spaMenuText = scripts["spa_menu"]?.message_text?.trim() || SPA_MENU;
          try { await sendReply(phone, spaMenuText); } catch (e) { console.error("[webhook] spa menu send error:", (e as Error).message); }
          await supabase.from("whatsapp_conversations").insert({
            phone, guest_id: guestId, direction: "outbound", message: "[תפריט ספא]", wa_message_id: null, intent: "button_reply",
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
          try { await sendReply(phone, callbackReply); } catch (e) { console.error("[webhook] reply error:", (e as Error).message); }
          await supabase.from("whatsapp_conversations").insert({
            phone, guest_id: guestId, direction: "outbound", message: callbackReply, wa_message_id: null, intent: "button_reply",
          });

        // ── "היה מושלם! ✨" — positive feedback → send Google review link ────
        } else if (buttonTitle.includes("מושלם") || buttonTitle.includes("מושלמת")) {
          const reviewUrl = GOOGLE_REVIEW_URL || "dream-island.co.il";
          const feedbackReply = scripts["positive_feedback_reply"]?.message_text?.trim()
            ? scripts["positive_feedback_reply"]!.message_text!.replace(/\{\{\s*GOOGLE_REVIEW_URL\s*\}\}/gi, reviewUrl)
            : `שמחנו מאוד לשמוע! 🌟 אם תרצו לשתף את החוויה שלכם — זה יאיר לנו את היום:\n${reviewUrl}\nתודה ענקית ומחכים לכם בפעם הבאה! 💫`;
          try { await sendReply(phone, feedbackReply); } catch (e) { console.error("[webhook] reply error:", (e as Error).message); }
          await supabase.from("whatsapp_conversations").insert({
            phone, guest_id: guestId, direction: "outbound", message: feedbackReply, wa_message_id: null, intent: "button_reply",
          });

        // ── "יש מקום לשיפור 💬" — negative feedback → collect + flag ────────
        } else if (buttonTitle.includes("לשיפור") || buttonTitle.includes("שיפור")) {
          if (guestId) {
            await supabase.from("guests").update({ requires_attention: true, requires_attention_since: new Date().toISOString() }).eq("id", guestId);
          }
          const improvReply = scripts["negative_feedback_reply"]?.message_text?.trim()
            || "תודה על הכנות — זה חשוב לנו מאוד. 🙏 מה היה אפשר לשפר? כתבו לנו כאן ונשתפר.";
          try { await sendReply(phone, improvReply); } catch (e) { console.error("[webhook] reply error:", (e as Error).message); }
          await supabase.from("whatsapp_conversations").insert({
            phone, guest_id: guestId, direction: "outbound", message: improvReply, wa_message_id: null, intent: "button_reply",
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
          try { await sendReply(phone, upsellPositiveReply); } catch (e) { console.error("[webhook] upsell reply error:", (e as Error).message); }
          await supabase.from("whatsapp_conversations").insert({
            phone, guest_id: guestId, direction: "outbound",
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
          try { await sendReply(phone, declineReply); } catch (e) { console.error("[webhook] decline reply error:", (e as Error).message); }
          await supabase.from("whatsapp_conversations").insert({
            phone, guest_id: guestId, direction: "outbound",
            message: declineReply, wa_message_id: null, intent: "button_reply",
          });

        // ── Unrecognized button — generic reply so no button is ever silent ──
        } else {
          console.warn(`[webhook] ⚠️ unmatched button title="${buttonTitle}" id="${buttonId}" — sending generic reply`);
          const genericReply = scripts["generic_button_reply"]?.message_text?.trim()
            || "תודה! 😊 קיבלנו את בחירתך. האם יש משהו נוסף שנוכל לעשות עבורכם?";
          try { await sendReply(phone, genericReply); } catch (e) { console.error("[webhook] generic button reply error:", (e as Error).message); }
          await supabase.from("whatsapp_conversations").insert({
            phone, guest_id: guestId, direction: "outbound", message: genericReply, wa_message_id: null, intent: "button_reply",
          });
        }

        console.info(`[webhook] ✅ button reply handled — "${buttonTitle}" phone:${phone}`);
        continue; // skip normal intent routing
      }

      // ── Text confirmation detection (fallback for guests who type "כן" manually) ──
      // Gate is lifecycle-based (not yet checked in / not cancelled), not on
      // msg_pre_arrival_2d_sent — that flag only flips once whatsapp-cron's
      // T-2 reminder fires, and CRON_ENABLED has never been turned on in this
      // project (see CLAUDE.md §6 KILL SWITCH), so the old guard made this
      // entire fallback path permanently dead in production.
      if (
        CONFIRMATION_RE.test(text.trim()) &&
        !guest?.arrival_confirmed &&
        guest?.status !== "checked_in" &&
        guest?.status !== "cancelled"
      ) {
        // Same pending → expected guard as the button-tap path above.
        if (!guestId) {
          console.warn(`[webhook] ⚠️ typed confirmation matched but NO guest record exists for phone:${phone} — nothing to update.`);
        }
        const { error: confirmErr2 } = await supabase.from("guests").update({
          arrival_confirmed: true,
          ...(guest?.status === "pending" ? { status: "expected" } : {}),
        }).eq("id", guestId);
        if (confirmErr2) console.error(`[webhook] arrival_confirmed (text) update FAILED phone:${phone}:`, confirmErr2.message);
        await supabase.from("whatsapp_conversations").insert({
          phone, guest_id: guestId, direction: "inbound",
          message: text, wa_message_id: msgId, intent: "confirmation",
        });

        // Same conversational strategy as the button handler — no template needed.
        // 24h window opens when the guest sends any message; reply with free text.
        const safeName2    = String(guest?.name ?? "").trim() || "אורח יקר";
        const workshopUrl2 = Deno.env.get("WORKSHOP_SIGNUP_URL") ?? "";
        const spaTime2     = (guest?.spa_time as string | null) ?? null;

        const stage2Script2 = scripts["stage_2_arrival"];
        let textArrivalReply: string;
        if (stage2Script2?.message_text?.trim()) {
          const hasOptionalSpaText2 = /\{\{\s*OPTIONAL_SPA_TEXT\s*\}\}/i.test(stage2Script2.message_text);
          const hasSpaLine2         = /\{\{\s*SPA_LINE\s*\}\}/i.test(stage2Script2.message_text);
          const hasSpaTimeLegacy2   = /\{\{\s*SPA_TIME\s*\}\}/i.test(stage2Script2.message_text);
          console.log(
            `[webhook] 🩺 resolvePlaceholders input (text-confirm) — phone:${phone} spaTime:${JSON.stringify(spaTime2)}` +
            ` scriptHasOptionalSpaText:${hasOptionalSpaText2} scriptHasSpaLine:${hasSpaLine2} scriptHasSpaTime:${hasSpaTimeLegacy2}`
          );
          // Same FAIL VISIBLE safety net as the button-tap path above.
          if (spaTime2 && !hasOptionalSpaText2 && !hasSpaLine2 && !hasSpaTimeLegacy2) {
            console.warn(
              `[webhook] ⚠️ guest ${phone} has spa_time="${spaTime2}" but the saved ` +
              `stage_2_arrival script contains no spa placeholder ({{SPA_LINE}}/` +
              `{{OPTIONAL_SPA_TEXT}}/{{SPA_TIME}}) — reply will never mention spa. ` +
              `Check the script text in BotScriptEditor.`
            );
          }
          textArrivalReply = resolvePlaceholders(stage2Script2.message_text, {
            guestName: safeName2, spaTime: spaTime2, workshopUrl: workshopUrl2,
          });
        } else {
          // Dynamic Sentence approach — single code path for both spa/no-spa cases
          const spaSentence2 = buildSpaSentence(spaTime2);
          const workshopLine2 = workshopUrl2
            ? `\n\n🎯 *לסדנאות שלנו — הרשמו מראש:*\n👉 ${workshopUrl2}`
            : "";
          textArrivalReply =
            `מגיעים! 🎉 כבר מתרגשים מאד מהגעתכם, ${safeName2}!\n\n` +
            `הצוות שלנו ב-Dream Island מכין את הכל ומחכה לכם עם חיוך גדול 🌴\n\n` +
            spaSentence2 +
            workshopLine2 +
            `\n\nיש לכם שאלות לפני ההגעה? על הצ׳ק-אין, החדר — אני כאן לכל שאלה 😊`;
        }

        if (!sim) {
          try {
            await sendReply(phone, textArrivalReply);
            await supabase.from("whatsapp_conversations").insert({
              phone, guest_id: guestId, direction: "outbound",
              message: textArrivalReply, wa_message_id: null,
            });
          } catch (e) {
            console.error("[webhook] text confirmation reply failed:", (e as Error).message);
          }
        } else {
          console.info(`[webhook] SIM — text confirmation from ${phone}, would reply conversationally`);
        }

        console.info(`[webhook] ✅ pre-arrival confirmed (text) — phone:${phone} guest:${guestId}`);
        continue;
      }

      // ── Date-change / cancellation request detection (typed text) ────────────
      // Guest says they can't make it, wants to change dates, or has a booking issue.
      // → Flag in DB, alert staff, send exact handoff message. No AI involved.
      if (DATE_CHANGE_RE.test(text)) {
        const { data: dcSaved } = await supabase
          .from("whatsapp_conversations")
          .insert({
            phone, guest_id: guestId, direction: "inbound",
            message: text, wa_message_id: msgId,
            intent: "date_change_request",
            human_requested: true, human_request_type: "date_change",
          })
          .select("id")
          .maybeSingle();
        const dcConvId = (dcSaved?.id as number) ?? null;

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
          if (error) console.warn("[webhook] guest_alerts (date_change) error:", error.message);
        })().catch((e: Error) => console.warn("[webhook] guest_alerts (date_change) error:", e.message));

        const handoffMsg =
          "העברתי את בקשתך לצוות הסוויטות שלנו (אדיר ואפק), והם יצרו איתך קשר בהקדם. 🙏";

        if (!sim) {
          try {
            await sendReply(phone, handoffMsg);
            await supabase.from("whatsapp_conversations").insert({
              phone, guest_id: guestId, direction: "outbound",
              message: handoffMsg, wa_message_id: null, intent: "date_change_request",
            });
          } catch (e) {
            console.error("[webhook] date_change reply failed:", (e as Error).message);
          }
        }
        console.info(`[webhook] 🗓️ date_change_request flagged — phone:${phone} guest:${guestId ?? "unknown"}`);
        continue;
      }

      // ── Load conversation history early — used for context in ALL intents ──
      // Fetch last 20 rows, filter out system markers, keep last 10 real turns.
      const { data: rawHistory } = await supabase
        .from("whatsapp_conversations")
        .select("direction, message")
        .eq("phone", phone)
        .order("created_at", { ascending: false })
        .limit(20);

      const orderedHistory = (
        rawHistory as Array<{ direction: string; message: string }> | null ?? []
      )
        .filter((h) => !h.message.startsWith("["))
        .slice(0, 10)
        .reverse();

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
        .maybeSingle();
      const conversationId = (savedMsg?.id as number) ?? null;

      // ── Human-handover mode: message logged, no bot reply ─────────────────
      if (!botIsActive) {
        console.info(`[webhook] 🤫 bot paused — inbound logged, skipping reply to ${phone}`);
        continue;
      }

      // ── Route & generate reply ────────────────────────────────────────────
      let reply = scripts["fallback_reply"]?.message_text?.trim() || FALLBACK_REPLY;

      if (intent === "complaint") {
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
        flagGuestAlert(supabase, phone, guestId, text, conversationId)
          .catch((e: Error) =>
            console.error("[webhook] flagGuestAlert error:", e.message)
          );

      } else if (intent === "upsell") {
        // Use upsell_reply from BotScriptEditor if available
        const upsellScript = scripts["upsell_reply"];
        if (upsellScript?.message_text?.trim()) {
          reply = resolvePlaceholders(upsellScript.message_text, {
            guestName: guestName ?? "אורח יקר", spaTime: null, workshopUrl: "",
          });
        } else {
          reply = buildUpsellReply(guestName);
        }

      } else if (intent === "faq") {
        // orderedHistory already loaded above (shared across all intents)
        // Build rich guest-stage context for personalised responses
        const guestCtx = buildGuestStageContext(
          guest as Record<string, unknown> | null,
          orderedHistory
        );

        const enrichedPrompt = finalSystemPrompt
          + (guestCtx ? `\n\nפרטי האורח הנוכחי: ${guestCtx}` : "");

        // Dynamic engine routing (A/B testing & cost optimization) — preferred
        // engine is tried first, with the other engine kept as an automatic
        // safety net on failure so a restricted/expired key never goes silent.
        const route = resolveModelRoute(botSettings.preferred_model);
        console.info(`[webhook] model route: engine=${route.engine} preferred="${botSettings.preferred_model ?? "(unset)"}"`);

        try {
          reply = sanitizeReply(
            route.engine === "claude"
              ? await callClaude(text, guestName, orderedHistory, enrichedPrompt)
              : await askGemini(text, guestName, orderedHistory, enrichedPrompt, route.geminiOrder)
          );
        } catch (e) {
          const fallbackEngine = route.engine === "claude" ? "gemini" : "claude";
          console.error(`[webhook] ${route.engine} failed → trying ${fallbackEngine}:`, (e as Error).message);
          try {
            reply = sanitizeReply(
              route.engine === "claude"
                ? await askGemini(text, guestName, orderedHistory, enrichedPrompt, route.geminiOrder)
                : await callClaude(text, guestName, orderedHistory, enrichedPrompt)
            );
          } catch (e2) {
            console.error("[webhook] both engines failed:", (e2 as Error).message);
            reply = FALLBACK_REPLY;
          }
        }
      }
      // else "fallback" → FALLBACK_REPLY already set

      // ── Capture uncategorized guest requests for staff visibility ─────────
      // complaint/upsell already raise their own alert (flagGuestAlert / dedicated
      // reply above) — this fires only for the faq/fallback catch-all, the exact
      // gap where a real guest request (e.g. "we'd love balloons") got an AI
      // reply but left zero trace on the guest's record. Append-only, non-blocking:
      // a logging failure here must never affect the reply already being sent.
      // .then() with a single callback (not a chained .catch()) is the safe
      // pattern for this Postgrest builder — see whatsapp-send's BRANCH D note.
      // Deliberately NOT gated on arrival_confirmed: a pre-arrival request
      // ("balloons for a birthday") is the case staff most need lead time on —
      // gating this on confirmed-arrival silently dropped exactly that case.
      if (guestId && (intent === "faq" || intent === "fallback")) {
        const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
        const noteLine = `[${stamp}] ${text}`;
        const newNotes = guest?.guest_notes ? `${guest.guest_notes}\n${noteLine}` : noteLine;
        supabase
          .from("guests")
          .update({ guest_notes: newNotes, requires_attention: true, attention_reason: null })
          .eq("id", guestId)
          .then(({ error }: { error: { message: string } | null }) => {
            if (error) console.error("[webhook] guest_notes capture error:", error.message);
          });

        // ── Requests Board (guest_alerts) — same capture, structured for the
        // staff dashboard. alert_type "request" distinguishes a plain ask
        // (towels, balloons) from "complaint" (malfunction) — both feed the
        // same board. IIFE + await, not a bare .catch() on the Postgrest
        // builder (session 14 bug — that builder is PromiseLike, not a real
        // Promise, so .catch() throws synchronously instead of catching).
        (async () => {
          const { error } = await supabase.from("guest_alerts").insert({
            guest_id: guestId, phone, alert_type: "request",
            message: text, conversation_id: conversationId, resolved: false,
          });
          // Mike's explicit ask: this must scream in the logs, not warn quietly —
          // a failed insert here means a guest request never reaches the Requests Board.
          if (error) console.error("[webhook] 🚨 guest_alerts (request) insert FAILED:", error.message);
        })().catch((e: Error) => console.error("[webhook] 🚨 guest_alerts (request) insert FAILED:", e.message));
      }

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

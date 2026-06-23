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
import { sendCtaUrlButton } from "../_shared/interactiveSend.ts";

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
פרמיום, יוקרתי, אמפתי ומקצועי ביותר — 5 כוכבים בכל משפט. עברית תקנית ואלגנטית בלבד. אל תחשוף שאתה AI.
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
• אם האורח מעלה בקשה ספציפית וניתנת למימוש (למשל: יין, פרחים, בלונים ליום הולדת, ציוד מיוחד, בקשה לחדר) — תחילה החמא/י בטבעיות ובקצרה על הבחירה שלו/ה (למשל "בחירה נהדרת!"), ולאחר מכן ציין/י בבירור שהבקשה הועברה לצוות המלון ושיטפלו בה בהקדם. אל תמציא/י זמן טיפול משוער. המערכת שומרת ומעבירה את הבקשה אוטומטית — תפקידך רק לנסח את התשובה באופן טבעי.
• השלמת מחשבה: בכל תשובה, תמיד השלימי מחשבה מלאה ומגובשת. לעולם אל תשאירי משפט באמצע ואל תיקטעי באופן פתאומי — כל הודעה מסתיימת באופן טבעי ומלוטש.
• טון שיווקי וקולע: את קונסיירז' יוקרה. הימנעי מרשימות מייגעות או פסקאות ארוכות — מסרי מסר איכותי, ממוקד וקולע. אורך התשובה משתנה לפי הצורך — לא מספר משפטים קבוע — אבל היא תמיד תכלית ולא משתרכת.
• הפניה חכמה: כשאורח/ת מבקש/ת פירוט מלא על השירותים — אל תפרטי הכל בצ'אט. צייני בקצרה את הקטגוריות המרכזיות (סוויטות יוקרה 👑, בילוי יומי מפנק 🏖️, PREMIUM DAY 1 🌟, PREMIUM DAY 2 ✨) והפני מיידית לקישור https://www.dream-island.co.il/orderonline/booking לפרטים מלאים.
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

  // Legacy {{SPA_TIME}}: substitute a full sentence (not just the bare time
  // value — that was the "15:00 with nothing around it" bug) or strip the
  // containing sentence when absent.
  if (vars.spaTime) {
    text = text.replace(/\{\{\s*SPA_TIME\s*\}\}/gi, `הטיפול שלכם בספא מתואם לשעה ${vars.spaTime}`);
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
    text = `${text.trim()}\n\nהטיפול שלכם בספא מתואם לשעה ${vars.spaTime}.`;
  }

  return text.trim();
}

// ── Stage 2 Pay — payment/workshop placeholder resolver ─────────────────────
// Deliberately separate from resolvePlaceholders() above: zero shared code,
// so nothing here can affect the existing spa-time Stage 2 reply. Used only
// by the new payment-pending branch in the arrival-confirmation paths below.
// {{SPA_LINE}} reuses buildSpaSentence() — the exact helper stage_2_arrival
// already relies on — rather than a second spa-text mechanism.
function resolvePaymentPlaceholders(
  template: string,
  vars: { guestName: string; paymentAmount: string; paymentLink: string; workshopUrl: string; spaTime: string | null }
): string {
  return template
    .replace(/\{\{\s*GUEST_NAME\s*\}\}/gi, vars.guestName)
    .replace(/\{\{\s*PAYMENT_AMOUNT\s*\}\}/gi, vars.paymentAmount)
    .replace(/\{\{\s*PAYMENT_LINK\s*\}\}/gi, vars.paymentLink)
    .replace(/\{\{\s*WORKSHOP_URL\s*\}\}/gi, vars.workshopUrl)
    .replace(/\{\{\s*SPA_LINE\s*\}\}/gi, buildSpaSentence(vars.spaTime))
    .trim();
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
  spaTime: string | null; hasButton: boolean;
}): string {
  const workshopLine = vars.workshopUrl ? `\n\n🎯 *לסדנאות שלנו — הרשמו מראש:*\n👉 ${vars.workshopUrl}` : "";
  const paymentLine = vars.hasButton
    ? `לפני ההגעה, נשארה יתרת תשלום בסך ${vars.paymentAmount} ₪ להסדרה — לחצו על הכפתור למטה כדי להסדיר בקליק אחד.`
    : `לפני ההגעה, נשארה יתרת תשלום בסך ${vars.paymentAmount} ₪ להסדרה — ניתן לסגור את זה בקליק אחד כאן:\n👉 ${vars.paymentLink}`;
  return (
    `מגיעים! 🎉 כבר מתרגשים מאד מהגעתכם, ${vars.guestName}!\n\n` +
    `הצוות שלנו ב-Dream Island מכין את הכל ומחכה לכם עם חיוך גדול 🌴\n\n` +
    buildSpaSentence(vars.spaTime) +
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
interface AutomationStageRow {
  is_active: boolean;
  session_message_script_key: string | null;
  interactive_buttons: Array<{ type: string; label: string; url?: string }> | null;
}
const _stageCache = new Map<string, { row: AutomationStageRow | null; time: number }>();

async function fetchAutomationStage(
  supabaseClient: ReturnType<typeof createClient>,
  stageKey: string
): Promise<AutomationStageRow | null> {
  const now = Date.now();
  const cached = _stageCache.get(stageKey);
  if (cached && now - cached.time < CONFIG_TTL_MS) return cached.row;
  try {
    const { data } = await supabaseClient
      .from("automation_stages")
      .select("is_active, session_message_script_key, interactive_buttons")
      .eq("stage_key", stageKey)
      .maybeSingle();
    const row = (data as AutomationStageRow | null) ?? null;
    _stageCache.set(stageKey, { row, time: now });
    return row;
  } catch (e) {
    console.warn(`[webhook] fetchAutomationStage(${stageKey}) error:`, (e as Error).message);
    return cached?.row ?? null;
  }
}

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
  const payName       = String(guest?.name ?? "").trim() || "אורח יקר";
  const payWorkshopUrl = Deno.env.get("WORKSHOP_SIGNUP_URL") ?? "";
  const payAmount      = String(guest?.payment_amount ?? "");
  const payLink        = String(guest?.payment_link_url ?? "");
  const spaTime        = (guest?.spa_time as string | null) ?? null;

  const paymentButton = (stage2Pay?.interactive_buttons ?? []).find(
    (b) => b.type === "url" && !!b.url && /\{\{\s*PAYMENT_LINK\s*\}\}/i.test(b.url)
  );

  const payScript    = scripts["stage_2_payment_reply"];
  const paymentReply = payScript?.message_text?.trim()
    ? resolvePaymentPlaceholders(payScript.message_text, {
        guestName: payName, paymentAmount: payAmount, paymentLink: payLink, workshopUrl: payWorkshopUrl, spaTime,
      })
    : buildPaymentReply({
        guestName: payName, paymentAmount: payAmount, paymentLink: payLink, workshopUrl: payWorkshopUrl,
        spaTime, hasButton: !!paymentButton,
      });

  console.info(`[webhook] 💳 arrival confirmed (payment-pending) — phone:${phone} name="${payName}" button:${!!paymentButton}`);

  if (sim) {
    console.info(`[webhook] SIM — would send Stage 2 Pay reply to ${phone}, would not actually send.`);
    return;
  }

  try {
    if (paymentButton?.url) {
      const resolvedUrl = resolveButtonUrl(paymentButton.url, { paymentLink: payLink, workshopUrl: payWorkshopUrl });
      await sendCtaUrlButton(phone, paymentReply, paymentButton.label, resolvedUrl);
    } else {
      await sendReply(phone, paymentReply);
    }
    await supabaseClient.from("whatsapp_conversations").insert({
      phone, guest_id: guestId, direction: "outbound",
      message: paymentReply, wa_message_id: null,
    });
    console.info(`[webhook] ✅ payment reply sent to ${phone}`);
  } catch (e) {
    const errMsg = (e as Error).message;
    const replyStatus = errMsg.startsWith("timeout_no_response") ? "timeout" : "failed";
    console.error(`[webhook] ❌ payment reply ${replyStatus} to ${phone}:`, errMsg);
    try {
      const { error: logErr } = await supabaseClient.from("notification_log").insert({
        guest_id: guestId, recipient: phone,
        trigger_type: "stage_2_pay", channel: "whatsapp",
        status: replyStatus, payload: { error: errMsg, ...(buttonTitle ? { buttonTitle } : {}) },
      });
      if (logErr) console.warn("[webhook] notification_log insert error:", logErr.message);
    } catch (e) { console.warn("[webhook] notification_log insert error:", (e as Error).message); }
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
11. אם האורח מעלה בקשה ספציפית וניתנת למימוש (כגון יין, פרחים, בלונים ליום הולדת, ציוד מיוחד, בקשה לחדר) — תחילה החמא/י בטבעיות ובקצרה על הבחירה שלו/ה (למשל "בחירה נהדרת!" או "טעם מצוין!"), ולאחר מכן ציין/י בבירור שהבקשה הועברה לצוות המלון ושיטפלו בה בהקדם. אל תמציא/י זמן טיפול משוער. המערכת שומרת ומעבירה את הבקשה אוטומטית — תפקידך רק לנסח את התשובה באופן טבעי.
12. השלמת מחשבה: בכל תשובה, תמיד השלימי מחשבה מלאה ומגובשת. לעולם אל תשאירי משפט באמצע ואל תיקטעי באופן פתאומי — כל הודעה מסתיימת באופן טבעי ומלוטש.
13. טון שיווקי וקולע: את קונסיירז' יוקרה. הימנעי מרשימות מייגעות או פסקאות ארוכות — מסרי מסר איכותי, ממוקד וקולע. אורך התשובה משתנה לפי הצורך — לא מספר משפטים קבוע — אבל היא תמיד תכלית ולא משתרכת.
14. הפניה חכמה: כשאורח/ת מבקש/ת פירוט מלא על השירותים — אל תפרטי הכל בצ'אט. צייני בקצרה את הקטגוריות המרכזיות (סוויטות יוקרה 👑, בילוי יומי מפנק 🏖️, PREMIUM DAY 1 🌟, PREMIUM DAY 2 ✨) והפני מיידית לקישור https://www.dream-island.co.il/orderonline/booking לפרטים מלאים.
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

// ── Critical-event safety net (Phase 2 request-handling) ────────────────────
// Deterministic backstop for the "faq" branch, which now expects the model to
// call log_guest_request (see §5c below) when it spots an actionable request
// or hot sales lead. Models occasionally skip the tool call even when
// instructed to use it — this never-go-silent net force-logs to guest_alerts
// when a critical keyword is present and the model didn't fire the tool, so a
// real guest event (complaint escalation, manager request, price question we
// must not answer ourselves — see CLAUDE.md "No Prices Rule") never vanishes
// silently. Deliberately overlaps with classifyIntent's COMPLAINT_PATTERNS
// ("תקלה") and detectHumanRequest's HUMAN_CHAT_PATTERNS ("נציג") — those paths
// already log/flag through their own mechanisms, so this net being redundant
// there is harmless; "מנהל"/"מחיר" are new keywords with no existing capture.
const CRITICAL_FALLBACK_PATTERNS: RegExp[] = [
  /תקלה/i,
  /נציג/i,
  /מנהל/i,
  /מחיר/i,
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
// §4b LOG_GUEST_REQUEST TOOL — Phase 2 request-handling (CLAUDE.md §0 "Tool
//      Calling" sprint). Lets the model itself decide, per "faq"-intent
//      message, whether the guest raised a specific fulfillable request
//      (wine, flowers, towels...) or a hot sales lead (room upgrade, extra
//      treatment) worth a staff ticket — vs. a plain question that shouldn't
//      pollute the Requests Board (the gap in the old blanket-capture gate,
//      which logged every single faq/fallback message as a "request").
//
// Defined once, wrapped per-provider below: Anthropic's input_schema (JSON
// Schema) vs. Gemini's functionDeclarations.parameters (same JSON Schema
// shape over the v1beta REST endpoint — NOT the protobuf Type-enum shape
// used by Google's typed client SDKs, since we call the REST API directly).
//
// alert_type values map 1:1 onto RequestsBoard.js's existing TYPE_META keys
// ("request" / "upsell_opportunity") — no frontend change needed.
// ══════════════════════════════════════════════════════════════════════════════
const LOG_REQUEST_TOOL_NAME = "log_guest_request";
const LOG_REQUEST_TOOL_DESCRIPTION =
  "Call this whenever the guest raises a specific, fulfillable request " +
  "(e.g. wine, flowers, balloons, extra towels, room equipment) or expresses " +
  "a hot sales lead (room upgrade, extra spa treatment, extending the stay). " +
  "Do NOT call this for general informational questions (opening hours, " +
  "WiFi, location, what's included) — only for something a staff member " +
  "needs to actually go do something about.";

const LOG_REQUEST_JSON_SCHEMA = {
  type: "object",
  properties: {
    category: {
      type: "string",
      enum: ["request", "upsell_opportunity"],
      description:
        "'request' for a concrete fulfillable ask (item/service). " +
        "'upsell_opportunity' for a sales lead (upgrade/extend/add-on interest).",
    },
    item_summary: {
      type: "string",
      description: "Short Hebrew summary of what the guest wants, 3-8 words.",
    },
  },
  required: ["category", "item_summary"],
};

const CLAUDE_TOOLS = [{
  name: LOG_REQUEST_TOOL_NAME,
  description: LOG_REQUEST_TOOL_DESCRIPTION,
  input_schema: LOG_REQUEST_JSON_SCHEMA,
}];

const GEMINI_TOOLS = [{
  functionDeclarations: [{
    name: LOG_REQUEST_TOOL_NAME,
    description: LOG_REQUEST_TOOL_DESCRIPTION,
    parameters: LOG_REQUEST_JSON_SCHEMA,
  }],
}];

// Code-level only — deliberately NOT stored in bot_settings.system_prompt.
// That field is Mike's human-edited business persona (BotSettings.js UI);
// mixing mechanical "call this function" instructions into it risks an
// innocent persona edit silently breaking tool invocation, with no way for
// Mike to notice from the UI. Appended at call time instead, same pattern
// already used for kbSuffix/guestCtx.
const TOOL_USAGE_INSTRUCTIONS = `

══ הנחיה טכנית (לא להציג לאורח) ══
יש לך אפשרות לקרוא לפונקציה log_guest_request כשהאורח מעלה בקשה ספציפית
וניתנת למימוש (יין, פרחים, בלונים, ציוד מיוחד, בקשה לחדר) או מביע עניין
מכירתי חם (שדרוג חדר, הארכת שהות, טיפול נוסף). אל תקרא לפונקציה על שאלות
מידע כלליות (שעות פתיחה, WiFi, מיקום).
בכל פעם שאתה קורא לפונקציה — הוסף/י גם תשובה טבעית וחמה לאורח באותו תור:
קודם החמא/י על הבחירה, ואז ציין/י בבירור שהבקשה הועברה לצוות. לעולם אל
תכתוב שהבקשה "הועברה" אם לא קראת בפועל לפונקציה.`;

// Both askGemini/callClaude now return this shape instead of a bare string,
// so the call site can act on a tool invocation alongside the reply text.
interface AiReplyResult {
  text: string;
  loggedRequest: { category: "request" | "upsell_opportunity"; summary: string } | null;
}

// Validates/coerces raw tool-call args — never trust model output blindly.
// Unexpected category values fall back to "request" (the more conservative
// bucket) but are logged so a drifting model prompt doesn't go unnoticed
// (FAIL VISIBLE, CLAUDE.md §0.3) rather than being silently miscategorized.
function _normalizeLoggedRequest(raw: unknown): AiReplyResult["loggedRequest"] {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const rawCategory = String(obj.category ?? "");
  if (rawCategory !== "request" && rawCategory !== "upsell_opportunity") {
    console.warn(`[webhook] ${LOG_REQUEST_TOOL_NAME} unexpected category "${rawCategory}" — defaulting to "request"`);
  }
  const category: "request" | "upsell_opportunity" = rawCategory === "upsell_opportunity" ? "upsell_opportunity" : "request";
  const summary = typeof obj.item_summary === "string" && obj.item_summary.trim()
    ? obj.item_summary.trim()
    : "(לא צוין פירוט)";
  return { category, summary };
}

// Guarantees the guest is never left with an empty reply if the model calls
// the tool but — despite TOOL_USAGE_INSTRUCTIONS — omits accompanying text.
function _buildToolOnlyReply(loggedRequest: NonNullable<AiReplyResult["loggedRequest"]>): string {
  return `בחירה מצוינת! העברתי את הבקשה (${loggedRequest.summary}) לצוות שלנו, ויחזרו אליך בהקדם. 🙏`;
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
): Promise<AiReplyResult> {
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
    parts: [{ text: systemPrompt + TOOL_USAGE_INSTRUCTIONS + guestLine + "\nהבנת את התפקיד? ענה 'כן' בלבד." }],
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
    tools: GEMINI_TOOLS,
    generationConfig: { maxOutputTokens: 1000, temperature: 0.65, candidateCount: 1 },
  });

  // Pulls both the spoken reply and a possible log_guest_request call out of
  // one response. A part can be a thinking block, plain text, or a
  // functionCall — all three can coexist in the same candidate.
  function extractResult(data: Record<string, unknown>): AiReplyResult | null {
    const candidates = data?.candidates as Array<Record<string, unknown>> | undefined;
    const content = candidates?.[0]?.content as Record<string, unknown> | undefined;
    const rawParts = (content?.parts ?? []) as Array<Record<string, unknown>>;
    const realPart = rawParts.find(p => !p.thought && typeof p.text === "string" && (p.text as string).trim());
    const fnPart = rawParts.find(p => (p.functionCall as Record<string, unknown> | undefined)?.name === LOG_REQUEST_TOOL_NAME);
    const text = String(realPart?.text ?? "").trim();
    const loggedRequest = fnPart ? _normalizeLoggedRequest((fnPart.functionCall as Record<string, unknown>)?.args) : null;
    if (!text && !loggedRequest) return null;
    return { text: text || (loggedRequest ? _buildToolOnlyReply(loggedRequest) : ""), loggedRequest };
  }

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
    const result = extractResult(data);
    if (!result) throw new Error("gemini_empty_response");
    if (result.loggedRequest) {
      console.info(`[webhook] 🔧 Gemini called ${LOG_REQUEST_TOOL_NAME}:`, JSON.stringify(result.loggedRequest));
    }
    console.log(`[webhook] Gemini OK model="${model}"`);
    return result;
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
      const result = extractResult(data);
      if (result) {
        if (result.loggedRequest) {
          console.info(`[webhook] 🔧 Gemini (discovered) called ${LOG_REQUEST_TOOL_NAME}:`, JSON.stringify(result.loggedRequest));
        }
        console.log(`[webhook] Gemini OK (discovered) model="${discovered}"`);
        return result;
      }
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
): Promise<AiReplyResult> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("no_anthropic_key");

  const system = systemPrompt
    + TOOL_USAGE_INSTRUCTIONS
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
  // tools cast via `as any`: the pinned SDK version's TS types may predate
  // tool-use fields, but the Messages API itself (api-version 2023-06-01)
  // accepts `tools` regardless of client-library vintage — this is a
  // passthrough request-body field, not a client-side feature gate.
  const resp = await anthropic.messages.create({
    model:      CLAUDE_MODEL,
    max_tokens: 1000,
    system,
    messages,
    tools: CLAUDE_TOOLS,
  } as any);

  // Claude can return text and tool_use blocks side by side in one response —
  // collect both rather than assuming content[0] is always plain text.
  const blocks = resp.content as Array<Record<string, unknown>>;
  const text = blocks
    .filter(b => b.type === "text")
    .map(b => String(b.text ?? "").trim())
    .filter(Boolean)
    .join("\n");
  const toolBlock = blocks.find(b => b.type === "tool_use" && b.name === LOG_REQUEST_TOOL_NAME);
  const loggedRequest = toolBlock ? _normalizeLoggedRequest(toolBlock.input) : null;
  if (loggedRequest) {
    console.info(`[webhook] 🔧 Claude called ${LOG_REQUEST_TOOL_NAME}:`, JSON.stringify(loggedRequest));
  }

  const finalText = text || (loggedRequest ? _buildToolOnlyReply(loggedRequest) : "");
  if (!finalText) throw new Error("claude_empty_response");
  console.log(`[webhook] ✅ Claude OK (fallback) engine=${CLAUDE_MODEL}`);
  return { text: finalText, loggedRequest };
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
        // Guests with a pending balance (payment_amount + payment_link_url set)
        // get the payment/workshop message automatically instead — see the
        // "Stage 2 Pay" branch right below, gated on the automation_stages
        // toggle. Staff can still resend the payment link anytime via the
        // GuestsPage 💳 button (unaffected, fully independent of this branch).
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

          // ── Stage 2 Pay — payment-pending guests get the payment/workshop
          // reply INSTEAD OF the standard spa-time Stage 2 reply below. Gated
          // on the automation_stages "stage_2_pay" toggle so an admin can turn
          // this off and fall back to the always-safe standard reply. Guests
          // with no pending balance fall straight through to Path A,
          // unmodified.
          const hasPendingPayment = !!(guest?.payment_amount && guest?.payment_link_url);
          const stage2Pay = await fetchAutomationStage(supabase, "stage_2_pay");
          if (hasPendingPayment && stage2Pay?.is_active === true) {
            await sendStage2PayReply(supabase, scripts, stage2Pay, phone, guestId, guest, sim, buttonTitle);
            console.info(`[webhook] ✅ button reply handled — "${buttonTitle}" phone:${phone}`);
            continue; // skip Path A + normal intent routing
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

        // ── Stage 2 Pay — same payment-pending branch as the button-tap path
        // above. Gated on the automation_stages "stage_2_pay" toggle; falls
        // straight through to the unmodified standard reply below otherwise.
        const hasPendingPaymentText = !!(guest?.payment_amount && guest?.payment_link_url);
        const stage2PayText = await fetchAutomationStage(supabase, "stage_2_pay");
        if (hasPendingPaymentText && stage2PayText?.is_active === true) {
          await sendStage2PayReply(supabase, scripts, stage2PayText, phone, guestId, guest, sim);
          console.info(`[webhook] ✅ pre-arrival confirmed (text, payment-pending) — phone:${phone} guest:${guestId}`);
          continue; // skip Path A + normal intent routing
        }

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
      // Set only inside the "faq" branch below when the model invokes
      // log_guest_request — drives the conditional guest_alerts gate further down.
      let toolLoggedRequest: AiReplyResult["loggedRequest"] = null;

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
          const result = route.engine === "claude"
            ? await callClaude(text, guestName, orderedHistory, enrichedPrompt)
            : await askGemini(text, guestName, orderedHistory, enrichedPrompt, route.geminiOrder);
          reply = sanitizeReply(result.text);
          toolLoggedRequest = result.loggedRequest;
        } catch (e) {
          const fallbackEngine = route.engine === "claude" ? "gemini" : "claude";
          console.error(`[webhook] ${route.engine} failed → trying ${fallbackEngine}:`, (e as Error).message);
          try {
            const result = route.engine === "claude"
              ? await askGemini(text, guestName, orderedHistory, enrichedPrompt, route.geminiOrder)
              : await callClaude(text, guestName, orderedHistory, enrichedPrompt);
            reply = sanitizeReply(result.text);
            toolLoggedRequest = result.loggedRequest;
          } catch (e2) {
            console.error("[webhook] both engines failed:", (e2 as Error).message);
            reply = FALLBACK_REPLY;
          }
        }
      }
      // else "fallback" → FALLBACK_REPLY already set

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
        const noteLine = `[${stamp}] ${text}`;
        const newNotes = guest?.guest_notes ? `${guest.guest_notes}\n${noteLine}` : noteLine;
        supabase
          .from("guests")
          .update({ guest_notes: newNotes, requires_attention: true, attention_reason: null })
          .eq("id", guestId)
          .then(({ error }: { error: { message: string } | null }) => {
            if (error) console.error("[webhook] guest_notes capture error:", error.message);
          });

        // ── Requests Board (guest_alerts) — Phase 2: no longer blanket-fires
        // for every faq/fallback message (that was the original bug — a plain
        // "what time is checkout?" landed on the staff dashboard exactly like
        // "can we get a bottle of wine?"). Now conditional on either:
        //   (a) the model actually invoked log_guest_request this turn, or
        //   (b) the critical-keyword safety net (CRITICAL_FALLBACK_PATTERNS)
        //       matched and the model didn't fire the tool — never-go-silent
        //       backstop for תקלה/נציג/מנהל/מחיר.
        // guest_notes above stays blanket (cheap free-text history, not a
        // dashboard ticket) — only the staff-facing alert is now selective.
        const criticalKeywordHit = intent === "faq" && !toolLoggedRequest && CRITICAL_FALLBACK_PATTERNS.some((p) => p.test(text));
        if (toolLoggedRequest || criticalKeywordHit) {
          const alertType = toolLoggedRequest?.category ?? "request";
          if (criticalKeywordHit) {
            console.info(`[webhook] 🛟 critical-keyword safety net fired (no tool call) — phone:${phone}`);
          }
          // IIFE + await, not a bare .catch() on the Postgrest builder
          // (session 14 bug — that builder is PromiseLike, not a real
          // Promise, so .catch() throws synchronously instead of catching).
          (async () => {
            const { error } = await supabase.from("guest_alerts").insert({
              guest_id: guestId, phone, alert_type: alertType,
              message: text, conversation_id: conversationId, resolved: false,
            });
            // Mike's explicit ask: this must scream in the logs, not warn quietly —
            // a failed insert here means a guest request never reaches the Requests Board.
            if (error) console.error("[webhook] 🚨 guest_alerts (request) insert FAILED:", error.message);
          })().catch((e: Error) => console.error("[webhook] 🚨 guest_alerts (request) insert FAILED:", e.message));
        }
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

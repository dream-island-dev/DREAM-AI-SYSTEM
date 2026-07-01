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
import {
  guardPaymentLink,
  isStage2PayAlreadyDispatched,
  isStage2PayInFlight,
  logPaymentLinkFailure,
  markStage2PayProcessing,
  PAYMENT_LINK_FAILURE_LABEL,
} from "../_shared/paymentLinkGuard.ts";
import { sendWhapiText }    from "../_shared/whapiSend.ts";
import { formatGuestProfileForAi } from "../_shared/guestProfile.ts";
import {
  shouldApplyInRoomContextOverride,
  shouldInterceptOperationalInHouseRequest,
  buildOperationalRequestSummary,
  buildOperationalDispatchReply,
  isSensitiveStayChangeRequest,
  CANONICAL_STAY_CHANGE_HANDOFF_MSG,
} from "../_shared/automationSchedule.ts";

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

// Fallback static prompt — used ONLY when DB is completely unavailable.
// Contains NO hardcoded booking URLs, prices, or marketing CTAs —
// those belong in bot_settings.system_prompt (the UI source of truth).
const FALLBACK_SYSTEM_PROMPT = `
אתה "DREAM CONCIERGE" — הקונסיירז' הדיגיטלי הרשמי של Dream Island, אחד מאתרי הנופש היוקרתיים בישראל.
יוקרתי וחם בו-זמנית — דבר כמו מנהל/ת אירוח אנושי שמכיר את האורח, לא נציג שירות רשמי ורובוטי. קליל, מהיר ומדויק; בלי ניסוחים תאגידיים נוקשים ("בהמשך לפנייתך", "הריני להודיעך" וכדומה). עברית תקנית ואלגנטית, אך טבעית כמו שיחה אמיתית. אל תחשוף שאתה AI.
אם פרט אינו ידוע לך בכלל ולא מופיע ב"פרטי האורח" שצורפו לשיחה — לעולם אל תמציא תשובה. השב במדויק: "אני בודק את זה מול דלפק הקבלה, נציג אנושי יחזור אליך לכאן ברגעים אלו ממש."
CRITICAL: אם האורח שואל על פרט אישי שלו (למשל שעת טיפול ספא, מספר חדר, תאריך הגעה)
והפרט הזה כן מופיע ב"פרטי האורח" שצורפו לשיחה — ענה לו ישירות עם הערך המדויק.
אל תפנה אותו לקבלה ואל תכתוב שאינך יודע כשהמידע נמצא לפניך.

══ הנחיות שיחה ══
• אל תפתח כל הודעה ב"שלום" — המשך את השיחה בצורה טבעית כאילו אתה זוכר מה שנאמר
• קרא את היסטוריית השיחה לפני שאתה עונה — אל תחזור על מידע שכבר נמסר
• אם האורח ממשיך נושא שנדון קודם — התייחס אליו ישירות, ללא הקדמות
• דבר בגוף ראשון כנציג הצוות — "נדאג", "נסדר", "נשמח לעזור"
• לעולם אל תכלול תגיות פנימיות כגון [תבנית:...] בתשובתך — הטקסט שלך נשלח ישירות לאורח.
• השלם כל מחשבה עד סוף המשפט — לעולם אל תיקטע באמצע.
• פלוט אך ורק את התשובה הסופית בעברית. אסור לכלול חשיבה, ניתוח, הסבר על ההחלטה, או טקסט באנגלית כלשהו (כגון "According to..." / "the category...") — אלה נחשבים דליפה לאורח.
`.trim();

// Session 30 Sprint 5.5 — Strict Language Lock & Anti-Hallucination firewall.
// Unconditionally appended to enrichedPrompt below (see "faq" intent branch),
// regardless of which of the 3 system-prompt sources won (bot_settings.system_prompt
// admin override / bot_scripts.ongoing_concierge / buildSystemPrompt(bot_config) fallback).
// Same reasoning as the session 24 COT-leak firewall (sanitizeReply()'s COT_CUE
// regex): a rule baked only into buildSystemPrompt()/FALLBACK_SYSTEM_PROMPT only
// fires when bot_config is the winning source — it goes silent the moment an
// admin sets a custom bot_settings.system_prompt that doesn't happen to repeat
// it. Appending here makes it a true invariant, independent of prompt source.
const STRICT_HEBREW_LOCK_SUFFIX = `

══ נעילת שפה ואנטי-הזיה (חובה מוחלטת) ══
• ענה בעברית רהוטה, מפוארת ויוקרתית בלבד — לעולם לא באנגלית ולא בשפה אחרת, ללא יוצא מן הכלל.
• אם התשובה לא מופיעה במפורש בהקשר שצורף (פרטי האורח / ידע הריזורט) — אסור לך להמציא או לנחש. השב במדויק במשפט הזה ואל תשנה אותו: "אני בודק את זה מול דלפק הקבלה, נציג אנושי יחזור אליך לכאן ברגעים אלו ממש."`;

// "Smart Inbox AI Copilot & System Prompt Overhaul" session — explicit
// ROLE/TONE persona lock, unconditionally appended alongside
// STRICT_HEBREW_LOCK_SUFFIX above (same reasoning, see that const's comment):
// a rule that only lives inside buildSystemPrompt()/FALLBACK_SYSTEM_PROMPT
// goes silent the instant bot_settings.system_prompt (admin override) wins
// as the prompt source. Appending here makes tone a true invariant too, not
// just language/anti-hallucination. Deliberately does NOT repeat the
// language/anti-hallucination rules already covered above — only adds what
// STRICT_HEBREW_LOCK_SUFFIX doesn't: who the bot is, and how it should sound.
const LUXURY_CONCIERGE_PERSONA_SUFFIX = `

══ זהות וטון (חובה מוחלטת) ══
• את/ה הקונסיירז' הדיגיטלי של Dream Island — אחד מאתרי הנופש היוקרתיים בישראל.
• דבר/י כמו מנהל/ת אירוח אנושי, חם ונעים שמכיר את האורח — לא כמו נציג שירות רשמי, קפדני או רובוטי.
• קליל, חם, מעשי ומהיר. משפטים קצרים וטבעיים כמו שיחת וואטסאפ אמיתית — לא נאומים מנומקים או ניסוחים תאגידיים ("בהמשך לפנייתך", "הריני להודיעך").
• אם משהו לא ידוע לך — לעולם אל תמציא/י. עברי/י בעדינות לבדיקה מול הצוות (ראה את המשפט המדויק לעיל), בלי להישמע מתנצל/ת או מתחמק/ת.`;

// In-room keyword override — guest is physically in-suite but DB status lags.
const IN_HOUSE_TONE_SUFFIX = `

══ טון אורח בחדר (חובה מוחלטת) ══
• האורח כבר נמצא בחדר/בסוויטה — אל תשתמש/י בניסוחי טרום-הגעה ("נתראה בקרוב", "כשתגיעו", "לפני ההגעה", "ביום ההגעה").
• דבר/י כאורח שכבר נמצא במלון: "הבקשה הועברה לצוות והם יביאו לכם לחדר בהקדם", "מיד מטפלים בזה", "הצוות בדרך אליכם".
• אם מדובר במגבות/שמפו/מים/קפסולות/ניקיון — אשר/י שהצוות מספק לחדר, בלי לשאול מתי מגיעים.`;

// Hermetic seal — appended last to every guest LLM context (Claude/Gemini).
// Complements sanitizeReply(); does NOT modify bot_settings.system_prompt in DB.
const ANTI_REASONING_LEAK_SUFFIX = `

CRITICAL: You must NEVER output your thinking process, tags, JSON, or any English reasoning (THOUGHT blocks) to the user. Your output must strictly contain ONLY the direct, natural Hebrew response to the guest. If you feel the need to reason, do it internally; never let it escape into the final output text.`;

// Rapid burst coalescing — two webhook invocations within ~2s share one LLM reply.
const BURST_COALESCE_MS = 1800;
const BURST_WINDOW_MS   = 5000;

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
// {{PORTAL_LINK}}       → guest's personal Pre-Arrival Portal magic-link
//                          (session "Automation Recovery" follow-up). Same
//                          graceful-fallback contract as SPA_TIME: substitutes
//                          the real link when present, strips the whole
//                          containing sentence when the guest has no
//                          portal_token rather than ever sending a dead link.
//
// spaTime should be JUST the time value — "14:00" — not "טיפול 45 דקות בשעה 14:00".
function resolvePlaceholders(
  template: string,
  vars: { guestName: string; spaTime: string | null; workshopUrl: string; portalLink?: string }
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

  // {{PORTAL_LINK}}: substitute the real link, or strip the containing
  // sentence entirely if the guest has no portal_token — never leave a blank
  // "click here: " dangling in the message (CORE BUSINESS LOGIC #2, Graceful
  // Fallback). Should not happen in practice (migration 083 backfilled every
  // existing guest with a generated UUID and new rows get one by default) —
  // but trust the actual DB value at send time, not the schema guarantee.
  // {{portal_url}} is an alias for the exact same value — "SYSTEM ARCHITECTURE,
  // ZERO-REJECTION, ROOM MASKING & UX" session's directive named it that way;
  // supporting both spellings means neither an already-saved script nor a
  // newly-typed one breaks.
  const PORTAL_PLACEHOLDER_RE = /\{\{\s*(?:PORTAL_LINK|portal_url)\s*\}\}/gi;
  if (vars.portalLink) {
    text = text.replace(PORTAL_PLACEHOLDER_RE, vars.portalLink);
  } else {
    if (PORTAL_PLACEHOLDER_RE.test(text)) {
      console.warn("[webhook] resolvePlaceholders() — guest has no portal_token; stripped portal-link sentence rather than send a blank link.");
    }
    text = text.replace(/[^\n.!?]*\{\{\s*(?:PORTAL_LINK|portal_url)\s*\}\}[^\n.!?]*[.!?]?\s*/gi, "");
  }

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
  if (guest?.automation_muted === true) {
    console.info(`[webhook] 💳 Stage 2 Pay skipped — automation_muted guest_id=${guestId ?? "?"}`);
    return;
  }
  const payName        = String(guest?.name ?? "").trim() || "אורח יקר";
  const payWorkshopUrl = Deno.env.get("WORKSHOP_SIGNUP_URL") ?? "";
  const payAmount      = String(guest?.payment_amount ?? "");
  const spaTime        = (guest?.spa_time as string | null) ?? null;
  const triggerType    = "stage_2_pay";

  if (guestId != null) {
    if (await isStage2PayAlreadyDispatched(supabaseClient, guestId, triggerType)) {
      console.info(`[webhook] 💳 Stage 2 Pay skipped — already dispatched guest_id=${guestId}`);
      return;
    }
    if (await isStage2PayInFlight(supabaseClient, guestId, triggerType)) {
      console.info(`[webhook] 💳 Stage 2 Pay skipped — dispatch in flight guest_id=${guestId}`);
      return;
    }
  }

  const linkGuard = await guardPaymentLink(
    supabaseClient,
    guest ?? {},
    guestId,
    { allowInlineRecovery: true },
  );

  if (!linkGuard.ok) {
    console.warn(
      `[webhook] 💳 Stage 2 Pay aborted — ${linkGuard.reason} phone:${phone}` +
      (linkGuard.recoveryQueued ? " (recovery queued)" : ""),
    );
    if (!sim) {
      await logPaymentLinkFailure(supabaseClient, guestId, phone, triggerType, {
        reason: linkGuard.reason,
        recoveryQueued: linkGuard.recoveryQueued,
        ...(buttonTitle ? { buttonTitle } : {}),
      });
    }
    return;
  }

  const payLink = linkGuard.url;

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

  if (guestId != null) {
    await markStage2PayProcessing(supabaseClient, guestId, phone, triggerType);
  }

  try {
    if (paymentButton?.url) {
      const resolvedUrl = resolveButtonUrl(paymentButton.url, { paymentLink: payLink, workshopUrl: payWorkshopUrl });
      if (!resolvedUrl || resolvedUrl.includes("{{")) {
        throw new Error("payment_button_url_unresolved");
      }
      await sendCtaUrlButton(phone, paymentReply, paymentButton.label, resolvedUrl);
    } else {
      await sendReply(phone, paymentReply);
    }
    await supabaseClient.from("whatsapp_conversations").insert({
      phone, guest_id: guestId, direction: "outbound",
      message: paymentReply, wa_message_id: null,
    });
    const { error: logErr } = await supabaseClient.from("notification_log").insert({
      guest_id: guestId, recipient: phone,
      trigger_type: triggerType, channel: "whatsapp",
      status: "sent",
      payload: { channel: "session_message", paymentUrlValidated: true, ...(buttonTitle ? { buttonTitle } : {}) },
    });
    if (logErr) console.warn("[webhook] notification_log insert error:", logErr.message);
    console.info(`[webhook] ✅ payment reply sent to ${phone}`);
  } catch (e) {
    const errMsg = (e as Error).message;
    const replyStatus = errMsg.startsWith("timeout_no_response") ? "timeout" : "failed";
    console.error(`[webhook] ❌ payment reply ${replyStatus} to ${phone}:`, errMsg);
    try {
      const { error: logErr } = await supabaseClient.from("notification_log").insert({
        guest_id: guestId, recipient: phone,
        trigger_type: triggerType, channel: "whatsapp",
        status: replyStatus,
        payload: { error: errMsg || PAYMENT_LINK_FAILURE_LABEL, ...(buttonTitle ? { buttonTitle } : {}) },
      });
      if (logErr) console.warn("[webhook] notification_log insert error:", logErr.message);
    } catch (logEx) { console.warn("[webhook] notification_log insert error:", (logEx as Error).message); }
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

// ── §1e  UNIFIED AI LEARNING — xos_ai_rules (migration 103) ───────────────────
// chat rules → guest persona prompt; routing rules → tool/routing block only.
// Cached 5 min like bot_config; any failure returns empty suffixes.
interface LearnedRulesSuffixes {
  chatSuffix: string;
  routingSuffix: string;
}
let _learnedRulesCache: { data: LearnedRulesSuffixes; at: number } | null = null;

const EMPTY_LEARNED_RULES: LearnedRulesSuffixes = { chatSuffix: "", routingSuffix: "" };

function _formatLearnedBlock(title: string, bullets: string[]): string {
  return bullets.length ? `\n\n${title}\n${bullets.join("\n")}` : "";
}

async function fetchLearnedRulesSuffixes(
  supabaseClient: ReturnType<typeof createClient>,
): Promise<LearnedRulesSuffixes> {
  const now = Date.now();
  if (_learnedRulesCache && now - _learnedRulesCache.at < CONFIG_TTL_MS) {
    return _learnedRulesCache.data;
  }
  try {
    const { data, error } = await supabaseClient
      .from("xos_ai_rules")
      .select("module, rule_text")
      .in("module", ["chat", "routing"])
      .order("created_at", { ascending: true });

    if (error) {
      console.warn("[webhook] xos_ai_rules fetch failed (non-blocking):", error.message);
      return _learnedRulesCache?.data ?? EMPTY_LEARNED_RULES;
    }

    const rows = (data ?? []) as Array<{ module: string; rule_text: string }>;
    const byModule: Record<string, string[]> = { chat: [], routing: [] };
    for (const row of rows) {
      const t = String(row.rule_text ?? "").trim();
      if (!t) continue;
      const mod = String(row.module ?? "").trim();
      if (mod === "chat" || mod === "routing") byModule[mod].push(`- ${t}`);
    }

    const suffixes: LearnedRulesSuffixes = {
      chatSuffix: _formatLearnedBlock("══ כללים שנלמדו — צ'אט ══", byModule.chat),
      routingSuffix: _formatLearnedBlock("══ כללים שנלמדו — ניתוב (פנימי) ══", byModule.routing),
    };
    _learnedRulesCache = { data: suffixes, at: now };
    return suffixes;
  } catch (e) {
    console.warn("[webhook] xos_ai_rules fetch error (non-blocking):", (e as Error).message);
    return _learnedRulesCache?.data ?? EMPTY_LEARNED_RULES;
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

// buildSystemPrompt is the THIRD-priority fallback (after bot_settings.system_prompt
// and bot_scripts.ongoing_concierge.ai_system_prompt). It reads ALL behavioral
// content from bot_config rows — NO hardcoded marketing text or URLs are injected
// here. If you want to change the bot's behavior, use BotSettings.js (UI source
// of truth) or BotConfigPanel for individual config keys.
function buildSystemPrompt(cfg: Record<string, string>): string {
  if (!Object.keys(cfg).length) return FALLBACK_SYSTEM_PROMPT;

  const botName    = cfg["bot_name"]        ?? "DREAM CONCIERGE";
  const persona    = cfg["bot_personality"] ?? "";
  const checkin    = cfg["hotel_checkin_time"]     ?? "15:00";
  const checkout   = cfg["hotel_checkout_time"]    ?? "11:00";
  const pool       = cfg["hotel_pool_hours"]       ?? "08:00–20:00";
  const spa        = cfg["hotel_spa_hours"]        ?? "09:00–21:00";
  const restaurant = cfg["hotel_restaurant_hours"] ?? "07:00–22:00";
  const fitness    = cfg["hotel_fitness_hours"]    ?? "";   // optional — set in BotConfigPanel
  const bar        = cfg["hotel_bar_hours"]        ?? "";   // optional — set in BotConfigPanel
  const wifi       = cfg["hotel_wifi"]             ?? "DreamIsland_Guest — סיסמה בקבלה";
  const special    = cfg["hotel_special_services"] ?? "";
  const bookingUrl = cfg["hotel_booking_url"]      || Deno.env.get("BOOKING_URL") || "";
  // Custom behavioral rules set by admin in BotConfigPanel (config_key="response_rules").
  // This is the DB-controlled replacement for any hardcoded instruction list.
  const responseRules = cfg["response_rules"] ?? "";
  const faqRule       = cfg["response_faq_rule"] ?? "";

  return `
אתה "${botName}" — הקונסיירז' הדיגיטלי הרשמי של Dream Island, אחד מאתרי הנופש היוקרתיים בישראל.
דבר/י כמו מנהל/ת אירוח אנושי, חם ומהיר — לא רשמי ולא רובוטי, בלי ניסוחים תאגידיים נוקשים.
${persona ? `\n══ אישיות ונימה (מותאם-אישית מה-UI) ══\n${persona}` : ""}

══ ידע הריזורט ══
▸ שעות:
  • צ'ק-אין: ${checkin} | צ'ק-אאוט: ${checkout}
  • בריכה: ${pool}
  • מסעדה: ${restaurant}
  • ספא: ${spa}
  ${fitness ? `• חדר כושר: ${fitness}` : ""}
  ${bar ? `• בר: ${bar}` : ""}

▸ שירותים ומתקנים:
  • WiFi: ${wifi}
  • חניה: חינם לאורחים | שירות חדרים: 24/7
  ${special ? `• ${special}` : ""}
  ${bookingUrl ? `• הזמנות ומידע מלא: ${bookingUrl}` : ""}

══ הנחיות בסיס ══
1. לעולם אל תמציא מחירים, מספרי טלפון, או פרטים שאינם מפורשים.
2. אם פרט אינו ידוע לך ולא מופיע ב"פרטי האורח הנוכחי" — לעולם אל תמציא תשובה. השב במדויק: "אני בודק את זה מול דלפק הקבלה, נציג אנושי יחזור אליך לכאן ברגעים אלו ממש."
3. CRITICAL: אם האורח שואל על פרט אישי שלו והוא מופיע ב"פרטי האורח הנוכחי" — ענה ישירות עם הערך המדויק.
4. אל תחשוף שאתה AI.
5. אם יש תקלה / המתנה ארוכה — כתוב שהעברת לצוות, אל תטפל בעצמך.
6. אל תפתח ב"שלום [שם]" — המשך את השיחה באופן אנושי וטבעי.
7. קרא היסטוריית שיחה — אל תחזור על מידע שנמסר.
8. לעולם אל תכלול תגיות כגון [תבנית:...] בתשובתך.
9. פלוט אך ורק את התשובה הסופית בעברית — בלי חשיבה/ניתוח/הסבר ובלי טקסט באנגלית. כל "According to..."/"the category..." נחשב דליפה.
${faqRule ? `10. ${faqRule}` : ""}
${responseRules ? `\n══ כללי שיחה נוספים (מה-UI) ══\n${responseRules}` : ""}
`.trim();
}

// ── §1c  GUEST STAGE CONTEXT — injected into every AI prompt ────────────────
// Tells the AI what stage the guest is in so it can adapt tone & content.
function buildGuestStageContext(
  guest: Record<string, unknown> | null,
  conversationHistory: Array<{ direction: string; message: string }>,
  opts?: { forceInHouse?: boolean },
): string {
  if (!guest) return "";

  const today    = new Date().toISOString().split("T")[0];
  const arrDate  = guest.arrival_date as string | null;
  const room     = guest.room        as string | null;
  const roomType = guest.room_type   as string | null;
  const confirmed = guest.arrival_confirmed as boolean | null;
  const spaTime  = guest.spa_time    as string | null;
  const forceInHouse = opts?.forceInHouse === true;
  const isCheckedIn = forceInHouse || guest.status === "checked_in";

  let stage = "";
  if (forceInHouse) {
    stage = "בתוך השהות — האורח בחדר (זוהה לפי בקשת חדר/שירות)";
  } else if (arrDate) {
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
  if (room && isCheckedIn) {
    parts.push(`חדר: ${room}`);
  } else if (room) {
    parts.push("חדר: ייחשף בצ'ק-אין — לפני אז אסור לחשוף/להמציא שם חדר ספציפי, רק לציין שזו סוויטת יוקרה");
  }
  if (roomType === "suite") parts.push("סוג: סוויטה");
  if (confirmed)  parts.push("אישר הגעה: כן");
  if (spaTime)    parts.push(`שעת טיפול ספא: ${spaTime}`);
  if (hasStage2)  parts.push("כבר קיבל הודעת אישור+ספא");
  if (hasStage3)  parts.push("כבר קיבל הודעת בוקר הגעה");

  const profileLine = formatGuestProfileForAi(
    guest.guest_profile as Record<string, unknown> | null,
    guest.arrival_time as string | null,
  );
  if (profileLine) parts.push(profileLine);

  return parts.length > 0 ? parts.join(" | ") : "";
}

function isUniqueViolation(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "23505" || /duplicate key|unique constraint/i.test(error.message ?? "");
}

/** Insert-first dedup claim — unique index on wa_message_id is the ledger of record. */
async function claimInboundWaMessage(
  supabase: ReturnType<typeof createClient>,
  row: {
    phone: string;
    guest_id: number | null;
    message: string;
    wa_message_id: string;
    push_name: string | null;
    intent?: string;
    human_requested?: boolean;
    human_request_type?: string | null;
  },
): Promise<{ claimed: boolean; conversationId: number | null }> {
  const { data, error } = await supabase
    .from("whatsapp_conversations")
    .insert({
      phone: row.phone,
      guest_id: row.guest_id,
      direction: "inbound",
      message: row.message,
      wa_message_id: row.wa_message_id,
      intent: row.intent ?? "received",
      push_name: row.push_name,
      ...(row.human_requested ? { human_requested: true, human_request_type: row.human_request_type } : {}),
    })
    .select("id")
    .maybeSingle();

  if (error) {
    if (isUniqueViolation(error)) return { claimed: false, conversationId: null };
    console.error("[webhook] claimInboundWaMessage failed:", error.message);
    return { claimed: true, conversationId: null };
  }
  return { claimed: true, conversationId: (data?.id as number) ?? null };
}

async function patchClaimedInbound(
  supabase: ReturnType<typeof createClient>,
  conversationId: number | null,
  waMessageId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const q = conversationId
    ? supabase.from("whatsapp_conversations").update(patch).eq("id", conversationId)
    : supabase.from("whatsapp_conversations").update(patch).eq("wa_message_id", waMessageId);
  const { error } = await q;
  if (error) console.warn("[webhook] patchClaimedInbound failed:", error.message);
}

/** Leader of a rapid burst orchestrates one LLM reply; followers log only. */
async function coalesceBurstIfLeader(
  supabase: ReturnType<typeof createClient>,
  phone: string,
  msgId: string,
): Promise<{ proceed: boolean; coalescedText: string }> {
  await new Promise((r) => setTimeout(r, BURST_COALESCE_MS));

  const since = new Date(Date.now() - BURST_WINDOW_MS).toISOString();
  const { data: recentInbound } = await supabase
    .from("whatsapp_conversations")
    .select("message, wa_message_id, created_at")
    .eq("phone", phone)
    .eq("direction", "inbound")
    .gte("created_at", since)
    .order("created_at", { ascending: true });

  const burst = (recentInbound ?? []) as Array<{ message: string; wa_message_id: string | null }>;
  if (burst.length === 0) return { proceed: true, coalescedText: "" };

  const leaderId = burst[0]?.wa_message_id;
  if (leaderId && leaderId !== msgId) {
    console.info(
      `[webhook] burst delegate skip — msg:${msgId.slice(-8)} leader:${leaderId.slice(-8)}`,
    );
    return { proceed: false, coalescedText: "" };
  }

  const coalescedText = burst.map((b) => b.message).filter(Boolean).join("\n");
  return { proceed: true, coalescedText };
}

function applyInRoomStatusOverride(
  supabase: ReturnType<typeof createClient>,
  guestId: number,
  phone: string,
): void {
  supabase
    .from("guests")
    .update({ status: "checked_in" })
    .eq("id", guestId)
    .then(({ error }: { error: { message: string } | null }) => {
      if (error) {
        console.error(`[webhook] in-room status override FAILED phone:${phone}:`, error.message);
      }
    });
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

/** Upsell = day-pass→overnight, room upgrade (NOT late checkout / extension — see sensitive stay shield) */
const UPSELL_PATTERNS: RegExp[] = [
  // Hebrew
  /ללון|לינה|לישון\s*(כאן|פה|איתכם)/i,
  /לשדרג|שדרוג|חדר\s*(יותר\s*)?(גדול|טוב|יוקרתי)|לעבור\s*(ל)?סוויטה/i,
  /בילוי\s*יומי.*לינ|day\s*pass.*stay/i,
  // English
  /stay\s*(over|the\s*night|overnight)/i,
  /upgrade(\s+my\s+room)?|better\s+room|larger\s+room|move\s+to\s+(a\s+)?suite/i,
];

function classifyIntent(text: string): Intent {
  if (isSensitiveStayChangeRequest(text)) return "fallback"; // shield handles reply — never upsell/LLM enthusiasm
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

// ── Record-only arrival TIME (not date change) — no staff alerts ────────────
const RECORD_ONLY_ARRIVAL_REPLY =
  "תודה שעדכנתם, רשמתי לפניי את שעת ההגעה שלכם. מחכים לכם!";

/** Guest asking when to arrive — FAQ, not a time update. */
const ARRIVAL_TIME_QUESTION_RE =
  /(?:מה|איזו|מתי|באיזה|כמה)\s+.{0,24}?(?:שעת?\s*ה?געה|נגיע|מגיע)|\?\s*$|what\s+time\s+(do|should|can)/i;

/** Guest stating an estimated arrival time (not a date-change request). */
const ARRIVAL_TIME_UPDATE_RE =
  /שעת\s*הגעה|נגיע|ניגיע|מגיעים?|הגעה\s|צפו[ייה]\s*להגיע|מתוכנן|בסביבות|בערך|arriving\s+at/i;

function extractArrivalTimeFromText(text: string): string | null {
  const t = text.trim();

  const colon = t.match(/(?:^|[^\d])(\d{1,2})\s*[:.׳·]\s*(\d{2})(?:\s|$|[^\d])/);
  if (colon) {
    const h = parseInt(colon[1], 10);
    const m = parseInt(colon[2], 10);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    }
  }

  const hourWord = t.match(/(?:בשעה|ב[-–]?\s*|שעה\s+|at\s+)(\d{1,2})(?:\s|$|[^\d:])/i);
  if (hourWord) {
    const h = parseInt(hourWord[1], 10);
    if (h >= 0 && h <= 23) return `${String(h).padStart(2, "0")}:00`;
  }

  const bare = t.match(/^(\d{1,2})\s*[:.׳·]\s*(\d{2})$/);
  if (bare) {
    const h = parseInt(bare[1], 10);
    const m = parseInt(bare[2], 10);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    }
  }

  return null;
}

function isRecordOnlyArrivalTimeUpdate(text: string): boolean {
  if (DATE_CHANGE_RE.test(text)) return false;
  if (ARRIVAL_TIME_QUESTION_RE.test(text)) return false;
  const time = extractArrivalTimeFromText(text);
  if (!time) return false;
  const trimmed = text.trim();
  const isBareTimeReply =
    trimmed.length <= 8 &&
    !/[א-ת]{4,}/.test(trimmed.replace(/[\d:.׳·\s-–]/g, ""));
  return ARRIVAL_TIME_UPDATE_RE.test(text) || isBareTimeReply;
}

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

// ══════════════════════════════════════════════════════════════════════════════
// §4b  DUAL-ROUTING TRIGGER — Session 26 Sprint 3.1. Bridges a guest's
//      log_guest_request tool call straight into the staff ops Whapi group
//      (the same `tasks` table + group the Ops & Maintenance Board already
//      uses, CLAUDE.md §0.4 Universal Architecture — not a parallel ticket
//      system). guest_alerts (flagGuestAlert's sibling insert at the call
//      site) keeps logging every request to the dashboard regardless; this
//      is purely an ADDITIONAL fast-path for suite guests so staff see it
//      in WhatsApp without anyone opening the dashboard.
//
//      Suite-Only Profile Filter: day-guest ("בילוי יומי") and standard-room
//      requests never call this — they stay dashboard-only by design (the
//      ops group is a 24/7-reachable real-time channel; flooding it with
//      every day-pass ask would erode its signal for the genuinely time-
//      sensitive suite-guest case this exists for).
//
//      Non-blocking / best-effort: a Whapi failure here must never affect
//      the guest's own reply (already sent by the time this runs) or the
//      guest_alerts dashboard row (already inserted independently).
// ══════════════════════════════════════════════════════════════════════════════
async function routeGuestRequestToOpsGroup(
  supabase: ReturnType<typeof createClient>,
  args: { guestId: number; room: string | null; summary: string; rawText: string },
): Promise<void> {
  const groupId = Deno.env.get("WHAPI_GROUP_ID")?.trim();
  if (!groupId) {
    console.warn("[webhook] 🛋️ WHAPI_GROUP_ID unset — guest_request not routed to ops group (dashboard guest_alerts row still stands)");
    return;
  }

  const roomLabel = args.room ?? "—";
  // Card text stays English per the dual-language framework (CLAUDE.md
  // sla-escalation-cron header: guests Hebrew, staff English) — item_summary
  // itself is the model's short HEBREW extraction (LOG_REQUEST_JSON_SCHEMA),
  // left untranslated on purpose: a guest's free-text ask ("יין אדום") read
  // verbatim by staff is more reliable than a machine-translated paraphrase,
  // and adding a translation call here is one more failure point for a
  // 3-8 word string. Mixed-language card, deliberate.
  // Session 27 Sprint 4.1: same reaction-only resolution hint as the staff-
  // report card (whapi-webhook's buildTaskCard) — this card is resolved by
  // the exact same 👍🏼 listener (whapi_message_id lookup), no separate link.
  const card = `🛋️ [${roomLabel}] Guest requested: ${args.summary}\n👉 Please react with 👍🏼 to complete this task.`;

  const { data: task, error: insertErr } = await supabase
    .from("tasks")
    .insert([{
      room_number: args.room,
      department:  "תפעול",
      description: args.summary,
      priority:    "normal",
      status:      "open",
      source:      "guest_request",
      guest_id:    args.guestId,
      reporter_raw_text: args.rawText,
      action_token: crypto.randomUUID(),
    }])
    .select("id")
    .single();
  if (insertErr || !task) {
    console.error("[webhook] 🛋️ guest_request task insert error:", insertErr?.message);
    return;
  }

  let msgId: string | null = null;
  try {
    msgId = await sendWhapiText(groupId, card, { noLinkPreview: true });
  } catch (e) {
    console.warn(`[webhook] 🛋️ guest_request task ${task.id} created but Whapi send failed:`, (e as Error).message);
  }
  if (msgId) {
    const { error: updErr } = await supabase.from("tasks").update({ whapi_message_id: msgId }).eq("id", task.id);
    if (updErr) console.warn(`[webhook] 🛋️ failed to store whapi_message_id for task ${task.id}:`, updErr.message);
  }
  console.info(`[webhook] 🛋️ guest_request task ${task.id} room=${roomLabel} routed to ops group (sent=${!!msgId})`);
}

// ══════════════════════════════════════════════════════════════════════════════
// §4b.1  IMMEDIATE OPERATIONAL ROUTING — Tier-0 keyword intercept for guests
//        already checked_in. Runs after wa_message_id dedup, before burst/LLM.
//        No LLM — deterministic luxury dispatch reply + tasks + guest flags.
// ══════════════════════════════════════════════════════════════════════════════
async function handleOperationalInHouseIntercept(
  supabase: ReturnType<typeof createClient>,
  opts: {
    phone: string;
    guestId: number;
    guest: Record<string, unknown>;
    text: string;
    msgId: string;
    claimedConversationId: number | null;
    sim: boolean;
  },
): Promise<void> {
  const { phone, guestId, guest, text, msgId, claimedConversationId, sim } = opts;
  const summary = buildOperationalRequestSummary(text);
  const guestName = (guest.name as string | null) ?? null;
  const guestRoom = (guest.room as string | null) ?? null;
  const reply = buildOperationalDispatchReply(summary, guestName);

  await patchClaimedInbound(supabase, claimedConversationId, msgId, {
    guest_id: guestId,
    intent: "operational_in_house_request",
  });

  const { error: guestErr } = await supabase.from("guests").update({
    requires_attention:       true,
    requires_attention_since: new Date().toISOString(),
    attention_reason:         summary,
  }).eq("id", guestId);
  if (guestErr) {
    console.error("[webhook] 🛎️ operational intercept guest update FAILED:", guestErr.message);
  }

  // Operations Board (tasks) + Whapi ops group card — same path as log_guest_request.
  routeGuestRequestToOpsGroup(supabase, {
    guestId,
    room: guestRoom,
    summary,
    rawText: text,
  }).catch((e: Error) =>
    console.error("[webhook] 🛎️ operational intercept routeGuestRequestToOpsGroup error:", e.message)
  );

  if (!sim) {
    try {
      await sendReply(phone, reply);
      await supabase.from("whatsapp_conversations").insert({
        phone,
        guest_id:      guestId,
        direction:     "outbound",
        message:       reply,
        wa_message_id: null,
        intent:        "operational_in_house_request",
      });
    } catch (e) {
      console.error("[webhook] 🛎️ operational intercept reply failed:", (e as Error).message);
    }
  } else {
    console.info(`[webhook] SIM — operational in-house intercept from ${phone}: ${summary}`);
  }

  console.info(
    `[webhook] 🛎️ operational in-house intercept — phone:${phone} guest:${guestId} summary:${summary}`,
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// §4b.2  SENSITIVE STAY-CHANGE SHIELD — late checkout / extension / early
//        check-in / room change. Never imply approval; canonical staff handoff.
// ══════════════════════════════════════════════════════════════════════════════
async function handleSensitiveStayChangeHandoff(
  supabase: ReturnType<typeof createClient>,
  opts: {
    phone: string;
    guestId: number | null;
    text: string;
    msgId: string;
    claimedConversationId: number | null;
    sim: boolean;
    auditSource: string;
  },
): Promise<void> {
  const { phone, guestId, text, msgId, claimedConversationId, sim, auditSource } = opts;

  await patchClaimedInbound(supabase, claimedConversationId, msgId, {
    guest_id: guestId,
    intent: "sensitive_stay_change_request",
    human_requested: true,
    human_request_type: "date_change",
  });

  if (guestId) {
    const { error: guestErr } = await supabase.from("guests").update({
      requires_attention:       true,
      requires_attention_since: new Date().toISOString(),
      needs_callback:           true,
      attention_reason:         "date_change",
    }).eq("id", guestId);
    if (guestErr) {
      console.error("[webhook] 🛡️ sensitive_stay_change guest update FAILED:", guestErr.message);
    }
  }

  (async () => {
    const { error } = await supabase.from("guest_alerts").insert({
      guest_id: guestId,
      phone,
      alert_type: "date_change_request",
      message: text,
      conversation_id: claimedConversationId,
      resolved: false,
    });
    if (error) console.warn("[webhook] guest_alerts (sensitive_stay_change) error:", error.message);
  })().catch((e: Error) =>
    console.warn("[webhook] guest_alerts (sensitive_stay_change) error:", e.message)
  );

  if (!sim) {
    try {
      await sendReply(phone, CANONICAL_STAY_CHANGE_HANDOFF_MSG);
      await supabase.from("whatsapp_conversations").insert({
        phone,
        guest_id:      guestId,
        direction:     "outbound",
        message:       CANONICAL_STAY_CHANGE_HANDOFF_MSG,
        wa_message_id: null,
        intent:        "sensitive_stay_change_request",
      });
    } catch (e) {
      console.error("[webhook] 🛡️ sensitive_stay_change reply failed:", (e as Error).message);
    }
  }

  console.info(
    `[webhook] 🛡️ SENSITIVE_STAY_CHANGE mitigation — source:${auditSource} phone:${phone} guest:${guestId ?? "unknown"} text:"${text.slice(0, 80)}"`,
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// §4c DAY-GUEST UPSELL GATE — Session 27 Sprint 4.3. "Premium Suite" maps onto
//      the two real Premium Day inventory slots (guests.room IN 'Premium Day 1'
//      / 'Premium Day 2' — AddGuestModal/ArrivalImportPanel's day-package
//      values). It's the only "Premium ___" concept that actually exists in
//      this schema — there is no literal "Premium Suite" row in
//      src/data/suiteRegistry.js's 26 physical suites. Fails closed (treats a
//      lookup error as "taken") — never oversell a slot the system isn't sure
//      is free.
// ══════════════════════════════════════════════════════════════════════════════
async function isPremiumDaySlotAvailableToday(supabase: ReturnType<typeof createClient>): Promise<boolean> {
  const today = new Date().toISOString().split("T")[0];
  const { data, error } = await supabase
    .from("guests")
    .select("room")
    .eq("arrival_date", today)
    .neq("status", "cancelled")
    .in("room", ["Premium Day 1", "Premium Day 2"]);
  if (error) {
    console.warn("[webhook] isPremiumDaySlotAvailableToday lookup failed — defaulting to 'taken' (fail-closed):", error.message);
    return false;
  }
  const takenSlots = new Set((data ?? []).map((g) => g.room as string));
  return takenSlots.size < 2;
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
  "WiFi, location, what's included) or when the guest only states their " +
  "estimated arrival time (e.g. 'we will arrive at 14:00') — only for something " +
  "a staff member needs to actually go do something about.";

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
מידע כלליות (שעות פתיחה, WiFi, מיקום) ולא כשהאורח רק מעדכן שעת הגעה משוערת
(למשל "נגיע בשעה 15:00") — זה נרשם אוטומטית בלי טיקט לצוות.
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

const GEMINI_FETCH_TIMEOUT_MS = 8000;
// Retries before trying the next model or falling back to Claude — prefer burning
// Google quota/credits over Anthropic on transient 429/503 bursts.
const GEMINI_MAX_RETRIES = 3;
const GEMINI_RETRY_BASE_MS = 1000;
const GEMINI_RETRY_MAX_MS = 8000;

function _sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function _isGeminiRetryableStatus(status: number): boolean {
  return status === 429 || status === 408 || status === 500 || status === 502 || status === 503;
}

function _geminiRetryDelayMs(attempt: number, retryAfterHeader: string | null): number {
  if (retryAfterHeader) {
    const sec = Number(retryAfterHeader);
    if (!Number.isNaN(sec) && sec > 0) return Math.min(sec * 1000, 30_000);
  }
  const exp = GEMINI_RETRY_BASE_MS * 2 ** attempt;
  const jitter = Math.floor(Math.random() * 250);
  return Math.min(exp + jitter, GEMINI_RETRY_MAX_MS);
}

function _isGeminiFetchTimeout(e: unknown): boolean {
  const err = e as Error;
  return err.name === "TimeoutError" || err.name === "AbortError"
    || /timeout|aborted/i.test(err.message);
}

/** One generateContent call with exponential backoff on rate-limit / transient errors. */
async function _geminiGenerateWithRetry(
  apiKey: string,
  model: string,
  body: string,
): Promise<
  | { kind: "ok"; data: Record<string, unknown> }
  | { kind: "not_found"; errBody: string }
  | { kind: "fatal"; status: number; errBody: string }
  | { kind: "retry_exhausted"; status: number; errBody: string }
> {
  let lastStatus = 0;
  let lastErrBody = "";

  for (let attempt = 0; attempt <= GEMINI_MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          signal: AbortSignal.timeout(GEMINI_FETCH_TIMEOUT_MS),
        },
      );

      if (res.status === 404) {
        const errBody = await res.text();
        return { kind: "not_found", errBody };
      }

      if (!res.ok) {
        const errBody = await res.text();
        lastStatus = res.status;
        lastErrBody = errBody;

        if (_isGeminiRetryableStatus(res.status) && attempt < GEMINI_MAX_RETRIES) {
          const delay = _geminiRetryDelayMs(attempt, res.headers.get("Retry-After"));
          console.warn(
            `[webhook] Gemini ${res.status} model="${model}" attempt ${attempt + 1}/${GEMINI_MAX_RETRIES + 1} — retry in ${delay}ms`,
          );
          await _sleep(delay);
          continue;
        }

        if (_isGeminiRetryableStatus(res.status)) {
          return { kind: "retry_exhausted", status: res.status, errBody };
        }
        return { kind: "fatal", status: res.status, errBody };
      }

      const data = await res.json();
      return { kind: "ok", data };
    } catch (e) {
      if (_isGeminiFetchTimeout(e) && attempt < GEMINI_MAX_RETRIES) {
        const delay = _geminiRetryDelayMs(attempt, null);
        console.warn(
          `[webhook] Gemini timeout model="${model}" attempt ${attempt + 1}/${GEMINI_MAX_RETRIES + 1} — retry in ${delay}ms`,
        );
        await _sleep(delay);
        continue;
      }
      throw e;
    }
  }

  return { kind: "retry_exhausted", status: lastStatus, errBody: lastErrBody };
}

async function askGemini(
  userMessage: string,
  guestName: string | null,
  history: Array<{ direction: string; message: string }>,
  systemPrompt: string,
  modelOrder: string[] = GEMINI_MODELS,
  toolsEnabled = true,
  toolInstructionsSuffix = "",
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
    parts: [{ text: systemPrompt + TOOL_USAGE_INSTRUCTIONS + toolInstructionsSuffix + guestLine + "\nהבנת את התפקיד? ענה 'כן' בלבד." }],
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
    const outcome = await _geminiGenerateWithRetry(apiKey, model, body);

    if (outcome.kind === "not_found") {
      console.warn(`[webhook] Gemini model "${model}" not found — trying next. ${outcome.errBody.slice(0, 150)}`);
      continue;
    }

    if (outcome.kind === "fatal") {
      console.error(`[webhook] Gemini ${outcome.status} model="${model}" (non-retryable):`, outcome.errBody.slice(0, 400));
      throw new Error(`gemini_${outcome.status}: ${outcome.errBody.slice(0, 200)}`);
    }

    if (outcome.kind === "retry_exhausted") {
      console.warn(
        `[webhook] Gemini ${outcome.status} model="${model}" — retries exhausted, trying next model. ${outcome.errBody.slice(0, 200)}`,
      );
      continue;
    }

    const result = extractResult(outcome.data);
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
    const outcome = await _geminiGenerateWithRetry(apiKey, discovered, body);
    if (outcome.kind === "ok") {
      const result = extractResult(outcome.data);
      if (result) {
        if (result.loggedRequest) {
          console.info(`[webhook] 🔧 Gemini (discovered) called ${LOG_REQUEST_TOOL_NAME}:`, JSON.stringify(result.loggedRequest));
        }
        console.log(`[webhook] Gemini OK (discovered) model="${discovered}"`);
        return result;
      }
    } else if (outcome.kind === "fatal") {
      console.error(`[webhook] Gemini (discovered) ${outcome.status}:`, outcome.errBody.slice(0, 400));
      throw new Error(`gemini_${outcome.status}: ${outcome.errBody.slice(0, 200)}`);
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
  toolInstructionsSuffix = "",
): Promise<AiReplyResult> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("no_anthropic_key");

  const system = systemPrompt
    + TOOL_USAGE_INSTRUCTIONS
    + toolInstructionsSuffix
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

const GOOGLE_REVIEW_URL   = Deno.env.get("GOOGLE_REVIEW_URL")   ?? "";

// Same number as task-action.ts's ACTOR_PHONES.Adir, whapi-webhook's reverse
// lookup map, and guest-portal-ops-request's ADIR_PHONE — duplicated, not
// imported (Deno functions don't share modules across function boundaries
// in this repo).
const ADIR_PERSONAL_PHONE = "972546294885";

// Pre-Arrival Guest Portal magic-link (migration 083, session 35) — base URL
// for {{PORTAL_LINK}} below. Defaults to the documented live Vercel URL
// (CLAUDE.md §1) so this works with zero secret configuration; override via
// PORTAL_BASE_URL if the deployment URL ever changes.
const PORTAL_BASE_URL = (Deno.env.get("PORTAL_BASE_URL") ?? "https://dream-ai-system.vercel.app").replace(/\/$/, "");
function buildPortalLink(portalToken: unknown): string {
  const token = String(portalToken ?? "").trim();
  return token ? `${PORTAL_BASE_URL}/portal/${token}` : "";
}

// A timeout/abort means we never learned whether Meta processed the request —
// not the same as Meta rejecting it. Tagged distinctly so callers (notification_log
// writers, AICopilot, etc.) can report "outcome unknown" instead of a confident
// but possibly-wrong "failed" (FAIL VISIBLE, CLAUDE.md §0.3).
function _isAbortError(e: unknown): boolean {
  return e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError");
}

// buttonUrlParam: if set, passes a dynamic URL suffix to button index 0
// Templates with a Media Header (IMAGE) require a `header` component —
// Meta error without it: "Format mismatch, expected IMAGE, received UNKNOWN".
const _TEMPLATE_IMAGE_HEADERS: Record<string, string> = {
  dream_suite_reminder:        "https://tzalamnadlan.co.il/wp-content/uploads/2026/default-resort.jpg",
  night_before_suites:         "https://tzalamnadlan.co.il/wp-content/uploads/2026/default-resort.jpg",
  night_before_suites_shabbat: "https://tzalamnadlan.co.il/wp-content/uploads/2026/default-resort.jpg",
};

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
  const headerImageUrl = _TEMPLATE_IMAGE_HEADERS[templateName];
  if (headerImageUrl) {
    components.push({ type: "header", parameters: [{ type: "image", image: { link: headerImageUrl } }] });
  }
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

/**
 * Strip chain-of-thought leakage and internal tags before the reply reaches the guest.
 *
 * Handles all known patterns:
 *  • XML thinking blocks:  <thinking>…</thinking>
 *  • Labeled text blocks:  THOUGHT: …\n\n  |  Reasoning: …\n\n  |  מחשבה: …\n\n
 *  • Markdown headers:     **Thinking:** …\n\n
 *  • Lone label lines:     THOUGHT: single line (not followed by blank line)
 *  • Internal bracket tags: [תבנית:…]  |  [tag]
 *  • Unresolved placeholders: {{GUEST_NAME}} etc. (safety net per CLAUDE.md §CORE #2)
 */
function sanitizeReply(text: string): string {
  let result = text;

  // ── 1. XML-style thinking blocks (Claude extended-thinking / some Gemini variants) ──
  // Covers <thinking>…</thinking> AND <think>…</think>, plus any lone/unclosed tag.
  result = result.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>\s*/gi, "");
  result = result.replace(/<\/?think(?:ing)?>/gi, "");

  // ── 2. Labeled multi-line thought blocks followed by a blank line ─────────────────
  // Strips the entire block up to (and including) the separating blank line so the
  // actual reply starts at the first non-thought paragraph.
  // Covers: THOUGHT / Reasoning / Thinking / Analysis / COT / Plan / מחשבה / ניתוח / תכנון
  result = result.replace(
    /^(?:THOUGHT|Reasoning|Thinking|Analysis|COT|Plan|מחשבה|ניתוח|תכנון)\s*:[\s\S]*?(?=\n\n|$)/gim,
    ""
  );

  // ── 3. Markdown bold-header thought blocks ("**Thinking:**\n…\n\n") ──────────────
  result = result.replace(
    /^\*\*(?:Thinking|Reasoning|Analysis|Thought|מחשבה)\*\*\s*:?[\s\S]*?(?=\n\n|$)/gim,
    ""
  );

  // ── 4. Any remaining lone thought-label line (no blank line after) ───────────────
  result = result.replace(
    /^(?:THOUGHT|Reasoning|Thinking|COT|מחשבה)\s*:.*$/gim,
    ""
  );

  // ── 4b. Unlabeled English chain-of-thought preamble ──────────────────────────────
  // The concierge persona ALWAYS replies in Hebrew. Some model outputs prepend raw
  // reasoning with NO label or tag — e.g. "The user is in the pre-arrival stage. I
  // should respond warmly..." — before the real Hebrew answer. Strip a LEADING run
  // of lines that contain ZERO Hebrew and open with a reasoning cue, stopping at the
  // first line that has Hebrew (the actual guest-facing reply) or isn't a cue.
  // If EVERYTHING gets stripped (output was pure English reasoning), result becomes
  // "" and sendReply()'s empty-guard substitutes a safe Hebrew line — never leak.
  //
  // Cue list is deliberately broad and includes the EXACT phrasings reported leaking
  // into live guest chats (Session 24): "According to the instructions...",
  // "category should be..." (the model reasoning aloud about the log_guest_request
  // `category` tool argument), and "Let's break down the response:".
  const COT_CUE = /^\s*(?:the\s+(?:user|guest|customer|client|category|response|reply|answer|message|intent|assistant|tone|request)\b|according\s+to\b|category\b|intent\b|output\b|response\s+should\b|i\s|i'|let'?s\b|let\s+me\b|first[,:]|now[,:]|okay\b|ok[,:]|so[,:]|well[,:]|based\s+on\b|since\b|given\b|considering\b|because\b|here'?s\b|here\s+is\b|in\s+this\s+case\b|as\s+an?\s+ai\b|we\s+(?:should|need|will|are)\b|they\s+(?:are|want|asked|asking|need)\b|this\s+(?:is|seems|appears|looks)\b|looking\s+at\b|to\s+(?:respond|reply|answer|address)\b|should\s+be\b|note[:]|reasoning\b|analysis\b|my\s+(?:response|reply|task|goal)\b|step\s+\d)/i;
  const hasHebrew = (s: string) => /[֐-׿]/.test(s);
  {
    const lines = result.split("\n");
    let i = 0;
    while (i < lines.length) {
      const ln = lines[i];
      if (ln.trim() === "") { i++; continue; }                    // skip blank separators
      if (!hasHebrew(ln) && COT_CUE.test(ln)) { i++; continue; }  // drop reasoning line
      break;                                                       // first real reply line
    }
    if (i > 0) result = lines.slice(i).join("\n").trim();
  }
  // Same-line leak: text still OPENS with an English reasoning cue but has Hebrew
  // later ("The user is X. שלום!") → cut everything before the first Hebrew letter.
  if (COT_CUE.test(result) && hasHebrew(result)) {
    const idx = result.search(/[֐-׿]/);
    if (idx > 0) result = result.slice(idx).trim();
  }

  // ── 5. Internal instruction tags ─────────────────────────────────────────────────
  result = result
    // Template-name markers: [תבנית: dream_arrival_confirmation]
    .replace(/\[תבנית[^\]]*\]/gi, "")
    // Short bracketed Hebrew/alphanumeric internal tags
    .replace(/\[[֐-׿\w\-_:]{2,60}\]/g, "")
    // Safety net: any {{PLACEHOLDER}} that resolvePlaceholders() didn't substitute
    // (e.g. a typo in BotScriptEditor) — strip rather than send raw to guest.
    .replace(/\{\{[^}]+\}\}/g, "")
    // Collapse triple+ blank lines left after stripping
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // ── 6. Pure-English leak guard — concierge must reply in Hebrew only ─────────
  if (result.length > 12 && !hasHebrew(result)) {
    return "";
  }

  return result;
}


// ══════════════════════════════════════════════════════════════════════════════
// §6  META CLOUD API — send WhatsApp reply
// ══════════════════════════════════════════════════════════════════════════════
async function sendReply(to: string, body: string): Promise<string> {
  const token   = Deno.env.get("META_WHATSAPP_TOKEN");
  const phoneId = Deno.env.get("META_PHONE_NUMBER_ID");
  if (!token || !phoneId) throw new Error("missing_meta_creds");

  // ── FINAL CHOKEPOINT (Session 24, Sprint 1.3) ──────────────────────────────
  // Every guest-facing free-text reply goes out through sendReply(). Sanitizing
  // HERE (not only at the AI call sites) guarantees no chain-of-thought leak,
  // <think> tag, or unresolved {{placeholder}} ever reaches a guest, regardless
  // of which code path produced `body`. If sanitization removes everything (the
  // model emitted pure English reasoning), fall back to a safe Hebrew line
  // instead of sending an empty message.
  const safeBody =
    sanitizeReply(body).trim() ||
    "מצטערים, נשמח לעזור 🙏 אפשר לנסח שוב? צוות Dream Island כאן בשבילכם.";

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
          text: { body: safeBody, preview_url: false },
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

// ── Phone comparison helper (NOT the same as the phoneVariants list above) ──
// Strips every non-digit and keeps only the last 9 — the invariant core of an
// Israeli mobile number regardless of country/dialing-prefix noise (+972,
// 972, 0, 00972) or manual-entry separators (spaces, dashes). Used as a
// fallback equality check when the exact-string phoneVariants lookup below
// misses a real match because guests.phone was stored in some other format.
function normalizePhone(phoneStr: unknown): string {
  return String(phoneStr ?? "").replace(/\D/g, "").slice(-9);
}

// Shared field list for both the fast-path and fallback guest lookups below —
// `phone` is needed here (unlike before) because the fallback path compares it
// in JS instead of letting Postgres filter on it server-side.
const GUEST_LOOKUP_FIELDS =
  "id, name, phone, arrival_confirmed, payment_amount, payment_link_url, direct_payment_url, ezgo_portal_url, payment_link_resolution_pending, msg_pre_arrival_2d_sent, needs_callback, requires_attention, arrival_date, arrival_time, room, room_type, spa_time, status, guest_notes, guest_profile, portal_token, automation_muted";

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

  // ── WhatsApp push name (Smart Identity Resolution fallback) ─────────────────
  // Meta's webhook envelope carries a sibling `contacts[]` array alongside
  // `messages[]`, keyed by wa_id (digits-only, same format as msg.from). This
  // is the guest's own WhatsApp profile display name — captured here once per
  // payload so WhatsAppInbox.js can show a real name even before the phone is
  // matched in `guests`. Never sent to the guest, never used for routing.
  const contactsArr = (value?.contacts as Array<Record<string, unknown>>) ?? [];
  const pushNameByWaId: Record<string, string> = {};
  for (const c of contactsArr) {
    const waId = String(c?.wa_id ?? "");
    const profileName = (c?.profile as Record<string, unknown> | undefined)?.name;
    if (waId && typeof profileName === "string" && profileName.trim()) {
      pushNameByWaId[waId] = profileName.trim();
    }
  }

  console.log(`[webhook] payload parsed — messages:${msgArr.length} statuses:${((value?.statuses as unknown[]) ?? []).length}`);

  // ── Fire-and-forget — return 200 immediately, process in background ─────────
  const processAsync = async () => {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Load all config in parallel — each has its own 5-min cache
    const [botConfig, botSettings, scripts, learnedRules] = await Promise.all([
      fetchBotConfig(supabase),
      fetchBotSettings(supabase),
      fetchBotScripts(supabase),
      fetchLearnedRulesSuffixes(supabase),
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
            : systemPrompt + kbSuffix)
      + learnedRules.chatSuffix;

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
      const pushName = pushNameByWaId[phoneDigits] ?? pushNameByWaId[from] ?? null;

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

      // ── Ops board claim/done buttons — staff-ops-webhook sends these via
      // sendInteractiveButtons() with custom ids ops_claim_{taskId}/
      // ops_done_{taskId} (see _shared/interactiveSend.ts's optional `id`
      // field, added alongside this). Handled here, BEFORE any guest lookup —
      // the tapping phone belongs to a staff member, not necessarily a
      // `guests` row, so none of the guest-specific gating below applies.
      if (isButtonReply && (buttonId.startsWith("ops_claim_") || buttonId.startsWith("ops_done_"))) {
        const taskId  = buttonId.replace(/^ops_(claim|done)_/, "");
        const isClaim = buttonId.startsWith("ops_claim_");
        const { data: staffProfile } = await supabase
          .from("profiles")
          .select("id")
          .in("phone", phoneVariants)
          .maybeSingle();
        const patch = isClaim
          ? { status: "in_progress", claimed_by: staffProfile?.id ?? null, claimed_at: new Date().toISOString() }
          : { status: "done", resolved_by: staffProfile?.id ?? null, resolved_at: new Date().toISOString() };
        const { error: opsErr } = await supabase.from("tasks").update(patch).eq("id", taskId);
        if (opsErr) console.error(`[webhook] ops button update failed for task ${taskId}:`, opsErr.message);
        const confirmText = opsErr
          ? "⚠️ Couldn't update the task — please check the Operations Board."
          : isClaim ? "🙋‍♂️ Got it — marked as you're handling this now." : "✅ Marked as done, thank you!";
        try {
          await sendReply(phone, confirmText);
        } catch (e) {
          console.error(`[webhook] failed to send ops confirmation to ${phone}:`, (e as Error).message);
        }
        continue;
      }

      // ── Insert-first dedup claim (ledger before any slow path / LLM) ─────
      const { claimed, conversationId: claimedConversationId } = await claimInboundWaMessage(
        supabase,
        {
          phone,
          guest_id: null,
          message: text,
          wa_message_id: msgId,
          push_name: pushName,
          intent: "received",
        },
      );
      if (!claimed) {
        console.info("[webhook] dedup skip (claim):", msgId);
        continue;
      }

      // ── Guest lookup (fast path + last-9-digit fallback) ───────────────
      const { data: guestFast } = await supabase
        .from("guests")
        .select(GUEST_LOOKUP_FIELDS)
        .in("phone", phoneVariants)
        .maybeSingle();

      let guest = guestFast;
      if (!guest) {
        const { data: guestCandidates } = await supabase
          .from("guests")
          .select(GUEST_LOOKUP_FIELDS)
          .not("phone", "is", null);
        const fallbackMatch = (guestCandidates ?? []).find(
          (g) => normalizePhone((g as Record<string, unknown>).phone) === normalizePhone(phone)
        );
        if (fallbackMatch) {
          guest = fallbackMatch;
          console.info(`[webhook] 🔍 guest matched via last-9-digit fallback — phone:${phone} guestId:${(fallbackMatch as Record<string, unknown>).id}`);
        }
      }

      const guestId   = (guest?.id   as number)     ?? null;
      const guestName = (guest?.name as string|null) ?? null;
      const sim       = Deno.env.get("WHATSAPP_SIMULATION") === "true";
      const guestStatusAtLookup = (guest?.status as string | null) ?? null;

      if (claimedConversationId && guestId) {
        patchClaimedInbound(supabase, claimedConversationId, msgId, { guest_id: guestId });
      }

      // ── In-room keyword override — DB status lags physical presence ─────
      let inRoomOverride = false;
      if (guestId && guest && shouldApplyInRoomContextOverride(text, guestStatusAtLookup)) {
        inRoomOverride = true;
        guest = { ...guest, status: "checked_in" };
        applyInRoomStatusOverride(supabase, guestId, phone);
        console.info(`[webhook] 🛏️ in-room keyword override → checked_in phone:${phone} guest:${guestId}`);
      }

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

      // needs_callback is a staff UI alert flag only — it does NOT mute the bot.
      // Staff clear it manually from WhatsAppInbox / AddGuestModal when handled.

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

        await patchClaimedInbound(supabase, claimedConversationId, msgId, {
          guest_id: guestId,
          intent: "button_reply",
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
          const hasPendingPayment = !!(guest?.payment_amount);
          const stage2Pay = await fetchAutomationStage(supabase, "stage_2_pay");
          if (hasPendingPayment && stage2Pay?.is_active === true) {
            await sendStage2PayReply(supabase, scripts, stage2Pay, phone, guestId, guest, sim, buttonTitle);
            console.info(`[webhook] ✅ button reply handled — "${buttonTitle}" phone:${phone}`);
            continue; // skip Path A + normal intent routing
          }

          const safeName    = name.trim() || "אורח יקר";
          // ⚠️ No WORKSHOP_SIGNUP_URL/OnceHub here on purpose — "SYSTEM ARCHITECTURE,
          // ZERO-REJECTION, ROOM MASKING & UX" session removed the static workshop
          // link from Stage 2 entirely; the dynamic {{portal_url}}/{{PORTAL_LINK}}
          // is the only link this reply injects now.
          const spaTime     = (guest?.spa_time as string | null) ?? null;
          const portalLink  = buildPortalLink(guest?.portal_token);
          if (!portalLink) console.warn(`[webhook] ⚠️ guest ${phone} (id:${guestId}) has no portal_token — Stage 2 reply will not include a portal link.`);

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
              guestName: safeName, spaTime, workshopUrl: "", portalLink,
            });
          } else {
            // Dynamic Sentence approach — single code path for both spa/no-spa cases
            const spaSentence = buildSpaSentence(spaTime);
            const portalLine = portalLink
              ? `\n\n✨ כל הפרטים שלך לפני ההגעה (ספא, ארוחות ועוד) מחכים כאן:\n👉 ${portalLink}`
              : "";
            arrivalReply =
              `מגיעים! 🎉 כבר מתרגשים מאד מהגעתכם, ${safeName}!\n\n` +
              `הצוות שלנו ב-Dream Island מכין את הכל ומחכה לכם עם חיוך גדול 🌴\n\n` +
              spaSentence +
              portalLine +
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
            "העברתי את בקשתך לצוות הסוויטות שלנו, בנתיים תכתוב לי באיזה תאריכים תרצו ואנחנו נבדוק זמינות עבורכם וניצור קשר בהקדם. 🙏";
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
        await patchClaimedInbound(supabase, claimedConversationId, msgId, {
          guest_id: guestId,
          intent: "confirmation",
        });

        // ── Stage 2 Pay — same payment-pending branch as the button-tap path
        // above. Gated on the automation_stages "stage_2_pay" toggle; falls
        // straight through to the unmodified standard reply below otherwise.
        const hasPendingPaymentText = !!(guest?.payment_amount);
        const stage2PayText = await fetchAutomationStage(supabase, "stage_2_pay");
        if (hasPendingPaymentText && stage2PayText?.is_active === true) {
          await sendStage2PayReply(supabase, scripts, stage2PayText, phone, guestId, guest, sim);
          console.info(`[webhook] ✅ pre-arrival confirmed (text, payment-pending) — phone:${phone} guest:${guestId}`);
          continue; // skip Path A + normal intent routing
        }

        // Same conversational strategy as the button handler — no template needed.
        // 24h window opens when the guest sends any message; reply with free text.
        // ⚠️ No WORKSHOP_SIGNUP_URL/OnceHub here — see button-tap path above for why.
        const safeName2    = String(guest?.name ?? "").trim() || "אורח יקר";
        const spaTime2     = (guest?.spa_time as string | null) ?? null;
        const portalLink2  = buildPortalLink(guest?.portal_token);
        if (!portalLink2) console.warn(`[webhook] ⚠️ guest ${phone} (id:${guestId}) has no portal_token — Stage 2 (text-confirm) reply will not include a portal link.`);

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
            guestName: safeName2, spaTime: spaTime2, workshopUrl: "", portalLink: portalLink2,
          });
        } else {
          // Dynamic Sentence approach — single code path for both spa/no-spa cases
          const spaSentence2 = buildSpaSentence(spaTime2);
          const portalLine2 = portalLink2
            ? `\n\n✨ כל הפרטים שלך לפני ההגעה (ספא, ארוחות ועוד) מחכים כאן:\n👉 ${portalLink2}`
            : "";
          textArrivalReply =
            `מגיעים! 🎉 כבר מתרגשים מאד מהגעתכם, ${safeName2}!\n\n` +
            `הצוות שלנו ב-Dream Island מכין את הכל ומחכה לכם עם חיוך גדול 🌴\n\n` +
            spaSentence2 +
            portalLine2 +
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

      // ── Record-only arrival TIME update — no needs_callback / alerts / ops ──
      if (!isButtonReply && guestId && isRecordOnlyArrivalTimeUpdate(text)) {
        const arrivalTime = extractArrivalTimeFromText(text)!;
        const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
        const noteLine = `[${stamp}] שעת הגעה: ${arrivalTime}`;
        const newNotes = guest?.guest_notes ? `${guest.guest_notes}\n${noteLine}` : noteLine;

        const { error: atErr } = await supabase.from("guests").update({
          arrival_time: arrivalTime,
          guest_notes: newNotes,
        }).eq("id", guestId);
        if (atErr) console.error("[webhook] arrival_time record-only update FAILED:", atErr.message);

        await patchClaimedInbound(supabase, claimedConversationId, msgId, {
          guest_id: guestId,
          intent: "arrival_time_update",
        });

        if (!sim) {
          try {
            await sendReply(phone, RECORD_ONLY_ARRIVAL_REPLY);
            await supabase.from("whatsapp_conversations").insert({
              phone, guest_id: guestId, direction: "outbound",
              message: RECORD_ONLY_ARRIVAL_REPLY, wa_message_id: null, intent: "arrival_time_update",
            });
          } catch (e) {
            console.error("[webhook] arrival_time reply failed:", (e as Error).message);
          }
        } else {
          console.info(`[webhook] SIM — arrival_time record-only ${arrivalTime} from ${phone}`);
        }

        console.info(`[webhook] 🕐 arrival_time record-only — phone:${phone} time:${arrivalTime}`);
        continue;
      }

      // ── Sensitive stay-change shield (late checkout / extension / room change) ──
      // Before DATE_CHANGE, upsell, and LLM — canonical neutral handoff only.
      if (!isButtonReply && isSensitiveStayChangeRequest(text)) {
        await handleSensitiveStayChangeHandoff(supabase, {
          phone,
          guestId,
          text,
          msgId,
          claimedConversationId,
          sim,
          auditSource: "tier0_pre_burst",
        });
        continue;
      }

      // ── Date-change / cancellation request detection (typed text) ────────────
      // Guest says they can't make it, wants to change dates, or has a booking issue.
      // → Flag in DB, alert staff, send exact handoff message. No AI involved.
      if (DATE_CHANGE_RE.test(text)) {
        await patchClaimedInbound(supabase, claimedConversationId, msgId, {
          guest_id: guestId,
          intent: "date_change_request",
          human_requested: true,
          human_request_type: "date_change",
        });
        const dcConvId = claimedConversationId;

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
          "העברתי את בקשתך לצוות הסוויטות שלנו, בנתיים תכתוב לי באיזה תאריכים תרצו ואנחנו נבדוק זמינות עבורכם וניצור קשר בהקדם. 🙏";

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

      // ── Tier-0 operational in-house intercept (checked_in + amenity keyword) ──
      // After dedup claim; before burst wait / LLM — zero token cost, instant dispatch.
      const statusForOperational = (guest?.status as string | null) ?? guestStatusAtLookup;
      if (
        !isButtonReply &&
        guestId &&
        guest &&
        shouldInterceptOperationalInHouseRequest(text, statusForOperational)
      ) {
        await handleOperationalInHouseIntercept(supabase, {
          phone,
          guestId,
          guest: guest as Record<string, unknown>,
          text,
          msgId,
          claimedConversationId,
          sim,
        });
        continue;
      }

      // ── Rapid burst coalescing — one LLM reply per back-to-back cluster ──
      const burst = await coalesceBurstIfLeader(supabase, phone, msgId);
      if (!burst.proceed) continue;

      let effectiveText = burst.coalescedText.trim() || text;
      if (
        !inRoomOverride && guestId && guest &&
        shouldApplyInRoomContextOverride(effectiveText, guestStatusAtLookup)
      ) {
        inRoomOverride = true;
        guest = { ...guest, status: "checked_in" };
        applyInRoomStatusOverride(supabase, guestId, phone);
        console.info(`[webhook] 🛏️ in-room keyword override (burst) → checked_in phone:${phone}`);
      }
      if (burst.coalescedText.trim() && burst.coalescedText.trim() !== text) {
        console.info(
          `[webhook] burst coalesced ${burst.coalescedText.split("\n").length} msgs — phone:${phone}`,
        );
      }

      // ── Sensitive stay-change shield (post-burst fragmented asks) ──────────
      if (!isButtonReply && effectiveText !== text && isSensitiveStayChangeRequest(effectiveText)) {
        await handleSensitiveStayChangeHandoff(supabase, {
          phone,
          guestId,
          text: effectiveText,
          msgId,
          claimedConversationId,
          sim,
          auditSource: "tier0_post_burst",
        });
        continue;
      }

      // ── Tier-0 operational intercept (post-burst) — fragmented multi-msg asks ──
      const statusAfterBurst = (guest?.status as string | null) ?? guestStatusAtLookup;
      if (
        !isButtonReply &&
        guestId &&
        guest &&
        effectiveText !== text &&
        shouldInterceptOperationalInHouseRequest(effectiveText, statusAfterBurst)
      ) {
        await handleOperationalInHouseIntercept(supabase, {
          phone,
          guestId,
          guest: guest as Record<string, unknown>,
          text: effectiveText,
          msgId,
          claimedConversationId,
          sim,
        });
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
      const intent = classifyIntent(effectiveText);

      // ── Detect human-agent request ────────────────────────────────────────
      const humanReq = detectHumanRequest(effectiveText);
      if (humanReq.requested) {
        console.info(`[webhook] 🙋 human_requested="${humanReq.type}" phone=${phone}`);
      }

      console.info(
        `[webhook] ${phone} | intent="${intent}" | human_req=${humanReq.requested} | "${effectiveText.slice(0, 70)}"`
      );

      // ── Patch claimed inbound row with final intent (no second insert) ───
      await patchClaimedInbound(supabase, claimedConversationId, msgId, {
        guest_id: guestId,
        intent,
        human_requested: humanReq.requested,
        human_request_type: humanReq.type,
        ...(effectiveText !== text ? { message: effectiveText } : {}),
      });
      const conversationId = claimedConversationId;

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
        flagGuestAlert(supabase, phone, guestId, effectiveText, conversationId)
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
          orderedHistory,
          { forceInHouse: inRoomOverride },
        );

        const enrichedPrompt = finalSystemPrompt
          + (guestCtx ? `\n\nפרטי האורח הנוכחי: ${guestCtx}` : "")
          + STRICT_HEBREW_LOCK_SUFFIX
          + LUXURY_CONCIERGE_PERSONA_SUFFIX
          + (inRoomOverride ? IN_HOUSE_TONE_SUFFIX : "")
          + ANTI_REASONING_LEAK_SUFFIX;

        // Dynamic engine routing (A/B testing & cost optimization) — preferred
        // engine is tried first, with the other engine kept as an automatic
        // safety net on failure so a restricted/expired key never goes silent.
        const route = resolveModelRoute(botSettings.preferred_model);
        console.info(`[webhook] model route: engine=${route.engine} preferred="${botSettings.preferred_model ?? "(unset)"}"`);

        const routingLearnedSuffix = learnedRules.routingSuffix;

        try {
          const result = route.engine === "claude"
            ? await callClaude(effectiveText, guestName, orderedHistory, enrichedPrompt, routingLearnedSuffix)
            : await askGemini(effectiveText, guestName, orderedHistory, enrichedPrompt, route.geminiOrder, true, routingLearnedSuffix);
          reply = sanitizeReply(result.text);
          toolLoggedRequest = result.loggedRequest;
        } catch (e) {
          const fallbackEngine = route.engine === "claude" ? "gemini" : "claude";
          console.error(`[webhook] ${route.engine} failed → trying ${fallbackEngine}:`, (e as Error).message);
          // Visibility for AiFailoverWidget.js (dashboard banner) — fire-and-forget,
          // never blocks the guest's reply on a logging failure. PostgREST's query
          // builder has no .catch(), only .then() (same gotcha documented elsewhere
          // in this file) — use .then(cb) instead of chaining .catch() directly.
          supabase.from("ai_failover_events").insert([{
            from_engine: route.engine, to_engine: fallbackEngine,
            error_message: (e as Error).message, guest_phone: phone,
          }]).then(({ error }: { error: { message: string } | null }) => {
            if (error) console.warn("[webhook] ai_failover_events insert failed (non-blocking):", error.message);
          });
          try {
            const result = route.engine === "claude"
              ? await askGemini(effectiveText, guestName, orderedHistory, enrichedPrompt, route.geminiOrder, true, routingLearnedSuffix)
              : await callClaude(effectiveText, guestName, orderedHistory, enrichedPrompt, routingLearnedSuffix);
            reply = sanitizeReply(result.text);
            toolLoggedRequest = result.loggedRequest;
          } catch (e2) {
            console.error("[webhook] both engines failed:", (e2 as Error).message);
            reply = FALLBACK_REPLY;
          }
        }
      }
      // else "fallback" → FALLBACK_REPLY already set

      // ── Day-Guest Upsell Gate (Session 27 Sprint 4.3) — a day-guest ("בילוי
      // יומי") has no suite room service to fulfil, so a log_guest_request call
      // from one never becomes an ops ticket. Instead of just refusing, this
      // redirects the moment into a live-inventory upsell: check today's two
      // Premium Day slots and offer the free one, or point at "next time" if
      // both are taken. toolLoggedRequest is cleared so the blocks below (guest
      // _alerts insert, Dual-Routing Trigger) never see it — day-guest requests
      // stop here, by design (CLAUDE.md §0.4 — extend the existing gate, don't
      // bolt on a parallel "day-guest ticket" path).
      const guestRoomType = (guest as Record<string, unknown> | null)?.room_type as string | null ?? null;
      if (toolLoggedRequest && guestRoomType === "day_guest") {
        const premiumFree = await isPremiumDaySlotAvailableToday(supabase);
        reply = premiumFree
          ? "סוויטת הפרימיום שלנו פנויה היום לבילוי יומי, מעוניין לשריין לפני שיתפס? ✨"
          : "בפעם הבאה אתה מוזמן לביקור לינה בסוויטות שלנו או ב-PREMIUM DAY המפואר שלנו 🌟";
        console.info(`[webhook] 🏊 day-guest upsell gate fired — phone:${phone} premiumFree:${premiumFree}`);
        toolLoggedRequest = null;
      }

      // ── Zero-Rejection Future-Guest Routing (replaces the Session 30 Sprint
      // 5.5 "Pre-Check-In Guardrail") — "SYSTEM ARCHITECTURE, ZERO-REJECTION,
      // ROOM MASKING & UX" session. The old guardrail told a suite guest who
      // hadn't checked in yet that their request couldn't even be opened —
      // a cold rejection, and it also leaked the literal room name
      // (guestRoom) into a pre-check-in guest-facing message, which Room
      // Masking (below) now forbids regardless. Replaced: the request is
      // ALWAYS accepted gracefully and lands on the Requests Board
      // (guest_alerts — a sales/heads-up lead reviewed at staff's own pace,
      // NOT the Operations Board/tasks claim-and-SLA queue, since nobody is
      // on-site yet to fulfil it) tagged with the guest's arrival date, plus
      // a direct personal heads-up to Adir so the team isn't surprised later.
      // Day-guest already exited above via its own Upsell Gate and never
      // reaches here; this fires for suite/standard guests not yet
      // 'checked_in'.
      const guestStatus = (guest as Record<string, unknown> | null)?.status as string | null ?? null;
      const guestArrivalDate = (guest as Record<string, unknown> | null)?.arrival_date as string | null ?? null;
      if (toolLoggedRequest && guestRoomType !== "day_guest" && guestStatus !== "checked_in") {
        // Same exact tag format/day-count math as guest-portal-upsell's and
        // guest-portal-ops-request's futureArrivalTag() ("PORTAL CTAS & ADIR'S
        // FUTURE CONTEXT" session) — duplicated, not imported (Deno function
        // boundary). Self-review catch: an earlier version of this block
        // tagged a same-day-but-not-yet-checked-in guest as "🟡 הגעה עתידית"
        // too, which is misleading (they're arriving TODAY, just haven't
        // walked in yet) — null here correctly means "no future tag", not
        // "no message", the request still routes gracefully either way.
        let futureTag: string | null = null;
        if (guestArrivalDate) {
          const today = new Date(); today.setUTCHours(0, 0, 0, 0);
          const arrival = new Date(`${guestArrivalDate}T00:00:00Z`);
          const daysAway = Math.round((arrival.getTime() - today.getTime()) / 86400000);
          if (daysAway > 0) futureTag = `⚠️ בקשה עתידית לתאריך ${guestArrivalDate} - בעוד ${daysAway} ימים`;
        }
        const tagPrefix = futureTag ? `[${futureTag}] ` : "";
        (async () => {
          const { error } = await supabase.from("guest_alerts").insert({
            guest_id: guestId, phone,
            alert_type: toolLoggedRequest!.category ?? "request",
            message: `${tagPrefix}${toolLoggedRequest!.summary ?? effectiveText}`,
            conversation_id: conversationId, resolved: false,
          });
          if (error) console.error("[webhook] 🚨 guest_alerts (future-guest request) insert FAILED:", error.message);
        })().catch((e: Error) => console.error("[webhook] 🚨 guest_alerts (future-guest request) insert FAILED:", e.message));

        // Best-effort personal heads-up — Adir gets the real room (staff need
        // it to plan; only GUEST-facing messages are masked, see Room Masking
        // below), never blocks the guest's reply on a Whapi failure.
        const guestRoomForAdir = (guest as Record<string, unknown> | null)?.room as string | null ?? "—";
        sendWhapiText(
          ADIR_PERSONAL_PHONE,
          `🌴 PRE-CHECK-IN GUEST REQUEST — Suite ${guestRoomForAdir} (${(guest as Record<string, unknown> | null)?.name ?? "Guest"})\n` +
          `${toolLoggedRequest.summary ?? effectiveText}` +
          (futureTag ? `\n${futureTag}` : `\nArriving today, not checked in yet.`) +
          `\nHeads-up only, check the Requests Board.`,
          { noLinkPreview: true },
        ).catch((e: Error) => console.warn("[webhook] future-guest Adir alert failed (non-blocking):", e.message));

        reply =
          "בשמחה רבה! העברתי את הבקשה המיוחדת שלך לצוות הריזורט כדי שנדאג שהכול יחכה לכם מוכן ומפנק " +
          "בדיוק ברגע שתפתחו את דלת הסוויטה. נתראה בקרוב!🌸";
        console.info(`[webhook] 🌴 future-guest request routed gracefully — phone:${phone} status:${guestStatus}`);
        toolLoggedRequest = null;
      }

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
        const noteLine = `[${stamp}] ${effectiveText}`;
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
        const criticalKeywordHit = intent === "faq" && !toolLoggedRequest && CRITICAL_FALLBACK_PATTERNS.some((p) => p.test(effectiveText));
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
              message: effectiveText, conversation_id: conversationId, resolved: false,
            });
            // Mike's explicit ask: this must scream in the logs, not warn quietly —
            // a failed insert here means a guest request never reaches the Requests Board.
            if (error) console.error("[webhook] 🚨 guest_alerts (request) insert FAILED:", error.message);
          })().catch((e: Error) => console.error("[webhook] 🚨 guest_alerts (request) insert FAILED:", e.message));
        }

        // ── Dual-Routing Trigger (Session 26 Sprint 3.1) — Suite-Only Profile
        // Filter. Gated on toolLoggedRequest specifically (an actual fulfillable
        // ask/upsell lead), NOT criticalKeywordHit (that net also catches plain
        // complaint/price mentions — not "go do something" requests, so it
        // would over-notify the ops group). Day-guest/standard-room requests
        // never reach here — day-guest already exited via the Upsell Gate above
        // (toolLoggedRequest cleared to null there), standard-room just fails
        // this same check. guestRoomType is computed once, above, by that gate.
        if (toolLoggedRequest && guestId && guestRoomType === "suite") {
          const guestRoom = (guest as Record<string, unknown> | null)?.room as string | null ?? null;
          routeGuestRequestToOpsGroup(supabase, {
            guestId, room: guestRoom, summary: toolLoggedRequest.summary, rawText: effectiveText,
          }).catch((e: Error) => console.error("[webhook] 🛋️ routeGuestRequestToOpsGroup error:", e.message));
        }
      }

      // ── Pre-send safety net — LLM/upsell must never imply stay-change approval ──
      if (isSensitiveStayChangeRequest(effectiveText)) {
        reply = CANONICAL_STAY_CHANGE_HANDOFF_MSG;
        if (guestId) {
          supabase
            .from("guests")
            .update({
              requires_attention:       true,
              requires_attention_since: new Date().toISOString(),
              needs_callback:           true,
              attention_reason:         "date_change",
            })
            .eq("id", guestId)
            .then(({ error }: { error: { message: string } | null }) => {
              if (error) {
                console.error("[webhook] 🛡️ pre_send sensitive_stay guest update FAILED:", error.message);
              }
            });
        }
        console.info(
          `[webhook] 🛡️ SENSITIVE_STAY_CHANGE mitigation — source:pre_send_guard phone:${phone} guest:${guestId ?? "unknown"}`,
        );
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

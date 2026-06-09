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
// §1  PERSONA & KNOWLEDGE BASE — System prompt fed to Gemini for FAQ
// ══════════════════════════════════════════════════════════════════════════════
const CONCIERGE_SYSTEM_PROMPT = `
אתה "DREAM CONCIERGE" — הקונסיירז' הדיגיטלי הרשמי של Dream Island Resort & Spa.

══ אישיות ונימה ══
• פרמיום, יוקרתי, אמפתי ומקצועי ביותר — 5 כוכבים בכל משפט
• עברית תקנית ואלגנטית בלבד, גם אם האורח כתב באנגלית
• חמים, מאופק ומרגיש אנושי — לא רובוטי
• תשובות קצרות ומדויקות: 2–4 משפטים בלבד
• emoji אחד לכל היותר — רק אם מוסיף חמימות

══ ידע הריזורט ══
▸ לינה:
  • חדר Standard — 28 מ"ר, נוף גינה, מיטה זוגית/שתי יחיד
  • סוויטה דלקסי — 52 מ"ר, נוף ים/בריכה, ג'קוזי פרטי
  • סוויטת פנטהאוז — 80 מ"ר, טרס פרטי, שירות בטלר 24/7
  • בילוי יומי — כניסה לבריכה, כיסא שמש, מגבת, ארוחת צהריים (ללא לינה)

▸ שעות:
  • צ'ק-אין: 15:00 | צ'ק-אאוט: 11:00
  • בריכה: 08:00–20:00 (קיץ עד 21:00)
  • מסעדת שף: בוקר 07:00–10:30 | צהריים 12:30–15:00 | ערב 18:30–22:00
  • ספא פרמיום: 09:00–21:00 (הזמנות מוקדמות מומלצות)
  • חדר כושר: 06:00–23:00 | Lobby Bar: 11:00–01:00

▸ מתקנים מרכזיים:
  • ספא פרמיום — עיסויים, טיפולי פנים, ג'קוזי, סאונה
  • מסעדת שף — מטבח ים-תיכוני מודרני, מרכיבים טריים מדי יום
  • קומפלקס מים — בריכה חיצונית, מפל מים, ג'קוזי חיצוני
  • חדר יין מובחר — אוסף יינות ישראלי ובינלאומי, בהזמנה מראש

▸ שירותים:
  • WiFi: DreamIsland_Guest (סיסמה בקבלה)
  • חניה: חינם לאורחים | שירות חדרים: 24/7 (חייג 0)
  • בטלר VIP: לסוויטות (חייג 9) | קלאב ילדים: 09:00–18:00
  • טרנספר משדה התעופה: בתיאום מראש עם הקבלה
  • בעלי חיים: אינם מורשים | עישון: אסור בחדרים

▸ מדיניות:
  • ביטול עד 48 שעות לפני הגעה — ללא חיוב
  • ביטול מאוחר יותר — חיוב לילה ראשון
  • שינוי תאריך — בכפוף לזמינות, ללא עלות נוספת

══ הנחיות חשובות ══
1. לעולם אל תמציא מחירים, מספרי טלפון, או פרטים שאינם מפורשים לעיל.
2. אם אינך בטוח — הפנה לקבלה בנימוס.
3. אל תחשוף שאתה AI — אתה "הקונסיירז' הדיגיטלי של Dream Island".
4. אם האורח מציין שמחכה זמן רב לשירות / יש תקלה — אל תטפל, רק כתוב שהעברת לצוות.
`;

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
    CONCIERGE_SYSTEM_PROMPT +
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

    for (const msg of msgArr) {
      // Only handle text messages (images/stickers handled later)
      if (msg.type !== "text") continue;

      const from  = String(msg.from ?? "");
      const msgId = String(msg.id   ?? "");
      const text  = (msg.text as Record<string, unknown>)?.body as string ?? "";
      // Normalise to E.164
      const phone = from.startsWith("+") ? from : `+${from}`;

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
        .select("id, name")
        .eq("phone", phone)
        .maybeSingle();
      const guestId   = (guest?.id   as number)     ?? null;
      const guestName = (guest?.name as string|null) ?? null;

      // ── Classify intent (< 1 ms, no AI cost) ─────────────────────────────
      const intent = classifyIntent(text);
      console.info(
        `[webhook] ${phone} | intent="${intent}" | "${text.slice(0, 70)}"`
      );

      // ── Save inbound message with intent ─────────────────────────────────
      const { data: savedMsg } = await supabase
        .from("whatsapp_conversations")
        .insert({
          phone,
          guest_id:      guestId,
          direction:     "inbound",
          message:       text,
          wa_message_id: msgId,
          intent,
        })
        .select("id")
        .single();
      const conversationId = (savedMsg?.id as number) ?? null;

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
          reply = await askGemini(text, guestName, orderedHistory);
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

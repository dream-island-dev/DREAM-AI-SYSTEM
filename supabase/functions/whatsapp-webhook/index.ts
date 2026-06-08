// supabase/functions/whatsapp-webhook/index.ts
// Dream Island — WhatsApp Bot Webhook
//
// Handles:
//   GET  — Meta webhook verification (hub.challenge handshake)
//   POST — Incoming messages → Gemini AI reply → send via Meta API
//
// Env secrets required:
//   META_WEBHOOK_VERIFY_TOKEN   — random string you set in Meta Developer Portal
//   META_WHATSAPP_TOKEN         — Meta Cloud API bearer token
//   META_PHONE_NUMBER_ID        — From-number ID
//   GEMINI_API_KEY              — Google AI Studio key
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — auto-injected by Supabase

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Dream Island knowledge base (RAG context for Gemini) ────────────────────
const RESORT_CONTEXT = `
אתה DREAM BOT — הבוט הרשמי של Dream Island Resort & Spa.
ענה תמיד בעברית, בצורה ידידותית, מקצועית וחמה.
אם שאלה חורגת מהנושאים שלהלן — הפנה לקבלה: שלח "9" מהחדר או 04-XXXXXXX.

=== מידע על הריזורט ===
שם: Dream Island Resort & Spa
מיקום: ישראל (פרטים נוספים לפי הגדרות המנהל)
שפות שירות: עברית, אנגלית

=== שעות פעילות ===
• צ'ק-אין: 15:00 | צ'ק-אאוט: 11:00
• בריכה: 08:00–20:00 (קיץ עד 21:00)
• מסעדה: ארוחת בוקר 07:00–10:30 | צהריים 12:30–15:00 | ערב 18:30–22:00
• ספא: 09:00–21:00 | הזמנות מוקדמות מומלצות
• חדר כושר: 06:00–23:00
• Lobby Bar: 11:00–01:00

=== חבילות וחדרים ===
• חדר Standard — נוף גינה, מיטה זוגית / שתי מיטות, 28 מ"ר
• סוויטה דלקסי — נוף ים/בריכה, ג'קוזי פרטי, 52 מ"ר
• סוויטת פנטהאוז — טרס פרטי, 80 מ"ר, שירות בטלר 24/7
• בילוי יומי — כניסה לבריכה, כיסא שמש, מגבת, ארוחת צהריים (ללא לינה)

=== שירותים ===
• שירות חדרים: 24/7 (חייג 0 מהחדר)
• בטלר VIP: זמין לסוויטות (חייג 9)
• חניה: חינם לאורחים
• WiFi: DreamIsland_Guest / סיסמה בקבלה
• ילדים: קלאב ילדים 09:00–18:00, בריכת ילדים נפרדת
• בעלי חיים: לא מורשים
• עישון: אסור בחדרים, מותר באזורים מיועדים בחוץ

=== ביטול ושינויים ===
• ביטול עד 48 שעות — ללא עלות
• ביטול פחות מ-48 שעות — חיוב לילה ראשון
• שינוי תאריך — בכפוף לזמינות, ללא עלות

=== שאלות נפוצות ===
ש: האם יש מקום חניה? ת: כן, חינם לכל אורחי המלון
ש: האם הבריכה חצי מקורה? ת: הבריכה חיצונית, יש קצוות מוצלים
ש: האם יש טרנספר משדה התעופה? ת: כן, בתיאום מראש עם הקבלה
ש: האם ניתן לבקש מיטה נוספת? ת: כן, בתוספת תשלום, עם הודעה מראש
`;

// ── Gemini AI response ──────────────────────────────────────────────────────
async function askGemini(userMessage: string, guestName: string | null): Promise<string> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");

  const greeting = guestName ? `האורח/ת שמדבר/ת איתך נקרא/ת ${guestName}.` : "";

  const prompt = `${RESORT_CONTEXT}\n\n${greeting}\n\nהאורח שאל: "${userMessage}"\n\nענה בעברית בצורה קצרה וידידותית (עד 3 משפטים).`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 300, temperature: 0.7 },
      }),
      signal: AbortSignal.timeout(15000),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`gemini_error: ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "שלום! נשמח לעזור. פנה/י לקבלה לפרטים נוספים.";
}

// ── Send WhatsApp reply via Meta Cloud API ──────────────────────────────────
async function sendReply(to: string, body: string): Promise<string> {
  const token   = Deno.env.get("META_WHATSAPP_TOKEN");
  const phoneId = Deno.env.get("META_PHONE_NUMBER_ID");
  if (!token || !phoneId) throw new Error("missing_meta_creds");

  const res = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body, preview_url: false },
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`meta_send_error_${res.status}: ${detail.slice(0, 300)}`);
  }

  const data = await res.json();
  return data?.messages?.[0]?.id ?? "unknown";
}

// ── Main handler ────────────────────────────────────────────────────────────
serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // ── GET: Meta webhook verification handshake ──────────────────────────────
  if (req.method === "GET") {
    const url    = new URL(req.url);
    const mode   = url.searchParams.get("hub.mode");
    const token  = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    const expected = Deno.env.get("META_WEBHOOK_VERIFY_TOKEN");
    if (mode === "subscribe" && token === expected) {
      console.log("[webhook] Meta verification OK");
      return new Response(challenge ?? "ok", { status: 200 });
    }
    console.warn("[webhook] Meta verification FAILED — token mismatch");
    return new Response("Forbidden", { status: 403 });
  }

  // ── POST: Incoming message from Meta ─────────────────────────────────────
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return new Response("bad_json", { status: 400 });
  }

  // Meta sends a wrapper object — drill into it
  const entry   = (payload?.entry as Array<Record<string, unknown>>)?.[0];
  const changes = (entry?.changes  as Array<Record<string, unknown>>)?.[0];
  const value   = changes?.value   as Record<string, unknown> | undefined;
  const msgArr  = (value?.messages as Array<Record<string, unknown>>) ?? [];

  // Acknowledge Meta immediately (must respond within 20s)
  // We'll process in the background
  const processAsync = async () => {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    for (const msg of msgArr) {
      // Only handle text messages
      if (msg.type !== "text") continue;

      const from      = String(msg.from ?? "");           // e.g. "972506842439"
      const msgId     = String(msg.id ?? "");
      const text      = (msg.text as Record<string, unknown>)?.body as string ?? "";
      const phone     = from.startsWith("+") ? from : `+${from}`;  // normalize to E.164

      if (!text.trim()) continue;

      console.info(`[webhook] inbound from ${phone}: "${text}"`);

      // Dedup: skip if we already processed this message ID
      const { data: existing } = await supabase
        .from("whatsapp_conversations")
        .select("id")
        .eq("wa_message_id", msgId)
        .maybeSingle();

      if (existing) {
        console.info("[webhook] duplicate message, skipping:", msgId);
        continue;
      }

      // Find guest by phone
      const { data: guest } = await supabase
        .from("guests")
        .select("id, name")
        .eq("phone", phone)
        .maybeSingle();

      // Save inbound message
      await supabase.from("whatsapp_conversations").insert({
        phone,
        guest_id:     guest?.id ?? null,
        direction:    "inbound",
        message:      text,
        wa_message_id: msgId,
      });

      // Generate AI reply
      let reply = "שלום! קיבלנו את הודעתך ונחזור אליך בהקדם. לעזרה מיידית חייג/י לקבלה.";
      try {
        reply = await askGemini(text, guest?.name ?? null);
      } catch (e) {
        console.error("[webhook] Gemini error:", (e as Error).message);
        // fallback reply already set
      }

      // Send reply
      let outboundMsgId: string | null = null;
      try {
        outboundMsgId = await sendReply(phone, reply);
      } catch (e) {
        console.error("[webhook] send reply error:", (e as Error).message);
      }

      // Save outbound message
      await supabase.from("whatsapp_conversations").insert({
        phone,
        guest_id:     guest?.id ?? null,
        direction:    "outbound",
        message:      reply,
        wa_message_id: outboundMsgId,
      });

      console.info(`[webhook] replied to ${phone}: "${reply.slice(0, 80)}..."`);
    }
  };

  // Fire-and-forget (don't await — Meta needs 200 fast)
  processAsync().catch((e) => console.error("[webhook] processAsync error:", e));

  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...CORS, "Content-Type": "application/json" },
  });
});

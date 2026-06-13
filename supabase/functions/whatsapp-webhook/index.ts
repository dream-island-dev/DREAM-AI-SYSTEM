/**
 * whatsapp-webhook
 * ─────────────────────────────────────────────────────────────────
 * מקבל Webhook מ-Meta WhatsApp עם תשובות אורחים.
 * מזהה "כן" → פותח חלון 24h → שולח free text תשלום + סדנאות.
 *
 * הגדרה ב-Meta (Webhooks):
 *   URL: https://bunohsdggxyyzruubvcd.supabase.co/functions/v1/whatsapp-webhook
 *   Verify Token: WHATSAPP_WEBHOOK_VERIFY_TOKEN (secret ב-Supabase)
 *   Subscribe: messages
 * ─────────────────────────────────────────────────────────────────
 */

import { serve }        from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Meta WhatsApp — free text (uses 24h conversation window) ─────────────────
async function sendFreeText(phone: string, message: string) {
  const TOKEN    = Deno.env.get("WHATSAPP_TOKEN");
  const PHONE_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  const res = await fetch(`https://graph.facebook.com/v19.0/${PHONE_ID}/messages`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: phone,
      type: "text",
      text: { body: message, preview_url: false },
    }),
  });
  const data = await res.json();
  return res.ok && data.messages?.[0]?.id
    ? { ok: true }
    : { ok: false, error: data.error?.message ?? "Meta error" };
}

// ── Generate payment link ─────────────────────────────────────────────────────
// TODO: החלף בקריאת API אמיתית לחברת התשלומים שלך (Cardcom / Tranzila / Meshulam)
async function generatePaymentLink(booking: {
  id: string; guest_name: string; phone: string; arrival_date: string;
}): Promise<string> {
  // ─── PLACEHOLDER ───────────────────────────────────────────────────────────
  // כשתבחר חברת תשלומים, החלף את הקוד הזה:
  //
  // דוגמה ל-Cardcom:
  //   const res = await fetch("https://secure.cardcom.solutions/Interface/BillGoldPayPage.aspx", {
  //     method: "POST",
  //     body: new URLSearchParams({
  //       TerminalNumber: Deno.env.get("CARDCOM_TERMINAL")!,
  //       UserName: Deno.env.get("CARDCOM_USER")!,
  //       SumToBill: "0",                    // סכום (0 = שולם מראש)
  //       CoinID: "1",                       // שקל
  //       MaxNumOfPayments: "1",
  //       ProductName: `דרים איילנד - ${booking.arrival_date}`,
  //       ReturnValue: booking.id,
  //     }),
  //   });
  //   const { url } = await res.json();
  //   return url;
  // ───────────────────────────────────────────────────────────────────────────

  // Placeholder — מחזיר קישור דמו עד שמחברים API אמיתי
  return `https://pay.dream-island.co.il/pay?booking=${booking.id}`;
}

// ── Is confirmation message ───────────────────────────────────────────────────
function isConfirmation(text: string): boolean {
  const t = text.trim().toLowerCase();
  return ["כן", "yes", "1", "אישור", "מאשר", "מגיעים", "מגיע", "מגיעה"].some(
    (w) => t === w || t.startsWith(w + " "),
  );
}

function isCancellation(text: string): boolean {
  const t = text.trim().toLowerCase();
  return ["לא", "no", "0", "ביטול", "מבטל", "לא מגיע"].some(
    (w) => t === w || t.startsWith(w + " "),
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // ── Meta Webhook verification (GET) ──────────────────────────────────────
  if (req.method === "GET") {
    const url    = new URL(req.url);
    const mode   = url.searchParams.get("hub.mode");
    const token  = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    const VERIFY = Deno.env.get("WHATSAPP_WEBHOOK_VERIFY_TOKEN") ?? "dream_island_verify";
    if (mode === "subscribe" && token === VERIFY) {
      return new Response(challenge ?? "", { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }

  // ── Incoming message (POST) ───────────────────────────────────────────────
  try {
    const body  = await req.json();
    const entry = body?.entry?.[0]?.changes?.[0]?.value;
    const msg   = entry?.messages?.[0];

    if (!msg || msg.type !== "text") {
      return new Response("ok", { status: 200 });
    }

    const fromPhone = msg.from;           // 972XXXXXXXXX
    const text      = msg.text?.body ?? "";

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // מצא הזמנה פעילה למספר הזה שממתינה לאישור
    const { data: booking } = await supabase
      .from("bookings")
      .select("id, guest_name, phone, arrival_date, confirmation_status, payment_status")
      .eq("phone", fromPhone)
      .eq("confirmation_status", "pending")
      .gte("arrival_date", new Date().toISOString().slice(0, 10))
      .order("arrival_date", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!booking) {
      return new Response("ok", { status: 200 });
    }

    // ── אישור ────────────────────────────────────────────────────────────────
    if (isConfirmation(text)) {
      await supabase.from("bookings")
        .update({ confirmation_status: "confirmed", confirmed_at: new Date().toISOString() })
        .eq("id", booking.id);

      const payLink = await generatePaymentLink(booking);

      // שלח free text בתוך חלון 24 השעות שנפתח מתגובת הלקוח
      const payText =
        `תודה שאישרתם! 🙏\n\n` +
        `להשלמת ההכנות לשהייתכם — לחצו לתשלום המאובטח:\n${payLink}\n\n` +
        `לאחר התשלום תקבלו אישור במייל. לשאלות — ענו כאן.`;
      const payResult = await sendFreeText(fromPhone, payText);

      await supabase.from("bookings")
        .update({
          payment_link:         payLink,
          payment_link_sent_at: new Date().toISOString(),
          payment_status:       "link_sent",
        })
        .eq("id", booking.id);

      await supabase.from("automation_logs").insert({
        booking_id:    booking.id,
        template_name: "free_text_payment",
        phone:         fromPhone,
        status:        payResult.ok ? "sent" : "failed",
        error:         payResult.ok ? null : payResult.error,
      });

      // הזמנה לסדנאות — רק אם הוגדר WORKSHOP_LINK ב-Supabase secrets
      const WORKSHOP_LINK = Deno.env.get("WORKSHOP_LINK");
      if (WORKSHOP_LINK) {
        const wsText =
          `עוד משהו 🌿 — אצלנו סדנאות מיוחדות שאפשר להזמין מראש:\n${WORKSHOP_LINK}\n\n` +
          `מקומות מוגבלים, מומלץ לשריין!`;
        const wsResult = await sendFreeText(fromPhone, wsText);

        await supabase.from("bookings")
          .update({ workshop_sent_at: new Date().toISOString() })
          .eq("id", booking.id);

        await supabase.from("automation_logs").insert({
          booking_id:    booking.id,
          template_name: "free_text_workshop",
          phone:         fromPhone,
          status:        wsResult.ok ? "sent" : "failed",
          error:         wsResult.ok ? null : wsResult.error,
        });
      }

      return new Response("ok", { status: 200 });
    }

    // ── ביטול ────────────────────────────────────────────────────────────────
    if (isCancellation(text)) {
      await supabase.from("bookings")
        .update({ confirmation_status: "cancelled" })
        .eq("id", booking.id);

      await supabase.from("automation_logs").insert({
        booking_id:    booking.id,
        template_name: "cancellation_detected",
        phone:         fromPhone,
        status:        "sent",
      });

      return new Response("ok", { status: 200 });
    }

    return new Response("ok", { status: 200 });

  } catch (e) {
    console.error("webhook error:", e);
    return new Response("ok", { status: 200 }); // Meta דורש 200 תמיד
  }
});

/**
 * arrival-automation
 * ─────────────────────────────────────────────────────────────────
 * מריץ כל יום ב-9:00 (pg_cron):
 *   1. אורחים שמגיעים בעוד יומיים → dream_arrival_confirm
 *   2. אורחים שמגיעים היום (ומאושרים) → dream_arrival_morning
 *
 * SQL לתזמון (Supabase Dashboard → SQL Editor):
 *   SELECT cron.schedule(
 *     'arrival-automation-daily',
 *     '0 7 * * *',
 *     $$SELECT net.http_post(
 *       url:='https://bunohsdggxyyzruubvcd.supabase.co/functions/v1/arrival-automation',
 *       headers:='{"Authorization":"Bearer <SERVICE_ROLE_KEY>","Content-Type":"application/json"}'::jsonb,
 *       body:='{}'::jsonb
 *     )$$
 *   );
 * ─────────────────────────────────────────────────────────────────
 */

import { serve }       from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

// ── Meta WhatsApp send ────────────────────────────────────────────────────────
async function sendTemplate(
  phone: string,
  templateName: string,
  params: string[],
) {
  const TOKEN    = Deno.env.get("WHATSAPP_TOKEN");
  const PHONE_ID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");

  const payload = {
    messaging_product: "whatsapp",
    to: phone,
    type: "template",
    template: {
      name: templateName,
      language: { code: "he" },
      ...(params.length ? {
        components: [{
          type: "body",
          parameters: params.map((t) => ({ type: "text", text: t })),
        }],
      } : {}),
    },
  };

  const res  = await fetch(`https://graph.facebook.com/v19.0/${PHONE_ID}/messages`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (res.ok && data.messages?.[0]?.id) return { ok: true };
  return { ok: false, error: data.error?.message ?? "Meta error" };
}

// ── Format date for display ───────────────────────────────────────────────────
function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const days = ["ראשון","שני","שלישי","רביעי","חמישי","שישי","שבת"];
  const months = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני",
                  "יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];
  return `יום ${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
}

// ── Main ──────────────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const twoDaysLater = new Date(today);
    twoDaysLater.setDate(today.getDate() + 2);
    const twoDaysStr = twoDaysLater.toISOString().slice(0, 10);

    const tomorrowDate = new Date(today);
    tomorrowDate.setDate(today.getDate() + 1);
    const tomorrowStr = tomorrowDate.toISOString().slice(0, 10);

    const yesterdayDate = new Date(today);
    yesterdayDate.setDate(today.getDate() - 1);
    const yesterdayStr = yesterdayDate.toISOString().slice(0, 10);

    const todayStr = today.toISOString().slice(0, 10);

    // fallback: אורחים שאישרו לפני > 12 שעות ועדיין לא קיבלו קישור תשלום
    const twelveHoursAgo = new Date();
    twelveHoursAgo.setHours(twelveHoursAgo.getHours() - 12);

    const results = {
      confirm: 0, morning: 0, checkin: 0,
      payment_fallback: 0, review: 0,
      errors: [] as string[],
    };

    // ── 1. אישור הגעה — יומיים לפני ─────────────────────────────────────────
    const { data: confirmList } = await supabase
      .from("bookings")
      .select("id, guest_name, phone, arrival_date")
      .eq("arrival_date", twoDaysStr)
      .eq("confirmation_status", "pending")
      .is("confirm_sent_at", null);

    for (const booking of (confirmList ?? [])) {
      const dateLabel = formatDate(booking.arrival_date);
      const result    = await sendTemplate(
        booking.phone,
        "dream_arrival_confirm",
        [booking.guest_name, dateLabel],
      );

      await supabase.from("automation_logs").insert({
        booking_id:    booking.id,
        template_name: "dream_arrival_confirm",
        phone:         booking.phone,
        status:        result.ok ? "sent" : "failed",
        error:         result.ok ? null : result.error,
      });

      if (result.ok) {
        await supabase.from("bookings")
          .update({ confirm_sent_at: new Date().toISOString() })
          .eq("id", booking.id);
        results.confirm++;
      } else {
        results.errors.push(`confirm ${booking.phone}: ${result.error}`);
      }
    }

    // ── 2. בוקר ההגעה — היום ────────────────────────────────────────────────
    const { data: morningList } = await supabase
      .from("bookings")
      .select("id, guest_name, phone, arrival_date")
      .eq("arrival_date", todayStr)
      .eq("confirmation_status", "confirmed")
      .is("morning_sent_at", null);

    for (const booking of (morningList ?? [])) {
      const result = await sendTemplate(
        booking.phone,
        "dream_arrival_morning",
        [booking.guest_name],
      );

      await supabase.from("automation_logs").insert({
        booking_id:    booking.id,
        template_name: "dream_arrival_morning",
        phone:         booking.phone,
        status:        result.ok ? "sent" : "failed",
        error:         result.ok ? null : result.error,
      });

      if (result.ok) {
        await supabase.from("bookings")
          .update({ morning_sent_at: new Date().toISOString() })
          .eq("id", booking.id);
        results.morning++;
      } else {
        results.errors.push(`morning ${booking.phone}: ${result.error}`);
      }
    }

    // ── 3. תזכורת כניסה — יום לפני (dream_checkin_reminder) ────────────────
    const { data: checkinList } = await supabase
      .from("bookings")
      .select("id, guest_name, phone")
      .eq("arrival_date", tomorrowStr)
      .in("confirmation_status", ["confirmed", "pending"])
      .is("checkin_reminder_sent_at", null);

    for (const booking of (checkinList ?? [])) {
      const result = await sendTemplate(
        booking.phone,
        "dream_checkin_reminder",
        [booking.guest_name, "08-6705600"],
      );

      await supabase.from("automation_logs").insert({
        booking_id:    booking.id,
        template_name: "dream_checkin_reminder",
        phone:         booking.phone,
        status:        result.ok ? "sent" : "failed",
        error:         result.ok ? null : result.error,
      });

      if (result.ok) {
        await supabase.from("bookings")
          .update({ checkin_reminder_sent_at: new Date().toISOString() })
          .eq("id", booking.id);
        results.checkin++;
      } else {
        results.errors.push(`checkin ${booking.phone}: ${result.error}`);
      }
    }

    // ── 4. Fallback תשלום — 12 שעות אחרי אישור ללא קישור (dream_payment_link) ─
    const { data: fallbackList } = await supabase
      .from("bookings")
      .select("id, guest_name, phone, arrival_date")
      .eq("confirmation_status", "confirmed")
      .eq("payment_status", "pending")
      .is("payment_link_sent_at", null)
      .is("payment_fallback_sent_at", null)
      .lte("confirmed_at", twelveHoursAgo.toISOString())
      .gte("arrival_date", todayStr);

    for (const booking of (fallbackList ?? [])) {
      const dateLabel = formatDate(booking.arrival_date);
      const payLink   = `https://pay.dream-island.co.il/pay?booking=${booking.id}`;

      const result = await sendTemplate(
        booking.phone,
        "dream_payment_link",
        [booking.guest_name, dateLabel, payLink],
      );

      await supabase.from("automation_logs").insert({
        booking_id:    booking.id,
        template_name: "dream_payment_link",
        phone:         booking.phone,
        status:        result.ok ? "sent" : "failed",
        error:         result.ok ? null : result.error,
      });

      if (result.ok) {
        await supabase.from("bookings")
          .update({
            payment_link:              payLink,
            payment_fallback_sent_at:  new Date().toISOString(),
            payment_status:            "link_sent",
          })
          .eq("id", booking.id);
        results.payment_fallback++;
      } else {
        results.errors.push(`payment_fallback ${booking.phone}: ${result.error}`);
      }
    }

    // ── 5. בקשת ביקורת — יום אחרי הגעה (dream_post_visit) ──────────────────
    // אם checkout_date מוגדר — משתמשים בו; אחרת arrival_date + 1 (הנחת לילה אחד)
    const { data: reviewList } = await supabase
      .from("bookings")
      .select("id, guest_name, phone, checkout_date")
      .eq("confirmation_status", "confirmed")
      .is("review_sent_at", null)
      .or(
        `checkout_date.eq.${yesterdayStr},` +
        `and(checkout_date.is.null,arrival_date.eq.${yesterdayStr})`,
      );

    for (const booking of (reviewList ?? [])) {
      const result = await sendTemplate(
        booking.phone,
        "dream_post_visit",
        [booking.guest_name],
      );

      await supabase.from("automation_logs").insert({
        booking_id:    booking.id,
        template_name: "dream_post_visit",
        phone:         booking.phone,
        status:        result.ok ? "sent" : "failed",
        error:         result.ok ? null : result.error,
      });

      if (result.ok) {
        await supabase.from("bookings")
          .update({ review_sent_at: new Date().toISOString() })
          .eq("id", booking.id);
        results.review++;
      } else {
        results.errors.push(`review ${booking.phone}: ${result.error}`);
      }
    }

    return json({
      ok: true,
      date: todayStr,
      confirm_sent:      results.confirm,
      morning_sent:      results.morning,
      checkin_sent:      results.checkin,
      payment_fallback:  results.payment_fallback,
      review_sent:       results.review,
      errors:            results.errors,
    });

  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});

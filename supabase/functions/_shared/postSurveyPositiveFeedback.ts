// After a positive portal survey — send bot_scripts.positive_feedback_reply via WA
// (same copy as webhook "היה מושלם!" button handler).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  primeGuestChannelConfig,
  shouldRouteGuestOutboundViaWhapiSuites,
} from "./guestWhapiRouting.ts";

type GuestOutboundRow = {
  id: number;
  phone?: string | null;
  room_type?: string | null;
  room?: string | null;
};

export async function resolvePositiveFeedbackReplyBody(
  supabase: SupabaseClient,
): Promise<string> {
  const { data: scriptRow } = await supabase
    .from("bot_scripts")
    .select("message_text")
    .eq("script_key", "positive_feedback_reply")
    .maybeSingle();
  const reviewUrl = Deno.env.get("GOOGLE_REVIEW_URL") ?? "dream-island.co.il";
  const raw = scriptRow?.message_text?.trim();
  if (raw) {
    return raw.replace(/\{\{\s*GOOGLE_REVIEW_URL\s*\}\}/gi, reviewUrl);
  }
  return (
    `שמחנו מאוד לשמוע! 🌟 אם תרצו לשתף את החוויה שלכם — זה יאיר לנו את היום:\n${reviewUrl}\n` +
    "תודה ענקית ומחכים לכם בפעם הבאה! 💫"
  );
}

/** Non-blocking WA follow-up after positive structured survey (portal). */
export async function sendPostSurveyPositiveFeedbackWa(
  supabase: SupabaseClient,
  guest: GuestOutboundRow,
): Promise<{ sent: boolean; error?: string }> {
  const phone = String(guest.phone ?? "").trim();
  if (!phone) return { sent: false, error: "no_phone" };

  await primeGuestChannelConfig(supabase);
  const channel = shouldRouteGuestOutboundViaWhapiSuites(guest) ? "whapi" : "meta";
  const message = await resolvePositiveFeedbackReplyBody(supabase);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  try {
    const waRes = await fetch(`${supabaseUrl}/functions/v1/whatsapp-send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        trigger: "inbox_reply",
        phone,
        message,
        inbox_channel: channel,
      }),
      signal: AbortSignal.timeout(28000),
    });
    const waData = await waRes.json().catch(() => ({})) as Record<string, unknown>;
    const sent =
      waRes.ok &&
      waData.ok !== false &&
      waData.status !== "window_closed" &&
      waData.status !== "whapi_disabled";
    if (!sent) {
      console.warn(
        `[postSurveyPositiveFeedback] WA follow-up failed channel=${channel}:`,
        JSON.stringify(waData).slice(0, 400),
      );
      return {
        sent: false,
        error: String(waData.error ?? waData.status ?? `http_${waRes.status}`).slice(0, 200),
      };
    }
    console.log(
      `[postSurveyPositiveFeedback] sent guest=${guest.id} channel=${channel}`,
    );
    return { sent: true };
  } catch (e) {
    const msg = (e as Error).message;
    console.warn("[postSurveyPositiveFeedback] invoke failed:", msg);
    return { sent: false, error: msg };
  }
}

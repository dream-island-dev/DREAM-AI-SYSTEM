// Orit CS — guest outbound channel (email primary, WhatsApp bridge when no email).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildStaffAppDeepLink } from "./guestAlertWhapiNotify.ts";
import {
  resolveOritReplyEmail,
  resolveOritReplyName,
} from "./oritGuestContactExtract.ts";
import { sendWhapiText } from "./whapiSend.ts";
import type { OritAlertThread } from "./oritAgentWhapiAlert.ts";

export type OritOutboundChannel = "email" | "whatsapp_bridge" | "blocked";

export type OritGuestContactThread = Pick<
  OritAlertThread,
  "id" | "from_email" | "from_name" | "guest_contact_email" | "guest_contact_phone" | "guest_contact_name"
>;

/** Normalize to bare digits (972…) for Whapi + inbox matching. */
export function normalizeOritGuestPhoneDigits(phone: string | null | undefined): string {
  const raw = (phone ?? "").replace(/\D/g, "");
  if (!raw) return "";
  if (raw.startsWith("972")) return raw;
  if (raw.startsWith("0") && raw.length >= 9) return `972${raw.slice(1)}`;
  return raw;
}

export function formatGuestPhoneDisplay(phone: string | null | undefined): string | null {
  const digits = normalizeOritGuestPhoneDigits(phone);
  if (!digits) return null;
  if (digits.startsWith("972") && digits.length >= 11) {
    return `0${digits.slice(3, 5)}-${digits.slice(5, 8)}-${digits.slice(8)}`;
  }
  if (digits.startsWith("05") && digits.length === 10) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return digits;
}

export function resolveOritOutboundChannel(thread: OritGuestContactThread): OritOutboundChannel {
  const email = resolveOritReplyEmail(thread.from_email ?? "", thread.guest_contact_email);
  if (email) return "email";
  if (normalizeOritGuestPhoneDigits(thread.guest_contact_phone)) return "whatsapp_bridge";
  return "blocked";
}

export function buildOritWaInboxLink(thread: OritGuestContactThread): string | null {
  const digits = normalizeOritGuestPhoneDigits(thread.guest_contact_phone);
  if (!digits) return null;
  const name = resolveOritReplyName(thread.from_name, thread.guest_contact_name);
  return buildStaffAppDeepLink({
    page: "wa_inbox",
    phone: digits,
    guestName: name && !name.includes("@") ? name : undefined,
  });
}

/** Deep link to Orit CS panel on mobile — opens thread for edit/send. */
export function buildOritCsThreadDeepLink(threadId: string): string {
  return buildStaffAppDeepLink({ page: "orit_cs_agent", threadId });
}

export function composeOritCsMobileLinkLine(threadId: string): string {
  return `👉 לפתיחה בממשק (לעריכה): ${buildOritCsThreadDeepLink(threadId)}`;
}

const WA_EMAIL_ASK = "נשמח לקבל כתובת מייל להמשך התכתבות ולסגירת הפנייה.";

/** Shorten email-style draft for WhatsApp; ask for email on bridge sends. */
export function adaptDraftForWhatsApp(text: string, opts: { bridge?: boolean } = {}): string {
  let t = (text || "").trim();
  t = t.replace(/\n*בברכה,?\n[\s\S]*$/i, "").trim();
  t = t.replace(/\n*יום נפלא,?\n[\s\S]*$/i, "").trim();
  t = t.replace(/\n*אורית חלפון[\s\S]*$/i, "").trim();
  t = t.replace(/\n*מנהלת שירות[\s\S]*$/i, "").trim();
  t = t.replace(/\n*דרים איילנד[\s\S]*$/i, "").trim();
  if (t.length > 1800) t = `${t.slice(0, 1797)}…`;
  if (opts.bridge && !/מייל|email/i.test(t)) {
    t = `${t}\n\n${WA_EMAIL_ASK}`;
  }
  return t.trim();
}

export function composeSigalWaBridgeAdvice(thread: OritGuestContactThread): string {
  const phone = formatGuestPhoneDisplay(thread.guest_contact_phone);
  if (!phone) return "חסרים מייל וטלפון — כתבי לי את פרטי האורח/ת.";
  return `אין מייל — אפשר בוואטסאפ (${phone}): «שלחי בוואטסאפ».`;
}

export function composeSigalWaSentFollowUp(
  guest: string,
  inboxLink: string,
  phase: "ack" | "full",
): string {
  if (phase === "ack") {
    return [
      `✓ שלב ① נשלח ל־${guest} בוואטסאפ.`,
      "שלב ②: «תשובה מלאה» → «כן שלחי»",
      inboxLink,
    ].join("\n");
  }
  return [
    `✓ שלב ② נשלח ל־${guest} בוואטסאפ.`,
    "«סיימתי» לסגירה",
    inboxLink,
  ].join("\n");
}

export async function deliverOritGuestWhatsapp(
  supabase: SupabaseClient,
  guestPhone: string | null | undefined,
  body: string,
  threadId: string,
): Promise<{ sent: boolean; error?: string }> {
  const digits = normalizeOritGuestPhoneDigits(guestPhone);
  if (!digits) return { sent: false, error: "no_phone" };

  const msg = adaptDraftForWhatsApp(body, { bridge: true });
  try {
    const whapiId = await sendWhapiText(digits, msg, { noLinkPreview: true });
    if (!whapiId) return { sent: false, error: "whapi_failed" };

    const phoneE164 = digits;
    await supabase.from("whatsapp_conversations").insert({
      phone: phoneE164,
      guest_id: null,
      inbox_channel: "whapi",
      direction: "outbound",
      message: msg,
      wa_message_id: whapiId,
    });

    const sentAt = new Date().toISOString();
    await supabase.from("orit_agent_messages").insert({
      thread_id: threadId,
      external_key: `wa-${whapiId || sentAt}`,
      direction: "outbound",
      body_text: msg,
      received_at: sentAt,
      message_kind: "manual_reply",
    });

    return { sent: true };
  } catch (e) {
    return { sent: false, error: (e as Error).message };
  }
}

/** Open Orit thread on WA bridge (orit_wa_contact_at set) for this guest phone. */
export async function findOpenOritWaBridgeThread(
  supabase: SupabaseClient,
  phoneDigits: string,
): Promise<Record<string, unknown> | null> {
  const normalized = normalizeOritGuestPhoneDigits(phoneDigits);
  if (!normalized) return null;

  const { data: rows } = await supabase
    .from("orit_agent_threads")
    .select("id, mailbox_id, subject, from_name, guest_contact_name, guest_contact_phone, guest_contact_email, from_email, category, urgency, ai_summary, status, orit_wa_contact_at, guest_wa_reply_notified_at, is_demo")
    .not("orit_wa_contact_at", "is", null)
    .eq("is_demo", false)
    .neq("status", "handled")
    .neq("status", "archived")
    .order("orit_wa_contact_at", { ascending: false })
    .limit(20);

  for (const row of rows ?? []) {
    const guestDigits = normalizeOritGuestPhoneDigits(row.guest_contact_phone as string);
    if (guestDigits === normalized) return row;
  }
  return null;
}

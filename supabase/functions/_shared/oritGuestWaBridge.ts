// Orit CS — guest WhatsApp bridge: notify Orit when guest replies on suites device.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildOritWaInboxLink,
  findOpenOritWaBridgeThread,
} from "./oritGuestOutbound.ts";
import {
  resolveOritAlertPhone,
  type OritAlertMailbox,
} from "./oritAgentWhapiAlert.ts";
import { sendWhapiText } from "./whapiSend.ts";
import { fetchOritDraftText } from "./oritAgentWorkflow.ts";
import { composeSigalGuestWaReplyBriefing } from "./oritSigalBriefing.ts";

async function sendWhapiLongText(phone: string, text: string): Promise<boolean> {
  const max = 3400;
  const body = text.trim();
  if (!body) return false;
  if (body.length <= max) return Boolean(await sendWhapiText(phone, body, { noLinkPreview: true }));

  const paragraphs = body.split(/\n{2,}/);
  let chunk = "";
  for (const p of paragraphs) {
    const next = chunk ? `${chunk}\n\n${p}` : p;
    if (next.length > max) {
      if (chunk && !await sendWhapiText(phone, chunk, { noLinkPreview: true })) return false;
      if (p.length > max) {
        for (let i = 0; i < p.length; i += max) {
          if (!await sendWhapiText(phone, p.slice(i, i + max), { noLinkPreview: true })) return false;
        }
        chunk = "";
      } else {
        chunk = p;
      }
    } else {
      chunk = next;
    }
  }
  if (chunk) return Boolean(await sendWhapiText(phone, chunk, { noLinkPreview: true }));
  return true;
}

export async function notifyOritGuestWaReplied(
  supabase: SupabaseClient,
  mailbox: OritAlertMailbox,
  threadId: string,
  guestMessage: string,
): Promise<{ sent: boolean; reason?: string }> {
  if (mailbox.alert_enabled === false) return { sent: false, reason: "alert_disabled" };

  const { data: thread } = await supabase
    .from("orit_agent_threads")
    .select("id, subject, from_name, from_email, category, urgency, ai_summary, guest_contact_name, guest_contact_phone, guest_contact_email, is_demo, guest_wa_reply_notified_at, orit_wa_contact_at")
    .eq("id", threadId)
    .maybeSingle();

  if (!thread || thread.is_demo || !thread.orit_wa_contact_at) {
    return { sent: false, reason: "no_wa_bridge" };
  }

  const phone = await resolveOritAlertPhone(supabase, mailbox);
  if (!phone) return { sent: false, reason: "no_phone" };

  const followUp = await fetchOritDraftText(supabase, threadId, "full_reply");
  const inboxLink = buildOritWaInboxLink(thread);
  const body = composeSigalGuestWaReplyBriefing(
    thread,
    guestMessage.trim(),
    followUp?.text ?? null,
    inboxLink,
  );

  const sent = await sendWhapiLongText(phone, body);
  if (!sent) return { sent: false, reason: "whapi_failed" };

  await supabase.from("orit_agent_threads").update({
    workflow_step: "guest_replied",
    status: "awaiting_reply",
    guest_wa_reply_notified_at: new Date().toISOString(),
    handled_at: null,
  }).eq("id", threadId);

  return { sent: true };
}

/** Guest DM on suites device — intercept before guest bot if Orit WA bridge is active. */
export async function tryHandleOritGuestWaInbound(
  supabase: SupabaseClient,
  guestPhoneDigits: string,
  messageText: string,
): Promise<boolean> {
  const thread = await findOpenOritWaBridgeThread(supabase, guestPhoneDigits);
  if (!thread) return false;

  const { data: mailbox } = await supabase
    .from("orit_agent_mailbox")
    .select("id, profile_id, digest_whatsapp_phone, alert_enabled")
    .eq("id", thread.mailbox_id)
    .maybeSingle();

  if (!mailbox) return false;

  const notifiedAt = thread.guest_wa_reply_notified_at
    ? new Date(String(thread.guest_wa_reply_notified_at)).getTime()
    : 0;
  const now = Date.now();
  if (notifiedAt && now - notifiedAt < 60_000) return true;

  await notifyOritGuestWaReplied(supabase, mailbox, String(thread.id), messageText);
  return true;
}

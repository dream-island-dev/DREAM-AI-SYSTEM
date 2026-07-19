// Sigal ← Orit UI send confirmations (Whapi only, zero LLM credits).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  resolveOritAlertPhone,
  type OritAlertMailbox,
} from "./oritAgentWhapiAlert.ts";
import { composeOritCsMobileLinkLine } from "./oritGuestOutbound.ts";
import { sigalGuestLabel, type SigalBriefingThread } from "./oritSigalBriefing.ts";
import {
  formatOritScheduleLabel,
  type OritScheduleChannel,
  type OritScheduleDraftKind,
} from "./oritScheduleSend.ts";
import { sendWhapiText } from "./whapiSend.ts";

export type OritUiSendVia = "email" | "whatsapp_bridge";

export function composeSigalUiSendConfirmation(
  thread: SigalBriefingThread,
  kind: "ack" | "full_reply",
  via: OritUiSendVia,
): string {
  const guest = sigalGuestLabel(thread);
  const dest = via === "whatsapp_bridge" ? "בוואטסאפ" : "במייל";
  const threadId = String(thread.id ?? "").trim();

  if (kind === "ack") {
    const lines = [
      `✓ שלחת מהממשק — «קיבלנו את פנייתך» ל${guest} ${dest} ✓`,
      'שלב 2 — המכתב המלא: "תשובה מלאה" או ערכי בממשק',
      '"סיימתי" כשסגרנו',
    ];
    if (threadId) lines.push(composeOritCsMobileLinkLine(threadId));
    return lines.join("\n");
  }

  const lines = [
    `✓ שלחת מהממשק — המכתב המלא ל${guest} ${dest} ✓`,
    '"סיימתי" לסגירה',
  ];
  if (threadId) lines.push(composeOritCsMobileLinkLine(threadId));
  return lines.join("\n");
}

export async function notifyOritSigalUiSend(
  supabase: SupabaseClient,
  mailbox: OritAlertMailbox,
  thread: SigalBriefingThread,
  kind: "ack" | "full_reply",
  via: OritUiSendVia,
): Promise<{ sent: boolean; reason?: string }> {
  if (mailbox.alert_enabled === false) return { sent: false, reason: "alert_disabled" };

  const phone = await resolveOritAlertPhone(supabase, mailbox);
  if (!phone) return { sent: false, reason: "no_phone" };

  const body = composeSigalUiSendConfirmation(thread, kind, via);
  const whapiId = await sendWhapiText(phone, body, { noLinkPreview: true });
  if (!whapiId) return { sent: false, reason: "whapi_failed" };

  return { sent: true };
}

export function composeSigalScheduleCreated(
  thread: SigalBriefingThread,
  scheduledForIso: string,
  channel: OritScheduleChannel,
  draftKind: OritScheduleDraftKind,
): string {
  const guest = sigalGuestLabel(thread);
  const dest = channel === "whatsapp_bridge" ? "בוואטסאפ" : "במייל";
  const when = formatOritScheduleLabel(scheduledForIso);
  const phase = draftKind === "ack" ? "אישור קבלה" : "תשובה מלאה";
  const lines = [
    `📅 תזמנת ${phase} ל${guest} ${dest} — ${when}`,
    '"מה מתוזמן" לראות · "בטלי תזמון" לביטול',
  ];
  const threadId = String(thread.id ?? "").trim();
  if (threadId) lines.push(composeOritCsMobileLinkLine(threadId));
  return lines.join("\n");
}

export async function notifyOritScheduleCreated(
  supabase: SupabaseClient,
  mailbox: OritAlertMailbox,
  thread: SigalBriefingThread,
  scheduledForIso: string,
  channel: OritScheduleChannel,
  draftKind: OritScheduleDraftKind,
): Promise<{ sent: boolean; reason?: string }> {
  if (mailbox.alert_enabled === false) return { sent: false, reason: "alert_disabled" };
  const phone = await resolveOritAlertPhone(supabase, mailbox);
  if (!phone) return { sent: false, reason: "no_phone" };
  const body = composeSigalScheduleCreated(thread, scheduledForIso, channel, draftKind);
  const whapiId = await sendWhapiText(phone, body, { noLinkPreview: true });
  if (!whapiId) return { sent: false, reason: "whapi_failed" };
  return { sent: true };
}

export function composeSigalScheduledDispatched(
  thread: SigalBriefingThread,
  channel: OritScheduleChannel,
  draftKind: OritScheduleDraftKind,
): string {
  const guest = sigalGuestLabel(thread);
  const dest = channel === "whatsapp_bridge" ? "בוואטסאפ" : "במייל";
  const phase = draftKind === "ack" ? "אישור הקבלה" : "המכתב המלא";
  return `✓ נשלח עכשיו (מתוזמן) — ${phase} ל${guest} ${dest} ✓`;
}

export async function notifyOritScheduledDispatched(
  supabase: SupabaseClient,
  mailbox: OritAlertMailbox,
  thread: SigalBriefingThread,
  draftKind: OritScheduleDraftKind,
  channel: OritScheduleChannel,
): Promise<{ sent: boolean; reason?: string }> {
  if (mailbox.alert_enabled === false) return { sent: false, reason: "alert_disabled" };
  const phone = await resolveOritAlertPhone(supabase, mailbox);
  if (!phone) return { sent: false, reason: "no_phone" };
  const body = composeSigalScheduledDispatched(thread, channel, draftKind);
  const whapiId = await sendWhapiText(phone, body, { noLinkPreview: true });
  if (!whapiId) return { sent: false, reason: "whapi_failed" };
  return { sent: true };
}

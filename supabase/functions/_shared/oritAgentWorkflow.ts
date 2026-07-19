// Orit CS — two-phase complaint workflow: ack approval → full reply approval.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { deliverOritThreadEmail } from "./oritAgentSend.ts";
import type { OritMailboxRow } from "./oritAgentMail.ts";
import {
  resolveOritReplyEmail,
} from "./oritGuestContactExtract.ts";
import {
  resolveOritAlertPhone,
  type OritAlertMailbox,
  type OritAlertThread,
} from "./oritAgentWhapiAlert.ts";
import { sendWhapiText } from "./whapiSend.ts";
import { sanitizeOritAckDraft } from "./oritThreadAnalysis.ts";
import {
  areSigalBriefingDraftsReady,
  composeSigalAckSentFollowUp,
  composeSigalComplaintBriefing,
  composeSigalGuestReplyBriefing,
  composeSigalSimpleBriefing,
  composeSigalStaleReminder,
  composeSigalLoopNudge,
  resolveSigalLoopPhase,
  sigalLoopTiming,
  sigalReminderEscalationLevel,
  sigalGuestLabel,
  type SigalBriefingThread,
} from "./oritSigalBriefing.ts";
import { resolveOritOutboundChannel } from "./oritGuestOutbound.ts";

export type OritWorkflowStep =
  | "awaiting_ack_approval"
  | "ack_sent"
  | "awaiting_reply_approval"
  | "reply_sent"
  | "guest_replied";

export function isOritWorkflowComplaint(category: string, urgency: string): boolean {
  return category === "complaint" && (urgency === "critical" || urgency === "high");
}

export function truncateForWhapi(text: string, max = 420): string {
  const t = (text || "").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

export function composeOritWorkflowAlert(
  thread: OritAlertThread,
  ackDraft: string,
  fullReplyDraft?: string,
): string {
  if (fullReplyDraft?.trim()) {
    return composeSigalComplaintBriefing(thread, ackDraft, fullReplyDraft);
  }
  return composeSigalComplaintBriefing(thread, ackDraft, ackDraft);
}

export function composeOritFullReplyReadyMessage(
  thread: OritAlertThread,
  _fullReplyPreview: string,
): string {
  return composeSigalAckSentFollowUp(sigalGuestLabel(thread), thread.id);
}

export function composeSigalGuestReplyCoaching(
  thread: OritAlertThread,
  guestMessage: string,
  followUpDraft: string | null,
): string {
  return composeSigalGuestReplyBriefing(thread, guestMessage, followUpDraft);
}

export function composeOritGuestRepliedAlert(
  thread: OritAlertThread,
  inboundSnippet: string,
  followUpDraft?: string | null,
): string {
  return composeSigalGuestReplyCoaching(thread, inboundSnippet, followUpDraft ?? null);
}

export async function fetchOritDraftText(
  supabase: SupabaseClient,
  threadId: string,
  kind: "ack" | "full_reply",
): Promise<{ id: string; text: string } | null> {
  const { data } = await supabase
    .from("orit_agent_drafts")
    .select("id, suggested_text, final_text")
    .eq("thread_id", threadId)
    .eq("draft_kind", kind)
    .in("status", ["suggested", "edited"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  let text = (data.final_text || data.suggested_text || "").trim();
  if (!text) return null;
  if (kind === "ack") text = sanitizeOritAckDraft(text);
  return { id: data.id, text };
}

export async function sendOritAckEmail(
  supabase: SupabaseClient,
  mailbox: OritMailboxRow,
  thread: Record<string, unknown>,
  bodyText: string,
  draftId?: string,
): Promise<{ sent: boolean; error?: string }> {
  const threadId = String(thread.id);
  const sanitized = sanitizeOritAckDraft(bodyText.trim());
  const result = await deliverOritThreadEmail(supabase, mailbox, {
    id: threadId,
    from_email: String(thread.from_email ?? ""),
    from_name: thread.from_name as string | null,
    guest_contact_email: thread.guest_contact_email as string | null,
    guest_contact_name: thread.guest_contact_name as string | null,
    subject: String(thread.subject ?? ""),
    is_demo: Boolean(thread.is_demo),
  }, sanitized, "auto_ack");

  if (!result.sent) return { sent: false, error: result.error };

  const sentAt = new Date().toISOString();
  await supabase.from("orit_agent_threads").update({
    auto_ack_sent_at: sentAt,
    workflow_step: "awaiting_reply_approval",
    orit_decision: "email_ack",
    orit_decision_at: sentAt,
    status: "awaiting_reply",
  }).eq("id", threadId);

  if (draftId) {
    await supabase.from("orit_agent_drafts").update({
      status: "sent",
      final_text: sanitized,
    }).eq("id", draftId);
  } else {
    await supabase.from("orit_agent_drafts").update({ status: "sent" })
      .eq("thread_id", threadId)
      .eq("draft_kind", "ack")
      .in("status", ["suggested", "edited"]);
  }

  await supabase.from("orit_agent_auto_ack_log").upsert({
    thread_id: threadId,
    sent_at: sentAt,
    body_preview: bodyText.trim().slice(0, 300),
  }, { onConflict: "thread_id" });

  return { sent: true };
}

export async function notifyOritWorkflowAlert(
  supabase: SupabaseClient,
  mailbox: OritAlertMailbox,
  threadId: string,
  opts: { force?: boolean } = {},
): Promise<{ sent: boolean; reason?: string }> {
  if (mailbox.alert_enabled === false) {
    return { sent: false, reason: "alert_disabled" };
  }

  const { data: thread } = await supabase
    .from("orit_agent_threads")
    .select("id, subject, from_name, from_email, category, urgency, ai_summary, guest_contact_name, guest_contact_phone, guest_contact_email, auto_ack_sent_at, orit_wa_contact_at, status, is_demo, workflow_step")
    .eq("id", threadId)
    .maybeSingle();

  if (!thread || thread.is_demo) return { sent: false, reason: "no_thread" };
  if (!isOritWorkflowComplaint(thread.category, thread.urgency)) {
    return { sent: false, reason: "not_workflow_complaint" };
  }
  if (thread.status === "handled" || thread.status === "archived") {
    return { sent: false, reason: "closed" };
  }
  if (thread.auto_ack_sent_at || thread.orit_wa_contact_at) {
    return { sent: false, reason: "ack_already_sent" };
  }

  if (!opts.force) {
    const { data: existing } = await supabase
      .from("orit_agent_alert_log")
      .select("sent_at")
      .eq("thread_id", threadId)
      .maybeSingle();
    if (existing?.sent_at && thread.workflow_step === "awaiting_ack_approval") {
      return { sent: false, reason: "already_sent" };
    }
  }

  const ackDraft = await fetchOritDraftText(supabase, threadId, "ack");
  const fullDraft = await fetchOritDraftText(supabase, threadId, "full_reply");
  const channel = resolveOritOutboundChannel(thread as SigalBriefingThread);
  const draftsReady = channel === "whatsapp_bridge"
    ? Boolean(ackDraft?.text?.trim())
    : areSigalBriefingDraftsReady(ackDraft?.text, fullDraft?.text, true);
  if (!draftsReady) {
    return { sent: false, reason: "briefing_not_ready" };
  }

  const phone = await resolveOritAlertPhone(supabase, mailbox);
  if (!phone) return { sent: false, reason: "no_phone" };

  const body = channel === "whatsapp_bridge"
    ? composeSigalComplaintBriefing(thread as SigalBriefingThread, ackDraft!.text, fullDraft?.text || ackDraft!.text)
    : composeSigalComplaintBriefing(thread as SigalBriefingThread, ackDraft!.text, fullDraft!.text);
  const sent = await sendWhapiLongText(phone, body);
  if (!sent) return { sent: false, reason: "whapi_failed" };

  const now = new Date().toISOString();
  await supabase.from("orit_agent_threads").update({
    workflow_step: "awaiting_ack_approval",
    orit_decision: "pending",
    orit_decision_prompted_at: now,
  }).eq("id", threadId);

  await supabase.from("orit_agent_alert_log").upsert({
    mailbox_id: mailbox.id,
    thread_id: threadId,
    body_sent: body.slice(0, 4000),
    whapi_message_id: null,
    sent_at: now,
  }, { onConflict: "thread_id" });

  return { sent: true };
}

/** Sigal briefing for any open complaint (replaces legacy 1/2/3 decision prompt). */
export async function notifyOritSigalComplaintBriefing(
  supabase: SupabaseClient,
  mailbox: OritAlertMailbox,
  threadId: string,
  opts: { force?: boolean } = {},
): Promise<{ sent: boolean; reason?: string }> {
  if (mailbox.alert_enabled === false) return { sent: false, reason: "alert_disabled" };

  const { data: thread } = await supabase
    .from("orit_agent_threads")
    .select("id, subject, from_name, from_email, category, urgency, ai_summary, guest_contact_name, guest_contact_phone, guest_contact_email, auto_ack_sent_at, orit_wa_contact_at, status, is_demo, workflow_step")
    .eq("id", threadId)
    .maybeSingle();

  if (!thread || thread.is_demo || thread.category !== "complaint") {
    return { sent: false, reason: "not_complaint" };
  }
  if (thread.status === "handled" || thread.status === "archived") {
    return { sent: false, reason: "closed" };
  }
  if (isOritWorkflowComplaint(thread.category, thread.urgency)) {
    return notifyOritWorkflowAlert(supabase, mailbox, threadId, opts);
  }

  if (!opts.force) {
    const { data: existing } = await supabase
      .from("orit_agent_alert_log")
      .select("sent_at")
      .eq("thread_id", threadId)
      .maybeSingle();
    if (existing?.sent_at) return { sent: false, reason: "already_sent" };
  }

  const ackDraft = await fetchOritDraftText(supabase, threadId, "ack");
  const fullDraft = await fetchOritDraftText(supabase, threadId, "full_reply");
  const replyText = fullDraft?.text || ackDraft?.text;
  if (!replyText?.trim()) return { sent: false, reason: "briefing_not_ready" };

  const phone = await resolveOritAlertPhone(supabase, mailbox);
  if (!phone) return { sent: false, reason: "no_phone" };

  const body = composeSigalSimpleBriefing(thread as SigalBriefingThread, replyText);
  const sent = await sendWhapiLongText(phone, body);
  if (!sent) return { sent: false, reason: "whapi_failed" };

  const now = new Date().toISOString();
  await supabase.from("orit_agent_threads").update({
    orit_decision_prompted_at: now,
  }).eq("id", threadId);

  await supabase.from("orit_agent_alert_log").upsert({
    mailbox_id: mailbox.id,
    thread_id: threadId,
    body_sent: body.slice(0, 4000),
    whapi_message_id: null,
    sent_at: now,
  }, { onConflict: "thread_id" });

  return { sent: true };
}

export async function notifyOritFullReplyReady(
  supabase: SupabaseClient,
  mailbox: OritAlertMailbox,
  threadId: string,
): Promise<{ sent: boolean; reason?: string }> {
  if (mailbox.alert_enabled === false) return { sent: false, reason: "alert_disabled" };

  const { data: thread } = await supabase
    .from("orit_agent_threads")
    .select("id, subject, from_name, from_email, category, urgency, ai_summary, guest_contact_name, guest_contact_phone, guest_contact_email, is_demo")
    .eq("id", threadId)
    .maybeSingle();

  if (!thread || thread.is_demo) return { sent: false, reason: "no_thread" };

  const fullDraft = await fetchOritDraftText(supabase, threadId, "full_reply");
  if (!fullDraft?.text) return { sent: false, reason: "no_full_draft" };

  const phone = await resolveOritAlertPhone(supabase, mailbox);
  if (!phone) return { sent: false, reason: "no_phone" };

  const body = composeOritFullReplyReadyMessage(thread as OritAlertThread, fullDraft.text);
  const whapiId = await sendWhapiText(phone, body, { noLinkPreview: true });
  if (!whapiId) return { sent: false, reason: "whapi_failed" };

  await supabase.from("orit_agent_threads").update({
    workflow_step: "awaiting_reply_approval",
  }).eq("id", threadId);

  return { sent: true };
}

async function sendWhapiLongText(phone: string, text: string): Promise<boolean> {
  const max = 3400;
  const body = text.trim();
  if (!body) return false;
  if (body.length <= max) {
    const id = await sendWhapiText(phone, body, { noLinkPreview: true });
    return Boolean(id);
  }
  const paragraphs = body.split(/\n{2,}/);
  let chunk = "";
  for (const p of paragraphs) {
    const next = chunk ? `${chunk}\n\n${p}` : p;
    if (next.length > max) {
      if (chunk) {
        const id = await sendWhapiText(phone, chunk, { noLinkPreview: true });
        if (!id) return false;
      }
      if (p.length > max) {
        for (let i = 0; i < p.length; i += max) {
          const id = await sendWhapiText(phone, p.slice(i, i + max), { noLinkPreview: true });
          if (!id) return false;
        }
        chunk = "";
      } else {
        chunk = p;
      }
    } else {
      chunk = next;
    }
  }
  if (chunk) {
    const id = await sendWhapiText(phone, chunk, { noLinkPreview: true });
    return Boolean(id);
  }
  return true;
}

export async function fetchLatestGuestInbound(
  supabase: SupabaseClient,
  threadId: string,
): Promise<string> {
  const { data } = await supabase
    .from("orit_agent_messages")
    .select("body_text")
    .eq("thread_id", threadId)
    .eq("direction", "inbound")
    .order("received_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.body_text ?? "").trim();
}

export async function notifyOritGuestReplied(
  supabase: SupabaseClient,
  mailbox: OritAlertMailbox,
  threadId: string,
  inboundSnippet: string,
): Promise<{ sent: boolean; reason?: string }> {
  if (mailbox.alert_enabled === false) return { sent: false, reason: "alert_disabled" };

  const { data: thread } = await supabase
    .from("orit_agent_threads")
    .select("id, subject, from_name, from_email, category, urgency, guest_contact_name, guest_contact_phone, guest_contact_email, is_demo, guest_reply_notified_at")
    .eq("id", threadId)
    .maybeSingle();

  if (!thread || thread.is_demo) return { sent: false, reason: "no_thread" };

  const { data: latestInbound } = await supabase
    .from("orit_agent_messages")
    .select("received_at, body_text")
    .eq("thread_id", threadId)
    .eq("direction", "inbound")
    .order("received_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const inboundAt = latestInbound?.received_at
    ? new Date(latestInbound.received_at).getTime()
    : 0;
  const notifiedAt = thread.guest_reply_notified_at
    ? new Date(thread.guest_reply_notified_at).getTime()
    : 0;
  if (inboundAt && notifiedAt && inboundAt <= notifiedAt) {
    return { sent: false, reason: "already_notified" };
  }

  const phone = await resolveOritAlertPhone(supabase, mailbox);
  if (!phone) return { sent: false, reason: "no_phone" };

  const guestMessage = (latestInbound?.body_text || inboundSnippet || "").trim();
  const followUp = await fetchOritDraftText(supabase, threadId, "full_reply");
  const body = composeSigalGuestReplyBriefing(
    thread as SigalBriefingThread,
    guestMessage,
    followUp?.text ?? null,
  );

  const sent = await sendWhapiLongText(phone, body);
  if (!sent) return { sent: false, reason: "whapi_failed" };

  const now = new Date().toISOString();
  await supabase.from("orit_agent_threads").update({
    workflow_step: "guest_replied",
    status: "awaiting_reply",
    guest_reply_notified_at: now,
    handled_at: null,
  }).eq("id", threadId);

  return { sent: true };
}

export async function threadHasOutboundEmail(
  supabase: SupabaseClient,
  threadId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("orit_agent_messages")
    .select("id")
    .eq("thread_id", threadId)
    .eq("direction", "outbound")
    .limit(1)
    .maybeSingle();
  return Boolean(data?.id);
}

export function parseOritWorkflowAckApproval(text: string): boolean {
  const t = (text || "").trim().toLowerCase();
  if (!t) return false;
  if (/^(אשרי|אשר|approve|שלחי|שלח|ok|כן|yes|1)$/.test(t)) return true;
  if (/^1[\s.!]*$/.test(t)) return true;
  if (/\bאשרי\b/.test(t) && !/\bלא\b/.test(t)) return true;
  return false;
}

export async function findThreadAwaitingAckApproval(
  supabase: SupabaseClient,
  threadRef: string | null,
): Promise<{ thread: Record<string, unknown>; mailbox: OritMailboxRow } | null> {
  const base = supabase
    .from("orit_agent_threads")
    .select("*, orit_agent_mailbox(*)")
    .eq("workflow_step", "awaiting_ack_approval")
    .is("auto_ack_sent_at", null)
    .order("orit_decision_prompted_at", { ascending: false })
    .limit(50);

  const { data: rows } = await base;
  if (threadRef) {
    for (const row of rows ?? []) {
      if (String(row.id).toLowerCase().startsWith(threadRef)) {
        return { thread: row, mailbox: row.orit_agent_mailbox as OritMailboxRow };
      }
    }
  }
  const first = rows?.[0];
  if (!first) return null;
  return { thread: first, mailbox: first.orit_agent_mailbox as OritMailboxRow };
}

export async function tryHandleOritWorkflowAckApproval(
  supabase: SupabaseClient,
  phoneDigits: string,
  text: string,
): Promise<boolean> {
  if (!parseOritWorkflowAckApproval(text)) return false;

  const threadRef = text.match(/(?:קוד פנייה|ref|#)\s*[:.]?\s*([a-f0-9]{8})/i)?.[1]?.toLowerCase() ?? null;
  const pending = await findThreadAwaitingAckApproval(supabase, threadRef);
  if (!pending) return false;

  const threadId = String(pending.thread.id);
  const ackDraft = await fetchOritDraftText(supabase, threadId, "ack");
  if (!ackDraft?.text) {
    await sendWhapiText(phoneDigits, "לא מצאתי טיוטת אישור קבלה — חכי לסנכרון או עני «עזרה».", { noLinkPreview: true });
    return true;
  }

  const replyEmail = resolveOritReplyEmail(
    String(pending.thread.from_email ?? ""),
    pending.thread.guest_contact_email as string | null,
  );
  const channel = resolveOritOutboundChannel(pending.thread as SigalBriefingThread);

  if (!replyEmail && channel === "whatsapp_bridge") {
    await sendWhapiText(
      phoneDigits,
      "אין מייל — עני «שלחי בוואטסאפ» לאישור קבלה.",
      { noLinkPreview: true },
    );
    return true;
  }

  if (!replyEmail) {
    await sendWhapiText(phoneDigits, "❌ אין מייל אורח תקין — עני «שלחי בוואטסאפ» אם יש טלפון.", { noLinkPreview: true });
    return true;
  }

  const result = await sendOritAckEmail(
    supabase,
    pending.mailbox,
    pending.thread,
    ackDraft.text,
    ackDraft.id,
  );

  if (!result.sent) {
    await sendWhapiText(
      phoneDigits,
      `❌ שליחת אישור הקבלה נכשלה (${result.error || "שגיאה"}). נסי מהמערכת.`,
      { noLinkPreview: true },
    );
    return true;
  }

  const mailboxAlert: OritAlertMailbox = {
    id: pending.mailbox.id,
    digest_whatsapp_phone: pending.mailbox.digest_whatsapp_phone,
    alert_enabled: true,
    profile_id: pending.mailbox.profile_id,
  };
  await notifyOritFullReplyReady(supabase, mailboxAlert, threadId);

  await sendWhapiText(
    phoneDigits,
    composeSigalAckSentFollowUp(sigalGuestLabel(pending.thread as OritAlertThread)),
    { noLinkPreview: true },
  );
  return true;
}

const SIGAL_STALE_HOURS = 4;
const SIGAL_REMINDER_COOLDOWN_HOURS = 4;

/** Smart Sigal loop — phase-aware nudges for urgent complaints until Orit closes. */
export async function runSigalUrgentComplaintLoop(
  supabase: SupabaseClient,
  mailbox: OritAlertMailbox,
): Promise<{ sent: number; skipped: number }> {
  if (mailbox.alert_enabled === false) return { sent: 0, skipped: 0 };

  const phone = await resolveOritAlertPhone(supabase, mailbox);
  if (!phone) return { sent: 0, skipped: 0 };

  const { data: rows } = await supabase
    .from("orit_agent_threads")
    .select("id, subject, from_name, from_email, category, urgency, ai_summary, guest_contact_name, guest_contact_phone, guest_contact_email, auto_ack_sent_at, full_reply_sent_at, workflow_step, received_at, orit_decision_prompted_at, sigal_last_reminder_at, orit_wa_contact_at, status")
    .eq("mailbox_id", mailbox.id)
    .eq("category", "complaint")
    .eq("is_demo", false)
    .in("status", ["awaiting_reply", "snoozed"]);

  let sent = 0;
  let skipped = 0;
  const now = Date.now();

  for (const row of rows ?? []) {
    if (row.status === "handled" || row.status === "archived") {
      skipped += 1;
      continue;
    }

    const urgent = isOritWorkflowComplaint(row.category, row.urgency);
    const { staleHours, cooldownHours } = urgent
      ? sigalLoopTiming(row.urgency)
      : { staleHours: SIGAL_STALE_HOURS, cooldownHours: SIGAL_REMINDER_COOLDOWN_HOURS };

    const receivedAt = row.received_at ? new Date(row.received_at).getTime() : now;
    if (now - receivedAt < staleHours * 3_600_000) {
      skipped += 1;
      continue;
    }

    const lastRem = row.sigal_last_reminder_at
      ? new Date(row.sigal_last_reminder_at).getTime()
      : 0;
    if (lastRem && now - lastRem < cooldownHours * 3_600_000) {
      skipped += 1;
      continue;
    }

    const { data: alertLog } = await supabase
      .from("orit_agent_alert_log")
      .select("sent_at")
      .eq("thread_id", row.id)
      .maybeSingle();

    if (!alertLog?.sent_at && !row.orit_decision_prompted_at) {
      skipped += 1;
      continue;
    }

    const briefing = row as SigalBriefingThread;
    const body = urgent
      ? composeSigalLoopNudge(
        briefing,
        resolveSigalLoopPhase(briefing),
        sigalReminderEscalationLevel(briefing),
      )
      : composeSigalStaleReminder(briefing);

    const ok = await sendWhapiLongText(phone, body);
    if (!ok) {
      skipped += 1;
      continue;
    }

    await supabase.from("orit_agent_threads").update({
      sigal_last_reminder_at: new Date().toISOString(),
    }).eq("id", row.id);
    sent += 1;
  }

  return { sent, skipped };
}

/** @deprecated use runSigalUrgentComplaintLoop */
export async function sendOritStaleComplaintReminders(
  supabase: SupabaseClient,
  mailbox: OritAlertMailbox,
): Promise<{ sent: number; skipped: number }> {
  return runSigalUrgentComplaintLoop(supabase, mailbox);
}

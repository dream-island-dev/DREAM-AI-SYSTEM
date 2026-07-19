// Orit CS — two-phase complaint workflow: ack approval → full reply approval.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildStaffAppDeepLink } from "./guestAlertWhapiNotify.ts";
import { deliverOritThreadEmail } from "./oritAgentSend.ts";
import type { OritMailboxRow } from "./oritAgentMail.ts";
import {
  resolveOritReplyEmail,
  resolveOritReplyName,
} from "./oritGuestContactExtract.ts";
import {
  resolveOritAlertPhone,
  type OritAlertMailbox,
  type OritAlertThread,
  CATEGORY_HE,
  URGENCY_HE,
} from "./oritAgentWhapiAlert.ts";
import { sendWhapiText } from "./whapiSend.ts";
import { sanitizeOritAckDraft } from "./oritThreadAnalysis.ts";

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

function guestContactLines(thread: OritAlertThread): string[] {
  const lines: string[] = [];
  const name = resolveOritReplyName(thread.from_name, thread.guest_contact_name);
  if (name && !name.includes("@")) lines.push(`👤 ${name}`);
  const replyEmail = resolveOritReplyEmail(thread.from_email ?? "", thread.guest_contact_email);
  if (replyEmail) lines.push(`📧 ${replyEmail}`);
  const phone = (thread.guest_contact_phone ?? "").replace(/\D/g, "");
  if (phone) {
    const fmt = phone.startsWith("972") && phone.length >= 11
      ? `0${phone.slice(3, 5)}-${phone.slice(5, 8)}-${phone.slice(8)}`
      : phone.startsWith("05") && phone.length === 10
        ? `${phone.slice(0, 3)}-${phone.slice(3, 6)}-${phone.slice(6)}`
        : phone;
    lines.push(`📱 ${fmt}`);
  }
  return lines.length ? lines : ["👤 אורח/ת"];
}

function urgencyHeadline(category: string, urgency: string): string {
  if (category === "complaint") {
    return urgency === "critical" ? "🔴 תלונה קריטית" : "🟠 תלונה דחופה";
  }
  const categoryHe = CATEGORY_HE[category] ?? "פנייה";
  const urgencyHe = URGENCY_HE[urgency] ?? urgency;
  return `🟡 ${categoryHe} · ${urgencyHe}`;
}

export function composeOritWorkflowAlert(
  thread: OritAlertThread,
  ackDraft: string,
): string {
  const summary = thread.ai_summary?.trim()
    || thread.subject?.trim()
    || "פנייה שדורשת טיפול.";
  const threadLink = buildStaffAppDeepLink({ page: "orit_cs_agent", threadId: thread.id });
  const shortRef = thread.id.slice(0, 8);
  const replyEmail = resolveOritReplyEmail(thread.from_email ?? "", thread.guest_contact_email);

  const ackBlock = truncateForWhapi(ackDraft, 480);

  return [
    "היי אורית 💜",
    "כאן סיגל — תלונה דחופה שממתינה לטיפול שלך.",
    "",
    ...guestContactLines(thread),
    urgencyHeadline(thread.category, thread.urgency),
    "",
    "📋 הבעיה:",
    truncateForWhapi(summary, 320),
    "",
    "שלב 1 — אישור קבלה למייל (בסגנון שלך):",
    "─────────────",
    ackBlock,
    "─────────────",
    "",
    replyEmail
      ? "עני «תראי לי» לראות את המייל המלא · «אשרי» להכנה לשליחה (ואז «כן שלחי» אחרי שתראי את הטקסט)"
      : "⚠ אין מייל אורח תקין — פתחי במערכת לטיפול ידני.",
    "מכתב תשובה מלא מוכין במערכת אחרי שלב זה.",
    "",
    `(קוד פנייה: ${shortRef})`,
    "",
    "👉 לפתיחה ועריכה:",
    threadLink,
  ].join("\n");
}

export function composeOritFullReplyReadyMessage(
  thread: OritAlertThread,
  fullReplyPreview: string,
): string {
  const threadLink = buildStaffAppDeepLink({ page: "orit_cs_agent", threadId: thread.id });
  const guestName = resolveOritReplyName(thread.from_name, thread.guest_contact_name);
  const label = guestName && !guestName.includes("@") ? guestName : "האורח/ת";

  return [
    "היי אורית 💜",
    `✓ אישור הקבלה נשלח ל־${label}.`,
    "ניתן לראות את המייל והשרשור בקישור:",
    threadLink,
    "",
    "שלב 2 — טיוטת תשובה מלאה (תצוגה מקוצרת):",
    "─────────────",
    truncateForWhapi(fullReplyPreview, 400),
    "─────────────",
    "",
    "עני «תשובה מלאה» לראות הכל · «אשרי» לשליחה · או ערכי בקישור.",
  ].join("\n");
}

export function composeSigalGuestReplyCoaching(
  thread: OritAlertThread,
  guestMessage: string,
  followUpDraft: string | null,
): string {
  const guestName = resolveOritReplyName(thread.from_name, thread.guest_contact_name);
  const label = guestName && !guestName.includes("@") ? guestName : "האורח/ת";

  const lines = [
    "היי אורית 💜",
    `📩 ${label} השיב/ה למייל:`,
    "─────────────",
    guestMessage.trim(),
    "─────────────",
    "",
  ];

  if (followUpDraft?.trim()) {
    lines.push(
      "הכנתי לך תשובה מוצעת (בסגנון שלך):",
      "─────────────",
      truncateForWhapi(followUpDraft, 900),
      "─────────────",
      "",
      "עני «תראי לי» לטקסט המלא · «אשרי» להכנה לשליחה · «כן שלחי» אחרי שתאשרי",
      "או הדביקי ניסוח משלך — אעדכן ואציג שוב.",
      "כשהנושא נסגר: «סיימתי».",
      "",
      "רק אם צריך — פתיחה במערכת:",
      buildStaffAppDeepLink({ page: "orit_cs_agent", threadId: thread.id }),
    );
  } else {
    lines.push(
      "עדיין מכינה תשובה — עני «תשובה מלאה» בעוד רגע, או פתחי:",
      buildStaffAppDeepLink({ page: "orit_cs_agent", threadId: thread.id }),
    );
  }

  return lines.join("\n");
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
    .select("id, subject, from_name, from_email, category, urgency, ai_summary, guest_contact_name, guest_contact_phone, guest_contact_email, auto_ack_sent_at, status, is_demo, workflow_step")
    .eq("id", threadId)
    .maybeSingle();

  if (!thread || thread.is_demo) return { sent: false, reason: "no_thread" };
  if (!isOritWorkflowComplaint(thread.category, thread.urgency)) {
    return { sent: false, reason: "not_workflow_complaint" };
  }
  if (thread.status === "handled" || thread.status === "archived") {
    return { sent: false, reason: "closed" };
  }
  if (thread.auto_ack_sent_at) {
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
  if (!ackDraft?.text) {
    return { sent: false, reason: "no_ack_draft" };
  }

  const phone = await resolveOritAlertPhone(supabase, mailbox);
  if (!phone) return { sent: false, reason: "no_phone" };

  const body = composeOritWorkflowAlert(thread as OritAlertThread, ackDraft.text);
  const whapiId = await sendWhapiText(phone, body, { noLinkPreview: true });
  if (!whapiId) return { sent: false, reason: "whapi_failed" };

  const now = new Date().toISOString();
  await supabase.from("orit_agent_threads").update({
    workflow_step: "awaiting_ack_approval",
    orit_decision: "pending",
    orit_decision_prompted_at: now,
  }).eq("id", threadId);

  await supabase.from("orit_agent_alert_log").upsert({
    mailbox_id: mailbox.id,
    thread_id: threadId,
    body_sent: body,
    whapi_message_id: whapiId,
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
  const body = composeSigalGuestReplyCoaching(
    thread as OritAlertThread,
    guestMessage,
    followUp?.text ?? null,
  );

  const sent = await sendWhapiLongText(phone, body);
  if (!sent) return { sent: false, reason: "whapi_failed" };

  const now = new Date().toISOString();
  await supabase.from("orit_agent_threads").update({
    workflow_step: "awaiting_reply_approval",
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
    await sendWhapiText(phoneDigits, "לא מצאתי טיוטת אישור קבלה — פתחי במערכת.", { noLinkPreview: true });
    return true;
  }

  const replyEmail = resolveOritReplyEmail(
    String(pending.thread.from_email ?? ""),
    pending.thread.guest_contact_email as string | null,
  );
  if (!replyEmail) {
    await sendWhapiText(phoneDigits, "❌ אין מייל אורח תקין — פתחי במערכת לטיפול ידני.", { noLinkPreview: true });
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
    `✓ נשלח אישור קבלה ל־${replyEmail}.\nהכנתי את התשובה המלאה — פתחי את הקישור מההודעה הבאה.`,
    { noLinkPreview: true },
  );
  return true;
}

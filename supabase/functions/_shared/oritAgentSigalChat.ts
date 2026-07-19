// Sigal — Orit personal assistant over Whapi (text + voice transcript).
// Full transparency: show exact outbound text → explicit confirm → send.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildStaffAppDeepLink } from "./guestAlertWhapiNotify.ts";
import type { OritMailboxRow } from "./oritAgentMail.ts";
import {
  resolveOritReplyEmail,
  resolveOritReplyName,
} from "./oritGuestContactExtract.ts";
import { isOritCsStaffPhone } from "./oritAgentStaffPhone.ts";
import {
  composeSigalAckSentFollowUp,
  sigalGuestLabel,
} from "./oritSigalBriefing.ts";
import {
  buildOritWaInboxLink,
  composeSigalWaSentFollowUp,
  deliverOritGuestWhatsapp,
  resolveOritOutboundChannel,
} from "./oritGuestOutbound.ts";
import {
  fetchLatestGuestInbound,
  fetchOritDraftText,
  isOritWorkflowComplaint,
  sendOritAckEmail,
  type OritAlertMailbox,
} from "./oritAgentWorkflow.ts";
import { deliverOritThreadEmail } from "./oritAgentSend.ts";
import { closeOritThread } from "./closeOritThread.ts";
import { sendWhapiText } from "./whapiSend.ts";
import {
  SIGAL_GUIDE_ACK,
  SIGAL_GUIDE_CONFIRM,
  SIGAL_GUIDE_FULL,
  SIGAL_GUIDE_HELP,
  SIGAL_INTRO_SUMMARY,
  resolveOritSigalIntent,
} from "./oritSigalGuide.ts";

export type OritChatPending = {
  action: "confirm_ack" | "confirm_full" | "confirm_whatsapp_ack" | "confirm_whatsapp_full";
  body_text: string;
  shown_at: string;
};

const CONFIRM_RE = /^(כן(\s+שלחי)?|שלחי|מאשרת|אישור|אשרי\s*ולשלוח|yes|ok|go|כן תשלחי|בסדר תשלחי|יאללה שלחי)$/i;
const CANCEL_RE = /^(לא|בטלי|עצרי|ביטול|cancel|stop|תעצרי)$/i;

async function sendWhapiLongText(phone: string, text: string): Promise<void> {
  const max = 3400;
  const body = text.trim();
  if (body.length <= max) {
    await sendWhapiText(phone, body, { noLinkPreview: true });
    return;
  }
  const paragraphs = body.split(/\n{2,}/);
  let chunk = "";
  for (const p of paragraphs) {
    const next = chunk ? `${chunk}\n\n${p}` : p;
    if (next.length > max) {
      if (chunk) await sendWhapiText(phone, chunk, { noLinkPreview: true });
      if (p.length > max) {
        for (let i = 0; i < p.length; i += max) {
          await sendWhapiText(phone, p.slice(i, i + max), { noLinkPreview: true });
        }
        chunk = "";
      } else {
        chunk = p;
      }
    } else {
      chunk = next;
    }
  }
  if (chunk) await sendWhapiText(phone, chunk, { noLinkPreview: true });
}

function threadLink(threadId: string): string {
  return buildStaffAppDeepLink({ page: "orit_cs_agent", threadId });
}

/** Complaint high/critical must send ack (step 1) before full reply. Leads/other = single step. */
export function threadNeedsAckBeforeFullReply(thread: Record<string, unknown>): boolean {
  const category = String(thread.category ?? "");
  const urgency = String(thread.urgency ?? "normal");
  const initialSent = Boolean(thread.auto_ack_sent_at || thread.orit_wa_contact_at);
  return isOritWorkflowComplaint(category, urgency) && !initialSent;
}

export function hasOritInitialContactSent(thread: Record<string, unknown>): boolean {
  return Boolean(thread.auto_ack_sent_at || thread.orit_wa_contact_at);
}

function guestLabel(thread: Record<string, unknown>): string {
  const name = resolveOritReplyName(
    thread.from_name as string | null,
    thread.guest_contact_name as string | null,
  );
  if (name && !name.includes("@")) return name;
  const email = resolveOritReplyEmail(
    String(thread.from_email ?? ""),
    thread.guest_contact_email as string | null,
  );
  return email || "האורח/ת";
}

async function findActiveOritThread(
  supabase: SupabaseClient,
): Promise<{ thread: Record<string, unknown>; mailbox: OritMailboxRow } | null> {
  const { data: rows } = await supabase
    .from("orit_agent_threads")
    .select("*, orit_agent_mailbox(*)")
    .eq("is_demo", false)
    .neq("status", "handled")
    .neq("status", "archived")
    .order("updated_at", { ascending: false })
    .limit(12);

  const open = (rows ?? []).filter((row) => {
    const step = row.workflow_step as string | null;
    if (step && [
      "awaiting_ack_approval",
      "awaiting_reply_approval",
      "guest_replied",
      "reply_sent",
      "ack_sent",
    ].includes(step)) return true;
    return row.status === "awaiting_reply";
  });

  const row = open[0];
  if (!row) return null;
  return { thread: row, mailbox: row.orit_agent_mailbox as OritMailboxRow };
}

async function findThreadWithPending(
  supabase: SupabaseClient,
): Promise<{ thread: Record<string, unknown>; mailbox: OritMailboxRow; pending: OritChatPending } | null> {
  const { data: rows } = await supabase
    .from("orit_agent_threads")
    .select("*, orit_agent_mailbox(*)")
    .not("orit_chat_pending", "is", null)
    .order("updated_at", { ascending: false })
    .limit(3);

  for (const row of rows ?? []) {
    const pending = row.orit_chat_pending as OritChatPending | null;
    if (pending?.action && pending.body_text) {
      return { thread: row, mailbox: row.orit_agent_mailbox as OritMailboxRow, pending };
    }
  }
  return null;
}

async function setChatPending(
  supabase: SupabaseClient,
  threadId: string,
  pending: OritChatPending | null,
): Promise<void> {
  await supabase.from("orit_agent_threads").update({
    orit_chat_pending: pending,
  }).eq("id", threadId);
}

async function saveDraftBody(
  supabase: SupabaseClient,
  threadId: string,
  kind: "ack" | "full_reply",
  body: string,
): Promise<void> {
  const { data: existing } = await supabase
    .from("orit_agent_drafts")
    .select("id")
    .eq("thread_id", threadId)
    .eq("draft_kind", kind)
    .in("status", ["suggested", "edited"])
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    await supabase.from("orit_agent_drafts").update({
      suggested_text: body,
      final_text: body,
      status: "edited",
    }).eq("id", existing.id);
  } else {
    await supabase.from("orit_agent_drafts").insert({
      thread_id: threadId,
      draft_kind: kind,
      suggested_text: body,
      final_text: body,
      status: "edited",
    });
  }
}

async function learnFromOutbound(
  supabase: SupabaseClient,
  mailboxId: string,
  threadId: string,
  category: string,
  outbound: string,
  original?: string,
): Promise<void> {
  const { data: msgs } = await supabase
    .from("orit_agent_messages")
    .select("body_text")
    .eq("thread_id", threadId)
    .eq("direction", "inbound")
    .order("received_at", { ascending: true })
    .limit(3);
  const inbound = (msgs ?? []).map((m) => m.body_text).join("\n").slice(0, 300);

  await supabase.from("orit_agent_style_samples").insert({
    mailbox_id: mailboxId,
    context_category: category === "complaint" ? "complaint" : category,
    inbound_snippet: inbound,
    outbound_text: outbound,
  });

  if (original && original.trim() !== outbound.trim()) {
    await supabase.from("orit_agent_style_samples").insert({
      mailbox_id: mailboxId,
      context_category: "complaint_corrected",
      inbound_snippet: inbound,
      outbound_text: outbound,
    });
  }
}

export function composeSigalConfirmPrompt(
  action: OritChatPending["action"],
  guest: string,
  contactLabel: string,
  bodyText: string,
  threadId: string,
): string {
  const viaWa = action === "confirm_whatsapp_ack" || action === "confirm_whatsapp_full";
  const phase = action === "confirm_ack" || action === "confirm_whatsapp_ack"
    ? "אישור קבלה"
    : "תשובה מלאה";
  const dest = viaWa ? "בוואטסאפ" : "במייל";
  return [
    `📨 ${phase} — כך יישלח ל־${guest}${contactLabel ? ` (${contactLabel})` : ""} ${dest} בשמך:`,
    "─────────────",
    bodyText.trim(),
    "─────────────",
    SIGAL_GUIDE_CONFIRM,
    "לעריכה במחשב:",
    threadLink(threadId),
  ].join("\n");
}

export function composeSigalAckSentMessage(
  guest: string,
  _email: string,
  _bodySent: string,
  _threadId: string,
): string {
  return composeSigalAckSentFollowUp(guest);
}

async function prepareAckConfirm(
  supabase: SupabaseClient,
  phone: string,
  thread: Record<string, unknown>,
  mailbox: OritMailboxRow,
  bodyOverride?: string,
): Promise<void> {
  const threadId = String(thread.id);
  const draft = bodyOverride?.trim()
    || (await fetchOritDraftText(supabase, threadId, "ack"))?.text
    || "";

  if (!draft) {
    await sendWhapiText(phone, "אין עדיין טיוטת אישור קבלה — פתחי במערכת או חכי לסנכרון.", { noLinkPreview: true });
    return;
  }

  const channel = resolveOritOutboundChannel(thread as Parameters<typeof resolveOritOutboundChannel>[0]);
  if (channel === "blocked") {
    await sendWhapiText(phone, "⚠ חסרים מייל וטלפון — הוסיפי פרטי קשר במערכת.", { noLinkPreview: true });
    return;
  }

  if (channel === "whatsapp_bridge") {
    await prepareWhatsappConfirm(supabase, phone, thread, "confirm_whatsapp_ack", draft, bodyOverride);
    return;
  }

  const email = resolveOritReplyEmail(
    String(thread.from_email ?? ""),
    thread.guest_contact_email as string | null,
  );
  if (!email) {
    await sendWhapiText(phone, "⚠ אין מייל אורח תקין — אם יש טלפון, עני «שלחי בוואטסאפ».", { noLinkPreview: true });
    return;
  }

  if (bodyOverride) await saveDraftBody(supabase, threadId, "ack", draft);

  await setChatPending(supabase, threadId, {
    action: "confirm_ack",
    body_text: draft,
    shown_at: new Date().toISOString(),
  });

  await sendWhapiLongText(phone, composeSigalConfirmPrompt(
    "confirm_ack",
    guestLabel(thread),
    email,
    draft,
    threadId,
  ));
}

async function prepareWhatsappConfirm(
  supabase: SupabaseClient,
  phone: string,
  thread: Record<string, unknown>,
  action: "confirm_whatsapp_ack" | "confirm_whatsapp_full",
  draft: string,
  bodyOverride?: string,
): Promise<void> {
  const threadId = String(thread.id);
  const channel = resolveOritOutboundChannel(thread as Parameters<typeof resolveOritOutboundChannel>[0]);
  if (channel !== "whatsapp_bridge") {
    await sendWhapiText(phone, "יש מייל — שולחים במייל: «תראי לי» → «כן שלחי».", { noLinkPreview: true });
    return;
  }

  if (bodyOverride) {
    await saveDraftBody(supabase, threadId, action === "confirm_whatsapp_ack" ? "ack" : "full_reply", draft);
  }

  const contact = thread.guest_contact_phone as string;
  await setChatPending(supabase, threadId, {
    action,
    body_text: draft,
    shown_at: new Date().toISOString(),
  });

  await sendWhapiLongText(phone, composeSigalConfirmPrompt(
    action,
    guestLabel(thread),
    contact,
    draft,
    threadId,
  ));
}

async function prepareFullConfirm(
  supabase: SupabaseClient,
  phone: string,
  thread: Record<string, unknown>,
  bodyOverride?: string,
): Promise<void> {
  const threadId = String(thread.id);
  if (threadNeedsAckBeforeFullReply(thread)) {
    const channel = resolveOritOutboundChannel(thread as Parameters<typeof resolveOritOutboundChannel>[0]);
    const hint = channel === "whatsapp_bridge"
      ? "קודם «שלחי בוואטסאפ» לאישור קבלה."
      : "קודם שולחים אישור קבלה. עני «תראי לי».";
    await sendWhapiText(phone, hint, { noLinkPreview: true });
    return;
  }

  const draft = bodyOverride?.trim()
    || (await fetchOritDraftText(supabase, threadId, "full_reply"))?.text
    || "";

  if (!draft) {
    await sendWhapiText(phone, "אין טיוטת תשובה מלאה — פתחי במערכת.", { noLinkPreview: true });
    return;
  }

  const channel = resolveOritOutboundChannel(thread as Parameters<typeof resolveOritOutboundChannel>[0]);
  const email = resolveOritReplyEmail(
    String(thread.from_email ?? ""),
    thread.guest_contact_email as string | null,
  );

  if (channel === "whatsapp_bridge" && !email) {
    await prepareWhatsappConfirm(supabase, phone, thread, "confirm_whatsapp_full", draft, bodyOverride);
    return;
  }

  if (!email) {
    await sendWhapiText(phone, "⚠ אין מייל — «שלחי בוואטסאפ» אם יש טלפון.", { noLinkPreview: true });
    return;
  }

  if (bodyOverride) await saveDraftBody(supabase, threadId, "full_reply", draft);

  await setChatPending(supabase, threadId, {
    action: "confirm_full",
    body_text: draft,
    shown_at: new Date().toISOString(),
  });

  await sendWhapiLongText(phone, composeSigalConfirmPrompt(
    "confirm_full",
    guestLabel(thread),
    email,
    draft,
    threadId,
  ));
}

async function executePendingSend(
  supabase: SupabaseClient,
  phone: string,
  row: { thread: Record<string, unknown>; mailbox: OritMailboxRow; pending: OritChatPending },
): Promise<void> {
  const { thread, mailbox, pending } = row;
  const threadId = String(thread.id);
  const email = resolveOritReplyEmail(
    String(thread.from_email ?? ""),
    thread.guest_contact_email as string | null,
  );
  const guest = guestLabel(thread);
  const originalDraft = pending.action === "confirm_ack" || pending.action === "confirm_whatsapp_ack"
    ? (await fetchOritDraftText(supabase, threadId, "ack"))?.text
    : (await fetchOritDraftText(supabase, threadId, "full_reply"))?.text;

  if (pending.action === "confirm_whatsapp_ack" || pending.action === "confirm_whatsapp_full") {
    const result = await deliverOritGuestWhatsapp(
      supabase,
      thread.guest_contact_phone as string,
      pending.body_text,
      threadId,
    );
    if (!result.sent) {
      await sendWhapiText(phone, `❌ השליחה נכשלה: ${result.error || "שגיאה"}`, { noLinkPreview: true });
      return;
    }

    const sentAt = new Date().toISOString();
    const inboxLink = buildOritWaInboxLink(thread as Parameters<typeof buildOritWaInboxLink>[0]) || "";

    if (pending.action === "confirm_whatsapp_ack") {
      await supabase.from("orit_agent_threads").update({
        orit_wa_contact_at: sentAt,
        orit_decision: "whatsapp",
        orit_decision_at: sentAt,
        workflow_step: "awaiting_reply_approval",
        status: "awaiting_reply",
      }).eq("id", threadId);
      await learnFromOutbound(supabase, mailbox.id, threadId, String(thread.category ?? "complaint"), pending.body_text, originalDraft);
      await setChatPending(supabase, threadId, null);
      await sendWhapiLongText(phone, composeSigalWaSentFollowUp(guest, inboxLink, "ack"));
      return;
    }

    await supabase.from("orit_agent_threads").update({
      full_reply_sent_at: sentAt,
      workflow_step: "reply_sent",
      status: "awaiting_reply",
      orit_chat_pending: null,
    }).eq("id", threadId);
    await learnFromOutbound(supabase, mailbox.id, threadId, String(thread.category ?? "complaint"), pending.body_text, originalDraft);
    await sendWhapiLongText(phone, composeSigalWaSentFollowUp(guest, inboxLink, "full"));
    return;
  }

  if (pending.action === "confirm_ack") {
    const result = await sendOritAckEmail(supabase, mailbox, thread, pending.body_text);
    if (!result.sent) {
      await sendWhapiText(phone, `❌ השליחה נכשלה: ${result.error || "שגיאה"}`, { noLinkPreview: true });
      return;
    }
    await learnFromOutbound(
      supabase,
      mailbox.id,
      threadId,
      String(thread.category ?? "complaint"),
      pending.body_text,
      originalDraft,
    );
    await setChatPending(supabase, threadId, null);

    await supabase.from("orit_agent_threads").update({
      workflow_step: "awaiting_reply_approval",
    }).eq("id", threadId);

    await sendWhapiLongText(phone, composeSigalAckSentFollowUp(guest));
    return;
  }

  const delivery = await deliverOritThreadEmail(
    supabase,
    mailbox,
    {
      id: threadId,
      from_email: String(thread.from_email ?? ""),
      from_name: thread.from_name as string | null,
      guest_contact_email: thread.guest_contact_email as string | null,
      guest_contact_name: thread.guest_contact_name as string | null,
      subject: String(thread.subject ?? ""),
      is_demo: Boolean(thread.is_demo),
    },
    pending.body_text,
    "manual_reply",
  );

  if (!delivery.sent) {
    await sendWhapiText(phone, `❌ השליחה נכשלה: ${delivery.error || "שגיאה"}`, { noLinkPreview: true });
    return;
  }

  const sentAt = new Date().toISOString();
  await supabase.from("orit_agent_threads").update({
    workflow_step: "reply_sent",
    full_reply_sent_at: sentAt,
    status: "awaiting_reply",
    orit_chat_pending: null,
  }).eq("id", threadId);

  await learnFromOutbound(
    supabase,
    mailbox.id,
    threadId,
    String(thread.category ?? "complaint"),
    pending.body_text,
    originalDraft,
  );

  await sendWhapiLongText(phone, [
    `✓ התשובה נשלחה ל־${guest}${email ? ` (${email})` : ""}.`,
    "",
    "אעדכן אותך אם האורח/ת ישיב/ה.",
    "כשהנושא נסגר לגמרי — עני «סיימתי».",
  ].join("\n"));
}

function workflowStatusLine(thread: Record<string, unknown>): string {
  const guest = guestLabel(thread);
  const viaWa = Boolean(thread.orit_wa_contact_at);
  const ack = hasOritInitialContactSent(thread) ? "נשלח ✓" : "עדיין לא נשלח";
  const full = thread.full_reply_sent_at ? "נשלחה ✓" : "ממתינה";
  const step = String(thread.workflow_step ?? "");
  let phase = "בטיפול";
  if (step === "awaiting_ack_approval") {
    phase = viaWa ? "מחכה שתאשרי שליחה בוואטסאפ" : "מחכה שתאשרי את אישור הקבלה";
  } else if (step === "awaiting_reply_approval") phase = "מחכה לתשובה המלאה לאורח/ת";
  else if (step === "guest_replied") phase = "האורח/ת השיב/ה — צריך תשובה שלך";
  else if (step === "reply_sent") phase = "נשלחה תשובה — אפשר לסגור עם «סיימתי»";
  return [
    `👤 ${guest}`,
    `${viaWa ? "וואטסאפ" : "מייל"} — אישור ראשון: ${ack}`,
    `תשובה מלאה: ${full}`,
    phase,
  ].join("\n");
}

async function markThreadClosed(
  supabase: SupabaseClient,
  phone: string,
  thread: Record<string, unknown>,
): Promise<void> {
  const threadId = String(thread.id);
  await closeOritThread(supabase, threadId);

  await sendWhapiText(phone, [
    `✓ סימנתי את פניית ${guestLabel(thread)} כטופלה.`,
    "אעדכן אם יגיע מייל חדש מאותו שרשור.",
  ].join("\n"), { noLinkPreview: true });
}

async function showGuestLatestMessage(
  supabase: SupabaseClient,
  phone: string,
  threadId: string,
): Promise<void> {
  const body = await fetchLatestGuestInbound(supabase, threadId);
  await sendWhapiLongText(phone, body
    ? ["הודעת האורח/ת האחרונה:", "─────────────", body, "─────────────"].join("\n")
    : "אין הודעה נכנסת אחרונה.");
}

function isLikelyCustomDraft(text: string): boolean {
  const t = text.trim();
  return t.length >= 60 && (/שלום|תודה|אורית|בברכה|קיבלנו/i.test(t));
}

export async function handleOritSigalChat(
  supabase: SupabaseClient,
  phoneDigits: string,
  text: string,
  opts: { fromVoice?: boolean } = {},
): Promise<void> {
  const t = (text || "").trim();
  const voicePrefix = opts.fromVoice ? "🎤 " : "";
  const intent = resolveOritSigalIntent(t);

  if (!t) {
    await sendWhapiText(phoneDigits, "לא שמעתי טקסט — נסי שוב או הקליטי הודעה.", { noLinkPreview: true });
    return;
  }

  const pendingRow = await findThreadWithPending(supabase);
  if (pendingRow) {
    if (intent === "confirm_send" || CONFIRM_RE.test(t)) {
      await executePendingSend(supabase, phoneDigits, pendingRow);
      return;
    }
    if (intent === "cancel" || CANCEL_RE.test(t)) {
      await setChatPending(supabase, String(pendingRow.thread.id), null);
      await sendWhapiText(phoneDigits, "בוטל — לא שלחתי כלום.", { noLinkPreview: true });
      return;
    }
    if (isLikelyCustomDraft(t)) {
      const action = pendingRow.pending.action;
      if (action === "confirm_ack" || action === "confirm_whatsapp_ack") {
        if (action === "confirm_whatsapp_ack") {
          await prepareWhatsappConfirm(supabase, phoneDigits, pendingRow.thread, action, t);
        } else {
          await prepareAckConfirm(supabase, phoneDigits, pendingRow.thread, pendingRow.mailbox, t);
        }
      } else if (action === "confirm_whatsapp_full") {
        await prepareWhatsappConfirm(supabase, phoneDigits, pendingRow.thread, action, t);
      } else {
        await prepareFullConfirm(supabase, phoneDigits, pendingRow.thread, t);
      }
      return;
    }
    await sendWhapiText(phoneDigits, [
      "לפני שליחה — ודאי שקראת את הטקסט למעלה.",
      SIGAL_GUIDE_CONFIRM,
    ].join("\n"), { noLinkPreview: true });
    return;
  }

  const active = await findActiveOritThread(supabase);

  if (intent === "mark_done" && active) {
    await markThreadClosed(supabase, phoneDigits, active.thread);
    return;
  }

  if (intent === "status" && active) {
    await sendWhapiText(phoneDigits, workflowStatusLine(active.thread), { noLinkPreview: true });
    return;
  }

  if (intent === "help") {
    await sendWhapiText(phoneDigits, [
      voicePrefix ? `${voicePrefix}${SIGAL_GUIDE_HELP}` : SIGAL_GUIDE_HELP,
      "",
      active ? `פנייה פעילה: ${guestLabel(active.thread)}` : "",
    ].filter(Boolean).join("\n"), { noLinkPreview: true });
    return;
  }

  if (intent === "intro") {
    await sendWhapiText(phoneDigits, [
      voicePrefix ? `${voicePrefix}${SIGAL_INTRO_SUMMARY}` : SIGAL_INTRO_SUMMARY,
      "",
      "לפקודות מלאות — עני «עזרה».",
    ].join("\n"), { noLinkPreview: true });
    return;
  }

  if (intent === "link" && active) {
    await sendWhapiText(phoneDigits, threadLink(String(active.thread.id)), { noLinkPreview: true });
    return;
  }

  if (active) {
    if (intent === "show_guest") {
      await showGuestLatestMessage(supabase, phoneDigits, String(active.thread.id));
      return;
    }

    if (intent === "show_full") {
      await prepareFullConfirm(supabase, phoneDigits, active.thread);
      return;
    }

    if (intent === "show_ack") {
      if (threadNeedsAckBeforeFullReply(active.thread)) {
        const channel = resolveOritOutboundChannel(active.thread as Parameters<typeof resolveOritOutboundChannel>[0]);
        const draft = (await fetchOritDraftText(supabase, String(active.thread.id), "ack"))?.text || "";
        const guide = channel === "whatsapp_bridge"
          ? "«שלחי בוואטסאפ» → «כן שלחי»"
          : SIGAL_GUIDE_ACK;
        await sendWhapiLongText(phoneDigits, draft
          ? [
            channel === "whatsapp_bridge" ? "נוסח לוואטסאפ:" : "נוסח אישור הקבלה:",
            "─────────────",
            draft,
            "─────────────",
            "",
            guide,
          ].join("\n")
          : "אין עדיין נוסח — חכי לסנכרון או עני «קישור» במחשב.");
      } else {
        await prepareFullConfirm(supabase, phoneDigits, active.thread);
      }
      return;
    }

    if (intent === "send_whatsapp") {
      if (threadNeedsAckBeforeFullReply(active.thread)) {
        const draft = (await fetchOritDraftText(supabase, String(active.thread.id), "ack"))?.text || "";
        if (!draft) {
          await sendWhapiText(phoneDigits, "אין עדיין טיוטה — חכי לסנכרון.", { noLinkPreview: true });
          return;
        }
        await prepareWhatsappConfirm(supabase, phoneDigits, active.thread, "confirm_whatsapp_ack", draft);
      } else {
        const draft = (await fetchOritDraftText(supabase, String(active.thread.id), "full_reply"))?.text || "";
        if (!draft) {
          await sendWhapiText(phoneDigits, "אין טיוטת תשובה מלאה.", { noLinkPreview: true });
          return;
        }
        await prepareWhatsappConfirm(supabase, phoneDigits, active.thread, "confirm_whatsapp_full", draft);
      }
      return;
    }

    if (intent === "prepare_ack") {
      if (threadNeedsAckBeforeFullReply(active.thread)) {
        await prepareAckConfirm(supabase, phoneDigits, active.thread, active.mailbox);
      } else {
        await prepareFullConfirm(supabase, phoneDigits, active.thread);
      }
      return;
    }

    if (isLikelyCustomDraft(t)) {
      if (threadNeedsAckBeforeFullReply(active.thread)) {
        await prepareAckConfirm(supabase, phoneDigits, active.thread, active.mailbox, t);
      } else {
        await prepareFullConfirm(supabase, phoneDigits, active.thread, t);
      }
      return;
    }
  }

  if (opts.fromVoice) {
    const snippet = t.length > 100 ? `${t.slice(0, 100)}…` : t;
    await sendWhapiText(phoneDigits, [
      `${voicePrefix}שמעתי: «${snippet}»`,
      "",
      active ? `לגבי ${guestLabel(active.thread)}:` : "",
      SIGAL_GUIDE_ACK,
      "",
      "לא בטוחה? עני «עזרה» — אסביר הכל.",
    ].filter(Boolean).join("\n"), { noLinkPreview: true });
    return;
  }

  await sendWhapiText(phoneDigits, [
    "היי אורית 💜",
    active
      ? [
        `${workflowStatusLine(active.thread)}`,
        "",
        SIGAL_INTRO_SUMMARY,
        "",
        SIGAL_GUIDE_ACK,
        "",
        "עזרה? עני «עזרה».",
      ].join("\n")
      : [SIGAL_INTRO_SUMMARY, "", "אין כרגע פנייה פתוחה. אעדכן כשתגיע תלונה."].join("\n"),
  ].join("\n"), { noLinkPreview: true });
}

export async function tryHandleOritSigalInbound(
  supabase: SupabaseClient,
  phoneDigits: string,
  text: string,
  opts: { fromVoice?: boolean } = {},
): Promise<boolean> {
  if (!(await isOritCsStaffPhone(supabase, phoneDigits))) return false;
  await handleOritSigalChat(supabase, phoneDigits, text, opts);
  return true;
}

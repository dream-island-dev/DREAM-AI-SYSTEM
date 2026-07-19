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
  fetchOritDraftText,
  notifyOritFullReplyReady,
  sendOritAckEmail,
  type OritAlertMailbox,
} from "./oritAgentWorkflow.ts";
import { deliverOritThreadEmail } from "./oritAgentSend.ts";
import { sendWhapiText } from "./whapiSend.ts";

export type OritChatPending = {
  action: "confirm_ack" | "confirm_full";
  body_text: string;
  shown_at: string;
};

const CONFIRM_RE = /^(כן(\s+שלחי)?|שלחי|מאשרת|אישור|אשרי\s*ולשלוח|yes|ok|go)$/i;
const CANCEL_RE = /^(לא|בטלי|עצרי|ביטול|cancel|stop)$/i;
const SHOW_ACK_RE = /(תראי|הציגי|מה\s*הטקסט|אישור\s*קבלה|שלב\s*1|טיוטה)/i;
const SHOW_FULL_RE = /(תשובה\s*מלאה|שלב\s*2|מכתב\s*מלא)/i;
const LINK_RE = /(קישור|פתחי|מערכת|לינק)/i;
const HELP_RE = /(עזרה|מה\s*אפשר|פקודות|help)/i;
const PREPARE_ACK_RE = /^(אשרי|1|מייל|שלחי\s*אישור)/i;

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
    .in("workflow_step", ["awaiting_ack_approval", "awaiting_reply_approval", "guest_replied"])
    .eq("is_demo", false)
    .neq("status", "handled")
    .neq("status", "archived")
    .order("received_at", { ascending: false })
    .limit(5);

  const row = rows?.[0];
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
  action: "confirm_ack" | "confirm_full",
  guest: string,
  email: string,
  bodyText: string,
  threadId: string,
): string {
  const phase = action === "confirm_ack" ? "אישור קבלה" : "תשובה מלאה";
  return [
    `📨 ${phase} — כך יישלח ל־${guest}${email ? ` (${email})` : ""} בשמך:`,
    "─────────────",
    bodyText.trim(),
    "─────────────",
    "עני «כן שלחי» לאישור · «לא» לביטול",
    "או ערכי במערכת:",
    threadLink(threadId),
  ].join("\n");
}

export function composeSigalAckSentMessage(
  guest: string,
  email: string,
  bodySent: string,
  threadId: string,
): string {
  return [
    `✓ נשלח לאורח/ת ${guest}${email ? ` (${email})` : ""}:`,
    "",
    bodySent.trim().slice(0, 1200) + (bodySent.length > 1200 ? "\n[…]" : ""),
    "",
    "לצפייה בשרשור ובהמשך טיפול בנושא:",
    threadLink(threadId),
  ].join("\n");
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

  const email = resolveOritReplyEmail(
    String(thread.from_email ?? ""),
    thread.guest_contact_email as string | null,
  );
  if (!email) {
    await sendWhapiText(phone, "⚠ אין מייל אורח תקין — לא ניתן לשלוח. פתחי במערכת.", { noLinkPreview: true });
    return;
  }

  if (bodyOverride) await saveDraftBody(supabase, threadId, "ack", draft);

  const pending: OritChatPending = {
    action: "confirm_ack",
    body_text: draft,
    shown_at: new Date().toISOString(),
  };
  await setChatPending(supabase, threadId, pending);

  const msg = composeSigalConfirmPrompt(
    "confirm_ack",
    guestLabel(thread),
    email,
    draft,
    threadId,
  );
  await sendWhapiLongText(phone, msg);
}

async function prepareFullConfirm(
  supabase: SupabaseClient,
  phone: string,
  thread: Record<string, unknown>,
  bodyOverride?: string,
): Promise<void> {
  const threadId = String(thread.id);
  if (!thread.auto_ack_sent_at) {
    await sendWhapiText(phone, "קודם צריך לשלוח אישור קבלה (שלב 1). עני «תראי לי» לטיוטה.", { noLinkPreview: true });
    return;
  }

  const draft = bodyOverride?.trim()
    || (await fetchOritDraftText(supabase, threadId, "full_reply"))?.text
    || "";

  if (!draft) {
    await sendWhapiText(phone, "אין טיוטת תשובה מלאה — פתחי במערכת.", { noLinkPreview: true });
    return;
  }

  const email = resolveOritReplyEmail(
    String(thread.from_email ?? ""),
    thread.guest_contact_email as string | null,
  );

  if (bodyOverride) await saveDraftBody(supabase, threadId, "full_reply", draft);

  await setChatPending(supabase, threadId, {
    action: "confirm_full",
    body_text: draft,
    shown_at: new Date().toISOString(),
  });

  await sendWhapiLongText(phone, composeSigalConfirmPrompt(
    "confirm_full",
    guestLabel(thread),
    email || "",
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
  const originalDraft = pending.action === "confirm_ack"
    ? (await fetchOritDraftText(supabase, threadId, "ack"))?.text
    : (await fetchOritDraftText(supabase, threadId, "full_reply"))?.text;

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

    await sendWhapiLongText(phone, composeSigalAckSentMessage(
      guest,
      email || "",
      pending.body_text,
      threadId,
    ));

    const mailboxAlert: OritAlertMailbox = {
      id: mailbox.id,
      digest_whatsapp_phone: mailbox.digest_whatsapp_phone,
      alert_enabled: mailbox.alert_enabled !== false,
      profile_id: mailbox.profile_id,
    };
    await notifyOritFullReplyReady(supabase, mailboxAlert, threadId);
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
    status: "handled",
    handled_at: sentAt,
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
    `✓ התשובה המלאה נשלחה ל־${guest}${email ? ` (${email})` : ""}.`,
    "",
    "לצפייה בשרשור:",
    threadLink(threadId),
  ].join("\n"));
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

  if (!t) {
    await sendWhapiText(phoneDigits, "לא שמעתי טקסט — נסי שוב או הקליטי הודעה קולית.", { noLinkPreview: true });
    return;
  }

  const pendingRow = await findThreadWithPending(supabase);
  if (pendingRow) {
    if (CONFIRM_RE.test(t)) {
      await executePendingSend(supabase, phoneDigits, pendingRow);
      return;
    }
    if (CANCEL_RE.test(t)) {
      await setChatPending(supabase, String(pendingRow.thread.id), null);
      await sendWhapiText(phoneDigits, "בוטל — לא שלחתי כלום. עני «תראי לי» כשתרצי שוב.", { noLinkPreview: true });
      return;
    }
    if (isLikelyCustomDraft(t)) {
      const action = pendingRow.pending.action;
      const threadId = String(pendingRow.thread.id);
      if (action === "confirm_ack") {
        await prepareAckConfirm(supabase, phoneDigits, pendingRow.thread, pendingRow.mailbox, t);
      } else {
        await prepareFullConfirm(supabase, phoneDigits, pendingRow.thread, t);
      }
      return;
    }
  }

  const active = await findActiveOritThread(supabase);

  if (HELP_RE.test(t)) {
    await sendWhapiText(phoneDigits, [
      `${voicePrefix}היי אורית 💜 כאן סיגל.`,
      "",
      "פקודות:",
      "• «תראי לי» — טיוטת אישור קבלה (שלב 1)",
      "• «אשרי» — הכנה לשליחה (תראי טקסט מלא → «כן שלחי»)",
      "• «תשובה מלאה» — טיוטת מכתב מלא (שלב 2)",
      "• «קישור» — פתיחה במערכת",
      "• הקליטי הודעה קולית — אני מבינה ומנסחת",
      "",
      active ? `פנייה פעילה: ${guestLabel(active.thread)}` : "אין פנייה דחופה פתוחה כרגע.",
    ].join("\n"), { noLinkPreview: true });
    return;
  }

  if (LINK_RE.test(t) && active) {
    await sendWhapiText(phoneDigits, threadLink(String(active.thread.id)), { noLinkPreview: true });
    return;
  }

  if (active) {
    if (SHOW_FULL_RE.test(t)) {
      await prepareFullConfirm(supabase, phoneDigits, active.thread);
      return;
    }

    if (SHOW_ACK_RE.test(t)) {
      const draft = (await fetchOritDraftText(supabase, String(active.thread.id), "ack"))?.text || "";
      await sendWhapiLongText(phoneDigits, draft
        ? [`טיוטת אישור קבלה:`, "─────────────", draft, "─────────────", `עני «אשרי» להכנה לשליחה או ערכי:`, threadLink(String(active.thread.id))].join("\n")
        : "אין טיוטה עדיין.");
      return;
    }

    if (PREPARE_ACK_RE.test(t)) {
      await prepareAckConfirm(supabase, phoneDigits, active.thread, active.mailbox);
      return;
    }

    if (isLikelyCustomDraft(t)) {
      if (!active.thread.auto_ack_sent_at) {
        await prepareAckConfirm(supabase, phoneDigits, active.thread, active.mailbox, t);
      } else {
        await prepareFullConfirm(supabase, phoneDigits, active.thread, t);
      }
      return;
    }
  }

  if (opts.fromVoice) {
    await sendWhapiText(phoneDigits, [
      `${voicePrefix}קיבלתי. ${active ? `לגבי ${guestLabel(active.thread)} —` : ""}`,
      "עני «תראי לי» לטיוטה · «אשרי» לשליחה · או הדביקי את הניסוח המלא בהודעה הבאה.",
    ].join(" "), { noLinkPreview: true });
    return;
  }

  await sendWhapiText(phoneDigits, [
    "היי אורית 💜",
    active
      ? `יש פנייה פעילה (${guestLabel(active.thread)}). עני «תראי לי» / «אשרי» / «קישור».`
      : "אין כרגע פנייה דחופה פתוחה. אעדכן כשתגיע תלונה.",
    "עזרה? עני «עזרה».",
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

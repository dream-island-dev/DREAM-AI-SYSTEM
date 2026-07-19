// Orit CS — Sigal asks Orit (Whapi) to choose email ack vs WhatsApp; handles her reply.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildStaffAppDeepLink, phoneDigitsForDeepLink } from "./guestAlertWhapiNotify.ts";
import {
  resolveOritReplyEmail,
  resolveOritReplyName,
} from "./oritGuestContactExtract.ts";
import { trySendAutoAck } from "./oritAgentSend.ts";
import type { OritMailboxRow } from "./oritAgentMail.ts";
import {
  resolveOritAlertPhone,
  type OritAlertMailbox,
  type OritAlertThread,
  CATEGORY_HE,
  URGENCY_HE,
} from "./oritAgentWhapiAlert.ts";
import { sendWhapiText } from "./whapiSend.ts";
import { isOritCsStaffPhone } from "./oritAgentStaffPhone.ts";

export type OritDecisionChoice = "email_ack" | "whatsapp" | "manual";

function guestLabel(thread: OritAlertThread): string {
  const name = resolveOritReplyName(thread.from_name, thread.guest_contact_name);
  if (name && !name.includes("@")) return name;
  const phone = (thread.guest_contact_phone ?? "").replace(/\D/g, "");
  if (phone.startsWith("972") && phone.length >= 11) {
    return `0${phone.slice(3, 5)}-${phone.slice(5, 8)}-${phone.slice(8)}`;
  }
  if (phone.startsWith("05") && phone.length === 10) {
    return `${phone.slice(0, 3)}-${phone.slice(3, 6)}-${phone.slice(6)}`;
  }
  const email = resolveOritReplyEmail(thread.from_email ?? "", thread.guest_contact_email);
  if (email) return email;
  return "אורח/ת";
}

function guestContactBlock(thread: OritAlertThread): string[] {
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
  return lines.length ? lines : [`👤 ${guestLabel(thread)}`];
}

function categoryHeadline(category: string, urgency: string): string {
  const categoryHe = CATEGORY_HE[category] ?? "פנייה";
  const urgencyHe = URGENCY_HE[urgency] ?? urgency;
  if (category === "complaint") return `🔴 תלונה · ${urgencyHe}`;
  if (urgency === "critical" || urgency === "high") return `🟠 ${categoryHe} · ${urgencyHe}`;
  return `🟡 ${categoryHe} · ${urgencyHe}`;
}

export function composeOritThreadDecisionPrompt(thread: OritAlertThread): string {
  const summary = thread.ai_summary?.trim()
    || thread.subject?.trim()
    || "פנייה חדשה שממתינה לטיפול.";
  const threadLink = buildStaffAppDeepLink({ page: "orit_cs_agent", threadId: thread.id });
  const replyEmail = resolveOritReplyEmail(thread.from_email ?? "", thread.guest_contact_email);
  const hasPhone = Boolean((thread.guest_contact_phone ?? "").replace(/\D/g, ""));
  const shortRef = thread.id.slice(0, 8);

  const emailOption = replyEmail
    ? "📧 1 — שלחי לאורח/ת מייל «קיבלנו את בקשתך, נחזור אלייך בהקדם»"
    : "📧 1 — אין מייל אורח תקין (לא ניתן לשלוח אישור במייל)";

  const waOption = hasPhone
    ? "💬 2 — אני מתכתבת איתו/ה בוואטסאפ עכשיו"
    : "💬 2 — אין טלפון בפנייה (רק מייל/מערכת)";

  return [
    "היי אורית 💜",
    "כאן סיגל — יש פנייה חדשה בתיבת השירות.",
    "",
    ...guestContactBlock(thread),
    categoryHeadline(thread.category, thread.urgency),
    "",
    summary,
    "",
    "איך תרצי לטפל?",
    "",
    emailOption,
    waOption,
    "",
    `עני «1» או «מייל» · «2» או «וואטסאפ»`,
    `(קוד פנייה: ${shortRef})`,
    "",
    "👉 לפתיחה במערכת:",
    threadLink,
  ].join("\n");
}

export async function notifyOritThreadDecisionPrompt(
  supabase: SupabaseClient,
  mailbox: OritAlertMailbox,
  threadId: string,
  opts: { force?: boolean } = {},
): Promise<{ sent: boolean; reason?: string; whapiMessageId?: string | null }> {
  if (mailbox.alert_enabled === false) {
    return { sent: false, reason: "alert_disabled" };
  }

  const { data: thread } = await supabase
    .from("orit_agent_threads")
    .select("id, subject, from_name, from_email, category, urgency, ai_summary, guest_contact_name, guest_contact_phone, guest_contact_email, auto_ack_sent_at, status, is_demo, orit_decision, orit_decision_prompted_at")
    .eq("id", threadId)
    .maybeSingle();

  if (!thread || thread.is_demo) return { sent: false, reason: "no_thread" };
  if (thread.category !== "complaint") {
    return { sent: false, reason: "not_complaint" };
  }
  if (thread.status === "handled" || thread.status === "archived") {
    return { sent: false, reason: "closed" };
  }

  if (!opts.force) {
    if (thread.orit_decision && thread.orit_decision !== "pending") {
      return { sent: false, reason: "already_decided" };
    }
    const { data: existing } = await supabase
      .from("orit_agent_alert_log")
      .select("id, sent_at")
      .eq("thread_id", threadId)
      .maybeSingle();
    if (existing?.sent_at) {
      const { data: latestInbound } = await supabase
        .from("orit_agent_messages")
        .select("received_at")
        .eq("thread_id", threadId)
        .eq("direction", "inbound")
        .order("received_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const latestAt = latestInbound?.received_at
        ? new Date(latestInbound.received_at).getTime()
        : 0;
      const sentAt = new Date(existing.sent_at).getTime();
      if (!latestAt || latestAt <= sentAt) {
        return { sent: false, reason: "already_sent" };
      }
    }
  }

  const phone = await resolveOritAlertPhone(supabase, mailbox);
  if (!phone) return { sent: false, reason: "no_phone" };

  const body = composeOritThreadDecisionPrompt(thread as OritAlertThread);
  const whapiId = await sendWhapiText(phone, body, { noLinkPreview: true });
  if (!whapiId) return { sent: false, reason: "whapi_failed" };

  const now = new Date().toISOString();
  await supabase.from("orit_agent_threads").update({
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

  return { sent: true, whapiMessageId: whapiId };
}

export function parseOritCsDecisionReply(text: string): OritDecisionChoice | null {
  const t = (text || "").trim().toLowerCase();
  if (!t) return null;

  if (/^(1|מייל|אימייל|email|מיילים)$/.test(t)) return "email_ack";
  if (/^(2|וואטסאפ|whatsapp|ווטסאפ|צ׳אט|צאט|chat)$/.test(t)) return "whatsapp";
  if (/^(3|ידני|במערכת|לא|דלג|skip|manual)$/.test(t)) return "manual";

  if (/\bמייל\b/.test(t) && !/\bוואטסאפ\b/.test(t) && !/\bwhatsapp\b/.test(t)) return "email_ack";
  if (/\b(וואטסאפ|whatsapp|ווטסאפ)\b/.test(t)) return "whatsapp";

  return null;
}

function extractThreadRefFromText(text: string): string | null {
  const m = text.match(/(?:קוד פנייה|ref|#)\s*[:.]?\s*([a-f0-9]{8})/i);
  return m?.[1]?.toLowerCase() ?? null;
}

async function findPendingThreadForOrit(
  supabase: SupabaseClient,
  threadRef: string | null,
): Promise<{ thread: Record<string, unknown>; mailbox: OritMailboxRow } | null> {
  if (threadRef) {
    const { data: rows } = await supabase
      .from("orit_agent_threads")
      .select("*, orit_agent_mailbox(*)")
      .eq("orit_decision", "pending")
      .order("orit_decision_prompted_at", { ascending: false })
      .limit(50);

    for (const row of rows ?? []) {
      if (String(row.id).toLowerCase().startsWith(threadRef)) {
        return { thread: row, mailbox: row.orit_agent_mailbox as OritMailboxRow };
      }
    }
  }

  const { data: row } = await supabase
    .from("orit_agent_threads")
    .select("*, orit_agent_mailbox(*)")
    .eq("orit_decision", "pending")
    .order("orit_decision_prompted_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!row) return null;
  return { thread: row, mailbox: row.orit_agent_mailbox as OritMailboxRow };
}

async function executeOritDecision(
  supabase: SupabaseClient,
  mailbox: OritMailboxRow,
  thread: Record<string, unknown>,
  choice: OritDecisionChoice,
): Promise<{ ok: boolean; message: string }> {
  const threadId = String(thread.id);
  const now = new Date().toISOString();
  const guestName = resolveOritReplyName(
    thread.from_name as string | null,
    thread.guest_contact_name as string | null,
  );
  const replyEmail = resolveOritReplyEmail(
    String(thread.from_email ?? ""),
    thread.guest_contact_email as string | null,
  );
  const guestPhone = (thread.guest_contact_phone as string | null) ?? "";

  if (choice === "email_ack") {
    if (!replyEmail) {
      return {
        ok: false,
        message: "❌ אין מייל אורח תקין בפנייה — לא שלחתי מייל. עני «2» לוואטסאפ או פתחי במערכת.",
      };
    }
    if (thread.auto_ack_sent_at) {
      await supabase.from("orit_agent_threads").update({
        orit_decision: "email_ack",
        orit_decision_at: now,
      }).eq("id", threadId);
      return { ok: true, message: `✓ אישור קבלה כבר נשלח ל־${replyEmail}` };
    }

    const sent = await trySendAutoAck(supabase, mailbox, {
      id: threadId,
      from_email: String(thread.from_email ?? ""),
      from_name: thread.from_name as string | null,
      guest_contact_email: thread.guest_contact_email as string | null,
      guest_contact_name: thread.guest_contact_name as string | null,
      subject: String(thread.subject ?? ""),
      is_demo: Boolean(thread.is_demo),
      auto_ack_sent_at: thread.auto_ack_sent_at as string | null,
    });

    if (!sent) {
      return {
        ok: false,
        message: "❌ שליחת המייל נכשלה (תיבה read-only או שגיאת Graph). נסי מהמערכת.",
      };
    }

    await supabase.from("orit_agent_threads").update({
      orit_decision: "email_ack",
      orit_decision_at: now,
    }).eq("id", threadId);

    return {
      ok: true,
      message: `✓ נשלח לאורח/ת ${replyEmail}:\n«קיבלנו את בקשתך, נחזור אלייך בהקדם»`,
    };
  }

  if (choice === "whatsapp") {
    const digits = phoneDigitsForDeepLink(guestPhone);
    if (!digits) {
      return {
        ok: false,
        message: "❌ אין טלפון אורח בפנייה. עני «1» למייל או פתחי במערכת.",
      };
    }

    await supabase.from("orit_agent_threads").update({
      orit_decision: "whatsapp",
      orit_decision_at: now,
    }).eq("id", threadId);

    const inboxLink = buildStaffAppDeepLink({
      page: "wa_inbox",
      phone: digits,
      guestName: guestName && !guestName.includes("@") ? guestName : undefined,
    });
    const label = guestName && !guestName.includes("@") ? guestName : digits;

    return {
      ok: true,
      message: [
        `✓ מעולה — מתכתבת עם ${label} בוואטסאפ.`,
        "",
        "👉 לחצי לפתיחת השיחה באינבוקס:",
        inboxLink,
      ].join("\n"),
    };
  }

  await supabase.from("orit_agent_threads").update({
    orit_decision: "manual",
    orit_decision_at: now,
  }).eq("id", threadId);

  const threadLink = buildStaffAppDeepLink({ page: "orit_cs_agent", threadId });
  return {
    ok: true,
    message: `✓ בסדר — לא שלחתי מייל אוטומטי. טפלי ידנית במערכת:\n${threadLink}`,
  };
}

export async function tryHandleOritCsWhapiReply(
  supabase: SupabaseClient,
  phoneDigits: string,
  text: string,
  opts: { fromVoice?: boolean } = {},
): Promise<boolean> {
  if (!(await isOritCsStaffPhone(supabase, phoneDigits))) return false;
  const { tryHandleOritSigalInbound } = await import("./oritAgentSigalChat.ts");
  return tryHandleOritSigalInbound(supabase, phoneDigits, text, opts);
}

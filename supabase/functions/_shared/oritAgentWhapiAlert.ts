// Sigal → Orit urgent Whapi DM when a classified email needs attention.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildStaffAppDeepLink } from "./guestAlertWhapiNotify.ts";
import { sendWhapiText } from "./whapiSend.ts";

export type OritAlertMailbox = {
  id: string;
  digest_whatsapp_phone?: string | null;
  alert_enabled?: boolean | null;
  profile_id?: string | null;
};

export type OritAlertThread = {
  id: string;
  subject: string;
  from_name: string | null;
  from_email?: string | null;
  category: string;
  urgency: string;
  ai_summary: string | null;
  guest_contact_name?: string | null;
  status?: string;
  is_demo?: boolean;
};

const CATEGORY_HE: Record<string, string> = {
  complaint: "תלונה",
  lead: "ליד",
  booking: "הזמנה",
  spa: "ספא",
  vendor: "ספק",
  internal: "פנימי",
  other: "פנייה",
};

const URGENCY_HE: Record<string, string> = {
  critical: "קריטי",
  high: "דחוף",
  normal: "רגיל",
  low: "נמוך",
};

export function isOritThreadAlertWorthy(category: string, urgency: string): boolean {
  if (category === "complaint") return true;
  if (urgency === "critical" || urgency === "high") return true;
  return false;
}

function guestLabel(thread: OritAlertThread): string {
  const name = thread.guest_contact_name?.trim() || thread.from_name?.trim();
  if (name && !name.includes("@")) return name;
  if (thread.from_email?.trim()) return thread.from_email.trim();
  return "אורח";
}

function urgencyEmoji(urgency: string): string {
  if (urgency === "critical") return "🔴";
  if (urgency === "high") return "🟠";
  return "🟡";
}

export function composeOritUrgentAlert(thread: OritAlertThread): string {
  const categoryHe = CATEGORY_HE[thread.category] ?? "פנייה";
  const urgencyHe = URGENCY_HE[thread.urgency] ?? thread.urgency;
  const summary = thread.ai_summary?.trim()
    || thread.subject?.trim()
    || "(ללא סיכום)";
  const link = buildStaffAppDeepLink({ page: "orit_cs_agent", threadId: thread.id });

  return [
    "📧 סיגל — דחוף לאורית",
    "",
    `${urgencyEmoji(thread.urgency)} ${categoryHe} · ${urgencyHe}`,
    guestLabel(thread),
    "",
    summary,
    "",
    "▶️ לטיפול:",
    link,
  ].join("\n");
}

export async function resolveOritAlertPhone(
  supabase: SupabaseClient,
  mailbox: OritAlertMailbox,
): Promise<string | null> {
  const fromMailbox = (mailbox.digest_whatsapp_phone ?? "").replace(/\D/g, "");
  if (fromMailbox) return fromMailbox;

  if (mailbox.profile_id) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("phone")
      .eq("id", mailbox.profile_id)
      .maybeSingle();
    const fromProfile = (profile?.phone ?? "").replace(/\D/g, "");
    if (fromProfile) return fromProfile;
  }
  return null;
}

export async function notifyOritUrgentThread(
  supabase: SupabaseClient,
  mailbox: OritAlertMailbox,
  threadId: string,
  opts: { force?: boolean } = {},
): Promise<{ sent: boolean; reason?: string; whapiMessageId?: string | null }> {
  if (mailbox.alert_enabled === false) {
    return { sent: false, reason: "alert_disabled" };
  }

  if (!opts.force) {
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
    } else if (existing) {
      return { sent: false, reason: "already_sent" };
    }
  }

  const { data: thread } = await supabase
    .from("orit_agent_threads")
    .select("id, subject, from_name, from_email, category, urgency, ai_summary, guest_contact_name, status, is_demo")
    .eq("id", threadId)
    .maybeSingle();

  if (!thread || thread.is_demo) return { sent: false, reason: "no_thread" };
  if (thread.status === "handled" || thread.status === "archived") {
    return { sent: false, reason: "closed" };
  }
  if (!opts.force && !isOritThreadAlertWorthy(thread.category, thread.urgency)) {
    return { sent: false, reason: "not_worthy" };
  }

  const phone = await resolveOritAlertPhone(supabase, mailbox);
  if (!phone) return { sent: false, reason: "no_phone" };

  const body = composeOritUrgentAlert(thread as OritAlertThread);
  const whapiId = await sendWhapiText(phone, body, { noLinkPreview: true });
  if (!whapiId) return { sent: false, reason: "whapi_failed" };

  await supabase.from("orit_agent_alert_log").upsert({
    mailbox_id: mailbox.id,
    thread_id: threadId,
    body_sent: body,
    whapi_message_id: whapiId,
    sent_at: new Date().toISOString(),
  }, { onConflict: "thread_id" });

  return { sent: true, whapiMessageId: whapiId };
}

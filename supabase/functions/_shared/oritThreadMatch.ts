// Match inbound mail to existing Orit CS threads (Graph conversationId + fallbacks).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { InboundMailMessage } from "./mailProvider.ts";
import {
  isRelayOrSystemEmail,
  resolveOritReplyEmail,
} from "./oritGuestContactExtract.ts";
import { isOritThreadClosed } from "./closeOritThread.ts";

export type OritThreadMatchRow = {
  id: string;
  status: string | null;
  sla_deadline_at: string | null;
  ai_analyzed_at: string | null;
  handled_at: string | null;
  category?: string | null;
  urgency?: string | null;
  subject?: string | null;
  from_email?: string | null;
  guest_contact_email?: string | null;
  auto_ack_sent_at?: string | null;
  workflow_step?: string | null;
};

export function normalizeOritSubject(subject: string): string {
  return (subject || "")
    .replace(/^(re|fwd?|fw):\s*/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function inboundGuestEmail(msg: InboundMailMessage): string {
  const from = (msg.fromEmail || "").trim().toLowerCase();
  if (from && !isRelayOrSystemEmail(from)) return from;
  return "";
}

export function threadGuestEmails(thread: Pick<OritThreadMatchRow, "from_email" | "guest_contact_email">): string[] {
  const emails = new Set<string>();
  for (const raw of [thread.guest_contact_email, thread.from_email]) {
    const e = (raw || "").trim().toLowerCase();
    if (e && !isRelayOrSystemEmail(e)) emails.add(e);
  }
  return [...emails];
}

export function subjectsLikelySame(a: string, b: string): boolean {
  const na = normalizeOritSubject(a);
  const nb = normalizeOritSubject(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  return false;
}

export function isRealGraphMessageId(id: string | null | undefined): boolean {
  const v = (id || "").trim();
  if (!v) return false;
  if (v.startsWith("sent-")) return false;
  if (v.startsWith("demo-")) return false;
  if (v.startsWith("outbound-")) return false;
  return true;
}

/** Fallback: same guest email + similar subject on recent open/recently-closed threads. */
export async function findOritThreadByFallback(
  supabase: SupabaseClient,
  mailboxId: string,
  msg: InboundMailMessage,
): Promise<OritThreadMatchRow | null> {
  const guestEmail = inboundGuestEmail(msg);
  if (!guestEmail) return null;

  const normSubject = normalizeOritSubject(msg.subject);
  if (!normSubject) return null;

  const since = new Date(Date.now() - 45 * 24 * 3_600_000).toISOString();

  const { data: byGuest } = await supabase
    .from("orit_agent_threads")
    .select("id, status, sla_deadline_at, ai_analyzed_at, handled_at, category, urgency, subject, from_email, guest_contact_email, auto_ack_sent_at, workflow_step, received_at")
    .eq("mailbox_id", mailboxId)
    .eq("is_demo", false)
    .gte("received_at", since)
    .or(`guest_contact_email.eq.${guestEmail},from_email.eq.${guestEmail}`)
    .order("received_at", { ascending: false })
    .limit(12);

  for (const row of byGuest ?? []) {
    if (subjectsLikelySame(row.subject || "", msg.subject)) {
      return row as OritThreadMatchRow;
    }
  }

  const replyTarget = resolveOritReplyEmail(msg.fromEmail, null);
  if (replyTarget && replyTarget !== guestEmail) {
    const { data: alt } = await supabase
      .from("orit_agent_threads")
      .select("id, status, sla_deadline_at, ai_analyzed_at, handled_at, category, urgency, subject, from_email, guest_contact_email, auto_ack_sent_at, workflow_step, received_at")
      .eq("mailbox_id", mailboxId)
      .eq("is_demo", false)
      .gte("received_at", since)
      .or(`guest_contact_email.eq.${replyTarget},from_email.eq.${replyTarget}`)
      .order("received_at", { ascending: false })
      .limit(8);

    for (const row of alt ?? []) {
      if (subjectsLikelySame(row.subject || "", msg.subject)) {
        return row as OritThreadMatchRow;
      }
    }
  }

  return null;
}

export async function findOritThreadForInbound(
  supabase: SupabaseClient,
  mailboxId: string,
  msg: InboundMailMessage,
): Promise<{ thread: OritThreadMatchRow | null; matchedBy: "conversation" | "fallback" | null }> {
  const { data: byKey } = await supabase
    .from("orit_agent_threads")
    .select("id, status, sla_deadline_at, ai_analyzed_at, handled_at, category, urgency, subject, from_email, guest_contact_email, auto_ack_sent_at, workflow_step")
    .eq("mailbox_id", mailboxId)
    .eq("external_thread_key", msg.threadKey)
    .maybeSingle();

  if (byKey) {
    return { thread: byKey as OritThreadMatchRow, matchedBy: "conversation" };
  }

  const fallback = await findOritThreadByFallback(supabase, mailboxId, msg);
  if (fallback) {
    return { thread: fallback, matchedBy: "fallback" };
  }

  return { thread: null, matchedBy: null };
}

export function wasThreadClosed(thread: OritThreadMatchRow | null): boolean {
  return isOritThreadClosed(thread);
}

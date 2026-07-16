// Outbound email delivery for Orit CS Agent (Microsoft Graph).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveGraphAccessToken, sendGraphReply } from "./microsoftGraph.ts";
import {
  renderAutoAckTemplate,
  shouldAutoAckInbound,
  type OritMailboxRow,
} from "./oritAgentMail.ts";

export type OritThreadSendTarget = {
  id: string;
  from_email: string;
  from_name: string | null;
  subject: string;
  is_demo: boolean;
};

export async function deliverOritThreadEmail(
  supabase: SupabaseClient,
  mailbox: OritMailboxRow,
  thread: OritThreadSendTarget,
  bodyText: string,
  messageKind: "manual_reply" | "auto_ack",
): Promise<{ sent: boolean; error?: string; externalKey?: string }> {
  const finalText = bodyText.trim();
  if (!finalText) return { sent: false, error: "empty_body" };

  const sentAt = new Date().toISOString();

  if (thread.is_demo) {
    await supabase.from("orit_agent_messages").insert({
      thread_id: thread.id,
      external_key: `demo-${messageKind}-${sentAt}`,
      direction: "outbound",
      body_text: finalText,
      received_at: sentAt,
      message_kind: messageKind,
    });
    return { sent: true, externalKey: `demo-${messageKind}-${sentAt}` };
  }

  if (mailbox.read_only_mode !== false) {
    return { sent: false, error: "read_only_mode" };
  }

  if (mailbox.provider !== "microsoft" || !mailbox.oauth_refresh_token) {
    return { sent: false, error: "mailbox_not_sendable" };
  }

  try {
    const accessToken = await resolveGraphAccessToken(mailbox, async (next) => {
      await supabase.from("orit_agent_mailbox").update({
        oauth_refresh_token: next.refreshToken ?? mailbox.oauth_refresh_token,
        token_expires_at: next.expiresAt,
      }).eq("id", mailbox.id);
    });

    const externalKey = await sendGraphReply(accessToken, {
      toEmail: thread.from_email,
      toName: thread.from_name,
      subject: thread.subject,
      bodyText: finalText,
    });

    const key = externalKey || `outbound-${messageKind}-${sentAt}`;

    await supabase.from("orit_agent_messages").insert({
      thread_id: thread.id,
      external_key: key,
      graph_message_id: externalKey,
      direction: "outbound",
      body_text: finalText,
      received_at: sentAt,
      message_kind: messageKind,
    });

    return { sent: true, externalKey: key };
  } catch (e) {
    console.error("[oritAgentSend] graph send failed:", (e as Error).message);
    return { sent: false, error: (e as Error).message };
  }
}

export async function trySendAutoAck(
  supabase: SupabaseClient,
  mailbox: OritMailboxRow,
  thread: OritThreadSendTarget & { auto_ack_sent_at?: string | null },
): Promise<boolean> {
  if (!mailbox.auto_ack_enabled) return false;
  if (thread.auto_ack_sent_at) return false;
  if (!shouldAutoAckInbound(thread.from_email, thread.is_demo, thread.subject)) return false;

  const body = renderAutoAckTemplate(
    mailbox.auto_ack_template,
    thread.from_name || "",
    thread.subject,
  );

  const result = await deliverOritThreadEmail(supabase, mailbox, thread, body, "auto_ack");
  if (!result.sent) {
    console.warn("[oritAgentSend] auto-ack skipped:", result.error);
    return false;
  }

  const sentAt = new Date().toISOString();
  await supabase.from("orit_agent_threads").update({ auto_ack_sent_at: sentAt }).eq("id", thread.id);
  await supabase.from("orit_agent_auto_ack_log").upsert({
    thread_id: thread.id,
    sent_at: sentAt,
    body_preview: body.slice(0, 300),
    graph_message_id: result.externalKey ?? null,
  }, { onConflict: "thread_id" });

  return true;
}

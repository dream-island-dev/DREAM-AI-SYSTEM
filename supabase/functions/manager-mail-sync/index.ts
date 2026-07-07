import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  computeSlaDeadline,
  managerMailEnabled,
  renderAutoAckTemplate,
  shouldAutoAckInbound,
  stripHtmlToText,
  type OritMailboxRow,
} from "../_shared/oritAgentMail.ts";
import { analyzeOritThread } from "../_shared/oritAgentAi.ts";
import {
  fetchRecentInboxMessages,
  resolveGraphAccessToken,
  sendGraphReply,
} from "../_shared/microsoftGraph.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function runAutoAck(
  supabase: ReturnType<typeof createClient>,
  mailbox: OritMailboxRow,
  threadId: string,
  accessToken: string,
): Promise<void> {
  const { data: thread } = await supabase
    .from("orit_agent_threads")
    .select("*")
    .eq("id", threadId)
    .maybeSingle();
  if (!thread || thread.auto_ack_sent_at || thread.is_demo) return;
  if (!mailbox.auto_ack_enabled) return;
  if (!shouldAutoAckInbound(thread.from_email, thread.is_demo)) return;

  const { data: existingAck } = await supabase
    .from("orit_agent_auto_ack_log")
    .select("id")
    .eq("thread_id", threadId)
    .maybeSingle();
  if (existingAck) return;

  const bodyText = renderAutoAckTemplate(
    mailbox.auto_ack_template,
    thread.from_name || "",
    thread.subject || "",
  );

  const graphId = await sendGraphReply(accessToken, {
    toEmail: thread.from_email,
    toName: thread.from_name,
    subject: thread.subject || "פנייתך",
    bodyText,
  });

  const sentAt = new Date().toISOString();
  const slaDeadline = computeSlaDeadline(thread.received_at, mailbox.sla_hours);

  await supabase.from("orit_agent_threads").update({
    auto_ack_sent_at: sentAt,
    sla_deadline_at: slaDeadline,
  }).eq("id", threadId);

  await supabase.from("orit_agent_auto_ack_log").insert({
    thread_id: threadId,
    sent_at: sentAt,
    graph_message_id: graphId,
    body_preview: bodyText.slice(0, 500),
  });

  await supabase.from("orit_agent_messages").insert({
    thread_id: threadId,
    external_key: `auto-ack-${threadId}`,
    direction: "outbound",
    body_text: bodyText,
    received_at: sentAt,
    message_kind: "auto_ack",
    graph_message_id: graphId,
  });
}

async function analyzeThread(
  supabase: ReturnType<typeof createClient>,
  mailboxId: string,
  threadId: string,
): Promise<void> {
  const { data: thread } = await supabase
    .from("orit_agent_threads")
    .select("*")
    .eq("id", threadId)
    .maybeSingle();
  if (!thread) return;

  const { data: msgs } = await supabase
    .from("orit_agent_messages")
    .select("body_text, direction")
    .eq("thread_id", threadId)
    .order("received_at", { ascending: true });

  const inbound = (msgs ?? []).filter((m) => m.direction === "inbound").map((m) => m.body_text).join("\n");

  const { data: samples } = await supabase
    .from("orit_agent_style_samples")
    .select("inbound_snippet, outbound_text, context_category")
    .eq("mailbox_id", mailboxId)
    .order("created_at", { ascending: false })
    .limit(8);

  const analysis = await analyzeOritThread({
    subject: thread.subject,
    fromName: thread.from_name,
    fromEmail: thread.from_email,
    bodyText: inbound || thread.snippet || "",
    styleSamples: samples ?? [],
  });

  await supabase.from("orit_agent_threads").update({
    urgency: analysis.urgency,
    urgency_reason: analysis.urgency_reason,
    category: analysis.category,
    ai_summary: analysis.summary,
    ai_analyzed_at: new Date().toISOString(),
  }).eq("id", threadId);

  if (analysis.suggestions.length) {
    await supabase.from("orit_agent_drafts").insert(
      analysis.suggestions.map((text) => ({
        thread_id: threadId,
        suggested_text: text,
        status: "suggested",
      })),
    );
  }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    if (!managerMailEnabled()) {
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: "MANAGER_MAIL_ENABLED=false" }), {
        status: 200,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: mailboxes } = await supabase
      .from("orit_agent_mailbox")
      .select("*")
      .eq("connection_status", "active");

    let synced = 0;
    for (const mailbox of mailboxes ?? []) {
      try {
        const accessToken = await resolveGraphAccessToken(mailbox as OritMailboxRow, async (next) => {
          await supabase.from("orit_agent_mailbox").update({
            oauth_refresh_token: next.refreshToken ?? mailbox.oauth_refresh_token,
            token_expires_at: next.expiresAt,
          }).eq("id", mailbox.id);
        });

        const messages = await fetchRecentInboxMessages(accessToken, 30);
        for (const msg of messages) {
          const fromEmail = msg.from?.emailAddress?.address ?? "";
          const fromName = msg.from?.emailAddress?.name ?? null;
          const subject = msg.subject ?? "";
          const receivedAt = msg.receivedDateTime ?? new Date().toISOString();
          const bodyText = msg.body?.contentType === "html"
            ? stripHtmlToText(msg.body?.content ?? "")
            : (msg.body?.content ?? msg.bodyPreview ?? "");
          const threadKey = msg.conversationId || msg.id;
          if (!threadKey || !fromEmail) continue;

          const { data: threadRow, error: threadErr } = await supabase
            .from("orit_agent_threads")
            .upsert({
              mailbox_id: mailbox.id,
              external_thread_key: threadKey,
              graph_conversation_id: msg.conversationId ?? null,
              subject,
              from_email: fromEmail,
              from_name: fromName,
              received_at: receivedAt,
              snippet: (msg.bodyPreview ?? bodyText).slice(0, 500),
              status: "awaiting_reply",
              is_demo: false,
            }, { onConflict: "mailbox_id,external_thread_key" })
            .select("*")
            .maybeSingle();

          if (threadErr || !threadRow) continue;

          const { error: msgErr } = await supabase.from("orit_agent_messages").upsert({
            thread_id: threadRow.id,
            external_key: msg.id,
            graph_message_id: msg.id,
            direction: "inbound",
            body_text: bodyText.slice(0, 8000),
            received_at: receivedAt,
            message_kind: "email",
          }, { onConflict: "thread_id,external_key" });
          if (msgErr) continue;

          synced += 1;

          try {
            await runAutoAck(supabase, mailbox as OritMailboxRow, threadRow.id, accessToken);
          } catch (ackErr) {
            console.warn("[manager-mail-sync] auto-ack failed:", (ackErr as Error).message);
          }

          try {
            await analyzeThread(supabase, mailbox.id, threadRow.id);
          } catch (aiErr) {
            console.warn("[manager-mail-sync] analyze failed:", (aiErr as Error).message);
          }
        }

        await supabase.from("orit_agent_mailbox").update({
          last_sync_at: new Date().toISOString(),
          connection_error: null,
        }).eq("id", mailbox.id);
      } catch (mbErr) {
        console.error("[manager-mail-sync] mailbox failed:", mailbox.id, mbErr);
        await supabase.from("orit_agent_mailbox").update({
          connection_status: "error",
          connection_error: (mbErr as Error).message.slice(0, 500),
        }).eq("id", mailbox.id);
      }
    }

    return new Response(JSON.stringify({ ok: true, synced }), {
      status: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[manager-mail-sync]", e);
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});

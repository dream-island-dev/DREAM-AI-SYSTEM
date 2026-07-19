import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  computeSlaDeadline,
  managerMailEnabled,
  type OritMailboxRow,
} from "../_shared/oritAgentMail.ts";
import { analyzeOritThread } from "../_shared/oritAgentAi.ts";
import { trySendAutoAck } from "../_shared/oritAgentSend.ts";
import {
  backfillOritGuestContacts,
  enrichOritThreadGuestContact,
} from "../_shared/oritGuestContactExtract.ts";
import { fetchMailboxInboxMessages, isMailboxIngestConfigured } from "../_shared/mailIngest.ts";
import { isImapConfigured, resolveImapConfig, testImapConnection } from "../_shared/imapMail.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
  if (!thread || thread.ai_analyzed_at) return;

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

  await supabase.from("orit_agent_drafts").delete().eq("thread_id", threadId).eq("status", "suggested");

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
      .in("connection_status", ["active", "disconnected", "error"]);

    let synced = 0;
    let backfilled = 0;
    for (const rawMailbox of mailboxes ?? []) {
      const mailbox = rawMailbox as OritMailboxRow;
      if (!isMailboxIngestConfigured(mailbox)) continue;

      try {
        if (mailbox.provider === "imap" || isImapConfigured(mailbox)) {
          const cfg = resolveImapConfig(mailbox);
          if (!cfg) continue;
          await testImapConnection(cfg);
          if (mailbox.connection_status !== "active") {
            await supabase.from("orit_agent_mailbox").update({
              connection_status: "active",
              email_address: mailbox.email_address || mailbox.owner_email,
              connection_error: null,
            }).eq("id", mailbox.id);
          }
        }

        const messages = await fetchMailboxInboxMessages({
          mailbox,
          onGraphTokenRefresh: async (next) => {
            await supabase.from("orit_agent_mailbox").update({
              oauth_refresh_token: next.refreshToken ?? mailbox.oauth_refresh_token,
              token_expires_at: next.expiresAt,
            }).eq("id", mailbox.id);
          },
        }, 30);

        for (const msg of messages) {
          if (!msg.fromEmail || !msg.threadKey) continue;

          const { data: existingThread } = await supabase
            .from("orit_agent_threads")
            .select("id, status, sla_deadline_at, ai_analyzed_at")
            .eq("mailbox_id", mailbox.id)
            .eq("external_thread_key", msg.threadKey)
            .maybeSingle();

          if (existingThread?.status === "handled") continue;

          let threadId = existingThread?.id ?? null;
          const isNewThread = !threadId;

          if (!threadId) {
            const slaDeadline = computeSlaDeadline(msg.receivedAt, mailbox.sla_hours);
            const { data: inserted, error: insertErr } = await supabase
              .from("orit_agent_threads")
              .insert({
                mailbox_id: mailbox.id,
                external_thread_key: msg.threadKey,
                graph_conversation_id: msg.threadKey,
                subject: msg.subject,
                from_email: msg.fromEmail,
                from_name: msg.fromName,
                received_at: msg.receivedAt,
                snippet: msg.bodyPreview,
                status: "awaiting_reply",
                sla_deadline_at: slaDeadline,
                is_demo: false,
              })
              .select("id")
              .maybeSingle();
            if (insertErr || !inserted) continue;
            threadId = inserted.id;
          } else {
            await supabase.from("orit_agent_threads").update({
              snippet: msg.bodyPreview,
              subject: msg.subject || undefined,
              sla_deadline_at: existingThread.sla_deadline_at
                ?? computeSlaDeadline(msg.receivedAt, mailbox.sla_hours),
            }).eq("id", threadId);
          }

          const { error: msgErr } = await supabase.from("orit_agent_messages").upsert({
            thread_id: threadId,
            external_key: msg.id,
            graph_message_id: msg.id,
            direction: "inbound",
            body_text: msg.bodyText,
            received_at: msg.receivedAt,
            message_kind: "email",
          }, { onConflict: "thread_id,external_key" });
          if (msgErr) continue;

          synced += 1;

          if (threadId) {
            try {
              await enrichOritThreadGuestContact(supabase, threadId, msg.bodyText);
            } catch (extractErr) {
              console.warn("[manager-mail-sync] guest contact extract failed:", (extractErr as Error).message);
            }
          }

          if (isNewThread && threadId) {
            const { data: threadRow } = await supabase
              .from("orit_agent_threads")
              .select("from_email, from_name, guest_contact_email, guest_contact_name, subject, auto_ack_sent_at")
              .eq("id", threadId)
              .maybeSingle();

            try {
              await trySendAutoAck(supabase, mailbox, {
                id: threadId,
                from_email: threadRow?.from_email ?? msg.fromEmail,
                from_name: threadRow?.from_name ?? msg.fromName,
                guest_contact_email: threadRow?.guest_contact_email ?? null,
                guest_contact_name: threadRow?.guest_contact_name ?? null,
                subject: threadRow?.subject ?? msg.subject,
                is_demo: false,
                auto_ack_sent_at: threadRow?.auto_ack_sent_at ?? null,
              });
            } catch (ackErr) {
              console.warn("[manager-mail-sync] auto-ack failed:", (ackErr as Error).message);
            }
          }

          try {
            await analyzeThread(supabase, mailbox.id, threadId);
          } catch (aiErr) {
            console.warn("[manager-mail-sync] analyze failed:", (aiErr as Error).message);
          }
        }

        try {
          backfilled += await backfillOritGuestContacts(supabase, mailbox.id);
        } catch (bfErr) {
          console.warn("[manager-mail-sync] guest contact backfill failed:", (bfErr as Error).message);
        }

        await supabase.from("orit_agent_mailbox").update({
          last_sync_at: new Date().toISOString(),
          connection_status: "active",
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

    return new Response(JSON.stringify({ ok: true, synced, backfilled }), {
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

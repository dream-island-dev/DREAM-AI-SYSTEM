import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { OritMailboxRow } from "../_shared/oritAgentMail.ts";
import { deliverOritThreadEmail } from "../_shared/oritAgentSend.ts";
import { fetchOritThreadInbound } from "../_shared/oritThreadAnalysis.ts";
import { loadOritCsAgentAccess } from "../_shared/oritCsAgentAccess.ts";
import { closeOritThread } from "../_shared/closeOritThread.ts";
import {
  notifyOritFullReplyReady,
  sendOritAckEmail,
  type OritAlertMailbox,
} from "../_shared/oritAgentWorkflow.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function saveOritStyleSample(
  supabase: ReturnType<typeof createClient>,
  mailboxId: string,
  threadId: string,
  category: string,
  outboundText: string,
  suggestedText?: string,
): Promise<void> {
  const inbound = await fetchOritThreadInbound(supabase, threadId);
  await supabase.from("orit_agent_style_samples").insert({
    mailbox_id: mailboxId,
    context_category: category || "other",
    inbound_snippet: (inbound || "").slice(0, 300),
    outbound_text: outboundText,
  });

  if (suggestedText && suggestedText.trim() !== outboundText.trim()) {
    await supabase.from("orit_agent_style_samples").insert({
      mailbox_id: mailboxId,
      context_category: `${category || "other"}_corrected`,
      inbound_snippet: (inbound || "").slice(0, 300),
      outbound_text: outboundText,
    });
  }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
        status: 200,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    if (!(await loadOritCsAgentAccess(supabase, userData.user.id))) {
      return new Response(JSON.stringify({ ok: false, error: "forbidden" }), {
        status: 200,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const {
      threadId,
      bodyText,
      markHandled,
      sendOnly,
      draftKind,
      draftId,
    } = await req.json();

    if (!threadId || !bodyText) {
      return new Response(JSON.stringify({ ok: false, error: "threadId and bodyText required" }), {
        status: 200,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const { data: thread } = await supabase
      .from("orit_agent_threads")
      .select("*, orit_agent_mailbox(*)")
      .eq("id", threadId)
      .maybeSingle();

    if (!thread) {
      return new Response(JSON.stringify({ ok: false, error: "thread_not_found" }), {
        status: 200,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const mailbox = thread.orit_agent_mailbox as OritMailboxRow;
    const finalText = String(bodyText).trim();
    const sentAt = new Date().toISOString();
    const kind = draftKind === "ack" ? "ack" : "full_reply";

    let suggestedText: string | undefined;
    if (draftId) {
      const { data: draftRow } = await supabase
        .from("orit_agent_drafts")
        .select("suggested_text")
        .eq("id", draftId)
        .maybeSingle();
      suggestedText = draftRow?.suggested_text;
    }

    if (kind === "ack") {
      if (thread.is_demo) {
        await supabase.from("orit_agent_messages").insert({
          thread_id: threadId,
          external_key: `demo-auto_ack-${sentAt}`,
          direction: "outbound",
          body_text: finalText,
          received_at: sentAt,
          message_kind: "auto_ack",
        });
        await supabase.from("orit_agent_threads").update({
          auto_ack_sent_at: sentAt,
          workflow_step: "awaiting_reply_approval",
        }).eq("id", threadId);
      } else if (mailbox.read_only_mode !== false) {
        return new Response(JSON.stringify({
          ok: false,
          error: "read_only_mode",
          hint: "תיבה במצב קריאה בלבד — העתיקי ל-Outlook",
        }), {
          status: 200,
          headers: { ...CORS, "Content-Type": "application/json" },
        });
      } else {
        const ackResult = await sendOritAckEmail(supabase, mailbox, thread, finalText, draftId);
        if (!ackResult.sent) {
          return new Response(JSON.stringify({
            ok: false,
            error: ackResult.error || "send_failed",
            hint: "שליחת אישור הקבלה נכשלה",
          }), {
            status: 200,
            headers: { ...CORS, "Content-Type": "application/json" },
          });
        }
      }

      await saveOritStyleSample(
        supabase,
        thread.mailbox_id,
        threadId,
        "complaint_ack",
        finalText,
        suggestedText,
      );

      const mailboxAlert: OritAlertMailbox = {
        id: mailbox.id,
        digest_whatsapp_phone: mailbox.digest_whatsapp_phone,
        alert_enabled: mailbox.alert_enabled !== false,
        profile_id: mailbox.profile_id,
      };
      try {
        await notifyOritFullReplyReady(supabase, mailboxAlert, threadId);
      } catch (notifyErr) {
        console.warn("[manager-mail-send] full-reply-ready notify failed:", (notifyErr as Error).message);
      }

      return new Response(JSON.stringify({
        ok: true,
        sent: true,
        draftKind: "ack",
        workflow_step: "awaiting_reply_approval",
      }), {
        status: 200,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const delivery = await deliverOritThreadEmail(
      supabase,
      mailbox,
      {
        id: thread.id,
        from_email: thread.from_email,
        from_name: thread.from_name,
        guest_contact_email: thread.guest_contact_email ?? null,
        guest_contact_name: thread.guest_contact_name ?? null,
        subject: thread.subject,
        is_demo: thread.is_demo,
      },
      finalText,
      "manual_reply",
    );

    if (!delivery.sent && !thread.is_demo && mailbox.read_only_mode === false) {
      return new Response(JSON.stringify({
        ok: false,
        error: delivery.error || "send_failed",
        hint: "שליחת המייל נכשלה — נסי להעתיק ולשלוח מ-Outlook",
      }), {
        status: 200,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    if (delivery.sent || thread.is_demo) {
      await saveOritStyleSample(
        supabase,
        thread.mailbox_id,
        threadId,
        thread.category || "complaint",
        finalText,
        suggestedText,
      );

      if (draftId) {
        await supabase.from("orit_agent_drafts").update({
          status: "sent",
          final_text: finalText,
        }).eq("id", draftId);
      } else {
        await supabase.from("orit_agent_drafts").update({
          status: "sent",
          final_text: finalText,
        })
          .eq("thread_id", threadId)
          .eq("draft_kind", "full_reply")
          .in("status", ["suggested", "edited"]);
      }

      const sentAt = new Date().toISOString();
      await supabase.from("orit_agent_threads").update({
        workflow_step: markHandled === true ? null : "reply_sent",
        full_reply_sent_at: sentAt,
        ...(markHandled === true ? {} : { status: "awaiting_reply" }),
      }).eq("id", threadId);
      if (markHandled === true) {
        await closeOritThread(supabase, threadId, { handledAt: sentAt });
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      sent: delivery.sent,
      read_only_mode: mailbox?.read_only_mode !== false,
      saved_sample: true,
      external_key: delivery.externalKey ?? null,
      draftKind: "full_reply",
      workflow_step: "reply_sent",
    }), {
      status: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[manager-mail-send]", e);
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});

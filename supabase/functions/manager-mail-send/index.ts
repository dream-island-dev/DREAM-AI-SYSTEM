import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { OritMailboxRow } from "../_shared/oritAgentMail.ts";
import { deliverOritThreadEmail } from "../_shared/oritAgentSend.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

    const { threadId, bodyText, markHandled, sendOnly } = await req.json();
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

    const delivery = await deliverOritThreadEmail(
      supabase,
      mailbox,
      {
        id: thread.id,
        from_email: thread.from_email,
        from_name: thread.from_name,
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

    await supabase.from("orit_agent_style_samples").insert({
      mailbox_id: thread.mailbox_id,
      context_category: thread.category || "other",
      inbound_snippet: (thread.snippet || "").slice(0, 300),
      outbound_text: finalText,
    });

    if (delivery.sent) {
      await supabase.from("orit_agent_drafts").update({ status: "sent" })
        .eq("thread_id", threadId)
        .eq("status", "suggested");
    }

    if (markHandled !== false && !sendOnly) {
      await supabase.from("orit_agent_threads").update({
        status: "handled",
        handled_at: sentAt,
      }).eq("id", threadId);
    }

    return new Response(JSON.stringify({
      ok: true,
      sent: delivery.sent,
      read_only_mode: mailbox?.read_only_mode !== false,
      saved_sample: true,
      external_key: delivery.externalKey ?? null,
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

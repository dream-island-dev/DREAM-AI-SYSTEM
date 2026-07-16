// manager-mail-auto-ack — sends receipt template for a thread (when outbound enabled).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { managerMailEnabled, type OritMailboxRow } from "../_shared/oritAgentMail.ts";
import { trySendAutoAck } from "../_shared/oritAgentSend.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    if (!managerMailEnabled()) {
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: "MANAGER_MAIL_ENABLED=false" }), {
        status: 200,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const threadId = body.threadId as string | undefined;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    if (!threadId) {
      return new Response(JSON.stringify({ ok: false, error: "threadId required" }), {
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
    if (mailbox.read_only_mode !== false) {
      return new Response(JSON.stringify({
        ok: true,
        skipped: true,
        reason: "read_only_mode",
        sent: false,
      }), {
        status: 200,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const sent = await trySendAutoAck(supabase, mailbox, {
      id: thread.id,
      from_email: thread.from_email,
      from_name: thread.from_name,
      subject: thread.subject,
      is_demo: thread.is_demo,
      auto_ack_sent_at: thread.auto_ack_sent_at,
    });

    return new Response(JSON.stringify({ ok: true, sent }), {
      status: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[manager-mail-auto-ack]", e);
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});

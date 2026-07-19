import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { managerMailEnabled } from "../_shared/oritAgentMail.ts";
import { notifyOritThreadDecisionPrompt } from "../_shared/oritAgentOritDecision.ts";
import type { OritAlertMailbox } from "../_shared/oritAgentWhapiAlert.ts";

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

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json().catch(() => ({}));
    const threadId = body.threadId as string | undefined;
    const force = body.force === true;
    const backfillPending = body.backfillPending === true;

    const { data: mailboxes } = await supabase
      .from("orit_agent_mailbox")
      .select("id, profile_id, digest_whatsapp_phone, alert_enabled")
      .eq("connection_status", "active")
      .limit(1);

    const mailbox = mailboxes?.[0] as OritAlertMailbox | undefined;
    if (!mailbox?.id) {
      return new Response(JSON.stringify({ ok: false, error: "no_active_mailbox" }), {
        status: 200,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    if (threadId) {
      const result = await notifyOritThreadDecisionPrompt(supabase, mailbox, threadId, { force });
      return new Response(JSON.stringify({ ok: true, ...result }), {
        status: 200,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    if (backfillPending) {
      const { data: openThreads } = await supabase
        .from("orit_agent_threads")
        .select("id, category, urgency")
        .eq("mailbox_id", mailbox.id)
        .eq("category", "complaint")
        .eq("status", "awaiting_reply")
        .eq("is_demo", false);

      let sent = 0;
      const skipped: string[] = [];
      for (const row of openThreads ?? []) {
        const result = await notifyOritThreadDecisionPrompt(supabase, mailbox, row.id);
        if (result.sent) sent += 1;
        else skipped.push(`${row.id}:${result.reason}`);
      }

      return new Response(JSON.stringify({ ok: true, sent, skippedCount: skipped.length }), {
        status: 200,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: false, error: "threadId or backfillPending required" }), {
      status: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[manager-mail-alert]", e);
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});

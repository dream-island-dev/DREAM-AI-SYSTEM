// manager-mail-auto-ack — disabled in read-only mode (Orit sends manually).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { managerMailEnabled } from "../_shared/oritAgentMail.ts";

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

    if (threadId) {
      const { data: thread } = await supabase
        .from("orit_agent_threads")
        .select("orit_agent_mailbox(read_only_mode)")
        .eq("id", threadId)
        .maybeSingle();
      const readOnly = thread?.orit_agent_mailbox?.read_only_mode !== false;
      if (readOnly) {
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
    }

    return new Response(JSON.stringify({
      ok: true,
      skipped: true,
      reason: "auto_ack_disabled",
      sent: false,
    }), {
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

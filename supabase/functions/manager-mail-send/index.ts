import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { OritMailboxRow } from "../_shared/oritAgentMail.ts";

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

    const { threadId, bodyText, markHandled } = await req.json();
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

    if (thread.is_demo) {
      await supabase.from("orit_agent_messages").insert({
        thread_id: threadId,
        external_key: `demo-manual-${sentAt}`,
        direction: "outbound",
        body_text: finalText,
        received_at: sentAt,
        message_kind: "manual_reply",
      });
    }

    await supabase.from("orit_agent_style_samples").insert({
      mailbox_id: thread.mailbox_id,
      context_category: thread.category || "other",
      inbound_snippet: (thread.snippet || "").slice(0, 300),
      outbound_text: finalText,
    });

    if (markHandled !== false) {
      await supabase.from("orit_agent_threads").update({
        status: "handled",
        handled_at: sentAt,
      }).eq("id", threadId);
    }

    return new Response(JSON.stringify({
      ok: true,
      read_only_mode: mailbox?.read_only_mode !== false,
      saved_sample: true,
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

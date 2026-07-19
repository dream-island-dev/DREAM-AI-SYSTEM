import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  persistOritThreadAnalysis,
  runOritThreadAnalysis,
} from "../_shared/oritThreadAnalysis.ts";

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

    const { threadId } = await req.json();
    if (!threadId) {
      return new Response(JSON.stringify({ ok: false, error: "threadId required" }), {
        status: 200,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const { data: thread } = await supabase
      .from("orit_agent_threads")
      .select("*, orit_agent_mailbox!inner(id, profile_id, owner_email)")
      .eq("id", threadId)
      .maybeSingle();

    if (!thread) {
      return new Response(JSON.stringify({ ok: false, error: "thread_not_found" }), {
        status: 200,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const forceLlm = thread.category === "complaint";
    const analysis = await runOritThreadAnalysis(supabase, thread.mailbox_id, thread, { forceLlm });
    await persistOritThreadAnalysis(supabase, threadId, analysis, userData.user.id);

    return new Response(JSON.stringify({
      ok: true,
      analysis,
      llm_skipped: analysis.engine === "tier0-no-llm",
    }), {
      status: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[manager-mail-analyze]", e);
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
